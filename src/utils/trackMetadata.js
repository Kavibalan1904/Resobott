/**
 * Reso Music Bot — Application-Owned Track Metadata Store
 * 
 * Preserves application-level classification and properties (isAutoplay, isRecommendation,
 * categoryLabel, selectionReason, requester) across Lavalink track object serialization,
 * cloning, and WebSocket event reconstructions.
 */

class TrackMetadataStore {
    constructor(maxEntriesPerGuild = 100) {
        this.maxEntries = maxEntriesPerGuild;
        // Key: guildId -> Map(trackKey -> metadata)
        this.store = new Map();
    }

    /**
     * Generate lookup keys for a track to ensure robust retrieval regardless of
     * which property Lavalink retains after serialization.
     */
    _getKeys(track) {
        if (!track) return [];
        const keys = [];
        const info = track.info || track;

        if (info.identifier) keys.push(`id:${info.identifier}`);
        if (info.uri) keys.push(`uri:${info.uri}`);
        if (track.encoded) keys.push(`enc:${track.encoded}`);

        // Fallback title+author key if no unique id exists
        if (info.title) {
            const norm = `${(info.title || '').trim().toLowerCase()}::${(info.author || '').trim().toLowerCase()}`;
            keys.push(`title:${norm}`);
        }

        return keys;
    }

    /**
     * Store metadata for a track in a given guild
     * @param {string} guildId Discord Guild ID
     * @param {object} track Lavalink track object
     * @param {object} metadata Metadata properties
     */
    setTrackMetadata(guildId, track, metadata = {}) {
        if (!guildId || !track) return;

        // Apply directly to the track object in memory as well
        if (metadata.isAutoplay !== undefined) track.isAutoplay = Boolean(metadata.isAutoplay);
        if (metadata.isRecommendation !== undefined) track.isRecommendation = Boolean(metadata.isRecommendation);
        if (metadata.categoryLabel) {
            track.categoryLabel = metadata.categoryLabel;
        } else {
            delete track.categoryLabel;
        }
        if (metadata.selectionReason !== undefined) track.selectionReason = metadata.selectionReason;
        if (metadata.requester !== undefined) track.requester = metadata.requester;

        let guildMap = this.store.get(guildId);
        if (!guildMap) {
            guildMap = new Map();
            this.store.set(guildId, guildMap);
        }

        const data = {
            isAutoplay: metadata.isAutoplay !== undefined ? Boolean(metadata.isAutoplay) : (track.isAutoplay ?? false),
            isRecommendation: metadata.isRecommendation !== undefined ? Boolean(metadata.isRecommendation) : (track.isRecommendation ?? false),
            categoryLabel: metadata.categoryLabel ?? track.categoryLabel ?? null,
            selectionReason: metadata.selectionReason ?? track.selectionReason ?? null,
            requester: metadata.requester ?? track.requester ?? null,
            timestamp: Date.now(),
        };

        const keys = this._getKeys(track);
        for (const k of keys) {
            guildMap.set(k, data);
        }

        // Enforce max entries limit (LRU-like deletion)
        if (guildMap.size > this.maxEntries * 4) {
            const entries = Array.from(guildMap.entries());
            entries.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
            const toDelete = entries.slice(0, Math.floor(entries.length / 2));
            for (const [k] of toDelete) {
                guildMap.delete(k);
            }
        }
    }

    /**
     * Retrieve metadata for a track in a given guild
     * @param {string} guildId Discord Guild ID
     * @param {object} track Lavalink track object
     * @returns {object} Metadata object
     */
    getTrackMetadata(guildId, track) {
        if (!guildId || !track) {
            return {
                isAutoplay: false,
                isRecommendation: false,
                categoryLabel: null,
                selectionReason: null,
                requester: null,
            };
        }

        const guildMap = this.store.get(guildId);
        let foundData = null;

        if (guildMap) {
            const keys = this._getKeys(track);
            for (const k of keys) {
                if (guildMap.has(k)) {
                    foundData = guildMap.get(k);
                    break;
                }
            }
        }

        // Direct properties on track take precedence if explicitly boolean
        const isAutoplay = typeof track.isAutoplay === 'boolean'
            ? track.isAutoplay
            : (foundData?.isAutoplay ?? (track.requester?.id === 'autoplay'));

        const isRecommendation = typeof track.isRecommendation === 'boolean'
            ? track.isRecommendation
            : (foundData?.isRecommendation ?? false);

        const categoryLabel = track.categoryLabel ?? foundData?.categoryLabel ?? null;
        const selectionReason = track.selectionReason ?? foundData?.selectionReason ?? null;
        const requester = track.requester ?? foundData?.requester ?? null;

        return {
            isAutoplay,
            isRecommendation,
            categoryLabel,
            selectionReason,
            requester,
        };
    }

    /**
     * Clear all metadata for a guild (e.g. on disconnect or queue clear)
     * @param {string} guildId Discord Guild ID
     */
    clearGuildMetadata(guildId) {
        if (guildId) {
            this.store.delete(guildId);
        }
    }

    /**
     * Clear metadata for a specific track in a guild
     * @param {string} guildId Discord Guild ID
     * @param {object} track Lavalink track object
     */
    clearTrackMetadata(guildId, track) {
        const guildMap = this.store.get(guildId);
        if (!guildMap || !track) return;

        const keys = this._getKeys(track);
        for (const k of keys) {
            guildMap.delete(k);
        }
    }
}

const trackMetadataStore = new TrackMetadataStore();

module.exports = {
    TrackMetadataStore,
    trackMetadataStore,
    setTrackMetadata: (guildId, track, meta) => trackMetadataStore.setTrackMetadata(guildId, track, meta),
    getTrackMetadata: (guildId, track) => trackMetadataStore.getTrackMetadata(guildId, track),
    clearGuildMetadata: (guildId) => trackMetadataStore.clearGuildMetadata(guildId),
    clearTrackMetadata: (guildId, track) => trackMetadataStore.clearTrackMetadata(guildId, track),
};
