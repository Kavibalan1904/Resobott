const { describe, it } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');

const { setupLavalinkEvents } = require('../src/handlers/playerEvents');

describe('Queue Progression & Auto-Advance Regression Tests', () => {
    function createMockSetup() {
        const emitter = new EventEmitter();
        const client = {
            lavalink: emitter,
            trackHistory: new Map(),
            channels: { cache: new Map() },
            user: { setPresence: () => {} },
            autoplayGuilds: new Set(),
            activeAutoplayResolutions: new Set(),
        };
        emitter.nodeManager = new EventEmitter();
        emitter.nodeManager.nodes = new Map();
        emitter.players = new Map();

        setupLavalinkEvents(client);
        return { client, manager: emitter };
    }

    it('should call player.play() to advance to the next track when a track finishes normally', async () => {
        const { manager } = createMockSetup();

        let playCalled = 0;
        let skipCalled = 0;

        const track1 = { info: { title: 'Track 1', uri: 'uri:1' } };
        const track2 = { info: { title: 'Track 2', uri: 'uri:2' } };
        const track3 = { info: { title: 'Track 3', uri: 'uri:3' } };

        const mockPlayer = {
            guildId: 'guild_123',
            playing: true,
            paused: false,
            destroyed: false,
            connected: true,
            node: { id: 'primary-main', connected: true },
            queue: {
                current: track2, // In lavalink-client, queueTrackEnd already shifted track2 into current
                tracks: [track3],
            },
            get: () => 0,
            play: async () => {
                playCalled++;
            },
            skip: async () => {
                skipCalled++;
            },
            stopPlaying: async () => {},
        };

        // Simulate TrackEndEvent with reason = 'finished'
        manager.emit('trackEnd', mockPlayer, track1, { reason: 'finished' });

        // Allow microtasks to complete
        await new Promise(r => setTimeout(r, 50));

        assert.strictEqual(playCalled, 1, 'Expected player.play() to be called for track2');
        assert.strictEqual(skipCalled, 0, 'player.skip() should NOT be called on normal track completion');
    });

    it('should call player.play() to start next track when a track is skipped (reason: stopped)', async () => {
        const { manager } = createMockSetup();

        let playCalled = 0;
        const track1 = { info: { title: 'Track 1', uri: 'uri:1' } };
        const track2 = { info: { title: 'Track 2', uri: 'uri:2' } };

        const mockPlayer = {
            guildId: 'guild_456',
            playing: false,
            paused: false,
            destroyed: false,
            connected: true,
            node: { id: 'primary-main', connected: true },
            queue: {
                current: track2,
                tracks: [],
            },
            get: () => 0,
            play: async () => {
                playCalled++;
            },
            stopPlaying: async () => {},
        };

        manager.emit('trackEnd', mockPlayer, track1, { reason: 'stopped' });
        await new Promise(r => setTimeout(r, 50));

        assert.strictEqual(playCalled, 1, 'Expected player.play() to start next track after skip (stopped)');
    });

    it('should discard broken track and play next track on trackError', async () => {
        const { manager } = createMockSetup();

        let playCalled = 0;
        const brokenTrack = { info: { title: 'Broken Track', uri: 'uri:broken' } };
        const nextTrack = { info: { title: 'Next Healthy Track', uri: 'uri:healthy' } };

        const mockPlayer = {
            guildId: 'guild_789',
            playing: false,
            paused: false,
            destroyed: false,
            connected: true,
            node: { id: 'primary-main', connected: true },
            queue: {
                current: brokenTrack,
                tracks: [nextTrack],
            },
            get: () => 0,
            search: async () => ({ tracks: [] }), // retry fails
            play: async () => {
                playCalled++;
            },
            stopPlaying: async () => {},
        };

        manager.emit('trackError', mockPlayer, brokenTrack, { exception: { message: 'Decode error' } });
        await new Promise(r => setTimeout(r, 50));

        assert.strictEqual(mockPlayer.queue.current, nextTrack, 'Expected queue.current to advance to nextTrack');
        assert.strictEqual(playCalled, 1, 'Expected player.play() to be called for nextTrack');
    });

    it('should retry via scsearch (SoundCloud) first on YouTube login errors and play resolved track', async () => {
        const { client, manager } = createMockSetup();

        let playedTrack = null;
        const searchSources = [];
        const loginBlockedTrack = { info: { title: 'Megham Karukatha', author: 'Anirudh', uri: 'uri:yt_blocked' } };
        const scTrack = { info: { title: 'Megham Karukatha', author: 'Anirudh', sourceName: 'soundcloud', uri: 'uri:sc_resolved' } };

        const mockPlayer = {
            guildId: 'guild_login_test',
            playing: false,
            paused: false,
            destroyed: false,
            connected: true,
            node: { id: 'primary-main', connected: true },
            queue: {
                current: loginBlockedTrack,
                tracks: [],
            },
            get: () => 0,
            search: async ({ source }) => {
                searchSources.push(source);
                if (source === 'scsearch') {
                    return { tracks: [scTrack] };
                }
                return { tracks: [] };
            },
            play: async (opt) => {
                playedTrack = opt?.clientTrack;
            },
            stopPlaying: async () => {},
        };

        const errorPayload = {
            exception: {
                message: 'All clients failed to load the item. Client [ANDROID_MUSIC] failed: This video requires login.',
            },
        };

        manager.emit('trackError', mockPlayer, loginBlockedTrack, errorPayload);
        await new Promise(r => setTimeout(r, 60));

        assert.strictEqual(searchSources[0], 'scsearch', 'Expected first retry attempt to be scsearch due to YouTube login block');
        assert.strictEqual(playedTrack, scTrack, 'Expected player.play to be called with resolved SoundCloud track');
    });

    it('should display helpful tip suggesting SoundCloud/Spotify when all retries fail on YouTube login errors', async () => {
        const { client, manager } = createMockSetup();

        let sentEmbed = null;
        const mockChannel = {
            send: async ({ embeds }) => {
                sentEmbed = embeds?.[0];
            },
        };
        client.channels.cache.set('channel_123', mockChannel);

        const loginBlockedTrack = { info: { title: 'Megham Karukatha', author: 'Anirudh', uri: 'uri:all_fail' } };
        const mockPlayer = {
            guildId: 'guild_tip_test',
            textChannelId: 'channel_123',
            playing: false,
            paused: false,
            destroyed: false,
            connected: true,
            node: { id: 'primary-main', connected: true },
            queue: {
                current: loginBlockedTrack,
                tracks: [],
            },
            get: () => 0,
            getData: () => undefined,
            setData: () => {},
            search: async () => ({ tracks: [] }), // all retries fail
            play: async () => {},
            stopPlaying: async () => {},
        };

        const errorPayload = {
            exception: {
                message: 'All clients failed to load the item. Client [ANDROID_MUSIC] failed: This video requires login.',
            },
        };

        manager.emit('trackError', mockPlayer, loginBlockedTrack, errorPayload);
        await new Promise(r => setTimeout(r, 60));

        assert.ok(sentEmbed, 'Expected error embed to be sent');
        const desc = sentEmbed.data?.description || '';
        assert.ok(desc.includes('YouTube is currently restricting playback'), 'Expected description to include helpful tip about YouTube restrictions');
        assert.ok(desc.includes('SoundCloud'), 'Expected description to mention SoundCloud workaround');
    });
});
