/**
 * Reso Smart Autoplay — Normalization & Duplicate Detection
 * Provides robust track canonicalization, fuzzy similarity, and exclusion checks.
 */

const { cleanVideoTitle, extractYouTubeVideoId } = require('../utils/helpers');

// Common suffixes and noise in YouTube / streaming titles
const TITLE_NOISE_PATTERNS = [
    /\s*[\|\-–—]\s*(official\s+)?(video|audio|music\s+video|lyric\s+video|lyrics?|full\s+song|full\s+video|hd|4k|remastered|visualizer|mv|audio\s+song).*/gi,
    /\((official\s+)?(video|audio|music\s+video|lyric\s+video|lyrics?|full\s+song|hd|4k|remastered|visualizer|mv)\)/gi,
    /\[(official\s+)?(video|audio|music\s+video|lyric\s+video|lyrics?|full\s+song|hd|4k|remastered|visualizer|mv)\]/gi,
    /\b(official\s+(music\s+)?video|official\s+audio|lyric\s+video|full\s+audio\s+song|4k\s+video)\b/gi,
];

// Legitimate music version indicators that should NOT be stripped when distinguishing versions
const VERSION_PATTERNS = {
    remix: /\b(remix|club\s+mix|extended\s+mix|vip\s+mix)\b/i,
    acoustic: /\b(acoustic|unplugged|piano\s+version|strings\s+version)\b/i,
    live: /\b(live(\s+at|\s+in|\s+performance)?|concert)\b/i,
    cover: /\b(cover|tribute)\b/i,
    instrumental: /\b(instrumental|karaoke|backing\s+track)\b/i,
    slowedReverb: /\b(slowed(\s+\+)?\s+reverb|lofi\s+remix)\b/i,
    radioEdit: /\b(radio\s+edit|radio\s+version)\b/i,
};

/**
 * Normalize track title by removing noise while preserving key version tags
 * @param {string} rawTitle 
 * @returns {string}
 */
function normalizeTitle(rawTitle) {
    if (!rawTitle || typeof rawTitle !== 'string') return '';
    let title = cleanVideoTitle(rawTitle);

    for (const pattern of TITLE_NOISE_PATTERNS) {
        title = title.replace(pattern, ' ');
    }

    // Retain version identifiers if present
    const versionTags = [];
    for (const [key, regex] of Object.entries(VERSION_PATTERNS)) {
        if (regex.test(rawTitle)) {
            versionTags.push(`[${key}]`);
        }
    }

    // Clean punctuation and whitespace
    title = title
        .toLowerCase()
        .replace(/[^\w\s\u00C0-\u024F\u0900-\u0D7F]/gi, ' ') // Allow unicode scripts (Tamil, Telugu, Hindi, etc.)
        .replace(/\s+/g, ' ')
        .trim();

    if (versionTags.length > 0) {
        return `${title} ${versionTags.join(' ')}`.trim();
    }
    return title;
}

/**
 * Normalize artist / channel name
 * @param {string} rawArtist 
 * @returns {string}
 */
function normalizeArtist(rawArtist) {
    if (!rawArtist || typeof rawArtist !== 'string') return '';
    return rawArtist
        .toLowerCase()
        .replace(/\s*-\s*topic$/i, '') // YouTube auto-generated artist topic channels
        .replace(/\s*(vevo|official|records|channel|music|audio)$/i, '')
        .replace(/[^\w\s\u00C0-\u024F\u0900-\u0D7F]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extract canonical track identifier (YouTube video ID, Spotify ID, or URI)
 * @param {object} trackInfo 
 * @returns {string}
 */
function getCanonicalIdentifier(trackInfo) {
    if (!trackInfo) return '';
    if (trackInfo.identifier && !trackInfo.identifier.includes('http') && !trackInfo.identifier.includes('/')) {
        return String(trackInfo.identifier).trim();
    }
    if (trackInfo.uri) {
        const ytId = extractYouTubeVideoId(trackInfo.uri);
        if (ytId) return ytId;
        return trackInfo.uri.toLowerCase().trim();
    }
    return trackInfo.identifier ? String(trackInfo.identifier).toLowerCase().trim() : '';
}

/**
 * Extract canonical URL for a track
 * @param {object} trackInfo 
 * @returns {string}
 */
function getCanonicalUrl(trackInfo) {
    if (!trackInfo) return '';
    const id = getCanonicalIdentifier(trackInfo);
    if (id && !id.includes('/') && !id.includes('?') && !id.includes(':')) {
        return `https://www.youtube.com/watch?v=${id}`;
    }
    if (trackInfo.uri) {
        try {
            const parsed = new URL(trackInfo.uri);
            const vParam = parsed.searchParams.get('v');
            if (vParam) {
                return `https://www.youtube.com/watch?v=${vParam}`;
            }
            return `${parsed.origin}${parsed.pathname}`.toLowerCase();
        } catch {
            return trackInfo.uri.toLowerCase().trim();
        }
    }
    return '';
}

/**
 * Calculate Levenshtein similarity ratio between two strings (0 to 1)
 * @param {string} s1 
 * @param {string} s2 
 * @returns {number}
 */
function stringSimilarity(s1, s2) {
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;

    const longer = s1.length >= s2.length ? s1 : s2;
    const shorter = s1.length < s2.length ? s1 : s2;
    if (longer.length === 0) return 1.0;

    // Fast check for substring containment
    if (longer.includes(shorter) && shorter.length / longer.length > 0.8) {
        return shorter.length / longer.length;
    }

    const costs = [];
    for (let i = 0; i <= longer.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= shorter.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else if (j > 0) {
                let newValue = costs[j - 1];
                if (longer.charAt(i - 1) !== shorter.charAt(j - 1)) {
                    newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) costs[shorter.length] = lastValue;
    }

    return (longer.length - costs[shorter.length]) / longer.length;
}

/**
 * Determine if candidate is a duplicate of a reference track
 * Evaluates: exact video ID, canonical URL, normalized title + artist, and conservative similarity.
 * Preserves distinct legitimate versions (e.g. Acoustic, Live, Remix).
 * @param {object} candidateInfo 
 * @param {object} referenceInfo 
 * @returns {boolean}
 */
function isTrackDuplicate(candidateInfo, referenceInfo) {
    if (!candidateInfo || !referenceInfo) return false;

    // 1. Exact Video ID / Canonical Identifier Match
    const candId = getCanonicalIdentifier(candidateInfo);
    const refId = getCanonicalIdentifier(referenceInfo);
    if (candId && refId && candId === refId) {
        return true;
    }

    // 2. Canonical URL Match
    const candUrl = getCanonicalUrl(candidateInfo);
    const refUrl = getCanonicalUrl(referenceInfo);
    if (candUrl && refUrl && candUrl === refUrl) {
        return true;
    }

    // 3. Normalized Title and Artist Comparison
    const candNormTitle = normalizeTitle(candidateInfo.title);
    const refNormTitle = normalizeTitle(referenceInfo.title);
    if (!candNormTitle || !refNormTitle) return false;

    // If version tags differ (e.g. one has [remix] or [live] and the other does not), they are NOT duplicates!
    const candHasVersion = /\[(remix|acoustic|live|cover|instrumental|slowedreverb)\]/i.test(candNormTitle);
    const refHasVersion = /\[(remix|acoustic|live|cover|instrumental|slowedreverb)\]/i.test(refNormTitle);
    if (candHasVersion !== refHasVersion) {
        return false;
    }

    const candNormArtist = normalizeArtist(candidateInfo.author);
    const refNormArtist = normalizeArtist(referenceInfo.author);

    // Exact normalized title match
    if (candNormTitle === refNormTitle) {
        // If authors match or either author is unknown/contained, it's a duplicate
        if (!candNormArtist || !refNormArtist || candNormArtist === refNormArtist ||
            candNormArtist.includes(refNormArtist) || refNormArtist.includes(candNormArtist)) {
            return true;
        }
    }

    // High fuzzy similarity check on titles (> 0.88)
    const titleSim = stringSimilarity(candNormTitle, refNormTitle);
    if (titleSim > 0.88) {
        if (!candNormArtist || !refNormArtist || candNormArtist === refNormArtist ||
            candNormArtist.includes(refNormArtist) || refNormArtist.includes(candNormArtist)) {
            return true;
        }
    }

    return false;
}

/**
 * Check if candidate track matches any track in an exclusion collection
 * @param {object} candidateTrack 
 * @param {Array<object>|Set<string>} exclusions 
 * @returns {boolean}
 */
function isExcluded(candidateTrack, exclusions) {
    if (!candidateTrack?.info || !exclusions) return false;
    const candInfo = candidateTrack.info;
    const candId = getCanonicalIdentifier(candInfo);

    if (exclusions instanceof Set) {
        return exclusions.has(candId) || (candInfo.uri && exclusions.has(candInfo.uri.toLowerCase()));
    }

    if (Array.isArray(exclusions)) {
        for (const item of exclusions) {
            const refInfo = item?.info || item;
            if (isTrackDuplicate(candInfo, refInfo)) {
                return true;
            }
        }
    }

    return false;
}

module.exports = {
    normalizeTitle,
    normalizeArtist,
    getCanonicalIdentifier,
    getCanonicalUrl,
    stringSimilarity,
    isTrackDuplicate,
    isExcluded,
    VERSION_PATTERNS,
};
