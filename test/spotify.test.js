const test = require('node:test');
const assert = require('node:assert/strict');
const { isSpotifyUrl, isUrl } = require('../src/utils/helpers');
const { parseSpotifyUrl, resolveSpotify } = require('../src/utils/spotifyResolver');

test('Spotify URL and URI Pattern Detection', async (t) => {
    await t.test('should identify track URLs', () => {
        assert.equal(isSpotifyUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'), true);
        assert.equal(isSpotifyUrl('http://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc'), true);
        assert.equal(isSpotifyUrl('open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'), true);
    });

    await t.test('should identify playlist and album URLs', () => {
        assert.equal(isSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'), true);
        assert.equal(isSpotifyUrl('https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa'), true);
    });

    await t.test('should identify international (intl-xx) URLs', () => {
        assert.equal(isSpotifyUrl('https://open.spotify.com/intl-es/track/4cOdK2wGLETKBW3PvgPWqT'), true);
        assert.equal(isSpotifyUrl('https://open.spotify.com/intl-pt/playlist/37i9dQZF1DXcBWIGoYBM5M'), true);
    });

    await t.test('should identify spotify URIs', () => {
        assert.equal(isSpotifyUrl('spotify:track:4cOdK2wGLETKBW3PvgPWqT'), true);
        assert.equal(isSpotifyUrl('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'), true);
        assert.equal(isSpotifyUrl('spotify:album:4m2880jivSbbyEGAKfITCa'), true);
    });

    await t.test('should identify short links (spotify.link and spoti.fi)', () => {
        assert.equal(isSpotifyUrl('https://spotify.link/AbCdEfGh'), true);
        assert.equal(isSpotifyUrl('https://spoti.fi/123456'), true);
    });

    await t.test('should reject non-spotify inputs', () => {
        assert.equal(isSpotifyUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), false);
        assert.equal(isSpotifyUrl('https://soundcloud.com/artist/track'), false);
        assert.equal(isSpotifyUrl('just a song title'), false);
        assert.equal(isSpotifyUrl(null), false);
        assert.equal(isSpotifyUrl(''), false);
    });

    await t.test('isUrl helper should recognize spotify URLs and URIs', () => {
        assert.equal(isUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'), true);
        assert.equal(isUrl('spotify:track:4cOdK2wGLETKBW3PvgPWqT'), true);
        assert.equal(isUrl('https://spotify.link/AbCdEfGh'), true);
        assert.equal(isUrl('https://spoti.fi/123456'), true);
    });
});

test('Spotify URL and URI Parser', async (t) => {
    await t.test('should parse standard track URL', () => {
        const parsed = parseSpotifyUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
        assert.deepEqual(parsed, { type: 'track', id: '4cOdK2wGLETKBW3PvgPWqT' });
    });

    await t.test('should parse track URL with query parameters', () => {
        const parsed = parseSpotifyUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=d89069d587c647b0');
        assert.deepEqual(parsed, { type: 'track', id: '4cOdK2wGLETKBW3PvgPWqT' });
    });

    await t.test('should parse playlist URL', () => {
        const parsed = parseSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
        assert.deepEqual(parsed, { type: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });
    });

    await t.test('should parse album URL', () => {
        const parsed = parseSpotifyUrl('https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa');
        assert.deepEqual(parsed, { type: 'album', id: '4m2880jivSbbyEGAKfITCa' });
    });

    await t.test('should parse artist URL', () => {
        const parsed = parseSpotifyUrl('https://open.spotify.com/artist/0gxyHStUsqpMadRV0Di1Qt');
        assert.deepEqual(parsed, { type: 'artist', id: '0gxyHStUsqpMadRV0Di1Qt' });
    });

    await t.test('should parse international URLs (intl-xx)', () => {
        const parsed = parseSpotifyUrl('https://open.spotify.com/intl-fr/track/4cOdK2wGLETKBW3PvgPWqT');
        assert.deepEqual(parsed, { type: 'track', id: '4cOdK2wGLETKBW3PvgPWqT' });
    });

    await t.test('should parse spotify URIs', () => {
        assert.deepEqual(parseSpotifyUrl('spotify:track:4cOdK2wGLETKBW3PvgPWqT'), { type: 'track', id: '4cOdK2wGLETKBW3PvgPWqT' });
        assert.deepEqual(parseSpotifyUrl('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'), { type: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });
        assert.deepEqual(parseSpotifyUrl('spotify:album:4m2880jivSbbyEGAKfITCa'), { type: 'album', id: '4m2880jivSbbyEGAKfITCa' });
    });

    await t.test('should return null on invalid inputs', () => {
        assert.equal(parseSpotifyUrl('https://youtube.com/watch?v=123'), null);
        assert.equal(parseSpotifyUrl('random string'), null);
        assert.equal(parseSpotifyUrl(''), null);
        assert.equal(parseSpotifyUrl(null), null);
    });
});

test('Spotify Resource Resolution Integration', async (t) => {
    await t.test('should resolve single track metadata correctly', async () => {
        const track = await resolveSpotify('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
        assert.ok(track, 'Track should resolve');
        assert.equal(track.type, 'track');
        assert.ok(track.title.toLowerCase().includes('never gonna give you up'));
        assert.ok(track.artist.toLowerCase().includes('rick astley'));
        assert.ok(track.searchQuery.length > 0);
        assert.ok(track.uri.includes('track/4cOdK2wGLETKBW3PvgPWqT'));
    });

    await t.test('should resolve Spotify URI track correctly', async () => {
        const track = await resolveSpotify('spotify:track:4cOdK2wGLETKBW3PvgPWqT');
        assert.ok(track, 'URI Track should resolve');
        assert.equal(track.type, 'track');
        assert.ok(track.title.toLowerCase().includes('never gonna give you up'));
    });

    await t.test('should resolve playlist metadata and track list correctly', async () => {
        const playlist = await resolveSpotify('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
        assert.ok(playlist, 'Playlist should resolve');
        assert.equal(playlist.type, 'playlist');
        assert.ok(playlist.name.length > 0);
        assert.ok(Array.isArray(playlist.tracks));
        assert.ok(playlist.tracks.length > 0, 'Playlist tracks should not be empty');
        assert.ok(playlist.tracks[0].title.length > 0);
        assert.ok(playlist.tracks[0].searchQuery.length > 0);
    });

    await t.test('should resolve album metadata and track list correctly', async () => {
        const album = await resolveSpotify('https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa');
        assert.ok(album, 'Album should resolve');
        assert.equal(album.type, 'playlist'); // Normalized to playlist structure for multi-track queueing
        assert.ok(album.name.length > 0);
        assert.ok(Array.isArray(album.tracks));
        assert.ok(album.tracks.length >= 10, 'Album should have multiple tracks');
    });
});

test('Music Command Integration Check for play and playnext', async (t) => {
    await t.test('play command should export valid structure and data', () => {
        const play = require('../src/commands/music/play');
        assert.ok(play.data, 'play.data should exist');
        assert.equal(play.data.name, 'play');
        assert.equal(typeof play.execute, 'function');
    });

    await t.test('playnext command should export valid structure and data', () => {
        const playnext = require('../src/commands/music/playnext');
        assert.ok(playnext.data, 'playnext.data should exist');
        assert.equal(playnext.data.name, 'playnext');
        assert.equal(typeof playnext.execute, 'function');
    });
});
