const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { errorEmbed, successEmbed, createEmbed, EMOJIS } = require('../../utils/embeds');
const { getVoiceChannel, truncate } = require('../../utils/helpers');
const {
    generateVisualizer,
    isVisualizerEnabled,
    toggleVisualizer,
    getVisualizerStyle,
    setVisualizerStyle,
    STYLES,
    STYLE_KEYS,
    PALETTES,
    PALETTE_KEYS,
} = require('../../utils/visualizer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('visualizer')
        .setDescription('🎨 Audio visualizer — Generate a stunning spectrum image for the current track')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Action to perform (default: show)')
                .setRequired(false)
                .addChoices(
                    { name: '🎨 Show Visualizer', value: 'show' },
                    { name: '🔄 Toggle Auto-Visualizer', value: 'toggle' },
                    { name: '🎭 Change Style', value: 'style' },
                )
        )
        .addStringOption(option =>
            option.setName('style')
                .setDescription('Visualizer style')
                .setRequired(false)
                .addChoices(
                    { name: '📊 Spectrum Bars (default)', value: 'bars' },
                    { name: '🌊 Waveform', value: 'wave' },
                    { name: '💫 Radial Pulse', value: 'pulse' },
                )
        )
        .addStringOption(option =>
            option.setName('palette')
                .setDescription('Color palette (default: auto per track)')
                .setRequired(false)
                .addChoices(
                    { name: '🟣 Violet Storm', value: 'violet' },
                    { name: '💗 Electric Pink', value: 'pink' },
                    { name: '🩵 Cyber Cyan', value: 'cyan' },
                    { name: '💚 Emerald Pulse', value: 'emerald' },
                    { name: '🌅 Sunset Blaze', value: 'sunset' },
                )
        ),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const action = interaction.options.getString('action') || 'show';
        const stylePick = interaction.options.getString('style');
        const palettePick = interaction.options.getString('palette');

        // ── Toggle auto-visualizer ──────────────────────────────
        if (action === 'toggle') {
            const nowEnabled = toggleVisualizer(guildId, stylePick || getVisualizerStyle(guildId));
            const currentStyle = STYLES[getVisualizerStyle(guildId)];
            const embed = createEmbed(nowEnabled ? 'Success' : 'Info')
                .setDescription(
                    nowEnabled
                        ? `${EMOJIS.success} **Auto-Visualizer Enabled**\nVisualizer images will be attached to Now Playing embeds.\n> **Style:** ${currentStyle.emoji} ${currentStyle.label}`
                        : `${EMOJIS.info} **Auto-Visualizer Disabled**\nUse \`/visualizer\` to generate one-shot images anytime.`
                );
            return interaction.reply({ embeds: [embed] });
        }

        // ── Change style ────────────────────────────────────────
        if (action === 'style') {
            if (!stylePick) {
                const currentStyle = getVisualizerStyle(guildId);
                const styleList = STYLE_KEYS.map(key => {
                    const s = STYLES[key];
                    const active = key === currentStyle ? ' ← **active**' : '';
                    return `> ${s.emoji} **${s.label}** (\`${key}\`)${active}`;
                }).join('\n');

                const embed = createEmbed('Info')
                    .setAuthor({ name: '🎨 Visualizer Styles' })
                    .setDescription(
                        `Current style: **${STYLES[currentStyle].emoji} ${STYLES[currentStyle].label}**\n\n` +
                        `${styleList}\n\n` +
                        `Use \`/visualizer style style:<name>\` to change.`
                    );
                return interaction.reply({ embeds: [embed] });
            }

            setVisualizerStyle(guildId, stylePick);
            const newStyle = STYLES[stylePick];
            return interaction.reply({
                embeds: [successEmbed(`Visualizer style set to ${newStyle.emoji} **${newStyle.label}**`)],
            });
        }

        // ── Show visualizer (one-shot) ──────────────────────────
        const player = interaction.client.lavalink?.getPlayer(guildId);
        if (!player || (!player.playing && !player.paused) || !player.queue.current) {
            return interaction.reply({
                embeds: [errorEmbed('Nothing is playing right now. Play a track first!')],
                ephemeral: true,
            });
        }

        await interaction.deferReply();

        const track = player.queue.current;
        const info = track.info || track;
        const title = info.title || 'Unknown Track';
        const style = stylePick || getVisualizerStyle(guildId);

        try {
            const imageBuffer = await generateVisualizer(title, {
                style,
                width: 600,
                height: 150,
                palette: palettePick || undefined,
            });

            const attachment = new AttachmentBuilder(imageBuffer, { name: 'reso-visualizer.gif' });
            const currentStyle = STYLES[style];
            const paletteName = palettePick ? PALETTES[palettePick].name : 'Auto';

            const embed = createEmbed('Music')
                .setAuthor({ name: '🎨 Audio Visualizer' })
                .setDescription(
                    `### ${EMOJIS.music} [${truncate(title, 50)}](${info.uri || ''})\n` +
                    `> **${info.author || 'Unknown Artist'}**\n\n` +
                    `${currentStyle.emoji} **Style:** ${currentStyle.label} • 🎨 **Palette:** ${paletteName}`
                )
                .setImage('attachment://reso-visualizer.gif');

            await interaction.editReply({
                embeds: [embed],
                files: [attachment],
            });
        } catch (err) {
            console.error('[Reso] Visualizer generation failed:', err);
            await interaction.editReply({
                embeds: [errorEmbed(`Failed to generate visualizer: ${err.message}`)],
            }).catch(() => { });
        }
    },
};
