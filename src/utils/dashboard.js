const http = require('http');
const os = require('os');
const { formatUptime, formatMs, truncate } = require('./helpers');
const { getEffectiveSource } = require('./embeds');

/**
 * Gather real-time metrics for dashboard and monitor commands
 */
function getSystemMetrics(client) {
    const manager = client.lavalink;
    const nodes = manager?.nodeManager?.nodes ? Array.from(manager.nodeManager.nodes.values()) : [];

    // Lavalink node health
    const nodeMetrics = nodes.map(node => {
        const frames = node.stats?.frameStats || null;
        const cpu = node.stats?.cpu || null;
        const mem = node.stats?.memory || null;

        let frameLossPercent = 0;
        let qualityRating = 'Optimal';
        if (frames && frames.sent > 0) {
            const lost = (frames.nulled || 0) + (frames.deficit || 0);
            frameLossPercent = Number(((lost / frames.sent) * 100).toFixed(2));
            if (frameLossPercent > 5) qualityRating = 'Critical Buffer Drops';
            else if (frameLossPercent > 1) qualityRating = 'Moderate Jitter';
        }

        const heartbeat = node.heartBeatPing;
        const latencyMs = (heartbeat && heartbeat > 0 && heartbeat < 30000) ? Math.round(heartbeat) : null;

        return {
            id: node.id,
            host: `${node.options?.host || '?'}:${node.options?.port || '?'}`,
            connected: !!node.connected,
            isPrimary: node.id === 'primary-main',
            latencyMs,
            cpuSystem: cpu ? Math.round((cpu.systemLoad || 0) * 100) : 0,
            cpuLavalink: cpu ? Math.round((cpu.lavalinkLoad || 0) * 100) : 0,
            memUsedMb: mem?.used ? Math.round(mem.used / 1024 / 1024) : 0,
            memAllocatedMb: mem?.allocated ? Math.round(mem.allocated / 1024 / 1024) : 0,
            uptime: node.stats?.uptime || 0,
            players: node.stats?.playingPlayers || 0,
            totalPlayers: node.stats?.players || 0,
            frames: {
                sent: frames?.sent || 0,
                nulled: frames?.nulled || 0,
                deficit: frames?.deficit || 0,
                lossPercent: frameLossPercent,
                qualityRating,
            },
        };
    });

    // Active session details
    const sessions = [];
    const allPlayers = manager?.players ? Array.from(manager.players.values()) : [];
    let idlePlayersCount = 0;
    let totalTracksQueued = 0;
    let activeFiltersCount = 0;
    const bitrates = [];

    for (const player of allPlayers) {
        if (!player) continue;
        const qLen = player.queue?.tracks?.length || 0;
        totalTracksQueued += qLen;

        const filters = player.activeFilters ? (player.activeFilters.size || 0) : 0;
        activeFiltersCount += filters;

        if (player.voiceChannelId && client.channels?.cache) {
            const vc = client.channels.cache.get(player.voiceChannelId);
            if (vc && vc.bitrate) bitrates.push(Math.round(vc.bitrate / 1000));
        }

        if (!player.playing && !player.paused) {
            idlePlayersCount++;
            continue;
        }

        const current = player.queue?.current;
        const guild = client.guilds?.cache?.get(player.guildId);
        const source = current ? getEffectiveSource(current, player.guildId) : 'unknown';
        const vc = client.channels?.cache?.get(player.voiceChannelId);
        const bitrateKbps = vc && vc.bitrate ? Math.round(vc.bitrate / 1000) : null;
        const is247 = Boolean(client.twentyFourSeven?.has(player.guildId));
        const isAutoplay = Boolean(client.autoplayGuilds?.has(player.guildId));
        const queueLength = player.queue?.tracks?.length || 0;
        const repeatMode = player.repeatMode || 'off';
        const activeFilterNames = player.activeFilters
            ? (Array.isArray(player.activeFilters) ? player.activeFilters : Array.from(player.activeFilters.keys ? player.activeFilters.keys() : []))
            : [];

        sessions.push({
            guildId: player.guildId,
            guildName: guild?.name || 'Unknown Guild',
            voiceChannelId: player.voiceChannelId,
            playing: !!player.playing,
            paused: !!player.paused,
            volume: player.volume || 100,
            nodeId: player.node?.id || 'unknown',
            positionMs: player.position || 0,
            durationMs: current?.info?.duration || 0,
            bitrateKbps,
            is247,
            isAutoplay,
            queueLength,
            repeatMode,
            filters: activeFilterNames,
            track: current?.info ? {
                title: current.info.title || 'Unknown Title',
                author: current.info.author || 'Unknown Artist',
                uri: current.info.uri || '',
                artworkUrl: current.info.artworkUrl || null,
                source,
                isStream: !!current.info.isStream,
            } : null,
        });
    }

    const sourceBreakdown = {};
    for (const s of sessions) {
        const src = s.track?.source || 'unknown';
        sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;
    }

    const avgBitrateKbps = bitrates.length > 0
        ? Math.round(bitrates.reduce((a, b) => a + b, 0) / bitrates.length)
        : 64;

    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem ? os.totalmem() : 0;
    const freeMem = os.freemem ? os.freemem() : 0;
    const usedMem = totalMem - freeMem;
    const loadAvg = (os.loadavg && typeof os.loadavg === 'function')
        ? os.loadavg().map(l => Number(l.toFixed(2)))
        : [0, 0, 0];

    const host = {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        pid: process.pid,
        cpuCount: os.cpus ? os.cpus().length : 1,
        cpuModel: (os.cpus && os.cpus()[0]) ? os.cpus()[0].model : 'CPU',
        loadAvg,
        totalMemMb: Math.round(totalMem / 1024 / 1024),
        freeMemMb: Math.round(freeMem / 1024 / 1024),
        usedMemMb: Math.round(usedMem / 1024 / 1024),
        memPercent: totalMem > 0 ? Number(((usedMem / totalMem) * 100).toFixed(1)) : 0,
    };

    const activeStreamsCount = sessions.filter(s => s.playing).length;
    const pausedStreamsCount = sessions.filter(s => s.paused).length;

    let totalFramesSent = 0;
    let totalFramesNulled = 0;
    let totalFramesDeficit = 0;

    for (const n of nodeMetrics) {
        totalFramesSent += (n.frames?.sent || 0);
        totalFramesNulled += (n.frames?.nulled || 0);
        totalFramesDeficit += (n.frames?.deficit || 0);
    }

    const totalLost = totalFramesNulled + totalFramesDeficit;
    const overallFrameLossPercent = totalFramesSent > 0
        ? Number(((totalLost / totalFramesSent) * 100).toFixed(2))
        : 0;
    const overallFrameQuality = Number((100 - overallFrameLossPercent).toFixed(2));

    const audio = {
        activeStreamsCount,
        pausedStreamsCount,
        idlePlayersCount,
        totalPlayersCount: allPlayers.length,
        totalTracksQueued,
        activeFiltersCount,
        twentyFourSevenCount: client.twentyFourSeven?.size || 0,
        autoplayGuildsCount: client.autoplayGuilds?.size || 0,
        avgBitrateKbps,
        sourceBreakdown,
        frames: {
            sent: totalFramesSent,
            nulled: totalFramesNulled,
            deficit: totalFramesDeficit,
            lossPercent: overallFrameLossPercent,
            qualityPercent: overallFrameQuality,
        },
    };

    const bot = {
        uptime: client.uptime || 0,
        uptimeFormatted: formatUptime(client.uptime),
        wsPingMs: Math.round(client.ws?.ping || 0),
        guildsCount: client.guilds?.cache?.size || 0,
        membersCount: Array.from(client.guilds?.cache?.values() || []).reduce((acc, g) => acc + (g.memberCount || 0), 0),
        channelsCount: client.channels?.cache?.size || 0,
        voiceChannelsCount: client.channels?.cache ? Array.from(client.channels.cache.values()).filter(c => c.isVoiceBased?.()).length : 0,
        shardsCount: client.ws?.shards?.size || client.shard?.count || 1,
        commandsCount: client.commands?.size || 0,
        heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
        rssMb: Math.round(memUsage.rss / 1024 / 1024),
        externalMb: Math.round((memUsage.external || 0) / 1024 / 1024),
    };

    return {
        timestamp: Date.now(),
        host,
        bot,
        audio,
        nodes: nodeMetrics,
        sessions,
        activeStreamsCount,
        totalSessionsCount: sessions.length,
    };
}

/**
 * Generate Prometheus scrape text (/metrics)
 */
function generatePrometheusMetrics(metrics) {
    const lines = [];

    // Bot metrics
    lines.push('# HELP reso_discord_ws_ping_ms Discord Gateway WebSocket latency in milliseconds');
    lines.push('# TYPE reso_discord_ws_ping_ms gauge');
    lines.push(`reso_discord_ws_ping_ms ${metrics.bot.wsPingMs}`);

    lines.push('# HELP reso_memory_heap_bytes Node.js heap memory used in bytes');
    lines.push('# TYPE reso_memory_heap_bytes gauge');
    lines.push(`reso_memory_heap_bytes ${metrics.bot.heapUsedMb * 1024 * 1024}`);

    lines.push('# HELP reso_memory_rss_bytes Node.js RSS memory in bytes');
    lines.push('# TYPE reso_memory_rss_bytes gauge');
    lines.push(`reso_memory_rss_bytes ${metrics.bot.rssMb * 1024 * 1024}`);

    lines.push('# HELP reso_bot_uptime_seconds Bot uptime in seconds');
    lines.push('# TYPE reso_bot_uptime_seconds gauge');
    lines.push(`reso_bot_uptime_seconds ${Math.round((metrics.bot.uptime || 0) / 1000)}`);

    lines.push('# HELP reso_bot_guilds_total Total Discord guilds connected');
    lines.push('# TYPE reso_bot_guilds_total gauge');
    lines.push(`reso_bot_guilds_total ${metrics.bot.guildsCount}`);

    lines.push('# HELP reso_bot_members_total Total cached users across guilds');
    lines.push('# TYPE reso_bot_members_total gauge');
    lines.push(`reso_bot_members_total ${metrics.bot.membersCount}`);

    lines.push('# HELP reso_active_streams Current active audio playback streams');
    lines.push('# TYPE reso_active_streams gauge');
    lines.push(`reso_active_streams ${metrics.activeStreamsCount}`);

    lines.push('# HELP reso_total_sessions Total connected music players');
    lines.push('# TYPE reso_total_sessions gauge');
    lines.push(`reso_total_sessions ${metrics.totalSessionsCount}`);

    if (metrics.audio) {
        lines.push('# HELP reso_audio_paused_streams Paused audio streams');
        lines.push('# TYPE reso_audio_paused_streams gauge');
        lines.push(`reso_audio_paused_streams ${metrics.audio.pausedStreamsCount || 0}`);

        lines.push('# HELP reso_audio_queued_tracks Total tracks in all queues');
        lines.push('# TYPE reso_audio_queued_tracks gauge');
        lines.push(`reso_audio_queued_tracks ${metrics.audio.totalTracksQueued || 0}`);

        lines.push('# HELP reso_audio_247_sessions Total 24/7 active voice sessions');
        lines.push('# TYPE reso_audio_247_sessions gauge');
        lines.push(`reso_audio_247_sessions ${metrics.audio.twentyFourSevenCount || 0}`);

        lines.push('# HELP reso_audio_autoplay_guilds Total guilds with autoplay active');
        lines.push('# TYPE reso_audio_autoplay_guilds gauge');
        lines.push(`reso_audio_autoplay_guilds ${metrics.audio.autoplayGuildsCount || 0}`);

        if (metrics.audio.frames) {
            lines.push('# HELP reso_audio_frames_sent_total Total audio frames sent across all nodes');
            lines.push('# TYPE reso_audio_frames_sent_total counter');
            lines.push(`reso_audio_frames_sent_total ${metrics.audio.frames.sent || 0}`);

            lines.push('# HELP reso_audio_frames_deficit_total Total audio frame deficit across all nodes');
            lines.push('# TYPE reso_audio_frames_deficit_total counter');
            lines.push(`reso_audio_frames_deficit_total ${metrics.audio.frames.deficit || 0}`);

            lines.push('# HELP reso_audio_frames_nulled_total Total nulled audio frames across all nodes');
            lines.push('# TYPE reso_audio_frames_nulled_total counter');
            lines.push(`reso_audio_frames_nulled_total ${metrics.audio.frames.nulled || 0}`);

            lines.push('# HELP reso_audio_frames_quality_percent Overall audio frame quality percentage');
            lines.push('# TYPE reso_audio_frames_quality_percent gauge');
            lines.push(`reso_audio_frames_quality_percent ${metrics.audio.frames.qualityPercent || 100}`);
        }
    }

    if (metrics.host) {
        lines.push('# HELP reso_host_cpu_load_1m Host 1-minute CPU load average');
        lines.push('# TYPE reso_host_cpu_load_1m gauge');
        lines.push(`reso_host_cpu_load_1m ${metrics.host.loadAvg[0] || 0}`);

        lines.push('# HELP reso_host_memory_used_bytes Host system memory used in bytes');
        lines.push('# TYPE reso_host_memory_used_bytes gauge');
        lines.push(`reso_host_memory_used_bytes ${metrics.host.usedMemMb * 1024 * 1024}`);
    }

    // Lavalink metrics per node
    for (const node of metrics.nodes) {
        const labels = `node="${node.id}",is_primary="${node.isPrimary}"`;

        lines.push(`lavalink_node_connected{${labels}} ${node.connected ? 1 : 0}`);
        if (node.latencyMs != null) {
            lines.push(`lavalink_node_latency_ms{${labels}} ${node.latencyMs}`);
        }
        lines.push(`lavalink_node_cpu_system_percent{${labels}} ${node.cpuSystem}`);
        lines.push(`lavalink_node_cpu_lavalink_percent{${labels}} ${node.cpuLavalink}`);
        lines.push(`lavalink_node_memory_used_bytes{${labels}} ${node.memUsedMb * 1024 * 1024}`);

        lines.push(`lavalink_frames_sent_total{${labels}} ${node.frames.sent}`);
        lines.push(`lavalink_frames_nulled_total{${labels}} ${node.frames.nulled}`);
        lines.push(`lavalink_frames_deficit_total{${labels}} ${node.frames.deficit}`);
        lines.push(`lavalink_frames_loss_percent{${labels}} ${node.frames.lossPercent}`);
    }

    return lines.join('\n') + '\n';
}

/**
 * Generate Minimal & Efficient HTML dashboard
 */
function generateDashboardHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reso • System & Audio Engine Monitor</title>
    <link rel="icon" href="https://cdn.discordapp.com/emojis/1068864756531937320.webp" />
    <style>
        :root {
            --bg: #08090d;
            --surface: #0f121a;
            --surface-hover: #151924;
            --border: #1c2230;
            --border-light: #283042;
            --text-main: #f1f5f9;
            --text-muted: #7c8799;
            --text-faint: #4b5563;
            --accent: #6366f1;
            --accent-glow: rgba(99, 102, 241, 0.15);
            --green: #10b981;
            --green-glow: rgba(16, 185, 129, 0.15);
            --amber: #f59e0b;
            --amber-glow: rgba(245, 158, 11, 0.15);
            --red: #ef4444;
            --red-glow: rgba(239, 68, 68, 0.15);
            --cyan: #06b6d4;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: var(--bg);
            color: var(--text-main);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            padding: 20px 24px 60px;
            min-height: 100vh;
            -webkit-font-smoothing: antialiased;
        }
        code, .mono {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            font-variant-numeric: tabular-nums;
        }
        a { color: inherit; text-decoration: none; }
        a:hover { color: var(--cyan); text-decoration: underline; }

        /* Top Header */
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--border);
            margin-bottom: 20px;
            flex-wrap: wrap;
            gap: 12px;
        }
        .brand {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .brand-badge {
            background: linear-gradient(135deg, #6366f1, #06b6d4);
            color: #fff;
            padding: 5px 12px;
            border-radius: 6px;
            font-weight: 700;
            font-size: 13px;
            letter-spacing: 0.6px;
            box-shadow: 0 0 12px var(--accent-glow);
        }
        h1 { font-size: 18px; font-weight: 600; letter-spacing: -0.2px; }
        
        .header-actions {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        }
        .chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            background: var(--surface);
            border: 1px solid var(--border);
            color: var(--text-muted);
        }
        .chip-green { background: var(--green-glow); color: var(--green); border-color: rgba(16, 185, 129, 0.3); }
        .chip-amber { background: var(--amber-glow); color: var(--amber); border-color: rgba(245, 158, 11, 0.3); }
        .chip-red { background: var(--red-glow); color: var(--red); border-color: rgba(239, 68, 68, 0.3); }

        .btn {
            background: var(--surface);
            border: 1px solid var(--border);
            color: var(--text-main);
            padding: 5px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s ease;
        }
        .btn:hover { background: var(--surface-hover); border-color: var(--border-light); }
        .btn-primary { background: var(--accent); border-color: var(--accent); color: white; }
        .btn-primary:hover { opacity: 0.9; }

        /* KPI Stat Cards Grid */
        .kpi-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px;
            margin-bottom: 20px;
        }
        .kpi-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 14px 16px;
            position: relative;
            transition: border-color 0.2s ease;
        }
        .kpi-card:hover { border-color: var(--border-light); }
        .kpi-label {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: var(--text-muted);
            margin-bottom: 6px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .kpi-value {
            font-size: 24px;
            font-weight: 700;
            color: var(--text-main);
            line-height: 1.2;
            letter-spacing: -0.5px;
        }
        .kpi-sub {
            font-size: 11px;
            color: var(--text-muted);
            margin-top: 6px;
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
        }

        /* Source Distribution Bar */
        .strip-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 12px 16px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 16px;
            flex-wrap: wrap;
        }
        .strip-label {
            font-size: 12px;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            white-space: nowrap;
        }
        .strip-bar {
            flex: 1;
            min-width: 200px;
            height: 8px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 4px;
            display: flex;
            overflow: hidden;
        }
        .strip-seg { height: 100%; transition: width 0.3s ease; }
        .strip-legend {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 12px;
            color: var(--text-muted);
            flex-wrap: wrap;
        }
        .legend-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
            margin-right: 4px;
        }

        /* Section Layout */
        .section-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin: 24px 0 10px;
        }
        .section-title {
            font-size: 14px;
            font-weight: 600;
            color: var(--text-main);
            letter-spacing: -0.2px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .filter-input {
            background: var(--surface);
            border: 1px solid var(--border);
            color: var(--text-main);
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 12px;
            outline: none;
            width: 220px;
            transition: border-color 0.15s;
        }
        .filter-input:focus { border-color: var(--accent); }

        /* Tables */
        .table-wrap {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            overflow-x: auto;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            text-align: left;
        }
        th {
            background: rgba(255, 255, 255, 0.02);
            color: var(--text-muted);
            font-weight: 600;
            padding: 10px 14px;
            border-bottom: 1px solid var(--border);
            text-transform: uppercase;
            font-size: 10.5px;
            letter-spacing: 0.5px;
        }
        td {
            padding: 12px 14px;
            border-bottom: 1px solid var(--border);
            vertical-align: middle;
        }
        tr:last-child td { border-bottom: none; }
        tbody tr:hover { background: rgba(255, 255, 255, 0.015); }

        /* Track Cell */
        .track-cell {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .track-art {
            width: 38px;
            height: 38px;
            border-radius: 6px;
            object-fit: cover;
            background: #111;
            border: 1px solid var(--border);
            flex-shrink: 0;
        }
        .track-title {
            font-weight: 600;
            color: var(--text-main);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 280px;
        }
        .track-artist {
            color: var(--text-muted);
            font-size: 11px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 280px;
        }

        /* Tags */
        .tag {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 7px;
            border-radius: 4px;
            font-size: 10.5px;
            font-weight: 600;
            letter-spacing: 0.3px;
            text-transform: uppercase;
        }
        .tag-spotify { background: rgba(30, 215, 96, 0.12); color: #1ed760; border: 1px solid rgba(30, 215, 96, 0.25); }
        .tag-youtube { background: rgba(255, 77, 77, 0.12); color: #ff4d4d; border: 1px solid rgba(255, 77, 77, 0.25); }
        .tag-soundcloud { background: rgba(255, 133, 51, 0.12); color: #ff8533; border: 1px solid rgba(255, 133, 51, 0.25); }
        .tag-upload { background: rgba(6, 182, 212, 0.12); color: #06b6d4; border: 1px solid rgba(6, 182, 212, 0.25); }
        .tag-default { background: rgba(255, 255, 255, 0.05); color: var(--text-muted); border: 1px solid var(--border); }

        /* Progress Bar */
        .mini-progress {
            width: 100%;
            height: 4px;
            background: rgba(255, 255, 255, 0.08);
            border-radius: 2px;
            margin-top: 5px;
            overflow: hidden;
        }
        .mini-progress-fill {
            height: 100%;
            background: var(--accent);
            border-radius: 2px;
        }

        /* Auth Overlay */
        #auth-overlay {
            position: fixed;
            inset: 0;
            background: var(--bg);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: 16px;
        }
        .auth-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 28px 24px;
            max-width: 340px;
            width: 100%;
            text-align: center;
        }
        .auth-input {
            width: 100%;
            padding: 10px 12px;
            background: var(--bg);
            border: 1px solid var(--border);
            color: white;
            border-radius: 6px;
            margin: 14px 0;
            font-size: 13px;
            outline: none;
        }
        .auth-input:focus { border-color: var(--accent); }

        /* Toast */
        #toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: var(--surface);
            border: 1px solid var(--border-light);
            color: var(--text-main);
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 12px;
            display: none;
            box-shadow: 0 4px 16px rgba(0,0,0,0.5);
            z-index: 999;
        }
    </style>
</head>
<body>
    <div id="auth-overlay">
        <div class="auth-card">
            <div class="brand-badge" style="display:inline-block; margin-bottom:12px;">RESO MONITOR</div>
            <h2 style="font-size:16px;">Private Dashboard</h2>
            <p style="font-size:12px; color:var(--text-muted); margin-top:6px;">Enter your owner key to inspect real-time audio playback & system health.</p>
            <input type="password" id="auth-key-input" class="auth-input" placeholder="Owner Secret Key" />
            <button class="btn btn-primary" style="width:100%; justify-content:center;" onclick="submitAuth()">Enter Dashboard</button>
            <div id="auth-error" style="color:var(--red); font-size:11px; margin-top:10px; display:none;">Invalid authorization key</div>
        </div>
    </div>

    <div id="toast"></div>

    <header>
        <div class="brand">
            <div class="brand-badge">RESO</div>
            <h1>System & Audio Engine Monitor</h1>
        </div>
        <div class="header-actions">
            <span id="chip-status" class="chip chip-green">🟢 Primary Connected</span>
            <span id="chip-frames" class="chip mono">Frames: 100% OK</span>
            <span id="chip-host" class="chip mono">Host: --</span>
            <span id="chip-uptime" class="chip mono">Up: --</span>
            <select id="poll-interval" class="btn mono" onchange="changeInterval()">
                <option value="2000">2s Live</option>
                <option value="3000" selected>3s Poll</option>
                <option value="5000">5s Poll</option>
                <option value="0">Paused</option>
            </select>
            <button class="btn" onclick="fetchData()">⟳ Refresh</button>
            <button class="btn" onclick="copyMetricsJson()">📋 Copy JSON</button>
            <button class="btn" onclick="logout()" style="color:var(--text-muted);">Logout</button>
        </div>
    </header>

    <!-- KPI Stat Tiles -->
    <div class="kpi-grid">
        <div class="kpi-card">
            <div class="kpi-label">Active Streams</div>
            <div class="kpi-value mono" id="kpi-streams">0</div>
            <div class="kpi-sub" id="kpi-sub-streams">
                <span>0 paused</span> • <span>0 idle</span>
            </div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">
                <span>Audio Frames Health</span>
                <span id="kpi-frames-tag" class="tag tag-spotify" style="font-size:9.5px; padding:1px 5px;">100% OK</span>
            </div>
            <div class="kpi-value mono" id="kpi-frames-quality">100.0%</div>
            <div class="kpi-sub" id="kpi-sub-frames">
                <span id="kpi-frames-sent">0 sent</span> • <span id="kpi-frames-def">0 def</span> • <span id="kpi-frames-nul">0 nul</span>
            </div>
            <div class="mini-progress"><div class="mini-progress-fill" id="kpi-frames-bar" style="width:100%; background:var(--green);"></div></div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Queued Tracks</div>
            <div class="kpi-value mono" id="kpi-queue">0</div>
            <div class="kpi-sub" id="kpi-sub-queue">
                <span id="kpi-bitrate">64 kbps avg</span> • <span id="kpi-filters">0 filters</span>
            </div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Lavalink Node</div>
            <div class="kpi-value mono" id="kpi-lavalink-ping">-- ms</div>
            <div class="kpi-sub" id="kpi-sub-node">
                <span id="kpi-node-role">Primary</span> • <span id="kpi-node-status">Online</span>
            </div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Discord Gateway</div>
            <div class="kpi-value mono" id="kpi-ws-ping">-- ms</div>
            <div class="kpi-sub" id="kpi-sub-discord">
                <span id="kpi-guilds">0 guilds</span> • <span id="kpi-users">0 users</span>
            </div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Host System</div>
            <div class="kpi-value mono" id="kpi-host-load">Load: --</div>
            <div class="kpi-sub" id="kpi-sub-host">
                <span id="kpi-host-mem">RAM: --%</span>
            </div>
            <div class="mini-progress"><div class="mini-progress-fill" id="kpi-host-mem-bar" style="width:0%;"></div></div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Bot Process Memory</div>
            <div class="kpi-value mono" id="kpi-bot-rss">-- MB</div>
            <div class="kpi-sub" id="kpi-sub-bot-heap">
                <span>Heap: -- MB</span>
            </div>
            <div class="mini-progress"><div class="mini-progress-fill" id="kpi-bot-heap-bar" style="width:0%; background:var(--cyan);"></div></div>
        </div>
    </div>

    <!-- Live Source Distribution Bar -->
    <div class="strip-card">
        <div class="strip-label">Music Sources</div>
        <div class="strip-bar">
            <div id="src-bar-spotify" class="strip-seg" style="width:0%; background:#1ed760;"></div>
            <div id="src-bar-youtube" class="strip-seg" style="width:0%; background:#ff4d4d;"></div>
            <div id="src-bar-soundcloud" class="strip-seg" style="width:0%; background:#ff8533;"></div>
            <div id="src-bar-other" class="strip-seg" style="width:0%; background:#6366f1;"></div>
        </div>
        <div class="strip-legend" id="src-legend">
            <span><span class="legend-dot" style="background:#1ed760;"></span>Spotify: <strong id="lbl-spotify">0%</strong></span>
            <span><span class="legend-dot" style="background:#ff4d4d;"></span>YouTube: <strong id="lbl-youtube">0%</strong></span>
            <span><span class="legend-dot" style="background:#ff8533;"></span>SoundCloud: <strong id="lbl-soundcloud">0%</strong></span>
            <span><span class="legend-dot" style="background:#6366f1;"></span>Uploads: <strong id="lbl-other">0%</strong></span>
        </div>
    </div>

    <!-- Nodes Table -->
    <div class="section-bar">
        <div class="section-title">🎵 Lavalink Audio Nodes</div>
    </div>
    <div class="table-wrap">
        <table>
            <thead>
                <tr>
                    <th>Node</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Latency</th>
                    <th>Frame Health</th>
                    <th>CPU (Sys / Lava)</th>
                    <th>RAM Used</th>
                    <th>Active Players</th>
                </tr>
            </thead>
            <tbody id="nodes-tbody">
                <tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:18px;">Connecting to audio nodes...</td></tr>
            </tbody>
        </table>
    </div>

    <!-- Live Sessions Table -->
    <div class="section-bar">
        <div class="section-title">🎧 Active Playback Sessions</div>
        <input type="text" id="session-filter" class="filter-input" placeholder="Search guild, song, artist..." oninput="filterSessions()" />
    </div>
    <div class="table-wrap">
        <table>
            <thead>
                <tr>
                    <th>Server</th>
                    <th>Track / Artist</th>
                    <th>Source</th>
                    <th style="min-width:180px;">Playback Progress</th>
                    <th>Session State</th>
                    <th>Node</th>
                </tr>
            </thead>
            <tbody id="sessions-tbody">
                <tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:24px;">No active music sessions right now. ☕</td></tr>
            </tbody>
        </table>
    </div>

    <script>
        let authKey = new URLSearchParams(window.location.search).get('key') || localStorage.getItem('reso_auth_key') || '';
        let lastData = null;
        let pollTimer = null;

        function formatMs(ms) {
            if (!ms || isNaN(ms)) return '0:00';
            const totalSec = Math.floor(ms / 1000);
            const m = Math.floor(totalSec / 60);
            const s = totalSec % 60;
            return m + ':' + (s < 10 ? '0' : '') + s;
        }

        function showToast(msg) {
            const t = document.getElementById('toast');
            t.innerText = msg;
            t.style.display = 'block';
            setTimeout(() => { t.style.display = 'none'; }, 2400);
        }

        function submitAuth() {
            authKey = document.getElementById('auth-key-input').value.trim();
            localStorage.setItem('reso_auth_key', authKey);
            fetchData();
        }

        function logout() {
            localStorage.removeItem('reso_auth_key');
            location.href = window.location.pathname;
        }

        function changeInterval() {
            if (pollTimer) clearInterval(pollTimer);
            const ms = parseInt(document.getElementById('poll-interval').value, 10);
            if (ms > 0) {
                pollTimer = setInterval(fetchData, ms);
            }
        }

        async function copyMetricsJson() {
            if (!lastData) return;
            try {
                await navigator.clipboard.writeText(JSON.stringify(lastData, null, 2));
                showToast('✓ Metrics JSON copied to clipboard');
            } catch {
                showToast('Could not copy to clipboard');
            }
        }

        async function fetchData() {
            if (!authKey) {
                document.getElementById('auth-overlay').style.display = 'flex';
                return;
            }

            try {
                const res = await fetch('/api/monitor?key=' + encodeURIComponent(authKey));
                if (res.status === 401) {
                    document.getElementById('auth-overlay').style.display = 'flex';
                    document.getElementById('auth-error').style.display = 'block';
                    return;
                }
                const data = await res.json();
                lastData = data;
                document.getElementById('auth-overlay').style.display = 'none';
                renderDashboard(data);
            } catch (err) {
                console.warn('Dashboard fetch error:', err);
            }
        }

        function renderDashboard(data) {
            // Header chips
            document.getElementById('chip-uptime').innerText = 'Up: ' + (data.bot?.uptimeFormatted || '--');
            if (data.host) {
                document.getElementById('chip-host').innerText = data.host.platform + ' ' + data.host.arch + ' • Node ' + data.host.nodeVersion;
            }

            // 1. Streams KPI
            document.getElementById('kpi-streams').innerText = data.activeStreamsCount || 0;
            const paused = data.audio?.pausedStreamsCount || 0;
            const idle = data.audio?.idlePlayersCount || 0;
            const total247 = data.audio?.twentyFourSevenCount || 0;
            const totalAuto = data.audio?.autoplayGuildsCount || 0;
            document.getElementById('kpi-sub-streams').innerHTML = 
                '<span>' + paused + ' paused</span> • <span>' + idle + ' idle</span>' +
                (total247 > 0 ? ' • <span style="color:#6366f1;">🔒 ' + total247 + ' in 24/7</span>' : '') +
                (totalAuto > 0 ? ' • <span style="color:#06b6d4;">🔄 ' + totalAuto + ' auto</span>' : '');

            // 2. Queue KPI
            document.getElementById('kpi-queue').innerText = (data.audio?.totalTracksQueued || 0) + ' Tracks';
            document.getElementById('kpi-bitrate').innerText = (data.audio?.avgBitrateKbps || 64) + ' kbps avg';
            document.getElementById('kpi-filters').innerText = (data.audio?.activeFiltersCount || 0) + ' filter' + (data.audio?.activeFiltersCount !== 1 ? 's' : '');

            // 3. Audio Frames Health KPI
            const primary = (data.nodes || []).find(n => n.isPrimary) || (data.nodes || [])[0];
            const frames = data.audio?.frames || primary?.frames || { sent: 0, nulled: 0, deficit: 0, lossPercent: 0, qualityPercent: 100 };
            const qPct = frames.qualityPercent !== undefined ? frames.qualityPercent : Number((100 - (frames.lossPercent || 0)).toFixed(1));
            const qualityElem = document.getElementById('kpi-frames-quality');
            if (qualityElem) qualityElem.innerText = qPct.toFixed(1) + '%';

            const framesTag = document.getElementById('kpi-frames-tag');
            const framesBar = document.getElementById('kpi-frames-bar');
            if (frames.lossPercent > 5) {
                if (framesTag) { framesTag.className = 'tag tag-youtube'; framesTag.innerText = frames.lossPercent + '% Drop'; }
                if (qualityElem) qualityElem.style.color = '#ef4444';
                if (framesBar) framesBar.style.background = '#ef4444';
            } else if (frames.lossPercent > 1) {
                if (framesTag) { framesTag.className = 'tag tag-soundcloud'; framesTag.innerText = frames.lossPercent + '% Jitter'; }
                if (qualityElem) qualityElem.style.color = '#f59e0b';
                if (framesBar) framesBar.style.background = '#f59e0b';
            } else {
                if (framesTag) { framesTag.className = 'tag tag-spotify'; framesTag.innerText = '100% OK'; }
                if (qualityElem) qualityElem.style.color = '#10b981';
                if (framesBar) framesBar.style.background = '#10b981';
            }
            if (framesBar) framesBar.style.width = Math.max(0, Math.min(100, qPct)) + '%';

            const sentElem = document.getElementById('kpi-frames-sent');
            if (sentElem) sentElem.innerText = (frames.sent ? frames.sent.toLocaleString() : '0') + ' sent';
            const defElem = document.getElementById('kpi-frames-def');
            if (defElem) defElem.innerText = (frames.deficit || 0) + ' def';
            const nulElem = document.getElementById('kpi-frames-nul');
            if (nulElem) nulElem.innerText = (frames.nulled || 0) + ' nul';

            const chipFrames = document.getElementById('chip-frames');
            if (chipFrames) {
                chipFrames.innerText = 'Frames: ' + qPct.toFixed(1) + '% (' + (frames.deficit + frames.nulled) + ' drops)';
            }

            // 4. Lavalink Node KPI
            if (primary) {
                document.getElementById('kpi-lavalink-ping').innerText = (primary.latencyMs != null ? primary.latencyMs + ' ms' : '--');
                const nodeRole = document.getElementById('kpi-node-role');
                if (nodeRole) nodeRole.innerText = primary.id;
                const nodeStatus = document.getElementById('kpi-node-status');
                if (nodeStatus) nodeStatus.innerText = primary.connected ? 'Online' : 'Offline';

                const chipStatus = document.getElementById('chip-status');
                if (primary.connected) {
                    chipStatus.className = 'chip chip-green';
                    chipStatus.innerText = '🟢 Primary Online';
                } else {
                    chipStatus.className = 'chip chip-red';
                    chipStatus.innerText = '🔴 Primary Offline';
                }
            }

            // 5. Discord Gateway KPI
            document.getElementById('kpi-ws-ping').innerText = (data.bot?.wsPingMs || 0) + ' ms';
            document.getElementById('kpi-guilds').innerText = (data.bot?.guildsCount || 0) + ' guilds';
            document.getElementById('kpi-users').innerText = (data.bot?.membersCount || 0) + ' users';

            // 6. Host System KPI
            if (data.host) {
                const load1 = data.host.loadAvg?.[0] !== undefined ? data.host.loadAvg[0] : '--';
                document.getElementById('kpi-host-load').innerText = 'Load: ' + load1;
                document.getElementById('kpi-host-mem').innerText = 'RAM: ' + data.host.memPercent + '% (' + data.host.freeMemMb + 'MB free)';
                document.getElementById('kpi-host-mem-bar').style.width = Math.min(100, data.host.memPercent) + '%';
            }

            // 7. Bot Process Memory KPI
            if (data.bot) {
                document.getElementById('kpi-bot-rss').innerText = data.bot.rssMb + ' MB';
                const heapPct = data.bot.heapTotalMb > 0 ? Math.round((data.bot.heapUsedMb / data.bot.heapTotalMb) * 100) : 0;
                document.getElementById('kpi-sub-bot-heap').innerText = 'Heap: ' + data.bot.heapUsedMb + 'MB / ' + data.bot.heapTotalMb + 'MB (' + heapPct + '%)';
                document.getElementById('kpi-bot-heap-bar').style.width = Math.min(100, heapPct) + '%';
            }

            // Source Distribution Strip
            renderSourceStrip(data);

            // Nodes Table
            renderNodesTable(data.nodes || []);

            // Sessions Table
            renderSessionsTable(data.sessions || []);
        }

        function renderSourceStrip(data) {
            const counts = data.audio?.sourceBreakdown || {};
            const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
            const sp = counts.spotify || 0;
            const yt = (counts.youtube || 0) + (counts.youtubemusic || 0);
            const sc = counts.soundcloud || 0;
            const other = total - sp - yt - sc;

            const spPct = Math.round((sp / total) * 100);
            const ytPct = Math.round((yt / total) * 100);
            const scPct = Math.round((sc / total) * 100);
            const otPct = Math.max(0, 100 - spPct - ytPct - scPct);

            document.getElementById('src-bar-spotify').style.width = spPct + '%';
            document.getElementById('src-bar-youtube').style.width = ytPct + '%';
            document.getElementById('src-bar-soundcloud').style.width = scPct + '%';
            document.getElementById('src-bar-other').style.width = otPct + '%';

            document.getElementById('lbl-spotify').innerText = spPct + '% (' + sp + ')';
            document.getElementById('lbl-youtube').innerText = ytPct + '% (' + yt + ')';
            document.getElementById('lbl-soundcloud').innerText = scPct + '% (' + sc + ')';
            document.getElementById('lbl-other').innerText = otPct + '% (' + (counts.file || other) + ')';
        }

        function renderNodesTable(nodes) {
            const tbody = document.getElementById('nodes-tbody');
            if (nodes.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">No Lavalink nodes configured</td></tr>';
                return;
            }
            tbody.innerHTML = nodes.map(n => {
                const statusPill = n.connected ? '<span class="chip chip-green">Online</span>' : '<span class="chip chip-red">Offline</span>';
                const roleBadge = n.isPrimary ? '<span style="color:#06b6d4; font-weight:700;">PRIMARY</span>' : '<span style="color:var(--text-muted);">BACKUP</span>';
                const f = n.frames || { sent: 0, nulled: 0, deficit: 0, lossPercent: 0 };
                const lossPct = f.lossPercent || 0;
                let frameBadge = '<span class="tag tag-spotify" style="font-size:10px;">100% OK</span>';
                if (lossPct > 5) frameBadge = '<span class="tag tag-youtube" style="font-size:10px;">' + lossPct + '% Loss</span>';
                else if (lossPct > 1) frameBadge = '<span class="tag tag-soundcloud" style="font-size:10px;">' + lossPct + '% Jitter</span>';

                const sentStr = (f.sent || 0).toLocaleString();
                const frameCell = '<div>' + frameBadge + ' <strong class="mono" style="margin-left:4px;">' + sentStr + ' sent</strong></div>' +
                    '<div class="mono" style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">' +
                        'Deficit: <span style="color:' + (f.deficit > 0 ? '#ef4444' : 'inherit') + '">' + (f.deficit || 0) + '</span> • ' +
                        'Nulled: <span style="color:' + (f.nulled > 0 ? '#f59e0b' : 'inherit') + '">' + (f.nulled || 0) + '</span>' +
                    '</div>';

                return '<tr>' +
                    '<td><strong>' + n.id + '</strong><br><small style="color:var(--text-muted);">' + n.host + '</small></td>' +
                    '<td>' + roleBadge + '</td>' +
                    '<td>' + statusPill + '</td>' +
                    '<td class="mono">' + (n.latencyMs != null ? n.latencyMs + 'ms' : '--') + '</td>' +
                    '<td>' + frameCell + '</td>' +
                    '<td class="mono">Sys ' + n.cpuSystem + '% | Lava ' + n.cpuLavalink + '%</td>' +
                    '<td class="mono">' + n.memUsedMb + 'MB / ' + n.memAllocatedMb + 'MB</td>' +
                    '<td><strong>' + n.players + '</strong> active <span style="color:var(--text-muted);">(' + n.totalPlayers + ' total)</span></td>' +
                '</tr>';
            }).join('');
        }

        function renderSessionsTable(sessions) {
            const tbody = document.getElementById('sessions-tbody');
            const filter = (document.getElementById('session-filter')?.value || '').toLowerCase().trim();

            const filtered = sessions.filter(s => {
                if (!filter) return true;
                const gName = (s.guildName || '').toLowerCase();
                const tName = (s.track?.title || '').toLowerCase();
                const aName = (s.track?.author || '').toLowerCase();
                const src = (s.track?.source || '').toLowerCase();
                return gName.includes(filter) || tName.includes(filter) || aName.includes(filter) || src.includes(filter);
            });

            if (filtered.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:24px;">' +
                    (sessions.length > 0 ? 'No sessions match your filter query.' : 'No active music sessions right now. ☕') +
                '</td></tr>';
                return;
            }

            tbody.innerHTML = filtered.map(s => {
                const t = s.track || { title: 'Unknown', author: 'Unknown', source: 'unknown' };
                const progressPct = (s.durationMs > 0) ? Math.min(100, Math.round((s.positionMs / s.durationMs) * 100)) : 0;
                let tagClass = 'tag-default';
                if (t.source === 'spotify') tagClass = 'tag-spotify';
                else if (t.source === 'youtube' || t.source === 'youtubemusic') tagClass = 'tag-youtube';
                else if (t.source === 'soundcloud') tagClass = 'tag-soundcloud';
                else if (t.source === 'file') tagClass = 'tag-upload';

                const stateEmoji = s.paused ? '⏸' : (s.playing ? '▶️' : '⏹');
                const badges = [];
                if (s.is247) badges.push('🔒 24/7');
                if (s.isAutoplay) badges.push('🔄 Auto');
                if (s.queueLength > 0) badges.push('+' + s.queueLength + ' queued');
                if (s.bitrateKbps) badges.push(s.bitrateKbps + 'kbps');

                return '<tr>' +
                    '<td><strong>' + s.guildName + '</strong><br><small class="mono" style="color:var(--text-muted);">ID: ' + s.guildId + '</small></td>' +
                    '<td><div class="track-cell">' +
                        (t.artworkUrl ? '<img src="' + t.artworkUrl + '" class="track-art" loading="lazy" />' : '') +
                        '<div>' +
                            '<div class="track-title"><a href="' + (t.uri || '#') + '" target="_blank">' + t.title + '</a></div>' +
                            '<div class="track-artist">' + t.author + '</div>' +
                        '</div>' +
                    '</div></td>' +
                    '<td><span class="tag ' + tagClass + '">' + t.source + '</span></td>' +
                    '<td>' +
                        '<div class="mono">' + formatMs(s.positionMs) + ' / ' + (t.isStream ? 'Live' : formatMs(s.durationMs)) + ' <span style="color:var(--text-muted);">(' + progressPct + '%)</span></div>' +
                        '<div class="mini-progress"><div class="mini-progress-fill" style="width:' + progressPct + '%;"></div></div>' +
                    '</td>' +
                    '<td>' +
                        '<div>' + stateEmoji + ' ' + s.volume + '% vol</div>' +
                        '<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">' + (badges.join(' • ') || 'Standard') + '</div>' +
                    '</td>' +
                    '<td><code style="color:var(--cyan);">' + s.nodeId + '</code></td>' +
                '</tr>';
            }).join('');
        }

        function filterSessions() {
            if (lastData) renderSessionsTable(lastData.sessions || []);
        }

        // Initial launch
        fetchData();
        changeInterval();
    </script>
</body>
</html>`;
}

/**
 * HTTP request handler for health checks, dashboard, API, and Prometheus metrics
 */
function handleDashboardRequest(req, res, client) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // 1. Plain health check endpoint for container probes
    if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('Reso Music Bot is running 24/7!');
    }

    const expectedKey = (process.env.DASHBOARD_KEY || process.env.OWNER_ID || 'reso').trim();
    const providedKey = (url.searchParams.get('key') || req.headers['x-dashboard-key'] || '').trim();

    // 2. Metrics endpoint (Prometheus format)
    if (pathname === '/metrics') {
        if (process.env.DASHBOARD_KEY && providedKey !== expectedKey) {
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            return res.end('Unauthorized: Valid ?key=... required');
        }
        const metrics = getSystemMetrics(client);
        const promText = generatePrometheusMetrics(metrics);
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        return res.end(promText);
    }

    // 3. API endpoint for live monitor data
    if (pathname === '/api/monitor' || pathname === '/api/stats') {
        if (providedKey !== expectedKey) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Unauthorized' }));
        }
        const metrics = getSystemMetrics(client);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(metrics));
    }

    // 4. Web Dashboard HTML (served at /, /dashboard, or /monitor)
    if (pathname === '/' || pathname === '/dashboard' || pathname === '/monitor') {
        const accept = req.headers?.accept || '';
        // If curl or plain-text health ping to root, return friendly plain text
        if (pathname === '/' && accept.includes('text/plain') && !accept.includes('text/html')) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            return res.end('Reso Music Bot is running 24/7!');
        }
        const html = generateDashboardHtml();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
}

module.exports = {
    getSystemMetrics,
    handleDashboardRequest,
};
