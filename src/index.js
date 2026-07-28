require('dotenv').config();

// ── Force IPv4 First (Fixes container IPv6 blackhole hanging on Wispbyte / Docker) ──
const dns = require('dns');
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { LavalinkManager } = require('lavalink-client');
const { loadCommands, registerSlashCommands } = require('./handlers/commandHandler');
const { setupLavalinkEvents } = require('./handlers/playerEvents');

// ── Render.com / Cloud Health Check Server ─────────────────────
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Reso Music Bot is running 24/7!');
}).listen(PORT, () => {
    console.log(`[Reso] ✓ Health check server listening on port ${PORT}`);
});

// ── Create Discord Client ──────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
    ],
    rest: {
        timeout: 15000, // 15 seconds timeout instead of hanging forever
    },
    sweepers: {
        messages: {
            interval: 3600, // Sweep messages every hour
            lifetime: 1800, // Remove messages older than 30 minutes from RAM
        },
    },
});

client.commands = new Collection();

// ── 24/7 mode storage (guild ID → boolean) ─────────────────────
client.twentyFourSeven = new Set();

// ── Track history storage (guild ID → array of tracks) ─────────
client.trackHistory = new Map();

// ── Create Lavalink Manager ────────────────────────────────────
const defaultNodes = [];
const addedHosts = new Set();

// 1. Region-Optimized Node from .env (Highest Priority)
if (process.env.LAVALINK_HOST) {
    const host = process.env.LAVALINK_HOST.trim()
        .replace(/^(https?|wss?):\/\//i, '') // Remove http://, https://, ws://, wss://
        .replace(/\/.*$/, ''); // Remove trailing slashes or paths
    const port = parseInt(process.env.LAVALINK_PORT) || 443;
    
    const isCloudHost = !!(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.PORT);
    const isLocalhost = ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host.toLowerCase());

    if (isLocalhost && isCloudHost) {
        console.log(`[Reso] ℹ Skipping env node (${host}:${port}) because localhost is not running inside the cloud container.`);
    } else {
        console.log(`[Reso] Loading primary Lavalink node from .env: ${host}:${port}`);
        defaultNodes.push({
            id: 'node-env-primary',
            host: host,
            port: port,
            authorization: process.env.LAVALINK_PASSWORD ? process.env.LAVALINK_PASSWORD.trim() : 'youshallnotpass',
            secure: String(process.env.LAVALINK_SECURE).toLowerCase() === 'true' || port === 443,
            retryAmount: 15,
            retryDelay: 5000,
        });
        addedHosts.add(`${host.toLowerCase()}:${port}`);
    }
}

// 2. Backup / Default Nodes (deduplicated)
const backupNodes = [
    {
        id: 'node-millohost-ssl',
        host: 'lava-v4.millohost.my.id',
        port: 443,
        authorization: 'https://discord.gg/mjS5J2K3ep',
        secure: true,
        retryAmount: 15,
        retryDelay: 5000,
    },
    {
        id: 'node-jirayu-ssl',
        host: 'lavalink.jirayu.net',
        port: 443,
        authorization: 'youshallnotpass',
        secure: true,
        retryAmount: 15,
        retryDelay: 5000,
    },
    {
        id: 'node-kasawa',
        host: 'lava2.kasawa.pro',
        port: 2334,
        authorization: 'youshallnotpass',
        secure: false,
        retryAmount: 15,
        retryDelay: 5000,
    },
    {
        id: 'node-uk-g3v',
        host: 'lava.g3v.co.uk',
        port: 9008,
        authorization: 'lavalinklol',
        secure: false,
        retryAmount: 15,
        retryDelay: 5000,
    }
];

for (const node of backupNodes) {
    const key = `${node.host.toLowerCase()}:${node.port}`;
    if (!addedHosts.has(key)) {
        defaultNodes.push(node);
        addedHosts.add(key);
    }
}

client.lavalink = new LavalinkManager({
    nodes: defaultNodes,
    sendToShard: (guildId, payload) => {
        client.guilds.cache.get(guildId)?.shard?.send(payload);
    },
    autoSkip: true,
    client: {
        id: (process.env.CLIENT_ID && /^\d+$/.test(process.env.CLIENT_ID)) ? process.env.CLIENT_ID : undefined,
        username: 'Reso',
    },
    playerOptions: {
        defaultSearchPlatform: 'ytsearch',
        onDisconnect: {
            autoReconnect: true,
            destroyPlayer: false,
        },
        useUnresolvedData: true,
    },
    advancedOptions: {
        enableDebugEvents: false,
    },
});

// ── WebSocket Keep-Alive Ping (prevents 1006 from idle proxy/firewall timeouts) ──
const WS_PING_INTERVAL_MS = 30_000; // 30 seconds
setInterval(() => {
    for (const node of client.lavalink.nodeManager.nodes.values()) {
        if (node.connected && node.socket?.readyState === 1) {
            try {
                node.socket.ping();
            } catch {
                // Ignore — if the socket is dead the reconnect handler will take over
            }
        }
    }
}, WS_PING_INTERVAL_MS);

// ── Forward raw Discord events to Lavalink ─────────────────────
client.on('raw', (data) => client.lavalink.sendRawData(data));

// ── Discord Client & REST Debugging / Error Handling ───────────
client.on('error', (err) => console.error('[Reso Discord Error]:', err));
client.on('warn', (msg) => console.warn('[Reso Discord Warning]:', msg));
client.on('debug', (info) => {
    // Filter out routine heartbeat messages to keep console clean
    if (info.toLowerCase().includes('heartbeat')) return;
    console.log('[Reso Discord Debug]:', info);
});
client.rest.on('rateLimited', (info) => {
    console.warn('[Reso Discord RateLimit] 429 Hit! Details:', JSON.stringify(info));
});
client.on('shardError', (error, shardId) => console.error(`[Reso Shard ${shardId} Error]:`, error));
client.on('shardDisconnect', (event, shardId) => console.warn(`[Reso Shard ${shardId} Disconnected]:`, event));
client.on('shardReconnecting', (shardId) => console.log(`[Reso Shard ${shardId}] Reconnecting...`));
client.on('shardResume', (shardId, replayedEvents) => console.log(`[Reso Shard ${shardId}] Resumed connection (replayed ${replayedEvents} events)`));

// ── Initialize ─────────────────────────────────────────────────
async function main() {
    try {
        // Load commands
        await loadCommands(client);
        console.log(`[Reso] ✓ Loaded ${client.commands.size} commands`);

        // Setup Lavalink events
        setupLavalinkEvents(client);
        console.log('[Reso] ✓ Lavalink events registered');

        // Bot ready event
        client.once('clientReady', async () => {
            console.log(`[Reso] ✓ Logged in as ${client.user.tag}`);
            console.log(`[Reso] ✓ Serving ${client.guilds.cache.size} servers`);

            // Initialize Lavalink manager
            client.lavalink.init({ id: client.user.id, username: client.user.username });
            console.log('[Reso] ✓ Lavalink manager initialized');

            // Set activity
            client.user.setActivity('music 🎵 | /help', { type: 2 }); // Type 2 = Listening

            // Register slash commands globally
            await registerSlashCommands(client);
            console.log('[Reso] ✓ Slash commands registered globally');
        });

        // Handle interactions
        client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                await command.execute(interaction, client);
            } catch (error) {
                console.error(`[Reso] Command error (${interaction.commandName}):`, error);
                const errorMsg = {
                    content: '❌ An error occurred while executing this command.',
                    ephemeral: true,
                };
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(errorMsg).catch(() => {});
                } else {
                    await interaction.reply(errorMsg).catch(() => {});
                }
            }
        });

        // Login
        console.log('[Reso] Attempting to connect to Discord Gateway...');
        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        console.error('[Reso] Fatal error:', error);
        process.exit(1);
    }
}

// ── Global Anti-Crash Protection (Wispbyte / Game Panels) ──────
process.on('unhandledRejection', (reason, promise) => {
    console.error('[Reso Anti-Crash] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err, origin) => {
    console.error('[Reso Anti-Crash] Uncaught Exception:', err);
});
process.on('uncaughtExceptionMonitor', (err, origin) => {
    console.error('[Reso Anti-Crash] Uncaught Exception Monitor:', err);
});

main();
