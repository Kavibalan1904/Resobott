const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createEmbed, Colors } = require('./embeds');
const { hasSeenGuide, setHasSeenGuide, resetHasSeenGuide, hasUserSeenGuide, setUserSeenGuide, resetUserSeenGuide } = require('./settings');

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
 * Check if a user or server needs the first-time onboarding guide and prompt if so
 * @param {object} channel Discord text channel
 * @param {object|string} userOrGuildId User object ({ id, username }) or guild ID
 * @param {string|object} [maybeGuildOrUser] Guild ID or user object
 */
async function checkAndPromptFirstTimeGuide(channel, userOrGuildId, maybeGuildOrUser = null) {
    if (!channel) return;

    // Resolve arguments
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

    // If user object is provided: check per-user onboarding
    if (userId) {
        if (user.bot || userId === 'autoplay') return;
        if (hasUserSeenGuide(userId)) return;

        // Mark user as seen immediately to avoid duplicate prompts from rapid concurrent actions
        setUserSeenGuide(userId, true);

        try {
            const promptEmbed = createEmbed('Info', guildId)
                .setAuthor({
                    name: '✨ Welcome to Reso!',
                    iconURL: user.displayAvatarURL ? user.displayAvatarURL({ dynamic: true }) : 'https://cdn.discordapp.com/emojis/741605543046807626.gif',
                })
                .setDescription(
                    `Hey <@${userId}>! Looks like this is your first time using Reso 🎵\n\n` +
                    `Would you like a quick 1-minute guide covering **commands**, **smart autoplay**, and **saving playlists**?`
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`guide_yes_${userId}`)
                    .setLabel('Yes, show quick guide')
                    .setEmoji('✨')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`guide_no_${userId}`)
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
                time: 60000, // 1 minute
            });

            collector.on('collect', async (interaction) => {
                // Ensure only the targeted user can click the buttons
                if (interaction.user.id !== userId) {
                    return interaction.reply({
                        content: `👋 This prompt is for <@${userId}>! You can view the guide anytime with \`/help\` or \`>help\`.`,
                        flags: MessageFlags.Ephemeral,
                    }).catch(() => {});
                }

                if (interaction.customId === `guide_yes_${userId}`) {
                    const guideEmbed = createQuickGuideEmbed(guildId, user);
                    await interaction.update({
                        embeds: [guideEmbed],
                        components: [],
                    }).catch(() => {});
                    collector.stop('handled');
                } else if (interaction.customId === `guide_no_${userId}`) {
                    const dismissEmbed = createEmbed('Success', guildId)
                        .setDescription(`✨ All set, <@${userId}>! Enjoy the music 🎶. You can always check \`/help\` or \`>help\` whenever you need.`);
                    await interaction.update({
                        embeds: [dismissEmbed],
                        components: [],
                    }).catch(() => {});
                    collector.stop('handled');
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason !== 'handled') {
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
            // Reset flag on send failure so user is not locked out
            resetUserSeenGuide(userId);
            console.warn(`[Reso] Could not send first-time onboarding prompt for user ${userId}:`, err.message);
        }
        return;
    }

    // Fallback: Guild-level onboarding if no user provided
    if (guildId && !hasSeenGuide(guildId)) {
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
                    .setEmoji('❌')
                    .setStyle(ButtonStyle.Secondary)
            );

            const promptMsg = await channel.send({
                embeds: [promptEmbed],
                components: [row],
            });

            const collector = promptMsg.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 60000,
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
            resetHasSeenGuide(guildId);
            console.warn(`[Reso] Could not send first-time onboarding prompt in guild ${guildId}:`, err.message);
        }
    }
}

/**
 * Prompt onboarding guide when Reso is newly invited to a server
 * @param {import('discord.js').Guild} guild
 */
async function promptGuildOnInvite(guild) {
    if (!guild || !guild.id) return;

    // Check if server already saw onboarding
    if (hasSeenGuide(guild.id)) return;

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

    // Mark as seen immediately
    setHasSeenGuide(guild.id, true);

    try {
        const promptEmbed = createEmbed('Info', guild.id)
            .setAuthor({
                name: '✨ Thanks for inviting Reso!',
                iconURL: 'https://cdn.discordapp.com/emojis/741605543046807626.gif',
            })
            .setDescription(
                `Hello **${guild.name}**! ☕ Thanks for inviting Reso — your high-quality Discord music companion.\n\n` +
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
            time: 90000, // 90 seconds
        });

        collector.on('collect', async (interaction) => {
            if (interaction.customId === `guide_yes_guild_${guild.id}`) {
                const guideEmbed = createQuickGuideEmbed(guild.id);
                await interaction.update({
                    embeds: [guideEmbed],
                    components: [],
                }).catch(() => {});
                collector.stop('handled');
            } else if (interaction.customId === `guide_no_guild_${guild.id}`) {
                const dismissEmbed = createEmbed('Success', guild.id)
                    .setDescription(`✨ All set! Enjoy the music in **${guild.name}** 🎶. You can always check \`/help\` or \`>help\` whenever you need.`);
                await interaction.update({
                    embeds: [dismissEmbed],
                    components: [],
                }).catch(() => {});
                collector.stop('handled');
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason !== 'handled') {
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
        resetHasSeenGuide(guild.id);
        console.warn(`[Reso] Could not send server invite onboarding prompt in guild ${guild.id}:`, err.message);
    }
}

module.exports = {
    checkAndPromptFirstTimeGuide,
    createQuickGuideEmbed,
    promptGuildOnInvite,
};
