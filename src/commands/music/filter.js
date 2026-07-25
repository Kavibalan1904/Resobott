const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed, createEmbed, EMOJIS } = require('../../utils/embeds');
const { getVoiceChannel } = require('../../utils/helpers');

// Lavalink filter presets — mapped to native Lavalink filter parameters
const FILTER_PRESETS = {
    bassboost: {
        label: 'Bass Boost', emoji: '🔊',
        filter: {
            equalizer: [
                { band: 0, gain: 0.6 }, { band: 1, gain: 0.5 },
                { band: 2, gain: 0.4 }, { band: 3, gain: 0.3 },
                { band: 4, gain: 0.15 },
            ],
        },
    },
    nightcore: {
        label: 'Nightcore', emoji: '🌙',
        filter: {
            timescale: { speed: 1.25, pitch: 1.3, rate: 1.0 },
        },
    },
    vaporwave: {
        label: 'Vaporwave', emoji: '🌊',
        filter: {
            timescale: { speed: 0.85, pitch: 0.8, rate: 1.0 },
            equalizer: [
                { band: 0, gain: 0.3 }, { band: 1, gain: 0.3 },
            ],
        },
    },
    '8D': {
        label: '8D Audio', emoji: '🎧',
        filter: {
            rotation: { rotationHz: 0.2 },
        },
    },
    karaoke: {
        label: 'Karaoke', emoji: '🎤',
        filter: {
            karaoke: { level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 },
        },
    },
    tremolo: {
        label: 'Tremolo', emoji: '〰️',
        filter: {
            tremolo: { frequency: 4.0, depth: 0.6 },
        },
    },
    vibrato: {
        label: 'Vibrato', emoji: '🔔',
        filter: {
            vibrato: { frequency: 4.0, depth: 0.6 },
        },
    },
    lofi: {
        label: 'Lo-Fi', emoji: '📻',
        filter: {
            equalizer: [
                { band: 0, gain: 0.3 }, { band: 1, gain: 0.2 },
                { band: 5, gain: -0.2 }, { band: 8, gain: -0.3 },
                { band: 11, gain: -0.2 }, { band: 13, gain: -0.3 },
            ],
            timescale: { speed: 0.95, pitch: 0.95, rate: 1.0 },
        },
    },
    subboost: {
        label: 'Sub Boost', emoji: '💿',
        filter: {
            equalizer: [
                { band: 0, gain: 0.6 }, { band: 1, gain: 0.4 },
            ],
        },
    },
    dim: {
        label: 'Dim', emoji: '🔅',
        filter: {
            equalizer: [
                { band: 5, gain: -0.3 }, { band: 8, gain: -0.25 },
                { band: 11, gain: -0.3 }, { band: 13, gain: -0.25 },
            ],
        },
    },
    normalizer: {
        label: 'Normalizer', emoji: '📊',
        filter: {
            equalizer: Array.from({ length: 15 }, (_, i) => ({ band: i, gain: 0.0 })),
        },
    },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('filter')
        .setDescription('Toggle an audio filter')
        .addStringOption(option => {
            option.setName('name')
                .setDescription('Filter name to toggle')
                .setRequired(true);
            Object.entries(FILTER_PRESETS).forEach(([key, val]) => {
                option.addChoices({ name: `${val.emoji} ${val.label}`, value: key });
            });
            return option;
        }),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player || !player.playing) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        const filterName = interaction.options.getString('name', true);
        const filterMeta = FILTER_PRESETS[filterName];

        await interaction.deferReply();

        try {
            // Track active filters on the player object
            if (!player.activeFilters) player.activeFilters = new Set();

            const isEnabled = player.activeFilters.has(filterName);

            if (isEnabled) {
                // Disable this filter
                player.activeFilters.delete(filterName);

                // Rebuild filters from remaining active filters
                const combinedFilters = buildCombinedFilters(player.activeFilters);
                await player.node.updatePlayer({
                    guildId: player.guildId,
                    playerOptions: { filters: combinedFilters },
                });

                return interaction.editReply({
                    embeds: [successEmbed(`${filterMeta.emoji} **${filterMeta.label}** filter has been **disabled**.`)]
                });
            } else {
                // Enable this filter
                player.activeFilters.add(filterName);

                // Rebuild filters from all active filters
                const combinedFilters = buildCombinedFilters(player.activeFilters);
                await player.node.updatePlayer({
                    guildId: player.guildId,
                    playerOptions: { filters: combinedFilters },
                });

                return interaction.editReply({
                    embeds: [successEmbed(`${filterMeta.emoji} **${filterMeta.label}** filter has been **enabled**.`)]
                });
            }
        } catch (error) {
            console.error('[Reso] Filter error:', error);
            return interaction.editReply({ embeds: [errorEmbed('Failed to apply filter. Try again.')] });
        }
    },
};

/**
 * Combine all active filter presets into a single Lavalink filter object
 */
function buildCombinedFilters(activeFilters) {
    const combined = {};

    for (const filterName of activeFilters) {
        const preset = FILTER_PRESETS[filterName];
        if (!preset) continue;

        for (const [key, value] of Object.entries(preset.filter)) {
            if (key === 'equalizer') {
                // Merge equalizer bands (later filters override same bands)
                if (!combined.equalizer) combined.equalizer = [];
                for (const band of value) {
                    const existing = combined.equalizer.find(b => b.band === band.band);
                    if (existing) {
                        existing.gain = Math.min(1.0, existing.gain + band.gain);
                    } else {
                        combined.equalizer.push({ ...band });
                    }
                }
            } else {
                // For non-equalizer filters, last one wins
                combined[key] = value;
            }
        }
    }

    // If no active filters, reset everything
    if (activeFilters.size === 0) {
        return {
            equalizer: Array.from({ length: 15 }, (_, i) => ({ band: i, gain: 0.0 })),
            timescale: { speed: 1.0, pitch: 1.0, rate: 1.0 },
            rotation: { rotationHz: 0.0 },
            tremolo: { frequency: 0.0, depth: 0.0 },
            vibrato: { frequency: 0.0, depth: 0.0 },
            karaoke: { level: 0.0, monoLevel: 0.0, filterBand: 0.0, filterWidth: 0.0 },
        };
    }

    return combined;
}

// Export for use by filters.js
module.exports.FILTER_PRESETS = FILTER_PRESETS;
