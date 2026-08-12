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
 * Fetch YouTube-style song recommendations matching the vibe, artist, and language of currentTrack
 * @param {object} player Lavalink player instance
 * @param {object} currentTrack Currently playing track
 * @param {number} limit Number of recommendations to fetch (default: 5)
 * @returns {Promise<Array>} Array of recommended Lavalink track objects
 */
async function getRecommendations(player, currentTrack, limit = 5) {
    if (!player || !currentTrack || !currentTrack.info) return [];

    const info = currentTrack.info;
    const rawTitle = info.title || '';
    const rawAuthor = info.author || '';
    const cleanTitle = cleanSongTitle(rawTitle);
    const cleanAuthor = rawAuthor.replace(/ - Topic$/i, '').trim();

    // Prepare set of existing track URIs/identifiers to avoid recommending duplicates
    const existingIdentifiers = new Set();
    if (info.uri) existingIdentifiers.add(info.uri);
    if (info.identifier) existingIdentifiers.add(info.identifier);

    // Add queued tracks to existing set
    if (player.queue && player.queue.tracks) {
        for (const t of player.queue.tracks) {
            if (t.info?.uri) existingIdentifiers.add(t.info.uri);
            if (t.info?.identifier) existingIdentifiers.add(t.info.identifier);
        }
    }

    const recommendations = [];
    const recommendedTitles = new Set([rawTitle.toLowerCase()]);

    // Search queries to emulate YouTube recommendation mix:
    // 1. YouTube Mix for title + artist
    // 2. YouTube Music search for artist + song
    // 3. Similar songs by artist
    const searchQueries = [
        `${cleanAuthor} ${cleanTitle} mix`,
        `${cleanTitle} ${cleanAuthor} song`,
        `${cleanAuthor} songs`,
    ];

    for (const query of searchQueries) {
        if (recommendations.length >= limit) break;

        try {
            // Use ytsearch / ytmsearch
            const searchResult = await player.search({
                query: query,
                source: 'ytsearch',
            }, currentTrack.requester);

            if (!searchResult || !searchResult.tracks || searchResult.tracks.length === 0) {
                continue;
            }

            for (const track of searchResult.tracks) {
                if (recommendations.length >= limit) break;
                if (!track || !track.info) continue;

                const trackUri = track.info.uri;
                const trackId = track.info.identifier;
                const titleLower = (track.info.title || '').toLowerCase();

                // Skip if already in queue/playing or already recommended
                if (existingIdentifiers.has(trackUri) || existingIdentifiers.has(trackId)) continue;
                if (recommendedTitles.has(titleLower)) continue;

                // Check for duplicate title substring to avoid very similar video uploads
                const isDuplicate = Array.from(recommendedTitles).some(existing => 
                    titleLower.includes(existing) || existing.includes(titleLower)
                );
                if (isDuplicate) continue;

                existingIdentifiers.add(trackUri);
                existingIdentifiers.add(trackId);
                recommendedTitles.add(titleLower);

                // Attach requester as current track's requester or bot recommendation
                track.isRecommendation = true;
                recommendations.push(track);
            }
        } catch (error) {
            console.log(`[Reso Recommendations] Search error for query "${query}":`, error.message);
        }
    }

    return recommendations;
}

module.exports = {
    cleanSongTitle,
    getRecommendations,
};
