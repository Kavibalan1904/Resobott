const { truncate, ensurePlayerNode } = require('./helpers');

/**
 * Universal video descriptor remover (removes "(Official Video)", "[4K]", "Lyric Video", "Video Song", etc.)
 */
function stripVideoJunk(text = '') {
    if (!text) return '';
    return text
        .replace(/[\(\[\{].*?[\)\]\}]/g, '') // remove brackets (...) [...] {...}
        .replace(/\b(official|music|video|audio|lyric|lyrics|full song|hd|4k|1080p|remastered|visualizer|status|shorts|video song|lyric video|4k video|uhd|teaser|trailer|song|songs)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Clean song title helper
 */
function cleanSongTitle(title = '') {
    const firstPart = title.split(/\||-|:|\//)[0] || title;
    return stripVideoJunk(firstPart) || title;
}

/**
 * Pure Algorithmic Title Metadata Parser
 * Parses song name, album/movie name, artist name, and secondary artists
 * directly from video title syntax without needing ANY channel or publisher lists!
 */
function parseTrackMetadata(title = '', author = '') {
    // Split title by delimiters |, -, :, /
    const rawSegments = title.split(/\||-|:|\//).map(s => s.trim()).filter(Boolean);
    const cleanedSegments = rawSegments.map(s => stripVideoJunk(s)).filter(s => s.length > 0);

    let songName = '';
    let movieOrAlbum = null;
    let primaryArtist = null;
    let secondaryArtist = null;

    if (cleanedSegments.length === 0) {
        songName = stripVideoJunk(title) || title;
    } else if (cleanedSegments.length === 1) {
        songName = cleanedSegments[0];
        if (author && !/(vevo|official|channel|studio|records|recordings|music|tv|media|production)/i.test(author)) {
            primaryArtist = author.replace(/ - Topic$/i, '').trim();
        }
    } else {
        // Multi-segment title
        const seg0 = cleanedSegments[0];
        const seg1 = cleanedSegments[1];

        // Format A: "Artist - Song" (Common in Western/Indie titles like "Ed Sheeran - Shape of You")
        if (title.includes(' - ') && !title.includes('|')) {
            primaryArtist = seg0;
            songName = seg1;
            if (cleanedSegments[2]) movieOrAlbum = cleanedSegments[2];
        } else {
            // Format B: "Song | Movie | Artist | Singer" (Common in Indian/OST titles)
            songName = seg0;
            movieOrAlbum = seg1;
            primaryArtist = cleanedSegments[2] || null;
            secondaryArtist = cleanedSegments[3] || null;
        }
    }

    // Fallbacks
    if (!songName) songName = stripVideoJunk(title) || 'Song';
    if (!primaryArtist) primaryArtist = secondaryArtist || songName;

    return {
        songName,
        movieOrAlbum,
        primaryArtist,
        secondaryArtist: secondaryArtist || primaryArtist,
    };
}

/**
 * Fetch 5 structured, high-relevance recommendations using pure title syntax parsing:
 * 1. Same Movie / Album (1 song)
 * 2. Same Singer / Main Artist (2 songs)
 * 3. Actor / Secondary Artist Other Songs (1 song)
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

    const searchNode = player.node || (player.lavalinkManager?.nodeManager?.nodes?.values()?.next()?.value);
    if (!searchNode || !searchNode.connected) return [];

    /**
     * Helper to search and push unique track to results
     */
    async function fetchUniqueTrack(query, categoryLabel, count = 1) {
        let added = 0;
        try {
            const searchResult = await searchNode.search({
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
            // Silently ignore recommendation errors so audio stream is unaffected
        }
        return added;
    }

    // 1. Same Artist / Similar vibe (batch 3 tracks in 1 search)
    const artistQuery = meta.primaryArtist ? `${meta.primaryArtist} popular songs` : `${meta.songName} song`;
    await fetchUniqueTrack(artistQuery, `🎤 By ${truncate(meta.primaryArtist || 'Artist', 18)}`, 3);

    // 2. Discover/Similar tracks (batch 2 tracks in 1 search)
    if (finalRecommendations.length < limit) {
        const discoveryQuery = meta.movieOrAlbum ? `${meta.movieOrAlbum} songs` : `${meta.songName} remix mix`;
        await fetchUniqueTrack(discoveryQuery, '✨ Similar Vibe', limit - finalRecommendations.length);
    }

    return finalRecommendations.slice(0, limit);
}

module.exports = {
    cleanSongTitle,
    parseTrackMetadata,
    getRecommendations,
};
