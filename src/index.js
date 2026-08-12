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

// ── Recommendation storage (guild ID → array of recommended tracks) ──
client.recommendations = new Map();

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
// Only nodes confirmed working as of Aug 2026. Dead nodes removed to stop log spam.
const backupNodes = [
    // ── Confirmed Working ────────────────────────────────────────
    {
        id: 'node-serenetia-ssl',
        host: 'lavalinkv4.serenetia.com',
        port: 443,
        authorization: 'https://seretia.link/discord',
        secure: true,
        retryAmount: 5,
        retryDelay: 10000,
    },
    {
        id: 'node-serenetia',
        host: 'lavalinkv4.serenetia.com',
        port: 80,
        authorization: 'https://seretia.link/discord',
        secure: false,
        retryAmount: 5,
        retryDelay: 10000,
    },
    {
        id: 'node-kasawa',
        host: 'lava2.kasawa.pro',
        port: 2334,
        authorization: 'youshallnotpass',
        secure: false,
        retryAmount: 5,
        retryDelay: 10000,
    },
    // ── Additional Backup Nodes ──────────────────────────────────
    {
        id: 'node-minecuta',
        host: 'lavav4.minecuta.com',
        port: 2333,
        authorization: 'discord.gg/gKuXdHs',
        secure: false,
        retryAmount: 3,
        retryDelay: 10000,
    },
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
        clientBasedPositionUpdate: true,
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

// ── Auto-leave when all users leave the voice channel ──────────
const aloneTimers = new Map();
client.on('voiceStateUpdate', (oldState, newState) => {
    // Only care about channel leave/move events (not mute/deaf/etc.)
    if (oldState.channelId === newState.channelId) return;

    const guildId = oldState.guild.id || newState.guild.id;
    const player = client.lavalink.getPlayer(guildId);
    if (!player || !player.voiceChannelId) return;

    const botVC = client.channels.cache.get(player.voiceChannelId);
    if (!botVC) return;

    // Count human members in the bot's voice channel
    const humanMembers = botVC.members.filter(m => !m.user.bot).size;

    if (humanMembers === 0) {
        // All humans left — start a 5-second grace timer then disconnect
        if (!aloneTimers.has(guildId)) {
            const timer = setTimeout(() => {
                aloneTimers.delete(guildId);
                const currentPlayer = client.lavalink.getPlayer(guildId);
                if (!currentPlayer) return;

                // Re-check: still alone?
                const vc = client.channels.cache.get(currentPlayer.voiceChannelId);
                const stillAlone = !vc || vc.members.filter(m => !m.user.bot).size === 0;

                if (stillAlone) {
                    const textChannel = client.channels.cache.get(currentPlayer.textChannelId);
                    currentPlayer.destroy();
                    if (textChannel) {
                        const { createEmbed, EMOJIS } = require('./utils/embeds');
                        const embed = createEmbed('Info')
                            .setDescription(`${EMOJIS.music} Everyone left the voice channel, so I've disconnected. 👋`);
                        textChannel.send({ embeds: [embed] }).catch(() => {});
                    }
                }
            }, 5000);
            aloneTimers.set(guildId, timer);
        }
    } else {
        // Someone rejoined — cancel the alone timer if one is running
        if (aloneTimers.has(guildId)) {
            clearTimeout(aloneTimers.get(guildId));
            aloneTimers.delete(guildId);
        }
    }
});

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
            client.user.setPresence({
                activities: [{
                    name: 'music 🎵 | /help',
                    type: 2, // Listening
                }],
                status: 'online',
            });

            // Register slash commands globally
            await registerSlashCommands(client);
            console.log('[Reso] ✓ Slash commands registered globally');
        });

        // Handle interactions
        client.on('interactionCreate', async (interaction) => {
            // Handle recommendation button clicks
            if (interaction.isButton() && interaction.customId?.startsWith('rec_add_')) {
                try {
                    const parts = interaction.customId.split('_');
                    const guildId = parts[2];
                    const recIndex = parseInt(parts[3], 10);

                    const memberVC = interaction.member?.voice?.channel;
                    if (!memberVC) {
                        return interaction.reply({
                            content: '❌ You need to be in a voice channel to add recommendations!',
                            ephemeral: true,
                        });
                    }

                    const recs = client.recommendations.get(guildId) || [];
                    const recommendedTrack = recs[recIndex];

                    if (!recommendedTrack) {
                        return interaction.reply({
                            content: '❌ Recommendation no longer available.',
                            ephemeral: true,
                        });
                    }

                    let player = client.lavalink.getPlayer(guildId);
                    if (!player) {
                        player = client.lavalink.createPlayer({
                            guildId: guildId,
                            voiceChannelId: memberVC.id,
                            textChannelId: interaction.channel.id,
                            selfDeaf: true,
                            volume: parseInt(process.env.DEFAULT_VOLUME) || 50,
                        });
                    }

                    if (!player.connected) {
                        await player.connect();
                    }

                    recommendedTrack.requester = interaction.user;
                    player.queue.add(recommendedTrack);

                    if (!player.playing) {
                        await player.play();
                    }

                    const { truncate } = require('./utils/helpers');
                    const title = truncate(recommendedTrack.info?.title || 'Track', 45);

                    return interaction.reply({
                        content: `✅ Added recommended song **${title}** to the queue! 🎵`,
                        ephemeral: true,
                    });
                } catch (btnErr) {
                    console.error('[Reso] Recommendation button error:', btnErr);
                    return interaction.reply({
                        content: '❌ Failed to queue recommendation.',
                        ephemeral: true,
                    }).catch(() => {});
                }
            }

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
                    await interaction.followUp(errorMsg).catch(() => { });
                } else {
                    await interaction.reply(errorMsg).catch(() => { });
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
