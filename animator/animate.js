/**
 * Discord Bot Animator — Standalone Script
 * Adapted from: https://github.com/Zingzy/discord-bot-animator
 *
 * Sets an animated GIF avatar (and optionally banner) on your Discord bot.
 * This is a one-shot script — run it once, and Discord will display the animated avatar.
 *
 * Usage:
 *   node animator/animate.js                         (uses config below)
 *   node animator/animate.js ./animator/avatar.gif    (avatar only)
 *   node animator/animate.js ./animator/avatar.gif ./animator/banner.gif
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const { REST, Routes } = require('discord.js');
const path = require('path');
const fs = require('fs');

// ── Configuration ──────────────────────────────────────────────
// You can either pass paths as CLI arguments or set them here:
const DEFAULT_AVATAR_PATH = './animator/avatar.gif';   // Place your GIF here
const DEFAULT_BANNER_PATH = '';                         // Optional: './animator/banner.gif'

/**
 * Convert an image file to a Discord-compatible data URI string
 * (data:image/gif;base64,...)
 */
function resolveImageToDataURI(filePath) {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mimeType = ext === 'gif' ? 'image/gif'
        : ext === 'png' ? 'image/png'
        : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : 'image/png';
    const fileBuffer = fs.readFileSync(filePath);
    return `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
}

async function animate() {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        console.error('❌ DISCORD_TOKEN not found in .env file!');
        process.exit(1);
    }

    // Resolve paths from CLI args or defaults
    const avatarPath = process.argv[2]
        ? path.resolve(process.argv[2])
        : DEFAULT_AVATAR_PATH ? path.resolve(DEFAULT_AVATAR_PATH) : null;

    const bannerPath = process.argv[3]
        ? path.resolve(process.argv[3])
        : DEFAULT_BANNER_PATH ? path.resolve(DEFAULT_BANNER_PATH) : null;

    if (!avatarPath && !bannerPath) {
        console.error('❌ No avatar or banner path provided!');
        console.log('\nUsage:');
        console.log('  node animator/animate.js ./path/to/avatar.gif');
        console.log('  node animator/animate.js ./path/to/avatar.gif ./path/to/banner.gif');
        console.log('\nOr place your GIF at: animator/avatar.gif');
        process.exit(1);
    }

    // Validate files exist
    if (avatarPath && !fs.existsSync(avatarPath)) {
        console.error(`❌ Avatar file not found: ${avatarPath}`);
        console.log('\n💡 Place your animated GIF at: animator/avatar.gif');
        process.exit(1);
    }
    if (bannerPath && !fs.existsSync(bannerPath)) {
        console.error(`❌ Banner file not found: ${bannerPath}`);
        process.exit(1);
    }

    const rest = new REST().setToken(token);

    // Must specify we're using a Bot token (not OAuth2 Bearer)
    rest.options = { ...rest.options, authPrefix: 'Bot' };

    const body = {};

    try {
        if (avatarPath) {
            console.log(`🎨 Loading avatar: ${avatarPath}`);
            body.avatar = resolveImageToDataURI(avatarPath);
        }

        if (bannerPath) {
            console.log(`🖼️  Loading banner: ${bannerPath}`);
            body.banner = resolveImageToDataURI(bannerPath);
        }

        console.log('⏳ Uploading to Discord...');
        await rest.patch(Routes.user(), { body });

        console.log('');
        console.log('✅ Success! Animated profile applied to your bot.');
        if (avatarPath) console.log(`   🎨 Avatar: ${path.basename(avatarPath)}`);
        if (bannerPath) console.log(`   🖼️  Banner: ${path.basename(bannerPath)}`);
        console.log('');
        console.log('💡 Note: It may take a few seconds for Discord to update the avatar globally.');

    } catch (error) {
        if (error.status === 429) {
            const retryAfter = error.rawError?.retry_after || 'unknown';
            console.error(`\n⚠️  Rate limited! Discord says wait ${retryAfter} seconds before trying again.`);
        } else {
            console.error('\n❌ Failed to update bot profile:', error.message);
            if (error.rawError) {
                console.error('   Discord API error:', JSON.stringify(error.rawError, null, 2));
            }
        }
        process.exit(1);
    }
}

animate();
