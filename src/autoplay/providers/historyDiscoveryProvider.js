/**
 * Reso Smart Autoplay — Provider E: Listening-History Discovery
 * Mines successful past recommendations and positive feedback to discover candidates without replaying history.
 */

const { BaseCandidateProvider } = require('./baseProvider');
const { normalizeArtist } = require('../normalizer');

class HistoryDiscoveryProvider extends BaseCandidateProvider {
    constructor(timeoutMs = 6000) {
        super('history_discovery', timeoutMs);
    }

    async getCandidates(player, seedTrack, context) {
        if (!player || !context) return [];

        const targetArtist = this._pickPromisingArtist(context, seedTrack);
        if (!targetArtist) return [];

        const query = `${targetArtist} top songs`.trim();
        const requester = { username: 'Autoplay', id: 'autoplay' };

        try {
            return await this.withTimeout(this._searchHistoryRelated(player, query, requester));
        } catch (err) {
            console.log(`[Autoplay] History discovery for "${query}" failed or timed out: ${err.message}`);
            return [];
        }
    }

    async _searchHistoryRelated(player, query, requester) {
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
            t.recommendationSource = 'history_discovery';
            candidates.push(t);
            if (candidates.length >= 8) break;
        }

        return candidates;
    }

    _pickPromisingArtist(context, seedTrack) {
        const seedArtist = normalizeArtist(seedTrack?.info?.author || '');

        // 1. Check explicit likes
        for (const liked of context.explicitLikes || []) {
            if (liked && liked !== seedArtist && liked.length > 2) {
                return liked;
            }
        }

        // 2. Check successful tracks in session
        for (const track of context.recentSuccessfulTracks || []) {
            const artist = normalizeArtist(track?.info?.author || '');
            if (artist && artist !== seedArtist && artist.length > 2) {
                return artist;
            }
        }

        // 3. Check recent manual requests
        for (const track of context.recentManualTracks || []) {
            const artist = normalizeArtist(track?.info?.author || '');
            if (artist && artist !== seedArtist && artist.length > 2) {
                return artist;
            }
        }

        return null;
    }
}

module.exports = { HistoryDiscoveryProvider };
