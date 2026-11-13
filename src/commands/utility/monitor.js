const {
    SlashCommandBuilder,
    ApplicationIntegrationType,
    InteractionContextType,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { createEmbed, Colors, EMOJIS, getSourceBadge } = require('../../utils/embeds');
const { isOwner } = require('../../utils/owner');
const { getSystemMetrics } = require('../../utils/dashboard');
const { createProgressBar, formatMs, truncate } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('monitor')
        .setDescription('Private owner dashboard for audio engine health & live sessions')
        .setIntegrationTypes([
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall,
        ])
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel,
        ]),

    ownerOnly: true,
    aliases: ['sys', 'nodes', 'dash'],

    async execute(interaction, client) {
        // ── 1. Strict Owner Authorization ──
        const authorized = await isOwner(interaction.user.id, client);
        if (!authorized) {
            return interaction.reply({
                content: '❌ This command is restricted to the bot owner.',
                flags: MessageFlags.Ephemeral,
            });
        }

        // Defer reply ephemerally so ONLY the owner can view this
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const metrics = getSystemMetrics(client);
        const embeds = buildMonitorEmbeds(metrics, client);
        const components = buildMonitorButtons(metrics);

        return interaction.editReply({
            embeds,
            components,
        });
    },
};

function buildMonitorEmbeds(metrics, client) {
    const embeds = [];

    // ── Embed 1: Audio Engine & Node Health ──
    const primaryNode = metrics.nodes.find(n => n.isPrimary) || metrics.nodes[0];
    const isBufferRisk = metrics.nodes.some(n => n.frames.lossPercent > 2);

    let healthColor = Colors.Primary;
    if (isBufferRisk || metrics.nodes.some(n => !n.connected)) {
        healthColor = Colors.Warning;
    }

    const nodeOverview = createEmbed('Primary')
        .setColor(healthColor)
        .setAuthor({
            name: 'Reso • Owner System & Health Monitor',
            iconURL: client.user?.displayAvatarURL?.(),
        })
        .setDescription(
            `🔒 **Owner Private View** • Real-time diagnostic metrics\n` +
            `• **Discord WS:** \`${metrics.bot.wsPingMs}ms\` • **Bot Uptime:** \`${metrics.bot.uptimeFormatted}\`\n` +
            `• **Bot RAM:** \`${metrics.bot.rssMb}MB\` (Heap: \`${metrics.bot.heapUsedMb}MB\`) • **Guilds:** \`${metrics.bot.guildsCount}\``
        );

    for (const node of metrics.nodes) {
        const role = node.isPrimary ? '⭐ PRIMARY' : '⚪ BACKUP';
        const status = node.connected ? '🟢 Online' : '🔴 Offline';
        const pingStr = node.latencyMs != null ? `\`${node.latencyMs}ms\`` : '`--`';
        const frames = node.frames;

        let frameRating = '🟢 **0% Loss** (Clean audio)';
        if (frames.lossPercent > 5) {
            frameRating = `🔴 **${frames.lossPercent}% Frame Deficit** ⚠️ *Active Buffering*`;
        } else if (frames.lossPercent > 1) {
            frameRating = `🟡 **${frames.lossPercent}% Jitter** (Minor drop)`;
        }

        const fieldTitle = `${node.connected ? '🟢' : '🔴'} ${node.id} (${role})`;
        const fieldLines = [
            `> **Status:** ${status} • **Ping:** ${pingStr} • **Uptime:** \`${formatMs(node.uptime)}\``,
            `> **CPU:** System \`${node.cpuSystem}%\` | Lavalink \`${node.cpuLavalink}%\``,
            `> **Memory:** \`${node.memUsedMb}MB\` / \`${node.memAllocatedMb}MB\``,
            `> **Audio Frames:** ${frameRating}`,
            `> ↳ *Sent:* \`${frames.sent.toLocaleString()}\` | *Nulled:* \`${frames.nulled}\` | *Deficit:* \`${frames.deficit}\``,
            `> **Streams On Node:** \`${node.players}\` active (\`${node.totalPlayers}\` total)`,
        ];

        nodeOverview.addFields({
            name: fieldTitle,
            value: fieldLines.join('\n'),
            inline: false,
        });
    }

    embeds.push(nodeOverview);

    // ── Embed 2: Live Playback Sessions ──
    const sessionsEmbed = createEmbed('Info')
        .setTitle(`🎧 Live Playback Sessions (${metrics.activeStreamsCount} active / ${metrics.totalSessionsCount} total)`);

    if (metrics.sessions.length === 0) {
        sessionsEmbed.setDescription('☕ *No music is currently playing in any server.*');
    } else {
        // Show up to 6 most active sessions
        const displaySessions = metrics.sessions.slice(0, 6);
        for (const session of displaySessions) {
            const track = session.track;
            const sourceBadge = track ? getSourceBadge(track.source) : { label: 'Unknown', emoji: '🎵' };
            const statusEmoji = session.paused ? '⏸' : '▶️';
            const progress = (track && track.durationMs > 0)
                ? createProgressBar(session.positionMs, track.durationMs, 12)
                : (track?.isStream ? '🔴 Live Stream' : '0:00 ▬ 0:00');

            const title = `${statusEmoji} ${truncate(session.guildName, 30)} (\`${session.guildId}\`)`;
            const lines = [
                `> **Track:** **[${truncate(track?.title || 'Unknown', 45)}](${track?.uri || ''})**`,
                `> **Artist:** ${truncate(track?.author || 'Unknown', 30)} • **Source:** ${sourceBadge.emoji} \`${sourceBadge.label}\``,
                `> **Progress:** ${progress}`,
                `> **Volume:** \`${session.volume}%\` • **Node:** \`${session.nodeId}\``,
            ];

            sessionsEmbed.addFields({
                name: title,
                value: lines.join('\n'),
                inline: false,
            });
        }

        if (metrics.sessions.length > 6) {
            sessionsEmbed.setFooter({
                text: `+ ${metrics.sessions.length - 6} more active sessions. Check the web dashboard for complete list.`,
            });
        }
    }

    embeds.push(sessionsEmbed);
    return embeds;
}

function buildMonitorButtons(metrics) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('monitor_refresh')
            .setLabel('🔄 Refresh')
            .setStyle(ButtonStyle.Primary)
    );

    // Add web dashboard link if PORT or web URL is configured
    const port = parseInt(process.env.SERVER_PORT || process.env.PORT || process.env.DASHBOARD_PORT) || 3000;
    const key = (process.env.DASHBOARD_KEY || process.env.OWNER_ID || 'reso').trim();
    const dashboardHost = process.env.DASHBOARD_URL || `http://localhost:${port}`;

    if (dashboardHost.startsWith('http')) {
        row.addComponents(
            new ButtonBuilder()
                .setLabel('🌐 Open Web Dashboard')
                .setStyle(ButtonStyle.Link)
                .setURL(`${dashboardHost.replace(/\/$/, '')}/dashboard?key=${encodeURIComponent(key)}`)
        );
    }

    return [row];
}

module.exports.buildMonitorEmbeds = buildMonitorEmbeds;
module.exports.buildMonitorButtons = buildMonitorButtons;

