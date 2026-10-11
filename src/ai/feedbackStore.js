/**
 * Reso DJ Feedback & Personalisation Store
 * Lightweight storage for user/guild music preferences with file persistence & memory caching.
 */

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '../../dj_preferences.json');

class FeedbackStore {
    constructor() {
        this.cache = new Map(); // Key: `${guildId}:${userId}`, Value: { likes: Set, dislikes: Set }
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(STORE_PATH)) {
                const raw = fs.readFileSync(STORE_PATH, 'utf8');
                const data = JSON.parse(raw);
                for (const [key, val] of Object.entries(data)) {
                    this.cache.set(key, {
                        likes: new Set(val.likes || []),
                        dislikes: new Set(val.dislikes || []),
                    });
                }
            }
        } catch (err) {
            console.warn('[Reso DJ] Notice: Failed to load dj_preferences.json, using in-memory store:', err.message);
        }
    }

    save() {
        try {
            const serialized = {};
            for (const [key, val] of this.cache.entries()) {
                serialized[key] = {
                    likes: Array.from(val.likes).slice(-50), // Cap at 50 to bound file size
                    dislikes: Array.from(val.dislikes).slice(-50),
                };
            }
            fs.writeFileSync(STORE_PATH, JSON.stringify(serialized, null, 2), 'utf8');
        } catch (err) {
            console.warn('[Reso DJ] Notice: Failed to persist dj_preferences.json:', err.message);
        }
    }

    _getKey(guildId, userId) {
        return `${guildId || 'global'}:${userId || 'anon'}`;
    }

    getPreferences(guildId, userId) {
        const key = this._getKey(guildId, userId);
        const data = this.cache.get(key);
        if (!data) {
            return { likes: [], dislikes: [] };
        }
        return {
            likes: Array.from(data.likes),
            dislikes: Array.from(data.dislikes),
        };
    }

    addLike(guildId, userId, term) {
        if (!term || typeof term !== 'string') return;
        const clean = term.toLowerCase().trim().slice(0, 50);
        if (!clean) return;

        const key = this._getKey(guildId, userId);
        if (!this.cache.has(key)) {
            this.cache.set(key, { likes: new Set(), dislikes: new Set() });
        }
        const userPrefs = this.cache.get(key);
        userPrefs.dislikes.delete(clean);
        userPrefs.likes.add(clean);
        this.save();
    }

    addDislike(guildId, userId, term) {
        if (!term || typeof term !== 'string') return;
        const clean = term.toLowerCase().trim().slice(0, 50);
        if (!clean) return;

        const key = this._getKey(guildId, userId);
        if (!this.cache.has(key)) {
            this.cache.set(key, { likes: new Set(), dislikes: new Set() });
        }
        const userPrefs = this.cache.get(key);
        userPrefs.likes.delete(clean);
        userPrefs.dislikes.add(clean);
        this.save();
    }

    clearPreferences(guildId, userId = null) {
        if (userId) {
            const key = this._getKey(guildId, userId);
            this.cache.delete(key);
        } else {
            // Clear all users for this guild
            for (const key of Array.from(this.cache.keys())) {
                if (key.startsWith(`${guildId}:`)) {
                    this.cache.delete(key);
                }
            }
        }
        this.save();
    }
}

const feedbackStore = new FeedbackStore();

module.exports = {
    FeedbackStore,
    feedbackStore,
};
