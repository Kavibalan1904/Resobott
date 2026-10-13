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
});
