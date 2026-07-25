const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel, truncate } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('move')
        .setDescription('Move a track to a different position in the queue')
        .addIntegerOption(option =>
            option.setName('from')
                .setDescription('Current position of the track')
                .setMinValue(1)
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('to')
                .setDescription('New position for the track')
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

        const from = interaction.options.getInteger('from', true);
        const to = interaction.options.getInteger('to', true);
        const queueSize = player.queue.tracks.length;

        if (from > queueSize || to > queueSize) {
            return interaction.reply({ embeds: [errorEmbed(`Invalid positions. Queue has **${queueSize}** tracks.`)], ephemeral: true });
        }

        if (from === to) {
            return interaction.reply({ embeds: [errorEmbed('The positions are the same.')], ephemeral: true });
        }

        const track = player.queue.tracks[from - 1];

        // Manual splice to move the track
        const [removed] = player.queue.tracks.splice(from - 1, 1);
        player.queue.tracks.splice(to - 1, 0, removed);

        return interaction.reply({ embeds: [successEmbed(`Moved **${truncate(track?.info?.title, 50)}** from #${from} to #${to} 🔄`)] });
    },
};
