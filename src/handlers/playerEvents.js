const { nowPlayingEmbed, createRecommendationComponents, createPlayerControls, createDisabledControls, createEmbed, errorEmbed, warningEmbed, EMOJIS } = require('../utils/embeds');
const { truncate, markNodeError, getHealthyNodes, getBestNode, computeNodeScore, cleanVideoTitle } = require('../utils/helpers');
const { getRecommendations, getAutoplayTrack } = require('../utils/recommendations');

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

    // ── Track the last Now Playing message per guild (for single active message) ──
    const lastNowPlayingMessage = client.lastNowPlayingMessage || (client.lastNowPlayingMessage = new Map());

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
            // Build a search query from the clean track title + author
            const rawTitle = track?.info?.title || '';
            const cleanTitle = cleanVideoTitle(rawTitle) || rawTitle;
            const author = track?.info?.author || '';
            const searchQuery = cleanTitle.trim();
            const isrc = track?.info?.isrc || null;
            const originalSource = (track?.info?.sourceName || '').toLowerCase();

            if (!searchQuery) return false;
            if (!player.node || !player.node.connected) return false;

            // Single fast fallback source: if YouTube failed, try SoundCloud. Otherwise try YouTube.
            const fallbackSource = originalSource.includes('youtube') || originalSource.includes('yt') ? 'scsearch' : 'ytsearch';
            console.log(`[Reso] ↻ Quick retry for "${cleanTitle}" via ${fallbackSource} (reason: ${reason})`);

            try {
                const searchPromise = player.search({ query: searchQuery, source: fallbackSource }, track.requester);
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Retry search timeout')), 5000));
                const result = await Promise.race([searchPromise, timeoutPromise]);

                if (result && result.tracks && result.tracks.length > 0) {
                    const resolvedTrack = result.tracks[0];
                    resolvedTrack.requester = track.requester;
                    const resolvedSource = resolvedTrack?.info?.sourceName || fallbackSource;
                    console.log(`[Reso] ✓ Retry resolved: "${truncate(resolvedTrack.info?.title, 40)}" from ${resolvedSource}`);

                    await player.play({ clientTrack: resolvedTrack });

                    const channel = client.channels.cache.get(player.textChannelId);
                    if (channel) {
                        const embed = warningEmbed(
                            `Track **${truncate(rawTitle, 50)}** ${reason}. Switched to **${resolvedSource}**.`
                        );
                        channel.send({ embeds: [embed] }).catch(() => { });
                    }
                    return true;
                }
            } catch (err) {
                console.warn(`[Reso] ✗ Retry search failed: ${err.message}`);
            }

            return false;
        } catch (err) {
            console.error(`[Reso] ✗ Retry error:`, err.message);
            return false;
        }
    }

    // ── Node connected ─────────────────────────────────────────
    const initialConnectedNodes = new Set();
    manager.nodeManager.on('connect', (node) => {
        const prevAttempts = nodeReconnectCounts.get(node.id) || 0;
        if (!initialConnectedNodes.has(node.id)) {
            initialConnectedNodes.add(node.id);
            console.log(`[Reso] ✓ Lavalink node "${node.id}" connected (${node.options?.host}:${node.options?.port})`);
        } else if (prevAttempts >= 2) {
            console.log(`[Reso] ✓ Lavalink node "${node.id}" reconnected after ${prevAttempts} attempt(s)`);
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

        // ── Delete previous Now Playing message so only one active message exists ──
        const prevMsg = lastNowPlayingMessage.get(player.guildId);
        if (prevMsg) {
            try {
                await prevMsg.delete().catch(() => {});
            } catch { /* ignore */ }
            lastNowPlayingMessage.delete(player.guildId);
        }

        // ── INSTANT: Send Now Playing embed immediately (don't wait for recommendations) ──
        const embed = nowPlayingEmbed(track, player, client, []);
        const controls = createPlayerControls(false);

        let sentMsg;
        try {
            sentMsg = await channel.send({ embeds: [embed], components: [controls] });
            lastNowPlayingMessage.set(player.guildId, sentMsg);
        } catch {
            lastNowPlayingMessage.delete(player.guildId);
        }

        // ── BACKGROUND: Fetch recommendations after audio buffer fills ──
        // Wait 4 seconds before fetching so the audio stream begins smoothly with zero CPU contention
        (async () => {
            try {
                await new Promise(resolve => setTimeout(resolve, 4000));
                if (!player.playing || !sentMsg) return;

                const sessionHistory = client.trackHistory?.get(player.guildId) || [];
                const recommendations = await getRecommendations(player, track, 5, sessionHistory);
                if (client.recommendations) {
                    client.recommendations.set(player.guildId, recommendations);
                }

                // Only edit if we got recommendations AND the message still exists
                if (recommendations.length > 0 && sentMsg) {
                    const updatedEmbed = nowPlayingEmbed(track, player, client, recommendations);
                    const recRow = createRecommendationComponents(recommendations, player.guildId);
                    const updatedComponents = [controls];
                    if (recRow) updatedComponents.push(recRow);
                    await sentMsg.edit({ embeds: [updatedEmbed], components: updatedComponents }).catch(() => {});
                }
            } catch (e) {
                console.log('[Reso] Failed to fetch recommendations for nowPlaying:', e.message);
            }
        })();
    });

    // ── Track ends ─────────────────────────────────────────────
    manager.on('trackEnd', async (player, track, payload) => {
        const endReason = payload?.reason || 'unknown';
        // Log non-normal endings to help diagnose skipping issues
        if (endReason !== 'finished' && endReason !== 'replaced') {
            console.warn(`[Reso] ⚠ Track ended abnormally: "${truncate(track?.info?.title, 40)}" — reason: ${endReason}`);
        }

        // Continuous playback: NEVER switch nodes between tracks if the current node is connected.
        // Node switching reconnects Discord voice gateway and causes noticeable audio breaks.
        // Only failover if the current node actually disconnected:
        if (player && (!player.node || !player.node.connected) && player.queue.tracks.length > 0) {
            try {
                const bestNode = getBestNode(manager);
                if (bestNode && bestNode.connected) {
                    console.log(`[Reso] 🔀 Migrating player (${player.guildId}) from disconnected node to "${bestNode.id}"`);
                    await player.changeNode(bestNode.id, false);
                }
            } catch (err) {
                console.warn(`[Reso] Node failover on trackEnd failed (${player.guildId}):`, err.message);
            }
        }
    });

    // ── Queue finished (all tracks done) ───────────────────────
    manager.on('queueEnd', async (player) => {
        // Clean up retry state for this guild
        retriedTracks.delete(player.guildId);

        // ── Clean up last Now Playing message ──
        const prevMsg = lastNowPlayingMessage.get(player.guildId);
        if (prevMsg) {
            try {
                await prevMsg.delete().catch(() => {});
            } catch { /* ignore */ }
            lastNowPlayingMessage.delete(player.guildId);
        }

        // Reset bot presence to idle (no elapsed timer)
        client.user.setPresence({
            activities: [{ name: 'music 🎵 | /help', type: 2 }],
            status: 'online',
        });

        // ── Autoplay: auto-queue similar songs when queue ends ──
        if (client.autoplayGuilds?.has(player.guildId)) {
            try {
                console.log(`[Reso] 🔄 Autoplay: Finding next song using session history (${(client.trackHistory?.get(player.guildId) || []).length} tracks)`);

                const nextTrack = await getAutoplayTrack(player, client.trackHistory);
                if (nextTrack) {
                    nextTrack.requester = { username: 'Autoplay', id: 'autoplay' };
                    player.queue.add(nextTrack);
                    await player.play();

                    const categoryTag = nextTrack.categoryLabel || '🎵 Recommended';
                    const channel = client.channels.cache.get(player.textChannelId);
                    if (channel) {
                        const embed = createEmbed('Autoplay')
                            .setAuthor({ name: '🔄 Autoplay' })
                            .setDescription(
                                `Queued **[${truncate(nextTrack.info?.title || 'Unknown', 50)}](${nextTrack.info?.uri || ''})**\n` +
                                `> ${categoryTag} • Based on your session • Use \`/autoplay\` to toggle`
                            )
                            .setThumbnail(nextTrack.info?.artworkUrl || null);
                        channel.send({ embeds: [embed] }).catch(() => {});
                    }

                    console.log(`[Reso] 🔄 Autoplay: Queued "${truncate(nextTrack.info?.title, 40)}" [${categoryTag}]`);
                    return; // Don't show "queue ended" message
                }
            } catch (e) {
                console.error('[Reso] Autoplay error:', e.message);
            }
        }

        const channel = client.channels.cache.get(player.textChannelId);
        if (!channel) return;

        const embed = createEmbed('Info')
            .setDescription(`${EMOJIS.music} Queue has ended. Add more songs to keep the party going!\n*Use \`/autoplay\` to automatically queue similar songs!*\n*I'll stay here until everyone leaves or you use \`/leave\`.*`);
        channel.send({ embeds: [embed] }).catch(() => { });
    });

    // ── Track error ────────────────────────────────────────────
    manager.on('trackError', async (player, track, payload) => {
        const errorMsg = payload?.exception?.message || 'Unknown error';
        console.error(`[Reso] ✗ Track error for "${track?.info?.title}":`, errorMsg);

        // Mark current node as having encountered a track playback error
        if (player?.node?.id) {
            markNodeError(player.node.id);
        }

        // Attempt retry before giving up
        const retried = await retryTrack(player, track, 'failed to load');
        if (retried) return; // Retry initiated, don't skip

        // Retry failed or already retried — skip with error message
        const channel = client.channels.cache.get(player.textChannelId);
        if (!channel) return;

        const embed = errorEmbed(
            `Failed to play **${truncate(track?.info?.title, 50)}**\n\`\`\`${truncate(payload?.exception?.message || 'Unknown error', 200)}\`\`\``
        );
        channel.send({ embeds: [embed] }).catch(() => { });
    });

    // ── Track stuck ────────────────────────────────────────────
    // NOTE: Do NOT call player.skip() here! autoSkip:true (index.js) already
    // advances the queue after Lavalink sends TrackEndEvent(reason=stuck).
    // Calling skip() manually would DOUBLE-SKIP and eat the next queued track.
    manager.on('trackStuck', async (player, track, payload) => {
        const thresholdMs = payload?.thresholdMs || '?';
        console.error(`[Reso] Track stuck (threshold: ${thresholdMs}ms):`, track?.info?.title);

        // Attempt retry before giving up
        const retried = await retryTrack(player, track, 'got stuck');
        if (retried) return; // Retry initiated successfully

        // Retry failed or already retried — notify user (autoSkip handles queue advancement)
        const channel = client.channels.cache.get(player.textChannelId);
        if (!channel) return;

        const embed = errorEmbed(`Track **${truncate(track?.info?.title, 50)}** got stuck. Skipping...`);
        channel.send({ embeds: [embed] }).catch(() => { });
    });

    // ── Player created ─────────────────────────────────────────
    manager.on('playerCreate', (player) => {
        console.log(`[Reso] Player created for guild: ${player.guildId}`);
    });

    // ── Player destroyed ───────────────────────────────────────
    manager.on('playerDestroy', (player) => {
        console.log(`[Reso] Player destroyed for guild: ${player.guildId}`);
        // Clean up history and retry state
        client.trackHistory?.delete(player.guildId);
        retriedTracks.delete(player.guildId);
        client.recommendations?.delete(player.guildId);
        client.voteSkips?.delete(player.guildId);

        if (client.aloneTimers?.has(player.guildId)) {
            clearTimeout(client.aloneTimers.get(player.guildId));
            client.aloneTimers.delete(player.guildId);
        }

        const prevMsg = lastNowPlayingMessage.get(player.guildId);
        if (prevMsg) {
            prevMsg.delete().catch(() => {});
            lastNowPlayingMessage.delete(player.guildId);
        }

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
async function migratePlayersFromDeadNode(manager, deadNode) {
    try {
        const healthyNodes = getHealthyNodes(manager, deadNode.id);
        const healthyNode = healthyNodes[0] || Array.from(manager.nodeManager.nodes.values()).find(n => n.connected && n.id !== deadNode.id);

        if (!healthyNode) return; // No healthy node available — retries will handle it

        for (const [, player] of manager.players) {
            if (player.node?.id === deadNode.id) {
                try {
                    await player.changeNode(healthyNode.id, false);
                    console.log(`[Reso] ↝ Migrated player (guild: ${player.guildId}) seamlessly from "${deadNode.id}" → "${healthyNode.id}"`);
                } catch (err) {
                    console.warn(`[Reso] Player migration error (guild: ${player.guildId}):`, err.message);
                }
            }
        }
    } catch {
        // Safety net — never let migration logic crash the bot
    }
}

module.exports = { setupLavalinkEvents };
