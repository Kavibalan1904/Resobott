const { describe, it } = require('node:test');
const assert = require('node:assert');
const { PermissionFlagsBits } = require('discord.js');

const birthdayCommand = require('../src/commands/utility/birthday');
const { Colors } = require('../src/utils/embeds');

describe('Birthday Command & Celebration Verification', () => {
    it('should export valid command structure, data, options, aliases, and randomized wish pools', () => {
        assert.ok(birthdayCommand.data, 'Missing command data');
        assert.strictEqual(birthdayCommand.data.name, 'birthday');
        assert.ok(birthdayCommand.data.description, 'Missing command description');
        assert.strictEqual(birthdayCommand.category, 'utility');
        assert.ok(Array.isArray(birthdayCommand.aliases), 'Aliases should be an array');
        assert.ok(birthdayCommand.aliases.includes('bday'), 'Should include bday alias');
        assert.ok(birthdayCommand.aliases.includes('hbd'), 'Should include hbd alias');
        assert.strictEqual(typeof birthdayCommand.execute, 'function', 'Execute must be a function');

        // Check options
        const userOption = birthdayCommand.data.options.find(opt => opt.name === 'user');
        assert.ok(userOption, 'User option must be defined');
        assert.strictEqual(userOption.required, true, 'User option must be required');

        // Verify randomized pools
        assert.ok(Array.isArray(birthdayCommand.wishes), 'Wishes pool must be an array');
        assert.ok(birthdayCommand.wishes.length >= 4, 'Should have at least 4 distinct wishes for variety');
        assert.ok(Array.isArray(birthdayCommand.announcements), 'Announcements pool must be an array');
        assert.ok(birthdayCommand.announcements.length >= 3, 'Should have at least 3 distinct announcements');
    });

    it('should reject execution if not in a guild or channel', async () => {
        let replyData = null;
        const mockInteraction = {
            guild: null,
            channel: null,
            reply: async (data) => {
                replyData = data;
                return data;
            },
        };

        await birthdayCommand.execute(mockInteraction, {});
        assert.ok(replyData, 'Should have replied');
        assert.ok(replyData.embeds[0].data.description.includes('server text channel'));
    });

    it('should check bot EmbedLinks permission in the channel', async () => {
        let replyData = null;
        const mockInteraction = {
            guild: {
                id: 'guild-1',
                members: {
                    me: { id: 'bot-1' },
                },
            },
            channel: {
                id: 'chan-1',
                permissionsFor: () => ({
                    has: (perm) => {
                        if (perm === PermissionFlagsBits.SendMessages) return true;
                        if (perm === PermissionFlagsBits.EmbedLinks) return false;
                        return true;
                    },
                }),
            },
            reply: async (data) => {
                replyData = data;
                return data;
            },
        };

        await birthdayCommand.execute(mockInteraction, {});
        assert.ok(replyData, 'Should reply with permission error');
        assert.ok(replyData.content.includes('Embed Links'));
    });

    it('should return error with usage help when target is missing', async () => {
        let replyData = null;
        const mockInteraction = {
            guild: { id: 'guild-1' },
            channel: {
                id: 'chan-1',
                permissionsFor: () => ({ has: () => true }),
            },
            options: {
                getUser: () => null,
                getString: () => null,
            },
            reply: async (data) => {
                replyData = data;
                return data;
            },
        };

        await birthdayCommand.execute(mockInteraction, {});
        assert.ok(replyData, 'Should have replied');
        assert.ok(replyData.embeds[0].data.title.includes('Missing or Invalid Birthday Target'));
        assert.ok(replyData.embeds[0].data.description.includes('birthday @Dharshu'));
    });

    it('should reject if target user is a bot', async () => {
        let replyData = null;
        const mockBotUser = {
            id: 'bot-999',
            username: 'MusicBot',
            bot: true,
            displayAvatarURL: () => 'https://example.com/avatar.png',
        };

        const mockInteraction = {
            guild: { id: 'guild-1' },
            channel: {
                id: 'chan-1',
                permissionsFor: () => ({ has: () => true }),
            },
            options: {
                getUser: (name) => (name === 'user' ? mockBotUser : null),
            },
            reply: async (data) => {
                replyData = data;
                return data;
            },
        };

        await birthdayCommand.execute(mockInteraction, {});
        assert.ok(replyData, 'Should reply');
        assert.ok(replyData.embeds[0].data.description.includes('is a bot'));
    });

    it('should send a grand birthday embed, tag target, include party vibes and restrict allowedMentions', async () => {
        let replyData = null;
        const targetUserId = '987654321098765432';
        const targetUser = {
            id: targetUserId,
            username: 'dharshu',
            displayName: 'Dharshu',
            bot: false,
            displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/987654321098765432/avatar.png',
        };

        const mockInteraction = {
            guild: {
                id: 'guild-1',
                members: {
                    cache: new Map([
                        [targetUserId, { displayName: 'Dharshu', user: targetUser }],
                    ]),
                },
            },
            channel: {
                id: 'chan-1',
                permissionsFor: () => ({ has: () => true }),
            },
            options: {
                getUser: (name) => (name === 'user' ? targetUser : null),
            },
            reply: async (data) => {
                replyData = data;
                return data;
            },
        };

        const mockClient = {
            user: { displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/bot/avatar.png' },
        };

        await birthdayCommand.execute(mockInteraction, mockClient);

        assert.ok(replyData, 'Should have replied with celebration payload');

        // Verify notification content tags the user
        assert.ok(replyData.content.includes(`<@${targetUserId}>`), 'Must mention target user ID in message');

        // Verify strictly restricted allowedMentions (no accidental mass mentions)
        assert.deepStrictEqual(replyData.allowedMentions.users, [targetUserId], 'allowedMentions must only include target user');
        assert.deepStrictEqual(replyData.allowedMentions.roles, [], 'allowedMentions roles must be empty');
        assert.deepStrictEqual(replyData.allowedMentions.parse, [], 'allowedMentions parse must be empty to avoid @everyone/@here');
        assert.strictEqual(replyData.allowedMentions.repliedUser, false);

        // Verify embed
        const embed = replyData.embeds[0].data;
        assert.ok(birthdayCommand.wishes.some(w => w.title === embed.title), 'Title should match one of the randomized party titles');
        assert.ok(embed.description.includes(`<@${targetUserId}>`), 'Description must explicitly tag the user with <@userId>');
        assert.ok(embed.description.includes('Dharshu'), 'Description must include Dharshu');
        assert.ok(embed.description.includes("Everyone"), 'Must include celebratory cheer');
        assert.strictEqual(embed.footer.text, 'Reso ♪ • Resonance in every beat');
        assert.strictEqual(embed.color, Colors.Primary);
        assert.ok(embed.thumbnail.url.includes(targetUserId), 'Thumbnail must be recipient avatar');
        assert.ok(embed.timestamp, 'Timestamp must be present');

        // Verify Party Vibes fields
        assert.ok(embed.fields && embed.fields.length >= 2, 'Embed must include party vibe fields');
        assert.ok(embed.fields.some(f => f.name.includes('Party Energy')), 'Must include Party Energy field');
        assert.ok(embed.fields.some(f => f.name.includes('Celebration Mode')), 'Must include Celebration Mode field');
    });

    it('should resolve user from mention string in prefix invocation (e.g. >birthday @Dharshu)', async () => {
        let replyData = null;
        const targetUserId = '112233445566778899';
        const targetUser = {
            id: targetUserId,
            username: 'dharshu',
            displayName: 'Dharshu',
            bot: false,
            displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/112233445566778899/avatar.png',
        };

        const mockInteraction = {
            guild: {
                id: 'guild-1',
                members: {
                    cache: new Map([
                        [targetUserId, { displayName: 'Dharshu', user: targetUser }],
                    ]),
                },
            },
            channel: {
                id: 'chan-1',
                permissionsFor: () => ({ has: () => true }),
            },
            options: {
                getUser: () => null, // simulates prefix mode where getUser wasn't passed initially
                getString: (name) => (name === 'user' ? `<@${targetUserId}>` : null),
            },
            reply: async (data) => {
                replyData = data;
                return data;
            },
        };

        const mockClient = {
            user: { displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/bot/avatar.png' },
            users: {
                cache: new Map([[targetUserId, targetUser]]),
            },
        };

        await birthdayCommand.execute(mockInteraction, mockClient);

        assert.ok(replyData, 'Should have resolved user from mention string');
        assert.ok(replyData.content.includes(`<@${targetUserId}>`));
        assert.ok(replyData.embeds[0].data.description.includes(`<@${targetUserId}>`));
        assert.ok(replyData.embeds[0].data.description.includes('Dharshu'));
    });

    it('should handle Discord API reply errors safely without crashing', async () => {
        const targetUser = {
            id: '123456789012345678',
            username: 'dharshu',
            bot: false,
            displayAvatarURL: () => 'https://example.com/avatar.png',
        };

        let followUpData = null;
        const mockInteraction = {
            guild: { id: 'guild-1', members: { cache: new Map() } },
            channel: { id: 'chan-1', permissionsFor: () => ({ has: () => true }) },
            options: { getUser: () => targetUser },
            replied: true,
            reply: async () => {
                throw new Error('Discord API 500 Server Error');
            },
            followUp: async (data) => {
                followUpData = data;
                return data;
            },
        };

        await birthdayCommand.execute(mockInteraction, { user: {} });
        assert.ok(followUpData, 'Should send fail notice via followUp');
        assert.ok(followUpData.content.includes('Failed to send the birthday celebration'));
    });
});
