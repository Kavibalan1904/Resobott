const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed, EMOJIS } = require('../../utils/embeds');
const { getVoiceChannel } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Set or view the playback volume')
        .addIntegerOption(option =>
            option.setName('level')
                .setDescription('Volume level (0-100)')
                .setMinValue(0)
                .setMaxValue(100)
                .setRequired(false)
        ),

    async execute(interaction) {
        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player || !player.playing) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        const level = interaction.options.getInteger('level');

        // Show current volume if no level provided
        if (level === null) {
            const vol = player.volume;
            const emoji = vol === 0 ? EMOJIS.volumeMute : EMOJIS.volume;
            return interaction.reply({ embeds: [successEmbed(`${emoji} Current volume: **${vol}%**`)] });
        }

        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        await player.setVolume(level);

        let emoji = EMOJIS.volume;
        if (level === 0) emoji = EMOJIS.volumeMute;
        else if (level > 80) emoji = '🔊';
        else if (level > 40) emoji = '🔉';
        else emoji = '🔈';

        return interaction.reply({ embeds: [successEmbed(`${emoji} Volume set to **${level}%**`)] });
    },
};
