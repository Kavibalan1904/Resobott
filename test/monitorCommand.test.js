const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const { isOwner } = require('../src/utils/owner');
const { getSystemMetrics, handleDashboardRequest } = require('../src/utils/dashboard');
const monitorCmd = require('../src/commands/utility/monitor');

describe('Owner Monitor Command & Dashboard Verification', () => {
    const originalOwnerId = process.env.OWNER_ID;

    beforeEach(() => {
        process.env.OWNER_ID = '999999999999999999';
    });

    afterEach(() => {
        if (originalOwnerId !== undefined) {
            process.env.OWNER_ID = originalOwnerId;
        } else {
            delete process.env.OWNER_ID;
        }
    });

    it('isOwner should correctly authorize owner by OWNER_ID and reject others', async () => {
        const mockClient = { application: null };
        assert.strictEqual(await isOwner('999999999999999999', mockClient), true);
        assert.strictEqual(await isOwner('111111111111111111', mockClient), false);
        assert.strictEqual(await isOwner(null, mockClient), false);
    });

    it('isOwner should resolve owner from Discord client.application when OWNER_ID is not set', async () => {
        delete process.env.OWNER_ID;
        const mockClient = {
            application: {
                owner: { id: '888888888888888888' },
                fetch: async () => { },
            },
        };
        assert.strictEqual(await isOwner('888888888888888888', mockClient), true);
        assert.strictEqual(await isOwner('123456789012345678', mockClient), false);
    });

    it('monitor command structure and exports should be valid and marked ownerOnly', () => {
        assert.ok(monitorCmd.data, 'Missing command.data');
        assert.strictEqual(monitorCmd.data.name, 'monitor');
        assert.strictEqual(monitorCmd.ownerOnly, true, 'Command must be marked ownerOnly');
        assert.strictEqual(typeof monitorCmd.execute, 'function');
    });

    it('monitor command should reject non-owner users ephemerally', async () => {
        let repliedData = null;
        const mockInteraction = {
            user: { id: 'unauthorized_user_123' },
            reply: async (data) => {
                repliedData = data;
                return data;
            },
        };

        await monitorCmd.execute(mockInteraction, {});
        assert.ok(repliedData, 'Expected interaction.reply to be called');
        assert.ok(repliedData.content.includes('restricted to the bot owner'));
        assert.ok(repliedData.flags, 'Rejection should be ephemeral');
    });

    it('monitor command should produce comprehensive embeds and controls for owner', async () => {
        let editReplyData = null;
        let deferredFlags = null;

        const mockClient = {
            uptime: 120000,
            ws: { ping: 42 },
            guilds: {
                cache: new Map([
                    ['g1', { id: 'g1', name: 'Test Guild', memberCount: 15 }],
                ]),
            },
            lavalink: {
                nodeManager: {
                    nodes: new Map([
                        ['primary-main', {
                            id: 'primary-main',
                            connected: true,
                            heartBeatPing: 145,
                            options: { host: 'primary.lavalink', port: 443 },
                            stats: {
                                cpu: { systemLoad: 0.12, lavalinkLoad: 0.04 },
                                memory: { used: 250000000, allocated: 500000000 },
                                uptime: 3600000,
                                playingPlayers: 1,
                                players: 1,
                                frameStats: { sent: 10000, nulled: 0, deficit: 5 },
                            },
                        }],
                    ]),
                },
                players: new Map([
                    ['g1', {
                        guildId: 'g1',
                        playing: true,
                        paused: false,
                        volume: 80,
                        node: { id: 'primary-main' },
                        position: 45000,
                        queue: {
                            current: {
                                info: {
                                    title: 'Sample Track',
                                    author: 'Sample Artist',
                                    uri: 'https://open.spotify.com/track/sample',
                                    duration: 180000,
                                    sourceName: 'spotify',
                                },
                            },
                        },
                    }],
                ]),
            },
        };

        const mockInteraction = {
            user: { id: '999999999999999999' },
            deferReply: async (options) => {
                deferredFlags = options?.flags;
            },
            editReply: async (data) => {
                editReplyData = data;
                return data;
            },
        };

        await monitorCmd.execute(mockInteraction, mockClient);
        assert.ok(editReplyData, 'Expected editReply to be called');
        assert.ok(Array.isArray(editReplyData.embeds));
        assert.strictEqual(editReplyData.embeds.length, 2);

        // Verify Node Health Embed
        const nodeEmbed = editReplyData.embeds[0].data;
        assert.ok(nodeEmbed.description.includes('**Discord WS:** `42ms`'));
        assert.ok(nodeEmbed.fields.some(f => f.name.includes('primary-main')));

        // Verify Sessions Embed
        const sessionEmbed = editReplyData.embeds[1].data;
        assert.ok(sessionEmbed.fields.some(f => f.name.includes('Test Guild')));
        assert.ok(sessionEmbed.fields.some(f => f.value.includes('Sample Track')));

        // Verify Refresh button component
        assert.ok(editReplyData.components.length > 0);
    });

    it('getSystemMetrics should format system and audio quality stats properly', () => {
        const mockClient = {
            uptime: 60000,
            ws: { ping: 30 },
            guilds: { cache: new Map() },
            lavalink: {
                nodeManager: { nodes: new Map() },
                players: new Map(),
            },
        };

        const metrics = getSystemMetrics(mockClient);
        assert.ok(metrics.bot);
        assert.strictEqual(metrics.bot.wsPingMs, 30);
        assert.strictEqual(Array.isArray(metrics.nodes), true);
        assert.strictEqual(Array.isArray(metrics.sessions), true);
    });

    it('handleDashboardRequest should respond to health, dashboard, and metrics endpoints', () => {
        const mockClient = {
            uptime: 60000,
            ws: { ping: 30 },
            guilds: { cache: new Map() },
            lavalink: {
                nodeManager: { nodes: new Map() },
                players: new Map(),
            },
        };

        let healthResponse = '';
        const mockHealthRes = {
            writeHead: (status, headers) => { },
            end: (body) => { healthResponse = body; },
        };
        handleDashboardRequest({ url: '/health', headers: {} }, mockHealthRes, mockClient);
        assert.ok(healthResponse.includes('Reso Music Bot is running 24/7!'));

        let dashResponse = '';
        const mockDashRes = {
            writeHead: (status, headers) => { },
            end: (body) => { dashResponse = body; },
        };
        handleDashboardRequest({ url: '/dashboard', headers: {} }, mockDashRes, mockClient);
        assert.ok(dashResponse.includes('System & Audio Engine Monitor'));
        assert.ok(dashResponse.includes('Private Dashboard'));
    });
});
