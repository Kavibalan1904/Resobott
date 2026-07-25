const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop playback, clear the queue, and disconnect'),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        // Remove 24/7 mode if active
        interaction.client.twentyFourSeven?.delete(interaction.guild.id);

        await player.destroy();
        return interaction.reply({ embeds: [successEmbed('Stopped playback, cleared the queue, and disconnected. 👋')] });
    },
};
