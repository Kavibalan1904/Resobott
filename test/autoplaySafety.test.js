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
});
