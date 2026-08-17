const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, nowPlayingEmbed, createPlayerControls } = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Show the currently playing track with interactive controls'),

    async execute(interaction) {
        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player || !player.playing) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        const track = player.queue.current;
        if (!track) {
            return interaction.reply({ embeds: [errorEmbed('No track information available.')], ephemeral: true });
        }

        const embed = nowPlayingEmbed(track, player, interaction.client);
        const controls = createPlayerControls(player.paused);

        return interaction.reply({
            embeds: [embed],
            components: [controls],
        });
    },
};
