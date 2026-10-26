/**
 * Reso Smart Autoplay — Provider: Peer Artist Discovery
 * Discovers fresh tracks from musical peers and ecosystem cousins in the same language/genre.
 */

const { BaseCandidateProvider } = require('./baseProvider');
const { normalizeArtist } = require('../normalizer');
const {
    PEER_ARTISTS,
    DEFAULT_LANGUAGE_PEERS,
    detectLanguage,
    parseTrackMetadata,
} = require('../../utils/recommendations');

class PeerDiscoveryProvider extends BaseCandidateProvider {
    constructor(timeoutMs = 6000) {
        super('peer_discovery', timeoutMs);
    }

    /**
     * Retrieve candidates from known peer artists
     * @param {object} player 
     * @param {object} seedTrack 
     * @param {object} context ListeningSessionContext
     * @returns {Promise<Array<object>>}
     */
    async getCandidates(player, seedTrack, context) {
        if (!player || !seedTrack?.info) return [];

        const artistKey = this._extractArtistKey(seedTrack);
        const language = context?.sessionLanguage ||
            (seedTrack.info?.title ? detectLanguage(seedTrack.info.title, seedTrack.info.author) : null);

        // Find peer list
        const knownPeers = (artistKey && PEER_ARTISTS[artistKey]) ||
            (language && DEFAULT_LANGUAGE_PEERS[language]) || [];

        if (!knownPeers || knownPeers.length === 0) {
            return [];
        }

        // Filter out artists that have played recently to avoid repetition
        const recentArtists = new Set();
        if (context?.artistRecencyList) {
            for (const a of context.artistRecencyList.slice(0, 6)) {
                recentArtists.add(normalizeArtist(a));
            }
        }
        if (context?.recentHistory) {
            for (const t of context.recentHistory.slice(-6)) {
                const a = normalizeArtist(t?.info?.author || '');
                if (a) recentArtists.add(a);
            }
        }

        const freshPeers = knownPeers.filter(p => !recentArtists.has(normalizeArtist(p)));
        const selectedPeer = freshPeers.length > 0 ? freshPeers[0] : (knownPeers[0] || null);

        if (!selectedPeer) return [];

        const query = `${selectedPeer}${language ? ` ${language}` : ''} hit songs`.trim();
        const requester = { username: 'Autoplay', id: 'autoplay' };

        try {
            return await this.withTimeout(this._searchPeer(player, query, requester, selectedPeer));
        } catch (err) {
            console.log(`[Autoplay] Peer discovery for "${query}" failed or timed out: ${err.message}`);
            return [];
        }
    }

    async _searchPeer(player, query, requester, peerName) {
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
            t.recommendationSource = 'peer_discovery';
            t.peerArtist = peerName;
            candidates.push(t);
            if (candidates.length >= 8) break;
        }

        return candidates;
    }

    _extractArtistKey(seedTrack) {
        const title = seedTrack.info?.title || '';
        const author = seedTrack.info?.author || '';

        if (typeof parseTrackMetadata === 'function') {
            const meta = parseTrackMetadata(title, author);
            if (meta?.composer) {
                const compNorm = normalizeArtist(meta.composer);
                if (compNorm && PEER_ARTISTS[compNorm]) return compNorm;
            }
            if (meta?.primaryArtist) {
                const artNorm = normalizeArtist(meta.primaryArtist);
                if (artNorm && PEER_ARTISTS[artNorm]) return artNorm;
            }
        }

        const authorNorm = normalizeArtist(author);
        if (authorNorm && PEER_ARTISTS[authorNorm]) return authorNorm;

        // Try partial match in PEER_ARTISTS keys
        for (const key of Object.keys(PEER_ARTISTS)) {
            if (authorNorm.includes(key) || key.includes(authorNorm)) {
                return key;
            }
        }

        return authorNorm;
    }
}

module.exports = { PeerDiscoveryProvider };
