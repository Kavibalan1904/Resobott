const http = require('http');
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
    if (manager?.players) {
        for (const player of manager.players.values()) {
            if (!player || (!player.playing && !player.paused)) continue;
            const current = player.queue?.current;
            const guild = client.guilds.cache.get(player.guildId);
            const source = current ? getEffectiveSource(current, player.guildId) : 'unknown';

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
    }

    const memUsage = process.memoryUsage();

    return {
        timestamp: Date.now(),
        bot: {
            uptime: client.uptime || 0,
            uptimeFormatted: formatUptime(client.uptime),
            wsPingMs: Math.round(client.ws?.ping || 0),
            guildsCount: client.guilds?.cache?.size || 0,
            membersCount: Array.from(client.guilds?.cache?.values() || []).reduce((acc, g) => acc + (g.memberCount || 0), 0),
            heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
            rssMb: Math.round(memUsage.rss / 1024 / 1024),
        },
        nodes: nodeMetrics,
        sessions,
        activeStreamsCount: sessions.filter(s => s.playing).length,
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

    lines.push('# HELP reso_active_streams Current active audio playback streams');
    lines.push('# TYPE reso_active_streams gauge');
    lines.push(`reso_active_streams ${metrics.activeStreamsCount}`);

    lines.push('# HELP reso_total_sessions Total connected music players');
    lines.push('# TYPE reso_total_sessions gauge');
    lines.push(`reso_total_sessions ${metrics.totalSessionsCount}`);

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
 * Generate Grafana-inspired HTML dashboard
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
            --bg: #0b0e14;
            --card-bg: #151922;
            --card-border: #232936;
            --text-main: #f0f3f6;
            --text-muted: #8b949e;
            --accent: #5865F2;
            --accent-cyan: #00d2ff;
            --green: #238636;
            --yellow: #d29922;
            --red: #da3633;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        body { background: var(--bg); color: var(--text-main); padding: 24px; min-height: 100vh; }
        header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid var(--card-border); padding-bottom: 16px; flex-wrap: wrap; gap: 12px; }
        .logo-group { display: flex; align-items: center; gap: 12px; }
        .logo-badge { background: linear-gradient(135deg, #5865F2, #00d2ff); color: white; padding: 6px 14px; border-radius: 8px; font-weight: bold; font-size: 14px; letter-spacing: 0.5px; }
        h1 { font-size: 22px; font-weight: 700; }
        .header-status { display: flex; align-items: center; gap: 16px; font-size: 13px; color: var(--text-muted); }
        .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
        .pill-green { background: rgba(35, 134, 54, 0.2); color: #3fb950; border: 1px solid rgba(35, 134, 54, 0.4); }
        .pill-yellow { background: rgba(210, 153, 34, 0.2); color: #e3b341; border: 1px solid rgba(210, 153, 34, 0.4); }
        .pill-red { background: rgba(218, 54, 51, 0.2); color: #f85149; border: 1px solid rgba(218, 54, 51, 0.4); }

        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 10px; padding: 18px; }
        .card-title { font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.8px; margin-bottom: 8px; }
        .card-value { font-size: 28px; font-weight: 800; }
        .card-subtitle { font-size: 12px; color: var(--text-muted); margin-top: 6px; }

        .section-header { font-size: 16px; font-weight: 700; margin: 28px 0 14px; display: flex; align-items: center; gap: 8px; }

        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; padding: 12px 14px; background: rgba(255,255,255,0.03); color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--card-border); }
        td { padding: 14px; border-bottom: 1px solid var(--card-border); }
        tr:last-child td { border-bottom: none; }
        .table-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 10px; overflow-x: auto; }

        .track-cell { display: flex; align-items: center; gap: 12px; }
        .track-thumb { width: 44px; height: 44px; border-radius: 6px; object-fit: cover; background: #222; }
        .track-info-title { font-weight: 600; color: var(--text-main); margin-bottom: 2px; }
        .track-info-artist { color: var(--text-muted); font-size: 12px; }
        .source-tag { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
        .src-spotify { background: #1db95422; color: #1ed760; border: 1px solid #1db95455; }
        .src-youtube { background: #ff000022; color: #ff4d4d; border: 1px solid #ff000055; }
        .src-soundcloud { background: #ff550022; color: #ff8533; border: 1px solid #ff550055; }

        .progress-bar-bg { width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; margin-top: 6px; overflow: hidden; }
        .progress-bar-fill { height: 100%; background: var(--accent-cyan); border-radius: 3px; }

        #auth-overlay { position: fixed; inset: 0; background: var(--bg); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
        .auth-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; padding: 32px; max-width: 380px; width: 100%; text-align: center; }
        .auth-input { width: 100%; padding: 12px 14px; background: #0b0e14; border: 1px solid var(--card-border); color: white; border-radius: 8px; margin: 16px 0; font-size: 14px; outline: none; }
        .auth-btn { width: 100%; padding: 12px; background: var(--accent); color: white; border: none; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; transition: 0.2s; }
        .auth-btn:hover { opacity: 0.9; }
    </style>
</head>
<body>
    <div id="auth-overlay">
        <div class="auth-card">
            <div class="logo-badge" style="display:inline-block; margin-bottom:12px;">RESO MONITOR</div>
            <h2>Private Dashboard</h2>
            <p style="font-size:13px; color:var(--text-muted); margin-top:6px;">Enter your secret owner key to monitor real-time playback & node health.</p>
            <input type="password" id="auth-key-input" class="auth-input" placeholder="Secret Key" />
            <button class="auth-btn" onclick="submitAuth()">Enter Dashboard</button>
            <div id="auth-error" style="color:#f85149; font-size:12px; margin-top:10px; display:none;">Invalid authorization key</div>
        </div>
    </div>

    <header>
        <div class="logo-group">
            <div class="logo-badge">RESO</div>
            <h1>System & Audio Engine Monitor</h1>
        </div>
        <div class="header-status">
            <span id="live-indicator" class="pill pill-green">🟢 Live Polling (3s)</span>
            <span id="bot-uptime">Uptime: --</span>
            <button onclick="logout()" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:12px; text-decoration:underline;">Logout</button>
        </div>
    </header>

    <div class="grid">
        <div class="card">
            <div class="card-title">Active Streams</div>
            <div class="card-value" id="val-streams">0</div>
            <div class="card-subtitle" id="sub-sessions">0 total sessions</div>
        </div>
        <div class="card">
            <div class="card-title">Lavalink Heartbeat</div>
            <div class="card-value" id="val-lavalink-ping">-- ms</div>
            <div class="card-subtitle" id="sub-lavalink-status">Checking node...</div>
        </div>
        <div class="card">
            <div class="card-title">Audio Frame Quality</div>
            <div class="card-value" id="val-frames-quality">100%</div>
            <div class="card-subtitle" id="sub-frame-drops">0 frame drops / deficit</div>
        </div>
        <div class="card">
            <div class="card-title">Discord WS Ping</div>
            <div class="card-value" id="val-ws-ping">-- ms</div>
            <div class="card-subtitle" id="sub-bot-mem">RAM: -- MB</div>
        </div>
    </div>

    <div class="section-header">🎵 Lavalink Audio Nodes</div>
    <div class="table-card">
        <table>
            <thead>
                <tr>
                    <th>Node</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Latency</th>
                    <th>Frame Health</th>
                    <th>CPU Load</th>
                    <th>Memory</th>
                    <th>Streams</th>
                </tr>
            </thead>
            <tbody id="nodes-tbody">
                <tr><td colspan="8" style="text-align:center; color:var(--text-muted);">Loading node health...</td></tr>
            </tbody>
        </table>
    </div>

    <div class="section-header">🎧 Current Live Playback Sessions</div>
    <div class="table-card">
        <table>
            <thead>
                <tr>
                    <th>Server</th>
                    <th>Track</th>
                    <th>Source</th>
                    <th>Position / Progress</th>
                    <th>Status</th>
                    <th>Node</th>
                </tr>
            </thead>
            <tbody id="sessions-tbody">
                <tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No active music sessions right now.</td></tr>
            </tbody>
        </table>
    </div>

    <script>
        let authKey = new URLSearchParams(window.location.search).get('key') || localStorage.getItem('reso_auth_key') || '';

        function formatMs(ms) {
            if (!ms || isNaN(ms)) return '0:00';
            const totalSec = Math.floor(ms / 1000);
            const m = Math.floor(totalSec / 60);
            const s = totalSec % 60;
            return m + ':' + (s < 10 ? '0' : '') + s;
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
                document.getElementById('auth-overlay').style.display = 'none';
                renderDashboard(data);
            } catch (err) {
                console.warn('Dashboard fetch error:', err);
            }
        }

        function renderDashboard(data) {
            document.getElementById('bot-uptime').innerText = 'Uptime: ' + data.bot.uptimeFormatted;
            document.getElementById('val-streams').innerText = data.activeStreamsCount;
            document.getElementById('sub-sessions').innerText = data.totalSessionsCount + ' server session' + (data.totalSessionsCount !== 1 ? 's' : '');
            document.getElementById('val-ws-ping').innerText = data.bot.wsPingMs + ' ms';
            document.getElementById('sub-bot-mem').innerText = 'Bot RAM: ' + data.bot.rssMb + ' MB (Heap: ' + data.bot.heapUsedMb + 'MB)';

            // Node summaries
            const primary = data.nodes.find(n => n.isPrimary) || data.nodes[0];
            if (primary) {
                document.getElementById('val-lavalink-ping').innerText = (primary.latencyMs != null ? primary.latencyMs + ' ms' : '--');
                document.getElementById('sub-lavalink-status').innerText = primary.connected ? '🟢 Connected (' + primary.id + ')' : '🔴 Disconnected';

                const frameLoss = primary.frames.lossPercent;
                const qualityElem = document.getElementById('val-frames-quality');
                qualityElem.innerText = (100 - frameLoss).toFixed(1) + '%';
                if (frameLoss > 5) {
                    qualityElem.style.color = '#f85149';
                } else if (frameLoss > 1) {
                    qualityElem.style.color = '#e3b341';
                } else {
                    qualityElem.style.color = '#3fb950';
                }
                document.getElementById('sub-frame-drops').innerText = primary.frames.deficit + ' deficit / ' + primary.frames.nulled + ' nulled frames';
            }

            // Nodes Table
            const nodesTbody = document.getElementById('nodes-tbody');
            if (data.nodes.length === 0) {
                nodesTbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No Lavalink nodes configured</td></tr>';
            } else {
                nodesTbody.innerHTML = data.nodes.map(n => {
                    const statusPill = n.connected ? '<span class="pill pill-green">Online</span>' : '<span class="pill pill-red">Offline</span>';
                    const roleBadge = n.isPrimary ? '<span style="color:#00d2ff; font-weight:700;">PRIMARY</span>' : '<span style="color:#8b949e;">BACKUP</span>';
                    const frameLossTag = n.frames.lossPercent > 2 ? '<span style="color:#f85149; font-weight:700;">' + n.frames.lossPercent + '% Drop</span>' : '<span style="color:#3fb950;">100% OK</span>';
                    return '<tr>' +
                        '<td><strong>' + n.id + '</strong><br><small style="color:#8b949e;">' + n.host + '</small></td>' +
                        '<td>' + roleBadge + '</td>' +
                        '<td>' + statusPill + '</td>' +
                        '<td><code>' + (n.latencyMs != null ? n.latencyMs + 'ms' : '--') + '</code></td>' +
                        '<td>' + frameLossTag + '</td>' +
                        '<td>Sys: ' + n.cpuSystem + '% | Lava: ' + n.cpuLavalink + '%</td>' +
                        '<td>' + n.memUsedMb + ' MB / ' + n.memAllocatedMb + ' MB</td>' +
                        '<td><strong>' + n.players + '</strong> active (' + n.totalPlayers + ' total)</td>' +
                    '</tr>';
                }).join('');
            }

            // Sessions Table
            const sessionsTbody = document.getElementById('sessions-tbody');
            if (data.sessions.length === 0) {
                sessionsTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:24px;">No active music sessions right now. ☕</td></tr>';
            } else {
                sessionsTbody.innerHTML = data.sessions.map(s => {
                    const t = s.track || { title: 'Unknown', author: 'Unknown', source: 'unknown' };
                    const progressPercent = (s.durationMs > 0) ? Math.min(100, Math.round((s.positionMs / s.durationMs) * 100)) : 0;
                    const srcClass = t.source === 'spotify' ? 'src-spotify' : (t.source === 'youtube' || t.source === 'youtubemusic' ? 'src-youtube' : 'src-soundcloud');
                    const statusText = s.paused ? '⏸ Paused' : (s.playing ? '▶️ Playing' : '⏹ Idle');

                    return '<tr>' +
                        '<td><strong>' + s.guildName + '</strong><br><small style="color:#8b949e;">ID: ' + s.guildId + '</small></td>' +
                        '<td><div class="track-cell">' +
                            (t.artworkUrl ? '<img src="' + t.artworkUrl + '" class="track-thumb" />' : '') +
                            '<div><div class="track-info-title">' + t.title + '</div><div class="track-info-artist">' + t.author + '</div></div>' +
                        '</div></td>' +
                        '<td><span class="source-tag ' + srcClass + '">' + t.source + '</span></td>' +
                        '<td style="min-width:160px;">' +
                            '<div>' + formatMs(s.positionMs) + ' / ' + (t.isStream ? 'Live' : formatMs(s.durationMs)) + ' (' + progressPercent + '%)</div>' +
                            '<div class="progress-bar-bg"><div class="progress-bar-fill" style="width:' + progressPercent + '%;"></div></div>' +
                        '</td>' +
                        '<td>' + statusText + ' (' + s.volume + '%)</td>' +
                        '<td><code>' + s.nodeId + '</code></td>' +
                    '</tr>';
                }).join('');
            }
        }

        // Initial fetch and auto-refresh loop
        fetchData();
        setInterval(fetchData, 3000);
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
        // Optional key check for /metrics: only require if DASHBOARD_KEY is set and user specifies secure metrics
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
