const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { createEmbed, Colors, EMOJIS } = require('../src/utils/embeds');
const { cleanVideoTitle, truncate, formatMs, isYouTubeUrl, isSpotifyUrl } = require('../src/utils/helpers');

describe('Existing Bot Architecture Regression Check', () => {
    it('should verify all music commands export valid data and execute function', () => {
        const musicDir = path.join(__dirname, '../src/commands/music');
        const files = fs.readdirSync(musicDir).filter(f => f.endsWith('.js'));

        assert.ok(files.length >= 30, `Expected at least 30 music commands, found ${files.length}`);
        assert.ok(files.includes('vibe.js'), 'Expected vibe.js to be present in music commands');
        assert.ok(files.includes('play.js'), 'Expected play.js to be present');
        assert.ok(files.includes('recommend.js'), 'Expected recommend.js to be present');

        for (const file of files) {
            const cmd = require(path.join(musicDir, file));
            assert.ok(cmd.data, `${file} is missing command.data`);
            assert.ok(cmd.data.name, `${file} is missing command.data.name`);
            assert.strictEqual(typeof cmd.execute, 'function', `${file} is missing execute function`);
        }
    });

    it('should verify utility commands export valid data and execute function', () => {
        const utilDir = path.join(__dirname, '../src/commands/utility');
        const files = fs.readdirSync(utilDir).filter(f => f.endsWith('.js'));

        assert.ok(files.length >= 5, `Expected at least 5 utility commands, found ${files.length}`);
        assert.ok(files.includes('help.js'), 'Expected help.js to be present');

        for (const file of files) {
            const cmd = require(path.join(utilDir, file));
            assert.ok(cmd.data, `${file} is missing command.data`);
            assert.strictEqual(typeof cmd.execute, 'function', `${file} is missing execute function`);
        }
    });

    it('should verify embed creation and palettes remain intact', () => {
        const embed = createEmbed('Music');
        assert.strictEqual(embed.data.color, Colors.Music);
        assert.strictEqual(EMOJIS.music, '🎵');
        assert.strictEqual(EMOJIS.success, '✅');
    });

    it('should verify helper functions behavior is preserved', () => {
        assert.strictEqual(truncate('A very long title that should be shortened', 15), 'A very long ...');
        assert.strictEqual(formatMs(185000), '3:05');
        assert.strictEqual(isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
        assert.strictEqual(isSpotifyUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'), true);
        assert.strictEqual(cleanVideoTitle('Rowdy Baby | Official Video | Dhanush'), 'Rowdy Baby');
    });
});
