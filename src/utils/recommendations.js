const { truncate } = require('./helpers');

// ══════════════════════════════════════════════════════════════════
//  Reso — YouTube-Style 5-Tier Recommendation Engine
//  Mirrors how YouTube recommends songs for Indian/Tamil music:
//    Tier 1: Same collaboration group (artist × composer combo)
//    Tier 2: Same movie / album soundtrack
//    Tier 3: Same primary artist / composer
//    Tier 4: Genre + language match
//    Tier 5: Regional trending discovery
// ══════════════════════════════════════════════════════════════════

// ── Tier weights (must sum to 100) ─────────────────────────────
const TIER_WEIGHTS = {
    COLLAB: 40,       // Tier 1: Same collaboration group
    MOVIE_ALBUM: 20,  // Tier 2: Same movie/album
    ARTIST: 20,       // Tier 3: Same artist/composer
    GENRE: 15,        // Tier 4: Genre + language match
    DISCOVERY: 5,     // Tier 5: Regional trending
};

// ── Known Indian music labels/channels to strip from artist ────
const LABEL_PATTERNS = /\b(vevo|official|channel|studio|records|recordings|music|tv|media|productions?|entertainment|films?|pictures|movies?|pvt|ltd|limited|inc|digital|network|india|south|label)\b/gi;
const TOPIC_SUFFIX = /\s*-\s*Topic$/i;

// ── Language detection keywords ────────────────────────────────
const LANGUAGE_KEYWORDS = {
    tamil: ['tamil', 'tamizh', 'kollywood', 'தமிழ்'],
    hindi: ['hindi', 'bollywood', 'हिंदी'],
    telugu: ['telugu', 'tollywood', 'తెలుగు'],
    malayalam: ['malayalam', 'mollywood', 'മലയാളം'],
    kannada: ['kannada', 'sandalwood', 'ಕನ್ನಡ'],
    punjabi: ['punjabi', 'ਪੰਜਾਬੀ'],
    english: ['english', 'pop', 'rock', 'hip hop', 'rap', 'edm', 'r&b'],
    korean: ['korean', 'k-pop', 'kpop'],
    japanese: ['japanese', 'j-pop', 'jpop', 'anime'],
};

// ── Genre detection keywords ───────────────────────────────────
const GENRE_KEYWORDS = {
    mass: ['mass', 'kuthu', 'gaana', 'item', 'intro', 'thalapathy', 'thala', 'beast', 'bigil', 'mersal', 'leo', 'goat', 'master'],
    melody: ['melody', 'love', 'romantic', 'kadhal', 'kanave', 'unakkaga', 'mazhai', 'idhayam'],
    devotional: ['devotional', 'bhakti', 'temple', 'god', 'murugan', 'ayyappan', 'shiva'],
    folk: ['folk', 'nattupura', 'village', 'karakattam'],
    party: ['party', 'dance', 'club', 'dj', 'remix'],
    sad: ['sad', 'breakup', 'pain', 'vidalai', 'pirivu'],
    rap: ['rap', 'hip hop', 'hiphop', 'freestyle'],
};

// ── Well-known Indian music composers (for collaboration detection) ──
const KNOWN_COMPOSERS = [
    'anirudh', 'anirudh ravichander', 'a.r. rahman', 'ar rahman', 'a r rahman',
    'yuvan', 'yuvan shankar raja', 'harris jayaraj', 'harris', 'hip hop tamizha',
    'hiphop tamizha', 'santhosh narayanan', 'sam cs', 'd.imman', 'd imman', 'imman',
    'g.v.prakash', 'gv prakash', 'g v prakash', 'devi sri prasad', 'dsp',
    'thaman', 's.thaman', 's thaman', 'vidyasagar', 'ilaiyaraaja', 'ilayaraja',
    'sean roldan', 'c. sathya', 'leon james', 'sid sriram', 'pritam',
    'vishal mishra', 'arijit singh', 'amit trivedi', 'shankar ehsaan loy',
    'mani sharma', 'mickey j meyer', 'rockstar devi sri prasad',
];

// ══════════════════════════════════════════════════════════════════
//  TITLE CLEANING & PARSING
// ══════════════════════════════════════════════════════════════════

/**
 * Universal video descriptor remover
 * Strips: (Official Video), [4K], Lyric Video, Video Song, HDR, etc.
 */
function stripVideoJunk(text = '') {
    if (!text) return '';
    return text
        .replace(/[\(\[\{].*?[\)\]\}]/g, '')  // remove (...) [...] {...}
        .replace(/\b(official|music|video|audio|lyric|lyrics|full song|hd|4k|1080p|remastered|visualizer|status|shorts|video song|lyric video|4k video|uhd|teaser|trailer|song|songs|promo|jukebox|making|bts|behind the scenes)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Clean song title — extracts just the song name
 */
function cleanSongTitle(title = '') {
    const firstPart = title.split(/\||-|:|\/(?![\/])/)[0] || title;
    return stripVideoJunk(firstPart) || title;
}

/**
 * Clean up channel/author name to extract real artist name
 */
function cleanAuthor(author = '') {
    if (!author) return '';
    return author
        .replace(TOPIC_SUFFIX, '')        // "Artist - Topic" → "Artist"
        .replace(LABEL_PATTERNS, '')       // Remove label keywords
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Enhanced Algorithmic Title Metadata Parser
 * Handles multiple Indian/international music title formats:
 *
 *   Format A: "Song Name (From \"Movie Name\")"
 *   Format B: "Song | Movie | Composer | Singer"
 *   Format C: "Artist - Song Name"
 *   Format D: "Movie - Song | Composer | Singer"
 *   Format E: "Song Name | Artist" (2-segment)
 *   Format F: Plain "Song Name" (single segment)
 */
function parseTrackMetadata(title = '', author = '') {
    let songName = '';
    let movieOrAlbum = null;
    let primaryArtist = null;
    let secondaryArtist = null;
    let detectedComposer = null;

    // ── Step 1: Try to extract movie from "(From X)" pattern ──
    const fromMatch = title.match(/\((?:From\s+)?[""]?(.+?)[""]?\)\s*$/i);
    if (fromMatch) {
        movieOrAlbum = stripVideoJunk(fromMatch[1]).trim() || null;
    }

    // ── Step 2: Remove the "(From X)" part from title for further parsing ──
    const titleWithoutFrom = title.replace(/\s*\((?:From\s+)?[""]?.+?[""]?\)\s*$/i, '').trim();

    // ── Step 3: Split by delimiters |, -, :, / (but not //) ──
    const rawSegments = titleWithoutFrom.split(/\||-|:|\/(?!\/)/).map(s => s.trim()).filter(Boolean);
    const cleanedSegments = rawSegments.map(s => stripVideoJunk(s)).filter(s => s.length > 0);

    // ── Step 4: Detect composer from any segment ──
    for (const seg of cleanedSegments) {
        const segLower = seg.toLowerCase();
        for (const composer of KNOWN_COMPOSERS) {
            if (segLower.includes(composer)) {
                detectedComposer = seg.trim();
                break;
            }
        }
        if (detectedComposer) break;
    }

    // ── Step 5: Parse based on segment count ──
    if (cleanedSegments.length === 0) {
        songName = stripVideoJunk(title) || title;
    } else if (cleanedSegments.length === 1) {
        songName = cleanedSegments[0];
    } else if (cleanedSegments.length === 2) {
        // Could be "Artist - Song" or "Song | Movie"
        if (title.includes(' - ') && !title.includes('|')) {
            // Format C: "Artist - Song"
            primaryArtist = cleanedSegments[0];
            songName = cleanedSegments[1];
        } else {
            // Format E: "Song | Artist/Movie"
            songName = cleanedSegments[0];
            // Check if second segment is a known composer
            const seg1Lower = cleanedSegments[1].toLowerCase();
            const isComposer = KNOWN_COMPOSERS.some(c => seg1Lower.includes(c));
            if (isComposer) {
                detectedComposer = detectedComposer || cleanedSegments[1];
                primaryArtist = cleanedSegments[1];
            } else {
                // Assume it's a movie/album if we already have a movie from "(From X)"
                if (!movieOrAlbum) movieOrAlbum = cleanedSegments[1];
                else primaryArtist = cleanedSegments[1];
            }
        }
    } else {
        // 3+ segments: "Song | Movie | Composer | Singer" or "Artist - Song - Album"
        if (title.includes(' - ') && !title.includes('|')) {
            // Format C extended: "Artist - Song - Album"
            primaryArtist = cleanedSegments[0];
            songName = cleanedSegments[1];
            if (!movieOrAlbum) movieOrAlbum = cleanedSegments[2] || null;
        } else {
            // Format B: "Song | Movie | Composer | Singer"
            songName = cleanedSegments[0];
            if (!movieOrAlbum) movieOrAlbum = cleanedSegments[1];
            // Check remaining segments for composer/artist
            for (let i = 2; i < cleanedSegments.length; i++) {
                const segLower = cleanedSegments[i].toLowerCase();
                const isComposer = KNOWN_COMPOSERS.some(c => segLower.includes(c));
                if (isComposer && !detectedComposer) {
                    detectedComposer = cleanedSegments[i];
                } else if (!primaryArtist) {
                    primaryArtist = cleanedSegments[i];
                } else if (!secondaryArtist) {
                    secondaryArtist = cleanedSegments[i];
                }
            }
        }
    }

    // ── Step 6: Fallbacks using channel/author ──
    const cleanedAuthor = cleanAuthor(author);
    if (!primaryArtist && cleanedAuthor) {
        primaryArtist = cleanedAuthor;
    }
    if (!detectedComposer) {
        // Check if channel author is a known composer
        const authorLower = (cleanedAuthor || '').toLowerCase();
        for (const composer of KNOWN_COMPOSERS) {
            if (authorLower.includes(composer)) {
                detectedComposer = cleanedAuthor;
                break;
            }
        }
    }

    // Final fallbacks
    if (!songName) songName = stripVideoJunk(title) || 'Song';
    if (!primaryArtist) primaryArtist = detectedComposer || songName;

    return {
        songName,
        movieOrAlbum,
        primaryArtist,
        secondaryArtist: secondaryArtist || null,
        composer: detectedComposer || null,
    };
}

// ══════════════════════════════════════════════════════════════════
//  LANGUAGE & GENRE DETECTION
// ══════════════════════════════════════════════════════════════════

/**
 * Detect language and genre from title + author text
 * Returns { language: string|null, genre: string|null }
 */
function detectLanguageAndGenre(title = '', author = '') {
    const combined = `${title} ${author}`.toLowerCase();
    let language = null;
    let genre = null;

    // Detect language
    for (const [lang, keywords] of Object.entries(LANGUAGE_KEYWORDS)) {
        if (keywords.some(kw => combined.includes(kw))) {
            language = lang;
            break;
        }
    }

    // Detect genre
    for (const [g, keywords] of Object.entries(GENRE_KEYWORDS)) {
        if (keywords.some(kw => combined.includes(kw))) {
            genre = g;
            break;
        }
    }

    return { language, genre };
}

// ══════════════════════════════════════════════════════════════════
//  5-TIER SEARCH QUERY BUILDER
// ══════════════════════════════════════════════════════════════════

/**
 * Build 5-tier search queries mimicking YouTube's recommendation logic
 * Returns array of { query, tier, label, count }
 */
function buildSearchQueries(meta, langGenre) {
    const queries = [];
    const { songName, movieOrAlbum, primaryArtist, secondaryArtist, composer } = meta;
    const { language, genre } = langGenre;
    const langTag = language || '';

    // ── Tier 1: Collaboration group (composer × artist combo) ──
    if (composer && primaryArtist && composer !== primaryArtist) {
        queries.push({
            query: `${composer} ${primaryArtist} songs ${langTag}`.trim(),
            tier: 'COLLAB',
            label: `🎧 ${truncate(composer, 15)} × ${truncate(primaryArtist, 15)}`,
            count: 1,
        });
    } else if (composer) {
        // If composer is same as artist, search for composer's popular songs
        queries.push({
            query: `${composer} popular songs ${langTag}`.trim(),
            tier: 'COLLAB',
            label: `🎧 ${truncate(composer, 18)} Hit`,
            count: 1,
        });
    }

    // ── Tier 2: Same movie / album ──
    if (movieOrAlbum) {
        queries.push({
            query: `${movieOrAlbum} songs ${langTag}`.trim(),
            tier: 'MOVIE_ALBUM',
            label: `🎬 From ${truncate(movieOrAlbum, 18)}`,
            count: 1,
        });
    }

    // ── Tier 3: Same primary artist / singer ──
    if (primaryArtist) {
        queries.push({
            query: `${primaryArtist} hit songs ${langTag}`.trim(),
            tier: 'ARTIST',
            label: `🎤 By ${truncate(primaryArtist, 18)}`,
            count: 2,
        });
    }

    // ── Tier 4: Genre + language match ──
    const genreLabel = genre ? genre.charAt(0).toUpperCase() + genre.slice(1) : 'Popular';
    if (language) {
        const genreQuery = genre
            ? `${language} ${genre} songs hit`
            : `${language} trending songs`;
        queries.push({
            query: genreQuery,
            tier: 'GENRE',
            label: `🔥 ${language.charAt(0).toUpperCase() + language.slice(1)} ${genreLabel}`,
            count: 1,
        });
    } else {
        // Fallback: use song name to find similar vibes
        queries.push({
            query: `songs like ${songName}`,
            tier: 'GENRE',
            label: `🔥 Similar Vibe`,
            count: 1,
        });
    }

    // ── Tier 5: Regional discovery (trending) ──
    if (language && language !== 'english') {
        queries.push({
            query: `trending ${language} songs ${new Date().getFullYear()}`,
            tier: 'DISCOVERY',
            label: `✨ Trending ${language.charAt(0).toUpperCase() + language.slice(1)}`,
            count: 1,
        });
    } else if (secondaryArtist) {
        queries.push({
            query: `${secondaryArtist} best songs`,
            tier: 'DISCOVERY',
            label: `✨ By ${truncate(secondaryArtist, 18)}`,
            count: 1,
        });
    } else {
        queries.push({
            query: `trending music ${new Date().getFullYear()} hits`,
            tier: 'DISCOVERY',
            label: `✨ Discover`,
            count: 1,
        });
    }

    return queries;
}

// ══════════════════════════════════════════════════════════════════
//  DEDUPLICATION & SCORING
// ══════════════════════════════════════════════════════════════════

/**
 * Fuzzy title match — returns true if titles are too similar
 */
function isFuzzyDuplicate(titleA, titleB) {
    if (!titleA || !titleB) return false;
    const a = titleA.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const b = titleB.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (a === b) return true;
    if (a.length > 5 && b.length > 5) {
        if (a.includes(b) || b.includes(a)) return true;
    }
    return false;
}

// ══════════════════════════════════════════════════════════════════
//  MAIN RECOMMENDATION ENGINE
// ══════════════════════════════════════════════════════════════════

/**
 * Fetch 5 structured, high-relevance recommendations using YouTube-style
 * 5-tier weighted search with parallel queries and scoring.
 *
 * @param {Object} player - Lavalink player instance
 * @param {Object} currentTrack - Currently playing track
 * @param {number} limit - Max recommendations to return (default 5)
 * @param {Array} sessionHistory - Optional array of recently played tracks
 * @returns {Array} Array of recommended tracks with categoryLabel
 */
async function getRecommendations(player, currentTrack, limit = 5, sessionHistory = []) {
    if (!player || !currentTrack || !currentTrack.info) return [];

    const info = currentTrack.info;
    const rawTitle = info.title || '';
    const rawAuthor = info.author || '';

    // ── Step 1: Parse track metadata ──
    const meta = parseTrackMetadata(rawTitle, rawAuthor);
    const langGenre = detectLanguageAndGenre(rawTitle, rawAuthor);

    // ── Step 2: Build exclusion set (current + queue + recent session) ──
    const excludedIdentifiers = new Set();
    const excludedTitles = new Set();

    // Current track
    if (info.uri) excludedIdentifiers.add(info.uri);
    if (info.identifier) excludedIdentifiers.add(info.identifier);
    excludedTitles.add(rawTitle.toLowerCase());
    excludedTitles.add(meta.songName.toLowerCase());

    // Queued tracks
    if (player.queue && player.queue.tracks) {
        for (const t of player.queue.tracks) {
            if (t.info?.uri) excludedIdentifiers.add(t.info.uri);
            if (t.info?.identifier) excludedIdentifiers.add(t.info.identifier);
            if (t.info?.title) excludedTitles.add(t.info.title.toLowerCase());
        }
    }

    // Session history (prevent re-recommending songs already played)
    for (const t of sessionHistory) {
        if (t.info?.uri) excludedIdentifiers.add(t.info.uri);
        if (t.info?.identifier) excludedIdentifiers.add(t.info.identifier);
        if (t.info?.title) excludedTitles.add(t.info.title.toLowerCase());
    }

    // ── Step 3: Get search node ──
    const searchNode = player.node || (player.lavalinkManager?.nodeManager?.nodes?.values()?.next()?.value);
    if (!searchNode || !searchNode.connected) return [];

    // ── Step 4: Build 5-tier queries ──
    const queries = buildSearchQueries(meta, langGenre);

    // ── Step 5: Fire all searches in parallel ──
    const searchPromises = queries.map(async (q) => {
        try {
            const result = await searchNode.search({
                query: q.query,
                source: 'ytsearch',
            }, currentTrack.requester);

            return {
                tier: q.tier,
                label: q.label,
                count: q.count,
                tracks: result?.tracks || [],
            };
        } catch {
            return { tier: q.tier, label: q.label, count: q.count, tracks: [] };
        }
    });

    const results = await Promise.allSettled(searchPromises);

    // ── Step 6: Collect and deduplicate tracks ──
    const finalRecommendations = [];
    const addedTitles = new Set([...excludedTitles]);
    const addedIdentifiers = new Set([...excludedIdentifiers]);

    /**
     * Try to add a track to final list with dedup
     * Returns true if added, false if duplicate
     */
    function tryAdd(track, label) {
        if (!track || !track.info) return false;

        const uri = track.info.uri;
        const id = track.info.identifier;
        const titleLower = (track.info.title || '').toLowerCase();

        // Skip if already in queue or already recommended
        if (addedIdentifiers.has(uri) || addedIdentifiers.has(id)) return false;

        // Fuzzy title dedup
        for (const existing of addedTitles) {
            if (isFuzzyDuplicate(titleLower, existing)) return false;
        }

        // Skip very short tracks (likely intros/teasers) and very long ones (compilations/jukebox)
        const duration = track.info.duration || 0;
        if (duration > 0 && (duration < 60000 || duration > 900000)) return false; // < 1min or > 15min

        // Add it
        addedIdentifiers.add(uri);
        addedIdentifiers.add(id);
        addedTitles.add(titleLower);

        track.categoryLabel = label;
        track.isRecommendation = true;
        finalRecommendations.push(track);
        return true;
    }

    // Process results tier by tier — ensures variety (at least 1 per tier if available)
    for (const settled of results) {
        if (settled.status !== 'fulfilled') continue;
        const { label, count, tracks } = settled.value;

        let added = 0;
        for (const track of tracks) {
            if (added >= count) break;
            if (finalRecommendations.length >= limit) break;
            if (tryAdd(track, label)) added++;
        }
    }

    // ── Step 7: If we haven't filled all slots, do a second pass ──
    // Pull extra tracks from tiers that had more results
    if (finalRecommendations.length < limit) {
        for (const settled of results) {
            if (settled.status !== 'fulfilled') continue;
            if (finalRecommendations.length >= limit) break;
            const { label, tracks } = settled.value;

            for (const track of tracks) {
                if (finalRecommendations.length >= limit) break;
                tryAdd(track, label);
            }
        }
    }

    // ── Step 8: Apply session history boost ──
    // If user has been listening to a specific artist/composer, boost those recs to top
    if (sessionHistory.length >= 3 && finalRecommendations.length > 1) {
        const artistCounts = {};
        for (const t of sessionHistory) {
            const author = cleanAuthor(t.info?.author || '').toLowerCase();
            if (author) artistCounts[author] = (artistCounts[author] || 0) + 1;
        }

        // Find the most-listened artist in the session
        let topArtist = null;
        let topCount = 0;
        for (const [artist, count] of Object.entries(artistCounts)) {
            if (count > topCount) {
                topArtist = artist;
                topCount = count;
            }
        }

        // If a dominant artist exists (3+ plays), move their recs toward the top
        if (topArtist && topCount >= 3) {
            finalRecommendations.sort((a, b) => {
                const aMatch = (a.info?.author || '').toLowerCase().includes(topArtist) ? 1 : 0;
                const bMatch = (b.info?.author || '').toLowerCase().includes(topArtist) ? 1 : 0;
                return bMatch - aMatch;
            });
        }
    }

    return finalRecommendations.slice(0, limit);
}

// ══════════════════════════════════════════════════════════════════
//  AUTOPLAY-SPECIFIC RECOMMENDATION
// ══════════════════════════════════════════════════════════════════

/**
 * Get the best single track for autoplay, using full session history.
 * Smarter than just getRecommendations()[0]:
 *  - Analyzes the session to find dominant artist/genre
 *  - Avoids re-recommending tracks already played in the session
 *  - Falls back gracefully if no good match found
 *
 * @param {Object} player - Lavalink player
 * @param {Map} trackHistoryMap - client.trackHistory map
 * @returns {Object|null} The best track to autoplay, or null
 */
async function getAutoplayTrack(player, trackHistoryMap) {
    if (!player) return null;

    const guildId = player.guildId;
    const history = trackHistoryMap?.get(guildId) || [];
    const lastTrack = history[history.length - 1];

    if (!lastTrack) return null;

    // Get recommendations with full session context
    const recs = await getRecommendations(player, lastTrack, 5, history);
    if (!recs || recs.length === 0) return null;

    // Prefer a track from a different tier than what was just played
    // This prevents autoplay from getting stuck in a loop of same-artist songs
    const lastAuthor = cleanAuthor(lastTrack.info?.author || '').toLowerCase();

    // Try to find a rec from a different source first (variety)
    const differentAuthorRec = recs.find(r => {
        const recAuthor = cleanAuthor(r.info?.author || '').toLowerCase();
        return recAuthor !== lastAuthor;
    });

    // If we've played 3+ songs by the same artist, force variety
    const sameAuthorCount = history.filter(t =>
        cleanAuthor(t.info?.author || '').toLowerCase() === lastAuthor
    ).length;

    if (sameAuthorCount >= 3 && differentAuthorRec) {
        return differentAuthorRec;
    }

    // Otherwise, return the top recommendation
    return recs[0];
}

module.exports = {
    cleanSongTitle,
    parseTrackMetadata,
    detectLanguageAndGenre,
    getRecommendations,
    getAutoplayTrack,
};
