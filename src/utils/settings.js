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

function getTimezone(guildId) {
    if (guildId && settings[guildId]?.timezone) {
        return settings[guildId].timezone;
    }
    return process.env.TIMEZONE || process.env.TZ || 'Asia/Kolkata';
}

function setTimezone(guildId, timezone) {
    if (!settings[guildId]) settings[guildId] = {};
    settings[guildId].timezone = timezone;
    saveSettings(true);
}

function removeTimezone(guildId) {
    if (settings[guildId] && settings[guildId].timezone) {
        delete settings[guildId].timezone;
        saveSettings(true);
    }
}

function hasSeenGuide(guildId) {
    if (!guildId) return true; // Don't prompt in DMs
    return Boolean(settings[guildId]?.hasSeenGuide);
}

function setHasSeenGuide(guildId, seen = true) {
    if (!guildId) return;
    if (!settings[guildId]) settings[guildId] = {};
    settings[guildId].hasSeenGuide = seen;
    saveSettings(true);
}

function resetHasSeenGuide(guildId) {
    if (settings[guildId] && settings[guildId].hasSeenGuide !== undefined) {
        delete settings[guildId].hasSeenGuide;
        saveSettings(true);
    }
}

function hasUserSeenGuide(userId) {
    if (!userId) return true;
    return Boolean(settings._users?.[userId]?.hasSeenGuide);
}

function setUserSeenGuide(userId, seen = true) {
    if (!userId) return;
    if (!settings._users) settings._users = {};
    if (!settings._users[userId]) settings._users[userId] = {};
    settings._users[userId].hasSeenGuide = seen;
    saveSettings(true);
}

function resetUserSeenGuide(userId) {
    if (settings._users?.[userId]?.hasSeenGuide !== undefined) {
        delete settings._users[userId].hasSeenGuide;
        saveSettings(true);
    }
}

// Initial load
loadSettings();

module.exports = {
    getDesignatedChannel,
    setDesignatedChannel,
    removeDesignatedChannel,
    isDesignatedChannel,
    getTimezone,
    setTimezone,
    removeTimezone,
    hasSeenGuide,
    setHasSeenGuide,
    resetHasSeenGuide,
    hasUserSeenGuide,
    setUserSeenGuide,
    resetUserSeenGuide,
};
