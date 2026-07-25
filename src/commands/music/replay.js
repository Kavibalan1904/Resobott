const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel, truncate } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('replay')
        .setDescription('Restart the current track from the beginning'),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player || !player.playing) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        const track = player.queue.current;
        await player.seek(0);
        return interaction.reply({ embeds: [successEmbed(`Replaying **${truncate(track?.info?.title, 50)}** from the beginning! 🔄`)] });
    },
};
