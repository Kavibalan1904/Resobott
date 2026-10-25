const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '../../settings.json');

let settings = {};

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const data = fs.readFileSync(SETTINGS_PATH, 'utf8');
            settings = JSON.parse(data);
        }
    } catch (err) {
        console.error('[Reso] Error loading settings.json:', err);
    }
}

let saveTimer = null;
let isWriting = false;

function saveSettings(immediate = false) {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }

    if (immediate) {
        try {
            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
        } catch (err) {
            console.error('[Reso] Error saving settings.json:', err);
        }
        return;
    }

    saveTimer = setTimeout(async () => {
        if (isWriting) {
            saveSettings();
            return;
        }
        isWriting = true;
        try {
            await fs.promises.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
        } catch (err) {
            console.error('[Reso] Error saving settings.json:', err);
        } finally {
            isWriting = false;
        }
    }, 250);
}

function isDesignatedChannel(guildId, channelId) {
    const designated = getDesignatedChannel(guildId);
    if (!designated) return true;
    return designated === channelId;
}

function getDesignatedChannel(guildId) {
    if (!settings[guildId]) return null;
    return settings[guildId].designatedChannel || null;
}

function setDesignatedChannel(guildId, channelId) {
    if (!settings[guildId]) settings[guildId] = {};
    settings[guildId].designatedChannel = channelId;
    saveSettings(true);
}

function removeDesignatedChannel(guildId) {
    if (settings[guildId] && settings[guildId].designatedChannel) {
        delete settings[guildId].designatedChannel;
        saveSettings(true);
    }
}

function getVoiceDjSettings(guildId) {
    const defaultSettings = {
        enabled: false,
        mode: 'both',       // 'both' (voice + embed), 'voice', or 'text'
        frequency: 'every_2', // 'every', 'every_2', 'every_3', 'request_only'
        voice: 'radio',     // 'radio', 'british', 'chill', 'female'
    };
    if (!settings[guildId] || !settings[guildId].voiceDj) {
        return defaultSettings;
    }
    return { ...defaultSettings, ...settings[guildId].voiceDj };
}

function setVoiceDjSettings(guildId, patch = {}) {
    if (!settings[guildId]) settings[guildId] = {};
    settings[guildId].voiceDj = {
        ...getVoiceDjSettings(guildId),
        ...patch,
    };
    saveSettings(true);
    return settings[guildId].voiceDj;
}

// Initial load
loadSettings();

module.exports = {
    getDesignatedChannel,
    setDesignatedChannel,
    removeDesignatedChannel,
    isDesignatedChannel,
    getVoiceDjSettings,
    setVoiceDjSettings,
};
