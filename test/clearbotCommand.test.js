const { describe, it } = require('node:test');
const assert = require('node:assert');
const { PermissionFlagsBits } = require('discord.js');

const clearbotCommand = require('../src/commands/utility/clearbot');

describe('Clearbot Command Verification', () => {
    it('should export valid command structure, data and aliases', () => {
        assert.ok(clearbotCommand.data, 'Missing command data');
        assert.strictEqual(clearbotCommand.data.name, 'clearbot');
        assert.ok(clearbotCommand.data.description, 'Missing command description');
        assert.strictEqual(clearbotCommand.category, 'utility');
        assert.ok(Array.isArray(clearbotCommand.aliases));
        assert.ok(clearbotCommand.aliases.includes('cleanup'));
        assert.ok(clearbotCommand.aliases.includes('purgebot'));
        assert.strictEqual(typeof clearbotCommand.execute, 'function');
    });

    it('should reject execution if not in a guild', async () => {
        let replyData = null;
        const mockInteraction = {
            guild: null,
            channel: null,
            reply: async (data) => {
                replyData = data;
                return data;
            },
        };

        await clearbotCommand.execute(mockInteraction, {});
        assert.ok(replyData, 'Should have replied');
        assert.ok(replyData.embeds[0].data.description.includes('server text channel'));
    });

    it('should reject members without Manage Messages or Administrator permission', async () => {
        let replyData = null;
        const mockInteraction = {
            guild: { id: 'g1' },
            channel: { id: 'c1' },
            member: {
                permissions: {
                    has: (perm) => false,
                },
            },
            reply: async (data) => {
                replyData = data;
                return data;
            },
        };

        await clearbotCommand.execute(mockInteraction, {});
        assert.ok(replyData, 'Should have replied');
        assert.ok(replyData.embeds[0].data.description.includes('Manage Messages'));
    });

    it('should report when no bot messages are found in the channel', async () => {
        let replyData = null;
        const mockMessages = new Map([
            ['m1', { id: 'm1', author: { id: 'user1' }, createdTimestamp: Date.now() }],
            ['m2', { id: 'm2', author: { id: 'user2' }, createdTimestamp: Date.now() }],
        ]);

        const mockInteraction = {
            guild: { id: 'g1' },
            token: 'valid_token',
            member: {
                permissions: {
                    has: () => true,
                },
            },
            channel: {
                id: 'c1',
                guild: {
                    members: {
                        me: {
                            id: 'bot_id',
                        },
                    },
                },
                permissionsFor: () => ({
                    has: (perm) => true,
                }),
                messages: {
                    fetch: async () => mockMessages,
                },
            },
            options: {
                getInteger: () => 50,
            },
            deferReply: async () => {},
            editReply: async (data) => {
                replyData = data;
                return data;
            },
        };

        const mockClient = {
            user: { id: 'bot_id' },
            lastNowPlayingMessage: new Map(),
        };

        await clearbotCommand.execute(mockInteraction, mockClient);
        assert.ok(replyData, 'Should have edited reply');
        assert.ok(replyData.embeds[0].data.description.includes('No bot messages found'));
    });

    it('should bulk delete bot messages younger than 14 days when permissions allow', async () => {
        let replyData = null;
        let bulkDeletedCount = 0;
        const deletedIndividual = [];

        const now = Date.now();
        const mockMessages = new Map([
            ['m1', { id: 'm1', author: { id: 'bot_id' }, createdTimestamp: now - 1000, delete: async () => deletedIndividual.push('m1') }],
            ['m2', { id: 'm2', author: { id: 'bot_id' }, createdTimestamp: now - 5000, delete: async () => deletedIndividual.push('m2') }],
            ['m3', { id: 'm3', author: { id: 'other_user' }, createdTimestamp: now - 1000 }],
        ]);

        const mockInteraction = {
            guild: { id: 'g1' },
            token: 'valid_token',
            member: {
                permissions: {
                    has: () => true,
                },
            },
            channel: {
                id: 'c1',
                guild: {
                    members: {
                        me: { id: 'bot_id' },
                    },
                },
                permissionsFor: () => ({
                    has: (perm) => perm === PermissionFlagsBits.ReadMessageHistory || perm === PermissionFlagsBits.ManageMessages,
                }),
                messages: {
                    fetch: async () => mockMessages,
                },
                bulkDelete: async (chunk) => {
                    bulkDeletedCount += chunk.length;
                    return { size: chunk.length };
                },
            },
            options: {
                getInteger: () => 100,
            },
            deferReply: async () => {},
            editReply: async (data) => {
                replyData = data;
                return data;
            },
        };

        const mockClient = {
            user: { id: 'bot_id' },
            lastNowPlayingMessage: new Map([['g1', { id: 'm1' }]]),
        };

        await clearbotCommand.execute(mockInteraction, mockClient);
        assert.strictEqual(bulkDeletedCount, 2, 'Should have bulk deleted the 2 bot messages');
        assert.ok(replyData.embeds[0].data.description.includes('Cleared **2** bot messages'));
        assert.strictEqual(mockClient.lastNowPlayingMessage.has('g1'), false, 'Should have cleaned up lastNowPlayingMessage');
    });

    it('should fall back to individual delete if bot lacks ManageMessages permission', async () => {
        let replyData = null;
        const deletedIndividual = [];

        const now = Date.now();
        const mockMessages = new Map([
            ['m1', { id: 'm1', author: { id: 'bot_id' }, createdTimestamp: now - 1000, delete: async () => deletedIndividual.push('m1') }],
            ['m2', { id: 'm2', author: { id: 'bot_id' }, createdTimestamp: now - 2000, delete: async () => deletedIndividual.push('m2') }],
        ]);

        const mockInteraction = {
            guild: { id: 'g1' },
            token: 'valid_token',
            member: {
                permissions: {
                    has: () => true,
                },
            },
            channel: {
                id: 'c1',
                guild: {
                    members: {
                        me: { id: 'bot_id' },
                    },
                },
                permissionsFor: () => ({
                    has: (perm) => perm === PermissionFlagsBits.ReadMessageHistory, // Lacks ManageMessages
                }),
                messages: {
                    fetch: async () => mockMessages,
                },
                bulkDelete: async () => {
                    throw new Error('Missing Permissions');
                },
            },
            options: {
                getInteger: () => 100,
            },
            deferReply: async () => {},
            editReply: async (data) => {
                replyData = data;
                return data;
            },
        };

        const mockClient = {
            user: { id: 'bot_id' },
            lastNowPlayingMessage: new Map(),
        };

        await clearbotCommand.execute(mockInteraction, mockClient);
        assert.strictEqual(deletedIndividual.length, 2, 'Should individually delete bot messages');
        assert.ok(replyData.embeds[0].data.description.includes('Cleared **2** bot messages'));
    });
});
