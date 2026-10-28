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
            return interaction.reply({ embeds: [errorEmbed('Hop into a voice channel first! 🎧')], ephemeral: true });
        }

        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player || (!player.playing && !player.paused) || !player.queue.current) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now. Put on a song with `/play`! ☕')], ephemeral: true });
        }

        if (player.queue.tracks.length === 0) {
            return interaction.reply({ embeds: [errorEmbed('The queue is already clean and peaceful.')], ephemeral: true });
        }

        const count = player.queue.tracks.length;
        await player.queue.splice(0, count);
        return interaction.reply({ embeds: [successEmbed(`Cleared **${count}** tracks from the queue. Fresh slate! 🍃`)] });
    },
};
