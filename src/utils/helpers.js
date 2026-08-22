/**
 * Parse a time string like "1:30", "90", "1h30m" into seconds
 */
function parseTime(input) {
    if (!input) return null;
    const str = String(input).trim();

    // Pure seconds: "90"
    if (/^\d+$/.test(str)) return parseInt(str, 10);

    // MM:SS or HH:MM:SS
    if (/^(\d+:)?\d+:\d+$/.test(str)) {
        const parts = str.split(':').map(Number);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
    }

    // 1h30m, 2m30s, etc.
    let totalSeconds = 0;
    const hours = str.match(/(\d+)\s*h/i);
    const minutes = str.match(/(\d+)\s*m/i);
    const seconds = str.match(/(\d+)\s*s/i);
    if (hours) totalSeconds += parseInt(hours[1]) * 3600;
    if (minutes) totalSeconds += parseInt(minutes[1]) * 60;
    if (seconds) totalSeconds += parseInt(seconds[1]);
    return totalSeconds || null;
}

/**
 * Format seconds into HH:MM:SS or MM:SS
 */
function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Format milliseconds to readable time string (MM:SS or HH:MM:SS)
 */
function formatMs(ms) {
    if (!ms || isNaN(ms)) return '0:00';
    return formatTime(Math.floor(ms / 1000));
}

/**
 * Format milliseconds duration to readable string
 */
function formatDuration(ms) {
    return formatTime(Math.floor(ms / 1000));
}

/**
 * Format uptime from milliseconds
 */
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${secs}s`);
    return parts.join(' ');
}

/**
 * Check if user is in a voice channel and return it, or null
 */
function getVoiceChannel(interaction) {
    return interaction.member?.voice?.channel || null;
}

/**
 * Check if the bot is in the same voice channel as the user
 */
function isInSameVoiceChannel(interaction) {
    const voiceChannel = getVoiceChannel(interaction);
    if (!voiceChannel) return false;
    const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
    if (!player || !player.voiceChannelId) return true; // No player yet, so no conflict
    return player.voiceChannelId === voiceChannel.id;
}

/**
 * Truncate a string to a max length
 */
function truncate(str, maxLength = 50) {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
}

/**
 * Paginate an array
 */
function paginate(array, page = 1, perPage = 10) {
    const totalPages = Math.ceil(array.length / perPage) || 1;
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    const start = (currentPage - 1) * perPage;
    const items = array.slice(start, start + perPage);
    return { items, currentPage, totalPages, totalItems: array.length };
}

/**
 * Create a text-based progress bar for the currently playing track
 * @param {number} position Current position in ms
 * @param {number} duration Total duration in ms
 * @param {number} length Bar length (number of characters)
 * @returns {string} Progress bar string with timecodes
 */
function createProgressBar(position, duration, length = 15) {
    if (!duration || duration <= 0) return '🔴 Live Stream';
    const progress = Math.min(position / duration, 1);
    const filledLength = Math.round(progress * length);
    const bar = '▬'.repeat(filledLength) + '🔘' + '▬'.repeat(Math.max(0, length - filledLength - 1));
    return `${formatMs(position)} ${bar} ${formatMs(duration)}`;
}

// Track recent node playback/connection failures (nodeId -> timestamp ms)
const nodeErrorTimestamps = new Map();

/**
 * Record a node error timestamp to temporarily deprioritize it
 */
function markNodeError(nodeId) {
    if (!nodeId) return;
    nodeErrorTimestamps.set(nodeId, Date.now());
}

/**
 * Get connected Lavalink nodes, prioritizing nodes without recent errors (< 10 minutes)
 */
function getHealthyNodes(manager, excludeNodeId = null) {
    if (!manager || !manager.nodeManager) return [];

    const now = Date.now();
    const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes cooldown for errored nodes

    const connected = Array.from(manager.nodeManager.nodes.values())
        .filter(n => n.connected && n.id !== excludeNodeId);

    if (connected.length === 0) return [];

    // Filter nodes with no recent errors
    const errorFree = connected.filter(n => {
        const lastErr = nodeErrorTimestamps.get(n.id);
        return !lastErr || (now - lastErr > COOLDOWN_MS);
    });

    // Prefer error-free nodes if available, otherwise fallback to any connected node
    return errorFree.length > 0 ? errorFree : connected;
}

/**
 * Ensure player has a healthy, connected Lavalink node attached.
 * If current node is disconnected or recently errored, assigns an active healthy node.
 */
function ensurePlayerNode(player, client) {
    if (!player) return null;

    // If player already has a connected node, KEEP IT — switching player.node
    // while a voice session is active breaks audio playback and causes stuttering!
    if (player.node && player.node.connected) {
        return player.node;
    }

    const manager = client?.lavalink || player.lavalinkManager;
    if (!manager || !manager.nodeManager) return player.node || null;

    const healthyNodes = getHealthyNodes(manager);
    if (healthyNodes.length === 0) return player.node || null;

    // Pick first healthy node
    const chosenNode = healthyNodes[0];
    if (player.node?.id !== chosenNode.id) {
        console.log(`[Reso] ↝ Assigned connected node "${chosenNode.id}" to player (${player.guildId})`);
        if (typeof player.changeNode === 'function') {
            player.changeNode(chosenNode.id).catch(() => {});
        } else {
            player.node = chosenNode;
        }
    }
    return chosenNode;
}

module.exports = {
    parseTime,
    formatTime,
    formatMs,
    formatDuration,
    formatUptime,
    getVoiceChannel,
    isInSameVoiceChannel,
    truncate,
    paginate,
    createProgressBar,
    ensurePlayerNode,
    markNodeError,
    getHealthyNodes,
};
