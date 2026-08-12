const { truncate } = require('./helpers');

/**
 * Clean track title by removing video tags like (Official Video), [HD], etc.
 */
function cleanSongTitle(title = '') {
    return title
        .replace(/\s*[\(\[\{](official|music|video|audio|lyric|hd|4k|remastered|full|visualizer).*?[\)\]\}]/gi, '')
        .replace(/\s*ft\.?.*$/gi, '')
        .replace(/\s*feat\.?.*$/gi, '')
        .replace(/\|.*$/g, '')
        .trim();
}

/**
 * Extract movie name, actor name, and singer name from track title and author
 */
function parseTrackMetadata(title = '', author = '') {
    const parts = title.split('|').map(p => p.trim()).filter(Boolean);
    const cleanAuth = author ? author.replace(/ - Topic$/i, '').trim() : '';

    let songName = cleanSongTitle(parts[0] || title);
    let movieName = null;
    let actorName = null;

    // Inspect title parts for movie name or actor name
    for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        if (!movieName && /(movie|album|ost|film|jukebox|soundtrack|songs)/i.test(part)) {
            movieName = part.replace(/\s*(movie|album|ost|film|jukebox|soundtrack|songs?|hd|4k)\b/gi, '').trim();
        } else if (!movieName && i === 1 && part.length < 35 && !/(official|video|audio|lyric|hd|4k)/i.test(part)) {
            movieName = part.trim();
        }

        if (!actorName && /(vijay|ajith|rajini|kamal|suriya|vikram|dhanush|sarathkumar|meena|khusboo|simbu|sivakarthikeyan|karthi|allu arjun|prabhas|ram charan|ntr|shah rukh|salman|aamir|ranbir|hrithik|akshay)/i.test(part)) {
            actorName = part.trim();
        }
    }

    if (!movieName) movieName = songName;
    if (!actorName) actorName = cleanAuth || songName;

    return {
        songName,
        movieName,
        actorName,
        singerName: cleanAuth || songName,
    };
}

/**
 * Fetch 5 structured recommendations:
 * 1. Same Movie (1 song)
 * 2. Same Singer (2 songs)
 * 3. Actor's Other Movies (1 song)
 * 4. Random Unrelated Song (1 song)
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

    const recommendedTitles = new Set([rawTitle.toLowerCase()]);
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
    const movieQuery = `${meta.movieName} movie song`;
    await fetchUniqueTrack(movieQuery, '🎬 Same Movie', 1);

    // 2. Same Singer (2 songs)
    const singerQuery = `${meta.singerName} hit songs`;
    await fetchUniqueTrack(singerQuery, '🎤 Same Singer', 2);

    // 3. Actor's Other Movies (1 song)
    const actorQuery = `${meta.actorName} movie songs`;
    await fetchUniqueTrack(actorQuery, '🎭 Actor\'s Other Movie', 1);

    // 4. Random Unrelated Song (1 song)
    const randomPool = [
        'top global viral hits 2026',
        'trending acoustic chill hits',
        'popular retro classic hits',
        'top party dance hits',
        'trending ambient relaxing music'
    ];
    const randomQuery = randomPool[Math.floor(Math.random() * randomPool.length)];
    await fetchUniqueTrack(randomQuery, '🎲 Random Unrelated', 1);

    // Fallback if any category returned fewer tracks than 5 total
    if (finalRecommendations.length < limit) {
        const remainingNeeded = limit - finalRecommendations.length;
        await fetchUniqueTrack(`${meta.singerName} top songs`, '🎵 Recommended Mix', remainingNeeded);
    }

    return finalRecommendations.slice(0, limit);
}

module.exports = {
    cleanSongTitle,
    parseTrackMetadata,
    getRecommendations,
};
