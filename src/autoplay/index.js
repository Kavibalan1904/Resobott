/**
 * Reso Smart Autoplay — Public Interface
 * Codename: Resonance AI DJ
 */

const { autoplayEngine, AutoplayEngine } = require('./engine');
const { autoplayStore, AutoplayStore } = require('./store');
const { guildContextManager, ListeningSessionContext } = require('./context');
const { candidateScorer, CandidateScorer, MODE_WEIGHTS } = require('./scorer');
const { candidateSelector, CandidateSelector } = require('./selector');
const { filterCandidates } = require('./filter');
const {
    normalizeTitle,
    normalizeArtist,
    getCanonicalIdentifier,
    getCanonicalUrl,
    stringSimilarity,
    isTrackDuplicate,
    isExcluded,
} = require('./normalizer');

const { trackMetadataStore, TrackMetadataStore, setTrackMetadata, getTrackMetadata, clearGuildMetadata, clearTrackMetadata } = require('../utils/trackMetadata');

module.exports = {
    autoplayEngine,
    AutoplayEngine,
    autoplayStore,
    AutoplayStore,
    guildContextManager,
    ListeningSessionContext,
    candidateScorer,
    CandidateScorer,
    candidateSelector,
    CandidateSelector,
    filterCandidates,
    normalizeTitle,
    normalizeArtist,
    getCanonicalIdentifier,
    getCanonicalUrl,
    stringSimilarity,
    isTrackDuplicate,
    isExcluded,
    MODE_WEIGHTS,
    trackMetadataStore,
    TrackMetadataStore,
    setTrackMetadata,
    getTrackMetadata,
    clearGuildMetadata,
    clearTrackMetadata,
};
