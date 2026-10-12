/**
 * Reso Smart Autoplay — Provider B: YouTube Music Search
 * Uses Lavalink ytmsearch (with ytsearch fallback) to retrieve clean audio candidates.
 */

const { BaseCandidateProvider } = require('./baseProvider');
const { cleanVideoTitle } = require('../../utils/helpers');

class YtMusicSearchProvider extends BaseCandidateProvider {
    constructor(timeoutMs = 6000) {
        super('ytmusic_search', timeoutMs);
    }

    async getCandidates(player, seedTrack, context) {
        if (!player || !seedTrack?.info) return [];

        const title = cleanVideoTitle(seedTrack.info.title || '');
        const author = seedTrack.info.author || '';
        if (!title) return [];

        const query = `${title} ${author}`.trim();
        const requester = { username: 'Autoplay', id: 'autoplay' };

        try {
            return await this.withTimeout(this._search(player, query, requester));
        } catch (err) {
            console.log(`[Autoplay] YtMusic search for "${query}" failed or timed out: ${err.message}`);
            return [];
        }
    }

    async _search(player, query, requester) {
        let res = null;
        const searchFn = typeof player.search === 'function'
            ? player.search.bind(player)
            : player.node?.search?.bind(player.node);

        if (!searchFn) return [];

        // Primary: YouTube Music
        res = await searchFn({ query, source: 'ytmsearch' }, requester).catch(() => null);

        // Fallback: YouTube standard search
        if (!res || !res.tracks || res.tracks.length === 0) {
            res = await searchFn({ query, source: 'ytsearch' }, requester).catch(() => null);
        }

        if (!res || !Array.isArray(res.tracks)) return [];

        const candidates = [];
        for (const t of res.tracks.slice(0, 10)) {
            if (!t?.info) continue;
            t.recommendationSource = 'ytmusic_search';
            candidates.push(t);
        }
        return candidates;
    }
}

module.exports = { YtMusicSearchProvider };
