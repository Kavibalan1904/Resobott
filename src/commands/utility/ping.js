const { SlashCommandBuilder } = require('discord.js');
const { createEmbed, EMOJIS } = require('../../utils/embeds');
const { getNodeHealthSummary, formatUptime } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Show bot, API, and Lavalink node latency'),

    async execute(interaction, client) {
        const response = await interaction.deferReply({ withResponse: true });
        const roundtrip = Math.abs((response?.resource?.message?.createdTimestamp || Date.now()) - interaction.createdTimestamp);
        const wsLatency = Math.max(0, client.ws.ping);

        const getLatencyEmoji = (ms) => {
            if (ms < 150) return '🟢';
            if (ms < 300) return '🟡';
            return '🔴';
        };

        const embed = createEmbed('Info')
            .setAuthor({ name: `${EMOJIS.ping} Pong!` })
            .addFields(
                { name: '📡 API Latency', value: `${getLatencyEmoji(roundtrip)} \`${roundtrip}ms\``, inline: true },
                { name: '💓 WebSocket', value: `${getLatencyEmoji(wsLatency)} \`${wsLatency}ms\``, inline: true },
            );

        // ── Lavalink Node Health ──
        const manager = client.lavalink;
        if (manager) {
            const nodes = getNodeHealthSummary(manager);

            if (nodes.length > 0) {
                const nodeLines = nodes.map((n, i) => {
                    if (!n.connected) {
                        return `⚫ ~~${n.id}~~ — Offline`;
                    }

                    const isFirst = i === 0; // Best node (sorted by score)
                    const prefix = isFirst ? '⭐' : '🟢';
                    const latStr = n.latencyMs != null ? `\`${n.latencyMs}ms\`` : '`?`';
                    const scoreStr = n.score != null ? `Score: \`${n.score}\`` : '';
                    const frameStr = n.frameHealth != null ? `Frames: \`${n.frameHealth}%\`` : '';
                    const cpuStr = n.cpuLoad != null ? `CPU: \`${n.cpuLoad}%\`` : '';
                    const playerStr = `Players: \`${n.players}/${n.totalPlayers}\``;
                    const errorStr = n.hasRecentError ? ' ⚠️' : '';
                    const uptimeStr = n.uptime ? `Up: \`${formatUptime(n.uptime)}\`` : '';

                    const details = [latStr, scoreStr, frameStr, cpuStr, playerStr, uptimeStr]
                        .filter(Boolean)
                        .join(' • ');

                    return `${prefix} **${n.id}**${errorStr}\n> ${details}`;
                });

                embed.addFields({
                    name: '🎵 Lavalink Nodes',
                    value: nodeLines.join('\n') || 'No nodes configured',
                    inline: false,
                });
            }
        }

        return interaction.editReply({ embeds: [embed] });
    },
};
