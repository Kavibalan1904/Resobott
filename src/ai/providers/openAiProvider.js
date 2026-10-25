/**
 * OpenAI / Compatible Provider Adapter for Reso DJ
 * Works with OpenAI, Groq, OpenRouter, Mistral, Ollama, etc.
 */

const BaseAIProvider = require('./baseProvider');

class OpenAIProvider extends BaseAIProvider {
    constructor(config = {}) {
        super(config);
        this.model = config.model || 'gpt-4o-mini';
        this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    }

    async generateCompletion({ prompt, systemPrompt, schema }) {
        if (!this.apiKey) {
            throw new Error('OpenAI API key is not configured');
        }

        const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;

        const messages = [];
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push({ role: 'user', content: prompt });

        const wantsJson = schema !== false && schema !== null;
        const bodyPayload = {
            model: this.model,
            messages,
            temperature: 0.3,
            max_tokens: 2048,
            ...(wantsJson ? { response_format: { type: 'json_object' } } : {}),
        };

        const maxAttempts = 2;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`,
                    },
                    body: JSON.stringify(bodyPayload),
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    const status = response.status;
                    let errorBody = '';
                    try {
                        const errJson = await response.json();
                        errorBody = errJson?.error?.message || response.statusText;
                    } catch {
                        errorBody = response.statusText;
                    }

                    if ((status === 503 || status === 429) && attempt < maxAttempts) {
                        console.warn(`[Reso AI] OpenAI transient error (${status}). Retrying once...`);
                        await new Promise(r => setTimeout(r, 1000));
                        continue;
                    }

                    throw new Error(`OpenAI API returned status ${status}: ${errorBody}`);
                }

                const data = await response.json();
                const choice = data.choices?.[0];
                const rawText = choice?.message?.content;
                if (!rawText) {
                    throw new Error('OpenAI returned empty message content');
                }

                const trimmed = rawText.trim();
                if (!wantsJson) {
                    return trimmed;
                }
                try {
                    return JSON.parse(trimmed);
                } catch (parseErr) {
                    const cleaned = trimmed
                        .replace(/^```(?:json)?\s*/i, '')
                        .replace(/\s*```$/i, '')
                        .trim();
                    try {
                        return JSON.parse(cleaned);
                    } catch {
                        const start = cleaned.indexOf('{');
                        const end = cleaned.lastIndexOf('}');
                        if (start !== -1 && end > start) {
                            return JSON.parse(cleaned.slice(start, end + 1));
                        }
                        throw parseErr;
                    }
                }
            } catch (err) {
                clearTimeout(timeoutId);
                if (err.name === 'AbortError') {
                    lastError = new Error(`OpenAI request timed out after ${this.timeoutMs}ms`);
                } else {
                    lastError = err;
                }

                if (attempt < maxAttempts && (err.name === 'AbortError' || err.message?.includes('fetch failed'))) {
                    await new Promise(r => setTimeout(r, 800));
                    continue;
                }
                break;
            }
        }

        throw lastError || new Error('OpenAI completion failed');
    }
}

module.exports = OpenAIProvider;
