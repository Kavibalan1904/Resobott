/**
 * Reso Smart Autoplay — Recommendation Ranking Scorer
 * Implements a transparent 6-factor weighted scoring model with mode adjustments,
 * zero language drift, vibe consistency, quality filtering, and peer artist matching.
 */

const { normalizeTitle, normalizeArtist, stringSimilarity } = require('./normalizer');
const {
    detectLanguage,
    detectVibe,
    parseTrackMetadata,
    PEER_ARTISTS,
} = require('../utils/recommendations');

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

// Low-quality audio variant keywords with penalty values
const LOW_QUALITY_VARIANTS = [
    { pattern: /\bkaraoke\b/i, penalty: 35 },
    { pattern: /\b(instrumental|backing\s+track)\b/i, penalty: 25 },
    { pattern: /\b(cover|tribute)\b/i, penalty: 20 },
    { pattern: /\b(nightcore|sped\s+up|speed\s+up)\b/i, penalty: 20 },
    { pattern: /\b(slowed(\s+\+)?\s+reverb|lofi\s+remix)\b/i, penalty: 15 },
    { pattern: /\b(8d\s+audio|bass\s+boosted|chipmunk)\b/i, penalty: 15 },
];

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

        // Parse seed composer
        const seedMeta = parseTrackMetadata ? parseTrackMetadata(seedTitle, seedAuthor) : null;
        const seedComposer = seedMeta?.composer ? normalizeArtist(seedMeta.composer) : null;

        // Target language and vibe resolution (do NOT force English fallback on unknown titles)
        const targetLang = context?.sessionLanguage ||
            (detectLanguage ? detectLanguage(seedTitle, seedAuthor) : null);
        const targetVibe = context?.sessionVibe ||
            (detectVibe ? detectVibe(seedTitle, seedAuthor) : null);

        // Precompute seed known peers
        const seedPeerSet = new Set();
        if (PEER_ARTISTS) {
            const peers = (seedNormArtist && PEER_ARTISTS[seedNormArtist]) ||
                (seedComposer && PEER_ARTISTS[seedComposer]) || [];
            for (const p of peers) {
                seedPeerSet.add(normalizeArtist(p));
            }
        }

        // Count artist occurrences and recency
        const recentArtistCounts = context?.artistPlayCounts || new Map();
        const artistRecency = context?.artistRecencyList || [];

        // Precompute manual artists and early skip titles
        const recentManualArtists = [];
        if (context?.recentManualTracks?.length > 0) {
            const manuals = context.recentManualTracks.slice(0, 5);
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

            const candMeta = parseTrackMetadata ? parseTrackMetadata(candTitle, candAuthor) : null;
            const candComposer = candMeta?.composer ? normalizeArtist(candMeta.composer) : null;

            // 1. Seed-song relevance (0-100)
            let seedRelevance = 50;
            if (track.recommendationSource === 'youtube_mix') {
                seedRelevance = 92;
            } else if (track.recommendationSource === 'peer_discovery') {
                seedRelevance = 85;
            } else if (track.recommendationSource === 'related_search') {
                seedRelevance = 82;
            } else if (track.recommendationSource === 'ytmusic_search') {
                seedRelevance = 78;
            } else if (track.recommendationSource === 'artist_discovery') {
                seedRelevance = 75;
            } else if (track.recommendationSource === 'history_discovery') {
                seedRelevance = 70;
            }

            // Title similarity boost (e.g. remix, mix, reprise, or related track)
            if (seedNormTitle && candNormTitle) {
                const titleSim = stringSimilarity(seedNormTitle, candNormTitle);
                if (titleSim > 0.35 && titleSim < 0.90) {
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
                } else if (seedComposer && candComposer && seedComposer === candComposer) {
                    artistAssociation = 88; // Shared music director/composer
                } else if (seedPeerSet.has(candNormArtist) || (candComposer && seedPeerSet.has(candComposer))) {
                    artistAssociation = 82; // Recognized peer in same musical ecosystem
                } else {
                    artistAssociation = 55;
                }
            } else if (seedPeerSet.has(candNormArtist)) {
                artistAssociation = 80;
            }

            // 3. Listening-session relevance & zero language drift (0-100)
            let sessionRelevance = 60;

            // Target language match
            if (targetLang && detectLanguage) {
                const candLang = detectLanguage(candTitle, candAuthor, null);
                if (candLang) {
                    if (candLang === targetLang) {
                        sessionRelevance += 25; // Matching target language
                    } else {
                        sessionRelevance -= 35; // Conflicting foreign language
                    }
                }
            }

            // Vibe / Mood match
            if (targetVibe && detectVibe) {
                const candVibe = detectVibe(candTitle, candAuthor);
                if (candVibe) {
                    if (candVibe === targetVibe) {
                        sessionRelevance += 18;
                    } else if (
                        (targetVibe === 'mass' && candVibe === 'sad') ||
                        (targetVibe === 'sad' && candVibe === 'mass')
                    ) {
                        sessionRelevance -= 15; // Polar opposite vibe penalty
                    }
                }
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
                        feedbackMatch = Math.min(feedbackMatch, 20);
                        break;
                    }
                }
            }

            // 5. Novelty, discovery, and anti-stagnation (0-100)
            let novelty = 88;
            const playCount = recentArtistCounts.get(candNormArtist) || 0;
            if (playCount === 0) {
                novelty = 95; // Unheard in current history
            } else if (playCount === 1) {
                novelty = 65;
            } else if (playCount === 2) {
                novelty = 40;
            } else {
                novelty = Math.max(10, 30 - ((playCount - 2) * 10)); // Stagnation penalty
            }

            // Recency check (ping-pong prevention)
            if (artistRecency.length > 0) {
                if (artistRecency[0] === candNormArtist) {
                    novelty = Math.max(10, novelty - 25); // Played in immediately preceding track
                } else if (artistRecency.length > 1 && artistRecency[1] === candNormArtist) {
                    novelty = Math.max(10, novelty - 15); // Played 2 tracks ago
                }
            }

            // 6. Candidate quality (0-100)
            let candidateQuality = 80;
            const duration = info.duration || 0;

            // Standard song duration sweet spot (120s - 360s)
            if (duration >= 120000 && duration <= 360000) {
                candidateQuality += 10;
            } else if (duration > 480000 || (duration > 0 && duration < 90000)) {
                candidateQuality -= 15;
            }

            // Clean title length
            if (candTitle.length >= 6 && candTitle.length <= 80) {
                candidateQuality += 5;
            }

            // Low-quality audio variant penalties (unless seed itself had this variant)
            for (const { pattern, penalty } of LOW_QUALITY_VARIANTS) {
                if (pattern.test(candTitle) && !pattern.test(seedTitle)) {
                    candidateQuality -= penalty;
                }
            }

            // Boost for official music video / audio
            if (/\b(official\s+(audio|video|music\s+video)|lyric\s+video)\b/i.test(candTitle)) {
                candidateQuality += 5;
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
