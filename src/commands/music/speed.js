const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed, createEmbed, EMOJIS } = require('../../utils/embeds');
const { getVoiceChannel } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('speed')
        .setDescription('Change the playback speed (0.5x to 2.0x)')
        .addNumberOption(option =>
            option.setName('multiplier')
                .setDescription('Speed multiplier (0.5 = half speed, 2.0 = double speed)')
                .setRequired(true)
                .setMinValue(0.5)
                .setMaxValue(2.0)
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

        const speed = interaction.options.getNumber('multiplier', true);

        await interaction.deferReply();

        try {
            // Use Lavalink timescale filter — speed only, preserve pitch
            await player.node.updatePlayer({
                guildId: player.guildId,
                playerOptions: {
                    filters: {
                        ...player.filterData || {},
                        timescale: {
                            speed: speed,
                            pitch: 1.0,  // Keep original pitch
                            rate: 1.0,
                        },
                    },
                },
            });

            // Store the speed setting for display
            player.currentSpeed = speed;

            // Choose appropriate emoji based on speed
            let speedEmoji = EMOJIS.speed;
            let speedLabel = '';
            if (speed < 1.0) {
                speedEmoji = '🐢';
                speedLabel = 'Slowed down';
            } else if (speed === 1.0) {
                speedEmoji = '▶️';
                speedLabel = 'Normal speed';
            } else if (speed <= 1.5) {
                speedEmoji = '⏩';
                speedLabel = 'Sped up';
            } else {
                speedEmoji = '⚡';
                speedLabel = 'Turbo mode';
            }

            const embed = createEmbed('Success')
                .setDescription(
                    `${speedEmoji} **Playback speed set to \`${speed}x\`**\n\n` +
                    `> ${speedLabel} — ${speed < 1 ? 'Pitch preserved, tempo reduced' : speed === 1 ? 'Back to normal playback' : 'Pitch preserved, tempo increased'}\n` +
                    `> Use \`/speed 1.0\` to reset to normal.`
                );

            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('[Reso] Speed error:', error);
            return interaction.editReply({ embeds: [errorEmbed('Failed to change playback speed. Try again.')] });
        }
    },
};
