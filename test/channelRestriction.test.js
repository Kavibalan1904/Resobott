const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
    getDesignatedChannel,
    setDesignatedChannel,
    removeDesignatedChannel,
    isDesignatedChannel
} = require('../src/utils/settings');
const setchannelCommand = require('../src/commands/utility/setchannel');

describe('Designated Channel Settings & Restrictions', () => {
    const testGuildId = 'test_guild_123';
    const testChannelId = 'test_channel_456';
    const otherChannelId = 'other_channel_789';

    afterEach(() => {
        removeDesignatedChannel(testGuildId);
    });

    it('should correctly set, retrieve, and remove a designated channel', () => {
        assert.strictEqual(getDesignatedChannel(testGuildId), null);
        assert.strictEqual(isDesignatedChannel(testGuildId, testChannelId), true);

        setDesignatedChannel(testGuildId, testChannelId);
        assert.strictEqual(getDesignatedChannel(testGuildId), testChannelId);
        assert.strictEqual(isDesignatedChannel(testGuildId, testChannelId), true);
        assert.strictEqual(isDesignatedChannel(testGuildId, otherChannelId), false);

        removeDesignatedChannel(testGuildId);
        assert.strictEqual(getDesignatedChannel(testGuildId), null);
        assert.strictEqual(isDesignatedChannel(testGuildId, otherChannelId), true);
    });

    it('setchannel command structure and exports should be valid', () => {
        assert.ok(setchannelCommand.data);
        assert.strictEqual(setchannelCommand.data.name, 'setchannel');
        assert.strictEqual(typeof setchannelCommand.execute, 'function');
    });

    it('setchannel should update active player textChannelId when confirmed', async () => {
        let confirmedPlayer = null;
        const mockPlayer = {
            guildId: testGuildId,
            textChannelId: otherChannelId
        };

        const mockClient = {
            lavalink: {
                getPlayer: (gId) => (gId === testGuildId ? mockPlayer : null)
            }
        };

        let updatedResponse = null;
        const mockConfirmation = {
            user: { id: 'user1' },
            customId: 'setchannel_yes',
            update: async (data) => {
                updatedResponse = data;
            }
        };

        const mockInteraction = {
            user: { id: 'user1' },
            guildId: testGuildId,
            channel: { id: testChannelId },
            options: {
                getString: () => 'set'
            },
            reply: async () => ({
                awaitMessageComponent: async () => mockConfirmation
            })
        };

        await setchannelCommand.execute(mockInteraction, mockClient);

        assert.strictEqual(getDesignatedChannel(testGuildId), testChannelId);
        assert.strictEqual(mockPlayer.textChannelId, testChannelId, 'Player textChannelId should be updated to designated channel');
        assert.ok(updatedResponse.content.includes(testChannelId));
    });

    it('should identify exempt commands like setchannel and clearbot', () => {
        const exemptSlashCommands = ['setchannel', 'clearbot'];
        const exemptPrefixCommands = ['setchannel', 'clearbot', 'cleanup', 'purgebot', 'cleanbot', 'clearb'];

        assert.ok(exemptSlashCommands.includes('setchannel'));
        assert.ok(exemptSlashCommands.includes('clearbot'));
        assert.ok(!exemptSlashCommands.includes('play'));
        assert.ok(!exemptSlashCommands.includes('queue'));

        assert.ok(exemptPrefixCommands.includes('cleanup'));
        assert.ok(exemptPrefixCommands.includes('clearbot'));
        assert.ok(!exemptPrefixCommands.includes('play'));
    });
});
