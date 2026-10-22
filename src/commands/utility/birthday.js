const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { createEmbed, Colors, EMOJIS } = require('../../utils/embeds');

const BIRTHDAY_WISHES = [
    {
        title: '🎉 ✨ A DAY THAT DESERVES TO SHINE ✨ 🎉',
        getDescription: (userId, name) => [
            `💜 **Happy Birthday, <@${userId}>!** (${name}) 🎂 🎉`,
            '',
            `Today isn't just another day — it's the day someone truly special came into this world! 🎈 ✨`,
            '',
            `May this new chapter of your life bring you the kind of happiness that stays, friendships that never fade, dreams that become reality, and memories that make you smile even years from now. 🥂`,
            '',
            `May every challenge make you stronger, every little victory remind you how far you've come, and every new day bring you closer to the life you've always dreamed of. 🌟`,
            '',
            `Never forget how much your presence means to the people around you. Keep shining in your own way, keep chasing what makes your heart happy, and never stop being the wonderful person you are! 🌌 🪩`,
            '',
            `Here's to your happiness, your growth, your dreams, and an unforgettable year ahead! 🍾 💖`,
            '',
            `🎂 **Everyone, let's make some noise for <@${userId}>!** 🎊 🍰`,
        ].join('\n'),
    },
    {
        title: '🎈 🍾 IT\'S TIME TO PARTY — HAPPY BIRTHDAY! 🍾 🎈',
        getDescription: (userId, name) => [
            `🎉 🪩 **Drop the beat for <@${userId}>!** (${name}) 🎂 🎈`,
            '',
            `Cue the confetti, turn the bass all the way up, and pop the champagne! Today is ALL about celebrating YOU! 🍾 🎶`,
            '',
            `May your year ahead be packed with spontaneous adventures, late-night laughs, massive wins, and moments so good they feel like pure magic. You deserve every ounce of joy and celebration today! 🥂 ✨`,
            '',
            `Leave all the stress behind, hit the center of the dance floor, and get ready for the most sensational year of your life! 💃 🕺`,
            '',
            `🎂 **Everyone, drop your birthday wishes and raise the roof for <@${userId}>!** 🎊 🍰`,
        ].join('\n'),
    },
    {
        title: '✨ 🌟 SHINE BRIGHT ON YOUR SPECIAL DAY 🌟 ✨',
        getDescription: (userId, name) => [
            `✨ 💜 **Happy Birthday to the one and only <@${userId}>!** (${name}) 🎂 🌸`,
            '',
            `Another trip around the sun, and you're glowing brighter than ever! 🚀 🎆`,
            '',
            `May your upcoming days be overflowing with big smiles, unstoppable confidence, wonderful surprises, and all the love you effortlessly bring into everyone's life. You bring so much light, fun, and kindness into this world! 💖 ✨`,
            '',
            `Here’s to breaking records, making unforgettable memories, and living life to the highest volume! 🎧 🥂`,
            '',
            `🎂 **Everyone, let's make some noise and shower <@${userId}> with love!** 🎊 🎈`,
        ].join('\n'),
    },
    {
        title: '🎵 🎂 CELEBRATION AT MAXIMUM VOLUME 🎂 🎵',
        getDescription: (userId, name) => [
            `🎶 🪅 **Happy Birthday, <@${userId}> — Let the Bass Drop!** (${name}) 🥳 🎂`,
            '',
            `Life is the ultimate playlist, and today we're setting your celebration on loop at 100% volume! 🔊 🎵`,
            '',
            `May this year be your greatest hit yet — full of golden beats, sweet harmonies, and thrilling moments. Every ambition you have is within your reach, so keep reaching and never look back! 💿 🌟`,
            '',
            `Grab the biggest slice of cake, turn up the music, and celebrate in true VIP style! 🍰 🍾`,
            '',
            `🎂 **Everyone, put your hands up and shout Happy Birthday for <@${userId}>!** 🎊 🥂`,
        ].join('\n'),
    },
    {
        title: '🍰 🎆 CONFETTI EXPLOSION — HAPPY BIRTHDAY! 🎆 🍰',
        getDescription: (userId, name) => [
            `🎈 🥳 **HAPPY BIRTHDAY <@${userId}>!** (${name}) 🎂 💖`,
            '',
            `Today is dedicated to YOU — your infectious laughter, your positive energy, and all the smiles you bring wherever you go! 🎊 ✨`,
            '',
            `May this new chapter surprise you with endless exciting opportunities, genuine happiness, unbreakable bonds, and memories that take your breath away. May good music, great friends, and unmatched vibes follow you everywhere! 🌌 🥂`,
            '',
            `Here's to another brilliant year of being completely, unapologetically amazing! 🌟 🍾`,
            '',
            `🎂 **Everyone, let's make some noise and celebrate <@${userId}>!** 🎊 🪩`,
        ].join('\n'),
    },
];

const PARTY_ANNOUNCEMENTS = [
    (userId) => `🎉 🎈 🍾 **IT'S PARTY TIME! Everyone raise your glasses and celebrate** <@${userId}>**'s special day!** 🎂 🥂 ✨`,
    (userId) => `🥳 🎊 🪩 **TURN UP THE VOLUME! It's <@${userId}>'s birthday — let's celebrate in style!** 🎂 🎈 🎶`,
    (userId) => `✨ 🎂 🎆 **HUGE CELEBRATION ALERT! Wishing the happiest of birthdays to** <@${userId}>**!** 🎉 🍾 💜`,
    (userId) => `🍰 🎈 🥂 **EVERYONE MAKE SOME NOISE! Today belongs to** <@${userId}>**!** 🎊 🪅 🥳`,
];

/**
 * Resolve target user from interaction options, mentions, or user ID
 * Supports slash command interaction and prefix mock interaction
 */
async function resolveTargetUser(interaction, client) {
    // 1. Direct SlashCommand / mock interaction getUser
    if (typeof interaction.options?.getUser === 'function') {
        const user = interaction.options.getUser('user') || interaction.options.getUser('target');
        if (user) return user;
    }

    // 2. Direct getMember fallback
    if (typeof interaction.options?.getMember === 'function') {
        const member = interaction.options.getMember('user') || interaction.options.getMember('target');
        if (member?.user) return member.user;
    }

    // 3. String option or raw arguments (e.g. mention <@123456789>, raw ID, or username)
    let rawInput = null;
    if (typeof interaction.options?.getString === 'function') {
        rawInput = interaction.options.getString('user') || interaction.options.getString('target');
    }

    if (!rawInput && interaction.rawMessage?.content) {
        const args = interaction.rawMessage.content.trim().split(/ +/);
        rawInput = args[1];
    }

    if (rawInput && typeof rawInput === 'string') {
        rawInput = rawInput.trim();

        // Extract ID from Discord mention format: <@123456789> or <@!123456789>
        const mentionMatch = rawInput.match(/^<@!?(\d{17,20})>$/);
        const userId = mentionMatch ? mentionMatch[1] : (rawInput.match(/^\d{17,20}$/) ? rawInput : null);

        if (userId) {
            // Check guild member cache first
            if (interaction.guild?.members?.cache) {
                const member = interaction.guild.members.cache.get(userId);
                if (member?.user) return member.user;
            }

            // Check client user cache
            if (client?.users?.cache?.has(userId)) {
                return client.users.cache.get(userId);
            }

            // Fetch from Discord API
            try {
                if (interaction.guild?.members?.fetch) {
                    const member = await interaction.guild.members.fetch(userId).catch(() => null);
                    if (member?.user) return member.user;
                }
                if (client?.users?.fetch) {
                    const user = await client.users.fetch(userId).catch(() => null);
                    if (user) return user;
                }
            } catch {
                // fall through
            }
        }
    }

    return null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('birthday')
        .setDescription('Celebrate Dharshu or a friend with a grand birthday announcement')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The birthday person to celebrate')
                .setRequired(true)
        ),
    aliases: ['bday', 'hbd'],
    category: 'utility',
    wishes: BIRTHDAY_WISHES,
    announcements: PARTY_ANNOUNCEMENTS,

    async execute(interaction, client) {
        // Must be in a server channel
        if (!interaction.guild || !interaction.channel) {
            return interaction.reply({
                embeds: [createEmbed('Error').setDescription(`${EMOJIS.error} This command can only be used in a server text channel.`)],
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }

        // Verify bot permissions in the target channel
        const botMember = interaction.guild?.members?.me
            || (typeof interaction.guild?.members?.fetchMe === 'function' ? await interaction.guild.members.fetchMe().catch(() => null) : null);
        if (botMember && interaction.channel?.permissionsFor) {
            const botPerms = interaction.channel.permissionsFor(botMember);
            if (botPerms) {
                if (!botPerms.has(PermissionFlagsBits.SendMessages)) {
                    // Cannot send messages in this channel
                    return;
                }
                if (!botPerms.has(PermissionFlagsBits.EmbedLinks)) {
                    return interaction.reply({
                        content: `${EMOJIS.error} I need the **Embed Links** permission in this channel to send the birthday embed.`,
                        flags: MessageFlags.Ephemeral,
                    }).catch(() => {});
                }
            }
        }

        // Resolve target user
        const targetUser = await resolveTargetUser(interaction, client);

        if (!targetUser) {
            const prefix = process.env.PREFIX || '>';
            const errorEmbed = createEmbed('Error')
                .setAuthor({ name: '🎂 Birthday Celebration' })
                .setTitle('Missing or Invalid Birthday Target')
                .setDescription(
                    `${EMOJIS.warning} Please specify a valid server member to celebrate!\n\n` +
                    `**Usage:**\n` +
                    `• \`${prefix}birthday @Dharshu\`\n` +
                    `• \`/birthday user:@Dharshu\`\n\n` +
                    `*You can mention the user or supply their Discord User ID.*`
                );

            return interaction.reply({
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }

        // Prevent targeting bots
        if (targetUser.bot) {
            return interaction.reply({
                embeds: [
                    createEmbed('Warning')
                        .setDescription(`${EMOJIS.warning} **${targetUser.username}** is a bot! Birthday celebrations are reserved for human friends. 💜`)
                ],
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }

        // Fetch member for personalized server nickname if available
        let targetMember = null;
        try {
            if (interaction.guild?.members) {
                targetMember = interaction.guild.members.cache.get(targetUser.id)
                    || await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            }
        } catch {
            // fall back to user object
        }

        const recipientName = targetMember?.displayName || targetUser.displayName || targetUser.globalName || targetUser.username;

        // Pick a randomized wish template and announcement
        const randomWish = BIRTHDAY_WISHES[Math.floor(Math.random() * BIRTHDAY_WISHES.length)];
        const randomAnnouncement = PARTY_ANNOUNCEMENTS[Math.floor(Math.random() * PARTY_ANNOUNCEMENTS.length)];

        // Visual design: Dark, elegant violet/purple aesthetic with party vibes
        const birthdayEmbed = createEmbed('Primary')
            .setColor(Colors.Primary || 0x7C3AED)
            .setAuthor({
                name: '🎂 SPECIAL BIRTHDAY CELEBRATION',
                iconURL: client.user?.displayAvatarURL?.() || null,
            })
            .setTitle(randomWish.title)
            .setDescription(randomWish.getDescription(targetUser.id, recipientName))
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 512 }))
            .addFields(
                {
                    name: '🪩 Party Energy',
                    value: '`🔊 Volume: 100%` • `🍰 Cake: Ready` • `🎈 Vibes: Immaculate`',
                    inline: true,
                },
                {
                    name: '🥂 Celebration Mode',
                    value: `\`Active\` • Celebrating <@${targetUser.id}>`,
                    inline: true,
                }
            )
            .setFooter({ text: 'Reso ♪ • Resonance in every beat' })
            .setTimestamp();

        // Notification message: dynamically mention the target user with high-energy party vibes
        // Strictly restrict allowed mentions to only targetUser to prevent accidental mass pings
        const payload = {
            content: randomAnnouncement(targetUser.id),
            embeds: [birthdayEmbed],
            allowedMentions: {
                users: [targetUser.id],
                roles: [],
                parse: [],
                repliedUser: false,
            },
        };

        try {
            await interaction.reply(payload);
        } catch (error) {
            console.error('[Reso Birthday Error]:', error);
            const failNotice = {
                content: `${EMOJIS.error} Failed to send the birthday celebration. Please ensure I have permission to send messages and embeds in this channel.`,
                flags: MessageFlags.Ephemeral,
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(failNotice).catch(() => {});
            } else {
                await interaction.reply(failNotice).catch(() => {});
            }
        }
    },
};
