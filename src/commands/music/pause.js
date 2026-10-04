const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel, isInSameVoiceChannel } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause the current track'),

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

        if (player.paused) {
            return interaction.reply({ embeds: [errorEmbed('The player is already paused. Use `/resume` to continue.')], ephemeral: true });
        }

        try {
            await player.pause();
            return interaction.reply({ embeds: [successEmbed('Paused the current track. Use `/resume` to continue. ⏸️')] });
        } catch (error) {
            console.error('[Reso] Pause error:', error);
            return interaction.reply({ embeds: [errorEmbed('Failed to pause playback.')], ephemeral: true });
        }
    },
};
