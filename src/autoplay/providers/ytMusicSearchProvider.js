/**
 * Reso Smart Autoplay — Provider B: YouTube Music Search
 * Uses Lavalink ytmsearch (with ytsearch fallback) to retrieve clean audio candidates.
 */

const { BaseCandidateProvider } = require('./baseProvider');
const { cleanVideoTitle } = require('../../utils/helpers');
const { getCanonicalIdentifier } = require('../normalizer');

class YtMusicSearchProvider extends BaseCandidateProvider {
    constructor(timeoutMs = 6000) {
        super('ytmusic_search', timeoutMs);
    }

    async getCandidates(player, seedTrack, context) {
        if (!player || !seedTrack?.info) return [];

        const title = cleanVideoTitle(seedTrack.info.title || '');
        const author = seedTrack.info.author || '';
        if (!title) return [];

        // Appending "radio" on YouTube Music returns related radio tracks rather than duplicates of the seed itself
        const query = `${title} ${author} radio`.trim();
        const requester = { username: 'Autoplay', id: 'autoplay' };

        try {
            const tracks = await this.withTimeout(this._search(player, query, requester, seedTrack));
            if (tracks.length > 0) return tracks;

            // Fallback: search without "radio" suffix
            const plainQuery = `${title} ${author}`.trim();
            return await this.withTimeout(this._search(player, plainQuery, requester, seedTrack));
        } catch (err) {
            console.log(`[Autoplay] YtMusic search for "${query}" failed or timed out: ${err.message}`);
            return [];
        }
    }

    async _search(player, query, requester, seedTrack) {
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

        const seedId = seedTrack?.info ? getCanonicalIdentifier(seedTrack.info) : '';
        const candidates = [];
        for (const t of res.tracks.slice(0, 12)) {
            if (!t?.info) continue;
            // Discard immediate duplicate of seed
            if (seedId && getCanonicalIdentifier(t.info) === seedId) continue;

            t.recommendationSource = 'ytmusic_search';
            candidates.push(t);
        }
        return candidates;
    }
}

module.exports = { YtMusicSearchProvider };
