const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
    detectVibe,
    getAutoplayTrack,
    isFuzzyDuplicate,
} = require('../src/utils/recommendations');

describe('Autoplay safety and relevance', () => {
    it('does not invent a mass vibe for neutral metadata', () => {
        assert.strictEqual(
            detectVibe('Completely Neutral Instrumental', 'Unknown Artist'),
            null
        );
    });

    it('does not force Tamil when language cannot be detected', async () => {
        const queries = [];
        const candidate = {
            info: {
                title: 'Fresh Neutral Song',
                author: 'Unknown Artist',
                uri: 'https://youtube.test/fresh',
                identifier: 'fresh',
                duration: 210000,
                sourceName: 'youtube',
            },
        };

        const node = {
            connected: true,
            search: async ({ query }) => {
                queries.push(query);
                return { tracks: [candidate] };
            },
        };

        const player = {
            guildId: 'neutral-guild',
            node,
            queue: { tracks: [] },
        };

        const history = new Map([
            ['neutral-guild', [{
                requester: { id: 'user-1' },
                info: {
                    title: 'เพลงใหม่ที่ไม่รู้จัก',
                    author: 'Unknown Channel',
                    uri: 'https://youtube.test/current',
                    identifier: 'current',
                    duration: 210000,
                },
            }]],
        ]);

        const result = await getAutoplayTrack(player, history);

        assert.ok(result);
        assert.ok(queries.length > 0);
        assert.ok(queries.every(q => !/\btamil\b/i.test(q)));
        assert.ok(queries.some(q => /popular songs similar to current track/i.test(q)));
    });

    it('only treats exact normalized titles as duplicates, not arbitrary substrings', () => {
        assert.strictEqual(
            isFuzzyDuplicate('Love Story', 'Love Story'),
            true
        );
        assert.strictEqual(
            isFuzzyDuplicate('Love Story', 'Love Story 2026'),
            false
        );
    });
    it('prefers a seed-relevant candidate over a generic popular result', async () => {
        const seed = {
            info: {
                title: 'Blinding Lights - The Weeknd',
                author: 'The Weeknd',
                uri: 'https://youtube.test/seed',
                identifier: 'seed',
                duration: 200000,
            },
            requester: { id: 'user-1' },
        };

        const related = {
            info: {
                title: 'Save Your Tears - The Weeknd',
                author: 'The Weeknd',
                uri: 'https://youtube.test/related',
                identifier: 'related',
                duration: 215000,
                sourceName: 'youtube',
            },
        };
        const generic = {
            info: {
                title: 'Random Pop Song',
                author: 'Unknown Artist',
                uri: 'https://youtube.test/generic',
                identifier: 'generic',
                duration: 210000,
                sourceName: 'youtube',
            },
        };

        const node = {
            connected: true,
            search: async ({ query }) => {
                if (/songs like blinding lights/i.test(query)) return { tracks: [related] };
                return { tracks: [generic] };
            },
        };

        const player = {
            guildId: 'seed-relevance',
            node,
            queue: { tracks: [] },
        };

        const history = new Map([['seed-relevance', [seed]]]);
        const result = await getAutoplayTrack(player, history);

        assert.strictEqual(result?.info?.identifier, 'related');
    });

    it('penalizes recently repeated artists enough to allow a fresh artist to win', async () => {
        const repeated = {
            info: {
                title: 'Another Weeknd Song',
                author: 'The Weeknd',
                uri: 'https://youtube.test/repeated',
                identifier: 'repeated',
                duration: 205000,
            },
        };
        const fresh = {
            info: {
                title: 'Fresh Pop Song',
                author: 'Fresh Artist',
                uri: 'https://youtube.test/fresh',
                identifier: 'fresh',
                duration: 205000,
            },
        };

        const node = {
            connected: true,
            search: async ({ query }) => {
                if (/songs like/i.test(query)) return { tracks: [repeated, fresh] };
                return { tracks: [] };
            },
        };

        const player = {
            guildId: 'artist-cooldown',
            node,
            queue: { tracks: [] },
        };

        const history = new Map([['artist-cooldown', [
            {
                requester: { id: 'user-1' },
                info: {
                    title: 'Blinding Lights - The Weeknd',
                    author: 'The Weeknd',
                    uri: 'https://youtube.test/seed2',
                    identifier: 'seed2',
                    duration: 200000,
                },
            },
            {
                requester: { id: 'autoplay' },
                info: {
                    title: 'Starboy - The Weeknd',
                    author: 'The Weeknd',
                    uri: 'https://youtube.test/seed3',
                    identifier: 'seed3',
                    duration: 200000,
                },
            },
        ]]]);
        const result = await getAutoplayTrack(player, history);

        assert.strictEqual(result?.info?.identifier, 'fresh');
    });

});
