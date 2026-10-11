const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel, isInSameVoiceChannel } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop playback and clear the queue (stays in voice channel)'),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({
                embeds: [errorEmbed('You need to be in a voice channel!')],
                ephemeral: true
            });
        }

        if (!isInSameVoiceChannel(interaction)) {
            return interaction.reply({
                embeds: [errorEmbed('You need to be in the same voice channel as the bot!')],
                ephemeral: true
            });
        }

        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player) {
            return interaction.reply({
                embeds: [errorEmbed('Nothing is playing right now.')],
                ephemeral: true
            });
        }

        try {
            // Disable repeat so the stopped track cannot be replayed.
            if (player.repeatMode && player.repeatMode !== 'off') {
                await player.setRepeatMode('off').catch(() => {});
            }

            // Stop the current track first, then clear anything waiting in the queue.
            // Keep the player alive so Reso remains in the voice channel.
            await player.stopPlaying(false, false);
            player.queue.clear();

            return interaction.reply({
                embeds: [
                    successEmbed('Stopped playback and cleared the queue. Use `/leave` to disconnect. ⏹️')
                ]
            });
        } catch (error) {
            console.error('[Reso] Stop error:', error);

            const message = error?.message || String(error);

            return interaction.reply({
                embeds: [
                    errorEmbed(`Failed to stop playback: ${message}`)
                ],
                ephemeral: true
            });
        }
    },
};
