/**
 * Reso AI DJ Service
 * Orchestrates natural language interpretation, music discovery, deduplication, and ranking.
 */

const { validateAndSanitizeIntent, INTENT_JSON_SCHEMA } = require('./intentSchema');
const { parseDeterministicRequest } = require('./deterministicFallback');
const { createAIProvider } = require('./providers/factory');
const { feedbackStore } = require('./feedbackStore');
const { cleanVideoTitle, truncate } = require('../utils/helpers');

class DJService {
    constructor(options = {}) {
        this._providerExplicitlySet = ('provider' in options);
        this.provider = options.provider !== undefined ? options.provider : null;
        this.userCooldowns = new Map(); // userId -> timestamp
        this.activeLocks = new Set();   // guildId:userId locks
    }

    /**
     * Resolve configured AI provider lazily
     * @returns {import('./providers/baseProvider') | null}
     */
    getProvider() {
        if (this._providerExplicitlySet) {
            return this.provider;
        }
        if (!this.provider) {
            this.provider = createAIProvider();
        }
        return this.provider;
    }

    /**
     * Check rate limits for user
     * @param {string} userId
     * @returns {{ allowed: boolean, waitSeconds?: number }}
     */
    checkRateLimit(userId) {
        if (!userId) return { allowed: true };
        const now = Date.now();
        const last = this.userCooldowns.get(userId) || 0;
        const cooldownMs = 8000; // 8 seconds per user cooldown

        if (now - last < cooldownMs) {
            const waitSeconds = Math.ceil((cooldownMs - (now - last)) / 1000);
            return { allowed: false, waitSeconds };
        }

        this.userCooldowns.set(userId, now);
        return { allowed: true };
    }

    /**
     * Acquire concurrency lock to prevent simultaneous race conditions
     * @param {string} guildId
     * @param {string} userId
     * @returns {boolean} true if lock acquired, false if busy
     */
    acquireLock(guildId, userId) {
        const key = `${guildId}:${userId}`;
        if (this.activeLocks.has(key)) {
            return false;
        }
        this.activeLocks.add(key);
        return true;
    }

    /**
     * Release concurrency lock
     * @param {string} guildId
     * @param {string} userId
     */
    releaseLock(guildId, userId) {
        const key = `${guildId}:${userId}`;
        this.activeLocks.delete(key);
    }

    /**
     * Interpret a natural language request via AI (or deterministic fallback)
     * @param {string} rawRequest
     * @param {number} [overrideCount]
     * @param {object} [context] Current playing track details, if any
     * @returns {Promise<{ intent: object, isFallback: boolean }>}
     */
    async interpretRequest(rawRequest, overrideCount = null, context = null) {
        // Enforce max length of 300 characters to prevent prompt injection or token bloat
        const sanitizedPrompt = String(rawRequest || '').trim().slice(0, 300);

        if (!sanitizedPrompt) {
            return {
                intent: parseDeterministicRequest('popular hits', overrideCount, context),
                isFallback: true,
            };
        }

        // If no AI provider configured, use deterministic fallback immediately
        const provider = this.getProvider();
        if (!provider) {
            return {
                intent: parseDeterministicRequest(sanitizedPrompt, overrideCount, context),
                isFallback: true,
                fallbackReason: 'No AI key found in environment (AI_API_KEY or GEMINI_API_KEY)',
            };
        }

        const systemPrompt = [
            'You are Reso AI DJ, an expert music curator embedded in a Discord bot.',
            'Your role is to understand the user\'s musical vibe request and produce a compact JSON playlist generation plan.',
            'Adhere strictly to the requested JSON schema.',
            'Formulate 3 to 5 realistic, high-precision search queries that will match real songs on YouTube Music or YouTube.',
            'When the user requests songs from a specific movie, soundtrack, album, or artist (e.g., "karuppu movie songs", "leo songs", "interstellar soundtrack", "anirudh hits"):',
            '  - Create targeted search queries to find real songs and audio tracks from that movie, album, or artist.',
            '  - Do NOT generate full movie queries, 2-hour mix queries, or unrelated generic playlists.',
            '  - Accurately describe the movie, album, or artist in the summary.',
            'Do NOT invent fake song URLs, video IDs, or unreleased titles.',
            'Extract any negative exclusions mentioned (e.g., "no sad songs", "without slow romantic tracks").',
        ].join('\n');

        const contextInfo = context?.title
            ? `\nCurrently playing track: "${context.title}" by "${context.author || 'Unknown'}"`
            : '';

        const userPrompt = [
            `User Request: "${sanitizedPrompt}"`,
            overrideCount ? `Target track count: ${overrideCount}` : '',
            contextInfo,
            '\nRespond ONLY with valid JSON conforming to the schema.',
        ].filter(Boolean).join('\n');

        try {
            const rawJson = await provider.generateCompletion({
                prompt: userPrompt,
                systemPrompt,
                schema: INTENT_JSON_SCHEMA,
            });

            if (!rawJson || typeof rawJson !== 'object') {
                throw new Error('AI returned non-object response');
            }

            const validated = validateAndSanitizeIntent(rawJson, overrideCount);
            validated.rawRequest = sanitizedPrompt;

            // Ensure search queries are valid
            let searchQueries = Array.isArray(rawJson.searchQueries)
                ? rawJson.searchQueries.filter(q => typeof q === 'string' && q.trim().length > 0).map(q => q.trim().slice(0, 80))
                : [];

            if (searchQueries.length === 0) {
                // If model failed to formulate queries, borrow from fallback generator
                const fallback = parseDeterministicRequest(sanitizedPrompt, overrideCount, context);
                searchQueries = fallback.searchQueries;
            }

            validated.searchQueries = searchQueries.slice(0, 5);

            return {
                intent: validated,
                isFallback: false,
            };
        } catch (err) {
            console.warn(`[Reso DJ] AI interpretation failed (${err.message}). Falling back to deterministic engine.`);
            const fallbackIntent = parseDeterministicRequest(sanitizedPrompt, overrideCount, context);
            fallbackIntent.rawRequest = sanitizedPrompt;
            return {
                intent: fallbackIntent,
                isFallback: true,
                fallbackReason: err.message,
            };
        }
    }

    /**
     * Search Lavalink for a query with timeout and multi-source resilience
     * @param {object} player Lavalink Player
     * @param {string} query Search query
     * @param {object} user Discord User
     * @param {number} timeoutMs Max time per search
     * @returns {Promise<Array>}
     */
    async _searchWithTimeout(player, query, user, timeoutMs = 7000) {
        if (!player) return [];
        const searchFn = typeof player.search === 'function'
            ? player.search.bind(player)
            : player.node?.search?.bind(player.node);
        if (!searchFn) return [];

        const startTime = Date.now();
        // Priority sources: ytmsearch (clean audio), ytsearch (broad video), spsearch (Spotify)
        const sources = ['ytmsearch', 'ytsearch', 'spsearch'];

        for (const source of sources) {
            const elapsed = Date.now() - startTime;
            const remainingMs = timeoutMs - elapsed;
            if (remainingMs <= 10) break;

            try {
                const searchPromise = searchFn({ query, source }, user);
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Search timeout')), remainingMs)
                );

                const result = await Promise.race([searchPromise, timeoutPromise]);
                if (result && Array.isArray(result.tracks) && result.tracks.length > 0) {
                    return result.tracks;
                }
            } catch (err) {
                if (err.message === 'Search timeout') {
                    console.warn(`[Reso DJ] Search query "${truncate(query, 35)}" timed out after ${timeoutMs}ms`);
                    break;
                }
                // Source failed or unsupported on this node, fallback to next source
            }
        }

        return [];
    }

    /**
     * Discover, deduplicate, filter, and rank tracks
     * @param {object} player Lavalink Player
     * @param {object} intent Validated intent object
     * @param {object} user Discord User
     * @param {string} [guildId]
     * @returns {Promise<{ tracks: Array, intent: object, summary: string, totalDiscovered: number }>}
     */
    async discoverAndRankTracks(player, intent, user, guildId = null) {
        const queries = intent.searchQueries || ['popular songs'];
        const candidateTracks = [];

        // Execute bounded searches (parallel with Promise.allSettled)
        const searchPromises = queries.slice(0, 4).map(q =>
            this._searchWithTimeout(player, q, user, 7000)
        );

        const settledResults = await Promise.allSettled(searchPromises);
        for (const res of settledResults) {
            if (res.status === 'fulfilled' && Array.isArray(res.value)) {
                candidateTracks.push(...res.value);
            }
        }

        // Apply filters, deduplication, and ranking
        let filtered = this.filterAndDeduplicate(candidateTracks, intent, user, guildId);

        // Emergency raw fallback: if initial search results were empty, try direct searches
        if (filtered.length === 0 && (intent.rawRequest || intent.summary)) {
            const rawTarget = intent.rawRequest || intent.summary;
            const emergencyQueries = [
                rawTarget,
                `${rawTarget} songs`,
                `${rawTarget} soundtrack`,
            ].filter(Boolean);

            for (const eq of emergencyQueries) {
                const emergencyTracks = await this._searchWithTimeout(player, eq, user, 6000);
                if (emergencyTracks.length > 0) {
                    const emergencyFiltered = this.filterAndDeduplicate(emergencyTracks, intent, user, guildId);
                    if (emergencyFiltered.length > 0) {
                        filtered.push(...emergencyFiltered);
                        break;
                    }
                }
            }
        }

        const ranked = this.rankTracks(filtered, intent, guildId, user?.id);

        const finalTracks = ranked.slice(0, intent.trackCount);

        // Stamp requester on all selected tracks
        for (const t of finalTracks) {
            t.requester = user;
        }

        return {
            tracks: finalTracks,
            intent,
            summary: intent.summary || `${intent.mood} playlist`,
            totalDiscovered: filtered.length,
        };
    }

    /**
     * Normalize track title for fuzzy comparison
     * Strips common noise: [Official Video], (Audio), - Lyric Video, Remastered, etc.
     */
    canonicalizeTitle(rawTitle) {
        if (!rawTitle) return '';
        let title = cleanVideoTitle(String(rawTitle)).toLowerCase();

        // Remove video tags & noise
        title = title
            .replace(/\s*[\(\[\{](?:official\s+)?(?:video(?:\s+song)?|music\s+video|lyric(?:al)?(?:\s+video)?|audio(?:\s+song)?|full\s+song|full\s+video|4k|hd|remastered|visualizer|redux|mv)[\)\]\}]/gi, ' ')
            .replace(/\[.*?\]/g, ' ')
            .replace(/\b(official\s+)?(video|audio|music\s+video|lyric\s+video|lyrics?|full\s+audio\s+song|audio\s+song|full\s+song|full\s+audio|full\s+video|hd|4k|remastered|visualizer|mv)\b/gi, ' ')
            .replace(/\b(song|songs)\b/gi, ' ')
            .replace(/[\(\)\[\]\{\}\-–—_|:!]/g, ' ') // Strip punctuation including brackets/parens
            .replace(/\s+/g, ' ')                    // Normalize whitespace
            .trim();

        return title;
    }

    /**
     * Filter out unplayable, live, or excluded tracks and deduplicate
     */
    filterAndDeduplicate(tracks, intent, user, guildId) {
        const seenSignatures = new Set();
        const validTracks = [];

        const excludedTerms = (intent.excludedTerms || []).map(t => t.toLowerCase().trim()).filter(Boolean);
        const allowLive = /\b(live|concert|radio|stream)\b/i.test(intent.mood || '');
        const NON_MUSIC_REGEX = /\b(full\s+movie|full\s+film|movie\s+scenes?|comedy\s+scenes?|trailers?|teasers?|review|reaction|interview|making\s+of|behind\s+the\s+scenes)\b/i;

        for (const track of tracks) {
            if (!track || !track.info) continue;
            const info = track.info;

            // 1. Basic validation: must have title and URI
            if (!info.title || !info.uri) continue;

            // 2. Filter out non-music video fluff (full movies, comedy clips, movie trailers)
            if (NON_MUSIC_REGEX.test(info.title)) continue;

            // 3. Filter out live streams unless user requested live
            if (info.isStream && !allowLive) continue;

            // 4. Duration check: discard tracks shorter than 30s or longer than 20 mins
            const durationMs = info.duration || 0;
            if (durationMs > 0 && (durationMs < 30000 || durationMs > 1200000)) {
                continue;
            }

            const titleLower = info.title.toLowerCase();
            const authorLower = (info.author || '').toLowerCase();

            // 5. Apply excluded terms
            let isExcluded = false;
            for (const excluded of excludedTerms) {
                if (titleLower.includes(excluded) || authorLower.includes(excluded)) {
                    isExcluded = true;
                    break;
                }
            }
            if (isExcluded) continue;

            // 6. Canonical deduplication with duration bucket
            const canonical = this.canonicalizeTitle(info.title);
            if (!canonical) continue;

            // Create signature based on cleaned title, author key, and duration bucket (within 15s)
            const authorKey = authorLower.split(/[\s,]+/)[0] || '';
            const durationBucket = Math.round(durationMs / 15000);
            const signature = `${canonical}::${authorKey}::${durationBucket}`;

            if (seenSignatures.has(signature)) {
                continue;
            }
            seenSignatures.add(signature);

            validTracks.push(track);
        }

        return validTracks;
    }

    /**
     * Deterministically rank tracks based on relevance, tags, and preferences
     */
    rankTracks(tracks, intent, guildId = null, userId = null) {
        const prefs = guildId && userId ? feedbackStore.getPreferences(guildId, userId) : { likes: [], dislikes: [] };
        const artistCounts = new Map();

        const scored = tracks.map((track, originalIndex) => {
            let score = 100 - originalIndex; // Base search relevance

            const title = (track.info?.title || '').toLowerCase();
            const author = (track.info?.author || '').toLowerCase();

            // Language match boost
            for (const lang of (intent.languages || [])) {
                if (title.includes(lang.toLowerCase())) score += 20;
            }

            // Genre match boost
            for (const genre of (intent.genres || [])) {
                if (title.includes(genre.toLowerCase())) score += 15;
            }

            // Era match boost
            for (const era of (intent.eras || [])) {
                if (title.includes(era.toLowerCase())) score += 15;
            }

            // Mood match boost
            if (intent.mood && title.includes(intent.mood.toLowerCase())) {
                score += 10;
            }

            // Subject / Search query match boost (e.g. "karuppu")
            if (intent.searchQueries && intent.searchQueries.length > 0) {
                const primaryQuery = intent.searchQueries[0].toLowerCase();
                const primaryWords = primaryQuery.split(/\s+/).filter(w => w.length > 3 && !['songs', 'movie', 'soundtrack', 'playlist', 'audio', 'music'].includes(w));
                for (const word of primaryWords) {
                    if (title.includes(word) || author.includes(word)) {
                        score += 30; // Boost tracks matching requested movie/subject
                    }
                }
            }

            // Explicit artist boost
            for (const artist of (intent.artists || [])) {
                if (title.includes(artist.toLowerCase()) || author.includes(artist.toLowerCase())) {
                    score += 25;
                }
            }

            // User preference like boost
            for (const liked of prefs.likes) {
                if (title.includes(liked) || author.includes(liked)) {
                    score += 25;
                }
            }

            // User preference dislike penalty
            for (const disliked of prefs.dislikes) {
                if (title.includes(disliked) || author.includes(disliked)) {
                    score -= 40;
                }
            }

            // Diversity penalty: reduce score if artist has appeared multiple times
            const primaryArtist = author.split(/[\s,]+/)[0] || 'unknown';
            const count = artistCounts.get(primaryArtist) || 0;
            if (count > 0) {
                score -= count * 15;
            }
            artistCounts.set(primaryArtist, count + 1);

            return { track, score };
        });

        // Sort descending by score
        scored.sort((a, b) => b.score - a.score);

        return scored.map(item => item.track);
    }
}

const djService = new DJService();

module.exports = {
    DJService,
    djService,
};
