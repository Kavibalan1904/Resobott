const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('[Reso-Lavalink] Initializing Discloud Lavalink Bootstrapper...');

const JAR_PATH = path.resolve(__dirname, 'Lavalink.jar');

if (!fs.existsSync(JAR_PATH)) {
    console.log('[Reso-Lavalink] Downloading Lavalink.jar v4.2.2...');
    try {
        execSync('curl -L -s -o Lavalink.jar https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink.jar', { stdio: 'inherit' });
        console.log('[Reso-Lavalink] ✓ Lavalink.jar download complete!');
    } catch (err) {
        console.error('[Reso-Lavalink] ✗ Download failed:', err.message);
    }
}

console.log('[Reso-Lavalink] Launching Lavalink server...');
const lavalink = spawn('java', ['-Djdk.tls.client.protocols=TLSv1.2,TLSv1.3', '-jar', 'Lavalink.jar'], {
    cwd: __dirname,
    stdio: 'inherit'
});

lavalink.on('exit', (code) => {
    console.log(`[Reso-Lavalink] Lavalink process exited with code ${code}`);
    process.exit(code || 0);
});

process.on('SIGINT', () => lavalink.kill('SIGINT'));
process.on('SIGTERM', () => lavalink.kill('SIGTERM'));
