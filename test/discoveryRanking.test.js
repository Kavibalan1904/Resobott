const { describe, it } = require('node:test');
const assert = require('node:assert');

const { DJService } = require('../src/ai/djService');
const { feedbackStore } = require('../src/ai/feedbackStore');

describe('Track Filtering and Deduplication', () => {
    const djService = new DJService({ provider: null });

    it('should canonicalize track titles and remove video fluff', () => {
        const title1 = djService.canonicalizeTitle('Rowdy Baby (Official Video) [4K Remastered]');
        const title2 = djService.canonicalizeTitle('Rowdy Baby - Full Audio Song');
        assert.strictEqual(title1, 'rowdy baby');
        assert.strictEqual(title2, 'rowdy baby');
    });

    it('should deduplicate multiple video variations of the same track', () => {
        const tracks = [
            { info: { title: 'Rowdy Baby (Official Video)', uri: 'http://yt/1', author: 'Dhanush', duration: 240000 } },
            { info: { title: 'Rowdy Baby [Audio]', uri: 'http://yt/2', author: 'Dhanush', duration: 240000 } },
            { info: { title: 'Rowdy Baby - 4K Video Song', uri: 'http://yt/3', author: 'Dhanush', duration: 240000 } },
            { info: { title: 'Vaathi Coming', uri: 'http://yt/4', author: 'Anirudh', duration: 210000 } },
        ];

        const intent = { mood: 'party', excludedTerms: [] };
        const result = djService.filterAndDeduplicate(tracks, intent, null, 'g1');

        assert.strictEqual(result.length, 2);
        assert.ok(result.some(t => t.info.title.includes('Rowdy Baby')));
        assert.ok(result.some(t => t.info.title.includes('Vaathi Coming')));
    });

    it('should filter out tracks matching excluded terms', () => {
        const tracks = [
            { info: { title: 'Kanave Kanave - Sad Song', uri: 'http://yt/1', author: 'Anirudh', duration: 180000 } },
            { info: { title: 'Why This Kolaveri Di - Party Mix', uri: 'http://yt/2', author: 'Anirudh', duration: 240000 } },
            { info: { title: 'Sad Romance Instrumental', uri: 'http://yt/3', author: 'Ji Pyeong Kwon', duration: 200000 } },
        ];

        const intent = { mood: 'party', excludedTerms: ['sad', 'romance'] };
        const result = djService.filterAndDeduplicate(tracks, intent, null, 'g1');

        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].info.title, 'Why This Kolaveri Di - Party Mix');
    });

    it('should filter out live streams when not requested, and reject out-of-bounds durations', () => {
        const tracks = [
            { info: { title: '24/7 Lofi Radio Live', uri: 'http://yt/1', author: 'Lofi Girl', isStream: true, duration: 0 } },
            { info: { title: 'Super Short Ringtone', uri: 'http://yt/2', author: 'Unknown', duration: 15000 } }, // 15s < 30s
            { info: { title: '10 Hours of Rain Sounds', uri: 'http://yt/3', author: 'Relax', duration: 36000000 } }, // 10h > 20m
            { info: { title: 'Normal Chill Track', uri: 'http://yt/4', author: 'Artist', duration: 180000 } },
        ];

        const intent = { mood: 'chill', excludedTerms: [] };
        const result = djService.filterAndDeduplicate(tracks, intent, null, 'g1');

        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].info.title, 'Normal Chill Track');
    });

    it('should filter out non-music video uploads (full movies, comedy scenes, trailers)', () => {
        const tracks = [
            { info: { title: 'Karuppu (2008) Tamil Full Movie HD', uri: 'http://yt/1', author: 'MovieChannel', duration: 7200000 } },
            { info: { title: 'Karuppu Movie Comedy Scenes', uri: 'http://yt/2', author: 'MovieChannel', duration: 360000 } },
            { info: { title: 'Karuppu Official Teaser', uri: 'http://yt/3', author: 'MovieChannel', duration: 60000 } },
            { info: { title: 'Karuppu - Kannukulla Nikkira Audio Song', uri: 'http://yt/4', author: 'Sony Music South', duration: 250000 } },
            { info: { title: 'Karuppu (Title Track)', uri: 'http://yt/5', author: 'Sony Music South', duration: 210000 } },
        ];

        const intent = { mood: 'soundtrack', excludedTerms: [] };
        const result = djService.filterAndDeduplicate(tracks, intent, null, 'g1');

        assert.strictEqual(result.length, 2);
        assert.ok(result.some(t => t.info.title.includes('Kannukulla Nikkira')));
        assert.ok(result.some(t => t.info.title.includes('Title Track')));
    });

    it('should preserve distinct songs from the same movie or artist with different subtitles/durations', () => {
        const tracks = [
            { info: { title: 'Karuppu (Kannukulla Nikkira)', uri: 'http://yt/1', author: 'Sony Music South', duration: 250000 } },
            { info: { title: 'Karuppu (Title Track)', uri: 'http://yt/2', author: 'Sony Music South', duration: 210000 } },
            { info: { title: 'Karuppu (Theme Music)', uri: 'http://yt/3', author: 'Sony Music South', duration: 110000 } },
        ];

        const intent = { mood: 'soundtrack', excludedTerms: [] };
        const result = djService.filterAndDeduplicate(tracks, intent, null, 'g1');

        assert.strictEqual(result.length, 3);
    });

    it('should filter out completely unrelated tracks when specific artist is requested', () => {
        const candidateTracks = [
            { info: { title: 'Theekkoluthi', author: 'Nivas K Prasanna', uri: 'http://yt/1', duration: 365000 } },
            { info: { title: 'Uyire Un Uyirena (From "Zero")', author: 'Nivas K. Prasanna', uri: 'http://yt/2', duration: 285000 } },
            { info: { title: 'Imaithidathe', author: 'Nivas K Prasanna', uri: 'http://yt/3', duration: 223000 } },
            { info: { title: 'Thennaadu (From "Bison")', author: 'Nivas K Prasanna', uri: 'http://yt/4', duration: 302000 } },
            { info: { title: 'Vinmeen Vithaiyil', author: 'Nivas K Prasanna', uri: 'http://yt/5', duration: 290000 } },
            { info: { title: 'Neeyum Naanum', author: 'Nivas K Prasanna', uri: 'http://yt/6', duration: 275000 } },
            { info: { title: 'Melody (feat. MC Mushti)', author: 'M.H.R', uri: 'http://yt/7', duration: 231000 } },
            { info: { title: 'Melody', author: 'DJ Swemex', uri: 'http://yt/8', duration: 312000 } },
            { info: { title: 'Vizhigalin Aruginil', author: 'Ramesh Vinayagam', uri: 'http://yt/9', duration: 328000 } },
        ];

        const intent = {
            intent: 'artist_playlist',
            artists: ['Nivas K Prasanna'],
            genres: ['melody'],
            mood: 'chill',
            trackCount: 6,
        };

        const result = djService.filterAndDeduplicate(candidateTracks, intent, null, 'g1');
        // Unrelated tracks (M.H.R, DJ Swemex, Ramesh Vinayagam) must be filtered out!
        assert.ok(!result.some(t => t.info.author === 'M.H.R'));
        assert.ok(!result.some(t => t.info.author === 'DJ Swemex'));
        assert.ok(!result.some(t => t.info.author === 'Ramesh Vinayagam'));
        assert.strictEqual(result.length, 6);
        assert.ok(result.every(t => t.info.author.includes('Nivas')));
    });

    it('should not penalize requested artist with diversity penalty and rank them top', () => {
        const candidateTracks = [
            { info: { title: 'Song A', author: 'Nivas K Prasanna', uri: 'http://yt/1', duration: 200000 } },
            { info: { title: 'Song B', author: 'Nivas K Prasanna', uri: 'http://yt/2', duration: 200000 } },
            { info: { title: 'Song C', author: 'Nivas K Prasanna', uri: 'http://yt/3', duration: 200000 } },
            { info: { title: 'Song D', author: 'Nivas K Prasanna', uri: 'http://yt/4', duration: 200000 } },
            { info: { title: 'Random Melody Track', author: 'OtherArtist', uri: 'http://yt/5', duration: 200000 } },
        ];

        const intent = {
            intent: 'artist_playlist',
            artists: ['Nivas K Prasanna'],
            genres: ['melody'],
            mood: 'chill',
            trackCount: 5,
        };

        const ranked = djService.rankTracks(candidateTracks, intent, 'g1', 'u1');
        // All Nivas K Prasanna songs should rank higher than OtherArtist
        const otherArtistIndex = ranked.findIndex(t => t.info.author === 'OtherArtist');
        assert.strictEqual(otherArtistIndex, 4, 'OtherArtist should be ranked last');
        for (let i = 0; i < 4; i++) {
            assert.strictEqual(ranked[i].info.author, 'Nivas K Prasanna');
        }
    });
});

describe('Mocked Search & Discovery', () => {
    const djService = new DJService({ provider: null });

    it('should boost tracks matching language and genre hints', () => {
        const tracks = [
            { info: { title: 'English Pop Anthem', uri: 'http://yt/1', author: 'Dua Lipa', duration: 200000 } },
            { info: { title: 'Tamil Melody Hit', uri: 'http://yt/2', author: 'Harris Jayaraj', duration: 250000 } },
        ];

        const intent = {
            languages: ['Tamil'],
            genres: ['Melody'],
            mood: 'chill',
            trackCount: 10,
        };

        const ranked = djService.rankTracks(tracks, intent, 'g1', 'u1');
        assert.strictEqual(ranked[0].info.title, 'Tamil Melody Hit');
    });

    it('should boost liked artists and penalize disliked artists via feedbackStore', () => {
        const guildId = 'test_guild_rank';
        const userId = 'test_user_rank';
        feedbackStore.clearPreferences(guildId, userId);

        feedbackStore.addLike(guildId, userId, 'Anirudh');
        feedbackStore.addDislike(guildId, userId, 'BadSinger');

        const tracks = [
            { info: { title: 'Awesome Track', uri: 'http://yt/1', author: 'BadSinger', duration: 200000 } },
            { info: { title: 'Great Track', uri: 'http://yt/2', author: 'Anirudh', duration: 200000 } },
        ];

        const intent = { mood: 'party', trackCount: 5 };
        const ranked = djService.rankTracks(tracks, intent, guildId, userId);

        assert.strictEqual(ranked[0].info.author, 'Anirudh');
        assert.strictEqual(ranked[1].info.author, 'BadSinger');
    });

    it('should boost tracks matching specific query keywords (e.g. movie name)', () => {
        const tracks = [
            { info: { title: 'Random Song', uri: 'http://yt/1', author: 'Singer', duration: 200000 } },
            { info: { title: 'Karuppu Kannukulla Nikkira', uri: 'http://yt/2', author: 'Singer', duration: 250000 } },
        ];

        const intent = {
            mood: 'soundtrack',
            searchQueries: ['karuppu movie songs', 'karuppu songs'],
            trackCount: 10,
        };

        const ranked = djService.rankTracks(tracks, intent, 'g1', 'u1');
        assert.strictEqual(ranked[0].info.title, 'Karuppu Kannukulla Nikkira');
    });
});

describe('Mocked Search & Discovery', () => {
    it('should search Lavalink player and return ranked playlist', async () => {
        const mockPlayer = {
            search: async ({ query }) => {
                return {
                    tracks: [
                        { info: { title: `${query} Song 1`, uri: `http://yt/1`, author: 'Artist A', duration: 200000 } },
                        { info: { title: `${query} Song 2`, uri: `http://yt/2`, author: 'Artist B', duration: 220000 } },
                    ],
                };
            },
        };

        const djService = new DJService({ provider: null });
        const intent = {
            intent: 'mood_playlist',
            mood: 'chill',
            languages: ['Tamil'],
            searchQueries: ['Tamil chill hits', 'Tamil 2000s melodies'],
            trackCount: 5,
        };

        const result = await djService.discoverAndRankTracks(mockPlayer, intent, { id: 'u123', username: 'Tester' }, 'g123');

        assert.ok(result.tracks.length > 0);
        assert.strictEqual(result.tracks[0].requester.id, 'u123');
        assert.ok(result.tracks.length <= 5);
    });

    it('should handle search timeout gracefully without crashing', async () => {
        const mockPlayer = {
            search: async () => {
                // simulate hanging search
                await new Promise(r => setTimeout(r, 100));
                return { tracks: [] };
            },
        };

        const djService = new DJService({ provider: null });
        const res = await djService._searchWithTimeout(mockPlayer, 'slow query', {}, 10);
        assert.deepStrictEqual(res, []);
    });

    it('should trigger emergency raw fallback search when initial queries yield 0 tracks', async () => {
        let searchedQueries = [];
        const mockPlayer = {
            search: async ({ query }) => {
                searchedQueries.push(query);
                if (query.includes('karuppu movie songs')) {
                    return {
                        tracks: [
                            { info: { title: 'Karuppu Kannukulla Nikkira', uri: 'http://yt/1', author: 'Sony Music South', duration: 250000 } },
                            { info: { title: 'Karuppu Title Track', uri: 'http://yt/2', author: 'Sony Music South', duration: 210000 } },
                        ],
                    };
                }
                return { tracks: [] };
            },
        };

        const djService = new DJService({ provider: null });
        const intent = {
            intent: 'playlist',
            mood: 'soundtrack',
            rawRequest: 'karuppu movie songs',
            searchQueries: ['unmatched query 1', 'unmatched query 2'],
            trackCount: 5,
        };

        const result = await djService.discoverAndRankTracks(mockPlayer, intent, { id: 'u123', username: 'Tester' }, 'g123');

        assert.strictEqual(result.tracks.length, 2);
        assert.ok(searchedQueries.includes('karuppu movie songs'));
    });
});
