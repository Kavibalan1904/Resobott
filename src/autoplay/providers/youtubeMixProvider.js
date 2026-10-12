/**
 * Reso Smart Autoplay — Provider A: YouTube Mix
 * Loads related tracks via YouTube's automated radio mix (list=RD<VIDEO_ID>).
 */

const { BaseCandidateProvider } = require('./baseProvider');
const { extractYouTubeVideoId } = require('../../utils/helpers');
const { getCanonicalIdentifier } = require('../normalizer');

class YouTubeMixProvider extends BaseCandidateProvider {
    constructor(timeoutMs = 7000) {
        super('youtube_mix', timeoutMs);
        this.cache = new Map(); // videoId -> { timestamp, tracks }
        this.cacheTtlMs = 10 * 60 * 1000; // 10 minutes cache
    }

    /**
     * @param {object} player Lavalink player
     * @param {object} seedTrack Seed track
     * @param {object} context ListeningSessionContext
     * @returns {Promise<Array<object>>}
     */
    async getCandidates(player, seedTrack, context) {
        if (!player || !seedTrack?.info) return [];

        const videoId = this._resolveVideoId(seedTrack);
        if (!videoId || videoId.length !== 11) {
            return []; // No valid 11-char YouTube ID
        }

        // Check cache
        const cached = this.cache.get(videoId);
        if (cached && (Date.now() - cached.timestamp < this.cacheTtlMs)) {
            return cached.tracks;
        }

        const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;

        try {
            const tracks = await this.withTimeout(this._fetchMix(player, mixUrl, videoId));
            if (tracks.length > 0) {
                this.cache.set(videoId, {
                    timestamp: Date.now(),
                    tracks,
                });
            }
            return tracks;
        } catch (err) {
            // Provider is best-effort: log and return empty array
            console.log(`[Autoplay] YouTube Mix provider for ${videoId} failed or timed out: ${err.message}`);
            return [];
        }
    }

    async _fetchMix(player, mixUrl, seedVideoId) {
        let result = null;
        const requester = { username: 'Autoplay', id: 'autoplay' };

        // Search through player's node or player itself
        if (typeof player.search === 'function') {
            result = await player.search({ query: mixUrl }, requester).catch(() => null);
        } else if (player.node?.search) {
            result = await player.node.search({ query: mixUrl }, requester).catch(() => null);
        }

        if (!result) return [];

        let rawTracks = [];
        if (result.loadType === 'playlist' || result.playlist) {
            rawTracks = result.tracks || [];
        } else if (Array.isArray(result.tracks)) {
            rawTracks = result.tracks;
        }

        // Bounded candidates (up to 15) and exclude the seed track itself
        const candidates = [];
        for (const t of rawTracks) {
            if (!t?.info) continue;
            const tId = getCanonicalIdentifier(t.info);
            if (tId && tId === seedVideoId) continue; // Exclude seed track

            t.recommendationSource = 'youtube_mix';
            candidates.push(t);
            if (candidates.length >= 15) break;
        }

        return candidates;
    }

    _resolveVideoId(seedTrack) {
        const info = seedTrack.info || {};
        if (info.identifier && info.identifier.length === 11 && !info.identifier.includes('http')) {
            return info.identifier;
        }
        if (info.uri) {
            const extracted = extractYouTubeVideoId(info.uri);
            if (extracted) return extracted;
        }
        return null;
    }
}

module.exports = { YouTubeMixProvider };
