const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

console.log('[Lavalink Server] Initializing Lavalink Bootstrapper...');

const JAR_PATH = path.resolve(__dirname, 'Lavalink.jar');
const LAVALINK_JAR_URL = 'https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink.jar';

/**
 * Downloads a file from a URL following redirects (HTTP 301/302).
 */
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(destPath);

        function handleRequest(targetUrl) {
            https.get(targetUrl, (response) => {
                if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
                    return handleRequest(response.headers.location);
                }

                if (response.statusCode !== 200) {
                    fileStream.close();
                    fs.unlink(destPath, () => {});
                    return reject(new Error(`Failed to download Lavalink.jar: HTTP ${response.statusCode}`));
                }

                response.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close(() => resolve());
                });
            }).on('error', (err) => {
                fileStream.close();
                fs.unlink(destPath, () => {});
                reject(err);
            });
        }

        handleRequest(url);
    });
}

async function start() {
    if (!fs.existsSync(JAR_PATH)) {
        console.log('[Lavalink Server] Lavalink.jar not found. Downloading v4.2.2...');
        try {
            await downloadFile(LAVALINK_JAR_URL, JAR_PATH);
            console.log('[Lavalink Server] ✓ Download complete!');
        } catch (err) {
            console.error('[Lavalink Server] ✗ Download failed:', err.message);
            process.exit(1);
        }
    }

    const port = process.env.PORT || '8080';
    console.log(`[Lavalink Server] Launching Java Lavalink Server on port ${port}...`);

    const jvmArgs = [
        '-Xmx384m',
        '-Xms128m',
        '-XX:+UseG1GC',
        '-XX:MaxGCPauseMillis=20',
        '-XX:+ExitOnOutOfMemoryError',
        `-Dserver.port=${port}`,
        '-Djdk.tls.client.protocols=TLSv1.2,TLSv1.3',
        '-jar',
        'Lavalink.jar'
    ];

    const lavalink = spawn('java', jvmArgs, {
        cwd: __dirname,
        stdio: 'inherit'
    });

    lavalink.on('error', (err) => {
        console.error('[Lavalink Server] Failed to spawn Java process:', err.message);
        console.error('[Lavalink Server] Please ensure Java 17+ (JDK/JRE) is installed and available in PATH.');
        process.exit(1);
    });

    lavalink.on('exit', (code) => {
        console.log(`[Lavalink Server] Process exited with code ${code}`);
        process.exit(code || 0);
    });

    process.on('SIGINT', () => lavalink.kill('SIGINT'));
    process.on('SIGTERM', () => lavalink.kill('SIGTERM'));
}

start();
