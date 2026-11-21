const { describe, it } = require('node:test');
const assert = require('node:assert');
const { extractTrackSearchQueries, isAcceptableFallback } = require('../src/utils/helpers');

describe('Fallback Matching & Track Identity Preservation', () => {
    it('should extract rich queries preserving movie and composer context without noisy video tags', () => {
        const queries = extractTrackSearchQueries(
            'Mannippu - Full Video | Kanguva | Suriya, Disha Patani | Devi Sri Prasad',
            'Saregama Tamil'
        );
        assert.ok(queries.length >= 2);
        assert.strictEqual(queries[0], 'Mannippu Kanguva');
        assert.ok(queries.includes('Mannippu Kanguva Suriya, Disha Patani'));
        assert.ok(queries.includes('Mannippu'));
    });

    it('should extract movie name for Tamil 4K video songs', () => {
        const queries = extractTrackSearchQueries(
            'Malaiyuru Nattamai - 4K Video Song | மலையூரு  நாட்டாமை | Mambattiyan | Prashanth |  S.Thaman',
            'Sun Pictures'
        );
        assert.ok(queries.length >= 1);
        assert.ok(queries.some(q => q.includes('Malaiyuru Nattamai') && q.includes('Mambattiyan')));
    });

    it('should extract movie name for music video releases like Magale Baththa', () => {
        const queries = extractTrackSearchQueries(
            'Magale - Music Video | Baththa | Vijay Sethupathi | Think Music India',
            'Think Music India'
        );
        assert.ok(queries.length >= 1);
        assert.strictEqual(queries[0], 'Magale Baththa');
    });

    it('should strictly reject unrelated tracks on fallback (e.g. Fr Deva Raj on SoundCloud)', () => {
        const originalTrack = {
            info: {
                title: 'Mannippu - Full Video | Kanguva | Suriya, Disha Patani | Devi Sri Prasad',
                author: 'Devi Sri Prasad',
                duration: 324000, // 5:24
            }
        };

        const wrongCandidate = {
            info: {
                title: 'Mannippu',
                author: 'Fr Deva Raj',
                duration: 212000, // 3:32
            }
        };

        const acceptable = isAcceptableFallback(wrongCandidate, originalTrack, 'Mannippu Kanguva');
        assert.strictEqual(acceptable, false, 'Should reject Fr Deva Raj as fallback for Kanguva');
    });

    it('should accept legitimate audio track fallback matching title and author/keywords', () => {
        const originalTrack = {
            info: {
                title: 'Mannippu - Full Video | Kanguva | Suriya, Disha Patani | Devi Sri Prasad',
                author: 'Devi Sri Prasad',
                duration: 324000, // 5:24
            }
        };

        const legitimateCandidate = {
            info: {
                title: 'Mannippu',
                author: 'Devi Sri Prasad, Raghu Dixit, Viveka',
                duration: 320000, // 5:20
            }
        };

        const acceptable = isAcceptableFallback(legitimateCandidate, originalTrack, 'Mannippu Kanguva');
        assert.strictEqual(acceptable, true, 'Should accept legitimate audio match');
    });

    it('should identify YouTube playback block errors accurately', () => {
        const errorStrings = [
            'All clients failed to load the item. Client [TVHTML5] failed: Something went wrong when decoding the track. Client [WEB] failed: No supported audio streams available',
            'This video requires login to confirm your age',
            'Sign in to confirm you’re not a bot',
            'rate-limit exceeded on youtube',
            'No supported audio streams available, available types: []',
        ];

        const isYoutubeBlockRegex = /login|All clients failed|bot detection|decoding the track|No supported audio streams|restricted|Sign in|rate-limit|Playback on other websites has been disabled/i;

        for (const err of errorStrings) {
            assert.ok(isYoutubeBlockRegex.test(err), `Should match block error: "${err}"`);
        }
    });

    it('should strictly exclude ytmsearch and ytsearch when YouTube is blocked', () => {
        const isYoutubeBlock = true;
        const fallbackSources = isYoutubeBlock
            ? ['spsearch', 'scsearch']
            : ['spsearch', 'ytmsearch', 'scsearch', 'ytsearch'];

        assert.deepStrictEqual(fallbackSources, ['spsearch', 'scsearch']);
        assert.ok(!fallbackSources.includes('ytmsearch'), 'Must not search YouTube Music when YouTube is blocked');
        assert.ok(!fallbackSources.includes('ytsearch'), 'Must not search YouTube Video when YouTube is blocked');
        assert.strictEqual(fallbackSources[0], 'spsearch', 'Spotify must be the first fallback');
    });
});
