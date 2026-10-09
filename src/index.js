require('dotenv').config();

// ── Force IPv4 First (Fixes container IPv6 blackhole hanging on Wispbyte / Docker) ──
const dns = require('dns');
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

const { Client, GatewayIntentBits, Collection, MessageFlags, Options } = require('discord.js');
const { LavalinkManager } = require('lavalink-client');
const { loadCommands, registerSlashCommands } = require('./handlers/commandHandler');
const { setupLavalinkEvents } = require('./handlers/playerEvents');
const { handlePlayerButton } = require('./handlers/buttonHandler');
const { getBestNode, ensurePlayerNode } = require('./utils/helpers');

// ── HTTP Health Check Server (Optional) ─────────────────────────
const http = require('http');
const PORT = process.env.PORT;
if (PORT) {
    http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Reso Music Bot is running 24/7!');
    }).listen(PORT, () => {
        console.log(`[Reso] ✓ Health check listening on port ${PORT}`);
    });
}

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
    // ── Memory optimization: limit caches to only what's needed ──
    makeCache: Options.cacheWithLimits({
        MessageManager: 50,      // Cap at 50 messages per channel (default: unlimited)
        PresenceManager: 0,      // Bot doesn't need presence data
        ReactionManager: 0,      // Bot doesn't use reactions
        GuildMemberManager: 200, // Cap member cache per guild
        UserManager: 100,        // Cap user cache
        ThreadManager: 0,        // Bot doesn't track threads
        GuildBanManager: 0,      // Bot doesn't track bans
        StageInstanceManager: 0, // Bot doesn't track stage instances
    }),
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

// ── Autoplay mode storage (guild ID set) ────────────────────────
client.autoplayGuilds = new Set();

// ── Vote skip storage (guild ID → { voters: Set, messageId }) ───
client.voteSkips = new Map();

// ── Now Playing message storage (guild ID → message) ─────────
client.lastNowPlayingMessage = new Map();

// ── Dedicated Lavalink Server (the ONE AND ONLY node) ─────────
const defaultNodes = [];

const host = (process.env.LAVALINK_HOST || 'lavalink1-7tbh.onrender.com').trim()
    .replace(/^(https?|wss?):\/\//i, '') // Remove http://, https://, ws://, wss://
    .replace(/\/.*$/, ''); // Remove trailing slashes or paths
const port = parseInt(process.env.LAVALINK_PORT) || 443;
const password = process.env.LAVALINK_PASSWORD ? process.env.LAVALINK_PASSWORD.trim() : 'youshallnotpass';
const isSecure = process.env.LAVALINK_SECURE !== undefined
    ? String(process.env.LAVALINK_SECURE).toLowerCase() === 'true'
    : port === 443;

console.log(`[Reso] 🔒 Loading DEDICATED private Lavalink node: ${host}:${port}`);
defaultNodes.push({
    id: 'primary-main',
    host: host,
    port: port,
    authorization: password,
    secure: isSecure,
    retryAmount: Infinity, // Dedicated node — always keep reconnecting
    retryDelay: 5000,      // Fast 5s reconnect attempts
});

// ── Fallback Backup Node (Ensures 100% uptime when primary is restarting/sleeping) ──
defaultNodes.push({
    id: 'backup-millohost',
    host: 'lava-v4.millohost.my.id',
    port: 443,
    authorization: 'https://discord.gg/mjS5J2K3ep',
    secure: true,
    retryAmount: Infinity,
    retryDelay: 10000,
});

client.lavalink = new LavalinkManager({
    nodes: defaultNodes,
    sendToShard: (guildId, payload) => {
        client.guilds.cache.get(guildId)?.shard?.send(payload);
    },
    autoSkip: false, // Turned off to handle queue advancement manually in playerEvents (fixes race condition with retryTrack)
    client: {
        id: (process.env.CLIENT_ID && /^\d+$/.test(process.env.CLIENT_ID)) ? process.env.CLIENT_ID : undefined,
        username: 'Reso',
    },
    playerOptions: {
        defaultSearchPlatform: 'ytsearch', // Fast direct YouTube search
        clientBasedPositionUpdateInterval: 500, // Smooth 500ms local position tracking
        volumeDecrementer: 0.75, // 100% client volume → 75% Lavalink volume (headroom, prevents clipping)
        onDisconnect: {
            autoReconnect: true,
            destroyPlayer: false,
        },
        onEmptyQueue: {
            destroyAfterMs: 300_000, // Auto-cleanup idle players after 5 minutes (24/7 mode overrides this)
        },
        useUnresolvedData: false, // Ensure tracks resolve directly to pure audio streams rather than dialogue videos
        applyVolumeAsFilter: false, // Direct hardware volume instead of heavy filter chain
    },
    advancedOptions: {
        enableDebugEvents: false,
    },
});

// ── Forward raw Discord events to Lavalink ─────────────────────
client.on('raw', (data) => client.lavalink.sendRawData(data));

// ── 24/7 Mode: Prevent Lavalink from auto-destroying player when queue is empty ──
client.lavalink.on('playerQueueEmptyStart', (player) => {
    if (client.twentyFourSeven?.has(player.guildId)) {
        const timer = player.getData('internal_queueempty');
        if (timer) {
            clearTimeout(timer);
            player.setData('internal_queueempty', undefined);
            console.log(`[Reso] 24/7 mode active for guild ${player.guildId}: cancelled auto-destroy timeout`);
        }
    }
});

// ── Auto-leave when all users leave the voice channel (respects 24/7 mode) ──
const aloneTimers = new Map();
client.aloneTimers = aloneTimers;
client.on('voiceStateUpdate', (oldState, newState) => {
    // Only care about channel leave/move events (not mute/deaf/etc.)
    if (oldState.channelId === newState.channelId) return;

    const guildId = oldState.guild.id || newState.guild.id;

    // ── 24/7 mode check: Never disconnect if 24/7 mode is active ──
    if (client.twentyFourSeven?.has(guildId)) {
        if (aloneTimers.has(guildId)) {
            clearTimeout(aloneTimers.get(guildId));
            aloneTimers.delete(guildId);
        }
        return;
    }

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

                // Re-check: still alone and not in 24/7 mode?
                if (client.twentyFourSeven?.has(guildId)) return;

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
    // Filter out noisy debug events to reduce console I/O overhead
    const lower = info.toLowerCase();
    if (lower.includes('heartbeat') || lower.includes('session') || lower.includes('gateway')
        || lower.includes('shard') || lower.includes('identify') || lower.includes('connecting to')) return;
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

            // ── Keep Render node awake (prevents free-tier 15min inactivity sleep) ──
            if (host.includes('onrender.com')) {
                const keepAliveUrl = `${isSecure ? 'https' : 'http'}://${host}:${port}/version`;
                const pingRender = () => {
                    const httpModule = isSecure ? require('https') : require('http');
                    const req = httpModule.get(keepAliveUrl, { headers: { 'Authorization': password }, timeout: 15000 }, (res) => {
                        res.resume();
                    });
                    req.on('error', () => {});
                };
                pingRender(); // Warm up Render immediately on startup
                setInterval(pingRender, 7 * 60 * 1000); // Reset Render 15-min idle timer every 7 mins
            }


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
            // ── Handle player control buttons (⏮ ⏸ ⏭ 🔀 ⏹) ──
            if (interaction.isButton() && interaction.customId?.startsWith('player_')) {
                try {
                    await handlePlayerButton(interaction, client);
                } catch (err) {
                    console.error('[Reso] Player button error:', err);
                }
                return;
            }

            // ── Handle vote skip buttons ──
            if (interaction.isButton() && interaction.customId?.startsWith('voteskip_')) {
                try {
                    const guildId = interaction.guild?.id;
                    const voteData = client.voteSkips?.get(guildId);
                    if (!voteData) {
                        return interaction.reply({ content: '🗳️ This vote has expired.', flags: MessageFlags.Ephemeral }).catch(() => {});
                    }
                    const memberVC = interaction.member?.voice?.channel;
                    if (!memberVC) {
                        return interaction.reply({ content: '❌ You need to be in a voice channel to vote!', flags: MessageFlags.Ephemeral }).catch(() => {});
                    }
                    if (voteData.voters.has(interaction.user.id)) {
                        return interaction.reply({ content: '🗳️ You already voted!', flags: MessageFlags.Ephemeral }).catch(() => {});
                    }
                    voteData.voters.add(interaction.user.id);
                    const humanCount = memberVC.members.filter(m => !m.user.bot).size;
                    const needed = Math.ceil(humanCount / 2);
                    const current = voteData.voters.size;

                    if (current >= needed) {
                        const player = client.lavalink.getPlayer(guildId);
                        if (player) await player.skip();
                        client.voteSkips.delete(guildId);
                        await interaction.update({ content: `🗳️ Vote skip passed! (**${current}/${needed}** votes) ⏭️`, components: [] }).catch(() => {});
                    } else {
                        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                        const btn = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`voteskip_${guildId}`).setLabel(`🗳️ Vote Skip (${current}/${needed})`).setStyle(ButtonStyle.Primary)
                        );
                        await interaction.update({ components: [btn] }).catch(() => {});
                    }
                } catch (err) {
                    console.error('[Reso] Vote skip button error:', err);
                }
                return;
            }

            // Handle recommendation dropdown select menu & button clicks
            const isRecSelect = interaction.isStringSelectMenu() && interaction.customId?.startsWith('rec_select_');
            const isRecButton = interaction.isButton() && interaction.customId?.startsWith('rec_add_');

            if (isRecSelect || isRecButton) {
                try {
                    const parts = interaction.customId.split('_');
                    const guildId = parts[2];
                    const recIndex = isRecSelect ? parseInt(interaction.values[0], 10) : parseInt(parts[3], 10);

                    const memberVC = interaction.member?.voice?.channel;
                    if (!memberVC) {
                        return interaction.reply({
                            content: '❌ You need to be in a voice channel to add recommendations!',
                            flags: MessageFlags.Ephemeral,
                        });
                    }

                    const recs = client.recommendations.get(guildId) || [];
                    const recommendedTrack = recs[recIndex];

                    if (!recommendedTrack) {
                        return interaction.reply({
                            content: '❌ Recommendation no longer available.',
                            flags: MessageFlags.Ephemeral,
                        });
                    }

                    const targetNode = getBestNode(client.lavalink);
                    let player = client.lavalink.getPlayer(guildId);
                    if (!player) {
                        player = client.lavalink.createPlayer({
                            guildId: guildId,
                            voiceChannelId: memberVC.id,
                            textChannelId: interaction.channel.id,
                            selfDeaf: true,
                            volume: parseInt(process.env.DEFAULT_VOLUME) || 50,
                            node: targetNode?.id,
                        });
                    }

                    if (!player.connected) {
                        await player.connect();
                    }

                    await ensurePlayerNode(player, client);

                    recommendedTrack.requester = interaction.user;
                    player.queue.add(recommendedTrack);

                    if (!player.playing) {
                        await player.play();
                    }

                    const { truncate } = require('./utils/helpers');
                    const title = truncate(recommendedTrack.info?.title || 'Track', 45);

                    return interaction.reply({
                        content: `✅ Added recommended song **${title}** to the queue! 🎵`,
                        flags: MessageFlags.Ephemeral,
                    });
                } catch (recErr) {
                    console.error('[Reso] Recommendation interaction error:', recErr);
                    return interaction.reply({
                        content: '❌ Failed to queue recommendation.',
                        flags: MessageFlags.Ephemeral,
                    }).catch(() => {});
                }
            }

            if (!interaction.isChatInputCommand()) return;
            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                await command.execute(interaction, client);
            } catch (error) {
                // If interaction expired (code 10062 Unknown interaction), log a warning and return cleanly
                if (error.code === 10062 || error.message?.includes('Unknown interaction')) {
                    console.warn(`[Reso] Interaction for command "${interaction.commandName}" expired or invalid (10062)`);
                    return;
                }
                console.error(`[Reso] Command error (${interaction.commandName}):`, error);
                const errorMsg = {
                    content: '❌ An error occurred while executing this command.',
                    flags: MessageFlags.Ephemeral,
                };
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(errorMsg).catch(() => { });
                } else {
                    await interaction.reply(errorMsg).catch(() => { });
                }
            }
        });

        // Login with retry logic (handles transient Discord Gateway 503 errors)
        const MAX_LOGIN_RETRIES = 5;
        let loginAttempt = 0;

        while (loginAttempt < MAX_LOGIN_RETRIES) {
            try {
                loginAttempt++;
                console.log(`[Reso] Attempting to connect to Discord Gateway... (attempt ${loginAttempt}/${MAX_LOGIN_RETRIES})`);
                await client.login(process.env.DISCORD_TOKEN);
                break; // Success — exit retry loop
            } catch (loginError) {
                const isRetryable = loginError.message?.includes('503')
                    || loginError.message?.includes('502')
                    || loginError.message?.includes('ECONNRESET')
                    || loginError.message?.includes('ETIMEDOUT')
                    || loginError.message?.includes('Service Unavailable');

                if (isRetryable && loginAttempt < MAX_LOGIN_RETRIES) {
                    const delaySeconds = 10 * Math.pow(2, loginAttempt - 1); // 10s, 20s, 40s, 80s, 160s
                    console.warn(`[Reso] ⚠ Discord Gateway error (attempt ${loginAttempt}/${MAX_LOGIN_RETRIES}): ${loginError.message}`);
                    console.log(`[Reso] ⏳ Retrying in ${delaySeconds}s...`);
                    await new Promise(r => setTimeout(r, delaySeconds * 1000));

                    // Destroy the previous client state before retrying
                    try { client.destroy(); } catch {}
                } else {
                    // Non-retryable error or exhausted retries
                    throw loginError;
                }
            }
        }
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
