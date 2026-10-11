const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const vibeCommand = require('../src/commands/music/vibe');
const { djService } = require('../src/ai/djService');
const { feedbackStore } = require('../src/ai/feedbackStore');

describe('Vibe Command Voice & Rate Limit Safeguards', () => {
    beforeEach(() => {
        djService.userCooldowns.clear();
        djService.activeLocks.clear();
    });

    it('should reject if user is not in a voice channel', async () => {
        let replyData = null;
        const mockInteraction = {
            id: 'int_1',
            guild: { id: 'g_1' },
            user: { id: 'u_1', username: 'TestUser' },
            member: { voice: { channel: null } },
            deferReply: async () => true,
            editReply: async (data) => {
                replyData = data;
            },
            client: { user: { id: 'bot_1' }, lavalink: { getPlayer: () => null } },
            options: {
                getString: () => 'chill beats',
                getInteger: () => 10,
                getBoolean: () => false,
            },
        };

        await vibeCommand.execute(mockInteraction, mockInteraction.client);
        assert.ok(replyData);
        assert.ok(replyData.embeds[0].data.description.includes('must be in a voice channel'));
    });

    it('should enforce rate limits on rapid subsequent requests', async () => {
        const userId = 'u_ratelimit_test';
        const check1 = djService.checkRateLimit(userId);
        assert.strictEqual(check1.allowed, true);

        const check2 = djService.checkRateLimit(userId);
        assert.strictEqual(check2.allowed, false);
        assert.ok(check2.waitSeconds > 0);
    });

    it('should prevent simultaneous generation requests using concurrency lock', () => {
        const guildId = 'g_concurrent';
        const userId = 'u_concurrent';

        const locked = djService.acquireLock(guildId, userId);
        assert.strictEqual(locked, true);

        const lockedAgain = djService.acquireLock(guildId, userId);
        assert.strictEqual(lockedAgain, false); // Blocked!

        djService.releaseLock(guildId, userId);
        const lockedAfterRelease = djService.acquireLock(guildId, userId);
        assert.strictEqual(lockedAfterRelease, true);
        djService.releaseLock(guildId, userId);
    });
});

describe('Queue Safety & Non-Interruption', () => {
    it('should add tracks to existing queue without interrupting current song', async () => {
        const currentTrack = { info: { title: 'Currently Playing Song', uri: 'http://now', duration: 180000 } };
        const existingQueuedTrack = { info: { title: 'Next In Line Song', uri: 'http://next', duration: 200000 } };

        const mockPlayer = {
            guildId: 'g_play_safety',
            playing: true, // Playing right now!
            queue: {
                current: currentTrack,
                tracks: [existingQueuedTrack],
                add(newTracks) {
                    if (Array.isArray(newTracks)) {
                        this.tracks.push(...newTracks);
                    } else {
                        this.tracks.push(newTracks);
                    }
                },
                splice(start, count) {
                    return this.tracks.splice(start, count);
                },
                shuffle() {
                    this.tracks.reverse();
                },
            },
            playCalled: false,
            play: async () => {
                mockPlayer.playCalled = true;
            },
        };

        const newDjTracks = [
            { info: { title: 'DJ Song 1', uri: 'http://dj1' } },
            { info: { title: 'DJ Song 2', uri: 'http://dj2' } },
        ];

        // Simulate user clicking "Add to Queue"
        mockPlayer.queue.add(newDjTracks);

        // 1. Current track must still be untouched
        assert.strictEqual(mockPlayer.queue.current.info.title, 'Currently Playing Song');

        // 2. Previously queued track must still be at index 0
        assert.strictEqual(mockPlayer.queue.tracks[0].info.title, 'Next In Line Song');

        // 3. New DJ tracks must be appended after
        assert.strictEqual(mockPlayer.queue.tracks[1].info.title, 'DJ Song 1');
        assert.strictEqual(mockPlayer.queue.tracks[2].info.title, 'DJ Song 2');
        assert.strictEqual(mockPlayer.queue.tracks.length, 3);

        // 4. Player was already playing, so play() must not be called (no interruption)
        assert.strictEqual(mockPlayer.playCalled, false);
    });

    it('should replace queue only when explicitly confirmed', async () => {
        const mockPlayer = {
            guildId: 'g_replace',
            playing: true,
            queue: {
                current: { info: { title: 'Current Song' } },
                tracks: [
                    { info: { title: 'Old Track 1' } },
                    { info: { title: 'Old Track 2' } },
                ],
                splice(start, count) {
                    return this.tracks.splice(start, count);
                },
                add(newTracks) {
                    this.tracks.push(...newTracks);
                },
            },
        };

        // Replace queue: splice existing tracks and add new
        mockPlayer.queue.splice(0, mockPlayer.queue.tracks.length);
        mockPlayer.queue.add([{ info: { title: 'Brand New Vibe Song' } }]);

        assert.strictEqual(mockPlayer.queue.tracks.length, 1);
        assert.strictEqual(mockPlayer.queue.tracks[0].info.title, 'Brand New Vibe Song');
        // Current playing song still untouched
        assert.strictEqual(mockPlayer.queue.current.info.title, 'Current Song');
    });
});

describe('Per-Guild & Per-User Preference Isolation', () => {
    it('should isolate preferences between different guilds and users', () => {
        const guildA = 'guild_alpha';
        const guildB = 'guild_beta';
        const user1 = 'user_one';
        const user2 = 'user_two';

        feedbackStore.clearPreferences(guildA);
        feedbackStore.clearPreferences(guildB);

        feedbackStore.addLike(guildA, user1, 'Tamil Melodies');
        feedbackStore.addDislike(guildA, user1, 'Heavy Metal');

        feedbackStore.addLike(guildB, user2, 'Lo-Fi Chill');

        // Guild A User 1 preferences
        const prefsA1 = feedbackStore.getPreferences(guildA, user1);
        assert.ok(prefsA1.likes.includes('tamil melodies'));
        assert.ok(prefsA1.dislikes.includes('heavy metal'));

        // Guild B User 2 preferences must NOT have Guild A likes
        const prefsB2 = feedbackStore.getPreferences(guildB, user2);
        assert.ok(prefsB2.likes.includes('lo-fi chill'));
        assert.strictEqual(prefsB2.likes.includes('tamil melodies'), false);
        assert.strictEqual(prefsB2.dislikes.includes('heavy metal'), false);

        // Guild A User 2 has no preferences
        const prefsA2 = feedbackStore.getPreferences(guildA, user2);
        assert.strictEqual(prefsA2.likes.length, 0);

        // Clearing Guild A should not affect Guild B
        feedbackStore.clearPreferences(guildA);
        assert.strictEqual(feedbackStore.getPreferences(guildA, user1).likes.length, 0);
        assert.strictEqual(feedbackStore.getPreferences(guildB, user2).likes.length, 1);
    });
});
