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
        this.provider = options.provider !== undefined ? options.provider : createAIProvider();
        this.userCooldowns = new Map(); // userId -> timestamp
        this.activeLocks = new Set();   // guildId:userId locks
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
        if (!this.provider) {
            return {
                intent: parseDeterministicRequest(sanitizedPrompt, overrideCount, context),
                isFallback: true,
            };
        }

        const systemPrompt = [
            'You are Reso AI DJ, an expert music curator embedded in a Discord bot.',
            'Your role is to understand the user\'s musical vibe request and produce a compact JSON playlist generation plan.',
            'Adhere strictly to the requested JSON schema.',
            'Formulate 3 to 5 realistic search queries that will match real songs on YouTube.',
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
            const rawJson = await this.provider.generateCompletion({
                prompt: userPrompt,
                systemPrompt,
                schema: INTENT_JSON_SCHEMA,
            });

            if (!rawJson || typeof rawJson !== 'object') {
                throw new Error('AI returned non-object response');
            }

            const validated = validateAndSanitizeIntent(rawJson, overrideCount);

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
            return {
                intent: parseDeterministicRequest(sanitizedPrompt, overrideCount, context),
                isFallback: true,
            };
        }
    }

    /**
     * Search Lavalink for a query with timeout
     * @param {object} player Lavalink Player
     * @param {string} query Search query
     * @param {object} user Discord User
     * @param {number} timeoutMs Max time per search
     * @returns {Promise<Array>}
     */
    async _searchWithTimeout(player, query, user, timeoutMs = 7000) {
        if (!player || !player.search) return [];

        try {
            const searchPromise = player.search({ query, source: 'ytsearch' }, user);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Search timeout')), timeoutMs)
            );

            const result = await Promise.race([searchPromise, timeoutPromise]);
            return result?.tracks || [];
        } catch (err) {
            console.warn(`[Reso DJ] Search query "${truncate(query, 35)}" failed: ${err.message}`);
            return [];
        }
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
        const filtered = this.filterAndDeduplicate(candidateTracks, intent, user, guildId);
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
            .replace(/\[.*?\]|\(.*?\)/g, ' ') // Strip brackets & parens content
            .replace(/\b(official\s+)?(video|audio|music\s+video|lyric\s+video|lyrics?|audio\s+song|full\s+song|full\s+audio|full\s+video|hd|4k|remastered|visualizer|mv|song)\b/gi, ' ')
            .replace(/[\-–—_|:!]/g, ' ')     // Strip punctuation
            .replace(/\s+/g, ' ')            // Normalize whitespace
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

        for (const track of tracks) {
            if (!track || !track.info) continue;
            const info = track.info;

            // 1. Basic validation: must have title and URI
            if (!info.title || !info.uri) continue;

            // 2. Filter out live streams unless user requested live
            if (info.isStream && !allowLive) continue;

            // 3. Duration check: discard tracks shorter than 30s or longer than 20 mins
            const durationMs = info.duration || 0;
            if (durationMs > 0 && (durationMs < 30000 || durationMs > 1200000)) {
                continue;
            }

            const titleLower = info.title.toLowerCase();
            const authorLower = (info.author || '').toLowerCase();

            // 4. Apply excluded terms
            let isExcluded = false;
            for (const excluded of excludedTerms) {
                if (titleLower.includes(excluded) || authorLower.includes(excluded)) {
                    isExcluded = true;
                    break;
                }
            }
            if (isExcluded) continue;

            // 5. Canonical deduplication
            const canonical = this.canonicalizeTitle(info.title);
            if (!canonical) continue;

            // Create signature based on cleaned title and first word of author
            const authorKey = authorLower.split(/[\s,]+/)[0] || '';
            const signature = `${canonical}::${authorKey}`;

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
