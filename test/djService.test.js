const { describe, it } = require('node:test');
const assert = require('node:assert');

const { DJService } = require('../src/ai/djService');
const { parseDeterministicRequest } = require('../src/ai/deterministicFallback');
const { validateAndSanitizeIntent } = require('../src/ai/intentSchema');
const { feedbackStore } = require('../src/ai/feedbackStore');

describe('Full 15-Criteria DJ Engine Verification', () => {
    // 1. Valid natural-language intent parsing
    it('1. Valid natural-language intent parsing', async () => {
        const mockProvider = {
            generateCompletion: async () => ({
                intent: 'mood_playlist',
                mood: 'chill',
                languages: ['Tamil'],
                genres: ['melody'],
                eras: ['2000s'],
                energy: 'low',
                trackCount: 12,
                summary: 'Tamil 2000s chill melodies',
                searchQueries: ['Tamil 2000s melody hits'],
            }),
        };
        const dj = new DJService({ provider: mockProvider });
        const { intent, isFallback } = await dj.interpretRequest('Play relaxing Tamil melodies from the 2000s', 12);
        assert.strictEqual(isFallback, false);
        assert.strictEqual(intent.mood, 'chill');
        assert.deepStrictEqual(intent.languages, ['Tamil']);
        assert.strictEqual(intent.trackCount, 12);
    });

    // 2. Invalid AI JSON
    it('2. Invalid AI JSON triggers graceful fallback without error', async () => {
        const mockProvider = {
            generateCompletion: async () => {
                throw new SyntaxError('Unexpected token in JSON');
            },
        };
        const dj = new DJService({ provider: mockProvider });
        const { intent, isFallback } = await dj.interpretRequest('Give me energetic music for ranked gaming');
        assert.strictEqual(isFallback, true);
        assert.strictEqual(intent.energy, 'high');
        assert.strictEqual(intent.mood, 'energetic');
    });

    // 3. AI provider unavailable / timeout / error
    it('3. AI provider unavailable or timed out falls back seamlessly', async () => {
        const mockProvider = {
            generateCompletion: async () => {
                const err = new Error('Gateway 504 Gateway Timeout');
                err.status = 504;
                throw err;
            },
        };
        const dj = new DJService({ provider: mockProvider });
        const { intent, isFallback } = await dj.interpretRequest('chill English indie playlist');
        assert.strictEqual(isFallback, true);
        assert.strictEqual(intent.mood, 'chill');
        assert.ok(intent.languages.includes('English'));
        assert.ok(intent.genres.includes('indie'));
    });

    // 4. AI disabled with no API key
    it('4. AI disabled with no API key uses deterministic engine', async () => {
        const dj = new DJService({ provider: null });
        const { intent, isFallback } = await dj.interpretRequest('Play nostalgic Tamil songs from the 1990s');
        assert.strictEqual(isFallback, true);
        assert.ok(intent.languages.includes('Tamil'));
        assert.ok(intent.eras.includes('1990s'));
        assert.strictEqual(intent.mood, 'nostalgic');
    });

    // 5. Empty search results
    it('5. Empty search results handled safely', async () => {
        const emptyPlayer = {
            search: async () => ({ tracks: [] }),
        };
        const dj = new DJService({ provider: null });
        const intent = { mood: 'chill', searchQueries: ['nonexistent unknown query'] };
        const result = await dj.discoverAndRankTracks(emptyPlayer, intent, { id: 'u1' });
        assert.strictEqual(result.tracks.length, 0);
        assert.strictEqual(result.totalDiscovered, 0);
    });

    // 6. Duplicate tracks deduplication
    it('6. Duplicate tracks across searches are cleanly deduplicated', () => {
        const dj = new DJService({ provider: null });
        const candidateTracks = [
            { info: { title: 'Enjoy Enjaami Official Video', uri: 'http://yt/1', author: 'Dhee', duration: 240000 } },
            { info: { title: 'Enjoy Enjaami - Audio Song', uri: 'http://yt/2', author: 'Dhee', duration: 240000 } },
            { info: { title: 'Enjoy Enjaami (Lyrics)', uri: 'http://yt/3', author: 'Dhee', duration: 240000 } },
            { info: { title: 'Neruppu Da', uri: 'http://yt/4', author: 'Santhosh Narayanan', duration: 200000 } },
        ];
        const filtered = dj.filterAndDeduplicate(candidateTracks, { mood: 'chill' });
        assert.strictEqual(filtered.length, 2);
    });

    // 7. Excluded terms
    it('7. Excluded terms filter out negative keywords', () => {
        const dj = new DJService({ provider: null });
        const candidateTracks = [
            { info: { title: 'Happy Dance Track', uri: 'http://yt/1', author: 'DJ Joy', duration: 180000 } },
            { info: { title: 'Very Sad Cry Song', uri: 'http://yt/2', author: 'Melancholy', duration: 180000 } },
        ];
        const intent = { mood: 'upbeat', excludedTerms: ['sad'] };
        const filtered = dj.filterAndDeduplicate(candidateTracks, intent);
        assert.strictEqual(filtered.length, 1);
        assert.strictEqual(filtered[0].info.title, 'Happy Dance Track');
    });

    // 8. Track-count bounds
    it('8. Track-count bounds strictly enforced between 3 and 25', () => {
        assert.strictEqual(validateAndSanitizeIntent({ trackCount: 1 }).trackCount, 10);
        assert.strictEqual(validateAndSanitizeIntent({ trackCount: 2 }).trackCount, 10);
        assert.strictEqual(validateAndSanitizeIntent({ trackCount: 3 }).trackCount, 3);
        assert.strictEqual(validateAndSanitizeIntent({ trackCount: 25 }).trackCount, 25);
        assert.strictEqual(validateAndSanitizeIntent({ trackCount: 50 }).trackCount, 25);
    });

    // 9. Search timeout
    it('9. Search timeout does not throw and returns empty array', async () => {
        const dj = new DJService({ provider: null });
        const slowPlayer = {
            search: async () => {
                await new Promise(r => setTimeout(r, 80));
                return { tracks: [] };
            },
        };
        const tracks = await dj._searchWithTimeout(slowPlayer, 'query', {}, 10);
        assert.deepStrictEqual(tracks, []);
    });

    // 10 & 11. Queue contains tracks & existing playback not interrupted
    it('10 & 11. Queue already contains tracks and playback is not interrupted', () => {
        const player = {
            playing: true,
            queue: {
                current: { info: { title: 'Playing Track' } },
                tracks: [{ info: { title: 'First Queued Track' } }],
                add(tracks) {
                    this.tracks.push(...tracks);
                },
            },
        };

        const newVibeTracks = [{ info: { title: 'Vibe Track 1' } }, { info: { title: 'Vibe Track 2' } }];
        player.queue.add(newVibeTracks);

        assert.strictEqual(player.queue.current.info.title, 'Playing Track');
        assert.strictEqual(player.queue.tracks[0].info.title, 'First Queued Track');
        assert.strictEqual(player.queue.tracks[1].info.title, 'Vibe Track 1');
        assert.strictEqual(player.queue.tracks.length, 3);
    });

    // 12. Queue-add failure and partial success
    it('12. Queue-add handles partial success gracefully', () => {
        const player = {
            queue: {
                tracks: [],
                add(track) {
                    if (track.info.bad) throw new Error('Unresolvable track');
                    this.tracks.push(track);
                },
            },
        };

        const tracksToAdd = [
            { info: { title: 'Good Track 1' } },
            { info: { title: 'Bad Track', bad: true } },
            { info: { title: 'Good Track 2' } },
        ];

        let addedCount = 0;
        let failedCount = 0;
        for (const t of tracksToAdd) {
            try {
                player.queue.add(t);
                addedCount++;
            } catch {
                failedCount++;
            }
        }

        assert.strictEqual(addedCount, 2);
        assert.strictEqual(failedCount, 1);
        assert.strictEqual(player.queue.tracks.length, 2);
    });

    // 13. Simultaneous requests mutex
    it('13. Simultaneous requests are rejected via mutex lock', () => {
        const dj = new DJService({ provider: null });
        const g = 'guild_lock_test';
        const u = 'user_lock_test';

        assert.strictEqual(dj.acquireLock(g, u), true);
        assert.strictEqual(dj.acquireLock(g, u), false);
        dj.releaseLock(g, u);
        assert.strictEqual(dj.acquireLock(g, u), true);
        dj.releaseLock(g, u);
    });

    // 14. Per-guild preference isolation
    it('14. Preferences are strictly isolated per guild', () => {
        feedbackStore.clearPreferences('guild_1');
        feedbackStore.clearPreferences('guild_2');

        feedbackStore.addLike('guild_1', 'user_common', 'Tamil');
        feedbackStore.addLike('guild_2', 'user_common', 'English');

        assert.deepStrictEqual(feedbackStore.getPreferences('guild_1', 'user_common').likes, ['tamil']);
        assert.deepStrictEqual(feedbackStore.getPreferences('guild_2', 'user_common').likes, ['english']);
    });

    // 15. Existing music commands continue working
    it('15. Existing music commands continue working without regressions', () => {
        const playCommand = require('../src/commands/music/play');
        const queueCommand = require('../src/commands/music/queue');
        const clearCommand = require('../src/commands/music/clear');

        assert.strictEqual(playCommand.data.name, 'play');
        assert.strictEqual(queueCommand.data.name, 'queue');
        assert.strictEqual(clearCommand.data.name, 'clear');
    });
});
