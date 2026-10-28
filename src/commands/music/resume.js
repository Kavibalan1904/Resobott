const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel, isInSameVoiceChannel } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume the paused track'),

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

        if (!player.paused) {
            return interaction.reply({ embeds: [errorEmbed('The music is already flowing smoothly! ✨')], ephemeral: true });
        }

        try {
            await player.resume();
            return interaction.reply({ embeds: [successEmbed('Music resumed — enjoy the vibes! ▶️ ✨')] });
        } catch (error) {
            console.error('[Reso] Resume error:', error);
            return interaction.reply({ embeds: [errorEmbed('Could not resume playback right now.')], ephemeral: true });
        }
    },
};
