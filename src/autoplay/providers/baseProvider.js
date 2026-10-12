/**
 * Reso Smart Autoplay — Base Candidate Provider
 */

class BaseCandidateProvider {
    constructor(name, timeoutMs = 6500) {
        this.name = name;
        this.timeoutMs = timeoutMs;
    }

    /**
     * Fetch candidates for given seed and context
     * @param {object} player Lavalink player
     * @param {object} seedTrack Seed track
     * @param {object} context ListeningSessionContext
     * @returns {Promise<Array<object>>}
     */
    async getCandidates(player, seedTrack, context) {
        throw new Error('getCandidates must be implemented by subclass');
    }

    /**
     * Wrap execution in a timeout guarantee
     * @param {Promise<any>} promise 
     * @returns {Promise<any>}
     */
    async withTimeout(promise) {
        let timeoutHandle;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
                reject(new Error(`[Autoplay] Provider "${this.name}" timed out after ${this.timeoutMs}ms`));
            }, this.timeoutMs);
        });

        try {
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            clearTimeout(timeoutHandle);
        }
    }
}

module.exports = { BaseCandidateProvider };
