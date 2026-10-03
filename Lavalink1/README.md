# 🎵 24/7 Lavalink v4 Server Deployment Kit for Render & Cloud

Production-ready, memory-optimized Lavalink v4 server configuration tailored for **24/7 Cloud Hosting** (Render, Koyeb, Discloud, VPS) with zero-drop audio buffering, YouTube Music InnerTube plugins, and LavaSrc integrations.

---

## ⚡ What Was Optimized & Fixed
- **Health Check Route Fixed:** Changed health check path to `/version` (Lavalink's `/v4/info` requires authentication and causes Render deployments to fail with 401).
- **HTTP/1.1 WebSocket Stability:** Disabled `http2` in `application.yml` so reverse proxies (Render, Cloudflare) handle WebSocket upgrade handshakes seamlessly without dropping.
- **Low-Latency GC & Memory Capping:** Set JVM heap `-Xmx384m` with G1GC and `-XX:MaxGCPauseMillis=20` to prevent memory overconsumption from crashing 512MB free tier containers.
- **Dynamic Port Support:** Configured `port: ${PORT:8080}` to automatically adapt to Render/Koyeb environment variables.
- **Jitter Cushioning:** Set `bufferDurationMs: 1500` and `frameBufferDurationMs: 5000` for low-latency playback without audio stutter.

---

## 🚀 How to Deploy on Render.com (Free 24/7)

1. **Commit and Push changes to GitHub:**
   ```bash
   git add .
   git commit -m "Optimize Lavalink v4 for 24/7 Render deployment"
   git push origin main
   ```

2. Go to **[dashboard.render.com](https://dashboard.render.com)**.
3. Click **New +** → select **Web Service**.
4. Connect your repository: **`Kavibalan1904/Lavalink1`**.
5. Render will automatically detect `render.yaml` & `Dockerfile`:
   - **Name:** `reso-lavalink`
   - **Region:** `Singapore` (lowest latency for India & Asia)
   - **Environment:** `Docker`
   - **Instance Type:** `Free` ($0/month)
6. Click **Deploy Web Service**.

---

## ⏰ Keeping it 24/7 Active (Prevent Sleeping)

Render's Free Tier spins down web services after 15 minutes of inactivity. To keep your Lavalink node active 24/7 with zero downtime:

1. Copy your Render web service URL (e.g., `https://reso-lavalink-xxxx.onrender.com`).
2. Go to **[cron-job.org](https://cron-job.org)** or **[UptimeRobot](https://uptimerobot.com)** (100% free).
3. Create a new monitor/cron job:
   - **URL to Ping:** `https://reso-lavalink-xxxx.onrender.com/version`
   - **Execution Interval:** Every **10 minutes**
4. This ensures your Lavalink server never sleeps and is always hot and ready for your bot!

---

## 🔌 Connecting to Resobot

In your bot's `.env` file, configure your primary node:

```env
LAVALINK_HOST=reso-lavalink-xxxx.onrender.com
LAVALINK_PORT=443
LAVALINK_PASSWORD=youshallnotpass
LAVALINK_SECURE=true
```

---

## 🛠 Plugins & Sources Included
- **YouTube Plugin (`dev.lavalink.youtube:youtube-plugin:1.18.2`):** Direct multi-client YouTube playback (Music, Android, TV, Web).
- **LavaSrc Plugin (`com.github.topi314.lavasrc:lavasrc-plugin:4.8.3`):** Spotify, Apple Music, SoundCloud metadata resolution.
- **Default Password:** `youshallnotpass`
