# 24/7 Cloud Lavalink Deployment Guide (Free)

Deploy your own private Lavalink server in **under 2 minutes** using **Hugging Face Spaces** (100% Free, 16GB RAM, 24/7 Uptime, 0ms packet drops).

---

## 🚀 Steps to Deploy (2 Minutes)

### 1. Create a Free Space
1. Go to **[huggingface.co/spaces](https://huggingface.co/spaces)** (sign up for free if needed).
2. Click **Create new Space**.
3. Fill in:
   - **Space name:** `reso-lavalink`
   - **License:** `mit` (or choose anything)
   - **Space SDK:** Select **Docker** → choose **Blank**.
   - **Space hardware:** Keep the default **Free (2 vCPU, 16GB RAM)**.
4. Click **Create Space**.

---

### 2. Upload the 2 Files
1. On your new Space page, click the **Files** tab → click **Add file** → **Upload files**.
2. Drag and drop these 2 files from your project's `deploy/` folder:
   - `deploy/Dockerfile`
   - `deploy/application.yml`
3. Click **Commit changes to main**.

---

### 3. Copy URL to your `.env`
1. Hugging Face will automatically build and start the server (takes ~30 seconds).
2. On your Space page, click the **three dots menu (`...`)** at top right → click **Embed this Space** (or look at your Space URL).
3. Your host URL will look like:
   ```text
   <your-username>-reso-lavalink.hf.space
   ```
4. Update your bot's [`.env`](../.env):
   ```env
   LAVALINK_HOST=<your-username>-reso-lavalink.hf.space
   LAVALINK_PORT=443
   LAVALINK_PASSWORD=youshallnotpass
   LAVALINK_SECURE=true
   ```

---

## ✅ Result
- **100% Dedicated 24/7 Server:** Only your Reso bot uses this node (0 other bots sharing bandwidth).
- **16 GB RAM & 2 vCPUs:** High-performance Opus audio encoding.
- **Zero Audio Breaks / Jitter:** 1000ms audio buffer + 5000ms frame buffer eliminates all playback stuttering.
