/**
 * Reso Smart Autoplay — Provider D: Related-Song Search
 * Discovers similar songs using semantic similarity queries.
 */

const { BaseCandidateProvider } = require('./baseProvider');
const { cleanVideoTitle } = require('../../utils/helpers');
const { normalizeArtist } = require('../normalizer');

class RelatedSearchProvider extends BaseCandidateProvider {
    constructor(timeoutMs = 6000) {
        super('related_search', timeoutMs);
    }

    async getCandidates(player, seedTrack, context) {
        if (!player || !seedTrack?.info) return [];

        const title = cleanVideoTitle(seedTrack.info.title || '');
        const artist = normalizeArtist(seedTrack.info.author || '');
        if (!title) return [];

        // Build related song query
        const query = `songs like ${title} ${artist}`.trim();
        const requester = { username: 'Autoplay', id: 'autoplay' };

        try {
            return await this.withTimeout(this._searchRelated(player, query, requester));
        } catch (err) {
            console.log(`[Autoplay] Related search for "${query}" failed or timed out: ${err.message}`);
            return [];
        }
    }

    async _searchRelated(player, query, requester) {
        const searchFn = typeof player.search === 'function'
            ? player.search.bind(player)
            : player.node?.search?.bind(player.node);

        if (!searchFn) return [];

        let res = await searchFn({ query, source: 'ytmsearch' }, requester).catch(() => null);
        if (!res || !res.tracks || res.tracks.length === 0) {
            res = await searchFn({ query, source: 'ytsearch' }, requester).catch(() => null);
        }

        if (!res || !Array.isArray(res.tracks)) return [];

        const candidates = [];
        for (const t of res.tracks.slice(0, 10)) {
            if (!t?.info) continue;
            t.recommendationSource = 'related_search';
            candidates.push(t);
            if (candidates.length >= 8) break;
        }

        return candidates;
    }
}

module.exports = { RelatedSearchProvider };
