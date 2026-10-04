const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel, isInSameVoiceChannel } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skipto')
        .setDescription('Skip to a specific position in the queue')
        .addIntegerOption(option =>
            option.setName('position')
                .setDescription('Position in queue to skip to')
                .setMinValue(1)
                .setRequired(true)
        ),

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

        const position = interaction.options.getInteger('position', true);

        if (position > player.queue.tracks.length) {
            return interaction.reply({ embeds: [errorEmbed(`Invalid position. Queue has **${player.queue.tracks.length}** tracks.`)], ephemeral: true });
        }

        try {
            // Remove tracks before the target position
            if (position > 1) {
                await player.queue.splice(0, position - 1);
            }

            // Skip current track without throwing RangeError
            await player.skip(0, false);
            return interaction.reply({ embeds: [successEmbed(`Skipped to position **#${position}** in the queue! ⏭️`)] });
        } catch (error) {
            console.error('[Reso] Skipto error:', error);
            return interaction.reply({ embeds: [errorEmbed('Failed to skip to that position.')], ephemeral: true });
        }
    },
};
