/**
 * Reso Spotify-Style Voice DJ Service
 * Orchestrates charismatic radio DJ announcements with background pre-caching,
 * zero-delay deterministic fallback, and customizable voice modes.
 */

const { createAIProvider } = require('./providers/factory');
const { getVoiceDjSettings, setVoiceDjSettings } = require('../utils/settings');
const { cleanVideoTitle, truncate } = require('../utils/helpers');

// Rich, diverse zero-delay template bank for instant Spotify DJ radio lines
const DJ_TEMPLATES = {
    userRequested: [
        'Up next for {user}, we have {title} by {artist}. Let’s get into it!',
        'Coming up hot, requested by {user}: {title} by {artist}!',
        'Next up for {user}, here is {artist} with {title}. Turn this one up!',
        'Spinning this one for {user}: {title} by {artist}!',
        'Here is a great pick from {user}—{artist} with {title}!',
        'Shoutout to {user} for queuing this up: {title} by {artist}!',
        'Next in the mix for {user}, {title} by {artist}. Enjoy the sound!',
    ],
    autoplay: [
        'Keeping the vibe going with an autoplay selection: {title} by {artist}.',
        'Here is a fresh recommendation from Reso: {title} by {artist}!',
        'The session continues with {artist} performing {title}.',
        'Rolling right into {title} by {artist}—let’s keep the energy high!',
        'Here is another track matching your vibe: {title} by {artist}.',
    ],
    highEnergy: [
        'Turn up the speakers! Here comes {title} by {artist}!',
        'Bringing massive energy with {title} by {artist}!',
        'Drop the beat—here is {artist} with {title}!',
    ],
    chill: [
        'Slowing it down for a moment with {title} by {artist}. Enjoy the vibe.',
        'Here is a smooth selection: {title} by {artist}. Just sit back and listen.',
        'Mellow tunes ahead with {artist} and {title}.',
    ],
};

class VoiceDJService {
    constructor() {
        // Cache: trackKey -> { text: string, audioUrl: string, preparedAt: number }
        this.cache = new Map();
        this.inFlightGenerations = new Map(); // trackKey -> Promise
        this.playCounters = new Map();        // guildId -> number of played tracks
    }

    /**
     * Get guild Voice DJ settings
     */
    getSettings(guildId) {
        return getVoiceDjSettings(guildId);
    }

    /**
     * Update guild Voice DJ settings
     */
    updateSettings(guildId, patch) {
        return setVoiceDjSettings(guildId, patch);
    }

    /**
     * Check if Voice DJ is enabled for a guild
     */
    isEnabled(guildId) {
        const settings = this.getSettings(guildId);
        return Boolean(settings && settings.enabled);
    }

    /**
     * Check if the DJ should speak on this track based on frequency settings
     */
    shouldSpeakThisTurn(guildId, isUserRequested = true) {
        const settings = this.getSettings(guildId);
        if (!settings || !settings.enabled) return false;

        const freq = settings.frequency || 'every_2';
        if (freq === 'every') return true;
        if (freq === 'request_only') return isUserRequested;

        const currentCount = (this.playCounters.get(guildId) || 0) + 1;
        this.playCounters.set(guildId, currentCount);

        if (freq === 'every_2') {
            return currentCount % 2 === 1; // 1st, 3rd, 5th...
        }
        if (freq === 'every_3') {
            return currentCount % 3 === 1; // 1st, 4th, 7th...
        }

        return true;
    }

    /**
     * Create a track identifier key for caching
     */
    getTrackKey(guildId, track) {
        if (!track) return null;
        const uri = track.info?.uri || track.uri;
        const title = track.info?.title || track.title || 'unknown';
        return `${guildId}:${uri || title}`;
    }

    /**
     * Construct a Google Translate TTS URL
     * High reliability, MP3 format, zero external dependencies.
     */
    getTtsUrl(text, voiceSetting = 'radio') {
        const langMap = {
            radio: 'en-us',
            british: 'en-gb',
            chill: 'en-au',
            female: 'en-uk',
        };
        const lang = langMap[voiceSetting] || 'en-us';
        const cleanText = encodeURIComponent(String(text || '').slice(0, 180));
        return `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${cleanText}`;
    }

    /**
     * Generate an instant, deterministic radio line without calling external AI (0ms latency, zero failures)
     */
    generateDeterministicIntro(track, context = null) {
        const info = track?.info || track || {};
        const rawTitle = info.title || 'this track';
        const title = cleanVideoTitle(rawTitle) || rawTitle;
        const artist = info.author || 'Unknown Artist';

        const isAutoplay = track?.isAutoplay ?? (track?.requester?.id === 'autoplay');
        const requester = isAutoplay
            ? 'Autoplay'
            : (track?.requester?.username || track?.requester?.globalName || track?.requester?.tag || 'a listener');

        let pool = DJ_TEMPLATES.userRequested;
        if (isAutoplay) {
            pool = DJ_TEMPLATES.autoplay;
        } else if (context?.energy === 'high') {
            pool = DJ_TEMPLATES.highEnergy;
        } else if (context?.mood === 'chill' || context?.mood === 'relaxing') {
            pool = DJ_TEMPLATES.chill;
        }

        const template = pool[Math.floor(Math.random() * pool.length)];
        return template
            .replace('{user}', requester)
            .replace('{title}', truncate(title, 36))
            .replace('{artist}', truncate(artist, 26));
    }

    /**
     * Generate a charismatic AI radio announcement using Gemini 2.0 Flash or OpenAI
     * With strict 1800ms timeout and automatic fallback.
     */
    async generateAiIntro(track, context = null) {
        const provider = createAIProvider();
        if (!provider) {
            return this.generateDeterministicIntro(track, context);
        }

        const info = track?.info || track || {};
        const title = cleanVideoTitle(info.title || '') || info.title || 'this track';
        const artist = info.author || 'Unknown Artist';
        const isAutoplay = track?.isAutoplay ?? (track?.requester?.id === 'autoplay');
        const user = isAutoplay ? 'Autoplay' : (track?.requester?.username || 'a listener');

        const systemPrompt = [
            'You are Reso DJ, a smooth, charismatic radio DJ host just like Spotify AI DJ.',
            'Introduce the upcoming song to listeners in a single, punchy, conversational sentence.',
            'Keep it strictly under 14 words.',
            'Do NOT use quotation marks, emojis, or markdown.',
            'Mention the requester and the song title or artist naturally.',
        ].join(' ');

        const prompt = `Song: "${title}" by ${artist}. Requested by: ${user}. Give a quick 1-sentence radio host intro:`;

        try {
            // Strict 1800ms timeout for voice script to prevent waiting
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1800);

            const completionPromise = provider.generateCompletion({
                prompt,
                systemPrompt,
                schema: false, // requests plain text
            });

            const timeoutPromise = new Promise((_, reject) => {
                controller.signal.addEventListener('abort', () => reject(new Error('AI DJ timeout exceeded (1800ms)')));
            });

            const rawResult = await Promise.race([completionPromise, timeoutPromise]);
            clearTimeout(timeoutId);

            if (typeof rawResult === 'string' && rawResult.trim().length > 0) {
                // Sanitize output
                const cleaned = rawResult
                    .replace(/^["'`]+|["'`]+$/g, '')
                    .replace(/[#*_~]+/g, '')
                    .trim();
                return cleaned.slice(0, 160);
            }
        } catch (err) {
            // Silent fallback to guarantee zero delay and zero failure
        }

        return this.generateDeterministicIntro(track, context);
    }

    /**
     * Background Pre-caching:
     * Asynchronously pre-generates the DJ announcement for the upcoming track
     * while the current track is playing.
     */
    async prepareUpcomingAnnouncement(guildId, nextTrack, context = null) {
        if (!guildId || !nextTrack) return;
        const trackKey = this.getTrackKey(guildId, nextTrack);
        if (!trackKey) return;

        // Already cached?
        if (this.cache.has(trackKey)) return;

        // Already generating in background?
        if (this.inFlightGenerations.has(trackKey)) return;

        const settings = this.getSettings(guildId);
        const voiceSetting = settings.voice || 'radio';

        const genPromise = (async () => {
            try {
                const text = await this.generateAiIntro(nextTrack, context);
                const audioUrl = this.getTtsUrl(text, voiceSetting);
                const entry = {
                    text,
                    audioUrl,
                    preparedAt: Date.now(),
                };
                this.cache.set(trackKey, entry);

                // Housekeeping: limit cache to 100 entries
                if (this.cache.size > 100) {
                    const firstKey = this.cache.keys().next().value;
                    this.cache.delete(firstKey);
                }
                return entry;
            } finally {
                this.inFlightGenerations.delete(trackKey);
            }
        })();

        this.inFlightGenerations.set(trackKey, genPromise);
    }

    /**
     * Get the announcement for the current track (retrieves cached entry or generates instantly)
     */
    async getOrGenerateAnnouncement(guildId, track, context = null) {
        if (!guildId || !track) return null;
        const trackKey = this.getTrackKey(guildId, track);

        // 1. Check if cached from background pre-caching
        if (trackKey && this.cache.has(trackKey)) {
            const cached = this.cache.get(trackKey);
            // Delete after use so repeat loops get fresh intros
            this.cache.delete(trackKey);
            return cached;
        }

        // 2. Check if currently generating in flight
        if (trackKey && this.inFlightGenerations.has(trackKey)) {
            try {
                // Wait briefly for in-flight generation
                const res = await Promise.race([
                    this.inFlightGenerations.get(trackKey),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Inflight timeout')), 800)),
                ]);
                if (res) {
                    this.cache.delete(trackKey);
                    return res;
                }
            } catch {
                // Fall through to instant deterministic fallback
            }
        }

        // 3. Instant Zero-Delay Fallback
        const settings = this.getSettings(guildId);
        const voiceSetting = settings.voice || 'radio';
        const text = this.generateDeterministicIntro(track, context);
        const audioUrl = this.getTtsUrl(text, voiceSetting);

        return {
            text,
            audioUrl,
            preparedAt: Date.now(),
        };
    }
}

const voiceDjService = new VoiceDJService();

module.exports = {
    voiceDjService,
    VoiceDJService,
    DJ_TEMPLATES,
};
