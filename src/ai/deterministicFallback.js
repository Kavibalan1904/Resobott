/**
 * Deterministic (Non-AI) Fallback Engine for Reso DJ
 * Parses natural-language requests when AI is disabled, unconfigured, or failing.
 */

const { validateAndSanitizeIntent } = require('./intentSchema');

// Known vocabulary dictionaries
const KNOWN_LANGUAGES = [
    { pattern: /\b(tamil|kollywood|kuthu|gaana)\b/i, label: 'Tamil' },
    { pattern: /\b(hindi|bollywood|desi)\b/i, label: 'Hindi' },
    { pattern: /\b(telugu|tollywood)\b/i, label: 'Telugu' },
    { pattern: /\b(malayalam|mollywood)\b/i, label: 'Malayalam' },
    { pattern: /\b(kannada|sandalwood)\b/i, label: 'Kannada' },
    { pattern: /\benglish\b/i, label: 'English' },
    { pattern: /\bkorean|kpop|k-pop\b/i, label: 'Korean' },
    { pattern: /\bjapanese|jpop|j-pop|anime\b/i, label: 'Japanese' },
    { pattern: /\bpunjabi|bhangra\b/i, label: 'Punjabi' },
    { pattern: /\bspanish|latino\b/i, label: 'Spanish' },
    { pattern: /\bfrench\b/i, label: 'French' },
    { pattern: /\bgerman\b/i, label: 'German' },
    { pattern: /\barabic\b/i, label: 'Arabic' },
    { pattern: /\b(chinese|cpop|mandopop)\b/i, label: 'Chinese' },
];

const KNOWN_ERAS = [
    { pattern: /\b(19)?90s?\b|\bnineties\b/i, label: '1990s' },
    { pattern: /\b(20)?00s?\b|\b2000s?\b|\btwo thousands\b/i, label: '2000s' },
    { pattern: /\b(20)?10s?\b|\b2010s?\b/i, label: '2010s' },
    { pattern: /\b(19)?80s?\b|\beighties\b/i, label: '1980s' },
    { pattern: /\b(20)?20s?\b|\b2020s?\b/i, label: '2020s' },
    { pattern: /\b(retro|golden era|vintage|classics?|oldies?)\b/i, label: 'retro' },
    { pattern: /\b(latest|new|trending|recent)\b/i, label: 'latest' },
];

const KNOWN_MOODS = [
    { pattern: /\b(relaxing|calm|peaceful|soothing|chill|chillout|unwind)\b/i, label: 'chill', energy: 'low' },
    { pattern: /\b(energetic|hype|pump(ed)?|workout|gym|running|beast|mass|kuthu)\b/i, label: 'energetic', energy: 'high' },
    { pattern: /\b(gaming|ranked|esports|competitive)\b/i, label: 'gaming', energy: 'high' },
    { pattern: /\b(nostalgic|memories|throwback|childhood)\b/i, label: 'nostalgic', energy: 'medium' },
    { pattern: /\b(late[- ]night|midnight|night drive|insomnia)\b/i, label: 'late-night', energy: 'low' },
    { pattern: /\b(sad|melancholic|heartbroken|emotional|crying|breakup)\b/i, label: 'melancholic', energy: 'low' },
    { pattern: /\b(romantic|love|crush|date night)\b/i, label: 'romantic', energy: 'medium' },
    { pattern: /\b(happy|cheerful|feel[- ]good|upbeat|joyful)\b/i, label: 'upbeat', energy: 'high' },
    { pattern: /\b(party|dance|club|festival)\b/i, label: 'party', energy: 'high' },
    { pattern: /\b(focus|study|coding|work|reading)\b/i, label: 'focus', energy: 'low' },
    { pattern: /\b(sleep|sleeping|bedtime)\b/i, label: 'sleep', energy: 'low' },
];

const KNOWN_GENRES = [
    { pattern: /\b(melod(y|ies)|melodious)\b/i, label: 'melody' },
    { pattern: /\b(kuthu|gaana|folk)\b/i, label: 'folk' },
    { pattern: /\b(soundtrack|ost|bgm|score|theme)\b/i, label: 'soundtrack' },
    { pattern: /\b(indie|indie pop|indie rock)\b/i, label: 'indie' },
    { pattern: /\b(lo[- ]?fi|lofi)\b/i, label: 'lo-fi' },
    { pattern: /\b(hip[- ]?hop|rap)\b/i, label: 'hip-hop' },
    { pattern: /\b(edm|electronic|house|techno)\b/i, label: 'edm' },
    { pattern: /\b(rock|metal|punk)\b/i, label: 'rock' },
    { pattern: /\b(pop)\b/i, label: 'pop' },
    { pattern: /\b(acoustic|unplugged)\b/i, label: 'acoustic' },
    { pattern: /\b(phonk)\b/i, label: 'phonk' },
    { pattern: /\b(synthwave|vaporwave)\b/i, label: 'synthwave' },
    { pattern: /\b(r&b|soul)\b/i, label: 'r&b' },
    { pattern: /\b(country)\b/i, label: 'country' },
    { pattern: /\b(classical|carnatic|hindustani)\b/i, label: 'classical' },
    { pattern: /\b(instrumental|ambient)\b/i, label: 'instrumental' },
    { pattern: /\b(qawwali|ghazal|sufi)\b/i, label: 'sufi' },
];

/**
 * Extract excluded terms using regex matching (e.g. "without sad songs", "no romance", "exclude hiphop")
 */
function extractExclusions(text) {
    const exclusions = [];
    const negativePatterns = [
        /(?:without|no|except|not|exclude|excluding)\s+([\w\s]+?)(?:songs|tracks|music|\band\b|\bwith\b|\.|$|,)/gi,
        /(?:without|no|exclude)\s+([a-zA-Z0-9_-]+)/gi,
    ];

    for (const pat of negativePatterns) {
        let match;
        while ((match = pat.exec(text)) !== null) {
            const term = match[1]?.trim();
            if (term && term.length > 2 && !['a', 'the', 'any', 'some', 'tracks', 'songs'].includes(term.toLowerCase())) {
                exclusions.push(term);
            }
        }
    }
    return [...new Set(exclusions)];
}

/**
 * Extract requested count from text (e.g., "15 songs", "create a 12-track playlist")
 */
function extractCount(text) {
    const match = text.match(/\b(\d{1,2})\s*[- ]?(?:songs?|tracks?|items?)\b/i);
    if (match) {
        const count = parseInt(match[1], 10);
        if (!isNaN(count) && count >= 3 && count <= 25) return count;
    }
    return null;
}

/**
 * Capitalize first letter of each word
 */
function capitalizeWords(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Extract subject information (movie, soundtrack, album, artist) from user input
 */
function extractSubjectInfo(text, positiveText) {
    const raw = String(positiveText || text || '').trim();
    if (!raw) return null;

    // 1. Movie / Film patterns:
    // e.g. "karuppu movie songs", "leo movie songs", "vikram movie soundtrack"
    const moviePrefixMatch = raw.match(/^(.+?)\s+(?:movie|film|cinema)\s*(?:songs?|tracks?|soundtrack|ost|music|audio)?$/i);
    if (moviePrefixMatch && moviePrefixMatch[1]) {
        const title = moviePrefixMatch[1].trim();
        if (title.length >= 2 && !['a', 'the', 'any', 'good', 'best', 'popular', 'new'].includes(title.toLowerCase())) {
            return {
                type: 'movie',
                title,
                isMovie: true,
                isSoundtrack: true,
            };
        }
    }

    const fromMovieMatch = raw.match(/\b(?:songs?|music|soundtrack|ost|score|theme|tracks?)\s+(?:from|of)\s+(?:the\s+)?(?:movie\s+|film\s+)?([a-zA-Z0-9\s'’-]+)/i);
    if (fromMovieMatch && fromMovieMatch[1]) {
        const title = fromMovieMatch[1].replace(/\b(movie|film|cinema)\b/gi, '').trim();
        if (title.length >= 2) {
            return {
                type: 'movie',
                title,
                isMovie: true,
                isSoundtrack: true,
            };
        }
    }

    // 2. Soundtrack / OST / Album patterns:
    // e.g. "interstellar soundtrack", "attack on titan ost"
    const ostMatch = raw.match(/^(.+?)\s+(?:soundtrack|ost|score|album)\s*(?:songs?|tracks?|music)?$/i);
    if (ostMatch && ostMatch[1]) {
        const title = ostMatch[1].trim();
        if (title.length >= 2 && !['movie', 'film', 'game', 'anime'].includes(title.toLowerCase())) {
            return {
                type: 'soundtrack',
                title,
                isMovie: false,
                isSoundtrack: true,
            };
        }
    }

    // 3. Artist patterns:
    // e.g. "by anirudh", "songs by taylor swift", "anirudh hits"
    const byArtistMatch = raw.match(/\b(?:songs?|music|tracks?|hits?)\s+by\s+([a-zA-Z0-9\s'’-]+)/i);
    if (byArtistMatch && byArtistMatch[1]) {
        const artist = byArtistMatch[1].trim();
        if (artist.length >= 2) {
            return {
                type: 'artist',
                artist,
            };
        }
    }

    // 4. "<SpecificTitle> songs" pattern where title is not purely a language, era, or mood
    const songsMatch = raw.match(/^(.+?)\s+(?:songs?|tracks?|music|hits?)$/i);
    if (songsMatch && songsMatch[1]) {
        const candidate = songsMatch[1].trim();
        const candidateLower = candidate.toLowerCase();
        const isLang = KNOWN_LANGUAGES.some(l => l.pattern.test(candidateLower) && candidateLower.replace(l.pattern, '').trim().length === 0);
        const isGenre = KNOWN_GENRES.some(g => g.pattern.test(candidateLower) && candidateLower.replace(g.pattern, '').trim().length === 0);
        const isMood = KNOWN_MOODS.some(m => m.pattern.test(candidateLower) && candidateLower.replace(m.pattern, '').trim().length === 0);
        const isEra = KNOWN_ERAS.some(e => e.pattern.test(candidateLower) && candidateLower.replace(e.pattern, '').trim().length === 0);

        if (!isLang && !isGenre && !isMood && !isEra && candidate.length >= 2) {
            return {
                type: 'subject',
                title: candidate,
            };
        }
    }

    return null;
}

/**
 * Parse natural language request into intent without calling an AI API
 * @param {string} rawRequest
 * @param {number} [overrideCount]
 * @param {object} [context] Current track info, if any
 * @returns {object} validated intent with searchQueries
 */
function parseDeterministicRequest(rawRequest = '', overrideCount = null, context = null) {
    const text = String(rawRequest || '').trim();
    // 1. Extract Exclusions first and create positiveText without negative clauses
    const excludedTerms = extractExclusions(text);
    let positiveText = text;
    const negativePatterns = [
        /(?:without|no|except|not|exclude|excluding)\s+([\w\s]+?)(?:songs|tracks|music|\band\b|\bwith\b|\.|$|,)/gi,
        /(?:without|no|exclude)\s+([a-zA-Z0-9_-]+)/gi,
    ];
    for (const pat of negativePatterns) {
        positiveText = positiveText.replace(pat, ' ');
    }

    // 2. Check for similar-to-track intent
    const isSimilarTrack = /\b(similar to|like (this|the current)|more like this|based on current)\b/i.test(positiveText);

    // 3. Extract Languages from positiveText
    const languages = [];
    for (const lang of KNOWN_LANGUAGES) {
        if (lang.pattern.test(positiveText)) {
            languages.push(lang.label);
        }
    }

    // 4. Extract Eras from positiveText
    const eras = [];
    for (const era of KNOWN_ERAS) {
        if (era.pattern.test(positiveText)) {
            eras.push(era.label);
        }
    }

    // 5. Extract Mood & Energy from positiveText
    let mood = 'chill';
    let energy = 'medium';
    let moodExplicitlyFound = false;
    for (const m of KNOWN_MOODS) {
        if (m.pattern.test(positiveText)) {
            mood = m.label;
            energy = m.energy;
            moodExplicitlyFound = true;
            break;
        }
    }

    // 6. Extract Genres from positiveText
    const genres = [];
    for (const g of KNOWN_GENRES) {
        if (g.pattern.test(positiveText)) {
            genres.push(g.label);
        }
    }

    // 7. Track Count
    const detectedCount = extractCount(text);
    const finalCount = overrideCount || detectedCount || 10;

    // 8. Extract Subject Info (movie, soundtrack, album, artist)
    const subjectInfo = extractSubjectInfo(text, positiveText);

    // 9. Determine Intent Type & Summary
    let intentType = 'mood_playlist';
    let summary = '';

    if (isSimilarTrack) {
        intentType = 'similar_track';
        summary = context?.title ? `Tracks similar to ${context.title}` : 'Similar Music Vibe';
    } else if (subjectInfo?.isMovie) {
        intentType = 'playlist';
        if (!moodExplicitlyFound) mood = 'soundtrack';
        if (!genres.includes('soundtrack')) genres.push('soundtrack');
        summary = `${capitalizeWords(subjectInfo.title)} Movie Songs Playlist`;
    } else if (subjectInfo?.type === 'soundtrack') {
        intentType = 'playlist';
        if (!moodExplicitlyFound) mood = 'soundtrack';
        if (!genres.includes('soundtrack')) genres.push('soundtrack');
        summary = `${capitalizeWords(subjectInfo.title)} Soundtrack Playlist`;
    } else if (subjectInfo?.artist) {
        intentType = 'artist_playlist';
        summary = `Best of ${capitalizeWords(subjectInfo.artist)}`;
    } else if (subjectInfo?.title) {
        intentType = 'playlist';
        summary = `${capitalizeWords(subjectInfo.title)} Music Vibe`;
    } else if (/\b(discover|fresh|hidden gems?|underground)\b/i.test(text)) {
        intentType = 'discovery_playlist';
        summary = `${languages.join(', ') || 'Fresh'} Discovery Vibe`;
    } else if (/\b(by|artist|singer|band)\b/i.test(text) && genres.length === 0) {
        intentType = 'artist_playlist';
        summary = 'Artist Music Vibe';
    } else {
        const langStr = languages.join(', ');
        const genreStr = genres.join(' ');
        const eraStr = eras.join(' ');
        summary = [
            mood.toUpperCase(),
            langStr,
            eraStr,
            genreStr || 'Music',
            'Vibe',
        ].filter(Boolean).join(' ');
    }

    // 10. Generate targeted search queries
    const searchQueries = buildQueries({
        languages,
        genres,
        eras,
        mood,
        energy,
        text,
        isSimilarTrack,
        context,
        subjectInfo,
    });

    const rawIntent = {
        intent: intentType,
        mood,
        languages,
        genres,
        eras,
        energy,
        artists: subjectInfo?.artist ? [subjectInfo.artist] : [],
        seedTracks: context?.title ? [context.title] : [],
        excludedTerms,
        trackCount: finalCount,
        diversity: 'balanced',
        summary: summary.slice(0, 80),
        searchQueries,
    };

    const sanitized = validateAndSanitizeIntent(rawIntent, finalCount);
    sanitized.searchQueries = searchQueries;
    return sanitized;
}

/**
 * Generate 3 to 5 realistic search queries combining extracted intent tokens
 */
function buildQueries({ languages, genres, eras, mood, energy, text, isSimilarTrack, context, subjectInfo }) {
    const queries = [];
    const lang = languages[0] || '';
    const genre = genres[0] || '';
    const era = eras[0] || '';

    // If request was similar to track and we have current track info
    if (isSimilarTrack && context) {
        if (context.author && context.title) {
            queries.push(`${context.author} top hits`);
            queries.push(`songs like ${context.title} ${context.author}`);
        }
        if (context.title) {
            queries.push(`${context.title} audio`);
        }
    }

    // 1. Movie / Soundtrack / Artist specific queries
    if (subjectInfo?.isMovie) {
        const m = subjectInfo.title;
        queries.push(`${m} movie songs`);
        queries.push(`${m} songs`);
        queries.push(`${m} audio songs`);
        queries.push(`${m} movie soundtrack`);
        if (mood && mood !== 'chill' && mood !== 'soundtrack') {
            queries.push(`${m} ${mood} songs`);
        }
    } else if (subjectInfo?.type === 'soundtrack') {
        const s = subjectInfo.title;
        queries.push(`${s} soundtrack`);
        queries.push(`${s} ost`);
        queries.push(`${s} songs`);
        queries.push(`${s} score`);
    } else if (subjectInfo?.artist) {
        const a = subjectInfo.artist;
        queries.push(`${a} hit songs`);
        queries.push(`${a} best songs`);
        queries.push(mood && mood !== 'chill' ? `${a} ${mood} songs` : `${a} top tracks`);
        if (genre) queries.push(`${a} ${genre} songs`);
    } else if (subjectInfo?.title) {
        const t = subjectInfo.title;
        queries.push(`${t} songs`);
        queries.push(`${t} music`);
        if (lang) queries.push(`${lang} ${t} songs`);
        if (mood && mood !== 'chill') queries.push(`${t} ${mood} songs`);
    } else {
        // Specific combinations
        if (lang && era && genre) {
            queries.push(`${lang} ${era} ${genre} hits`);
            queries.push(`best ${lang} ${genre} songs ${era}`);
            queries.push(`${lang} ${era} melodies collection`);
        } else if (lang && genre) {
            queries.push(`${lang} ${genre} songs`);
            queries.push(`best ${lang} ${genre} playlist`);
            queries.push(`${lang} ${mood} ${genre}`);
        } else if (lang && era) {
            queries.push(`${lang} ${era} hit songs`);
            queries.push(`golden ${lang} songs ${era}`);
            queries.push(`${lang} ${era} classics`);
        } else if (lang && mood) {
            queries.push(`${lang} ${mood} songs playlist`);
            queries.push(`relaxing ${lang} hits`);
            queries.push(`${lang} ${mood} music`);
        } else if (mood === 'gaming') {
            queries.push('gaming music ranked mix');
            queries.push('hype gaming playlist edm phonk');
            queries.push('electronic gaming tracks');
        } else if (genre) {
            queries.push(`${genre} music playlist`);
            queries.push(`best ${genre} songs`);
            queries.push(`${mood} ${genre} tracks`);
        } else if (mood && mood !== 'chill') {
            queries.push(`${mood} music playlist`);
            queries.push(`best ${mood} songs`);
        }
    }

    // Add a sanitized version of the user's prompt if queries are sparse
    const cleanedRaw = text
        .replace(/\b(play|make|give me|create|find|a|the|playlist|for)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (cleanedRaw && cleanedRaw.length > 2 && !queries.includes(cleanedRaw)) {
        if (subjectInfo) {
            // Put cleaned user prompt near the top
            queries.splice(1, 0, cleanedRaw);
        } else {
            queries.push(cleanedRaw);
        }
    }

    // Deduplicate and bound to 4 queries max
    const unique = [...new Set(queries.map(q => q.trim()).filter(Boolean))].slice(0, 4);

    if (unique.length === 0) {
        unique.push('popular music hits', 'top chill songs');
    }

    return unique;
}

module.exports = {
    parseDeterministicRequest,
    buildQueries,
    extractExclusions,
    extractCount,
    KNOWN_LANGUAGES,
    KNOWN_MOODS,
    KNOWN_GENRES,
    KNOWN_ERAS,
};
