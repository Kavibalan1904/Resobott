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
 * Validate that the bot has permissions to join and speak in a voice channel
 * @param {object} voiceChannel - Discord Voice/Stage channel
 * @param {object} clientUser - Discord ClientUser
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkVoicePermissions(voiceChannel, clientUser) {
    if (!voiceChannel || !clientUser) return { allowed: true };
    const permissions = voiceChannel.permissionsFor(clientUser);
    if (!permissions) return { allowed: true };

    const { PermissionsBitField } = require('discord.js');
    if (!permissions.has(PermissionsBitField.Flags.ViewChannel)) {
        return { allowed: false, reason: 'I cannot view or access that voice channel! Please check channel permissions.' };
    }
    if (!permissions.has(PermissionsBitField.Flags.Connect)) {
        return { allowed: false, reason: 'I do not have permission to **Connect** to your voice channel!' };
    }
    if (!permissions.has(PermissionsBitField.Flags.Speak)) {
        return { allowed: false, reason: 'I do not have permission to **Speak** in your voice channel!' };
    }
    if (voiceChannel.full && !permissions.has(PermissionsBitField.Flags.MoveMembers) && !permissions.has(PermissionsBitField.Flags.Administrator)) {
        return { allowed: false, reason: 'The voice channel is full and has reached its user limit!' };
    }
    return { allowed: true };
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

// ── PRIMARY NODE ID — this is the "sticky" main node ──
// Players should ALWAYS use this node when it's connected.
// Backup nodes are only used when the primary is DOWN.
const PRIMARY_NODE_ID = 'primary-main';

// Track recent node playback/connection failures (nodeId -> timestamp ms)
const nodeErrorTimestamps = new Map();

// Track measured HTTP probe latencies (nodeId -> { latencyMs, timestamp })
const nodeProbeLatencies = new Map();

/**
 * Record a node error timestamp to temporarily deprioritize it
 */
function markNodeError(nodeId) {
    if (!nodeId) return;
    nodeErrorTimestamps.set(nodeId, Date.now());
}

/**
 * Probe a single node's latency by doing a timed HTTP GET to /v4/info.
 * Falls back to heartBeatPing if the HTTP probe fails.
 * @param {object} node - LavalinkNode instance
 * @returns {Promise<number>} latency in ms, or Infinity if unreachable
 */
async function probeNodeLatency(node) {
    if (!node || !node.connected) return Infinity;

    try {
        const protocol = node.options?.secure ? 'https' : 'http';
        const host = node.options?.host || 'localhost';
        const port = node.options?.port || 2333;
        const auth = node.options?.authorization || 'youshallnotpass';

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000); // 4s timeout

        const start = performance.now();
        const res = await fetch(`${protocol}://${host}:${port}/v4/info`, {
            method: 'GET',
            headers: { Authorization: auth },
            signal: controller.signal,
        });
        const latency = Math.round(performance.now() - start);
        clearTimeout(timeout);

        if (res.ok) {
            nodeProbeLatencies.set(node.id, { latencyMs: latency, timestamp: Date.now() });
            return latency;
        }
        // Non-OK but reachable — use a penalty but still better than unreachable
        nodeProbeLatencies.set(node.id, { latencyMs: latency + 500, timestamp: Date.now() });
        return latency + 500;
    } catch {
        // Probe failed — mark as very high latency
        nodeProbeLatencies.set(node.id, { latencyMs: Infinity, timestamp: Date.now() });
        return Infinity;
    }
}

/**
 * Probe all connected nodes in parallel and return sorted results.
 * @param {object} manager - LavalinkManager
 * @returns {Promise<Array<{node, latencyMs}>>} nodes sorted by latency (lowest first)
 */
async function probeAllNodes(manager) {
    if (!manager || !manager.nodeManager) return [];

    const nodes = Array.from(manager.nodeManager.nodes.values()).filter(n => n.connected);
    const results = await Promise.all(
        nodes.map(async (node) => {
            const latencyMs = await probeNodeLatency(node);
            return { node, latencyMs };
        })
    );

    return results
        .filter(r => r.latencyMs < Infinity)
        .sort((a, b) => a.latencyMs - b.latencyMs);
}

/**
 * Compute a composite health score for a Lavalink node (lower = better).
 *
 * Factors (weighted):
 *   - Latency:      heartBeatPing or HTTP probe latency (weight: 1.0)
 *   - Frame health:  nulled + deficit frame ratio penalty (weight: 300)
 *   - CPU load:      system + lavalink CPU load (weight: 50)
 *   - Player load:   number of playing players (weight: 3 per player)
 *   - Error penalty:  +2000 if node had a recent error (< 10 min cooldown)
 *
 * @param {object} node - LavalinkNode
 * @returns {number} composite score (lower is better)
 */
function computeNodeScore(node) {
    if (!node || !node.connected) return Infinity;

    const now = Date.now();
    const COOLDOWN_MS = 10 * 60 * 1000;
    let score = 0;

    const lastErr = nodeErrorTimestamps.get(node.id);
    const hasRecentError = !!(lastErr && (now - lastErr < COOLDOWN_MS));

    const frames = node.stats?.frameStats;
    const isDroppingFrames = !!(frames && frames.sent > 0 && (((frames.nulled || 0) + (frames.deficit || 0)) / frames.sent) > 0.08);

    // ── PRIMARY NODE BONUS ──
    // The primary-main node gets a score bonus (-5000) as long as it's healthy.
    // If it has recent playback errors or is dropping >8% frames, revoke bonus
    // so healthy backup nodes can take over immediately and prevent stutter.
    if (node.id === PRIMARY_NODE_ID && !hasRecentError && !isDroppingFrames) {
        score -= 5000;
    }

    // ── 1. Latency (primary factor) ──
    // Prefer WebSocket heartbeat ping (most accurate real-time measure)
    let latency = node.heartBeatPing;
    if (!latency || latency <= 0 || latency > 30000) {
        // Fall back to cached HTTP probe latency
        const probe = nodeProbeLatencies.get(node.id);
        if (probe && probe.latencyMs < Infinity && (now - probe.timestamp < 5 * 60 * 1000)) {
            latency = probe.latencyMs;
        } else {
            latency = 500; // Unknown — assume moderate latency
        }
    }
    score += latency; // 1:1 weight — ms directly as points

    // ── 2. Frame health ──
    if (frames && frames.sent > 0) {
        const nulledRatio = (frames.nulled || 0) / frames.sent;
        const deficitRatio = (frames.deficit || 0) / frames.sent;
        score += (nulledRatio + deficitRatio) * 4000; // Strong penalty for frame drops (audio stutter)
    }

    // ── 3. CPU load ──
    const cpu = node.stats?.cpu;
    if (cpu) {
        const systemLoad = cpu.systemLoad || 0;
        const lavalinkLoad = cpu.lavalinkLoad || 0;
        score += (systemLoad + lavalinkLoad) * 50; // 0–100 scale → 0–5000 points
    }

    // ── 4. Player load (prefer less loaded nodes) ──
    const playingPlayers = node.stats?.playingPlayers || 0;
    score += playingPlayers * 3;

    // ── 5. Recent error penalty ──
    if (hasRecentError) {
        // Decaying penalty: full penalty right after error, reduces over time
        const elapsed = now - lastErr;
        const penaltyFactor = 1 - (elapsed / COOLDOWN_MS);
        score += 3000 * penaltyFactor;
    }

    return score;
}

/**
 * Get connected Lavalink nodes, sorted by composite health score (best first).
 * Considers latency, frame health, CPU load, player count, and recent errors.
 *
 * @param {object} manager - LavalinkManager
 * @param {string|null} excludeNodeId - Optional node ID to exclude
 * @returns {Array} Connected nodes sorted best-first
 */
function getHealthyNodes(manager, excludeNodeId = null) {
    if (!manager || !manager.nodeManager) return [];

    const connected = Array.from(manager.nodeManager.nodes.values())
        .filter(n => n.connected && n.id !== excludeNodeId);

    if (connected.length === 0) return [];

    // Score and sort all connected nodes
    const scored = connected.map(node => ({
        node,
        score: computeNodeScore(node),
    }));

    scored.sort((a, b) => a.score - b.score);

    return scored.map(s => s.node);
}

/**
 * Get the single best node (convenience wrapper).
 * Returns the primary node if it is healthy and not degraded.
 * Automatically falls back to the best healthy backup node if the primary has errors or frame drops.
 * @param {object} manager - LavalinkManager
 * @param {string|null} excludeNodeId - Optional node ID to exclude
 * @returns {object|null} Best node or null
 */
function getBestNode(manager, excludeNodeId = null) {
    if (!manager || !manager.nodeManager) return null;

    // Fast path: if primary node is connected, healthy, and not excluded, prefer it
    if (excludeNodeId !== PRIMARY_NODE_ID) {
        const primaryNode = manager.nodeManager.nodes.get(PRIMARY_NODE_ID);
        if (primaryNode && primaryNode.connected) {
            const lastErr = nodeErrorTimestamps.get(PRIMARY_NODE_ID);
            const hasRecentError = !!(lastErr && (Date.now() - lastErr < 10 * 60 * 1000));
            const frames = primaryNode.stats?.frameStats;
            const isDroppingFrames = !!(frames && frames.sent > 0 && (((frames.nulled || 0) + (frames.deficit || 0)) / frames.sent) > 0.10);
            if (!hasRecentError && !isDroppingFrames) {
                return primaryNode;
            }
        }
    }

    // Primary is down or degraded — fall back to scored ranking of backup nodes
    const nodes = getHealthyNodes(manager, excludeNodeId);
    return nodes[0] || null;
}

/**
 * Get a summary of all node health data for display (e.g. /ping command).
 * @param {object} manager - LavalinkManager
 * @returns {Array<{id, host, connected, latencyMs, score, players, cpu, frameHealth}>}
 */
function getNodeHealthSummary(manager) {
    if (!manager || !manager.nodeManager) return [];

    const nodes = Array.from(manager.nodeManager.nodes.values());
    return nodes.map(node => {
        const score = node.connected ? computeNodeScore(node) : Infinity;
        const probe = nodeProbeLatencies.get(node.id);
        const heartbeat = node.heartBeatPing;
        const latency = (heartbeat && heartbeat > 0 && heartbeat < 30000) ? heartbeat
            : (probe && probe.latencyMs < Infinity) ? probe.latencyMs
            : null;
        const frames = node.stats?.frameStats;
        const cpu = node.stats?.cpu;

        return {
            id: node.id,
            host: `${node.options?.host || '?'}:${node.options?.port || '?'}`,
            connected: node.connected,
            latencyMs: latency,
            score: score === Infinity ? null : Math.round(score),
            players: node.stats?.playingPlayers || 0,
            totalPlayers: node.stats?.players || 0,
            cpuLoad: cpu ? Math.round((cpu.systemLoad || 0) * 100) : null,
            frameHealth: frames && frames.sent > 0
                ? Math.round(((frames.sent - (frames.nulled || 0) - (frames.deficit || 0)) / frames.sent) * 100)
                : null,
            uptime: node.stats?.uptime || 0,
            hasRecentError: !!nodeErrorTimestamps.get(node.id) && (Date.now() - nodeErrorTimestamps.get(node.id) < 10 * 60 * 1000),
        };
    }).sort((a, b) => {
        // Connected first, then by score
        if (a.connected !== b.connected) return a.connected ? -1 : 1;
        return (a.score || Infinity) - (b.score || Infinity);
    });
}

// Track when each player's node was last switched to prevent flapping (oscillations)
const playerLastSwitch = new Map(); // guildId -> timestamp

/**
 * Check all active players and seamlessly migrate any player whose current node
 * is laggy, degraded, or significantly worse than the best available healthy node.
 *
 * Switching criteria:
 * 1. Current node is disconnected or missing -> switch immediately
 * 2. Current node has recent errors -> switch immediately
 * 3. Best node is SIGNIFICANTLY lower latency (>= 100ms lower) or score (>= 150 points lower),
 *    OR current node is dropping frames, AND the player hasn't been switched in the last 2 minutes.
 *
 * @param {object} manager - LavalinkManager
 * @returns {Promise<number>} number of players migrated
 */
async function optimizeActivePlayers(manager) {
    if (!manager || !manager.players || manager.players.size === 0) return 0;

    const healthyNodes = getHealthyNodes(manager);
    if (healthyNodes.length === 0) return 0;
    const bestNode = healthyNodes[0];
    const bestScore = computeNodeScore(bestNode);
    const bestProbe = nodeProbeLatencies.get(bestNode.id);
    const bestLatency = (bestNode.heartBeatPing && bestNode.heartBeatPing > 0 && bestNode.heartBeatPing < 30000)
        ? bestNode.heartBeatPing
        : (bestProbe?.latencyMs < Infinity ? bestProbe.latencyMs : null);

    // Check if the primary node is back online
    const primaryNode = manager.nodeManager.nodes.get(PRIMARY_NODE_ID);
    const primaryIsOnline = primaryNode && primaryNode.connected;

    const now = Date.now();
    const MIN_SWITCH_INTERVAL_MS = 2 * 60 * 1000; // 2-minute cooldown between switches per player
    let switchedCount = 0;

    for (const [guildId, player] of manager.players) {
        // Only optimize players with active or queued tracks
        if (!player || (!player.playing && !player.paused && !player.queue.current)) continue;

        const currentNode = player.node;

        // Case 1: Player has no node or current node is disconnected -> EMERGENCY switch (must always happen)
        if (!currentNode || !currentNode.connected) {
            const targetNode = primaryIsOnline ? primaryNode : bestNode;
            console.log(`[Reso] 🚨 Emergency switch: Player (${guildId}) node is disconnected. Switching to ${targetNode.id === PRIMARY_NODE_ID ? 'PRIMARY' : 'best'} node "${targetNode.id}"...`);
            try {
                await player.changeNode(targetNode.id, false);
                playerLastSwitch.set(guildId, now);
                switchedCount++;
            } catch (err) {
                console.warn(`[Reso] ⚠ Emergency node switch failed (${guildId}):`, err.message);
            }
            continue;
        }

        // ── SMOOTH PLAYBACK RULE ──
        // NEVER switch nodes while music is actively playing unless the node has disconnected.
        // Node switching tears down Discord UDP voice socket and forces voice re-negotiation,
        // causing noticeable audio silence/pops/stutters.
        // All performance migrations & primary restorations happen when player is IDLE between tracks.
        if (player.playing && !player.paused) {
            continue;
        }

        // ── STICKY PRIMARY: If primary is online but idle player is on a backup, migrate BACK ──
        if (primaryIsOnline && currentNode.id !== PRIMARY_NODE_ID) {
            console.log(`[Reso] 🏠 Primary node is BACK ONLINE! Migrating idle player (${guildId}) from backup "${currentNode.id}" → PRIMARY "${PRIMARY_NODE_ID}"...`);
            try {
                await player.changeNode(PRIMARY_NODE_ID, false);
                playerLastSwitch.set(guildId, now);
                switchedCount++;
            } catch (err) {
                console.warn(`[Reso] ⚠ Migration back to primary failed (${guildId}):`, err.message);
            }
            continue;
        }

        // Already on the best node -> nothing to do
        if (currentNode.id === bestNode.id) continue;

        // Case 2: Current node had a recent playback error -> switch idle player
        const hasRecentError = !!nodeErrorTimestamps.get(currentNode.id) && (now - nodeErrorTimestamps.get(currentNode.id) < 10 * 60 * 1000);
        if (hasRecentError) {
            const targetNode = primaryIsOnline ? primaryNode : bestNode;
            console.log(`[Reso] ⚠️ Node error cooldown: Idle player (${guildId}) current node "${currentNode.id}" had recent errors. Migrating to "${targetNode.id}"...`);
            try {
                await player.changeNode(targetNode.id, false);
                playerLastSwitch.set(guildId, now);
                switchedCount++;
            } catch (err) {
                console.warn(`[Reso] ⚠ Error migration failed (${guildId}):`, err.message);
            }
            continue;
        }

        // Case 3: Performance optimization (latency & composite score)
        // Skip if player is already on primary
        if (currentNode.id === PRIMARY_NODE_ID) continue;

        // Respect cooldown to prevent rapid bouncing between similarly performing nodes
        const lastSwitch = playerLastSwitch.get(guildId) || 0;
        if (now - lastSwitch < MIN_SWITCH_INTERVAL_MS) continue;

        const currentScore = computeNodeScore(currentNode);
        const currentProbe = nodeProbeLatencies.get(currentNode.id);
        const currentLatency = (currentNode.heartBeatPing && currentNode.heartBeatPing > 0 && currentNode.heartBeatPing < 30000)
            ? currentNode.heartBeatPing
            : (currentProbe?.latencyMs < Infinity ? currentProbe.latencyMs : null);

        // Frame drops check: if current node is dropping frames and best node is not
        const currentFrames = currentNode.stats?.frameStats;
        const hasFrameDrops = currentFrames && ((currentFrames.nulled || 0) > 0 || (currentFrames.deficit || 0) > 0);

        // Significant improvement threshold:
        // Latency difference >= 100ms OR composite score difference >= 150 points OR frame drops on current node
        const isMuchBetter = (
            (currentLatency && bestLatency && (currentLatency - bestLatency >= 100)) ||
            (currentScore - bestScore >= 150) ||
            hasFrameDrops
        );

        if (isMuchBetter) {
            const currentLatencyStr = currentLatency ? `${currentLatency}ms` : 'high';
            const bestLatencyStr = bestLatency ? `${bestLatency}ms` : 'low';
            console.log(`[Reso] 🔀 Auto-switching idle player (${guildId}) to lower-latency node: "${currentNode.id}" (${currentLatencyStr}, score ${currentScore.toFixed(0)}) → "${bestNode.id}" (${bestLatencyStr}, score ${bestScore.toFixed(0)})`);
            try {
                await player.changeNode(bestNode.id, false);
                playerLastSwitch.set(guildId, now);
                switchedCount++;
            } catch (err) {
                console.warn(`[Reso] ⚠ Auto-switch to "${bestNode.id}" failed (${guildId}):`, err.message);
            }
        }
    }

    return switchedCount;
}

/**
 * Ensure player has a healthy, connected Lavalink node attached.
 * If current node is disconnected or idle on a suboptimal node, migrates to the best active node.
 */
async function ensurePlayerNode(player, client) {
    if (!player) return null;
    if (player.node && player.node.connected) return player.node;

    const manager = client?.lavalink || player.lavalinkManager;
    if (!manager || !manager.nodeManager) return player.node || null;

    const primaryNode = manager.nodeManager.nodes.get(PRIMARY_NODE_ID);
    const targetNode = (primaryNode && primaryNode.connected) ? primaryNode : getBestNode(manager);
    if (!targetNode) return player.node || null;

    try {
        await player.changeNode(targetNode.id, false);
    } catch (e) {
        console.warn(`[Reso] Failed to switch disconnected player to "${targetNode.id}":`, e.message);
    }
    return player.node;
}

/**
 * Background health monitor placeholder (latency probing disabled)
 */
function startNodeHealthMonitor(manager) {
    return null;
}

/**
 * Extract an 11-character YouTube video ID from various YouTube URL formats
 */
function extractYouTubeVideoId(url) {
    if (!url || typeof url !== 'string') return null;
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+?&v=|shorts\/))([\w-]{11})/i);
    return match ? match[1] : null;
}

/**
 * Detect if a query is a YouTube/YouTube Music URL
 */
function isYouTubeUrl(query) {
    if (!query || typeof query !== 'string') return false;
    return /^(https?:\/\/)?(www\.|music\.)?youtube\.com\//i.test(query)
        || /^(https?:\/\/)?youtu\.be\//i.test(query);
}

/**
 * Detect if a query is a Spotify URL or URI
 */
function isSpotifyUrl(query) {
    if (!query || typeof query !== 'string') return false;
    return /^(https?:\/\/)?(www\.)?open\.spotify\.com\//i.test(query)
        || /^spotify:/i.test(query);
}

/**
 * Detect if a query is a SoundCloud URL
 */
function isSoundCloudUrl(query) {
    if (!query || typeof query !== 'string') return false;
    return /^(https?:\/\/)?(www\.)?soundcloud\.com\//i.test(query);
}

/**
 * Detect if a query is any URL or URI
 */
function isUrl(query) {
    if (!query || typeof query !== 'string') return false;
    const pattern = /^(https?:\/\/|spotify:|www\.|open\.spotify\.com|music\.youtube\.com|youtube\.com|youtu\.be|soundcloud\.com)/i;
    return pattern.test(query.trim());
}

/**
 * Clean a raw YouTube or media title by removing noisy metadata, pipes, and movie credits
 */
function cleanVideoTitle(rawTitle) {
    if (!rawTitle || typeof rawTitle !== 'string') return '';
    let title = rawTitle;
    // Strip common YouTube tag suffixes: | Official Video, - Full Song, (4K Remaster), etc.
    title = title.replace(/\s*[\|\-–—]\s*(Official\s+)?(Video|Audio|Music\s+Video|Lyric\s+Video|Full\s+Song|Full\s+Video|4K|HD|Remastered|Visualizer).*/i, '');
    // If multiple pipe delimiters (e.g. "Charlie| Puthumazhayai| Dulquer Salmaan..."), extract primary movie + song name
    const segments = title.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);
    if (segments.length >= 2) {
        return segments.slice(0, 2).join(' ');
    }
    return title.trim();
}

module.exports = {
    parseTime,
    formatTime,
    formatMs,
    formatDuration,
    formatUptime,
    getVoiceChannel,
    checkVoicePermissions,
    isInSameVoiceChannel,
    truncate,
    paginate,
    createProgressBar,
    ensurePlayerNode,
    markNodeError,
    getHealthyNodes,
    getBestNode,
    getNodeHealthSummary,
    probeNodeLatency,
    probeAllNodes,
    computeNodeScore,
    optimizeActivePlayers,
    startNodeHealthMonitor,
    extractYouTubeVideoId,
    isYouTubeUrl,
    isSpotifyUrl,
    isSoundCloudUrl,
    isUrl,
    cleanVideoTitle,
};
