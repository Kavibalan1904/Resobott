/**
 * Reso Smart Autoplay — Candidate Filtering Pipeline
 * Rejects non-music, podcasts, tutorials, streams, out-of-bounds durations, and duplicates.
 */

const { isTrackDuplicate, normalizeTitle } = require('./normalizer');

// Obvious non-music / non-track video keywords
const NON_MUSIC_PATTERNS = [
    /\b(podcast|episode\s+\d+|full\s+episode)\b/i,
    /\b(tutorial|how\s+to|step\s+by\s+step|beginner\s+guide|guide\s+for)\b/i,
    /\b(reaction|reacts\s+to|first\s+time\s+hearing|reacting\s+to)\b/i,
    /\b(interview|press\s+conference|q&a|behind\s+the\s+scenes|making\s+of)\b/i,
    /\b(unboxing|review|tech\s+review|gameplay|walkthrough|playthrough)\b/i,
    /\b(meme|vlog|asmr|sleep\s+sound|rain\s+sounds\s+10\s+hours|white\s+noise)\b/i,
    /\b(radio\s+stream|24\/7\s+live|lofi\s+hip\s+hop\s+radio|live\s+stream)\b/i,
    // Movie scenes, comedy clips, dialogues, drama cuts
    /\b(scenes?|comedy\s+scenes?|comedy\s+track|action\s+scenes?|fight\s+scenes?|climax\s+scenes?|movie\s+scenes?|drama\s+scenes?|dialogues?)\b/i,
    // Trailers, teasers, promos, announcements, first look
    /\b(official\s+trailer|trailer|official\s+teaser|teaser|sneak\s+peek|glimpse|motion\s+poster|first\s+look|promo|promo\s+video)\b/i,
    // Events, audio launches, speeches, public talks
    /\b(audio\s+launch|press\s+meet|success\s+meet|public\s+review|fan\s+reaction|speech|full\s+event)\b/i,
    // Status clips, shorts, reels, ringtones
    /\b(whatsapp\s+status|status\s+video|shorts|reels|tiktok|ringtone|bgm\s+ringtone)\b/i,
    // Compilations, jukeboxes, long album cuts
    /\b(jukebox|audio\s+jukebox|full\s+album|all\s+songs|mega\s+jukebox|top\s+\d+\s+songs)\b/i,
    // Loops and multi-hour extended cuts
    /\b(1\s+hour|10\s+hours|extended\s+loop|loop\s+version)\b/i,
    // Gimmick audio edits
    /\b(slowed\s*\+*\s*reverb|slowed\s+and\s+reverb|bass\s+boosted|8d\s+audio|nightcore)\b/i,
];

// Devotional / Religious / Temple hymn patterns
const DEVOTIONAL_PATTERNS = [
    /\b(devotional|bhajan|bhajans|bhakti|stotram|stuti|aarti|chalisa|mantra|mantras|suprabhatam|slokam|shloka|chants?|prayers?|pooja|puja|keerthana|keerthanalu|kavacham|namavali|sahasranamam|ashtakam|namaskar|bhakthi)\b/i,
    /\b(ayyappa|ayyappan|murugan\s+songs|vinayagar\s+songs|amman\s+songs|perumal\s+songs|krishna\s+bhajan|shiva\s+stuti|hanuman\s+chalisa)\b/i,
];

// Default configuration options
const DEFAULT_FILTER_OPTIONS = {
    minDurationMs: 45000,      // 45 seconds minimum
    maxDurationMs: 660000,     // 11 minutes maximum (eliminates 15-20+ min jukeboxes/movie clips)
    historyWindowSize: 20,     // Compare against last 20 history tracks
    allowLiveStreams: false,   // Reject 24/7 streams
};

/**
 * Filter an array of candidate tracks against context and constraints
 * @param {Array<object>} candidates Raw candidates from providers
 * @param {object} context ListeningSessionContext
 * @param {object} [options] Filter options
 * @returns {{ validCandidates: Array<object>, rejectionCounts: object }}
 */
function filterCandidates(candidates, context, options = {}) {
    const opts = { ...DEFAULT_FILTER_OPTIONS, ...options };
    const validCandidates = [];
    const rejectionCounts = {
        missingData: 0,
        streamOrPodcast: 0,
        duration: 0,
        currentlyPlaying: 0,
        manualQueue: 0,
        autoplayQueue: 0,
        recentHistory: 0,
        failedCandidate: 0,
        duplicateInCandidates: 0,
    };

    if (!Array.isArray(candidates) || candidates.length === 0) {
        return { validCandidates, rejectionCounts };
    }

    const currentTrack = context?.currentTrack;
    const manualQueue = context?.manualQueueTracks || [];
    const autoplayQueue = context?.autoplayQueueTracks || [];
    const history = (context?.recentHistory || []).slice(-opts.historyWindowSize);
    const failedCandidates = context?.recentFailedCandidates || [];

    const seenInBatch = [];
    const seedTrack = context?.currentTrack || context?.mostRecentManualTrack || null;
    const seedText = seedTrack?.info ? `${seedTrack.info.title || ''} ${seedTrack.info.author || ''}`.toLowerCase() : '';
    const isSeedDevotional = DEVOTIONAL_PATTERNS.some(p => p.test(seedText));

    for (const track of candidates) {
        if (!track || !track.info) {
            rejectionCounts.missingData++;
            continue;
        }

        const info = track.info;

        // 1. Critical metadata check
        if (!info.title || (!info.uri && !info.identifier)) {
            rejectionCounts.missingData++;
            continue;
        }

        const titleLower = String(info.title).toLowerCase();

        // 2. Stream & Non-music check
        if (info.isStream && !opts.allowLiveStreams) {
            rejectionCounts.streamOrPodcast++;
            continue;
        }

        let isNonMusic = false;
        for (const pattern of NON_MUSIC_PATTERNS) {
            if (pattern.test(titleLower)) {
                isNonMusic = true;
                break;
            }
        }
        if (isNonMusic) {
            rejectionCounts.streamOrPodcast++;
            continue;
        }

        // 2b. Devotional / Religious check
        // Unless the user is intentionally listening to devotional tracks, reject temple/religious tracks
        if (!isSeedDevotional) {
            const candText = `${titleLower} ${String(info.author || '').toLowerCase()}`;
            if (DEVOTIONAL_PATTERNS.some(p => p.test(candText))) {
                rejectionCounts.streamOrPodcast++;
                continue;
            }
        }

        // 3. Duration check (only if duration is known and > 0)
        const duration = info.duration || 0;
        if (duration > 0 && (duration < opts.minDurationMs || duration > opts.maxDurationMs)) {
            rejectionCounts.duration++;
            continue;
        }

        // 4. Currently playing check
        if (currentTrack && isTrackDuplicate(info, currentTrack.info || currentTrack)) {
            rejectionCounts.currentlyPlaying++;
            continue;
        }

        // 5. Manual queue check
        let inManualQueue = false;
        for (const queued of manualQueue) {
            if (isTrackDuplicate(info, queued.info || queued)) {
                inManualQueue = true;
                break;
            }
        }
        if (inManualQueue) {
            rejectionCounts.manualQueue++;
            continue;
        }

        // 6. Autoplay queue check
        let inAutoplayQueue = false;
        for (const autoQueued of autoplayQueue) {
            if (isTrackDuplicate(info, autoQueued.info || autoQueued)) {
                inAutoplayQueue = true;
                break;
            }
        }
        if (inAutoplayQueue) {
            rejectionCounts.autoplayQueue++;
            continue;
        }

        // 7. Recent history check
        let inHistory = false;
        for (const pastTrack of history) {
            if (isTrackDuplicate(info, pastTrack.info || pastTrack)) {
                inHistory = true;
                break;
            }
        }
        if (inHistory) {
            rejectionCounts.recentHistory++;
            continue;
        }

        // 8. Recent failed candidate check
        let isFailed = false;
        for (const failed of failedCandidates) {
            if (isTrackDuplicate(info, failed.info || failed)) {
                isFailed = true;
                break;
            }
        }
        if (isFailed) {
            rejectionCounts.failedCandidate++;
            continue;
        }

        // 9. Batch intra-deduplication (keep first best candidate in batch)
        let isDuplicateInBatch = false;
        for (const seen of seenInBatch) {
            if (isTrackDuplicate(info, seen.info || seen)) {
                isDuplicateInBatch = true;
                break;
            }
        }
        if (isDuplicateInBatch) {
            rejectionCounts.duplicateInCandidates++;
            continue;
        }

        seenInBatch.push(track);
        validCandidates.push(track);
    }

    return { validCandidates, rejectionCounts };
}

module.exports = {
    filterCandidates,
    DEFAULT_FILTER_OPTIONS,
    NON_MUSIC_PATTERNS,
    DEVOTIONAL_PATTERNS,
};
