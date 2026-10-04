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
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        if (!isInSameVoiceChannel(interaction)) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in the same voice channel as the bot!')], ephemeral: true });
        }

        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player || (!player.playing && !player.paused && !player.queue.current && player.queue.tracks.length === 0)) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        try {
            // Reset repeat mode if active
            if (player.repeatMode && player.repeatMode !== 'off') {
                await player.setRepeatMode('off').catch(() => {});
            }

            // Stop playback and clear the queue, but stay connected in voice
            player.queue.clear();
            await player.stopPlaying(true, false);

            return interaction.reply({ embeds: [successEmbed('Stopped playback and cleared the queue. Use `/leave` to disconnect. ⏹️')] });
        } catch (error) {
            console.error('[Reso] Stop error:', error);
            return interaction.reply({ embeds: [errorEmbed('Failed to stop playback.')], ephemeral: true });
        }
    },
};
