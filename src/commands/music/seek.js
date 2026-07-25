const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel, parseTime, formatTime } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('seek')
        .setDescription('Seek to a specific position in the current track')
        .addStringOption(option =>
            option.setName('time')
                .setDescription('Time to seek to (e.g., 1:30, 90, 2m30s)')
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

        const timeStr = interaction.options.getString('time', true);
        const seconds = parseTime(timeStr);

        if (seconds === null || seconds < 0) {
            return interaction.reply({ embeds: [errorEmbed('Invalid time format. Use formats like `1:30`, `90`, `2m30s`.')], ephemeral: true });
        }

        const ms = seconds * 1000;
        const trackDuration = player.queue.current?.info?.duration || 0;

        if (ms > trackDuration) {
            return interaction.reply({ embeds: [errorEmbed(`Cannot seek beyond the track duration (${formatTime(Math.floor(trackDuration / 1000))}).`)], ephemeral: true });
        }

        await player.seek(ms);
        return interaction.reply({ embeds: [successEmbed(`Seeked to **${formatTime(seconds)}** ⏱️`)] });
    },
};
