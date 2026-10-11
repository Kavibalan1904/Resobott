/**
 * Google Gemini Provider Adapter for Reso DJ
 * Communicates directly with the Gemini REST API using native fetch.
 */

const BaseAIProvider = require('./baseProvider');

class GeminiProvider extends BaseAIProvider {
    constructor(config = {}) {
        super(config);
        this.model = config.model || 'gemini-2.5-flash';
        this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com';
    }

    /**
     * Dynamically discover active models supported by this API key
     * @returns {Promise<string | null>}
     */
    async discoverAvailableModel() {
        try {
            const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/v1beta/models?key=${encodeURIComponent(this.apiKey)}`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);
            const res = await fetch(endpoint, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!res.ok) return null;
            const data = await res.json();
            const models = Array.isArray(data?.models) ? data.models : [];

            // Filter models supporting generateContent
            const usable = models.filter(m =>
                Array.isArray(m.supportedGenerationMethods) &&
                m.supportedGenerationMethods.includes('generateContent')
            );
            if (usable.length === 0) return null;

            // Priority: flash models first, then pro, then anything available
            const candidate = usable.find(m => m.name?.includes('2.5-flash'))
                || usable.find(m => m.name?.includes('2.0-flash'))
                || usable.find(m => m.name?.includes('3.8-flash'))
                || usable.find(m => m.name?.includes('flash-lite'))
                || usable.find(m => m.name?.includes('flash'))
                || usable.find(m => m.name?.includes('pro'))
                || usable[0];

            if (candidate?.name) {
                return candidate.name.replace(/^models\//, '');
            }
        } catch {
            // Ignore error, will fallback to candidate list
        }
        return null;
    }

    /**
     * Call Gemini generateContent API
     */
    async generateCompletion({ prompt, systemPrompt, schema }) {
        if (!this.apiKey) {
            throw new Error('Gemini API key is not configured');
        }

        const fallbackCandidates = [
            'gemini-2.5-flash',
            'gemini-2.0-flash',
            'gemini-2.0-flash-lite',
            'gemini-1.5-flash-latest',
            'gemini-1.5-flash',
            'gemini-pro',
        ];

        const cleanModel = this.model.replace(/^models\//, '');
        const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

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

                    // 404 handler: Auto-discover active models and retry
                    if (status === 404 && attempt === 1) {
                        console.warn(`[Reso AI] Gemini model "${cleanModel}" returned 404 (${errorBody}). Auto-discovering available models...`);
                        const discovered = await this.discoverAvailableModel();
                        if (discovered && discovered !== cleanModel) {
                            console.log(`[Reso AI] ✓ Discovered available model "${discovered}". Switching and retrying...`);
                            this.model = discovered;
                            return this.generateCompletion({ prompt, systemPrompt, schema });
                        }

                        // Try static candidate list
                        for (const alt of fallbackCandidates) {
                            if (alt !== cleanModel) {
                                console.log(`[Reso AI] Trying fallback candidate model "${alt}"...`);
                                this.model = alt;
                                try {
                                    return await this.generateCompletion({ prompt, systemPrompt, schema });
                                } catch (e) {
                                    if (e.message?.includes('404')) continue;
                                    throw e;
                                }
                            }
                        }
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
