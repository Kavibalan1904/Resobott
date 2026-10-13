const { SlashCommandBuilder } = require('discord.js');
const { createEmbed, Colors, EMOJIS } = require('../../utils/embeds');
const { getNodeHealthSummary, formatUptime } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Show bot, API, and Lavalink node latency'),

    async execute(interaction, client) {
        const startTime = Date.now();
        await interaction.deferReply();

        // ── 1. Calculate API Latency (Roundtrip) ──
        let apiLatency = null;
        try {
            if (typeof interaction.fetchReply === 'function') {
                const reply = await interaction.fetchReply();
                if (reply?.createdTimestamp && interaction.createdTimestamp) {
                    apiLatency = Math.round(reply.createdTimestamp - interaction.createdTimestamp);
                }
            }
        } catch {
            // fallback handled below
        }

        // Resilient fallback: elapsed time between command issuance and reply
        if (apiLatency == null || isNaN(apiLatency) || apiLatency < 0) {
            const baseTime = (interaction.createdTimestamp && !isNaN(interaction.createdTimestamp))
                ? interaction.createdTimestamp
                : startTime;
            apiLatency = Math.max(1, Math.round(Date.now() - baseTime));
        }

        // Safety clamp against clock skew anomalies
        if (isNaN(apiLatency) || apiLatency <= 0 || apiLatency > 15000) {
            apiLatency = Math.max(1, Math.round(Date.now() - startTime));
        }

        // ── 2. WebSocket Latency ──
        const rawWs = client.ws?.ping;
        const wsLatency = (rawWs != null && !isNaN(rawWs) && rawWs >= 0) ? Math.round(rawWs) : 0;

        // ── 3. Helper for Latency Quality Badges ──
        const getLatencyStatus = (ms) => {
            if (ms < 150) return { emoji: '🟢', label: 'Optimal' };
            if (ms < 300) return { emoji: '🟡', label: 'Good' };
            return { emoji: '🔴', label: 'Degraded' };
        };

        const apiStatus = getLatencyStatus(apiLatency);
        const wsStatus = getLatencyStatus(wsLatency);

        // ── 4. Lavalink Nodes Health ──
        const manager = client.lavalink;
        const nodes = manager ? getNodeHealthSummary(manager) : [];
        const connectedNodes = nodes.filter(n => n.connected);
        const hasOfflineNodes = nodes.length > 0 && connectedNodes.length < nodes.length;
        const allNodesOffline = nodes.length > 0 && connectedNodes.length === 0;

        // Overall status color
        let embedColor = Colors.Primary;
        if (allNodesOffline || apiLatency >= 350 || wsLatency >= 350) {
            embedColor = Colors.Error;
        } else if (hasOfflineNodes || apiLatency >= 200 || wsLatency >= 200) {
            embedColor = Colors.Warning;
        }

        // Reso active player count
        let resoPlayingCount = 0;
        let resoTotalSessions = 0;
        if (manager?.players) {
            resoTotalSessions = manager.players.size;
            for (const player of manager.players.values()) {
                if (player?.playing) resoPlayingCount++;
            }
        }

        const engineEmoji = allNodesOffline ? '🔴' : hasOfflineNodes ? '🟡' : '🟢';

        const embed = createEmbed('Primary')
            .setColor(embedColor)
            .setAuthor({
                name: '🏓 Pong! • Network & Audio Engine Health',
                iconURL: client.user?.displayAvatarURL?.(),
            })
            .addFields(
                {
                    name: '📡 API Latency',
                    value: `${apiStatus.emoji} \`${apiLatency}ms\` • *${apiStatus.label}*`,
                    inline: true,
                },
                {
                    name: '💓 WebSocket',
                    value: `${wsStatus.emoji} \`${wsLatency}ms\` • *${wsStatus.label}*`,
                    inline: true,
                },
                {
                    name: '🎧 Audio Engine',
                    value: nodes.length > 0
                        ? `${engineEmoji} \`${connectedNodes.length}/${nodes.length} Online\``
                        : '⚪ `No Nodes`',
                    inline: true,
                },
            );

        if (nodes.length > 0) {
            const nodeLines = nodes.map((n) => {
                const isPrimary = n.isPrimary || n.id === 'primary-main';
                const roleBadge = isPrimary ? '`PRIMARY`' : '`BACKUP`';

                if (!n.connected) {
                    return `⚫ ~~**${n.id}**~~ ${roleBadge} • 🔴 Offline\n> ⚠️ *Node disconnected — auto-failover active*`;
                }

                const prefix = isPrimary ? '⭐' : '🟢';
                const stateLabel = isPrimary ? 'Active' : 'Standby';
                const latMs = n.latencyMs != null && !isNaN(n.latencyMs) ? Math.round(n.latencyMs) : null;
                const nodeLatStatus = latMs != null ? getLatencyStatus(latMs) : { emoji: '⚪' };
                const latStr = latMs != null ? `${nodeLatStatus.emoji} \`${latMs}ms\`` : '`--`';

                const cpuStr = n.cpuLoad != null ? `CPU: \`${n.cpuLoad}%\`` : null;
                const ramStr = n.memUsedMb != null ? `RAM: \`${n.memUsedMb}MB\`` : null;
                const playerStr = `Players: \`${n.players}/${n.totalPlayers}\``;
                const uptimeStr = n.uptime ? `Up: \`${formatUptime(n.uptime)}\`` : null;
                const errTag = n.hasRecentError ? ' ⚠️ *Recent drops*' : '';

                const details = [latStr, cpuStr, ramStr, playerStr, uptimeStr]
                    .filter(Boolean)
                    .join(' • ');

                return `${prefix} **${n.id}** ${roleBadge} • 🟢 ${stateLabel}${errTag}\n> ${details}`;
            });

            embed.addFields({
                name: '🎵 Lavalink Nodes',
                value: nodeLines.join('\n\n') || 'No nodes configured',
                inline: false,
            });
        }

        if (resoTotalSessions > 0) {
            embed.setFooter({
                text: `Reso  ♪  ${resoPlayingCount} active stream${resoPlayingCount !== 1 ? 's' : ''} across ${resoTotalSessions} session${resoTotalSessions !== 1 ? 's' : ''}`,
            });
        }

        return interaction.editReply({ embeds: [embed] });
    },
};
