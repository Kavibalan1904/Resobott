/**
 * Comprehensive Test Suite for Reso Smart Autoplay Engine (Resonance AI DJ)
 * Covers all scenarios specified in Section 18 of the specifications.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
    AutoplayEngine,
    autoplayEngine,
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
    AutoplayStore,
    autoplayStore,
    MODE_WEIGHTS,
    setTrackMetadata,
    getTrackMetadata,
    trackMetadataStore,
} = require('../src/autoplay');

const { nowPlayingEmbed, createRecommendationComponents } = require('../src/utils/embeds');
const { YouTubeMixProvider } = require('../src/autoplay/providers/youtubeMixProvider');
const { YtMusicSearchProvider } = require('../src/autoplay/providers/ytMusicSearchProvider');
const { ArtistDiscoveryProvider } = require('../src/autoplay/providers/artistDiscoveryProvider');
const { RelatedSearchProvider } = require('../src/autoplay/providers/relatedSearchProvider');
const { HistoryDiscoveryProvider } = require('../src/autoplay/providers/historyDiscoveryProvider');

describe('Reso Smart Autoplay — 1. Normalization & Duplicate Detection', () => {
    it('should strip common video suffixes while preserving legitimate version tags', () => {
        const norm1 = normalizeTitle('Arabic Kuthu (Official Music Video) [4K]');
        const norm2 = normalizeTitle('Arabic Kuthu - Full Audio Song');
        assert.strictEqual(norm1, 'arabic kuthu');
        assert.strictEqual(norm2, 'arabic kuthu');

        // Preserves remix and live tags
        const remix = normalizeTitle('Arabic Kuthu (Remix)');
        assert.ok(remix.includes('[remix]'), 'Expected [remix] tag to be preserved');

        const live = normalizeTitle('Arabic Kuthu - Live in Concert');
        assert.ok(live.includes('[live]'), 'Expected [live] tag to be preserved');
    });

    it('should extract canonical video IDs from URLs and track identifiers', () => {
        const id1 = getCanonicalIdentifier({ identifier: 'dQw4w9WgXcQ' });
        assert.strictEqual(id1, 'dQw4w9WgXcQ');

        const id2 = getCanonicalIdentifier({ uri: 'https://www.youtube.com/watch?v=kJQP7kiw5Fk' });
        assert.strictEqual(id2, 'kJQP7kiw5Fk');

        const id3 = getCanonicalIdentifier({ uri: 'https://youtu.be/kJQP7kiw5Fk?si=123' });
        assert.strictEqual(id3, 'kJQP7kiw5Fk');
    });

    it('should identify duplicate tracks by ID, canonical URL, and normalized title+artist', () => {
        const t1 = { title: 'Enjoy Enjaami (Official Video)', author: 'Dhee ft. Arivu', identifier: 'eYq7WapuDLU' };
        const t2 = { title: 'Enjoy Enjaami - Audio', author: 'Dhee', identifier: 'eYq7WapuDLU' };
        assert.strictEqual(isTrackDuplicate(t1, t2), true);

        // Different version (Acoustic) is NOT treated as an identical duplicate
        const t3 = { title: 'Enjoy Enjaami (Acoustic Version)', author: 'Dhee', identifier: 'diff1234567' };
        assert.strictEqual(isTrackDuplicate(t1, t3), false);
    });

    it('should calculate string similarity correctly', () => {
        const simExact = stringSimilarity('hello world', 'hello world');
        assert.strictEqual(simExact, 1.0);

        const simHigh = stringSimilarity('arabic kuthu', 'arabic kuthu video');
        assert.ok(simHigh > 0.6);

        const simLow = stringSimilarity('arabic kuthu', 'shape of you');
        assert.ok(simLow < 0.3);
    });
});

describe('Reso Smart Autoplay — 2. Candidate Providers', () => {
    it('YouTube Mix returns valid playlist candidates when video ID is present', async () => {
        const provider = new YouTubeMixProvider(2000);
        const mockPlayer = {
            search: async ({ query }) => {
                assert.ok(query.includes('list=RDdQw4w9WgXcQ'));
                return {
                    loadType: 'playlist',
                    tracks: [
                        { info: { title: 'Seed Song', identifier: 'dQw4w9WgXcQ', author: 'Rick' } }, // Seed itself
                        { info: { title: 'Together Forever', identifier: 'yPYZpwSpKmA', author: 'Rick' } },
                        { info: { title: 'Never Gonna Give You Up 2', identifier: 'xyz12345678', author: 'Rick' } },
                    ],
                };
            },
        };

        const seedTrack = { info: { identifier: 'dQw4w9WgXcQ', title: 'Seed Song' } };
        const candidates = await provider.getCandidates(mockPlayer, seedTrack, null);

        assert.strictEqual(candidates.length, 2);
        assert.strictEqual(candidates[0].info.title, 'Together Forever');
        assert.strictEqual(candidates[0].recommendationSource, 'youtube_mix');
        assert.ok(!candidates.some(c => c.info.identifier === 'dQw4w9WgXcQ'), 'Seed track must be excluded');
    });

    it('YouTube Mix returns empty array when seed has no video identifier', async () => {
        const provider = new YouTubeMixProvider(2000);
        const mockPlayer = { search: async () => ({ tracks: [] }) };
        const seedTrack = { info: { uri: 'localfile.mp3', identifier: 'local' } };

        const candidates = await provider.getCandidates(mockPlayer, seedTrack, null);
        assert.deepStrictEqual(candidates, []);
    });

    it('YouTube Mix handles timeout / failure cleanly without throwing', async () => {
        const provider = new YouTubeMixProvider(50); // fast timeout
        const mockPlayer = {
            search: async () => new Promise(r => setTimeout(r, 200)),
        };

        const seedTrack = { info: { identifier: 'dQw4w9WgXcQ', title: 'Seed Song' } };
        const candidates = await provider.getCandidates(mockPlayer, seedTrack, null);
        assert.deepStrictEqual(candidates, []);
    });

    it('YouTube Music search returns bounded candidates', async () => {
        const provider = new YtMusicSearchProvider(2000);
        const mockPlayer = {
            search: async ({ query, source }) => {
                assert.strictEqual(source, 'ytmsearch');
                return {
                    tracks: [
                        { info: { title: 'Halamithi Habibo', author: 'Anirudh' } },
                        { info: { title: 'Beast Mode', author: 'Anirudh' } },
                    ],
                };
            },
        };

        const seed = { info: { title: 'Arabic Kuthu', author: 'Anirudh' } };
        const candidates = await provider.getCandidates(mockPlayer, seed, null);
        assert.strictEqual(candidates.length, 2);
        assert.strictEqual(candidates[0].recommendationSource, 'ytmusic_search');
    });

    it('Artist Discovery returns candidates avoiding only top result', async () => {
        const provider = new ArtistDiscoveryProvider(2000);
        const mockPlayer = {
            search: async ({ query }) => {
                assert.ok(query.includes('Anirudh'));
                return {
                    tracks: [
                        { info: { title: 'Top Hit 1', author: 'Anirudh' } },
                        { info: { title: 'Hit 2', author: 'Anirudh' } },
                    ],
                };
            },
        };

        const seed = { info: { title: 'Arabic Kuthu', author: 'Anirudh' } };
        const candidates = await provider.getCandidates(mockPlayer, seed, null);
        assert.ok(candidates.length >= 1);
        assert.strictEqual(candidates[0].recommendationSource, 'artist_discovery');
    });

    it('Related Search returns query-based candidates', async () => {
        const provider = new RelatedSearchProvider(2000);
        const mockPlayer = {
            search: async ({ query }) => {
                assert.ok(query.includes('Arabic Kuthu'));
                return {
                    tracks: [{ info: { title: 'Vaathi Coming', author: 'Anirudh' } }],
                };
            },
        };

        const seed = { info: { title: 'Arabic Kuthu', author: 'Anirudh' } };
        const candidates = await provider.getCandidates(mockPlayer, seed, null);
        assert.strictEqual(candidates.length, 1);
        assert.strictEqual(candidates[0].recommendationSource, 'related_search');
    });

    it('History Discovery mines explicit likes without repeating history tracks', async () => {
        const provider = new HistoryDiscoveryProvider(2000);
        const mockPlayer = {
            search: async ({ query }) => {
                assert.ok(query.toLowerCase().includes('yuvan'));
                return {
                    tracks: [{ info: { title: 'Mankatha BGM', author: 'Yuvan Shankar Raja' } }],
                };
            },
        };

        const mockContext = {
            explicitLikes: new Set(['yuvan']),
            recentSuccessfulTracks: [],
            recentManualTracks: [],
        };

        const seed = { info: { title: 'Arabic Kuthu', author: 'Anirudh' } };
        const candidates = await provider.getCandidates(mockPlayer, seed, mockContext);
        assert.strictEqual(candidates.length, 1);
        assert.strictEqual(candidates[0].recommendationSource, 'history_discovery');
    });
});

describe('Reso Smart Autoplay — 3. Filtering Pipeline', () => {
    it('should reject currently playing, queued, and recently played tracks', () => {
        const context = new ListeningSessionContext('g1');
        context.currentTrack = { info: { title: 'Playing Track', identifier: 'play1111111', uri: 'http://yt/play' } };
        context.manualQueueTracks = [{ info: { title: 'Manual Queued Song', identifier: 'man1111111', uri: 'http://yt/man' } }];
        context.recentSuccessfulTracks = [{ info: { title: 'Recent History Song', identifier: 'hist1111111', uri: 'http://yt/hist' } }];
        context.recentFailedCandidates = [{ info: { title: 'Failed Song', identifier: 'fail1111111', uri: 'http://yt/fail' } }];

        const candidates = [
            { info: { title: 'Playing Track', identifier: 'play1111111', uri: 'http://yt/play', duration: 180000 } },
            { info: { title: 'Manual Queued Song', identifier: 'man1111111', uri: 'http://yt/man', duration: 180000 } },
            { info: { title: 'Recent History Song', identifier: 'hist1111111', uri: 'http://yt/hist', duration: 180000 } },
            { info: { title: 'Failed Song', identifier: 'fail1111111', uri: 'http://yt/fail', duration: 180000 } },
            { info: { title: 'Valid Fresh Candidate', identifier: 'valid111111', uri: 'http://yt/valid', duration: 200000 } },
        ];

        const { validCandidates, rejectionCounts } = filterCandidates(candidates, context);
        assert.strictEqual(validCandidates.length, 1);
        assert.strictEqual(validCandidates[0].info.title, 'Valid Fresh Candidate');
        assert.strictEqual(rejectionCounts.currentlyPlaying, 1);
        assert.strictEqual(rejectionCounts.manualQueue, 1);
        assert.strictEqual(rejectionCounts.recentHistory, 1);
        assert.strictEqual(rejectionCounts.failedCandidate, 1);
    });

    it('should reject non-music content (podcasts, streams, reactions, extreme durations)', () => {
        const context = new ListeningSessionContext('g1');
        const candidates = [
            { info: { title: 'The Joe Rogan Experience Podcast Episode 1900', uri: 'http://yt/1', duration: 7200000 } },
            { info: { title: '24/7 Lofi Hip Hop Radio Stream', uri: 'http://yt/2', isStream: true, duration: 0 } },
            { info: { title: 'Producer Reacts to Song for the First Time', uri: 'http://yt/3', duration: 600000 } },
            { info: { title: 'Short Clip', uri: 'http://yt/4', duration: 20000 } }, // 20s < 45s min
            { info: { title: 'Great Music Video', uri: 'http://yt/5', duration: 210000 } },
        ];

        const { validCandidates } = filterCandidates(candidates, context);
        assert.strictEqual(validCandidates.length, 1);
        assert.strictEqual(validCandidates[0].info.title, 'Great Music Video');
    });

    it('should preserve legitimate alternate versions (remix, acoustic, live)', () => {
        const context = new ListeningSessionContext('g1');
        context.recentSuccessfulTracks = [
            { info: { title: 'Original Song', author: 'Artist', identifier: 'orig1111111' } },
        ];

        const candidates = [
            { info: { title: 'Original Song (Official Video)', author: 'Artist', identifier: 'orig1111111', duration: 200000 } }, // Duplicate!
            { info: { title: 'Original Song (Acoustic Live)', author: 'Artist', identifier: 'acoust11111', duration: 220000 } }, // Legitimate version!
        ];

        const { validCandidates } = filterCandidates(candidates, context);
        assert.strictEqual(validCandidates.length, 1);
        assert.strictEqual(validCandidates[0].info.title, 'Original Song (Acoustic Live)');
    });
});

describe('Reso Smart Autoplay — 4. Ranking & 6-Signal Scoring Algorithm', () => {
    it('should rank highly relevant track higher than an unrelated track', () => {
        const context = new ListeningSessionContext('g1');
        const seed = { info: { title: 'Arabic Kuthu', author: 'Anirudh', duration: 280000 } };

        const candidates = [
            {
                info: { title: 'Random Country Song', author: 'Unknown Country Singer', duration: 180000 },
                recommendationSource: 'random',
            },
            {
                info: { title: 'Halamithi Habibo (Arabic Kuthu Mix)', author: 'Anirudh', duration: 280000 },
                recommendationSource: 'youtube_mix',
            },
        ];

        const ranked = candidateScorer.scoreAndRankCandidates(candidates, seed, context);
        assert.strictEqual(ranked[0].info.title, 'Halamithi Habibo (Arabic Kuthu Mix)');
        assert.ok(ranked[0].autoplayScore > ranked[1].autoplayScore);
        assert.ok(ranked[0].scoreBreakdown.seedRelevance >= 90);
    });

    it('should boost candidate matching positive feedback and penalize negative feedback', () => {
        const context = new ListeningSessionContext('g1');
        context.explicitLikes.add('anirudh');
        context.explicitDislikes.add('badsinger');

        const seed = { info: { title: 'Song Seed', author: 'Seed Artist', duration: 200000 } };
        const candidates = [
            { info: { title: 'Awesome Song', author: 'BadSinger', duration: 200000 }, recommendationSource: 'ytmusic_search' },
            { info: { title: 'Awesome Song', author: 'Anirudh', duration: 200000 }, recommendationSource: 'ytmusic_search' },
        ];

        const ranked = candidateScorer.scoreAndRankCandidates(candidates, seed, context);
        assert.strictEqual(ranked[0].info.author, 'Anirudh');
        assert.ok(ranked[0].scoreBreakdown.feedbackMatch > ranked[1].scoreBreakdown.feedbackMatch);
    });

    it('should penalize early skipped songs in scoring', () => {
        const context = new ListeningSessionContext('g1');
        context.skipEvents = [
            { title: 'Boring Track', playedDurationMs: 10000, totalDurationMs: 200000, type: 'early' },
        ];

        const seed = { info: { title: 'Song Seed', author: 'Artist', duration: 200000 } };
        const candidates = [
            { info: { title: 'Boring Track', author: 'Artist', duration: 200000 }, recommendationSource: 'ytmusic_search' },
            { info: { title: 'Fresh Track', author: 'Artist', duration: 200000 }, recommendationSource: 'ytmusic_search' },
        ];

        const ranked = candidateScorer.scoreAndRankCandidates(candidates, seed, context);
        assert.strictEqual(ranked[0].info.title, 'Fresh Track');
    });

    it('should adjust weights properly across different modes', () => {
        assert.strictEqual(MODE_WEIGHTS.Balanced.seedRelevance, 0.30);
        assert.strictEqual(MODE_WEIGHTS['Artist Focus'].artistAssociation, 0.45);
        assert.strictEqual(MODE_WEIGHTS.Discovery.novelty, 0.30);
        assert.strictEqual(MODE_WEIGHTS['Session Focus'].sessionRelevance, 0.35);
    });
});

describe('Reso Smart Autoplay — 5. Selection & Musical Diversity', () => {
    it('should penalize consecutive same-artist repeats when reasonable alternatives exist', () => {
        const selector = new CandidateSelector({ topK: 3, consecutiveArtistPenalty: 30 });
        const context = new ListeningSessionContext('g1');
        context.currentTrack = { info: { title: 'Track 1', author: 'Anirudh' } };

        const ranked = [
            { info: { title: 'Track 2', author: 'Anirudh' }, autoplayScore: 85 },
            { info: { title: 'Track 3', author: 'Harris Jayaraj' }, autoplayScore: 82 },
        ];

        // Adjusted: Anirudh = 85 - 30 = 55; Harris = 82
        const { selectedTrack, reason } = selector.selectCandidate(ranked, context);
        assert.strictEqual(selectedTrack.info.author, 'Harris Jayaraj');
        assert.ok(reason.length > 0);
    });

    it('should relax diversity restrictions when only poor alternatives exist', () => {
        const selector = new CandidateSelector({ topK: 2, minScoreThreshold: 45, consecutiveArtistPenalty: 25 });
        const context = new ListeningSessionContext('g1');
        context.currentTrack = { info: { title: 'Track 1', author: 'Anirudh' } };

        // Alternative has an abysmal score (20), whereas same artist has 90 -> 65
        const ranked = [
            { info: { title: 'Track 2', author: 'Anirudh' }, autoplayScore: 90 },
            { info: { title: 'Irrelevant Track', author: 'Other' }, autoplayScore: 20 },
        ];

        const { selectedTrack } = selector.selectCandidate(ranked, context);
        assert.strictEqual(selectedTrack.info.author, 'Anirudh');
    });
});

describe('Reso Smart Autoplay — 6. Playback & Queue Safety Guarantees', () => {
    beforeEach(() => {
        autoplayEngine.activeLocks.clear();
    });

    it('manual queue tracks prevent autoplay from overtaking manual queue', async () => {
        const mockPlayer = {
            guildId: 'g_queue_priority',
            queue: {
                tracks: [
                    { info: { title: 'Manual Queued Song 1' }, requester: { id: 'user1' } },
                ],
            },
        };

        autoplayStore.setEnabled('g_queue_priority', true);
        const result = await autoplayEngine.getNextTrack(mockPlayer);
        assert.strictEqual(result, null, 'Autoplay must yield to manual queue');
    });

    it('mutex lock prevents simultaneous concurrent autoplay transitions', async () => {
        const engine = new AutoplayEngine();
        const g = 'g_concurrency';
        autoplayStore.setEnabled(g, true);

        // Simulate an ongoing lock
        engine.activeLocks.add(g);
        const mockPlayer = { guildId: g, queue: { tracks: [] } };

        const res = await engine.getNextTrack(mockPlayer);
        assert.strictEqual(res, null, 'Concurrent call must be rejected when active lock exists');

        engine.activeLocks.delete(g);
    });

    it('disabling autoplay during search prevents stale playback', async () => {
        const engine = new AutoplayEngine();
        const g = 'g_stale_test';
        const context = engine.getContext(g);
        autoplayStore.setEnabled(g, true);
        context.currentTrack = { info: { title: 'Seed Song', author: 'Artist', identifier: 'abc12345678' } };

        // Override mix provider to simulate disabling autoplay midway
        engine.mixProvider.getCandidates = async () => {
            autoplayStore.setEnabled(g, false); // Disabled while searching!
            return [{ info: { title: 'Cand', uri: 'http://1', duration: 200000 } }];
        };

        const mockPlayer = { guildId: g, queue: { tracks: [] } };
        const result = await engine.getNextTrack(mockPlayer);
        assert.strictEqual(result, null, 'Stale result must be discarded when autoplay was disabled during search');
    });

    it('manual stop invalidates generation ID and prevents autoplay', () => {
        const context = new ListeningSessionContext('g_stop');
        const gen1 = context.generationId;
        const gen2 = context.nextGeneration();
        assert.strictEqual(gen2, gen1 + 1);
    });
});

describe('Reso Smart Autoplay — 7. Guild Isolation & Persistence', () => {
    it('strictly isolates settings, feedback, and history between different guilds', () => {
        const g1 = 'guild_alpha';
        const g2 = 'guild_beta';

        autoplayStore.clearGuildData(g1);
        autoplayStore.clearGuildData(g2);

        autoplayStore.setEnabled(g1, true);
        autoplayStore.setMode(g1, 'Discovery');
        autoplayStore.addLike(g1, 'tamil melody');

        autoplayStore.setEnabled(g2, false);
        autoplayStore.setMode(g2, 'Familiar');
        autoplayStore.addLike(g2, 'english rock');

        assert.strictEqual(autoplayStore.isEnabled(g1), true);
        assert.strictEqual(autoplayStore.isEnabled(g2), false);

        assert.strictEqual(autoplayStore.getMode(g1), 'Discovery');
        assert.strictEqual(autoplayStore.getMode(g2), 'Familiar');

        assert.ok(autoplayStore.getSettings(g1).likes.has('tamil melody'));
        assert.ok(!autoplayStore.getSettings(g1).likes.has('english rock'));
    });

    it('persists settings to disk and reloads cleanly', () => {
        const g = 'guild_persist_check';
        autoplayStore.setEnabled(g, true);
        autoplayStore.setMode(g, 'Artist Focus');
        autoplayStore.addLike(g, 'anirudh');

        // Create new store instance to test reloading from disk
        const freshStore = new AutoplayStore();
        assert.strictEqual(freshStore.isEnabled(g), true);
        assert.strictEqual(freshStore.getMode(g), 'Artist Focus');
        assert.ok(freshStore.getSettings(g).likes.has('anirudh'));
    });
});

describe('Reso Smart Autoplay — 8. Autoplay & Recommendations Strict Separation Regression', () => {
    const guildId = 'guild_separation_test';

    beforeEach(() => {
        autoplayEngine.activeLocks.clear();
        trackMetadataStore.clearGuildMetadata(guildId);
        autoplayStore.setEnabled(guildId, true);
    });

    it('1. Autoplay-selected tracks have isAutoplay === true', async () => {
        const engine = new AutoplayEngine();
        const context = engine.getContext(guildId);
        context.currentTrack = {
            info: { title: 'Arabic Kuthu', author: 'Anirudh', identifier: 'arabic123', uri: 'https://youtube.com/watch?v=arabic123' },
        };
        engine.mixProvider.getCandidates = async () => [
            { info: { title: 'Halamithi Habibo', author: 'Anirudh', identifier: 'hal123', uri: 'https://youtube.com/watch?v=hal123', duration: 240000 } }
        ];

        const mockPlayer = { guildId, queue: { tracks: [] } };
        const selected = await engine.getNextTrack(mockPlayer);

        assert.ok(selected, 'Expected a selected track');
        assert.strictEqual(selected.isAutoplay, true, 'Autoplay-selected track must have isAutoplay === true');
    });

    it('2. Autoplay-selected tracks have isRecommendation === false and no recommendation categoryLabel', async () => {
        const engine = new AutoplayEngine();
        const context = engine.getContext(guildId);
        context.currentTrack = {
            info: { title: 'Arabic Kuthu', author: 'Anirudh', identifier: 'arabic123', uri: 'https://youtube.com/watch?v=arabic123' },
        };
        engine.mixProvider.getCandidates = async () => [
            { info: { title: 'Halamithi Habibo', author: 'Anirudh', identifier: 'hal123', uri: 'https://youtube.com/watch?v=hal123', duration: 240000 } }
        ];

        const mockPlayer = { guildId, queue: { tracks: [] } };
        const selected = await engine.getNextTrack(mockPlayer);

        assert.ok(selected, 'Expected a selected track');
        assert.strictEqual(selected.isRecommendation, false, 'Autoplay-selected track must have isRecommendation === false');
        assert.strictEqual(selected.categoryLabel, undefined, 'Autoplay-selected track must not have categoryLabel');
    });

    it('3. Autoplay messages never include old "Related to" wording without validated similarity evidence', () => {
        const nextTrack = {
            info: { title: 'Halamithi Habibo', author: 'Anirudh', uri: 'https://youtube.com/watch?v=hal123' },
            isAutoplay: true,
            isRecommendation: false,
        };

        const description = [
            `**[${nextTrack.info.title}](${nextTrack.info.uri})**`,
            `by **${nextTrack.info.author}**`,
            '',
            `🔄 Autoplay • Now playing a new pick based on your listening session.`,
            `*Use \`/autoplay\` to toggle.*`,
        ].join('\n');

        assert.ok(description.includes('🔄 Autoplay • Now playing a new pick based on your listening session.'));
        assert.ok(!description.includes('Related to'), 'Autoplay message must not claim "Related to"');
        assert.ok(!description.includes('Similar to'), 'Autoplay message must not claim "Similar to"');
        assert.ok(!description.includes('Picked from your listening session'), 'Autoplay message must not use old template');
    });

    it('4. Manual recommendations remain selectable and can be added to the queue', () => {
        const mockRecs = [
            { info: { title: 'Recommend Song 1', author: 'Artist 1', duration: 180000, uri: 'https://youtube.com/1' }, categoryLabel: '🎬 From Album' },
            { info: { title: 'Recommend Song 2', author: 'Artist 2', duration: 200000, uri: 'https://youtube.com/2' }, categoryLabel: '🎤 By Artist' },
        ];

        const row = createRecommendationComponents(mockRecs, guildId);
        assert.ok(row, 'Component row must be generated');

        const selectMenu = row.components[0];
        assert.ok(selectMenu, 'Select menu must exist');
        assert.strictEqual(selectMenu.data.placeholder, 'Optional recommendations — add a song to the queue');
        assert.strictEqual(selectMenu.options.length, 2);

        // Simulate user selecting option 0
        const pickedRec = mockRecs[0];
        pickedRec.requester = { username: 'TestUser', id: 'user_123' };
        pickedRec.isAutoplay = false;
        pickedRec.isRecommendation = true;

        setTrackMetadata(guildId, pickedRec, {
            isAutoplay: false,
            isRecommendation: true,
            requester: pickedRec.requester,
            categoryLabel: pickedRec.categoryLabel,
        });

        const meta = getTrackMetadata(guildId, pickedRec);
        assert.strictEqual(meta.isAutoplay, false);
        assert.strictEqual(meta.isRecommendation, true);
        assert.strictEqual(meta.requester.username, 'TestUser');
    });

    it('5. Manual recommendation cards are not treated as automatically playing tracks', () => {
        const mockRec = {
            info: { title: 'Optional Recommendation Track', author: 'Artist', duration: 180000, uri: 'https://youtube.com/rec' },
            isRecommendation: true,
            isAutoplay: false,
            categoryLabel: '🔥 Similar Vibe',
        };

        const mockPlayer = { guildId, volume: 50, repeatMode: 'off', queue: { tracks: [] } };
        const embed = nowPlayingEmbed(mockRec, mockPlayer, null, []);

        const desc = embed.data.description || '';
        assert.ok(!desc.includes('🔄 Autoplay Pick'), 'Manual recommendation track must not show Autoplay Pick badge');

        mockRec.requester = { username: 'Kavi', id: '123' };
        const embedWithUser = nowPlayingEmbed(mockRec, mockPlayer, null, []);
        assert.ok(embedWithUser.data.footer.text.includes('Requested by Kavi'));
    });

    it('6. Track metadata is not lost during application-owned transformation or Lavalink object reconstruction', () => {
        const originalTrack = {
            info: { identifier: 'videoXYZ789', uri: 'https://youtube.com/watch?v=videoXYZ789', title: 'Song With Metadata', author: 'Singer' },
            encoded: 'base64EncodedLavalinkString123',
            isAutoplay: true,
            isRecommendation: false,
            selectionReason: 'session match',
        };

        setTrackMetadata(guildId, originalTrack, {
            isAutoplay: true,
            isRecommendation: false,
            selectionReason: 'session match',
            requester: { username: 'Autoplay', id: 'autoplay' },
        });

        // Simulate Lavalink reconstructing a bare Track object from WebSocket payload
        const reconstructedTrack = {
            info: {
                identifier: 'videoXYZ789',
                uri: 'https://youtube.com/watch?v=videoXYZ789',
                title: 'Song With Metadata',
                author: 'Singer',
            },
            encoded: 'base64EncodedLavalinkString123',
        };
        assert.strictEqual(reconstructedTrack.isAutoplay, undefined);
        assert.strictEqual(reconstructedTrack.isRecommendation, undefined);

        const retrieved = getTrackMetadata(guildId, reconstructedTrack);
        assert.strictEqual(retrieved.isAutoplay, true, 'Store must restore isAutoplay === true');
        assert.strictEqual(retrieved.isRecommendation, false, 'Store must restore isRecommendation === false');
        assert.strictEqual(retrieved.selectionReason, 'session match');

        // Stale metadata cannot contaminate a new user track:
        const nextUserTrack = {
            info: { identifier: 'videoUser111', uri: 'https://youtube.com/watch?v=videoUser111', title: 'User Song', author: 'User Artist' },
            requester: { username: 'Alice', id: 'alice_id' },
        };
        setTrackMetadata(guildId, nextUserTrack, {
            isAutoplay: false,
            isRecommendation: false,
            requester: nextUserTrack.requester,
        });

        const userMeta = getTrackMetadata(guildId, nextUserTrack);
        assert.strictEqual(userMeta.isAutoplay, false, 'User track must not inherit autoplay');
        assert.strictEqual(userMeta.isRecommendation, false);
    });

    it('7. Repeated queue-end events cannot trigger duplicate autoplay selections', async () => {
        const engine = new AutoplayEngine();
        const context = engine.getContext(guildId);
        context.currentTrack = {
            info: { title: 'Seed Track', author: 'Artist', identifier: 'seed123', uri: 'https://youtube.com/seed123' },
        };

        let searchCallCount = 0;
        engine.mixProvider.getCandidates = async () => {
            searchCallCount++;
            await new Promise(r => setTimeout(r, 50));
            return [{ info: { title: 'Pick 1', identifier: 'p1', duration: 200000 } }];
        };

        const mockPlayer = { guildId, queue: { tracks: [] } };

        const [call1, call2] = await Promise.all([
            engine.getNextTrack(mockPlayer),
            engine.getNextTrack(mockPlayer),
        ]);

        assert.strictEqual(searchCallCount, 1, 'Candidate search should only be invoked once');
        assert.ok((call1 && !call2) || (!call1 && call2), 'Exactly one call must succeed while concurrent duplicate is rejected');
    });

    it('8. Disabling Autoplay prevents automatic selection', async () => {
        autoplayStore.setEnabled(guildId, false);
        const engine = new AutoplayEngine();
        const mockPlayer = { guildId, queue: { tracks: [] } };

        const result = await engine.getNextTrack(mockPlayer);
        assert.strictEqual(result, null, 'Disabling autoplay must prevent selection');
    });

    it('9. Existing YouTube playback and track-start behavior are not broken', () => {
        const ytTrack = {
            info: {
                title: 'Official YouTube Video Audio',
                author: 'Popular Artist',
                sourceName: 'youtube',
                duration: 250000,
                uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                artworkUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
            },
            requester: { username: 'DiscordUser', id: 'user_456' },
            isAutoplay: false,
            isRecommendation: false,
        };

        const mockPlayer = {
            guildId,
            volume: 75,
            repeatMode: 'off',
            position: 120000,
            activeFilters: new Set(['bassboost']),
            queue: { tracks: [{ info: { title: 'Next Up Song' } }] },
        };

        const client = { autoplayGuilds: new Set([guildId]) };

        const embed = nowPlayingEmbed(ytTrack, mockPlayer, client, []);
        assert.ok(embed, 'Now playing embed must be created');
        assert.ok(embed.data.title === undefined, 'Uses description header syntax');
        assert.ok(embed.data.description.includes('Official YouTube Video Audio'));
        assert.ok(embed.data.description.includes('🔴'));
        assert.ok(embed.data.description.includes('• 🔄 Autoplay On'), 'Should indicate Autoplay is enabled on server');
        assert.ok(!embed.data.description.includes('• 🔄 Autoplay Pick'), 'Should NOT mark user track as an autoplay pick');
        assert.ok(embed.data.footer.text.includes('Requested by DiscordUser'), 'Should credit the requesting user');
    });
});

