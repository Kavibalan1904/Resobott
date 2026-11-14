const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createEmbed, Colors } = require('./embeds');
const {
    hasAnsweredGuide,
    setAnsweredGuide,
    resetAnsweredGuide,
    hasSeenGuide,
    setHasSeenGuide,
    resetHasSeenGuide,
} = require('./settings');

// In-memory set to prevent spamming multiple prompts while one is actively awaiting an answer
const activePrompts = new Set();

/**
 * Build the rich quick guide embed
 * @param {string} [guildId]
 * @param {object} [user]
 * @returns {import('discord.js').EmbedBuilder}
 */
function createQuickGuideEmbed(guildId = null, user = null) {
    const greeting = user?.id ? `Hey <@${user.id}>, welcome to Reso!` : `Here's a quick intro to get the best listening experience with Reso:`;
    return createEmbed('Primary', guildId)
        .setAuthor({
            name: '✨ Reso Quick Guide',
            iconURL: 'https://cdn.discordapp.com/emojis/741605543046807626.gif',
        })
        .setDescription(
            `${greeting}\n\n` +
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
 * Check and prompt the onboarding quick guide.
 * Sends prompt to anyone who plays music or in the server, and once answered (Yes or No),
 * never shows the prompt again.
 *
 * @param {object} channel Discord text channel
 * @param {object|string} userOrGuildId User object ({ id, username }) or guild ID
 * @param {string|object} [maybeGuildOrUser] Guild ID or user object
 */
async function checkAndPromptFirstTimeGuide(channel, userOrGuildId, maybeGuildOrUser = null) {
    if (!channel) return;

    let user = null;
    let guildId = null;

    if (userOrGuildId && typeof userOrGuildId === 'object' && userOrGuildId.id) {
        user = userOrGuildId;
        guildId = (typeof maybeGuildOrUser === 'string') ? maybeGuildOrUser : (channel.guildId || channel.guild?.id || null);
    } else if (typeof userOrGuildId === 'string') {
        guildId = userOrGuildId;
        if (maybeGuildOrUser && typeof maybeGuildOrUser === 'object' && maybeGuildOrUser.id) {
            user = maybeGuildOrUser;
        }
    }

    const userId = user?.id;

    // Ignore bots and internal autoplay
    if (user?.bot || userId === 'autoplay') return;

    // "once they answered never show the prompt to them"
    // If this user has already answered, or if this guild has already answered, do not show
    if (userId && hasAnsweredGuide(userId)) return;
    if (guildId && hasAnsweredGuide(guildId)) return;

    // Prevent spamming multiple prompts in the same channel while one is active and awaiting an answer
    const promptKey = `${guildId || 'dm'}_${channel.id}`;
    if (activePrompts.has(promptKey) || (userId && activePrompts.has(userId))) return;

    activePrompts.add(promptKey);
    if (userId) activePrompts.add(userId);

    try {
        const promptEmbed = createEmbed('Info', guildId)
            .setAuthor({
                name: '✨ Welcome to Reso!',
                iconURL: user?.displayAvatarURL ? user.displayAvatarURL({ dynamic: true }) : 'https://cdn.discordapp.com/emojis/741605543046807626.gif',
            })
            .setDescription(
                `Hey ${userId ? `<@${userId}>` : 'there'}! Welcome to Reso 🎵\n\n` +
                `Would you like a quick 1-minute guide covering **commands**, **smart autoplay**, and **saving playlists**?`
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`guide_yes_${userId || 'all'}`)
                .setLabel('Yes, show quick guide')
                .setEmoji('✨')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`guide_no_${userId || 'all'}`)
                .setLabel("No, I'm good")
                .setEmoji('❌')
                .setStyle(ButtonStyle.Secondary)
        );

        const promptMsg = await channel.send({
            embeds: [promptEmbed],
            components: [row],
        });

        const collector = promptMsg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000, // 60 seconds
        });

        collector.on('collect', async (interaction) => {
            if (interaction.customId.startsWith('guide_yes')) {
                const guideEmbed = createQuickGuideEmbed(guildId, user || interaction.user);
                await interaction.update({
                    embeds: [guideEmbed],
                    components: [],
                }).catch(() => {});

                // "once they answered never show the prompt to them"
                if (userId) setAnsweredGuide(userId, true);
                if (guildId) setAnsweredGuide(guildId, true);
                setAnsweredGuide(interaction.user.id, true);

                activePrompts.delete(promptKey);
                if (userId) activePrompts.delete(userId);
                collector.stop('answered');
            } else if (interaction.customId.startsWith('guide_no')) {
                const dismissEmbed = createEmbed('Success', guildId)
                    .setDescription(`✨ All set! Enjoy the music 🎶. You can always check \`/help\` or \`>help\` whenever you need.`);
                await interaction.update({
                    embeds: [dismissEmbed],
                    components: [],
                }).catch(() => {});

                // "once they answered never show the prompt to them"
                if (userId) setAnsweredGuide(userId, true);
                if (guildId) setAnsweredGuide(guildId, true);
                setAnsweredGuide(interaction.user.id, true);

                activePrompts.delete(promptKey);
                if (userId) activePrompts.delete(userId);
                collector.stop('answered');
            }
        });

        collector.on('end', async (collected, reason) => {
            activePrompts.delete(promptKey);
            if (userId) activePrompts.delete(userId);

            if (reason !== 'answered') {
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('guide_expired')
                        .setLabel('Quick guide expired')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                );
                await promptMsg.edit({ components: [disabledRow] }).catch(() => {});
            }
        });
    } catch (err) {
        activePrompts.delete(promptKey);
        if (userId) activePrompts.delete(userId);
        console.warn(`[Reso] Could not send onboarding prompt in ${channel.id}:`, err.message);
    }
}

/**
 * Prompt onboarding guide when Reso is newly invited to a server
 * @param {import('discord.js').Guild} guild
 */
async function promptGuildOnInvite(guild) {
    if (!guild || !guild.id) return;

    // Check if server already answered onboarding
    if (hasAnsweredGuide(guild.id)) return;

    const permissionsNeeded = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
    ];

    let targetChannel = null;

    // 1. Try system channel first if bot has permissions
    if (guild.systemChannel && guild.members?.me) {
        const perms = guild.systemChannel.permissionsFor(guild.members.me);
        if (perms && perms.has(permissionsNeeded)) {
            targetChannel = guild.systemChannel;
        }
    }

    // 2. Fall back to designated music or general text channel
    if (!targetChannel && guild.channels?.cache) {
        const preferredNames = ['general', 'chat', 'bot-commands', 'commands', 'music', 'lobby', 'main', 'welcome'];
        const textChannels = Array.from(guild.channels.cache.values()).filter(c =>
            c.isTextBased() &&
            !c.isThread?.() &&
            !c.isVoiceBased?.() &&
            guild.members?.me &&
            c.permissionsFor(guild.members.me)?.has(permissionsNeeded)
        );

        targetChannel = textChannels.find(c => preferredNames.includes(c.name?.toLowerCase())) || textChannels[0];
    }

    if (!targetChannel) return;

    const promptKey = `invite_${guild.id}`;
    if (activePrompts.has(promptKey)) return;
    activePrompts.add(promptKey);

    try {
        const promptEmbed = createEmbed('Info', guild.id)
            .setAuthor({
                name: '✨ Thanks for inviting Reso!',
                iconURL: 'https://cdn.discordapp.com/emojis/741605543046807626.gif',
            })
            .setDescription(
                `Hello **${guild.name}**! ☕ Thanks for inviting Reso — your high-quality music companion.\n\n` +
                `Would you like a quick 1-minute guide covering **commands**, **smart autoplay**, and **saving playlists**?`
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`guide_yes_guild_${guild.id}`)
                .setLabel('Yes, show quick guide')
                .setEmoji('✨')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`guide_no_guild_${guild.id}`)
                .setLabel("No, I'm good")
                .setEmoji('❌')
                .setStyle(ButtonStyle.Secondary)
        );

        const promptMsg = await targetChannel.send({
            embeds: [promptEmbed],
            components: [row],
        });

        const collector = promptMsg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 90000,
        });

        collector.on('collect', async (interaction) => {
            if (interaction.customId.startsWith('guide_yes')) {
                const guideEmbed = createQuickGuideEmbed(guild.id);
                await interaction.update({
                    embeds: [guideEmbed],
                    components: [],
                }).catch(() => {});

                setAnsweredGuide(guild.id, true);
                setAnsweredGuide(interaction.user.id, true);
                activePrompts.delete(promptKey);
                collector.stop('answered');
            } else if (interaction.customId.startsWith('guide_no')) {
                const dismissEmbed = createEmbed('Success', guild.id)
                    .setDescription(`✨ All set! Enjoy the music in **${guild.name}** 🎶. You can always check \`/help\` or \`>help\` whenever you need.`);
                await interaction.update({
                    embeds: [dismissEmbed],
                    components: [],
                }).catch(() => {});

                setAnsweredGuide(guild.id, true);
                setAnsweredGuide(interaction.user.id, true);
                activePrompts.delete(promptKey);
                collector.stop('answered');
            }
        });

        collector.on('end', async (collected, reason) => {
            activePrompts.delete(promptKey);
            if (reason !== 'answered') {
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('guide_expired')
                        .setLabel('Quick guide expired')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                );
                await promptMsg.edit({ components: [disabledRow] }).catch(() => {});
            }
        });
    } catch (err) {
        activePrompts.delete(promptKey);
        console.warn(`[Reso] Could not send server invite onboarding prompt in guild ${guild.id}:`, err.message);
    }
}

module.exports = {
    checkAndPromptFirstTimeGuide,
    createQuickGuideEmbed,
    promptGuildOnInvite,
};
