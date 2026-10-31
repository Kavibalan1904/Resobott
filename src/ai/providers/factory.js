/**
 * AI Provider Factory
 * Resolves configured provider based on environment variables or returns null if disabled.
 */

const GeminiProvider = require('./geminiProvider');
const OpenAIProvider = require('./openAiProvider');

/**
 * Create an AI Provider instance based on environment variables
 * @param {object} [overrides] Optional configuration overrides
 * @returns {import('./baseProvider') | null}
 */
function createAIProvider(overrides = {}) {
    const rawKey = (
        overrides.apiKey ||
        process.env.AI_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.GEMINI_KEY ||
        ''
    ).trim();
    // Strip accidental surrounding quotes (e.g. 'key' or "key") from .env
    const apiKey = rawKey.replace(/^['"]+|['"]+$/g, '').trim();
    if (!apiKey) {
        return null; // AI disabled, deterministic fallback will handle all requests
    }

    const defaultProvider = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_KEY) ? 'gemini' : (process.env.AI_PROVIDER || 'gemini');
    const providerType = (overrides.provider || defaultProvider).trim().toLowerCase();
    const model = overrides.model || process.env.AI_MODEL || (providerType === 'gemini' ? 'gemini-3.8-flash' : 'gpt-4o-mini');
    const baseUrl = overrides.baseUrl || process.env.AI_BASE_URL || undefined;

    const config = {
        apiKey,
        model,
        baseUrl,
        timeoutMs: 12000,
    };

    switch (providerType) {
        case 'gemini':
            return new GeminiProvider(config);
        case 'openai':
        case 'groq':
        case 'openrouter':
            return new OpenAIProvider(config);
        default:
            console.warn(`[Reso AI] Unknown AI_PROVIDER "${providerType}", defaulting to Gemini.`);
            return new GeminiProvider(config);
    }
}

module.exports = {
    createAIProvider,
};
