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

            // Filter models supporting generateContent, text output, and not TTS/audio/image-only
            const usable = models.filter(m => {
                const name = (m.name || '').replace(/^models\//, '').toLowerCase();
                const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
                if (!methods.includes('generateContent')) return false;
                if (triedModels.has(name)) return false;

                // Exclude audio/TTS/image/embedding models that reject text output
                if (name.includes('tts') || name.includes('audio') || name.includes('imagen') || name.includes('embedding') || name.includes('robotics')) {
                    return false;
                }

                if (Array.isArray(m.supportedOutputModalities) && !m.supportedOutputModalities.includes('TEXT')) {
                    return false;
                }

                return true;
            });
            if (usable.length === 0) return null;

            // Prioritize standard stable text flash/pro models
            const candidate = usable.find(m => m.name?.includes('3.8-flash'))
                || usable.find(m => m.name?.includes('1.5-flash'))
                || usable.find(m => m.name?.includes('1.5-pro'))
                || usable.find(m => m.name?.includes('flash') && !m.name?.includes('tts') && !m.name?.includes('audio'))
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
    async generateCompletion({ prompt, systemPrompt, schema }, triedModels = new Set()) {
        if (!this.apiKey) {
            throw new Error('Gemini API key is not configured');
        }

        const fallbackCandidates = [
            'gemini-3.8-flash',
            'gemini-1.5-flash',
            'gemini-1.5-pro',
            'gemini-2.5-flash',
        ];

        const cleanModel = this.model.replace(/^models\//, '');
        triedModels.add(cleanModel);
        const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

        const wantsJson = schema !== false && schema !== null;

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
                ...(wantsJson ? { responseMimeType: 'application/json' } : {}),
            },
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
            ],
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

                    // Model compatibility handler: 404 (model deprecated) or 400 (modality/audio-only model like TTS)
                    const isUnsupportedModel = status === 404 || (status === 400 && (errorBody.includes('modality') || errorBody.includes('modalities') || errorBody.includes('not supported by the model')));

                    if (isUnsupportedModel) {
                        console.warn(`[Reso AI] Gemini model "${cleanModel}" is unsupported (${errorBody}). Finding next text model...`);
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
                                    if (e.message?.includes('404') || e.message?.includes('modality') || e.message?.includes('modalities')) continue;
                                    throw e;
                                }
                            }
                        }
                    }

                    // 400 Bad Request handler: retry without safetySettings if rejected by free-tier
                    if (status === 400 && attempt < maxAttempts) {
                        console.warn(`[Reso AI] Gemini returned 400 (${errorBody}). Retrying without safetySettings...`);
                        delete bodyPayload.safetySettings;
                        continue;
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

                if (candidate.finishReason === 'SAFETY') {
                    throw new Error('Gemini generation was blocked by safety filters');
                }

                const rawText = candidate.content?.parts?.[0]?.text;
                if (!rawText) {
                    throw new Error(`Gemini candidate returned no text (finishReason: ${candidate.finishReason || 'unknown'})`);
                }

                const trimmed = rawText.trim();
                if (!wantsJson) {
                    return trimmed;
                }

                // Parse structured JSON with robust cleanup
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
