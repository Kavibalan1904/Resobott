const { nowPlayingEmbed, createEmbed, errorEmbed, EMOJIS } = require('../utils/embeds');
const { truncate } = require('../utils/helpers');

/**
 * Setup all Lavalink event listeners on the LavalinkManager
 */
function setupLavalinkEvents(client) {
    const manager = client.lavalink;

    // ── Track which nodes have had problems (for smart logging) ──
    const nodeReconnectCounts = new Map();

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
        } else if (code === 4000 || code === 1000) {
            // These are normal/expected closures, keep them quiet
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
    manager.on('trackStart', (player, track) => {
        // Store in history for /back command
        const history = client.trackHistory.get(player.guildId) || [];
        // Keep last 50 tracks in history
        if (history.length >= 50) history.shift();
        history.push(track);
        client.trackHistory.set(player.guildId, history);

        const channel = client.channels.cache.get(player.textChannelId);
        if (!channel) return;

        const embed = nowPlayingEmbed(track, player, client);
        channel.send({ embeds: [embed] }).catch(() => {});
    });

    // ── Track ends ─────────────────────────────────────────────
    manager.on('trackEnd', (player, track, payload) => {
        // Track ended normally, nothing extra needed
    });

    // ── Queue finished (all tracks done) ───────────────────────
    manager.on('queueEnd', (player) => {
        const channel = client.channels.cache.get(player.textChannelId);
        if (!channel) return;

        const embed = createEmbed('Info')
            .setDescription(`${EMOJIS.music} Queue has ended. Add more songs to keep the party going!\n*I'll stay here until everyone leaves or you use \`/leave\`.*`);
        channel.send({ embeds: [embed] }).catch(() => {});
    });

    // ── Track error ────────────────────────────────────────────
    manager.on('trackError', (player, track, payload) => {
        const errorMsg = payload?.exception?.message || 'Unknown error';
        console.error(`[Reso] ✗ Track error for "${track?.info?.title}":`, errorMsg);
        const channel = client.channels.cache.get(player.textChannelId);
        if (!channel) return;

        const embed = errorEmbed(
            `Failed to play **${truncate(track?.info?.title, 50)}**\n\`\`\`${truncate(payload?.exception?.message || 'Unknown error', 200)}\`\`\``
        );
        channel.send({ embeds: [embed] }).catch(() => {});
    });

    // ── Track stuck ────────────────────────────────────────────
    manager.on('trackStuck', (player, track, payload) => {
        console.error(`[Reso] Track stuck:`, track?.info?.title);
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
        // Clean up history
        client.trackHistory.delete(player.guildId);
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
