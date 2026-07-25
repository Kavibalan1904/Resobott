const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel } = require('../../utils/helpers');

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

        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player || !player.playing) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        const position = interaction.options.getInteger('position', true);

        if (position > player.queue.tracks.length) {
            return interaction.reply({ embeds: [errorEmbed(`Invalid position. Queue has **${player.queue.tracks.length}** tracks.`)], ephemeral: true });
        }

        // Remove all tracks before the target position
        player.queue.tracks.splice(0, position - 1);

        // Skip the current track to play the target
        await player.skip();
        return interaction.reply({ embeds: [successEmbed(`Skipped to position **#${position}** in the queue! ⏭️`)] });
    },
};
