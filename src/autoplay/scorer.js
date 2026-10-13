/**
 * Reso Smart Autoplay — Recommendation Ranking Scorer
 * Implements a transparent 6-factor weighted scoring model with mode adjustments.
 */

const { normalizeTitle, normalizeArtist, stringSimilarity } = require('./normalizer');
const { detectLanguage, detectVibe } = require('../utils/recommendations');

// Default signal weights per mode (summing to 100)
const MODE_WEIGHTS = {
    'Balanced': {
        seedRelevance: 0.30,
        artistAssociation: 0.20,
        sessionRelevance: 0.15,
        feedbackMatch: 0.15,
        novelty: 0.10,
        candidateQuality: 0.10,
    },
    'Familiar': {
        seedRelevance: 0.25,
        artistAssociation: 0.25,
        sessionRelevance: 0.15,
        feedbackMatch: 0.25,
        novelty: 0.05,
        candidateQuality: 0.05,
    },
    'Discovery': {
        seedRelevance: 0.20,
        artistAssociation: 0.15,
        sessionRelevance: 0.15,
        feedbackMatch: 0.10,
        novelty: 0.30,
        candidateQuality: 0.10,
    },
    'Artist Focus': {
        seedRelevance: 0.20,
        artistAssociation: 0.45,
        sessionRelevance: 0.10,
        feedbackMatch: 0.10,
        novelty: 0.05,
        candidateQuality: 0.10,
    },
    'Session Focus': {
        seedRelevance: 0.15,
        artistAssociation: 0.15,
        sessionRelevance: 0.35,
        feedbackMatch: 0.15,
        novelty: 0.10,
        candidateQuality: 0.10,
    },
};

class CandidateScorer {
    constructor(defaultMode = 'Balanced') {
        this.defaultMode = defaultMode;
    }

    /**
     * Score and rank an array of candidate tracks
     * @param {Array<object>} candidates 
     * @param {object} seedTrack 
     * @param {object} context ListeningSessionContext
     * @param {string} [mode] Recommendation mode
     * @returns {Array<object>} Candidates sorted descending by total score with scoreBreakdown attached
     */
    scoreAndRankCandidates(candidates, seedTrack, context, mode = null) {
        if (!Array.isArray(candidates) || candidates.length === 0) return [];

        const selectedMode = mode || context?.mode || this.defaultMode;
        const weights = MODE_WEIGHTS[selectedMode] || MODE_WEIGHTS.Balanced;

        const seedTitle = seedTrack?.info?.title || '';
        const seedAuthor = seedTrack?.info?.author || '';
        const seedNormTitle = normalizeTitle(seedTitle);
        const seedNormArtist = normalizeArtist(seedAuthor);

        const seedLang = detectLanguage ? detectLanguage(seedTitle, seedAuthor, 'english') : 'english';
        const seedVibe = detectVibe ? detectVibe(seedTitle, seedAuthor) : 'chill';

        // Count artist occurrences in recent history
        const recentArtistCounts = new Map();
        const history = context?.recentHistory || [];
        for (const t of history) {
            const art = normalizeArtist(t?.info?.author || '');
            if (art) {
                recentArtistCounts.set(art, (recentArtistCounts.get(art) || 0) + 1);
            }
        }

        // Precompute manual artists and early skip titles to avoid repeating work per candidate
        const recentManualArtists = [];
        if (context?.recentManualTracks?.length > 0) {
            const manuals = context.recentManualTracks.slice(0, 3);
            for (let i = 0; i < manuals.length; i++) {
                const mArt = normalizeArtist(manuals[i]?.info?.author || '');
                if (mArt) recentManualArtists.push(mArt);
            }
        }

        const earlySkipNormalizedTitles = [];
        if (context?.skipEvents?.length > 0) {
            for (let i = 0; i < context.skipEvents.length; i++) {
                const skip = context.skipEvents[i];
                if (skip?.type === 'early' && skip.title) {
                    const norm = normalizeTitle(skip.title);
                    if (norm) earlySkipNormalizedTitles.push(norm);
                }
            }
        }

        const scored = candidates.map((track) => {
            const info = track.info || {};
            const candTitle = info.title || '';
            const candAuthor = info.author || '';
            const candNormTitle = normalizeTitle(candTitle);
            const candNormArtist = normalizeArtist(candAuthor);

            // 1. Seed-song relevance (0-100)
            let seedRelevance = 50;
            if (track.recommendationSource === 'youtube_mix') {
                seedRelevance = 92;
            } else if (track.recommendationSource === 'related_search') {
                seedRelevance = 85;
            } else if (track.recommendationSource === 'ytmusic_search') {
                seedRelevance = 78;
            } else if (track.recommendationSource === 'artist_discovery') {
                seedRelevance = 72;
            }

            // Title similarity boost
            if (seedNormTitle && candNormTitle) {
                const titleSim = stringSimilarity(seedNormTitle, candNormTitle);
                if (titleSim > 0.4 && titleSim < 0.9) {
                    seedRelevance = Math.min(100, seedRelevance + 10);
                }
            }

            // 2. Artist or musical association (0-100)
            let artistAssociation = 50;
            if (candNormArtist && seedNormArtist) {
                if (candNormArtist === seedNormArtist) {
                    artistAssociation = 95;
                } else if (candNormArtist.includes(seedNormArtist) || seedNormArtist.includes(candNormArtist)) {
                    artistAssociation = 85;
                } else {
                    artistAssociation = 55;
                }
            }

            // Language & Vibe association
            const candLang = detectLanguage ? detectLanguage(candTitle, candAuthor, seedLang) : seedLang;
            if (candLang === seedLang) {
                artistAssociation = Math.min(100, artistAssociation + 10);
            } else {
                artistAssociation = Math.max(0, artistAssociation - 20);
            }

            // 3. Listening-session relevance (0-100)
            let sessionRelevance = 60;
            const candVibe = detectVibe ? detectVibe(candTitle, candAuthor) : 'chill';
            if (candVibe === seedVibe) {
                sessionRelevance += 20;
            }

            // Match with recent manual tracks
            if (recentManualArtists.length > 0) {
                for (let i = 0; i < recentManualArtists.length; i++) {
                    const mArtist = recentManualArtists[i];
                    if (mArtist === candNormArtist || candNormArtist.includes(mArtist)) {
                        sessionRelevance += 15;
                        break;
                    }
                }
            }
            sessionRelevance = Math.min(100, Math.max(0, sessionRelevance));

            // 4. Positive feedback & preference match (0-100)
            let feedbackMatch = 50; // Neutral default
            if (context?.explicitLikes) {
                for (const liked of context.explicitLikes) {
                    if (candNormTitle.includes(liked) || candNormArtist.includes(liked)) {
                        feedbackMatch = 90;
                        break;
                    }
                }
            }
            if (context?.explicitDislikes) {
                for (const disliked of context.explicitDislikes) {
                    if (candNormTitle.includes(disliked) || candNormArtist.includes(disliked)) {
                        feedbackMatch = 10; // Strong negative
                        break;
                    }
                }
            }

            // Check skip events
            if (earlySkipNormalizedTitles.length > 0) {
                for (let i = 0; i < earlySkipNormalizedTitles.length; i++) {
                    if (candNormTitle.includes(earlySkipNormalizedTitles[i])) {
                        feedbackMatch = Math.min(feedbackMatch, 25);
                        break;
                    }
                }
            }

            // 5. Novelty and discovery (0-100)
            let novelty = 85;
            const count = recentArtistCounts.get(candNormArtist) || 0;
            if (count === 0) {
                novelty = 95; // Unheard in current history
            } else if (count === 1) {
                novelty = 60;
            } else {
                novelty = Math.max(10, 50 - (count * 20)); // Repeated artist penalty
            }

            // 6. Candidate quality (0-100)
            let candidateQuality = 75;
            const duration = info.duration || 0;
            // Standard song duration sweet spot (120s - 360s)
            if (duration >= 120000 && duration <= 360000) {
                candidateQuality += 15;
            }
            // Clean title penalty if messy
            if (candTitle.length > 5 && candTitle.length < 80) {
                candidateQuality += 10;
            }
            candidateQuality = Math.min(100, Math.max(0, candidateQuality));

            // Compute weighted total score
            const totalScore = (
                (seedRelevance * weights.seedRelevance) +
                (artistAssociation * weights.artistAssociation) +
                (sessionRelevance * weights.sessionRelevance) +
                (feedbackMatch * weights.feedbackMatch) +
                (novelty * weights.novelty) +
                (candidateQuality * weights.candidateQuality)
            );

            const scoreBreakdown = {
                seedRelevance: Math.round(seedRelevance),
                artistAssociation: Math.round(artistAssociation),
                sessionRelevance: Math.round(sessionRelevance),
                feedbackMatch: Math.round(feedbackMatch),
                novelty: Math.round(novelty),
                candidateQuality: Math.round(candidateQuality),
                totalScore: parseFloat(totalScore.toFixed(1)),
                mode: selectedMode,
            };

            track.scoreBreakdown = scoreBreakdown;
            track.autoplayScore = scoreBreakdown.totalScore;

            return { track, score: scoreBreakdown.totalScore };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored.map(item => item.track);
    }
}

const candidateScorer = new CandidateScorer();

module.exports = {
    CandidateScorer,
    candidateScorer,
    MODE_WEIGHTS,
};
