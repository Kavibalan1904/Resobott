const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { createEmbed, EMOJIS } = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all commands or detailed help for a specific command')
        .addStringOption(option =>
            option.setName('command')
                .setDescription('Get help for a specific command')
                .setRequired(false)
        ),

    async execute(interaction, client) {
        const commandName = interaction.options.getString('command');

        // ── Specific command help ───────────────────────────────
        if (commandName) {
            const command = client.commands.get(commandName.toLowerCase());
            if (!command) {
                const embed = createEmbed('Error')
                    .setDescription(`${EMOJIS.error} Command \`${commandName}\` not found.`);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            const embed = createEmbed('Info')
                .setAuthor({ name: 'Command Help' })
                .setTitle(`/${command.data.name}`)
                .setDescription(command.data.description)
                .addFields(
                    { name: 'Category', value: `\`${command.category || 'Unknown'}\``, inline: true },
                );

            // Show options if any
            const options = command.data.options;
            if (options && options.length > 0) {
                const optionList = options.map(opt => {
                    const required = opt.required ? '`Required`' : '`Optional`';
                    return `• **${opt.name}** — ${opt.description} ${required}`;
                }).join('\n');
                embed.addFields({ name: 'Options', value: optionList });
            }

            return interaction.reply({ embeds: [embed] });
        }

        // ── Full command list ───────────────────────────────────
        const categories = {};
        client.commands.forEach(cmd => {
            const cat = cmd.category || 'Other';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(cmd);
        });

        const categoryEmojis = {
            music: '🎵',
            utility: '⚙️',
        };

        const categoryDescriptions = {
            music: 'Playback, queue, filters, and DJ controls',
            utility: 'Information and bot management',
        };

        const embed = createEmbed('Info')
            .setAuthor({ name: 'Reso — Command List', iconURL: client.user.displayAvatarURL() })
            .setDescription(
                `Hey there! I'm **Reso**, your high-quality music companion.\n` +
                `Use \`/help <command>\` for detailed info on a specific command.\n\n` +
                `**Supported Sources:** YouTube, Spotify, SoundCloud, Apple Music & more`
            )
            .setThumbnail(client.user.displayAvatarURL({ size: 256 }));

        for (const [category, commands] of Object.entries(categories)) {
            const emoji = categoryEmojis[category] || '📁';
            const desc = categoryDescriptions[category] || '';
            const commandList = commands.map(cmd => `\`/${cmd.data.name}\``).join(', ');
            embed.addFields({
                name: `${emoji} ${category.charAt(0).toUpperCase() + category.slice(1)} ${desc ? `— ${desc}` : ''}`,
                value: commandList,
            });
        }

        embed.addFields({
            name: '📖 Quick Links',
            value: `[Invite Reso](https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=3147776&scope=bot%20applications.commands) • [Support Server](https://discord.gg/reso)`,
        });

        return interaction.reply({ embeds: [embed] });
    },
};
