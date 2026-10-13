/**
 * Reso Smart Autoplay — Persistence & Feedback Store
 * Stores guild-isolated autoplay preferences, modes, and feedback with disk persistence.
 */

const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '../../autoplay_settings.json');

class AutoplayStore {
    constructor() {
        this.guildSettings = new Map(); // guildId -> { enabled, mode, likes: Set, dislikes: Set }
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(STORE_FILE)) {
                const raw = fs.readFileSync(STORE_FILE, 'utf8');
                if (raw && raw.trim()) {
                    const parsed = JSON.parse(raw);
                    for (const [guildId, val] of Object.entries(parsed)) {
                        this.guildSettings.set(guildId, {
                            enabled: Boolean(val.enabled),
                            mode: val.mode || 'Balanced',
                            likes: new Set(val.likes || []),
                            dislikes: new Set(val.dislikes || []),
                        });
                    }
                }
            }
        } catch (err) {
            console.warn('[Autoplay] Notice: Failed to load autoplay_settings.json, using in-memory store:', err.message);
        }
    }

    save() {
        try {
            const serialized = {};
            for (const [guildId, val] of this.guildSettings.entries()) {
                serialized[guildId] = {
                    enabled: val.enabled,
                    mode: val.mode,
                    likes: Array.from(val.likes).slice(-50), // Cap at 50 entries
                    dislikes: Array.from(val.dislikes).slice(-50),
                };
            }
            fs.writeFileSync(STORE_FILE, JSON.stringify(serialized, null, 2), 'utf8');
        } catch (err) {
            console.warn('[Autoplay] Notice: Failed to persist autoplay_settings.json:', err.message);
        }
    }

    getSettings(guildId) {
        if (!this.guildSettings.has(guildId)) {
            this.guildSettings.set(guildId, {
                enabled: false,
                mode: 'Balanced',
                likes: new Set(),
                dislikes: new Set(),
            });
        }
        return this.guildSettings.get(guildId);
    }

    setEnabled(guildId, enabled) {
        const settings = this.getSettings(guildId);
        settings.enabled = Boolean(enabled);
        this.save();
    }

    isEnabled(guildId) {
        return Boolean(this.getSettings(guildId).enabled);
    }

    setMode(guildId, mode) {
        const validModes = ['Balanced', 'Familiar', 'Discovery', 'Artist Focus', 'Session Focus'];
        if (!validModes.includes(mode)) {
            throw new Error(`Invalid autoplay mode: ${mode}. Valid modes: ${validModes.join(', ')}`);
        }
        const settings = this.getSettings(guildId);
        settings.mode = mode;
        this.save();
    }

    getMode(guildId) {
        return this.getSettings(guildId).mode || 'Balanced';
    }

    addLike(guildId, term) {
        if (!term || typeof term !== 'string') return;
        const clean = term.toLowerCase().trim().slice(0, 60);
        if (!clean) return;

        const settings = this.getSettings(guildId);
        settings.dislikes.delete(clean);
        settings.likes.add(clean);
        this.save();
    }

    addDislike(guildId, term) {
        if (!term || typeof term !== 'string') return;
        const clean = term.toLowerCase().trim().slice(0, 60);
        if (!clean) return;

        const settings = this.getSettings(guildId);
        settings.likes.delete(clean);
        settings.dislikes.add(clean);
        this.save();
    }

    clearGuildData(guildId) {
        this.guildSettings.delete(guildId);
        this.save();
    }
}

const autoplayStore = new AutoplayStore();

module.exports = {
    AutoplayStore,
    autoplayStore,
};
