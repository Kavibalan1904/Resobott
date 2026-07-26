require('dotenv').config();

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
client.lavalink = new LavalinkManager({
    nodes: [
        {
            id: 'primary-jirayu',
            host: process.env.LAVALINK_HOST || 'lavalink.jirayu.net',
            port: parseInt(process.env.LAVALINK_PORT) || 13592,
            authorization: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
            secure: process.env.LAVALINK_SECURE === 'true',
        },
        {
            id: 'backup-kasawa',
            host: 'lava2.kasawa.pro',
            port: 2334,
            authorization: 'youshallnotpass',
            secure: false,
        },
        {
            id: 'backup-serenetia',
            host: 'lavalinkv4.serenetia.com',
            port: 80,
            authorization: 'https://seretia.link/discord',
            secure: false,
        },
        {
            id: 'backup-minecuta',
            host: 'lavav4.minecuta.com',
            port: 2333,
            authorization: 'discord.gg/gKuXdHs',
            secure: false,
        },
    ],
    sendToShard: (guildId, payload) => {
        client.guilds.cache.get(guildId)?.shard?.send(payload);
    },
    autoSkip: true,
    client: {
        id: process.env.CLIENT_ID,
        username: 'Reso',
    },
    playerOptions: {
        defaultSearchPlatform: 'ytsearch',
        onDisconnect: {
            autoReconnect: false,
            destroyPlayer: true,
        },
    },
});

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
        client.once('ready', async () => {
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
