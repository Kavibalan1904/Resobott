const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getEffectiveSource, getSourceBadge, nowPlayingEmbed, trackAddedEmbed } = require('../src/utils/embeds');
const { setTrackMetadata } = require('../src/utils/trackMetadata');

describe('Source Differentiation: Spotify vs YouTube', () => {
    it('should identify Spotify track when uri has spotify domain or uri scheme', () => {
        const trackWithUrl = {
            info: {
                title: 'Blinding Lights',
                author: 'The Weeknd',
                uri: 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b',
                sourceName: 'youtube', // e.g. resolved to YouTube audio underneath by Lavalink
            }
        };
        assert.strictEqual(getEffectiveSource(trackWithUrl), 'spotify');

        const trackWithUri = {
            info: {
                title: 'Starboy',
                author: 'The Weeknd',
                uri: 'spotify:track:7MXVkk9YM5IZxh0wAEgVPl',
                sourceName: 'youtube',
            }
        };
        assert.strictEqual(getEffectiveSource(trackWithUri), 'spotify');
    });

    it('should identify Spotify track when sourceName is set on root track object', () => {
        const track = {
            sourceName: 'spotify',
            info: {
                title: 'Save Your Tears',
                author: 'The Weeknd',
                uri: 'https://www.youtube.com/watch?v=XXYlFuWEuKi',
                sourceName: 'youtube',
            }
        };
        assert.strictEqual(getEffectiveSource(track), 'spotify');
    });

    it('should identify Spotify track from trackMetadataStore', () => {
        const guildId = 'test_guild_spotify';
        const track = {
            info: {
                title: 'Die For You',
                author: 'The Weeknd',
                uri: 'https://www.youtube.com/watch?v=QLCpqdqeoII',
                sourceName: 'youtube',
            }
        };
        setTrackMetadata(guildId, track, {
            sourceName: 'spotify',
        });
        assert.strictEqual(getEffectiveSource(track, guildId), 'spotify');
    });

    it('should identify real YouTube and YouTube Music tracks properly', () => {
        const ytTrack = {
            info: {
                title: 'Official Video',
                author: 'Channel',
                uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                sourceName: 'youtube',
            }
        };
        assert.strictEqual(getEffectiveSource(ytTrack), 'youtube');
        const badge = getSourceBadge(getEffectiveSource(ytTrack));
        assert.strictEqual(badge.label, 'YouTube');
        assert.strictEqual(badge.emoji, '🔴');

        const ytmTrack = {
            info: {
                title: 'Studio Audio',
                author: 'Artist',
                uri: 'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
                sourceName: 'youtubemusic',
            }
        };
        assert.strictEqual(getEffectiveSource(ytmTrack), 'youtubemusic');
        const ytmBadge = getSourceBadge(getEffectiveSource(ytmTrack));
        assert.strictEqual(ytmBadge.label, 'YouTube Music');
    });

    it('nowPlayingEmbed should display Spotify badge for Spotify tracks resolved to YouTube audio', () => {
        const track = {
            sourceName: 'spotify',
            info: {
                title: 'Starboy',
                author: 'The Weeknd',
                uri: 'https://open.spotify.com/track/7MXVkk9YM5IZxh0wAEgVPl',
                sourceName: 'youtube', // audio stream from YouTube
            }
        };
        const mockPlayer = {
            guildId: 'g123',
            volume: 80,
            repeatMode: 'off',
            position: 10000,
            queue: { tracks: [] },
        };
        const embed = nowPlayingEmbed(track, mockPlayer, null, []);
        assert.ok(embed.data.description.includes('🟢'));
        assert.ok(embed.data.description.includes('Spotify'));
        assert.ok(!embed.data.description.includes('• YouTube\n'));
    });
});

