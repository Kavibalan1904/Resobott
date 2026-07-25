const { SlashCommandBuilder } = require('discord.js');
const { createEmbed, EMOJIS } = require('../../utils/embeds');
const { FILTER_PRESETS } = require('./filter');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('filters')
        .setDescription('Show all available audio filters and their status'),

    async execute(interaction) {
        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        const activeFilters = player?.activeFilters || new Set();

        const filterList = Object.entries(FILTER_PRESETS)
            .map(([key, val]) => {
                const isActive = activeFilters.has(key);
                const status = isActive ? '`✅ ON `' : '`⬛ OFF`';
                return `${status} ${val.emoji} **${val.label}**`;
            })
            .join('\n');

        const activeCount = activeFilters.size;

        const embed = createEmbed('Music')
            .setAuthor({ name: 'Audio Filters' })
            .setDescription(
                `${EMOJIS.filter} **Available Filters**\n` +
                `Use \`/filter <name>\` to toggle a filter.\n\n` +
                filterList
            )
            .setFooter({ text: `Reso • ${activeCount} filter${activeCount !== 1 ? 's' : ''} active` });

        return interaction.reply({ embeds: [embed] });
    },
};
