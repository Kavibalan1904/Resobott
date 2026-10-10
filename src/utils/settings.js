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

function saveSettings() {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
    } catch (err) {
        console.error('[Reso] Error saving settings.json:', err);
    }
}

function getDesignatedChannel(guildId) {
    if (!settings[guildId]) return null;
    return settings[guildId].designatedChannel || null;
}

function setDesignatedChannel(guildId, channelId) {
    if (!settings[guildId]) settings[guildId] = {};
    settings[guildId].designatedChannel = channelId;
    saveSettings();
}

function removeDesignatedChannel(guildId) {
    if (settings[guildId] && settings[guildId].designatedChannel) {
        delete settings[guildId].designatedChannel;
        saveSettings();
    }
}

// Initial load
loadSettings();

module.exports = {
    getDesignatedChannel,
    setDesignatedChannel,
    removeDesignatedChannel
};
