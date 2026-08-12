const { truncate } = require('./helpers');

// Known publisher / record label patterns to filter out YouTube channel names
const PUBLISHER_REGEX = /(vevo|t-series|tseries|sony|saregama|speed audio|think music|aditya music|lahari|tips|yrf|zee music|rajshri|venus|wave music|eros|goldmines|sainath|sun tv|star music|muzik247|dvo|records|recordings|music company|music india|entertainment|media|production|official channel|regional)/i;

// Words to strip from title parts to clean song, movie, actor, and artist names
const JUNK_TITLE_WORDS = /\b(official|music|video|audio|lyric|lyrics|full song|hd|4k|1080p|remastered|visualizer|status|shorts|song|songs|video song|lyric video|4k video|uhd|teaser|trailer)\b/gi;

/**
 * Clean string by removing bracketed info and junk video words
 */
function cleanString(str = '') {
    if (!str) return '';
    return str
        .replace(/[\(\[\{].*?[\)\]\}]/g, '') // remove (Official Video), [HD], etc.
        .replace(JUNK_TITLE_WORDS, '')       // remove "Video Song", "Lyric", etc.
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Clean track title helper
 */
function cleanSongTitle(title = '') {
    const firstPart = title.split(/\||-|\//)[0] || title;
    return cleanString(firstPart);
}

/**
 * Dynamically & intelligently extract song title, movie/album name, actor/feature, and real singer/artist
 * Filters out publisher channel names (T-Series, Sony Music, VEVO, etc.) and title junk words.
 */
function parseTrackMetadata(title = '', author = '') {
    const rawParts = title.split(/\||-|\//).map(p => p.trim()).filter(Boolean);
    const cleanAuth = author ? author.replace(/ - Topic$/i, '').trim() : '';

    const isPublisher = PUBLISHER_REGEX.test(cleanAuth);
    let realArtist = isPublisher ? null : cleanAuth;

    // Filter parts to remove pure metadata strings
    const cleanedParts = rawParts
        .map(p => cleanString(p))
        .filter(p => p.length > 1 && !/^(official|video|audio|lyric|hd|4k)$/i.test(p));

    const songName = cleanedParts[0] || cleanString(title);
    let movieName = null;
    let actorOrFeature = null;

    for (let i = 1; i < cleanedParts.length; i++) {
        const part = cleanedParts[i];
        if (!part || part.toLowerCase() === songName.toLowerCase()) continue;

        const rawPart = rawParts[i] || '';

        // Movie / Album detection
        if (!movieName && /(movie|film|album|ost|jukebox|soundtrack)/i.test(rawPart)) {
            movieName = part;
        } else if (!movieName && i === 1 && part.length < 30) {
            movieName = part;
        } else if (!realArtist && i >= 1) {
            realArtist = part;
        } else if (!actorOrFeature && i >= 1 && part !== realArtist) {
            actorOrFeature = part;
        }
    }

    // Fallbacks
    if (!movieName) movieName = songName;
    if (!realArtist) realArtist = cleanAuth && !isPublisher ? cleanAuth : songName;
    if (!actorOrFeature) actorOrFeature = realArtist;

    return {
        songName,
        movieName,
        artistName: realArtist,
        actorOrFeature,
    };
}

/**
 * Fetch 5 structured, high-relevance recommendations:
 * 1. Same Movie / Album (1 song)
 * 2. Same Singer / Main Artist (2 songs)
 * 3. Actor / Featured Artist Other Songs (1 song)
 * 4. Random Unrelated Discovery Song (1 song)
 */
async function getRecommendations(player, currentTrack, limit = 5) {
    if (!player || !currentTrack || !currentTrack.info) return [];

    const info = currentTrack.info;
    const rawTitle = info.title || '';
    const rawAuthor = info.author || '';
    const meta = parseTrackMetadata(rawTitle, rawAuthor);

    const existingIdentifiers = new Set();
    if (info.uri) existingIdentifiers.add(info.uri);
    if (info.identifier) existingIdentifiers.add(info.identifier);

    if (player.queue && player.queue.tracks) {
        for (const t of player.queue.tracks) {
            if (t.info?.uri) existingIdentifiers.add(t.info.uri);
            if (t.info?.identifier) existingIdentifiers.add(t.info.identifier);
        }
    }

    const recommendedTitles = new Set([rawTitle.toLowerCase(), meta.songName.toLowerCase()]);
    const finalRecommendations = [];

    /**
     * Helper to search and push unique track to results
     */
    async function fetchUniqueTrack(query, categoryLabel, count = 1) {
        let added = 0;
        try {
            const searchResult = await player.search({
                query: query,
                source: 'ytsearch',
            }, currentTrack.requester);

            if (!searchResult || !searchResult.tracks) return added;

            for (const track of searchResult.tracks) {
                if (added >= count) break;
                if (!track || !track.info) continue;

                const trackUri = track.info.uri;
                const trackId = track.info.identifier;
                const titleLower = (track.info.title || '').toLowerCase();

                if (existingIdentifiers.has(trackUri) || existingIdentifiers.has(trackId)) continue;
                if (recommendedTitles.has(titleLower)) continue;

                const isDuplicate = Array.from(recommendedTitles).some(existing =>
                    titleLower.includes(existing) || existing.includes(titleLower)
                );
                if (isDuplicate) continue;

                existingIdentifiers.add(trackUri);
                existingIdentifiers.add(trackId);
                recommendedTitles.add(titleLower);

                track.categoryLabel = categoryLabel;
                track.isRecommendation = true;
                finalRecommendations.push(track);
                added++;
            }
        } catch (e) {
            console.log(`[Reso Recommendations] Category "${categoryLabel}" search error:`, e.message);
        }
        return added;
    }

    // 1. Same Movie / Album (1 song)
    if (meta.movieName && meta.movieName !== meta.songName) {
        const movieQuery = `${meta.movieName} movie song`;
        await fetchUniqueTrack(movieQuery, `🎬 From ${truncate(meta.movieName, 18)}`, 1);
    } else {
        const vibeQuery = `${meta.songName} ${meta.artistName} song`;
        await fetchUniqueTrack(vibeQuery, '🔥 Similar Vibe', 1);
    }

    // 2. Same Singer / Main Artist (2 songs)
    const singerQuery = `${meta.artistName} hit songs`;
    await fetchUniqueTrack(singerQuery, `🎤 By ${truncate(meta.artistName, 18)}`, 2);

    // 3. Actor or Featured Artist Other Songs (1 song)
    if (meta.actorOrFeature && meta.actorOrFeature !== meta.artistName) {
        const actorQuery = `${meta.actorOrFeature} hit songs`;
        await fetchUniqueTrack(actorQuery, `🎭 Starring ${truncate(meta.actorOrFeature, 16)}`, 1);
    } else {
        const similarQuery = `${meta.artistName} famous songs`;
        await fetchUniqueTrack(similarQuery, '🎧 Similar Artist', 1);
    }

    // 4. Random Unrelated Discovery Song (1 song)
    const randomPool = [
        'top global viral hits 2026',
        'trending acoustic chill hits',
        'popular retro classic hits',
        'top party dance hits',
        'trending ambient relaxing music'
    ];
    const randomQuery = randomPool[Math.floor(Math.random() * randomPool.length)];
    await fetchUniqueTrack(randomQuery, '🎲 Random Discovery', 1);

    // Fallback if any category returned fewer tracks than 5 total
    if (finalRecommendations.length < limit) {
        const remainingNeeded = limit - finalRecommendations.length;
        await fetchUniqueTrack(`${meta.artistName} top songs`, '🎵 Related Track', remainingNeeded);
    }

    return finalRecommendations.slice(0, limit);
}

module.exports = {
    cleanSongTitle,
    parseTrackMetadata,
    getRecommendations,
};
