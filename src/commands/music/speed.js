const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, createEmbed, EMOJIS } = require('../../utils/embeds');
const { getVoiceChannel } = require('../../utils/helpers');
const { FILTER_PRESETS } = require('./filter');

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
        if (!player || (!player.playing && !player.paused) || !player.queue.current) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        const speed = interaction.options.getNumber('multiplier', true);

        await interaction.deferReply();

        try {
            // Rebuild the full filter object from all active filters first, then overlay the timescale speed
            if (!player.activeFilters) player.activeFilters = new Set();

            const combined = {};
            for (const filterName of player.activeFilters) {
                const preset = FILTER_PRESETS[filterName];
                if (!preset) continue;
                for (const [key, value] of Object.entries(preset.filter)) {
                    if (key === 'equalizer') {
                        if (!combined.equalizer) combined.equalizer = [];
                        for (const band of value) {
                            const existing = combined.equalizer.find(b => b.band === band.band);
                            if (existing) {
                                existing.gain = Math.min(1.0, existing.gain + band.gain);
                            } else {
                                combined.equalizer.push({ ...band });
                            }
                        }
                    } else if (key !== 'timescale') {
                        // Preserve non-timescale filters; timescale will be overridden by speed setting
                        combined[key] = value;
                    }
                }
            }

            // Apply the speed timescale, preserving pitch
            combined.timescale = { speed: speed, pitch: 1.0, rate: 1.0 };

            await player.node.updatePlayer({
                guildId: player.guildId,
                playerOptions: { filters: combined },
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
