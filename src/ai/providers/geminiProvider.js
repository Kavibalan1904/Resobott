/**
 * Google Gemini Provider Adapter for Reso DJ
 * Communicates directly with the Gemini REST API using native fetch.
 */

const BaseAIProvider = require('./baseProvider');

class GeminiProvider extends BaseAIProvider {
    constructor(config = {}) {
        super(config);
        this.model = config.model || 'gemini-3.8-flash';
        this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com';
    }

    /**
     * Dynamically discover active models supported by this API key
     * @param {Set<string>} [triedModels]
     * @returns {Promise<string | null>}
     */
    async discoverAvailableModel(triedModels = new Set()) {
        try {
            const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/v1beta/models?key=${encodeURIComponent(this.apiKey)}`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);
            const res = await fetch(endpoint, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!res.ok) return null;
            const data = await res.json();
            const models = Array.isArray(data?.models) ? data.models : [];

            // Filter models supporting generateContent and not already tried
            const usable = models.filter(m => {
                const name = (m.name || '').replace(/^models\//, '');
                return Array.isArray(m.supportedGenerationMethods) &&
                    m.supportedGenerationMethods.includes('generateContent') &&
                    !triedModels.has(name);
            });
            if (usable.length === 0) return null;

            // Filter out deprecated versions: 1.5, 2.0, 2.5
            const notDeprecated = usable.filter(m =>
                !m.name?.includes('1.5') &&
                !m.name?.includes('2.0') &&
                !m.name?.includes('2.5')
            );
            const pool = notDeprecated.length > 0 ? notDeprecated : usable;

            // Priority: 3.8-flash first, then 3.5-flash-lite, then 3.x, then flash
            const candidate = pool.find(m => m.name?.includes('3.8-flash'))
                || pool.find(m => m.name?.includes('3.5-flash-lite'))
                || pool.find(m => m.name?.includes('3.8'))
                || pool.find(m => m.name?.includes('3.6-flash'))
                || pool.find(m => m.name?.includes('flash'))
                || pool.find(m => m.name?.includes('pro'))
                || pool[0];

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
    async generateCompletion({ prompt, systemPrompt, schema }, triedModels = new Set()) {
        if (!this.apiKey) {
            throw new Error('Gemini API key is not configured');
        }

        const fallbackCandidates = [
            'gemini-3.8-flash',
            'gemini-3.5-flash-lite',
            'gemini-3.6-flash',
            'gemini-2.5-flash',
            'gemini-2.0-flash',
        ];

        const cleanModel = this.model.replace(/^models\//, '');
        triedModels.add(cleanModel);
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
                maxOutputTokens: 2048,
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

                    // 404 handler: Auto-discover active models and retry (preventing infinite loops)
                    if (status === 404) {
                        console.warn(`[Reso AI] Gemini model "${cleanModel}" returned 404 (${errorBody}). Finding active model...`);
                        const discovered = await this.discoverAvailableModel(triedModels);
                        if (discovered && !triedModels.has(discovered)) {
                            console.log(`[Reso AI] ✓ Switching to active model "${discovered}"...`);
                            this.model = discovered;
                            return this.generateCompletion({ prompt, systemPrompt, schema }, triedModels);
                        }

                        // Try static candidate list that hasn't been tried yet
                        for (const alt of fallbackCandidates) {
                            if (!triedModels.has(alt)) {
                                console.log(`[Reso AI] Trying fallback candidate model "${alt}"...`);
                                this.model = alt;
                                try {
                                    return await this.generateCompletion({ prompt, systemPrompt, schema }, triedModels);
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

                // Parse structured JSON with robust cleanup
                const trimmed = rawText.trim();
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
