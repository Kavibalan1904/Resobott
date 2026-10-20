/**
 * Reso Avatar Rollback Script
 *
 * Restores the bot's original animated avatar from backup and optionally
 * applies it back to Discord immediately.
 *
 * Usage:
 *   node animator/rollback.js          (restores avatar.gif to original & uploads to Discord)
 *   node animator/rollback.js --local  (only restores local animator/avatar.gif file without uploading)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ORIGINAL_AVATAR = path.resolve(__dirname, 'avatar_original.gif');
const BACKUP_AVATAR = path.resolve(__dirname, 'backup', 'avatar_r_tight.gif');
const TARGET_AVATAR = path.resolve(__dirname, 'avatar.gif');

console.log('🔄 [Reso Avatar Rollback] Restoring original avatar...');

const source = fs.existsSync(ORIGINAL_AVATAR)
    ? ORIGINAL_AVATAR
    : fs.existsSync(BACKUP_AVATAR)
        ? BACKUP_AVATAR
        : null;

if (!source) {
    console.error('❌ Could not find original avatar backup in animator/ or animator/backup/!');
    process.exit(1);
}

// Copy original file back to animator/avatar.gif
fs.copyFileSync(source, TARGET_AVATAR);
console.log(`✅ Restored local file: ${TARGET_AVATAR}`);
console.log(`   Source backup: ${path.basename(source)}`);

// If user didn't specify --local, run animate.js to apply it back to Discord
if (!process.argv.includes('--local')) {
    console.log('\n🚀 Uploading restored original avatar to Discord...');
    const animateScript = path.resolve(__dirname, 'animate.js');
    const result = spawnSync('node', [animateScript, TARGET_AVATAR], {
        stdio: 'inherit',
        cwd: path.resolve(__dirname, '..')
    });

    if (result.status === 0) {
        console.log('\n🎉 Successfully rolled back bot avatar to the original animated icon!');
    } else {
        console.log('\n💡 Note: You can run "node animator/animate.js ./animator/avatar_original.gif" anytime to upload.');
    }
} else {
    console.log('\n✅ Local avatar.gif restored. Run "node animator/animate.js" when you are ready to upload to Discord.');
}
