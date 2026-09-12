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

        // Delete previous Now Playing message so only one active message exists
        const prevMsg = interaction.client.lastNowPlayingMessage?.get(interaction.guild.id);
        if (prevMsg) {
            prevMsg.delete().catch(() => {});
            interaction.client.lastNowPlayingMessage?.delete(interaction.guild.id);
        }

        const reply = await interaction.reply({
            embeds: [embed],
            components: [controls],
            fetchReply: true,
        });

        interaction.client.lastNowPlayingMessage?.set(interaction.guild.id, reply);
        return reply;
    },
};
