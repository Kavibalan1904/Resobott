const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear the entire queue (keeps the current track playing)'),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player || !player.playing) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        if (player.queue.tracks.length === 0) {
            return interaction.reply({ embeds: [errorEmbed('The queue is already empty.')], ephemeral: true });
        }

        const count = player.queue.tracks.length;
        player.queue.tracks.splice(0, count);
        return interaction.reply({ embeds: [successEmbed(`Cleared **${count}** tracks from the queue! 🗑️`)] });
    },
};
