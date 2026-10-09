const { nowPlayingEmbed, createRecommendationComponents, createPlayerControls, createDisabledControls, createEmbed, errorEmbed, warningEmbed, EMOJIS, capitalize } = require('../utils/embeds');
const { truncate, markNodeError, getHealthyNodes, getBestNode, computeNodeScore, cleanVideoTitle, PRIMARY_NODE_ID } = require('../utils/helpers');
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

    // ── Track guilds with an active retry in progress ──
    // Used to prevent queueEnd from firing "Queue has ended" while a retry search is still running
    const activeRetries = new Set();

    // ── Track successful retries that are pending TrackStartEvent ──
    const successfulRetries = new Set();

    // ── Track the last Now Playing message per guild (for single active message) ──
    const lastNowPlayingMessage = client.lastNowPlayingMessage || (client.lastNowPlayingMessage = new Map());

    // ── Diagnostic: Track time between tracks ──
    const trackGaps = new Map();

    // ── Bounded Retries: Track consecutive retries per guild ──
    const consecutiveRetries = new Map();

    // ── Queue advancement guard ──
    const isAdvancingQueue = new Set();

    async function advanceQueueSafely(player) {
        if (isAdvancingQueue.has(player.guildId)) {
            console.log(`[Reso] 🛡️ Queue advancement already in progress for guild ${player.guildId}, ignoring duplicate.`);
            return;
        }
        isAdvancingQueue.add(player.guildId);
        try {
            if (player.queue && player.queue.tracks && player.queue.tracks.length > 0) {
                await player.skip();
            } else {
                await player.stopPlaying(false, false);
            }
        } catch (err) {
            console.error(`[Reso] ✗ Failed to advance queue safely:`, err.message);
        } finally {
            setTimeout(() => isAdvancingQueue.delete(player.guildId), 1500);
        }
    }

    /**
     * Attempt to re-resolve and replay a failed/stuck track once.
     * Source-aware: retries on the original source first, then falls back to YouTube.
     * Returns true if retry was initiated, false if we should skip.
     */
    async function retryTrack(player, track, reason) {
        const guildId = player.guildId;
        const trackKey = track?.info?.uri || track?.info?.title || 'unknown';

        if (activeRetries.has(guildId)) {
            console.log(`[Reso] ⏳ Retry already in progress for guild ${guildId}, ignoring concurrent error (${reason}).`);
            return true; // Pretend handled to prevent skip
        }

        const currentRetries = consecutiveRetries.get(guildId) || 0;
        if (currentRetries >= 2) {
            console.log(`[Reso] 🛑 Bounded retry limit reached (2) for guild ${guildId}. Skipping track instead of looping.`);
            return false;
        }
        consecutiveRetries.set(guildId, currentRetries + 1);

        // Get or create the retry set for this guild
        if (!retriedTracks.has(guildId)) {
            retriedTracks.set(guildId, new Set());
        }
        const guildRetries = retriedTracks.get(guildId);

        // Already retried this track? Don't loop.
        if (guildRetries.has(trackKey)) {
            console.log(`[Reso] ⏭️ Track already retried recently, skipping: "${truncate(trackKey, 40)}"`);
            return false;
        }

        // Mark as retried
        guildRetries.add(trackKey);

        // Clean up old entries if the set grows too large (prevents memory leak)
        if (guildRetries.size > 100) {
            const first = guildRetries.values().next().value;
            guildRetries.delete(first);
        }

        // Mark retry as active so queueEnd doesn't fire prematurely
        activeRetries.add(guildId);

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

            // Simplify fallback behaviour: Do not hide YouTube errors with SoundCloud.
            // If YouTube fails, retry once on YouTube, but we will pick the *second* search result if available.
            const fallbackSources = [originalSource || 'ytsearch'];

            for (const fallbackSource of fallbackSources) {
                const ts = new Date().toISOString();
                console.log(`[Reso ${ts}] ↻ RETRY: Quick retry for "${cleanTitle}" via ${fallbackSource} (reason: ${reason})`);
                try {
                    const searchPromise = player.search({ query: searchQuery, source: fallbackSource }, track.requester);
                    let timeoutId;
                    const timeoutPromise = new Promise((_, reject) => {
                        timeoutId = setTimeout(() => reject(new Error('Retry search timeout')), 5000);
                    });
                    const result = await Promise.race([searchPromise, timeoutPromise]);
                    clearTimeout(timeoutId);

                    if (result && result.tracks && result.tracks.length > 0) {
                        // Check if a new track started playing while we were searching (e.g. manual skip)
                        if (player.playing && player.queue.current && player.queue.current.info?.uri !== track.info?.uri) {
                            console.log(`[Reso] ⏭️ Retry aborted: A new track is already playing.`);
                            return false;
                        }

                        // Pick the second track to avoid playing the exact same broken video, unless there's only one.
                        let trackIndex = 0;
                        if ((fallbackSource === 'ytsearch' || fallbackSource === 'youtube') && result.tracks.length > 1) {
                            trackIndex = 1;
                        }
                        const resolvedTrack = result.tracks[trackIndex];
                        resolvedTrack.requester = track.requester;
                        const resolvedSource = resolvedTrack?.info?.sourceName ? capitalize(resolvedTrack.info.sourceName) : fallbackSource;
                        console.log(`[Reso] ✓ Retry resolved: "${truncate(resolvedTrack.info?.title, 40)}" from ${resolvedSource}`);

                        successfulRetries.add(guildId); // Mark as successfully retried BEFORE playing to suppress queueEnd race condition
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
                    console.warn(`[Reso] ✗ Retry search on ${fallbackSource} failed: ${err.message}`);
                }
            }

            return false;
        } catch (err) {
            console.error(`[Reso] ✗ Retry error:`, err.message);
            return false;
        } finally {
            // Always clear the active retry flag
            activeRetries.delete(guildId);
        }
    }

    // ── Node connected ─────────────────────────────────────────
    const initialConnectedNodes = new Set();
    manager.nodeManager.on('connect', async (node) => {
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
        player.set('trackStartTime', Date.now()); // For diagnostics
        
        const mem = Math.round(process.memoryUsage().rss / 1024 / 1024);
        
        // Measure track gap
        if (trackGaps.has(player.guildId)) {
            const gap = Date.now() - trackGaps.get(player.guildId);
            console.log(`[Reso] ▶️ Track started: "${truncate(track?.info?.title, 40)}" (Node: ${player.node?.id}, Mem: ${mem}MB, Gap: ${gap}ms)`);
            trackGaps.delete(player.guildId);
        } else {
            console.log(`[Reso] ▶️ Track started: "${truncate(track?.info?.title, 40)}" (Node: ${player.node?.id}, Mem: ${mem}MB)`);
        }

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
        trackGaps.set(player.guildId, Date.now()); // Start measuring transition gap

        // Log non-normal endings to help diagnose skipping issues
        if (endReason !== 'finished' && endReason !== 'replaced') {
            console.warn(`[Reso] ⚠ Track ended abnormally: "${truncate(track?.info?.title, 40)}" — reason: ${endReason}`);
        } else if (endReason === 'finished') {
            console.log(`[Reso] ⏹ Track finished normally: "${truncate(track?.info?.title, 40)}"`);
        }

        // ── Handle disconnected node on track end ──
        if (endReason === 'finished') {
            consecutiveRetries.delete(player.guildId); // Reset consecutive retries only on natural progression (not on replace)
        }
        if (player && player.queue.tracks.length > 0) {
            if (!player.node || !player.node.connected) {
                // Current node is disconnected - failover to best available node
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
        }

        // ── Manual Queue Advancement ──
        // Since autoSkip is false, we must manually advance the queue when a track finishes normally.
        // (Errors and stuck tracks are handled by their respective event listeners)
        if (endReason === 'finished') {
            await advanceQueueSafely(player);
        }
    });

    // ── Queue finished (all tracks done) ───────────────────────
    manager.on('queueEnd', async (player) => {
        // ── Wait for active retry before declaring queue ended ──
        // When a track gets stuck/errors, retryTrack searches for an alternative.
        // autoSkip fires queueEnd before the retry completes, causing a false "Queue ended" message.
        if (activeRetries.has(player.guildId)) {
            console.log(`[Reso] ⏳ queueEnd: Retry in progress for guild ${player.guildId}, waiting...`);
            // Wait up to 8 seconds for the retry to finish
            for (let i = 0; i < 16; i++) {
                await new Promise(r => setTimeout(r, 500));
                if (!activeRetries.has(player.guildId)) break;
            }
            // If the retry succeeded (or player somehow resumed playing), suppress the "queue ended" message
            if (player.playing || successfulRetries.has(player.guildId)) {
                console.log(`[Reso] ✓ queueEnd suppressed — retry succeeded, playback pending`);
                successfulRetries.delete(player.guildId);
                return;
            }
        }

        // Clean up retry state for this guild
        retriedTracks.delete(player.guildId);
        successfulRetries.delete(player.guildId);

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
        const cause = payload?.exception?.cause || 'None';
        const severity = payload?.exception?.severity || 'Unknown';
        console.error(`[Reso] ✗ Track error for "${track?.info?.title}": ${errorMsg} (Cause: ${cause}, Severity: ${severity})`);
        
        // Mark current node as having encountered a track playback error
        if (player?.node?.id) {
            markNodeError(player.node.id);
        }

        // Attempt retry before giving up
        const retried = await retryTrack(player, track, 'failed to load');
        if (retried) return; // Retry initiated, don't skip

        // Retry failed or already retried — skip with error message
        const channel = client.channels.cache.get(player.textChannelId);
        if (channel) {
            const embed = errorEmbed(
                `Failed to play **${truncate(track?.info?.title, 50)}**\n\`\`\`${truncate(payload?.exception?.message || 'Unknown error', 200)}\`\`\``
            );
            channel.send({ embeds: [embed] }).catch(() => { });
        }

        // Advance the queue manually safely
        await advanceQueueSafely(player);
    });

    // ── Track stuck ────────────────────────────────────────────
    manager.on('trackStuck', async (player, track, payload) => {
        const thresholdMs = payload?.thresholdMs || '?';
        const startTime = player.get('trackStartTime') || Date.now();
        const elapsed = Date.now() - startTime;
        
        console.error(`[Reso] ⚠️ Track stuck (threshold: ${thresholdMs}ms): "${track?.info?.title}"`);
        console.error(`[Reso] 🔍 DIAGNOSTICS - Node: ${player.node?.id} | State: ${player.playing ? 'PLAYING' : 'STOPPED'} | Paused: ${player.paused} | Position: ${player.position}ms | Elapsed since start: ${elapsed}ms`);
        console.error(`[Reso] 🔍 Diagnostic Payload:`, JSON.stringify(payload));

        // Attempt retry before giving up
        const retried = await retryTrack(player, track, 'got stuck');
        if (retried) return; // Retry initiated successfully

        // Retry failed or already retried — notify user and skip
        const channel = client.channels.cache.get(player.textChannelId);
        if (channel) {
            const embed = errorEmbed(`Track **${truncate(track?.info?.title, 50)}** got stuck. Skipping...`);
            channel.send({ embeds: [embed] }).catch(() => { });
        }

        // Advance the queue manually safely
        await advanceQueueSafely(player);
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
