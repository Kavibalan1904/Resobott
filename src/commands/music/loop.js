const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed, EMOJIS } = require('../../utils/embeds');
const { getVoiceChannel } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('loop')
        .setDescription('Set the loop mode')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('Loop mode')
                .setRequired(true)
                .addChoices(
                    { name: '❌ Off', value: 'off' },
                    { name: '🔂 Track', value: 'track' },
                    { name: '🔁 Queue', value: 'queue' },
                )
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

        const mode = interaction.options.getString('mode', true);

        // lavalink-client repeat modes: 0 = off, 1 = track, 2 = queue
        const modeMap = {
            'off': 0,
            'track': 1,
            'queue': 2,
        };

        const modeLabels = {
            'off': `${EMOJIS.error} Loop is now **Off**`,
            'track': `${EMOJIS.loopOne} Now looping the **current track**`,
            'queue': `${EMOJIS.loop} Now looping the **entire queue**`,
        };

        player.setRepeatMode(modeMap[mode]);
        return interaction.reply({ embeds: [successEmbed(modeLabels[mode])] });
    },
};
