/**
 * Reso Smart Autoplay — Core Engine
 * Codename: Resonance AI DJ
 * Orchestrates candidate retrieval, filtering, ranking, selection, concurrency control, and diagnostics.
 */

const { guildContextManager } = require('./context');
const { filterCandidates } = require('./filter');
const { candidateScorer } = require('./scorer');
const { candidateSelector } = require('./selector');
const { autoplayStore } = require('./store');
const { isTrackDuplicate } = require('./normalizer');
const { truncate } = require('../utils/helpers');
const { setTrackMetadata } = require('../utils/trackMetadata');

// Providers
const { YouTubeMixProvider } = require('./providers/youtubeMixProvider');
const { YtMusicSearchProvider } = require('./providers/ytMusicSearchProvider');
const { ArtistDiscoveryProvider } = require('./providers/artistDiscoveryProvider');
const { RelatedSearchProvider } = require('./providers/relatedSearchProvider');
const { HistoryDiscoveryProvider } = require('./providers/historyDiscoveryProvider');

class AutoplayEngine {
    constructor() {
        this.mixProvider = new YouTubeMixProvider(7000);
        this.ytmProvider = new YtMusicSearchProvider(6000);
        this.artistProvider = new ArtistDiscoveryProvider(6000);
        this.relatedProvider = new RelatedSearchProvider(6000);
        this.historyProvider = new HistoryDiscoveryProvider(6000);

        this.activeLocks = new Set(); // guildId set for active recommendation searches
    }

    /**
     * Get listening session context for a guild
     * @param {string} guildId 
     * @returns {import('./context').ListeningSessionContext}
     */
    getContext(guildId) {
        return guildContextManager.getContext(guildId);
    }

    /**
     * Main entry point: Find and return the next best song for autoplay
     * @param {object} player Lavalink player
     * @param {Map} [trackHistoryMap] client.trackHistory (optional fallback)
     * @returns {Promise<object|null>} Selected track or null
     */
    async getNextTrack(player, trackHistoryMap = null) {
        if (!player || !player.guildId) return null;
        const guildId = player.guildId;

        // Check if autoplay is enabled for this guild
        const isEnabled = autoplayStore.isEnabled(guildId) || (player.client?.autoplayGuilds?.has(guildId));
        if (!isEnabled) {
            return null;
        }

        // Concurrency Guard: Mutex lock to prevent simultaneous overlapping autoplay searches
        if (this.activeLocks.has(guildId)) {
            console.log(`[AUTOPLAY] guild=${guildId} - Autoplay search already in progress, suppressing duplicate call.`);
            return null;
        }
        this.activeLocks.add(guildId);

        const context = this.getContext(guildId);
        const generationId = context.nextGeneration();

        try {
            // Update context with store settings & player queues
            context.enabled = true;
            context.mode = autoplayStore.getMode(guildId);
            context.syncPlayerQueues(player);

            // Manual Queue Priority: If manual queue has tracks, DO NOT recommend or autoplay!
            if (context.manualQueueTracks.length > 0) {
                console.log(`[AUTOPLAY] guild=${guildId} - Manual queue is not empty (${context.manualQueueTracks.length} tracks). Yielding to manual queue.`);
                return null;
            }

            // Sync explicit feedback from store to context
            const storeSettings = autoplayStore.getSettings(guildId);
            for (const l of storeSettings.likes) context.explicitLikes.add(l);
            for (const d of storeSettings.dislikes) context.explicitDislikes.add(d);

            // Sync track history if available from client
            if (trackHistoryMap && trackHistoryMap.has(guildId)) {
                const extHistory = trackHistoryMap.get(guildId) || [];
                for (const t of extHistory) {
                    if (t?.info) {
                        const isAutoplay = t.requester?.id === 'autoplay';
                        if (isAutoplay) {
                            if (!context.recentAutoplayRecommendations.some(r => isTrackDuplicate(r.info, t.info))) {
                                context.recentAutoplayRecommendations.push(t);
                            }
                        } else {
                            if (!context.recentManualTracks.some(m => isTrackDuplicate(m.info, t.info))) {
                                context.recentManualTracks.push(t);
                            }
                        }
                    }
                }
            }

            // Determine recommendation seed
            const seedTrack = context.getRecommendationSeed();
            if (!seedTrack || !seedTrack.info) {
                console.warn(`[AUTOPLAY] guild=${guildId} - No seed track available in session or history.`);
                return null;
            }

            console.log(`[AUTOPLAY] guild=${guildId} enabled=true mode=${context.mode}`);
            console.log(`[AUTOPLAY] seed="${truncate(seedTrack.info.title || 'Unknown', 40)}" by "${truncate(seedTrack.info.author || 'Unknown', 30)}"`);

            // Step 1: Candidate Generation (Provider Retrieval)
            const rawCandidates = await this._retrieveCandidates(player, seedTrack, context);

            // Stale check 1: If aborted, disabled, or generation superseded while searching
            if (context.generationId !== generationId || !autoplayStore.isEnabled(guildId)) {
                console.log(`[AUTOPLAY] guild=${guildId} - Search aborted due to state change during candidate generation.`);
                return null;
            }

            // Stale check 2: If user added a manual track to player queue while searching
            if (player.queue?.tracks?.some(t => !t.requester || t.requester.id !== 'autoplay')) {
                console.log(`[AUTOPLAY] guild=${guildId} - New manual track queued during candidate search. Aborting recommendation.`);
                return null;
            }

            // Step 2: Filtering
            const { validCandidates, rejectionCounts } = filterCandidates(rawCandidates, context);
            const totalRejected = Object.values(rejectionCounts).reduce((a, b) => a + b, 0);
            console.log(`[AUTOPLAY] filtered=${totalRejected} remaining=${validCandidates.length}`);

            // Step 3: Fallback Recovery if no candidates survived filtering
            let finalCandidates = validCandidates;
            if (finalCandidates.length === 0) {
                console.log(`[AUTOPLAY] guild=${guildId} - Primary candidates exhausted. Executing fallback provider search.`);
                const fallbackRaw = await this._retrieveFallbackCandidates(player, seedTrack, context);
                const fallbackFiltered = filterCandidates(fallbackRaw, context).validCandidates;
                finalCandidates = fallbackFiltered;
            }

            if (finalCandidates.length === 0) {
                console.warn(`[AUTOPLAY] guild=${guildId} - No suitable candidates found after filtering and fallback.`);
                return null;
            }

            // Step 4: Transparent 6-Factor Ranking
            const rankedCandidates = candidateScorer.scoreAndRankCandidates(
                finalCandidates,
                seedTrack,
                context,
                context.mode
            );

            // Step 5: Selection & Musical Diversity
            const { selectedTrack, reason } = candidateSelector.selectCandidate(rankedCandidates, context);

            if (!selectedTrack) {
                console.warn(`[AUTOPLAY] guild=${guildId} - Candidate selector returned null.`);
                return null;
            }

            // Tag track: strictly Autoplay, NEVER Recommendation
            selectedTrack.requester = { username: 'Autoplay', id: 'autoplay' };
            selectedTrack.isAutoplay = true;
            selectedTrack.isRecommendation = false;
            selectedTrack.selectionReason = reason;
            delete selectedTrack.categoryLabel;

            setTrackMetadata(guildId, selectedTrack, {
                isAutoplay: true,
                isRecommendation: false,
                selectionReason: reason,
                categoryLabel: null,
                requester: { username: 'Autoplay', id: 'autoplay' },
            });

            // Record diagnostics in context
            context.lastSelectedTrack = selectedTrack;
            context.lastSelectionReason = reason;
            context.lastCandidateScores = rankedCandidates.slice(0, 5).map(c => ({
                title: c.info?.title,
                score: c.autoplayScore,
                breakdown: c.scoreBreakdown,
            }));

            console.log(`[AUTOPLAY] selected="${truncate(selectedTrack.info?.title || 'Unknown', 40)}"`);
            console.log(`[AUTOPLAY] score=${selectedTrack.autoplayScore} reason="${reason}"`);

            return selectedTrack;
        } catch (err) {
            console.error(`[AUTOPLAY] guild=${guildId} - Unexpected error:`, err);
            return null;
        } finally {
            this.activeLocks.delete(guildId);
        }
    }

    /**
     * Retrieve candidates across providers concurrently
     */
    async _retrieveCandidates(player, seedTrack, context) {
        const candidates = [];

        // Run Mix Provider and YTM / Related providers
        const providerTasks = [
            this.mixProvider.getCandidates(player, seedTrack, context)
                .then(tracks => ({ provider: 'youtube_mix', tracks }))
                .catch(err => ({ provider: 'youtube_mix', tracks: [], error: err.message })),
            this.ytmProvider.getCandidates(player, seedTrack, context)
                .then(tracks => ({ provider: 'ytmusic_search', tracks }))
                .catch(err => ({ provider: 'ytmusic_search', tracks: [], error: err.message })),
            this.relatedProvider.getCandidates(player, seedTrack, context)
                .then(tracks => ({ provider: 'related_search', tracks }))
                .catch(err => ({ provider: 'related_search', tracks: [], error: err.message })),
        ];

        // In Discovery mode or if explicit likes exist, also query artist / history discovery
        if (context.mode === 'Discovery' || (context.explicitLikes && context.explicitLikes.size > 0)) {
            providerTasks.push(
                this.historyProvider.getCandidates(player, seedTrack, context)
                    .then(tracks => ({ provider: 'history_discovery', tracks }))
                    .catch(err => ({ provider: 'history_discovery', tracks: [], error: err.message }))
            );
        }

        const results = await Promise.allSettled(providerTasks);

        for (const res of results) {
            if (res.status === 'fulfilled' && res.value?.tracks) {
                console.log(`[AUTOPLAY] provider=${res.value.provider} candidates=${res.value.tracks.length}`);
                candidates.push(...res.value.tracks);
            }
        }

        return candidates;
    }

    /**
     * Fallback candidate retrieval when initial results are empty
     */
    async _retrieveFallbackCandidates(player, seedTrack, context) {
        const fallbackCandidates = [];

        // Fallback 1: Broad Artist Discovery
        try {
            const artistTracks = await this.artistProvider.getCandidates(player, seedTrack, context);
            if (artistTracks.length > 0) {
                console.log(`[AUTOPLAY] fallback_provider=artist_discovery candidates=${artistTracks.length}`);
                fallbackCandidates.push(...artistTracks);
            }
        } catch { }

        // Fallback 2: History discovery
        if (fallbackCandidates.length === 0) {
            try {
                const historyTracks = await this.historyProvider.getCandidates(player, seedTrack, context);
                if (historyTracks.length > 0) {
                    console.log(`[AUTOPLAY] fallback_provider=history_discovery candidates=${historyTracks.length}`);
                    fallbackCandidates.push(...historyTracks);
                }
            } catch { }
        }

        return fallbackCandidates;
    }
}

const autoplayEngine = new AutoplayEngine();

module.exports = {
    AutoplayEngine,
    autoplayEngine,
};
