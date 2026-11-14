const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');

const { checkAndPromptFirstTimeGuide, createQuickGuideEmbed, promptGuildOnInvite } = require('../src/utils/onboarding');
const {
    hasSeenGuide,
    setHasSeenGuide,
    resetHasSeenGuide,
    hasUserSeenGuide,
    setUserSeenGuide,
    resetUserSeenGuide,
    hasAnsweredGuide,
    setAnsweredGuide,
    resetAnsweredGuide,
} = require('../src/utils/settings');
const { isTrackDuplicate } = require('../src/autoplay/normalizer');
const { filterCandidates } = require('../src/autoplay/filter');

describe('First-time Server Onboarding & Anti-Duplication Regression', () => {
    const testGuildId = 'test_guild_onboarding_123';
    const testUserId1 = 'user_first_time_101';
    const testUserId2 = 'user_first_time_102';

    beforeEach(() => {
        resetAnsweredGuide(testGuildId);
        resetAnsweredGuide('other_guild_999');
        resetAnsweredGuide('guild_invited_456');
        resetAnsweredGuide(testUserId1);
        resetAnsweredGuide(testUserId2);
    });

    it('createQuickGuideEmbed should contain slash commands, > prefix, autoplay, and playlist save/load instructions', () => {
        const embed = createQuickGuideEmbed(testGuildId);
        const desc = embed.data?.description || '';

        // Slash commands & prefix >
        assert.ok(desc.includes('Slash Commands'), 'Expected mention of Slash Commands');
        assert.ok(desc.includes('`>`') || desc.includes('>play'), 'Expected mention of > prefix');

        // Autoplay
        assert.ok(desc.includes('Autoplay') || desc.includes('autoplay'), 'Expected mention of Autoplay');
        assert.ok(desc.includes('/autoplay'), 'Expected mention of /autoplay');

        // Playlist save and load
        assert.ok(desc.includes('/playlist save'), 'Expected mention of /playlist save');
        assert.ok(desc.includes('/playlist load'), 'Expected mention of /playlist load');
        assert.ok(desc.includes('playlist list') || desc.includes('/playlist list'), 'Expected mention of playlist list');
    });

    it('should prompt guide to user who plays music, and once answered never show the prompt again', async () => {
        assert.strictEqual(hasAnsweredGuide(testUserId1), false);

        let sentMessage = null;
        let collectorEmitter = null;
        const mockChannel = {
            id: 'chan_onboarding_1',
            guildId: testGuildId,
            send: async (payload) => {
                collectorEmitter = new EventEmitter();
                collectorEmitter.stop = () => {};
                sentMessage = {
                    ...payload,
                    createMessageComponentCollector: () => collectorEmitter,
                    edit: async () => {},
                };
                return sentMessage;
            },
        };

        const mockUser1 = { id: testUserId1, username: 'KaviMusic', bot: false };

        // 1. User 1 uses the bot for the first time
        await checkAndPromptFirstTimeGuide(mockChannel, mockUser1, testGuildId);

        assert.ok(sentMessage, 'Expected prompt message to be sent for User 1');
        assert.strictEqual(sentMessage.components.length, 1);
        const buttons1 = sentMessage.components[0].components;
        assert.strictEqual(buttons1.length, 2);
        assert.strictEqual(buttons1[0].data.emoji.name, '✨');
        assert.strictEqual(buttons1[1].data.emoji.name, '❌');
        assert.ok(sentMessage.embeds[0].data.description.includes(`<@${testUserId1}>`));

        // Before answering, hasAnsweredGuide is still false
        assert.strictEqual(hasAnsweredGuide(testUserId1), false);

        // Simulate user answering the prompt (clicks "Yes")
        const mockInteraction = {
            customId: buttons1[0].data.custom_id,
            user: mockUser1,
            update: async () => {},
        };
        collectorEmitter.emit('collect', mockInteraction);
        await new Promise(r => setTimeout(r, 10));

        // Once answered: hasAnsweredGuide is TRUE
        assert.strictEqual(hasAnsweredGuide(testUserId1), true);

        // Calling again for User 1 must NEVER send any second prompt
        sentMessage = null;
        await checkAndPromptFirstTimeGuide(mockChannel, mockUser1, testGuildId);
        assert.strictEqual(sentMessage, null, 'Expected second invocation for answered user to be completely suppressed');
    });

    it('should prompt guide for second user who has not answered yet', async () => {
        let sentMessage = null;
        let collectorEmitter = null;
        const mockChannel = {
            id: 'chan_onboarding_2',
            guildId: 'other_guild_999',
            send: async (payload) => {
                collectorEmitter = new EventEmitter();
                collectorEmitter.stop = () => {};
                sentMessage = {
                    ...payload,
                    createMessageComponentCollector: () => collectorEmitter,
                    edit: async () => {},
                };
                return sentMessage;
            },
        };

        const mockUser2 = { id: testUserId2, username: 'AlexBeats', bot: false };
        await checkAndPromptFirstTimeGuide(mockChannel, mockUser2, 'other_guild_999');

        assert.ok(sentMessage, 'Expected prompt message to be sent for User 2');
        assert.strictEqual(hasAnsweredGuide(testUserId2), false);

        // Simulate user answering "No"
        collectorEmitter.emit('collect', {
            customId: sentMessage.components[0].components[1].data.custom_id,
            user: mockUser2,
            update: async () => {},
        });
        await new Promise(r => setTimeout(r, 10));

        assert.strictEqual(hasAnsweredGuide(testUserId2), true);
    });

    it('should ignore bots and internal autoplay requester from guide prompt', async () => {
        let sentMessage = null;
        const mockChannel = {
            id: 'chan_bot_1',
            guildId: testGuildId,
            send: async (payload) => {
                sentMessage = payload;
                return sentMessage;
            },
        };

        // Discord Bot user
        await checkAndPromptFirstTimeGuide(mockChannel, { id: 'bot_999', bot: true }, testGuildId);
        assert.strictEqual(sentMessage, null);

        // Internal autoplay requester
        await checkAndPromptFirstTimeGuide(mockChannel, { id: 'autoplay', bot: false }, testGuildId);
        assert.strictEqual(sentMessage, null);
    });

    it('promptGuildOnInvite should send onboarding prompt to systemChannel and record answered state when clicked', async () => {
        const inviteGuildId = 'guild_invited_456';
        resetAnsweredGuide(inviteGuildId);

        let sentPayload = null;
        let collectorEmitter = null;
        const mockSystemChannel = {
            id: 'chan_system_1',
            isTextBased: () => true,
            permissionsFor: () => ({ has: () => true }),
            send: async (payload) => {
                collectorEmitter = new EventEmitter();
                collectorEmitter.stop = () => {};
                sentPayload = {
                    ...payload,
                    createMessageComponentCollector: () => collectorEmitter,
                };
                return sentPayload;
            },
        };

        const mockGuild = {
            id: inviteGuildId,
            name: 'Vibe Central',
            systemChannel: mockSystemChannel,
            members: { me: { id: 'bot_me' } },
            channels: { cache: new Map([['chan_system_1', mockSystemChannel]]) },
        };

        assert.strictEqual(hasAnsweredGuide(inviteGuildId), false);
        await promptGuildOnInvite(mockGuild);

        assert.ok(sentPayload, 'Expected welcome prompt to be sent on guild invite');
        assert.ok(sentPayload.embeds[0].data.description.includes('Vibe Central'));
        assert.strictEqual(sentPayload.components.length, 1);
        const buttons = sentPayload.components[0].components;
        assert.strictEqual(buttons[0].data.emoji.name, '✨');
        assert.strictEqual(buttons[1].data.emoji.name, '❌');

        // Simulate server member answering the prompt
        collectorEmitter.emit('collect', {
            customId: buttons[0].data.custom_id,
            user: { id: 'server_admin_1' },
            update: async () => {},
        });
        await new Promise(r => setTimeout(r, 10));

        // Marked as answered
        assert.strictEqual(hasAnsweredGuide(inviteGuildId), true);

        // Second call suppressed permanently
        sentPayload = null;
        await promptGuildOnInvite(mockGuild);
        assert.strictEqual(sentPayload, null);
    });

    it('isTrackDuplicate should identify movie subtitle and channel re-upload variants as duplicates', () => {
        // 1. Core title with and without (From "Movie")
        const t1 = { title: 'Thannane Thamarapoo', author: 'Deva' };
        const t2 = { title: 'Thannane Thamarapoo (From "Periyanna")', author: 'Deva' };
        assert.strictEqual(isTrackDuplicate(t1, t2), true, 'Expected core title match for Thannane Thamarapoo');

        // 2. Movie song with video tags and channel author
        const t3 = { title: 'Devuda Devuda', author: 'S. P. Balasubrahmanyam' };
        const t4 = { title: 'Devuda Devuda Official Video | Rajinikanth | Chandramukhi', author: 'Sun TV' };
        assert.strictEqual(isTrackDuplicate(t3, t4), true, 'Expected core title match for Devuda Devuda across uploads');

        // 3. Beast Arabic Kuthu
        const t5 = { title: 'Arabic Kuthu', author: 'Anirudh' };
        const t6 = { title: 'Arabic Kuthu - Video Song | Beast | Thalapathy Vijay', author: 'Sun Pictures' };
        assert.strictEqual(isTrackDuplicate(t5, t6), true, 'Expected core title match for Arabic Kuthu');

        // 4. Legitimate alternate version (Remix) must NOT be treated as duplicate
        const t7 = { title: 'Arabic Kuthu (Remix)', author: 'Anirudh' };
        assert.strictEqual(isTrackDuplicate(t5, t7), false, 'Remix should not be considered duplicate of original');
    });

    it('filterCandidates should reject previously played song even when candidate title has different upload formatting', () => {
        const historyTrack = {
            info: {
                title: 'Thannane Thamarapoo',
                author: 'Suriya',
                identifier: 'orig_yt_1',
                duration: 273000,
            },
        };

        const mockContext = {
            currentTrack: null,
            manualQueueTracks: [],
            autoplayQueueTracks: [],
            recentHistory: [historyTrack],
            recentFailedCandidates: [],
        };

        // Autoplay tries to suggest the same song from a different channel/upload
        const candidates = [
            {
                info: {
                    title: 'Thannane Thamarapoo (From "Periyanna") Official Video',
                    author: 'Deva',
                    identifier: 'reupload_yt_2',
                    duration: 273000,
                },
            },
            {
                info: {
                    title: 'Konja Naal Poru',
                    author: 'Deva',
                    identifier: 'fresh_song_3',
                    duration: 260000,
                },
            },
        ];

        const { validCandidates, rejectionCounts } = filterCandidates(candidates, mockContext);
        assert.strictEqual(validCandidates.length, 1, 'Expected re-uploaded duplicate to be rejected');
        assert.strictEqual(validCandidates[0].info.title, 'Konja Naal Poru');
        assert.strictEqual(rejectionCounts.recentHistory, 1);
    });
});
