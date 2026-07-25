const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, nowPlayingEmbed } = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Show the currently playing track with progress'),

    async execute(interaction) {
        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player || !player.playing) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        const track = player.queue.current;
        if (!track) {
            return interaction.reply({ embeds: [errorEmbed('No track information available.')], ephemeral: true });
        }

        const embed = nowPlayingEmbed(track, player);
        return interaction.reply({ embeds: [embed] });
    },
};
