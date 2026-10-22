const fs = require('fs');
const path = require('path');

const PLAYLISTS_PATH = path.join(__dirname, '../../playlists.json');

// Memory store: { [userId]: { [playlistKey]: { name, createdAt, updatedAt, tracks: [] } } }
let playlists = {};

function loadPlaylists() {
    try {
        if (fs.existsSync(PLAYLISTS_PATH)) {
            const data = fs.readFileSync(PLAYLISTS_PATH, 'utf8');
            playlists = JSON.parse(data);
        }
    } catch (err) {
        console.error('[Reso] Error loading playlists.json:', err);
        playlists = {};
    }
}

function savePlaylists() {
    try {
        fs.writeFileSync(PLAYLISTS_PATH, JSON.stringify(playlists, null, 2), 'utf8');
    } catch (err) {
        console.error('[Reso] Error saving playlists.json:', err);
    }
}

/**
 * Save a playlist for a user
 * @param {string} userId - Discord User ID
 * @param {string} name - Playlist name
 * @param {Array<object>} tracks - Serialized track items
 * @returns {object} The saved playlist object
 */
function savePlaylist(userId, name, tracks) {
    if (!userId) throw new Error('User ID is required');
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new Error('Playlist name cannot be empty');
    }

    const trimmedName = name.trim().slice(0, 50);
    const key = trimmedName.toLowerCase();

    if (!playlists[userId]) {
        playlists[userId] = {};
    }

    const existing = playlists[userId][key];
    const playlistData = {
        name: trimmedName,
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
        tracks: tracks || [],
    };

    playlists[userId][key] = playlistData;
    savePlaylists();
    return playlistData;
}

/**
 * Get a user's playlist by name (case-insensitive)
 * @param {string} userId - Discord User ID
 * @param {string} name - Playlist name
 * @returns {object|null} The playlist object or null
 */
function getPlaylist(userId, name) {
    if (!userId || !name || !playlists[userId]) return null;
    const key = name.trim().toLowerCase();
    return playlists[userId][key] || null;
}

/**
 * Get all playlists for a user
 * @param {string} userId - Discord User ID
 * @returns {Array<object>} List of playlists with metadata
 */
function getUserPlaylists(userId) {
    if (!userId || !playlists[userId]) return [];
    return Object.values(playlists[userId]).map(pl => ({
        name: pl.name,
        trackCount: Array.isArray(pl.tracks) ? pl.tracks.length : 0,
        createdAt: pl.createdAt,
        updatedAt: pl.updatedAt,
    }));
}

/**
 * Delete a user's playlist by name
 * @param {string} userId - Discord User ID
 * @param {string} name - Playlist name
 * @returns {boolean} True if deleted, false if not found
 */
function deletePlaylist(userId, name) {
    if (!userId || !name || !playlists[userId]) return false;
    const key = name.trim().toLowerCase();
    if (playlists[userId][key]) {
        delete playlists[userId][key];
        savePlaylists();
        return true;
    }
    return false;
}

// Initial load
loadPlaylists();

module.exports = {
    savePlaylist,
    getPlaylist,
    getUserPlaylists,
    deletePlaylist,
    loadPlaylists,
};
