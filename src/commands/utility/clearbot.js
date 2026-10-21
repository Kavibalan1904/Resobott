const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { createEmbed, errorEmbed, infoEmbed, successEmbed } = require('../../utils/embeds');

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clearbot')
        .setDescription('Clear all messages sent by Reso in this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Maximum number of bot messages to delete (default: 100, max: 200)')
                .setMinValue(1)
                .setMaxValue(200)
                .setRequired(false)
        ),
    aliases: ['cleanup', 'purgebot', 'cleanbot', 'clearb'],
    category: 'utility',

    async execute(interaction, client) {
        // Must be in a server channel
        if (!interaction.guild || !interaction.channel) {
            return interaction.reply({
                embeds: [errorEmbed('This command can only be used in a server text channel.')],
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }

        // Permission check for user: ManageMessages or Administrator
        const member = interaction.member;
        const hasPermission = member?.permissions?.has(PermissionFlagsBits.ManageMessages)
            || member?.permissions?.has(PermissionFlagsBits.Administrator);

        if (!hasPermission) {
            return interaction.reply({
                embeds: [errorEmbed('You need the **Manage Messages** permission to clear bot messages.')],
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }

        const channel = interaction.channel;
        if (!channel.messages || typeof channel.messages.fetch !== 'function') {
            return interaction.reply({
                embeds: [errorEmbed('Cannot manage messages in this channel type.')],
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }

        // Check bot permissions in channel
        const botMember = channel.guild?.members?.me || await channel.guild?.members?.fetchMe().catch(() => null);
        const botPerms = botMember ? channel.permissionsFor(botMember) : null;
        if (botPerms && !botPerms.has(PermissionFlagsBits.ReadMessageHistory)) {
            return interaction.reply({
                embeds: [errorEmbed('I need the **Read Message History** permission in this channel.')],
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }

        const canBulkDelete = botPerms ? botPerms.has(PermissionFlagsBits.ManageMessages) : false;

        // Defer reply so interaction doesn't time out during scanning/deleting
        const isSlash = Boolean(interaction.token);
        if (isSlash) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
        } else if (interaction.deferReply) {
            await interaction.deferReply().catch(() => {});
        }

        const targetAmount = interaction.options?.getInteger?.('amount') || 100;
        const MAX_SCAN = 500; // Scan up to 500 recent channel messages
        let fetchedCount = 0;
        let lastMessageId = null;
        const botMessages = [];
        const botId = client?.user?.id || interaction.client?.user?.id;

        try {
            while (botMessages.length < targetAmount && fetchedCount < MAX_SCAN) {
                const fetchLimit = Math.min(100, MAX_SCAN - fetchedCount);
                const fetchOptions = { limit: fetchLimit };
                if (lastMessageId) fetchOptions.before = lastMessageId;

                const messages = await channel.messages.fetch(fetchOptions).catch(err => {
                    console.warn('[Reso] clearbot: messages.fetch error:', err.message);
                    return null;
                });

                if (!messages || messages.size === 0) break;

                const msgArray = Array.from(messages.values());
                fetchedCount += msgArray.length;
                lastMessageId = msgArray[msgArray.length - 1]?.id;

                for (const msg of messages.values()) {
                    // Match messages authored by the bot
                    if (msg.author && msg.author.id === botId) {
                        // Avoid deleting the triggering interaction reply if possible
                        if (msg.id === interaction.id) continue;
                        botMessages.push(msg);
                        if (botMessages.length >= targetAmount) break;
                    }
                }

                // If fewer messages returned than requested, we reached the start of the channel
                if (messages.size < fetchLimit) break;
            }

            if (botMessages.length === 0) {
                const embed = infoEmbed(`No bot messages found in the last **${fetchedCount}** messages.`);
                if (isSlash) {
                    return await interaction.editReply({ embeds: [embed] }).catch(() => {});
                } else {
                    const sent = await interaction.editReply({ embeds: [embed] }).catch(() => {});
                    setTimeout(() => sent?.delete?.().catch(() => {}), 5000);
                    return;
                }
            }

            // Separate into messages < 14 days old (bulk-deletable) and >= 14 days old
            const now = Date.now();
            const bulkDeletable = [];
            const olderMessages = [];

            for (const msg of botMessages) {
                if (now - msg.createdTimestamp < FOURTEEN_DAYS_MS - 60000) {
                    bulkDeletable.push(msg);
                } else {
                    olderMessages.push(msg);
                }
            }

            let totalDeleted = 0;

            // Delete bulk-deletable messages
            if (canBulkDelete && bulkDeletable.length > 0) {
                for (let i = 0; i < bulkDeletable.length; i += 100) {
                    const chunk = bulkDeletable.slice(i, i + 100);
                    if (chunk.length === 1) {
                        await chunk[0].delete().catch(() => {});
                        totalDeleted += 1;
                    } else {
                        const deleted = await channel.bulkDelete(chunk, true).catch(err => {
                            console.warn('[Reso] clearbot: bulkDelete failed, falling back:', err.message);
                            return null;
                        });

                        if (deleted) {
                            totalDeleted += deleted.size;
                        } else {
                            // Fallback to individual deletion if bulkDelete fails
                            for (const msg of chunk) {
                                await msg.delete().catch(() => {});
                                totalDeleted += 1;
                            }
                        }
                    }
                }
            } else {
                // Delete individually if no ManageMessages or fallback
                for (const msg of bulkDeletable) {
                    await msg.delete().catch(() => {});
                    totalDeleted += 1;
                }
            }

            // Handle older messages (>= 14 days) individually (capped at 25 to prevent rate limits)
            if (olderMessages.length > 0) {
                const cappedOld = olderMessages.slice(0, 25);
                for (const msg of cappedOld) {
                    await msg.delete().catch(() => {});
                    totalDeleted += 1;
                    await new Promise(r => setTimeout(r, 150));
                }
            }

            // Clean up last now playing reference if deleted
            const guildId = interaction.guildId || interaction.guild?.id;
            const lastNp = client?.lastNowPlayingMessage?.get(guildId);
            if (lastNp && botMessages.some(m => m.id === lastNp.id)) {
                client.lastNowPlayingMessage.delete(guildId);
            }

            const embed = successEmbed(`Cleared **${totalDeleted}** bot message${totalDeleted !== 1 ? 's' : ''} from this channel! 🧹`);

            if (isSlash) {
                await interaction.editReply({ embeds: [embed] }).catch(() => {});
            } else {
                const sent = await interaction.editReply({ embeds: [embed] }).catch(() => {});
                // Auto delete confirmation and trigger message after 5 seconds to keep channel completely clean
                setTimeout(() => {
                    sent?.delete?.().catch(() => {});
                    channel.messages?.delete?.(interaction.id).catch(() => {});
                }, 5000);
            }
        } catch (err) {
            console.error('[Reso] Error executing clearbot:', err);
            const errEmbed = errorEmbed('An error occurred while clearing bot messages.');
            if (isSlash) {
                await interaction.editReply({ embeds: [errEmbed] }).catch(() => {});
            } else {
                await interaction.editReply({ embeds: [errEmbed] }).catch(() => {});
            }
        }
    },
};
