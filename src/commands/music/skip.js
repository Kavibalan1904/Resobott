const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel, isInSameVoiceChannel, truncate } = require('../../utils/helpers');
const { guildContextManager } = require('../../autoplay');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current track'),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('Hop into a voice channel first so I can play this for you! 🎧')], ephemeral: true });
        }

        if (!isInSameVoiceChannel(interaction)) {
            return interaction.reply({ embeds: [errorEmbed('Come join my voice channel so we can listen together! 🎧')], ephemeral: true });
        }

        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player || (!player.playing && !player.paused) || !player.queue.current) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now. Put on a song with `/play`! ☕')], ephemeral: true });
        }

        const currentTrack = player.queue.current;
        const title = currentTrack?.info?.title || 'Unknown';

        try {
            // Record skip event in autoplay listening context
            try {
                const startTime = player.get('trackStartTime') || 0;
                const elapsedMs = startTime ? Date.now() - startTime : null;
                guildContextManager.getContext(interaction.guild.id)?.recordTrackSkip(currentTrack, elapsedMs);
            } catch { /* ignore */ }

            // Use (0, false) so skipping the last track does not throw RangeError
            await player.skip(0, false);
            return interaction.reply({ embeds: [successEmbed(`Skipped **${truncate(title, 50)}** — moving along to the next one ✨`)] });
        } catch (error) {
            console.error('[Reso] Skip error:', error);
            return interaction.reply({ embeds: [errorEmbed('Could not skip this track right now.')], ephemeral: true });
        }
    },
};
