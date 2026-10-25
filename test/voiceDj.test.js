const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const GeminiProvider = require('../src/ai/providers/geminiProvider');
const { createAIProvider } = require('../src/ai/providers/factory');
const { VoiceDJService, voiceDjService, DJ_TEMPLATES } = require('../src/ai/voiceDjService');
const voicedjCommand = require('../src/commands/music/voicedj');
const { nowPlayingEmbed } = require('../src/utils/embeds');

describe('Gemini Provider & 2.0-Flash Reliability', () => {
    it('should default to gemini-2.0-flash model', () => {
        const provider = new GeminiProvider({ apiKey: 'test-key' });
        assert.strictEqual(provider.model, 'gemini-2.0-flash');
    });

    it('factory should resolve gemini-2.0-flash when provider is gemini', () => {
        const prevEnv = process.env.AI_API_KEY;
        process.env.AI_API_KEY = 'test-key';
        const provider = createAIProvider({ provider: 'gemini' });
        assert.ok(provider instanceof GeminiProvider);
        assert.strictEqual(provider.model, 'gemini-2.0-flash');
        if (prevEnv) process.env.AI_API_KEY = prevEnv;
        else delete process.env.AI_API_KEY;
    });

    it('discoverAvailableModel should prioritize gemini-2.0-flash and not filter out 1.5 or 2.0', async () => {
        const provider = new GeminiProvider({ apiKey: 'test-key' });

        // Mock fetch to simulate Google models endpoint
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => ({
            ok: true,
            json: async () => ({
                models: [
                    { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] },
                    { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
                    { name: 'models/gemini-2.0-flash-lite', supportedGenerationMethods: ['generateContent'] },
                ],
            }),
        });

        try {
            const discovered = await provider.discoverAvailableModel();
            assert.strictEqual(discovered, 'gemini-2.0-flash');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('generateCompletion should support raw text completions when schema is false', async () => {
        const provider = new GeminiProvider({ apiKey: 'test-key' });

        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, opts) => {
            const body = JSON.parse(opts.body);
            // Verify safetySettings are present
            assert.ok(Array.isArray(body.safetySettings));
            assert.strictEqual(body.safetySettings.length, 4);

            return {
                ok: true,
                json: async () => ({
                    candidates: [
                        {
                            content: { parts: [{ text: 'Here is a smooth intro for the song!' }] },
                            finishReason: 'STOP',
                        },
                    ],
                }),
            };
        };

        try {
            const result = await provider.generateCompletion({
                prompt: 'Introduce the song',
                schema: false,
            });
            assert.strictEqual(result, 'Here is a smooth intro for the song!');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('generateCompletion should handle safety finishReason gracefully', async () => {
        const provider = new GeminiProvider({ apiKey: 'test-key' });

        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => ({
            ok: true,
            json: async () => ({
                candidates: [
                    {
                        finishReason: 'SAFETY',
                    },
                ],
            }),
        });

        try {
            await assert.rejects(
                () => provider.generateCompletion({ prompt: 'test' }),
                /safety filters/i
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

describe('Spotify-Style Voice DJ Service', () => {
    let service;

    beforeEach(() => {
        service = new VoiceDJService();
    });

    it('should generate valid deterministic templates with user, title, and artist', () => {
        const track = {
            info: {
                title: 'Blinding Lights',
                author: 'The Weeknd',
                uri: 'https://youtube.com/watch?v=123',
            },
            requester: {
                username: 'Alex',
                id: '12345',
            },
        };

        const intro = service.generateDeterministicIntro(track);
        assert.ok(intro.includes('Alex'), `Expected "${intro}" to include user Alex`);
        assert.ok(intro.includes('The Weeknd') || intro.includes('Blinding Lights'), `Expected "${intro}" to mention track or artist`);
    });

    it('should handle autoplay picks differently in templates', () => {
        const track = {
            info: {
                title: 'Levitating',
                author: 'Dua Lipa',
            },
            requester: {
                id: 'autoplay',
                username: 'Autoplay',
            },
            isAutoplay: true,
        };

        const intro = service.generateDeterministicIntro(track);
        assert.ok(intro.length > 10);
        assert.ok(intro.includes('Levitating') || intro.includes('Dua Lipa'));
    });

    it('should generate proper Google Translate TTS URLs with accents', () => {
        const url = service.getTtsUrl('Hello from Reso DJ', 'british');
        assert.ok(url.startsWith('https://translate.google.com/translate_tts'));
        assert.ok(url.includes('tl=en-gb'));
        assert.ok(url.includes('client=tw-ob'));
        assert.ok(url.includes('Hello'));
    });

    it('should pre-cache upcoming track in background and retrieve instantly', async () => {
        const guildId = 'test-guild-456';
        const upcomingTrack = {
            info: {
                title: 'Shape of You',
                author: 'Ed Sheeran',
                uri: 'https://youtube.com/watch?v=shapeofyou',
            },
            requester: {
                username: 'Sam',
            },
        };

        // Prepare announcement in background
        await service.prepareUpcomingAnnouncement(guildId, upcomingTrack);

        const trackKey = service.getTrackKey(guildId, upcomingTrack);
        assert.ok(service.cache.has(trackKey), 'Track should be cached in memory');

        // Retrieve announcement
        const result = await service.getOrGenerateAnnouncement(guildId, upcomingTrack);
        assert.ok(result);
        assert.ok(result.text.length > 5);
        assert.ok(result.audioUrl.includes('translate.google.com'));
        assert.strictEqual(service.cache.has(trackKey), false, 'Cache should be consumed after retrieval');
    });

    it('should respect frequency settings (every, every_2, every_3)', () => {
        const guildId = 'test-guild-freq';

        // Frequency: every
        service.updateSettings(guildId, { enabled: true, frequency: 'every' });
        assert.strictEqual(service.shouldSpeakThisTurn(guildId), true);
        assert.strictEqual(service.shouldSpeakThisTurn(guildId), true);

        // Frequency: every_2
        service.updateSettings(guildId, { enabled: true, frequency: 'every_2' });
        service.playCounters.set(guildId, 0);
        assert.strictEqual(service.shouldSpeakThisTurn(guildId), true);  // 1st
        assert.strictEqual(service.shouldSpeakThisTurn(guildId), false); // 2nd
        assert.strictEqual(service.shouldSpeakThisTurn(guildId), true);  // 3rd
    });

    it('should render Voice DJ announcement in nowPlayingEmbed when provided', () => {
        const track = {
            info: {
                title: 'Starboy',
                author: 'The Weeknd',
                duration: 230000,
                uri: 'https://youtube.com/watch?v=starboy',
                sourceName: 'spotify',
            },
            requester: { username: 'Kavi' },
        };

        const mockPlayer = {
            position: 30000,
            volume: 70,
            repeatMode: 'off',
            queue: { tracks: [] },
            guildId: 'guild-1',
        };

        const embed = nowPlayingEmbed(track, mockPlayer, null, [], {
            text: 'Up next for Kavi, here is Starboy!',
        });

        assert.ok(embed.data.description.includes('🎙️ **Reso DJ:**'));
        assert.ok(embed.data.description.includes('Up next for Kavi, here is Starboy!'));
    });
});

describe('Voice DJ Slash Command', () => {
    it('should export valid slash command data and options', () => {
        assert.strictEqual(voicedjCommand.data.name, 'voicedj');
        assert.ok(Array.isArray(voicedjCommand.aliases));
        assert.ok(voicedjCommand.aliases.includes('vdj'));
        assert.strictEqual(typeof voicedjCommand.execute, 'function');
    });
});
