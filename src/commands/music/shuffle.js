const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Shuffle the queue'),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player || !player.playing) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        if (player.queue.tracks.length < 2) {
            return interaction.reply({ embeds: [errorEmbed('Need at least 2 tracks in the queue to shuffle.')], ephemeral: true });
        }

        player.queue.shuffle();
        return interaction.reply({ embeds: [successEmbed(`Shuffled **${player.queue.tracks.length}** tracks! 🔀`)] });
    },
};
