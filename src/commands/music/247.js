const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed, EMOJIS } = require('../../utils/embeds');
const { getVoiceChannel } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('247')
        .setDescription('Toggle 24/7 mode — bot stays in voice channel even when idle'),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        const guildId = interaction.guild.id;
        const isEnabled = interaction.client.twentyFourSeven?.has(guildId);

        if (isEnabled) {
            // Disable 24/7 mode
            interaction.client.twentyFourSeven.delete(guildId);

            return interaction.reply({ embeds: [successEmbed(`${EMOJIS.error} **24/7 mode** has been **disabled**. I'll leave when the queue ends or the channel is empty.`)] });
        } else {
            // Enable 24/7 mode
            interaction.client.twentyFourSeven.add(guildId);

            return interaction.reply({ embeds: [successEmbed(`${EMOJIS.success} **24/7 mode** has been **enabled**. I'll stay in the voice channel until you use \`/leave\` or \`/stop\`.`)] });
        }
    },
};
