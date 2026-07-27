const { SlashCommandBuilder } = require('discord.js');
const { createEmbed, EMOJIS } = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Show bot and API latency'),

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

        return interaction.editReply({ embeds: [embed] });
    },
};
