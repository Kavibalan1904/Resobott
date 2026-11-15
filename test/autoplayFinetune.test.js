const { describe, it } = require('node:test');
const assert = require('node:assert');

const { filterCandidates, DEVOTIONAL_PATTERNS, BGM_PATTERNS } = require('../src/autoplay/filter');
const { candidateScorer } = require('../src/autoplay/scorer');
const { ListeningSessionContext } = require('../src/autoplay/context');
const { HistoryDiscoveryProvider } = require('../src/autoplay/providers/historyDiscoveryProvider');
const { ArtistDiscoveryProvider } = require('../src/autoplay/providers/artistDiscoveryProvider');
const { RelatedSearchProvider } = require('../src/autoplay/providers/relatedSearchProvider');

describe('Autoplay Finetuning — Devotional & Non-Music Elimination', () => {
    it('should strictly reject SPB and temple devotional tracks when seed is a regular film song', () => {
        const seedTrack = {
            info: {
                title: 'Devuda Devuda Official Video | Rajinikanth | Chandramukhi | Vidyasagar | SPB',
                author: 'Sun TV',
                duration: 270000,
            },
        };

        const mockContext = {
            currentTrack: seedTrack,
            mostRecentManualTrack: seedTrack,
            manualQueueTracks: [],
            autoplayQueueTracks: [],
            recentHistory: [],
            recentFailedCandidates: [],
        };

        const candidates = [
            { info: { title: 'Lord Shiva Devotional Songs Nonstop | SPB', author: 'Devotional TV', duration: 240000, identifier: 'dev1' } },
            { info: { title: 'S.P. Balasubrahmanyam Ayyappa Bhajans', author: 'Bhakthi Sagar', duration: 300000, identifier: 'dev2' } },
            { info: { title: 'Venkateswara Suprabhatam Full Stotram', author: 'S. P. Balasubrahmanyam', duration: 320000, identifier: 'dev3' } },
            { info: { title: 'Sri Rama Pooja Keerthanalu', author: 'SPB', duration: 250000, identifier: 'dev4' } },
            { info: { title: 'Rakkamma Kaiya Thattu', author: 'S. P. Balasubrahmanyam', duration: 260000, identifier: 'film1' } },
            { info: { title: 'Kattukuyilu Manasukkulle', author: 'S. P. Balasubrahmanyam, Yesudas', duration: 270000, identifier: 'film2' } },
        ];

        const { validCandidates, rejectionCounts } = filterCandidates(candidates, mockContext);

        // All 4 devotional tracks must be rejected
        assert.strictEqual(validCandidates.length, 2, 'Expected only the 2 film songs to survive filtering');
        assert.strictEqual(validCandidates[0].info.title, 'Rakkamma Kaiya Thattu');
        assert.strictEqual(validCandidates[1].info.title, 'Kattukuyilu Manasukkulle');
        assert.strictEqual(rejectionCounts.streamOrPodcast, 4, 'Expected 4 devotional rejections');
    });

    it('should strictly reject movie comedy scenes, trailers, jukeboxes and status clips', () => {
        const seedTrack = {
            info: {
                title: 'Devuda Devuda',
                author: 'SPB',
                duration: 270000,
            },
        };

        const mockContext = {
            currentTrack: seedTrack,
            manualQueueTracks: [],
            autoplayQueueTracks: [],
            recentHistory: [],
            recentFailedCandidates: [],
        };

        const candidates = [
            { info: { title: 'Chandramukhi Comedy Scene Vadivelu & Rajini', author: 'Tamil Movies', duration: 300000, identifier: 'scene1' } },
            { info: { title: 'Chandramukhi 2 Official Trailer 4K', author: 'Sun Pictures', duration: 180000, identifier: 'trail1' } },
            { info: { title: 'Chandramukhi Audio Jukebox All Songs', author: 'Music Label', duration: 900000, identifier: 'juke1' } },
            { info: { title: 'Devuda Devuda WhatsApp Status 30 Sec', author: 'Status Hub', duration: 30000, identifier: 'status1' } },
            { info: { title: 'Chandramukhi Audio Launch Speech by Superstar', author: 'Behindwoods', duration: 400000, identifier: 'speech1' } },
            { info: { title: 'Annanoda Paattu', author: 'Chandramukhi, Vidyasagar', duration: 260000, identifier: 'song1' } },
        ];

        const { validCandidates } = filterCandidates(candidates, mockContext);
        assert.strictEqual(validCandidates.length, 1);
        assert.strictEqual(validCandidates[0].info.title, 'Annanoda Paattu');
    });

    it('should allow devotional songs only when seed itself is explicitly a devotional hymn', () => {
        const devotionalSeed = {
            info: {
                title: 'Lord Shiva Devotional Stotram',
                author: 'Bhakthi',
                duration: 300000,
            },
        };

        const mockContext = {
            currentTrack: devotionalSeed,
            mostRecentManualTrack: devotionalSeed,
            manualQueueTracks: [],
            autoplayQueueTracks: [],
            recentHistory: [],
            recentFailedCandidates: [],
        };

        const candidates = [
            { info: { title: 'Shiva Tandava Stotram', author: 'SPB', duration: 280000, identifier: 'shiva1' } },
            { info: { title: 'Pop Dance Party', author: 'Pop Singer', duration: 200000, identifier: 'pop1' } },
        ];

        const { validCandidates } = filterCandidates(candidates, mockContext);
        assert.strictEqual(validCandidates.length, 2, 'Should allow devotional tracks when seed is devotional');
    });

    it('HistoryDiscoveryProvider should query movie hit songs in target language instead of generic top songs', async () => {
        const provider = new HistoryDiscoveryProvider(2000);
        let executedQuery = '';

        const mockPlayer = {
            search: async ({ query }) => {
                executedQuery = query;
                return { tracks: [{ info: { title: 'Test Film Song', author: 'SPB' } }] };
            },
        };

        const seedTrack = {
            info: {
                title: 'Devuda Devuda | Chandramukhi',
                author: 'Sun TV',
            },
        };

        const mockContext = {
            explicitLikes: new Set(['s p balasubrahmanyam']),
        };

        await provider.getCandidates(mockPlayer, seedTrack, mockContext);
        assert.ok(executedQuery.toLowerCase().includes('s p balasubrahmanyam'));
        assert.ok(executedQuery.toLowerCase().includes('tamil'));
        assert.ok(executedQuery.toLowerCase().includes('movie hit songs'));
    });

    it('CandidateScorer should heavily penalize cross-language drift', () => {
        const seed = {
            info: {
                title: 'Devuda Devuda',
                author: 'Vidyasagar',
                duration: 270000,
            },
        };

        const mockContext = {
            mode: 'Balanced',
            recentHistory: [],
            recentManualTracks: [],
            skipEvents: [],
        };

        const candidates = [
            {
                info: {
                    title: 'Appadi Podu (From "Ghilli")',
                    author: 'Vidyasagar',
                    duration: 270000,
                },
                recommendationSource: 'youtube_mix',
            },
            {
                info: {
                    title: 'Tum Hi Ho',
                    author: 'Arijit Singh',
                    duration: 270000,
                },
                recommendationSource: 'youtube_mix',
            },
        ];

        const ranked = candidateScorer.scoreAndRankCandidates(candidates, seed, mockContext);
        assert.strictEqual(ranked[0].info.title, 'Appadi Podu (From "Ghilli")');
        // Tamil track should score substantially higher than Hindi track for Tamil seed
        assert.ok(ranked[0].autoplayScore - ranked[1].autoplayScore >= 18, 'Expected native language track to score substantially higher');
    });

    it('should strictly reject movie BGMs, themes, and background scores when seed is a regular song', () => {
        const seed = {
            info: {
                title: 'Arabic Kuthu - Video Song | Beast | Thalapathy Vijay | Anirudh',
                author: 'Sun TV',
                duration: 280000,
            },
        };

        const mockContext = {
            currentTrack: seed,
            mostRecentManualTrack: seed,
            manualQueueTracks: [],
            autoplayQueueTracks: [],
            recentHistory: [],
            recentFailedCandidates: [],
        };

        const candidates = [
            { info: { title: 'Vikram BGM (Original Background Score)', author: 'Anirudh', duration: 150000, identifier: 'bgm1' } },
            { info: { title: 'Rolex Theme BGM Full Track', author: 'Anirudh Ravichander', duration: 120000, identifier: 'bgm2' } },
            { info: { title: 'Leo Badass Theme | Vijay | Anirudh', author: 'Sony Music South', duration: 180000, identifier: 'bgm3' } },
            { info: { title: 'Master Interval BGM Original Score', author: 'Anirudh', duration: 140000, identifier: 'bgm4' } },
            { info: { title: 'KGF Chapter 2 Monster BGM OST', author: 'Hombale', duration: 160000, identifier: 'bgm5' } },
            { info: { title: 'Halamithi Habibo (From "Beast")', author: 'Anirudh Ravichander, Jonita Gandhi', duration: 280000, identifier: 'song1' } },
            { info: { title: 'Jolly O Gymkhana', author: 'Thalapathy Vijay, Anirudh', duration: 270000, identifier: 'song2' } },
        ];

        const { validCandidates, rejectionCounts } = filterCandidates(candidates, mockContext);

        // All 5 BGMs must be rejected, only the 2 actual songs should survive
        assert.strictEqual(validCandidates.length, 2, 'Expected only the 2 actual songs to survive filtering');
        assert.strictEqual(validCandidates[0].info.title, 'Halamithi Habibo (From "Beast")');
        assert.strictEqual(validCandidates[1].info.title, 'Jolly O Gymkhana');
        assert.strictEqual(rejectionCounts.streamOrPodcast, 5, 'Expected 5 BGM rejections');
    });

    it('should allow BGM when seed itself is an explicit BGM or instrumental track', () => {
        const bgmSeed = {
            info: {
                title: 'Rolex Theme BGM | Vikram Original Soundtrack',
                author: 'Anirudh',
                duration: 120000,
            },
        };

        const mockContext = {
            currentTrack: bgmSeed,
            mostRecentManualTrack: bgmSeed,
            manualQueueTracks: [],
            autoplayQueueTracks: [],
            recentHistory: [],
            recentFailedCandidates: [],
        };

        const candidates = [
            { info: { title: 'Vikram Title Track BGM', author: 'Anirudh', duration: 130000, identifier: 'bgm1' } },
            { info: { title: 'Leo Theme Music', author: 'Anirudh', duration: 140000, identifier: 'bgm2' } },
        ];

        const { validCandidates } = filterCandidates(candidates, mockContext);
        assert.strictEqual(validCandidates.length, 2, 'Should allow BGM when seed is an instrumental/BGM track');
    });

    it('should register skip < 60s as early skip, penalize track and artist in hearing profile', () => {
        const context = new ListeningSessionContext('test_guild_hearing');
        const skippedTrack = {
            isAutoplay: true,
            info: {
                title: 'Unwanted Track',
                author: 'Disliked Artist',
                duration: 240000,
                identifier: 'unwanted_123',
            },
        };

        // User skips within 45 seconds (< 1 minute)
        context.recordTrackSkip(skippedTrack, 45000);

        assert.strictEqual(context.skipEvents[0].type, 'early', 'Expected skip < 60s to be registered as early');
        assert.ok(context.earlySkippedTracks.has('unwanted track'), 'Expected normalized title in earlySkippedTracks');
        assert.ok(context.earlySkippedTracks.has('unwanted_123'), 'Expected canonical ID in earlySkippedTracks');
        assert.strictEqual(context.artistEarlySkipCounts.get('disliked artist'), 1);
        assert.ok(context.explicitDislikes.has('disliked artist'), 'Expected artist added to explicit dislikes');
        assert.ok(context.listeningProfile.avoidedArtists.has('disliked artist'), 'Expected artist in avoidedArtists profile');
    });

    it('should filter out early skipped tracks (< 1 min) from subsequent candidate batches', () => {
        const context = new ListeningSessionContext('test_guild_filter_skip');
        const seed = {
            info: {
                title: 'Great Song',
                author: 'Good Artist',
                duration: 250000,
            },
        };

        const annoyingSong = {
            info: {
                title: 'Irrelevant Annoying Song',
                author: 'Random Artist',
                duration: 200000,
                identifier: 'annoying_id',
            },
        };

        // User skipped annoyingSong in 20 seconds
        context.recordTrackSkip(annoyingSong, 20000);

        const candidates = [
            annoyingSong,
            { info: { title: 'Irrelevant Annoying Song', author: 'Random Artist', duration: 200000, identifier: 'annoying_id' } },
            { info: { title: 'Another Good Track', author: 'Good Artist', duration: 240000, identifier: 'good_track_1' } },
        ];

        const { validCandidates } = filterCandidates(candidates, context);
        assert.strictEqual(validCandidates.length, 1, 'Expected early skipped song to be rejected');
        assert.strictEqual(validCandidates[0].info.title, 'Another Good Track');
    });

    it('should train hearing pattern on completed tracks and boost preferred vibes in scoring', () => {
        const context = new ListeningSessionContext('test_guild_vibe_train');
        const romanticSong = {
            info: {
                title: 'Enna Sona Romantic Song',
                author: 'Arijit Singh',
                duration: 210000,
            },
        };

        // User listens to romantic song completely
        context.recordTrackCompletion(romanticSong);

        // Hearing pattern should now include preferred vibes/artists
        assert.ok(context.listeningProfile.preferredArtists.get('arijit singh') >= 1);
        assert.ok(context.explicitLikes.has('arijit singh'));

        const seed = {
            info: {
                title: 'Kesariya',
                author: 'Arijit Singh',
                duration: 260000,
            },
        };

        const candidates = [
            {
                info: {
                    title: 'Tum Hi Ho Love Song',
                    author: 'Arijit Singh',
                    duration: 260000,
                },
                recommendationSource: 'youtube_mix',
            },
            {
                info: {
                    title: 'Party Hard EDM Beats',
                    author: 'Club DJ',
                    duration: 260000,
                },
                recommendationSource: 'youtube_mix',
            },
        ];

        const ranked = candidateScorer.scoreAndRankCandidates(candidates, seed, context);
        assert.strictEqual(ranked[0].info.title, 'Tum Hi Ho Love Song');
        assert.ok(ranked[0].autoplayScore > ranked[1].autoplayScore + 20, 'Expected preferred hearing pattern track to score substantially higher');
    });
});
