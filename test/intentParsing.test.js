const { describe, it } = require('node:test');
const assert = require('node:assert');

const { validateAndSanitizeIntent, DEFAULT_INTENT } = require('../src/ai/intentSchema');
const { parseDeterministicRequest, extractExclusions, extractCount } = require('../src/ai/deterministicFallback');
const BaseAIProvider = require('../src/ai/providers/baseProvider');
const { createAIProvider } = require('../src/ai/providers/factory');

describe('Intent Schema & Sanitization', () => {
    it('should return default intent on null or invalid input', () => {
        const result = validateAndSanitizeIntent(null);
        assert.strictEqual(result.intent, 'mood_playlist');
        assert.strictEqual(result.trackCount, 10);
        assert.strictEqual(result.energy, 'medium');
    });

    it('should enforce trackCount bounds (min 3, max 25)', () => {
        const belowMin = validateAndSanitizeIntent({ trackCount: 1 });
        assert.strictEqual(belowMin.trackCount, 10); // resets to default if < 3

        const aboveMax = validateAndSanitizeIntent({ trackCount: 99 });
        assert.strictEqual(aboveMax.trackCount, 25);

        const valid = validateAndSanitizeIntent({ trackCount: 14 });
        assert.strictEqual(valid.trackCount, 14);

        const override = validateAndSanitizeIntent({ trackCount: 14 }, 20);
        assert.strictEqual(override.trackCount, 20);
    });

    it('should validate and sanitize string arrays and enums', () => {
        const raw = {
            intent: 'DISCOVERY_PLAYLIST',
            mood: '  energetic  ',
            languages: ['Tamil', '  English  ', '', 123],
            genres: ['rock', 'pop'],
            energy: 'HIGH',
            diversity: 'FOCUSED',
            excludedTerms: ['sad romance', 'slow acoustic'],
        };
        const sanitized = validateAndSanitizeIntent(raw);
        assert.strictEqual(sanitized.intent, 'discovery_playlist');
        assert.strictEqual(sanitized.mood, 'energetic');
        assert.deepStrictEqual(sanitized.languages, ['Tamil', 'English']);
        assert.strictEqual(sanitized.energy, 'high');
        assert.strictEqual(sanitized.diversity, 'focused');
        assert.deepStrictEqual(sanitized.excludedTerms, ['sad romance', 'slow acoustic']);
    });
});

describe('Deterministic Fallback Parser', () => {
    it('should parse "Play relaxing Tamil melodies from the 2000s"', () => {
        const result = parseDeterministicRequest('Play relaxing Tamil melodies from the 2000s');
        assert.strictEqual(result.mood, 'chill');
        assert.ok(result.languages.includes('Tamil'));
        assert.ok(result.eras.includes('2000s'));
        assert.ok(result.genres.includes('melody'));
        assert.ok(result.searchQueries.length >= 2);
        assert.ok(result.searchQueries.some(q => q.toLowerCase().includes('tamil')));
    });

    it('should parse "Give me energetic music for ranked gaming"', () => {
        const result = parseDeterministicRequest('Give me energetic music for ranked gaming');
        assert.strictEqual(result.energy, 'high');
        assert.strictEqual(result.mood, 'energetic');
        assert.ok(result.searchQueries.length >= 2);
    });

    it('should parse "Make a chill English indie playlist with 15 songs"', () => {
        const result = parseDeterministicRequest('Make a chill English indie playlist with 15 songs');
        assert.strictEqual(result.mood, 'chill');
        assert.ok(result.languages.includes('English'));
        assert.ok(result.genres.includes('indie'));
        assert.strictEqual(result.trackCount, 15);
    });

    it('should extract exclusions: "Give me upbeat songs without sad romantic tracks"', () => {
        const result = parseDeterministicRequest('Give me upbeat songs without sad romantic tracks');
        assert.strictEqual(result.mood, 'upbeat');
        assert.ok(result.excludedTerms.length > 0);
        assert.ok(result.excludedTerms.some(term => term.toLowerCase().includes('sad') || term.toLowerCase().includes('romantic')));
    });

    it('should detect similar-to-track intent with context', () => {
        const context = { title: 'Arabian Nights', author: 'Anirudh' };
        const result = parseDeterministicRequest('Find songs similar to the current track', null, context);
        assert.strictEqual(result.intent, 'similar_track');
        assert.ok(result.searchQueries.some(q => q.includes('Anirudh') || q.includes('Arabian Nights')));
    });
});

describe('AI Provider Factory & Fallback Handling', () => {
    it('should return null when AI_API_KEY is missing', () => {
        const provider = createAIProvider({ apiKey: '' });
        assert.strictEqual(provider, null);
    });

    it('should instantiate Gemini provider when configured', () => {
        const provider = createAIProvider({ apiKey: 'fake_key', provider: 'gemini' });
        assert.ok(provider instanceof BaseAIProvider);
        assert.strictEqual(provider.model, 'gemini-2.0-flash');
    });

    it('should instantiate OpenAI provider when configured', () => {
        const provider = createAIProvider({ apiKey: 'fake_key', provider: 'openai', model: 'gpt-4o-mini' });
        assert.ok(provider instanceof BaseAIProvider);
        assert.strictEqual(provider.model, 'gpt-4o-mini');
    });

    it('should pick up GEMINI_API_KEY from environment when AI_API_KEY is unset', () => {
        const originalAIKey = process.env.AI_API_KEY;
        const originalGeminiKey = process.env.GEMINI_API_KEY;
        try {
            delete process.env.AI_API_KEY;
            process.env.GEMINI_API_KEY = 'test_gemini_key_123';
            const provider = createAIProvider();
            assert.ok(provider instanceof BaseAIProvider);
            assert.strictEqual(provider.apiKey, 'test_gemini_key_123');
            assert.strictEqual(provider.model, 'gemini-2.0-flash');
        } finally {
            if (originalAIKey) process.env.AI_API_KEY = originalAIKey;
            else delete process.env.AI_API_KEY;
            if (originalGeminiKey) process.env.GEMINI_API_KEY = originalGeminiKey;
            else delete process.env.GEMINI_API_KEY;
        }
    });

    it('should pick up GOOGLE_API_KEY from environment when AI_API_KEY is unset', () => {
        const originalAIKey = process.env.AI_API_KEY;
        const originalGoogleKey = process.env.GOOGLE_API_KEY;
        try {
            delete process.env.AI_API_KEY;
            delete process.env.GEMINI_API_KEY;
            process.env.GOOGLE_API_KEY = 'test_google_key_456';
            const provider = createAIProvider();
            assert.ok(provider instanceof BaseAIProvider);
            assert.strictEqual(provider.apiKey, 'test_google_key_456');
            assert.strictEqual(provider.model, 'gemini-2.0-flash');
        } finally {
            if (originalAIKey) process.env.AI_API_KEY = originalAIKey;
            else delete process.env.AI_API_KEY;
            if (originalGoogleKey) process.env.GOOGLE_API_KEY = originalGoogleKey;
            else delete process.env.GOOGLE_API_KEY;
        }
    });
});
