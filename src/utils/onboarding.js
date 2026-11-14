const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { createEmbed, Colors } = require('./embeds');
const { hasSeenGuide, setHasSeenGuide } = require('./settings');

/**
 * Build the rich quick guide embed
 * @param {string} [guildId]
 * @returns {import('discord.js').EmbedBuilder}
 */
function createQuickGuideEmbed(guildId = null) {
    return createEmbed('Primary', guildId)
        .setAuthor({
            name: '✨ Reso Quick Guide',
            iconURL: 'https://cdn.discordapp.com/emojis/741605543046807626.gif',
        })
        .setDescription(
            `Here's a quick intro to get the best listening experience with Reso:\n\n` +
            `**⚡ Slash Commands & \`>\` Prefix**\n` +
            `• Control music using **Slash Commands** (\`/play\`, \`/queue\`, \`/skip\`, \`/pause\`)\n` +
            `• Or use the **\`>\`** text prefix (\`>play <song>\`, \`>q\`, \`>skip\`, \`>help\`)\n` +
            `• Type \`/help\` or \`>help\` anytime to see all commands and features.\n\n` +
            `**🔄 Smart Autoplay (Continuous Music)**\n` +
            `• Never let the music stop! When your queue ends, Reso's Resonance AI DJ can automatically keep playing similar songs matching your session's vibe and language.\n` +
            `• Toggle on or off anytime with \`/autoplay\` (or \`>autoplay\`).\n\n` +
            `**💾 Save & Load Playlists**\n` +
            `• **Save your current queue**: \`/playlist save name: <name>\` *(e.g. \`/playlist save name: Favorites\`, or \`>playlist save Favorites\`)*\n` +
            `• **Play a saved playlist**: \`/playlist load name: <name>\` *(e.g. \`/playlist load name: Favorites\`, or \`>playlist load Favorites\`)*\n` +
            `• **View all playlists**: \`/playlist list\` (or \`>playlist list\`)`
        )
        .setFooter({ text: 'Reso  ☕  Good music & warm vibes • Have fun listening!' });
}

/**
 * Check if server needs first-time onboarding guide and prompt if so
 * @param {object} channel Discord text channel
 * @param {string} guildId
 * @param {object} [requester] User who initiated playback
 */
async function checkAndPromptFirstTimeGuide(channel, guildId, requester = null) {
    if (!channel || !guildId) return;
    if (hasSeenGuide(guildId)) return;

    // Mark as seen immediately to prevent duplicate prompts from simultaneous track adds
    setHasSeenGuide(guildId, true);

    try {
        const promptEmbed = createEmbed('Info', guildId)
            .setAuthor({
                name: '✨ Welcome to Reso!',
                iconURL: 'https://cdn.discordapp.com/emojis/741605543046807626.gif',
            })
            .setDescription(
                `Someone just queued the first song in this server! 🎵\n\n` +
                `Would you like a quick 1-minute guide covering **commands**, **autoplay**, and **saving playlists**?`
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('guide_yes')
                .setLabel('Yes, show quick guide')
                .setEmoji('✨')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('guide_no')
                .setLabel("No, I'm good")
                .setEmoji('✕')
                .setStyle(ButtonStyle.Secondary)
        );

        const promptMsg = await channel.send({
            embeds: [promptEmbed],
            components: [row],
        });

        const collector = promptMsg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000, // 1 minute
            max: 1,
        });

        collector.on('collect', async (interaction) => {
            if (interaction.customId === 'guide_yes') {
                const guideEmbed = createQuickGuideEmbed(guildId);
                await interaction.update({
                    embeds: [guideEmbed],
                    components: [],
                }).catch(() => {});
            } else if (interaction.customId === 'guide_no') {
                const dismissEmbed = createEmbed('Success', guildId)
                    .setDescription(`✨ All set! Enjoy the music 🎶. You can always check \`/help\` or \`>help\` whenever you need.`);
                await interaction.update({
                    embeds: [dismissEmbed],
                    components: [],
                }).catch(() => {});
            }
        });

        collector.on('end', async (collected) => {
            if (collected.size === 0) {
                // Disabled buttons on timeout
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('guide_yes_disabled')
                        .setLabel('Quick guide expired')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                );
                await promptMsg.edit({ components: [disabledRow] }).catch(() => {});
            }
        });
    } catch (err) {
        console.warn(`[Reso] Could not send first-time onboarding prompt in guild ${guildId}:`, err.message);
    }
}

module.exports = {
    checkAndPromptFirstTimeGuide,
    createQuickGuideEmbed,
};
