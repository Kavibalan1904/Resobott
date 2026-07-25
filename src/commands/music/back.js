const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('back')
        .setDescription('Play the previous track'),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        // Get track history from client storage
        const history = interaction.client.trackHistory.get(interaction.guild.id) || [];

        // Need at least 2 entries (current + previous) to go back
        if (history.length < 2) {
            return interaction.reply({ embeds: [errorEmbed('There is no previous track in history.')], ephemeral: true });
        }

        await interaction.deferReply();

        try {
            // Get the previous track (second to last in history)
            const previousTrack = history[history.length - 2];

            // Add it to the front of the queue
            previousTrack.requester = interaction.user;
            player.queue.tracks.unshift(previousTrack);

            // Skip current track to play the previous one
            await player.skip();

            return interaction.editReply({ embeds: [successEmbed('Playing the previous track! ⏮️')] });
        } catch (error) {
            return interaction.editReply({ embeds: [errorEmbed('Could not go back to the previous track.')] });
        }
    },
};
