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
 * Dynamically extract song title, movie/album name, actors/features, and singer/artist
 * Works dynamically for any language or genre without hardcoded artist lists.
 */
function parseTrackMetadata(title = '', author = '') {
    const rawParts = title.split(/\||-/).map(p => p.trim()).filter(Boolean);
    const cleanAuth = author ? author.replace(/ - Topic$/i, '').trim() : '';

    // Filter out video metadata junk parts
    const filteredParts = rawParts.filter(p => 
        !/^(official|video|audio|lyric|lyrics|full song|hd|4k|1080p|remastered|visualizer|status|shorts)$/i.test(p)
    );

    const songName = cleanSongTitle(filteredParts[0] || title);
    let movieName = null;
    let actorOrArtist = null;

    if (filteredParts.length >= 2) {
        const p1 = filteredParts[1];
        // If part 1 contains "Movie", "Album", "OST", "Film" or looks like a project title
        if (/(movie|album|ost|film|jukebox|soundtrack|songs)/i.test(p1)) {
            movieName = p1.replace(/\s*(movie|album|ost|film|jukebox|soundtrack|songs?|hd|4k)\b/gi, '').trim();
        } else if (p1.length < 35) {
            movieName = p1;
        }
    }

    if (filteredParts.length >= 3) {
        actorOrArtist = filteredParts[2];
    } else if (filteredParts.length >= 2 && !movieName) {
        actorOrArtist = filteredParts[1];
    }

    return {
        songName,
        movieName: movieName || null,
        actorOrArtist: actorOrArtist || null,
        singerName: cleanAuth || songName,
    };
}

/**
 * Fetch 5 structured recommendations:
 * 1. Same Movie / Album (or Same Vibe if not a movie track)
 * 2. Same Singer / Primary Artist (2 songs)
 * 3. Actor / Feature Artist Other Songs (or Similar Artist if no actor)
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
    if (meta.movieName && meta.movieName !== meta.songName) {
        const movieQuery = `${meta.movieName} movie song`;
        await fetchUniqueTrack(movieQuery, `🎬 From ${truncate(meta.movieName, 20)}`, 1);
    } else {
        const vibeQuery = `${meta.songName} ${meta.singerName} mix`;
        await fetchUniqueTrack(vibeQuery, '🔥 Similar Vibe', 1);
    }

    // 2. Same Singer / Main Artist (2 songs)
    const singerQuery = `${meta.singerName} hit songs`;
    await fetchUniqueTrack(singerQuery, `🎤 By ${truncate(meta.singerName, 20)}`, 2);

    // 3. Actor or Feature Artist Other Songs (1 song)
    if (meta.actorOrArtist && meta.actorOrArtist !== meta.singerName) {
        const actorQuery = `${meta.actorOrArtist} hit songs`;
        await fetchUniqueTrack(actorQuery, `🎭 Starring ${truncate(meta.actorOrArtist, 18)}`, 1);
    } else {
        const similarQuery = `${meta.singerName} famous songs`;
        await fetchUniqueTrack(similarQuery, '🎧 Similar Artist', 1);
    }

    // 4. Random Unrelated Song (1 song)
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
        await fetchUniqueTrack(`${meta.singerName} top songs`, '🎵 Related Track', remainingNeeded);
    }

    return finalRecommendations.slice(0, limit);
}

module.exports = {
    cleanSongTitle,
    parseTrackMetadata,
    getRecommendations,
};
