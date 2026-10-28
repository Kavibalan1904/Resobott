const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Disconnect from the voice channel'),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('Hop into a voice channel first! 🎧')], ephemeral: true });
        }

        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player) {
            return interaction.reply({ embeds: [errorEmbed('I am not in a voice channel right now.')], ephemeral: true });
        }

        // Remove 24/7 mode if active
        interaction.client.twentyFourSeven?.delete(interaction.guild.id);

        await player.destroy();
        return interaction.reply({ embeds: [successEmbed('Left the voice channel — take care and see you next time! 🍃 👋')] });
    },
};
