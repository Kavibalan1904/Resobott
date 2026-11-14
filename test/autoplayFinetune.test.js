const { describe, it } = require('node:test');
const assert = require('node:assert');

const { filterCandidates, DEVOTIONAL_PATTERNS } = require('../src/autoplay/filter');
const { candidateScorer } = require('../src/autoplay/scorer');
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
});
