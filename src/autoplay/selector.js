/**
 * Reso Smart Autoplay — Top-Candidate Selection & Musical Diversity
 * Applies artist diversity guards, anti-ping-pong penalties, softmax selection with mode-aware temperature,
 * and transparent selection explanations.
 */

const { normalizeArtist } = require('./normalizer');

class CandidateSelector {
    constructor(options = {}) {
        this.topK = options.topK || 4;                     // Consider top 4 candidates for controlled variety
        this.minScoreThreshold = options.minScoreThreshold || 45; // Minimum relevance score
        this.consecutiveArtistPenalty = options.consecutiveArtistPenalty || 25;
    }

    /**
     * Select final best candidate from ranked list with diversity safeguards
     * @param {Array<object>} rankedCandidates Ranked candidates
     * @param {object} context ListeningSessionContext
     * @returns {{ selectedTrack: object|null, reason: string }}
     */
    selectCandidate(rankedCandidates, context) {
        if (!Array.isArray(rankedCandidates) || rankedCandidates.length === 0) {
            return { selectedTrack: null, reason: 'No candidates available' };
        }

        // Identify immediate last track's artist and 2nd last track's artist
        const lastTrack = context?.currentTrack || (context?.recentSuccessfulTracks?.[0]) || null;
        const lastArtist = normalizeArtist(lastTrack?.info?.author || '');
        const secondLastTrack = context?.recentSuccessfulTracks?.[1] || null;
        const secondLastArtist = normalizeArtist(secondLastTrack?.info?.author || '');

        // Apply artist diversity & ping-pong adjustment
        const diversityAdjusted = rankedCandidates.map((track) => {
            let adjustedScore = track.autoplayScore || 50;
            const candArtist = normalizeArtist(track.info?.author || '');

            let isConsecutive = false;
            if (lastArtist && candArtist && (candArtist === lastArtist || candArtist.includes(lastArtist))) {
                isConsecutive = true;
                // Penalize consecutive artist repeat
                adjustedScore = Math.max(1, adjustedScore - this.consecutiveArtistPenalty);
            } else if (secondLastArtist && candArtist && (candArtist === secondLastArtist || candArtist.includes(secondLastArtist))) {
                // Decay penalty for 2-step alternating repeat (ping-pong prevention)
                adjustedScore = Math.max(1, adjustedScore - Math.round(this.consecutiveArtistPenalty * 0.5));
            }

            return {
                track,
                originalScore: track.autoplayScore,
                adjustedScore,
                isConsecutive,
            };
        });

        // Filter by relevance threshold, but relax if all candidates drop out
        let eligible = diversityAdjusted.filter(item => item.adjustedScore >= this.minScoreThreshold);
        if (eligible.length === 0) {
            // Relax threshold to prevent deadlocks when pool is small
            eligible = diversityAdjusted;
        }

        // Sort descending by adjusted score
        eligible.sort((a, b) => b.adjustedScore - a.adjustedScore);

        // Take Top-K group
        const topGroup = eligible.slice(0, this.topK);

        // If top candidate has a dominant score margin (>= 15 points higher than #2), pick #1 directly
        if (topGroup.length === 1 || (topGroup.length > 1 && topGroup[0].adjustedScore - topGroup[1].adjustedScore >= 15)) {
            const picked = topGroup[0];
            const reason = this._generateReason(picked, context);
            return { selectedTrack: picked.track, reason };
        }

        // Softmax selection with temperature scaling based on mode
        const mode = context?.mode || 'Balanced';
        const temperatures = {
            'Familiar': 5.0,
            'Balanced': 8.0,
            'Discovery': 12.0,
            'Artist Focus': 6.0,
            'Session Focus': 7.0,
        };
        const tau = temperatures[mode] || 8.0;

        const maxScore = topGroup[0].adjustedScore;
        const weights = topGroup.map(item => Math.exp((item.adjustedScore - maxScore) / tau));
        const totalWeight = weights.reduce((acc, w) => acc + w, 0);

        let randomVal = Math.random() * totalWeight;
        let selectedItem = topGroup[0];

        for (let i = 0; i < topGroup.length; i++) {
            randomVal -= weights[i];
            if (randomVal <= 0) {
                selectedItem = topGroup[i];
                break;
            }
        }

        const reason = this._generateReason(selectedItem, context);
        return { selectedTrack: selectedItem.track, reason };
    }

    _generateReason(item, context) {
        const track = item.track || {};
        const breakdown = track.scoreBreakdown || {};
        const reasons = [];

        if (track.peerArtist) {
            reasons.push(`peer artist (${track.peerArtist})`);
        }
        if (breakdown.seedRelevance >= 80) {
            reasons.push('high seed relevance');
        }
        if (breakdown.artistAssociation >= 80) {
            reasons.push('artist connection');
        }
        if (breakdown.sessionRelevance >= 75) {
            reasons.push('session match');
        }
        if (breakdown.feedbackMatch >= 80) {
            reasons.push('matched your preferences');
        }
        if (breakdown.novelty >= 90) {
            reasons.push('fresh discovery');
        }

        if (reasons.length === 0) {
            return `balanced recommendation (${breakdown.mode || 'standard'})`;
        }
        return reasons.slice(0, 2).join(' and ');
    }
}

const candidateSelector = new CandidateSelector();

module.exports = {
    CandidateSelector,
    candidateSelector,
};
