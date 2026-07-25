const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel, truncate } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Remove a track from the queue by position')
        .addIntegerOption(option =>
            option.setName('position')
                .setDescription('Position of the track in queue (use /queue to see positions)')
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

        const removed = player.queue.tracks[position - 1];
        player.queue.remove(position - 1);

        return interaction.reply({ embeds: [successEmbed(`Removed **${truncate(removed?.info?.title, 50)}** from position #${position} 🗑️`)] });
    },
};
