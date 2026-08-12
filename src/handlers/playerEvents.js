const { nowPlayingEmbed, createRecommendationComponents, createEmbed, errorEmbed, warningEmbed, EMOJIS } = require('../utils/embeds');
const { truncate } = require('../utils/helpers');
const { getRecommendations } = require('../utils/recommendations');

/**
 * Setup all Lavalink event listeners on the LavalinkManager
 */
function setupLavalinkEvents(client) {
    const manager = client.lavalink;

    // ── Track which nodes have had problems (for smart logging) ──
    const nodeReconnectCounts = new Map();

    // ── Track retry state per guild to prevent infinite retry loops ──
    // Key: guildId, Value: Set of track identifiers (uri or title) already retried
    const retriedTracks = new Map();

    /**
     * Attempt to re-resolve and replay a failed/stuck track once.
     * Source-aware: retries on the original source first, then falls back to YouTube.
     * Returns true if retry was initiated, false if we should skip.
     */
    async function retryTrack(player, track, reason) {
        const guildId = player.guildId;
        const trackKey = track?.info?.uri || track?.info?.title || 'unknown';

        // Get or create the retry set for this guild
        if (!retriedTracks.has(guildId)) {
            retriedTracks.set(guildId, new Set());
        }
        const guildRetries = retriedTracks.get(guildId);

        // Already retried this track? Don't loop.
        if (guildRetries.has(trackKey)) {
            guildRetries.delete(trackKey);
            return false;
        }

        // Mark as retried
        guildRetries.add(trackKey);

        // Clean up old entries if the set grows too large (prevents memory leak)
        if (guildRetries.size > 100) {
            const first = guildRetries.values().next().value;
            guildRetries.delete(first);
        }

        try {
            // Build a search query from the track title + author
            const title = track?.info?.title || '';
            const author = track?.info?.author || '';
            const searchQuery = `${title} ${author}`.trim();
            const isrc = track?.info?.isrc || null;
            const originalSource = (track?.info?.sourceName || '').toLowerCase();

            if (!searchQuery) return false;

            // If another healthy connected node exists, switch player to it to bypass YouTube rate-limits/issues on current node
            const connectedNodes = Array.from(manager.nodeManager.nodes.values()).filter(n => n.connected && n.id !== player.node?.id);
            if (connectedNodes.length > 0) {
                const nextNode = connectedNodes[Math.floor(Math.random() * connectedNodes.length)];
                console.log(`[Reso] ↝ Switching player node "${player.node?.id || 'unknown'}" → "${nextNode.id}" for retry`);
                player.node = nextNode;
            }

            // Determine retry search sources based on original source
            // Priority: original source → Spotify → YouTube (last resort)
            const retrySources = [];

            if (originalSource === 'spotify' || originalSource === 'spsearch') {
                // Track was from Spotify — retry with spsearch first
                if (isrc) retrySources.push({ source: 'spsearch', query: isrc, label: 'Spotify ISRC' });
                retrySources.push({ source: 'spsearch', query: searchQuery, label: 'Spotify search' });
                retrySources.push({ source: 'ytsearch', query: searchQuery, label: 'YouTube fallback' });
            } else if (originalSource === 'soundcloud') {
                retrySources.push({ source: 'scsearch', query: searchQuery, label: 'SoundCloud search' });
                retrySources.push({ source: 'spsearch', query: searchQuery, label: 'Spotify fallback' });
                retrySources.push({ source: 'ytsearch', query: searchQuery, label: 'YouTube fallback' });
            } else if (originalSource === 'deezer') {
                retrySources.push({ source: 'dzsearch', query: searchQuery, label: 'Deezer search' });
                retrySources.push({ source: 'spsearch', query: searchQuery, label: 'Spotify fallback' });
                retrySources.push({ source: 'ytsearch', query: searchQuery, label: 'YouTube fallback' });
            } else {
                // Default: try Spotify first (better quality), then YouTube
                retrySources.push({ source: 'spsearch', query: searchQuery, label: 'Spotify search' });
                retrySources.push({ source: 'ytsearch', query: searchQuery, label: 'YouTube fallback' });
            }

            // Try each source in priority order
            for (const retrySource of retrySources) {
                try {
                    console.log(`[Reso] ↻ Retrying "${title}" via ${retrySource.label} (reason: ${reason})`);

                    const result = await player.search({
                        query: retrySource.query,
                        source: retrySource.source,
                    }, track.requester);

                    if (!result.tracks || result.tracks.length === 0) {
                        console.log(`[Reso] ✗ ${retrySource.label} found no results for "${title}"`);
                        continue; // Try next source
                    }

                    // Pick the best match — first result
                    const resolvedTrack = result.tracks[0];
                    resolvedTrack.requester = track.requester;
                    const resolvedSource = resolvedTrack?.info?.sourceName || 'unknown';

                    console.log(`[Reso] ✓ Retry resolved from: ${resolvedSource} via ${retrySource.label}`);

                    // Insert at the front of the queue and play
                    player.queue.add(resolvedTrack, 0);
                    await player.skip();

                    // Notify the text channel
                    const channel = client.channels.cache.get(player.textChannelId);
                    if (channel) {
                        const embed = warningEmbed(
                            `Track **${truncate(title, 50)}** ${reason}. Retrying with **${resolvedSource}**...`
                        );
                        channel.send({ embeds: [embed] }).catch(() => {});
                    }

                    return true;
                } catch (err) {
                    console.error(`[Reso] ✗ Retry via ${retrySource.label} failed:`, err.message);
                    continue; // Try next source
                }
            }

            // All retry sources exhausted
            console.log(`[Reso] ✗ All retry sources exhausted for "${title}"`);
            return false;
        } catch (err) {
            console.error(`[Reso] ✗ Retry failed for "${track?.info?.title}":`, err.message);
            return false;
        }
    }

    // ── Node connected ─────────────────────────────────────────
    manager.nodeManager.on('connect', (node) => {
        const prevAttempts = nodeReconnectCounts.get(node.id) || 0;
        if (prevAttempts > 0) {
            console.log(`[Reso] ✓ Lavalink node "${node.id}" reconnected after ${prevAttempts} attempt(s)`);
        } else {
            console.log(`[Reso] ✓ Lavalink node "${node.id}" connected (${node.options?.host}:${node.options?.port})`);
        }
        nodeReconnectCounts.set(node.id, 0);
    });

    // ── Node disconnected ──────────────────────────────────────
    manager.nodeManager.on('disconnect', (node, reason) => {
        const code = reason?.code;
        const readableReason = reason?.reason || 'No reason given';

        // Always log 1006 at warn level — this IS the problem the user is seeing
        if (code === 1006) {
            console.warn(`[Reso] ⚠ Node "${node.id}" abnormal closure (1006) — proxy/firewall likely killed idle WebSocket. Will retry.`);
        } else if (code === 4000) {
            // Code 4000 is public node rate limit per bot ID
            const count = (nodeReconnectCounts.get(`${node.id}_4000`) || 0) + 1;
            nodeReconnectCounts.set(`${node.id}_4000`, count);
            if (count === 1) {
                console.log(`[Reso] ℹ Node "${node.id}" reached public server connection limit (4000). Pausing retries.`);
            }
        } else if (code === 1000) {
            console.log(`[Reso] ℹ Node "${node.id}" closed normally (${code}: ${readableReason})`);
        } else {
            console.warn(`[Reso] ⚠ Node "${node.id}" disconnected (code: ${code || 'unknown'}, reason: ${readableReason})`);
        }

        // Attempt to migrate active players to another healthy node
        migratePlayersFromDeadNode(manager, node);
    });

    // ── Node error ─────────────────────────────────────────────
    manager.nodeManager.on('error', (node, error) => {
        const msg = error?.message || String(error || '');
        // Suppress known spam from broken/rate-limited nodes
        if (msg.includes('429') || msg.includes('Too Many Requests')) return;
        if (msg.includes('/v4/info') || msg.includes('is not valid JSON')) return;
        console.error(`[Reso] ✗ Node "${node.id}" error:`, msg);
    });

    // ── Node reconnecting ──────────────────────────────────────
    manager.nodeManager.on('reconnecting', (node) => {
        const attempts = (nodeReconnectCounts.get(node.id) || 0) + 1;
        nodeReconnectCounts.set(node.id, attempts);

        // Don't flood logs if node is getting 4000 connection limit
        if (nodeReconnectCounts.get(`${node.id}_4000`) > 0) return;

        // Only log every few attempts to avoid flooding
        if (attempts <= 3 || attempts % 5 === 0) {
            console.log(`[Reso] ↻ Node "${node.id}" reconnecting (attempt ${attempts})...`);
        }
    });

    // ── Node resumed ───────────────────────────────────────────
    manager.nodeManager.on('resumed', (node, payload, players) => {
        console.log(`[Reso] ✓ Node "${node.id}" session resumed — ${players?.length || 0} player(s) restored`);
    });

    // ── Track starts playing ───────────────────────────────────
    manager.on('trackStart', async (player, track) => {
        // Store in history for /back command
        const history = client.trackHistory.get(player.guildId) || [];
        // Keep last 50 tracks in history
        if (history.length >= 50) history.shift();
        history.push(track);
        client.trackHistory.set(player.guildId, history);

        // Update bot presence to show current song with VC elapsed time
        const trackTitle = track?.info?.title ? truncate(track.info.title, 40) : 'music';
        client.user.setPresence({
            activities: [{
                name: `${trackTitle} 🎵`,
                type: 2, // Listening
                timestamps: { start: Date.now() },
            }],
            status: 'online',
        });

        const channel = client.channels.cache.get(player.textChannelId);
        if (!channel) return;

        // Fetch YouTube-style song recommendations matching vibe/artist/language
        let recommendations = [];
        try {
            recommendations = await getRecommendations(player, track, 5);
            if (client.recommendations) {
                client.recommendations.set(player.guildId, recommendations);
            }
        } catch (e) {
            console.log('[Reso] Failed to fetch recommendations for nowPlaying:', e.message);
        }

        const embed = nowPlayingEmbed(track, player, client, recommendations);
        const row = createRecommendationComponents(recommendations, player.guildId);

        const msgOptions = { embeds: [embed] };
        if (row) msgOptions.components = [row];

        channel.send(msgOptions).catch(() => {});
    });

    // ── Track ends ─────────────────────────────────────────────
    manager.on('trackEnd', (player, track, payload) => {
        // Track ended normally, nothing extra needed
    });

    // ── Queue finished (all tracks done) ───────────────────────
    manager.on('queueEnd', (player) => {
        // Clean up retry state for this guild
        retriedTracks.delete(player.guildId);

        // Reset bot presence to idle (no elapsed timer)
        client.user.setPresence({
            activities: [{ name: 'music 🎵 | /help', type: 2 }],
            status: 'online',
        });

        const channel = client.channels.cache.get(player.textChannelId);
        if (!channel) return;

        const embed = createEmbed('Info')
            .setDescription(`${EMOJIS.music} Queue has ended. Add more songs to keep the party going!\n*I'll stay here until everyone leaves or you use \`/leave\`.*`);
        channel.send({ embeds: [embed] }).catch(() => {});
    });

    // ── Track error ────────────────────────────────────────────
    manager.on('trackError', async (player, track, payload) => {
        const errorMsg = payload?.exception?.message || 'Unknown error';
        console.error(`[Reso] ✗ Track error for "${track?.info?.title}":`, errorMsg);

        // Attempt retry before giving up
        const retried = await retryTrack(player, track, 'failed to load');
        if (retried) return; // Retry initiated, don't skip

        // Retry failed or already retried — skip with error message
        const channel = client.channels.cache.get(player.textChannelId);
        if (!channel) return;

        const embed = errorEmbed(
            `Failed to play **${truncate(track?.info?.title, 50)}**\n\`\`\`${truncate(payload?.exception?.message || 'Unknown error', 200)}\`\`\``
        );
        channel.send({ embeds: [embed] }).catch(() => {});
    });

    // ── Track stuck ────────────────────────────────────────────
    manager.on('trackStuck', async (player, track, payload) => {
        console.error(`[Reso] Track stuck:`, track?.info?.title);

        // Attempt retry before giving up
        const retried = await retryTrack(player, track, 'got stuck');
        if (retried) return; // Retry initiated, don't skip

        // Retry failed or already retried — skip with error message
        const channel = client.channels.cache.get(player.textChannelId);
        if (!channel) return;

        const embed = errorEmbed(`Track **${truncate(track?.info?.title, 50)}** got stuck. Skipping...`);
        channel.send({ embeds: [embed] }).catch(() => {});

        player.skip().catch(() => {});
    });

    // ── Player created ─────────────────────────────────────────
    manager.on('playerCreate', (player) => {
        console.log(`[Reso] Player created for guild: ${player.guildId}`);
    });

    // ── Player destroyed ───────────────────────────────────────
    manager.on('playerDestroy', (player) => {
        console.log(`[Reso] Player destroyed for guild: ${player.guildId}`);
        // Clean up history and retry state
        client.trackHistory.delete(player.guildId);
        retriedTracks.delete(player.guildId);

        // Reset bot presence to idle (no elapsed timer)
        client.user.setPresence({
            activities: [{ name: 'music 🎵 | /help', type: 2 }],
            status: 'online',
        });
    });
}

/**
 * When a node goes down, attempt to move its active players to another healthy node.
 * This prevents 1006 disconnects from silently killing all playback.
 */
function migratePlayersFromDeadNode(manager, deadNode) {
    try {
        const healthyNode = Array.from(manager.nodeManager.nodes.values())
            .find(n => n.connected && n.id !== deadNode.id);

        if (!healthyNode) return; // No healthy node available — retries will handle it

        for (const [, player] of manager.players) {
            if (player.node?.id === deadNode.id) {
                try {
                    player.node = healthyNode;
                    console.log(`[Reso] ↝ Migrated player (guild: ${player.guildId}) from "${deadNode.id}" → "${healthyNode.id}"`);
                } catch {
                    // Migration failed — the player will be picked up when the dead node reconnects
                }
            }
        }
    } catch {
        // Safety net — never let migration logic crash the bot
    }
}

module.exports = { setupLavalinkEvents };
