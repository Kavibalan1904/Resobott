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
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player) {
            return interaction.reply({ embeds: [errorEmbed('I\'m not in a voice channel.')], ephemeral: true });
        }

        // Remove 24/7 mode if active
        interaction.client.twentyFourSeven?.delete(interaction.guild.id);

        await player.destroy();
        return interaction.reply({ embeds: [successEmbed('Disconnected from the voice channel. 👋')] });
    },
};
