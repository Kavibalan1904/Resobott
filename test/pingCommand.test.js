const { describe, it } = require('node:test');
const assert = require('node:assert');

const pingCommand = require('../src/commands/utility/ping');
const { formatUptime, getNodeHealthSummary } = require('../src/utils/helpers');

describe('Ping Command & Latency Verification', () => {
    it('formatUptime should format various intervals cleanly without noisy seconds', () => {
        // Less than a minute
        assert.strictEqual(formatUptime(45 * 1000), '45s');
        // Under an hour
        assert.strictEqual(formatUptime((15 * 60 + 30) * 1000), '15m 30s');
        // Hours without days
        assert.strictEqual(formatUptime((2 * 3600 + 14 * 60 + 20) * 1000), '2h 14m');
        // Days and hours - no seconds
        assert.strictEqual(formatUptime((1 * 86400 + 22 * 3600 + 14 * 60 + 23) * 1000), '1d 22h 14m');
        // Long uptime - no seconds
        assert.strictEqual(formatUptime((15 * 86400 + 10 * 60 + 33) * 1000), '15d 10m');
        // Invalid or zero
        assert.strictEqual(formatUptime(0), '0s');
        assert.strictEqual(formatUptime(null), '0s');
    });

    it('should compute latency and render clean embeds without NaN or unrounded floats', async () => {
        let sentData = null;
        const now = Date.now();

        const mockClient = {
            ws: { ping: 106.4 },
            user: { displayAvatarURL: () => 'https://example.com/avatar.png' },
            lavalink: {
                players: new Map([
                    ['g1', { playing: true }],
                    ['g2', { playing: false }]
                ]),
                nodeManager: {
                    nodes: new Map([
                        ['primary-main', {
                            id: 'primary-main',
                            connected: true,
                            heartBeatPing: 179.16609099999187,
                            options: { host: 'primary.host', port: 2333 },
                            stats: {
                                cpu: { systemLoad: 0.51 },
                                players: 0,
                                playingPlayers: 0,
                                uptime: (1 * 86400 + 22 * 3600 + 14 * 60 + 23) * 1000,
                                memory: { used: 358612992 },
                            }
                        }],
                        ['backup-millohost', {
                            id: 'backup-millohost',
                            connected: true,
                            heartBeatPing: 224.95716299999913,
                            options: { host: 'millo.host', port: 2333 },
                            stats: {
                                cpu: { systemLoad: 0 },
                                players: 1644,
                                playingPlayers: 448,
                                uptime: (15 * 86400 + 10 * 60 + 33) * 1000,
                            }
                        }]
                    ])
                }
            }
        };

        const mockInteraction = {
            id: '123456789',
            createdTimestamp: now - 42,
            deferReply: async () => {},
            fetchReply: async () => ({
                createdTimestamp: now
            }),
            editReply: async (data) => {
                sentData = data;
            }
        };

        await pingCommand.execute(mockInteraction, mockClient);

        assert.ok(sentData, 'Expected editReply to be called');
        const embed = sentData.embeds[0];
        assert.ok(embed, 'Expected embed in editReply');

        // Check fields
        const fields = embed.data.fields;
        const apiField = fields.find(f => f.name.includes('API Latency'));
        const wsField = fields.find(f => f.name.includes('WebSocket'));
        const engineField = fields.find(f => f.name.includes('Audio Engine'));
        const nodesField = fields.find(f => f.name.includes('Lavalink Nodes'));

        assert.ok(apiField, 'API Latency field must exist');
        assert.ok(wsField, 'WebSocket field must exist');
        assert.ok(engineField, 'Audio Engine field must exist');
        assert.ok(nodesField, 'Lavalink Nodes field must exist');

        // Verify API latency is NOT NaN
        assert.ok(!apiField.value.includes('NaN'), `API Latency must not contain NaN! Got: ${apiField.value}`);
        assert.ok(/`\d+ms`/.test(apiField.value), `API Latency should contain integer ms: ${apiField.value}`);

        // Verify WebSocket latency is clean integer
        assert.ok(wsField.value.includes('`106ms`'), `WebSocket latency should be rounded to 106ms: ${wsField.value}`);

        // Verify nodes formatting:
        const nodeText = nodesField.value;
        // Float check: should NOT contain long floats like 179.166 or 224.957
        assert.ok(!nodeText.includes('179.166'), `Should not contain raw float: ${nodeText}`);
        assert.ok(!nodeText.includes('224.957'), `Should not contain raw float: ${nodeText}`);
        assert.ok(nodeText.includes('`179ms`'), `Should contain rounded 179ms: ${nodeText}`);
        assert.ok(nodeText.includes('`225ms`'), `Should contain rounded 225ms: ${nodeText}`);

        // Raw internal score check: should NOT contain -99795 or Score:
        assert.ok(!nodeText.includes('-99795'), `Internal score -99795 must not be shown: ${nodeText}`);
        assert.ok(!nodeText.includes('Score:'), `Raw score label must not be shown: ${nodeText}`);

        // Role labels and states
        assert.ok(nodeText.includes('`PRIMARY`'), 'Primary badge must be present');
        assert.ok(nodeText.includes('`BACKUP`'), 'Backup badge must be present');
        assert.ok(nodeText.includes('Active'), 'Active status must be present');
        assert.ok(nodeText.includes('Standby'), 'Standby status must be present');

        // Clean uptime format check
        assert.ok(nodeText.includes('1d 22h 14m'), `Uptime should be formatted cleanly: ${nodeText}`);
        assert.ok(!nodeText.includes('1d 22h 14m 23s'), `Noisy seconds should be omitted: ${nodeText}`);
    });

    it('should handle missing fetchReply and prefix command mock interaction without NaN', async () => {
        let sentData = null;
        const now = Date.now();

        const mockClient = {
            ws: { ping: 45 },
            user: { displayAvatarURL: () => null },
            lavalink: null
        };

        // Interaction where fetchReply is undefined or throws
        const mockInteraction = {
            id: '123456789',
            createdTimestamp: now - 35,
            deferReply: async () => {},
            // No fetchReply
            editReply: async (data) => {
                sentData = data;
            }
        };

        await pingCommand.execute(mockInteraction, mockClient);

        assert.ok(sentData);
        const apiField = sentData.embeds[0].data.fields.find(f => f.name.includes('API Latency'));
        assert.ok(!apiField.value.includes('NaN'), `API Latency must not contain NaN even without fetchReply: ${apiField.value}`);
        assert.ok(/`\d+ms`/.test(apiField.value));
    });

    it('should handle completely missing createdTimestamp gracefully', async () => {
        let sentData = null;
        const mockClient = {
            ws: { ping: 50 },
            user: { displayAvatarURL: () => null },
            lavalink: null
        };

        // Edge case: interaction has no createdTimestamp at all
        const mockInteraction = {
            deferReply: async () => {},
            editReply: async (data) => {
                sentData = data;
            }
        };

        await pingCommand.execute(mockInteraction, mockClient);

        assert.ok(sentData);
        const apiField = sentData.embeds[0].data.fields.find(f => f.name.includes('API Latency'));
        assert.ok(!apiField.value.includes('NaN'), `API Latency must never be NaN: ${apiField.value}`);
        assert.ok(/`\d+ms`/.test(apiField.value));
    });
});
