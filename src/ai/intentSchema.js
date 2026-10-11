/**
 * Strict Intent Schema & Sanitizer for Reso AI DJ
 */

const VALID_INTENTS = ['playlist', 'single_search', 'mood_playlist', 'artist_playlist', 'similar_track', 'discovery_playlist'];
const VALID_ENERGIES = ['low', 'medium', 'high', 'any'];
const VALID_DIVERSITIES = ['focused', 'balanced', 'varied'];

const DEFAULT_INTENT = {
    intent: 'mood_playlist',
    mood: 'chill',
    languages: [],
    genres: [],
    eras: [],
    energy: 'medium',
    artists: [],
    seedTracks: [],
    excludedTerms: [],
    trackCount: 10,
    diversity: 'balanced',
    summary: 'Curated music playlist',
};

/**
 * Sanitize and enforce constraints on raw intent input
 * @param {object} raw
 * @param {number} [overrideCount]
 * @returns {object} validated and sanitized intent
 */
function validateAndSanitizeIntent(raw, overrideCount = null) {
    if (!raw || typeof raw !== 'object') {
        return { ...DEFAULT_INTENT, trackCount: overrideCount || DEFAULT_INTENT.trackCount };
    }

    const intent = typeof raw.intent === 'string' && VALID_INTENTS.includes(raw.intent.toLowerCase())
        ? raw.intent.toLowerCase()
        : 'mood_playlist';

    const mood = typeof raw.mood === 'string' ? raw.mood.trim().slice(0, 50) : 'chill';

    const sanitizeStringArray = (arr, maxItems = 10, maxLen = 40) => {
        if (!Array.isArray(arr)) return [];
        return arr
            .filter(item => typeof item === 'string' && item.trim().length > 0)
            .map(item => item.trim().slice(0, maxLen))
            .slice(0, maxItems);
    };

    const languages = sanitizeStringArray(raw.languages, 5, 30);
    const genres = sanitizeStringArray(raw.genres, 8, 30);
    const eras = sanitizeStringArray(raw.eras, 5, 20);
    const artists = sanitizeStringArray(raw.artists, 10, 50);
    const seedTracks = sanitizeStringArray(raw.seedTracks, 5, 80);
    const excludedTerms = sanitizeStringArray(raw.excludedTerms, 10, 40);

    const energy = typeof raw.energy === 'string' && VALID_ENERGIES.includes(raw.energy.toLowerCase())
        ? raw.energy.toLowerCase()
        : 'medium';

    const diversity = typeof raw.diversity === 'string' && VALID_DIVERSITIES.includes(raw.diversity.toLowerCase())
        ? raw.diversity.toLowerCase()
        : 'balanced';

    // Bounded track count: 3 to 25
    let count = parseInt(overrideCount || raw.trackCount, 10);
    if (isNaN(count) || count < 3) count = 10;
    if (count > 25) count = 25;

    const summary = typeof raw.summary === 'string' && raw.summary.trim().length > 0
        ? raw.summary.trim().slice(0, 150)
        : `${mood ? mood + ' ' : ''}${genres.join('/') || 'music'} playlist`;

    return {
        intent,
        mood,
        languages,
        genres,
        eras,
        energy,
        artists,
        seedTracks,
        excludedTerms,
        trackCount: count,
        diversity,
        summary,
    };
}

const INTENT_JSON_SCHEMA = {
    type: 'object',
    properties: {
        intent: {
            type: 'string',
            enum: ['playlist', 'single_search', 'mood_playlist', 'artist_playlist', 'similar_track', 'discovery_playlist'],
            description: 'The overall purpose of the music request',
        },
        mood: {
            type: 'string',
            description: 'Primary emotional tone or vibe (e.g. chill, energetic, melancholic, romantic, focus)',
        },
        languages: {
            type: 'array',
            items: { type: 'string' },
            description: 'Music languages requested (e.g. Tamil, English, Hindi, Korean)',
        },
        genres: {
            type: 'array',
            items: { type: 'string' },
            description: 'Musical genres or styles (e.g. melody, lo-fi, rock, pop, hip-hop, acoustic)',
        },
        eras: {
            type: 'array',
            items: { type: 'string' },
            description: 'Eras or decades (e.g. 1990s, 2000s, 2010s, 80s, latest)',
        },
        energy: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'any'],
            description: 'Energy level appropriate for the vibe',
        },
        artists: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific artist or composer names explicitly mentioned or highly relevant',
        },
        seedTracks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Song titles mentioned as reference',
        },
        excludedTerms: {
            type: 'array',
            items: { type: 'string' },
            description: 'Terms, vibes, or genres explicitly excluded by the user (e.g. sad, romantic, slow)',
        },
        trackCount: {
            type: 'integer',
            minimum: 3,
            maximum: 25,
            description: 'Number of tracks to discover (default 10)',
        },
        diversity: {
            type: 'string',
            enum: ['focused', 'balanced', 'varied'],
            description: 'How diverse the playlist should be across artists/subgenres',
        },
        summary: {
            type: 'string',
            description: 'One concise line summarizing the DJ interpretation (under 80 characters)',
        },
        searchQueries: {
            type: 'array',
            items: { type: 'string' },
            description: '3 to 5 distinct search queries for Lavalink music search to retrieve candidates',
        },
    },
    required: ['intent', 'mood', 'languages', 'genres', 'trackCount', 'summary', 'searchQueries'],
};

module.exports = {
    VALID_INTENTS,
    VALID_ENERGIES,
    VALID_DIVERSITIES,
    DEFAULT_INTENT,
    validateAndSanitizeIntent,
    INTENT_JSON_SCHEMA,
};
