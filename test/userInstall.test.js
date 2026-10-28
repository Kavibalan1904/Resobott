const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection } = require('discord.js');

const pingCmd = require('../src/commands/utility/ping');
const helpCmd = require('../src/commands/utility/help');
const inviteCmd = require('../src/commands/utility/invite');
const statsCmd = require('../src/commands/utility/stats');
const lyricsCmd = require('../src/commands/music/lyrics');
const playCmd = require('../src/commands/music/play');
const { isInSameVoiceChannel } = require('../src/utils/helpers');

test('User-Installable Apps — Portable Commands Configuration', async (t) => {
    await t.test('portable commands should export integration_types [0, 1] and contexts [0, 1, 2]', () => {
        const portableCommands = [
            { name: 'ping', cmd: pingCmd },
            { name: 'help', cmd: helpCmd },
            { name: 'invite', cmd: inviteCmd },
            { name: 'stats', cmd: statsCmd },
            { name: 'lyrics', cmd: lyricsCmd },
        ];

        for (const { name, cmd } of portableCommands) {
            assert.ok(cmd.data, `${name} has data`);
            const json = cmd.data.toJSON();
            assert.deepEqual(
                json.integration_types,
                [0, 1],
                `${name} should have integration_types: [0, 1] (GuildInstall and UserInstall)`
            );
            assert.deepEqual(
                json.contexts,
                [0, 1, 2],
                `${name} should have contexts: [0, 1, 2] (Guild, BotDM, PrivateChannel)`
            );
        }
    });

    await t.test('commandHandler mapping should apply smart defaults for guild-only commands', () => {
        const mockClient = {
            commands: new Collection(),
        };
        mockClient.commands.set('play', playCmd);
        mockClient.commands.set('lyrics', lyricsCmd);

        const mapped = mockClient.commands.map(cmd => {
            const json = typeof cmd.data.toJSON === 'function' ? cmd.data.toJSON() : cmd.data;
            if (!json.integration_types) {
                json.integration_types = [0, 1];
            }
            if (!json.contexts) {
                json.contexts = [0];
            }
            return json;
        });

        const playJson = mapped.find(c => c.name === 'play');
        const lyricsJson = mapped.find(c => c.name === 'lyrics');

        // Play command defaults to guild context with UserInstall enabled
        assert.deepEqual(playJson.integration_types, [0, 1]);
        assert.deepEqual(playJson.contexts, [0]);

        // Lyrics command preserves full multi-context support
        assert.deepEqual(lyricsJson.integration_types, [0, 1]);
        assert.deepEqual(lyricsJson.contexts, [0, 1, 2]);
    });

    await t.test('helpers.isInSameVoiceChannel safely handles interactions outside guilds', () => {
        const dmInteraction = {
            guildId: undefined,
            guild: undefined,
            member: null,
            client: { lavalink: { getPlayer: () => null } },
        };
        assert.equal(isInSameVoiceChannel(dmInteraction), false);
    });

    await t.test('lyrics command safely handles DM execution with missing query and without guild', async () => {
        let repliedWith = null;
        const mockDmInteraction = {
            guildId: undefined,
            guild: undefined,
            options: {
                getString: () => null,
            },
            client: {
                lavalink: {
                    getPlayer: () => null,
                },
            },
            deferReply: async () => {},
            deferred: true,
            replied: false,
            editReply: async (data) => {
                repliedWith = data;
                return data;
            },
            reply: async (data) => {
                repliedWith = data;
                return data;
            },
        };

        await lyricsCmd.execute(mockDmInteraction);
        assert.ok(repliedWith, 'Should have replied');
        assert.ok(repliedWith.embeds, 'Should reply with embeds');
        assert.match(
            repliedWith.embeds[0].data.description,
            /No song specified/,
            'Should provide friendly error message when no song is specified in DMs'
        );
    });
});
