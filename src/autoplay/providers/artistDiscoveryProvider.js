/**
 * Reso Smart Autoplay — Provider C: Artist Discovery
 * Explores the catalog and hits of the seed artist while avoiding repetitive top hits.
 */

const { BaseCandidateProvider } = require('./baseProvider');
const { normalizeArtist } = require('../normalizer');
const { parseTrackMetadata } = require('../../utils/recommendations');

class ArtistDiscoveryProvider extends BaseCandidateProvider {
    constructor(timeoutMs = 6000) {
        super('artist_discovery', timeoutMs);
    }

    async getCandidates(player, seedTrack, context) {
        if (!player || !seedTrack?.info) return [];

        const artist = this._extractArtist(seedTrack);
        if (!artist || artist.length < 2) return [];

        const query = `${artist} hit songs`.trim();
        const requester = { username: 'Autoplay', id: 'autoplay' };

        try {
            return await this.withTimeout(this._searchArtist(player, query, requester));
        } catch (err) {
            console.log(`[Autoplay] Artist discovery for "${query}" failed or timed out: ${err.message}`);
            return [];
        }
    }

    async _searchArtist(player, query, requester) {
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
        // To avoid constantly returning only the single most popular track, collect up to 8 diverse candidates
        for (const t of res.tracks.slice(0, 10)) {
            if (!t?.info) continue;
            t.recommendationSource = 'artist_discovery';
            candidates.push(t);
            if (candidates.length >= 8) break;
        }

        return candidates;
    }

    _extractArtist(seedTrack) {
        const title = seedTrack.info?.title || '';
        const author = seedTrack.info?.author || '';

        // Try track metadata parser if available
        if (typeof parseTrackMetadata === 'function') {
            const meta = parseTrackMetadata(title, author);
            if (meta?.primaryArtist && meta.primaryArtist.length > 2) {
                return meta.primaryArtist;
            }
            if (meta?.composer && meta.composer.length > 2) {
                return meta.composer;
            }
        }

        const norm = normalizeArtist(author);
        return norm || author;
    }
}

module.exports = { ArtistDiscoveryProvider };
