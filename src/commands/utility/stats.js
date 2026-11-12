const { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js');
const { createEmbed, EMOJIS } = require('../../utils/embeds');
const { formatUptime } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Show bot statistics and audio engine status')
        .setIntegrationTypes([
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall,
        ])
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel,
        ]),

    async execute(interaction, client) {
        const totalMembers = client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0);
        const totalGuilds = client.guilds.cache.size;

        // Lavalink & Player info
        const manager = client.lavalink;
        const nodes = manager?.nodeManager?.nodes;
        const connectedNodes = nodes ? [...nodes.values()].filter(n => n.connected).length : 0;
        const totalNodes = nodes ? nodes.size : 0;

        let activeStreams = 0;
        let totalSessions = 0;
        if (manager?.players) {
            totalSessions = manager.players.size;
            for (const player of manager.players.values()) {
                if (player?.playing) activeStreams++;
            }
        }

        const engineStatus = totalNodes === 0
            ? '⚪ Not Connected'
            : connectedNodes === totalNodes
                ? '🟢 All Systems Operational'
                : connectedNodes > 0
                    ? `🟡 Degraded (${connectedNodes}/${totalNodes} Online)`
                    : '🔴 Offline';

        const embed = createEmbed('Info')
            .setAuthor({
                name: 'Reso • Service Overview',
                iconURL: client.user?.displayAvatarURL?.(),
            })
            .setThumbnail(client.user?.displayAvatarURL?.({ size: 256 }))
            .addFields(
                {
                    name: '📊 Overview',
                    value: [
                        `${EMOJIS.disc} **Servers:** ${totalGuilds.toLocaleString()}`,
                        `👥 **Users Reached:** ${totalMembers.toLocaleString()}`,
                        `⌚ **Uptime:** ${formatUptime(client.uptime)}`,
                        `📋 **Commands:** ${client.commands?.size || 0}`,
                    ].join('\n'),
                    inline: true,
                },
                {
                    name: '🎵 Audio Engine',
                    value: [
                        `📻 **Status:** ${engineStatus}`,
                        `🎶 **Active Streams:** ${activeStreams}`,
                        `🎧 **Active Sessions:** ${totalSessions}`,
                    ].join('\n'),
                    inline: true,
                },
            );

        return interaction.reply({ embeds: [embed] });
    },
};
