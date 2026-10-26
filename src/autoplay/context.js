/**
 * Reso Smart Autoplay — Listening Session Context
 * Manages per-guild state, seed resolution, concurrency control, session language/vibe, and history tracking.
 */

const { getCanonicalIdentifier, normalizeTitle, normalizeArtist, isTrackDuplicate } = require('./normalizer');
const { detectLanguage, detectVibe } = require('../utils/recommendations');

class ListeningSessionContext {
    constructor(guildId) {
        this.guildId = guildId;
        this.enabled = false;
        this.mode = 'Balanced'; // Balanced, Familiar, Discovery, Artist Focus, Session Focus

        // Current track details
        this.currentTrack = null;
        this.currentTrackStartTime = null;

        // Session anchors (Zero drift)
        this.sessionLanguage = null;
        this.sessionVibe = null;

        // Manual vs Autoplay seeds and history
        this.mostRecentManualTrack = null;
        this.recentManualTracks = [];           // Array of manual tracks (capped at 20, newest at [0])
        this.recentSuccessfulTracks = [];       // Array of successfully played tracks (capped at 30, newest at [0])
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

        // Anti-stagnation metrics
        this.artistPlayCounts = new Map();      // normalized artist -> total play count in session
        this.artistRecencyList = [];            // ordered list of recent artists (newest at [0])

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

        // Update session anchors from user's explicit manual request
        const detectedLang = detectLanguage ? detectLanguage(track.info.title, track.info.author) : null;
        if (detectedLang) {
            this.sessionLanguage = detectedLang;
        }

        const detectedMood = detectVibe ? detectVibe(track.info.title, track.info.author) : null;
        if (detectedMood) {
            this.sessionVibe = detectedMood;
        }
    }

    /**
     * Update current playing track and timestamp
     * @param {object} track 
     */
    recordTrackStart(track) {
        if (!track?.info) return;
        this.currentTrack = track;
        this.currentTrackStartTime = Date.now();

        const normArtist = normalizeArtist(track.info.author);
        if (normArtist) {
            this.artistPlayCounts.set(normArtist, (this.artistPlayCounts.get(normArtist) || 0) + 1);
            this.artistRecencyList.unshift(normArtist);
            if (this.artistRecencyList.length > 15) {
                this.artistRecencyList.pop();
            }
        }

        const isAutoplay = track.requester?.id === 'autoplay';
        if (isAutoplay) {
            this.recentAutoplayRecommendations.unshift(track);
            if (this.recentAutoplayRecommendations.length > 20) {
                this.recentAutoplayRecommendations.pop();
            }
        } else {
            // User-requested track
            if (!this.sessionLanguage && detectLanguage) {
                const detectedLang = detectLanguage(track.info.title, track.info.author);
                if (detectedLang) this.sessionLanguage = detectedLang;
            }
            if (!this.sessionVibe && detectVibe) {
                const detectedMood = detectVibe(track.info.title, track.info.author);
                if (detectedMood) this.sessionVibe = detectedMood;
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
                // Register dislike to prevent repeated recommendations of this artist
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
     * Sync external track history map from client.trackHistory
     * @param {Array<object>} extHistory Array of tracks in chronological order
     */
    syncExternalHistory(extHistory) {
        if (!Array.isArray(extHistory) || extHistory.length === 0) return;

        // Iterate backwards from newest to oldest
        for (let i = extHistory.length - 1; i >= 0; i--) {
            const t = extHistory[i];
            if (!t?.info) continue;

            const isAutoplay = t.requester?.id === 'autoplay';
            if (isAutoplay) {
                if (!this.recentAutoplayRecommendations.some(r => isTrackDuplicate(r.info, t.info))) {
                    this.recentAutoplayRecommendations.push(t);
                }
            } else {
                if (!this.recentManualTracks.some(m => isTrackDuplicate(m.info, t.info))) {
                    this.recentManualTracks.push(t);
                }
                if (!this.mostRecentManualTrack) {
                    this.mostRecentManualTrack = t;
                }
            }

            if (!this.recentSuccessfulTracks.some(s => isTrackDuplicate(s.info, t.info))) {
                this.recentSuccessfulTracks.push(t);
            }

            const art = normalizeArtist(t.info.author);
            if (art) {
                this.artistPlayCounts.set(art, (this.artistPlayCounts.get(art) || 0) + 1);
                if (!this.artistRecencyList.includes(art)) {
                    this.artistRecencyList.push(art);
                }
            }
        }

        // If currentTrack is missing, use the most recent history item
        if (!this.currentTrack && extHistory.length > 0) {
            this.currentTrack = extHistory[extHistory.length - 1];
        }

        // Infer session language and vibe from history if not yet established
        if (!this.sessionLanguage && detectLanguage) {
            for (let i = extHistory.length - 1; i >= 0; i--) {
                const lang = detectLanguage(extHistory[i]?.info?.title, extHistory[i]?.info?.author);
                if (lang) {
                    this.sessionLanguage = lang;
                    break;
                }
            }
        }

        if (!this.sessionVibe && detectVibe) {
            for (let i = extHistory.length - 1; i >= 0; i--) {
                const vibe = detectVibe(extHistory[i]?.info?.title, extHistory[i]?.info?.author);
                if (vibe) {
                    this.sessionVibe = vibe;
                    break;
                }
            }
        }
    }

    /**
     * Resolve the most appropriate recommendation seed track
     * Priority:
     * 1. Mode-specific override: Session Focus prefers the anchor manual track
     * 2. Current playing track (natural radio progression)
     * 3. Most recently completed track from successful history
     * 4. Most recent manual track from history
     * @returns {object|null}
     */
    getRecommendationSeed() {
        // Mode specific override: Session Focus anchors strictly to manual request
        if (this.mode === 'Session Focus' && this.mostRecentManualTrack?.info) {
            return this.mostRecentManualTrack;
        }

        // 1. Current playing track (standard seed for organic radio flow)
        if (this.currentTrack?.info) {
            return this.currentTrack;
        }

        // 2. Most recently completed track
        if (this.recentSuccessfulTracks.length > 0 && this.recentSuccessfulTracks[0]?.info) {
            return this.recentSuccessfulTracks[0];
        }

        // 3. Most recent manual track
        if (this.mostRecentManualTrack?.info) {
            return this.mostRecentManualTrack;
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
        this.sessionLanguage = null;
        this.sessionVibe = null;
        this.artistPlayCounts.clear();
        this.artistRecencyList = [];
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
