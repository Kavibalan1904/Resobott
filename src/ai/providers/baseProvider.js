/**
 * Base AI Provider Interface
 */

class BaseAIProvider {
    /**
     * @param {object} config
     * @param {string} config.apiKey
     * @param {string} [config.model]
     * @param {string} [config.baseUrl]
     * @param {number} [config.timeoutMs]
     */
    constructor(config = {}) {
        this.apiKey = config.apiKey || '';
        this.model = config.model || '';
        this.baseUrl = config.baseUrl || '';
        this.timeoutMs = config.timeoutMs || 8000;
    }

    /**
     * Generate completion adhering to JSON schema
     * @param {object} options
     * @param {string} options.prompt
     * @param {string} options.systemPrompt
     * @param {object} [options.schema]
     * @returns {Promise<object>} Parsed JSON output
     */
    async generateCompletion(options) {
        throw new Error('generateCompletion() must be implemented by subclass');
    }
}

module.exports = BaseAIProvider;
