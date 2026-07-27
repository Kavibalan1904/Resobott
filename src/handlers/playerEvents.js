const { nowPlayingEmbed, createEmbed, errorEmbed, EMOJIS } = require('../utils/embeds');
const { truncate } = require('../utils/helpers');

/**
 * Setup all Lavalink event listeners on the LavalinkManager
 */
function setupLavalinkEvents(client) {
    const manager = client.lavalink;

    // ── Node connected ─────────────────────────────────────────
    manager.nodeManager.on('connect', (node) => {
        console.log(`[Reso] ✓ Lavalink node "${node.id}" connected (${node.options?.host}:${node.options?.port})`);
    });

    // ── Node disconnected ──────────────────────────────────────
    manager.nodeManager.on('disconnect', (node, reason) => {
        const code = reason?.code;
        // Suppress routine idle socket resets (code 4000 / 1000 / 1006) to prevent log flooding
        if (code === 4000 || code === 1000 || code === 1006) return;
        console.warn(`[Reso] ⚠ Lavalink node "${node.id}" disconnected (${reason?.code || 'unknown'})`);
    });

    // ── Node error ─────────────────────────────────────────────
    manager.nodeManager.on('error', (node, error) => {
        const msg = error?.message || String(error || '');
        if (msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('ECONNREFUSED')) return;
        console.error(`[Reso] ✗ Lavalink node "${node.id}" error:`, msg);
    });

    // ── Node reconnecting ──────────────────────────────────────
    manager.nodeManager.on('reconnecting', (node) => {
        // Routine background reconnect — kept quiet to keep console clean
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

        const embed = nowPlayingEmbed(track, player);
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

        // Check if 24/7 mode is on
        if (client.twentyFourSeven?.has(player.guildId)) {
            const embed = createEmbed('Info')
                .setDescription(`${EMOJIS.music} Queue has ended. Add more songs to keep the party going!\n*24/7 mode is active — I'll stay in the channel.*`);
            channel.send({ embeds: [embed] }).catch(() => {});
            return;
        }

        const embed = createEmbed('Info')
            .setDescription(`${EMOJIS.music} Queue has ended. Add more songs to keep the party going!`);
        channel.send({ embeds: [embed] }).catch(() => {});

        // Auto-disconnect after 30 seconds if not in 24/7 mode
        setTimeout(() => {
            const currentPlayer = manager.getPlayer(player.guildId);
            if (currentPlayer && !currentPlayer.playing && !client.twentyFourSeven?.has(player.guildId)) {
                currentPlayer.destroy();
            }
        }, 30000);
    });

    // ── Track error ────────────────────────────────────────────
    manager.on('trackError', (player, track, payload) => {
        console.error(`[Reso] Track error:`, payload);
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

module.exports = { setupLavalinkEvents };
