const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');

const { checkAndPromptFirstTimeGuide, createQuickGuideEmbed } = require('../src/utils/onboarding');
const { hasSeenGuide, setHasSeenGuide, resetHasSeenGuide } = require('../src/utils/settings');
const { isTrackDuplicate } = require('../src/autoplay/normalizer');
const { filterCandidates } = require('../src/autoplay/filter');

describe('First-time Server Onboarding & Anti-Duplication Regression', () => {
    const testGuildId = 'test_guild_onboarding_123';

    beforeEach(() => {
        resetHasSeenGuide(testGuildId);
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

    it('should prompt first-time guide on new server and mark as seen so it never prompts again', async () => {
        assert.strictEqual(hasSeenGuide(testGuildId), false);

        let sentMessage = null;
        const mockChannel = {
            send: async (payload) => {
                sentMessage = {
                    ...payload,
                    createMessageComponentCollector: () => {
                        const emitter = new EventEmitter();
                        emitter.on = emitter.addListener.bind(emitter);
                        return emitter;
                    },
                };
                return sentMessage;
            },
        };

        await checkAndPromptFirstTimeGuide(mockChannel, testGuildId, { username: 'testuser' });

        assert.ok(sentMessage, 'Expected prompt message to be sent');
        assert.strictEqual(sentMessage.components.length, 1);
        const buttons = sentMessage.components[0].components;
        assert.strictEqual(buttons.length, 2);
        assert.strictEqual(buttons[0].data.custom_id, 'guide_yes');
        assert.strictEqual(buttons[1].data.custom_id, 'guide_no');

        // Marked as seen
        assert.strictEqual(hasSeenGuide(testGuildId), true);

        // Calling again must NOT send any second prompt
        sentMessage = null;
        await checkAndPromptFirstTimeGuide(mockChannel, testGuildId, { username: 'testuser' });
        assert.strictEqual(sentMessage, null, 'Expected second invocation to be suppressed');
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
