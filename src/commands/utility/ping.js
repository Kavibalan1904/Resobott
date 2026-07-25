const { SlashCommandBuilder } = require('discord.js');
const { createEmbed, EMOJIS } = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Show bot and API latency'),

    async execute(interaction, client) {
        const sent = await interaction.deferReply({ fetchReply: true });
        const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
        const wsLatency = client.ws.ping;

        const getLatencyEmoji = (ms) => {
            if (ms < 100) return '🟢';
            if (ms < 200) return '🟡';
            return '🔴';
        };

        const embed = createEmbed('Info')
            .setAuthor({ name: `${EMOJIS.ping} Pong!` })
            .addFields(
                { name: '📡 Bot Latency', value: `${getLatencyEmoji(roundtrip)} \`${roundtrip}ms\``, inline: true },
                { name: '💓 WebSocket', value: `${getLatencyEmoji(wsLatency)} \`${wsLatency}ms\``, inline: true },
            );

        return interaction.editReply({ embeds: [embed] });
    },
};
