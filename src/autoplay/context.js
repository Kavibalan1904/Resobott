/**
 * Reso Smart Autoplay — Listening Session Context
 * Manages per-guild state, seed resolution, concurrency control, and history tracking.
 */

const { getCanonicalIdentifier, normalizeTitle, normalizeArtist } = require('./normalizer');

class ListeningSessionContext {
    constructor(guildId) {
        this.guildId = guildId;
        this.enabled = false;
        this.mode = 'Balanced'; // Balanced, Familiar, Discovery, Artist Focus, Session Focus

        // Current track details
        this.currentTrack = null;
        this.currentTrackStartTime = null;

        // Manual vs Autoplay seeds and history
        this.mostRecentManualTrack = null;
        this.recentManualTracks = [];           // Array of manual tracks (capped at 20)
        this.recentSuccessfulTracks = [];       // Array of successfully played tracks (capped at 30)
        this.recentAutoplayRecommendations = [];// Array of recommended tracks (capped at 20)
        this.recentFailedCandidates = [];       // Tracks that failed to resolve or play (capped at 15)

        // Queue snapshots
        this.manualQueueTracks = [];
        this.autoplayQueueTracks = [];

        // Diagnostics & scoring records
        this.lastSelectedTrack = null;
        this.lastSelectionReason = '';
        this.lastCandidateScores = [];          // Detailed scores of last recommendation candidates
        this.lastProviderUsed = '';

        // Feedback & event metrics
        this.skipEvents = [];                   // { trackTitle, playedDurationMs, totalDurationMs, type: 'early'|'late' }
        this.completionEvents = [];             // { trackTitle, timestamp }
        this.explicitLikes = new Set();         // Set of normalized strings (artist, song)
        this.explicitDislikes = new Set();      // Set of normalized strings (artist, song)

        // Concurrency and generation tracking
        this.generationId = 0;
        this.isResolving = false;
    }

    /**
     * Increment generation ID to invalidate any in-flight asynchronous operations
     */
    nextGeneration() {
        this.generationId += 1;
        return this.generationId;
    }

    /**
     * Register a new manual track request
     * @param {object} track 
     */
    recordManualRequest(track) {
        if (!track?.info) return;
        this.mostRecentManualTrack = track;
        this.recentManualTracks.unshift(track);
        if (this.recentManualTracks.length > 20) {
            this.recentManualTracks.pop();
        }

        // Implicit positive signal for manually requested artist & title
        const normTitle = normalizeTitle(track.info.title);
        const normArtist = normalizeArtist(track.info.author);
        if (normArtist) this.explicitLikes.add(normArtist);
    }

    /**
     * Update current playing track and timestamp
     * @param {object} track 
     */
    recordTrackStart(track) {
        if (!track?.info) return;
        this.currentTrack = track;
        this.currentTrackStartTime = Date.now();

        const isAutoplay = track.requester?.id === 'autoplay';
        if (isAutoplay) {
            this.recentAutoplayRecommendations.unshift(track);
            if (this.recentAutoplayRecommendations.length > 20) {
                this.recentAutoplayRecommendations.pop();
            }
        }
    }

    /**
     * Record natural track completion
     * @param {object} track 
     */
    recordTrackCompletion(track) {
        if (!track?.info) return;
        this.recentSuccessfulTracks.unshift(track);
        if (this.recentSuccessfulTracks.length > 30) {
            this.recentSuccessfulTracks.pop();
        }

        this.completionEvents.unshift({
            title: track.info.title,
            timestamp: Date.now(),
        });
        if (this.completionEvents.length > 20) {
            this.completionEvents.pop();
        }
    }

    /**
     * Record track skip and determine skip type (early vs late)
     * @param {object} track 
     * @param {number} [elapsedMs] 
     */
    recordTrackSkip(track, elapsedMs = null) {
        if (!track?.info) return;
        const totalDuration = track.info.duration || 0;
        const playedMs = elapsedMs !== null ? elapsedMs :
            (this.currentTrackStartTime ? Date.now() - this.currentTrackStartTime : 0);

        // Early skip: < 30 seconds or < 25% of total song duration
        const isEarly = playedMs < 30000 || (totalDuration > 0 && (playedMs / totalDuration) < 0.25);
        const skipType = isEarly ? 'early' : 'late';

        this.skipEvents.unshift({
            title: track.info.title,
            playedDurationMs: playedMs,
            totalDurationMs: totalDuration,
            type: skipType,
            timestamp: Date.now(),
        });
        if (this.skipEvents.length > 20) {
            this.skipEvents.pop();
        }

        // If it's an early skip on an autoplay track, register negative feedback
        if (track.requester?.id === 'autoplay' && isEarly) {
            const artist = normalizeArtist(track.info.author);
            if (artist) {
                // Weak dislike on repeated early skips
                this.explicitDislikes.add(artist);
            }
        }
    }

    /**
     * Record a failed playback or resolution candidate
     * @param {object} track 
     */
    recordFailedCandidate(track) {
        if (!track?.info) return;
        this.recentFailedCandidates.unshift(track);
        if (this.recentFailedCandidates.length > 15) {
            this.recentFailedCandidates.pop();
        }
    }

    /**
     * Sync state with Lavalink player queues
     * @param {object} player 
     */
    syncPlayerQueues(player) {
        if (!player || !player.queue) {
            this.manualQueueTracks = [];
            this.autoplayQueueTracks = [];
            return;
        }

        const tracks = player.queue.tracks || [];
        this.manualQueueTracks = tracks.filter(t => !t.requester || t.requester.id !== 'autoplay');
        this.autoplayQueueTracks = tracks.filter(t => t.requester && t.requester.id === 'autoplay');

        if (player.queue.current) {
            this.currentTrack = player.queue.current;
        }
    }

    /**
     * Resolve the most appropriate recommendation seed track
     * Priority:
     * 1. If currently in session with recent manual requests, prefer most recent valid manual request (or current track if user manual)
     * 2. Current playing track (if available)
     * 3. Most recently completed track from successful history
     * 4. Most recent manual track from history
     * @returns {object|null}
     */
    getRecommendationSeed() {
        // Mode specific override: Artist Focus or Session Focus
        if (this.mode === 'Session Focus' && this.mostRecentManualTrack?.info) {
            return this.mostRecentManualTrack;
        }

        // Standard seed selection
        if (this.currentTrack?.info && (!this.currentTrack.requester || this.currentTrack.requester.id !== 'autoplay')) {
            return this.currentTrack;
        }

        if (this.mostRecentManualTrack?.info) {
            return this.mostRecentManualTrack;
        }

        if (this.currentTrack?.info) {
            return this.currentTrack;
        }

        if (this.recentSuccessfulTracks.length > 0 && this.recentSuccessfulTracks[0]?.info) {
            return this.recentSuccessfulTracks[0];
        }

        if (this.recentManualTracks.length > 0 && this.recentManualTracks[0]?.info) {
            return this.recentManualTracks[0];
        }

        return null;
    }

    /**
     * Get combined recent history window for filtering
     * @returns {Array<object>}
     */
    get recentHistory() {
        const combined = [];
        const seen = new Set();

        const addUnique = (track) => {
            if (!track?.info) return;
            const id = getCanonicalIdentifier(track.info);
            if (id && !seen.has(id)) {
                seen.add(id);
                combined.push(track);
            }
        };

        if (this.currentTrack) addUnique(this.currentTrack);
        for (const t of this.recentSuccessfulTracks) addUnique(t);
        for (const t of this.recentAutoplayRecommendations) addUnique(t);
        for (const t of this.recentManualTracks) addUnique(t);

        return combined;
    }

    /**
     * Clear context history
     */
    clearHistory() {
        this.recentManualTracks = [];
        this.recentSuccessfulTracks = [];
        this.recentAutoplayRecommendations = [];
        this.recentFailedCandidates = [];
        this.skipEvents = [];
        this.completionEvents = [];
        this.lastCandidateScores = [];
    }
}

class GuildContextManager {
    constructor() {
        this.contexts = new Map(); // guildId -> ListeningSessionContext
    }

    /**
     * Get or create a ListeningSessionContext for a guild
     * @param {string} guildId 
     * @returns {ListeningSessionContext}
     */
    getContext(guildId) {
        if (!guildId) return null;
        if (!this.contexts.has(guildId)) {
            this.contexts.set(guildId, new ListeningSessionContext(guildId));
        }
        return this.contexts.get(guildId);
    }

    /**
     * Remove context when bot leaves guild or on cleanup
     * @param {string} guildId 
     */
    removeContext(guildId) {
        this.contexts.delete(guildId);
    }
}

const guildContextManager = new GuildContextManager();

module.exports = {
    ListeningSessionContext,
    GuildContextManager,
    guildContextManager,
};
