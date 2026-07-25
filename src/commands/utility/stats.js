const { SlashCommandBuilder, version: djsVersion } = require('discord.js');
const { createEmbed, EMOJIS } = require('../../utils/embeds');
const { formatUptime } = require('../../utils/helpers');
const os = require('os');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Show bot statistics and system information'),

    async execute(interaction, client) {
        const memUsage = process.memoryUsage();
        const heapUsed = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
        const heapTotal = (memUsage.heapTotal / 1024 / 1024).toFixed(1);
        const rss = (memUsage.rss / 1024 / 1024).toFixed(1);

        const totalMembers = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
        const totalChannels = client.channels.cache.size;

        // Lavalink node info
        const nodes = client.lavalink.nodeManager.nodes;
        const connectedNodes = [...nodes.values()].filter(n => n.connected).length;
        const totalPlayers = [...nodes.values()].reduce((acc, n) => acc + (n.stats?.players || 0), 0);

        const embed = createEmbed('Info')
            .setAuthor({ name: 'Reso Statistics', iconURL: client.user.displayAvatarURL() })
            .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
            .addFields(
                { name: '📊 General', value: [
                    `${EMOJIS.disc} **Servers:** ${client.guilds.cache.size}`,
                    `👥 **Users:** ${totalMembers.toLocaleString()}`,
                    `📺 **Channels:** ${totalChannels}`,
                    `⌚ **Uptime:** ${formatUptime(client.uptime)}`,
                ].join('\n'), inline: true },

                { name: '🖥️ System', value: [
                    `📦 **Node.js:** ${process.version}`,
                    `🔧 **Discord.js:** v${djsVersion}`,
                    `💾 **Memory:** ${heapUsed}/${heapTotal} MB`,
                    `📊 **RSS:** ${rss} MB`,
                ].join('\n'), inline: true },

                { name: '🎵 Music (Lavalink)', value: [
                    `🟢 **Nodes:** ${connectedNodes}/${nodes.size} connected`,
                    `🎤 **Players:** ${totalPlayers} active`,
                    `📋 **Commands:** ${client.commands.size}`,
                    `🌐 **Platform:** ${os.platform()} ${os.arch()}`,
                ].join('\n'), inline: true },
            );

        return interaction.reply({ embeds: [embed] });
    },
};
