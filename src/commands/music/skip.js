const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel, truncate } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current track'),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player || !player.playing) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        const currentTrack = player.queue.current;
        const title = currentTrack?.info?.title || 'Unknown';
        await player.skip();
        return interaction.reply({ embeds: [successEmbed(`Skipped **${truncate(title, 50)}** ⏭️`)] });
    },
};
