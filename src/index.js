require('dotenv').config();

// ── Force IPv4 First (Fixes container IPv6 blackhole hanging on Wispbyte / Docker) ──
const dns = require('dns');
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

const { Client, GatewayIntentBits, Collection, MessageFlags } = require('discord.js');
const { LavalinkManager } = require('lavalink-client');
const { loadCommands, registerSlashCommands } = require('./handlers/commandHandler');
const { setupLavalinkEvents } = require('./handlers/playerEvents');
const { handlePlayerButton } = require('./handlers/buttonHandler');

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

// ── Create Lavalink Manager ────────────────────────────────────
const defaultNodes = [];
const addedHosts = new Set();

// 1. Region-Optimized Node from .env (Highest Priority)
if (process.env.LAVALINK_HOST) {
    const host = process.env.LAVALINK_HOST.trim()
        .replace(/^(https?|wss?):\/\//i, '') // Remove http://, https://, ws://, wss://
        .replace(/\/.*$/, ''); // Remove trailing slashes or paths
    const port = parseInt(process.env.LAVALINK_PORT) || 443;

    console.log(`[Reso] Loading primary Lavalink node from .env: ${host}:${port}`);
    defaultNodes.push({
        id: 'node-env-primary',
        host: host,
        port: port,
        authorization: process.env.LAVALINK_PASSWORD ? process.env.LAVALINK_PASSWORD.trim() : 'youshallnotpass',
        secure: String(process.env.LAVALINK_SECURE).toLowerCase() === 'true' || port === 443,
        retryAmount: Infinity, // Never give up reconnecting — prevents "No Lavalink Node" after idle
        retryDelay: 10000,     // Retry every 10 seconds
    });
    addedHosts.add(`${host.toLowerCase()}:${port}`);
}

// 2. Backup / Fallback Public Nodes (Lavalink v4 — SSL-first for reliability)
//    These activate automatically if the primary .env node goes down.
//    Curated from community lists — SSL nodes (port 443) are prioritized.
const backupNodes = [
    // ── SSL Nodes (Port 443 — Most Reliable) ───────────────────
    {
        id: 'backup-ssl-1-jirayu',
        host: 'lavalink.jirayu.net',
        port: 443,
        authorization: 'youshallnotpass',
        secure: true,
        retryAmount: Infinity,
        retryDelay: 15000,
    },
    {
        id: 'backup-ssl-2-horizxon',
        host: 'v4.lavalink.rocks',
        port: 443,
        authorization: 'horizxon.tech',
        secure: true,
        retryAmount: Infinity,
        retryDelay: 15000,
    },
    {
        id: 'backup-ssl-3-trinium',
        host: 'lavalink-v4.triniumhost.com',
        port: 443,
        authorization: 'free',
        secure: true,
        retryAmount: Infinity,
        retryDelay: 15000,
    },
    {
        id: 'backup-ssl-4-catfein',
        host: 'lavalink.alfari.id',
        port: 443,
        authorization: 'catfein',
        secure: true,
        retryAmount: Infinity,
        retryDelay: 15000,
    },
    {
        id: 'backup-ssl-5-akshat',
        host: 'lava.akshat.tech',
        port: 443,
        authorization: 'admin',
        secure: true,
        retryAmount: Infinity,
        retryDelay: 15000,
    },
    {
        id: 'backup-ssl-6-serenetia',
        host: 'lavalinkv4.serenetia.com',
        port: 443,
        authorization: 'https://seretia.link/discord',
        secure: true,
        retryAmount: Infinity,
        retryDelay: 15000,
    },
    // ── Non-SSL Fallback Nodes ──────────────────────────────────
    {
        id: 'backup-nossl-1-g3v',
        host: 'lava.g3v.co.uk',
        port: 9008,
        authorization: 'lavalinklol',
        secure: false,
        retryAmount: Infinity,
        retryDelay: 15000,
    },
    {
        id: 'backup-nossl-2-nexcloud',
        host: 'n3.nexcloud.in',
        port: 2026,
        authorization: 'nexcloud',
        secure: false,
        retryAmount: Infinity,
        retryDelay: 15000,
    },
    {
        id: 'backup-nossl-3-nyc',
        host: 'nyc01.jxshua.dev',
        port: 4000,
        authorization: 'youshallnotpass',
        secure: false,
        retryAmount: Infinity,
        retryDelay: 15000,
    },
    {
        id: 'backup-nossl-4-rudra',
        host: 'lavalink.rudracloud.com',
        port: 2333,
        authorization: 'RudraCloud.com',
        secure: false,
        retryAmount: Infinity,
        retryDelay: 15000,
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
        defaultSearchPlatform: 'spsearch', // Spotify search (bypasses YouTube datacenter IP login blocks)
        clientBasedPositionUpdateInterval: 500, // Update player position smoothly every 500ms instead of aggressive 100ms timer
        onDisconnect: {
            autoReconnect: true,
            destroyPlayer: false,
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
