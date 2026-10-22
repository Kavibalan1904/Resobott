const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
    savePlaylist,
    getPlaylist,
    getUserPlaylists,
    deletePlaylist,
    loadPlaylists
} = require('../src/utils/playlistStore');
const playlistCommand = require('../src/commands/music/playlist');

describe('Playlist Command & Storage Verification', () => {
    const testUserId = 'test_user_999';
    const testPlaylistName = 'Chill Vibes';

    afterEach(() => {
        deletePlaylist(testUserId, testPlaylistName);
        deletePlaylist(testUserId, 'Road Trip');
    });

    it('should export valid command structure, subcommands, and aliases', () => {
        assert.ok(playlistCommand.data, 'Missing command data');
        assert.strictEqual(playlistCommand.data.name, 'playlist');
        assert.strictEqual(playlistCommand.category, 'music');
        assert.ok(Array.isArray(playlistCommand.aliases));
        assert.ok(playlistCommand.aliases.includes('pl'));
        assert.ok(playlistCommand.aliases.includes('playlists'));
        assert.strictEqual(typeof playlistCommand.execute, 'function');
    });

    it('playlistStore should save, retrieve, list, and delete user playlists', () => {
        const mockTracks = [
            { title: 'Song 1', author: 'Artist 1', uri: 'https://youtube.com/1', duration: 180000 },
            { title: 'Song 2', author: 'Artist 2', uri: 'https://youtube.com/2', duration: 240000 },
        ];

        // Save
        const saved = savePlaylist(testUserId, testPlaylistName, mockTracks);
        assert.strictEqual(saved.name, testPlaylistName);
        assert.strictEqual(saved.tracks.length, 2);

        // Case-insensitive retrieval
        const retrieved = getPlaylist(testUserId, 'chill vibes');
        assert.ok(retrieved);
        assert.strictEqual(retrieved.name, testPlaylistName);
        assert.strictEqual(retrieved.tracks.length, 2);

        // List
        const list = getUserPlaylists(testUserId);
        assert.strictEqual(list.length, 1);
        assert.strictEqual(list[0].name, testPlaylistName);
        assert.strictEqual(list[0].trackCount, 2);

        // Delete
        const deleted = deletePlaylist(testUserId, 'CHILL VIBES');
        assert.strictEqual(deleted, true);
        assert.strictEqual(getPlaylist(testUserId, testPlaylistName), null);
    });

    it('should reject /playlist save if no songs are playing or in the queue', async () => {
        let replyData = null;
        const mockInteraction = {
            guild: { id: 'g1' },
            user: { id: testUserId },
            options: {
                getSubcommand: () => 'save',
                getString: () => 'My Playlist',
            },
            reply: async (data) => {
                replyData = data;
                return data;
            },
        };

        const mockClient = {
            lavalink: {
                getPlayer: () => null,
            },
        };

        await playlistCommand.execute(mockInteraction, mockClient);
        assert.ok(replyData);
        assert.ok(replyData.embeds[0].data.description.includes('no songs currently playing'));
    });

    it('should save current and queued tracks on /playlist save', async () => {
        let replyData = null;
        const mockPlayer = {
            queue: {
                current: { info: { title: 'Current Song', author: 'Artist A', uri: 'https://youtube.com/a', duration: 200000 } },
                tracks: [
                    { info: { title: 'Queued Song 1', author: 'Artist B', uri: 'https://youtube.com/b', duration: 180000 } },
                ],
            },
        };

        const mockInteraction = {
            guild: { id: 'g1' },
            user: { id: testUserId, username: 'Tester' },
            options: {
                getSubcommand: () => 'save',
                getString: () => 'Road Trip',
            },
            reply: async (data) => {
                replyData = data;
                return data;
            },
        };

        const mockClient = {
            lavalink: {
                getPlayer: () => mockPlayer,
            },
        };

        await playlistCommand.execute(mockInteraction, mockClient);
        assert.ok(replyData);
        assert.ok(replyData.embeds[0].data.description.includes('Successfully saved **2** songs'));

        const saved = getPlaylist(testUserId, 'Road Trip');
        assert.ok(saved);
        assert.strictEqual(saved.tracks.length, 2);
        assert.strictEqual(saved.tracks[0].title, 'Current Song');
    });

    it('should reject /playlist load if user is not in a voice channel', async () => {
        let replyData = null;
        const mockInteraction = {
            guild: { id: 'g1' },
            user: { id: testUserId },
            member: { voice: { channel: null } },
            options: {
                getSubcommand: () => 'load',
                getString: () => 'Road Trip',
            },
            reply: async (data) => {
                replyData = data;
                return data;
            },
        };

        await playlistCommand.execute(mockInteraction, {});
        assert.ok(replyData);
        assert.ok(replyData.embeds[0].data.description.includes('voice channel'));
    });

    it('should reject /playlist load if playlist does not exist', async () => {
        let replyData = null;
        const mockInteraction = {
            guild: { id: 'g1' },
            user: { id: testUserId },
            member: { voice: { channel: { id: 'vc1' } } },
            options: {
                getSubcommand: () => 'load',
                getString: () => 'NonexistentPlaylist',
            },
            reply: async (data) => {
                replyData = data;
                return data;
            },
        };

        await playlistCommand.execute(mockInteraction, {});
        assert.ok(replyData);
        assert.ok(replyData.embeds[0].data.description.includes('was not found'));
    });

    it('should list and delete user playlists via /playlist list and /playlist delete', async () => {
        savePlaylist(testUserId, 'Road Trip', [{ title: 'Track 1' }]);

        let listReply = null;
        const mockListInteraction = {
            guild: { id: 'g1' },
            user: { id: testUserId, username: 'Tester' },
            options: {
                getSubcommand: () => 'list',
            },
            reply: async (data) => {
                listReply = data;
                return data;
            },
        };

        await playlistCommand.execute(mockListInteraction, {});
        assert.ok(listReply);
        assert.ok(listReply.embeds[0].data.description.includes('Road Trip'));

        let deleteReply = null;
        const mockDeleteInteraction = {
            guild: { id: 'g1' },
            user: { id: testUserId },
            options: {
                getSubcommand: () => 'delete',
                getString: () => 'Road Trip',
            },
            reply: async (data) => {
                deleteReply = data;
                return data;
            },
        };

        await playlistCommand.execute(mockDeleteInteraction, {});
        assert.ok(deleteReply);
        assert.ok(deleteReply.embeds[0].data.description.includes('Successfully deleted'));
        assert.strictEqual(getPlaylist(testUserId, 'Road Trip'), null);
    });
});
