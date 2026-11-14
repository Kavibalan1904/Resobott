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

function hasAnsweredGuide(id) {
    if (!id) return false;
    return Boolean(settings._users?.[id]?.hasAnsweredGuide || settings[id]?.hasAnsweredGuide);
}

function setAnsweredGuide(id, answered = true) {
    if (!id) return;
    if (!settings[id]) settings[id] = {};
    settings[id].hasAnsweredGuide = answered;
    if (!settings._users) settings._users = {};
    if (!settings._users[id]) settings._users[id] = {};
    settings._users[id].hasAnsweredGuide = answered;
    saveSettings(true);
}

function resetAnsweredGuide(id) {
    if (!id) return;
    if (settings[id] && settings[id].hasAnsweredGuide !== undefined) {
        delete settings[id].hasAnsweredGuide;
    }
    if (settings._users?.[id] && settings._users[id].hasAnsweredGuide !== undefined) {
        delete settings._users[id].hasAnsweredGuide;
    }
    saveSettings(true);
}

function resetAllAnsweredGuides() {
    if (settings._users) {
        for (const uid of Object.keys(settings._users)) {
            delete settings._users[uid].hasAnsweredGuide;
            delete settings._users[uid].hasSeenGuide;
        }
    }
    for (const gid of Object.keys(settings)) {
        if (gid === '_users') continue;
        delete settings[gid].hasAnsweredGuide;
        delete settings[gid].hasSeenGuide;
    }
    saveSettings(true);
}

// Aliases for backwards compatibility
function hasSeenGuide(guildId) {
    return hasAnsweredGuide(guildId);
}

function setHasSeenGuide(guildId, seen = true) {
    setAnsweredGuide(guildId, seen);
}

function resetHasSeenGuide(guildId) {
    resetAnsweredGuide(guildId);
}

function hasUserSeenGuide(userId) {
    return hasAnsweredGuide(userId);
}

function setUserSeenGuide(userId, seen = true) {
    setAnsweredGuide(userId, seen);
}

function resetUserSeenGuide(userId) {
    resetAnsweredGuide(userId);
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
    hasAnsweredGuide,
    setAnsweredGuide,
    resetAnsweredGuide,
    resetAllAnsweredGuides,
};
