/**
 * Google Gemini Provider Adapter for Reso DJ
 * Communicates directly with the Gemini REST API using native fetch.
 */

const BaseAIProvider = require('./baseProvider');

class GeminiProvider extends BaseAIProvider {
    constructor(config = {}) {
        super(config);
        this.model = config.model || 'gemini-1.5-flash';
        this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com';
    }

    /**
     * Call Gemini generateContent API
     */
    async generateCompletion({ prompt, systemPrompt, schema }) {
        if (!this.apiKey) {
            throw new Error('Gemini API key is not configured');
        }

        const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

        const bodyPayload = {
            contents: [
                {
                    role: 'user',
                    parts: [{ text: prompt }],
                },
            ],
            systemInstruction: systemPrompt ? {
                parts: [{ text: systemPrompt }],
            } : undefined,
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 600,
                responseMimeType: 'application/json',
            },
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

                    // Transient errors (503, 429) can retry once
                    if ((status === 503 || status === 429) && attempt < maxAttempts) {
                        console.warn(`[Reso AI] Gemini transient error (${status}). Retrying once...`);
                        await new Promise(r => setTimeout(r, 1000));
                        continue;
                    }

                    throw new Error(`Gemini API returned status ${status}: ${errorBody}`);
                }

                const data = await response.json();
                const candidate = data.candidates?.[0];
                if (!candidate) {
                    throw new Error('Gemini returned empty candidate response');
                }

                const rawText = candidate.content?.parts?.[0]?.text;
                if (!rawText) {
                    throw new Error('Gemini candidate returned no text');
                }

                // Parse structured JSON
                try {
                    return JSON.parse(rawText.trim());
                } catch (parseErr) {
                    // Strip potential markdown code blocks (e.g. ```json ... ```)
                    const cleaned = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
                    return JSON.parse(cleaned);
                }
            } catch (err) {
                clearTimeout(timeoutId);
                if (err.name === 'AbortError') {
                    lastError = new Error(`Gemini request timed out after ${this.timeoutMs}ms`);
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

        throw lastError || new Error('Gemini completion failed');
    }
}

module.exports = GeminiProvider;
