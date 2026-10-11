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
    const apiKey = (overrides.apiKey || process.env.AI_API_KEY || '').trim();
    if (!apiKey) {
        return null; // AI disabled, deterministic fallback will handle all requests
    }

    const providerType = (overrides.provider || process.env.AI_PROVIDER || 'gemini').trim().toLowerCase();
    const model = overrides.model || process.env.AI_MODEL || (providerType === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini');
    const baseUrl = overrides.baseUrl || process.env.AI_BASE_URL || undefined;

    const config = {
        apiKey,
        model,
        baseUrl,
        timeoutMs: 8000,
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
