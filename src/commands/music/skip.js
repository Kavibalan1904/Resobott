const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel, isInSameVoiceChannel, truncate } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current track'),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        if (!isInSameVoiceChannel(interaction)) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in the same voice channel as the bot!')], ephemeral: true });
        }

        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player || (!player.playing && !player.paused) || !player.queue.current) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        const currentTrack = player.queue.current;
        const title = currentTrack?.info?.title || 'Unknown';

        try {
            // Use (0, false) so skipping the last track does not throw RangeError
            await player.skip(0, false);
            return interaction.reply({ embeds: [successEmbed(`Skipped **${truncate(title, 50)}** ⏭️`)] });
        } catch (error) {
            console.error('[Reso] Skip error:', error);
            return interaction.reply({ embeds: [errorEmbed('Failed to skip track.')], ephemeral: true });
        }
    },
};
