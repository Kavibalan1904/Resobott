# 🎵 Reso — High-Quality Discord Music Bot

**Reso** (short for *Resonance*) is a feature-rich Discord music bot built with discord.js v14 and discord-player v6. It supports YouTube, Spotify, SoundCloud, Apple Music, and more — with premium audio quality and a beautiful embed interface.

---

## ✨ Features

- 🎶 **Multi-source streaming** — YouTube, Spotify, SoundCloud, Apple Music, Vimeo, etc.
- 🔊 **16 audio filters** — Bass Boost, Nightcore, 8D, Vaporwave, Lo-Fi, and more
- 📋 **Full queue management** — shuffle, remove, move, skip-to, pagination
- 🔁 **Loop modes** — Off, Track, Queue, Autoplay
- 📝 **Lyrics** — Powered by Genius
- 🎧 **24/7 mode** — Stay in voice channel indefinitely
- 💾 **Grab** — Save song details to your DMs
- ⚡ **28 slash commands** — Modern Discord interaction

---

## 📦 Setup

### 1. Prerequisites

- **Node.js 18+** installed
- A **Discord Bot Token** from [Discord Developer Portal](https://discord.com/developers/applications)
- Enable these **Gateway Intents** in the Developer Portal:
  - ✅ Server Members Intent (optional)
  - ✅ Message Content Intent (optional)

### 2. Configure Environment

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:
```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_bot_client_id_here
DEFAULT_VOLUME=50
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Start the Bot

```bash
npm start
```

---

## 🚀 Deployment & Hosting Guides

### 🌩️ Wispbyte & Game Panels (Pterodactyl / Wisp)
This bot has been optimized with strict V8 garbage collection and global exception handlers to prevent Out-of-Memory (OOM) crashes on Wispbyte and Pterodactyl panels.
1. Create a **Node.js** server on your Wispbyte/Pterodactyl dashboard.
2. Go to **Startup** ➔ Set **Startup Command** to:
   ```bash
   npm run start:wisp
   ```
   *(This applies V8 `--optimize_for_size` and `--max-old-space-size=460` flags to prevent memory limit crashes).*
3. Upload your project files (without `node_modules/`) or link your GitHub repository.
4. Go to **Environment / Variables** and add your `DISCORD_TOKEN`, `CLIENT_ID`, and Lavalink credentials.
5. Click **Start**!

### 🚂 Railway.app
1. Create a new project on [Railway.app](https://railway.app/) ➔ **"Deploy from GitHub repo"**.
2. Railway automatically detects `railway.json` and uses the Nixpacks Node 20 builder.
3. In the **Variables** tab, add your `DISCORD_TOKEN`, `CLIENT_ID`, and Lavalink environment variables.

### ☁️ DisCloud (100% Free Discord Bot Hosting)
1. Go to [DisCloud App](https://discloud.app) and sign in with Discord.
2. Connect your GitHub repository `Kavibalan1904/Resobott` or upload a `.zip` of the project files.
3. DisCloud automatically detects `discloud.config` in the root folder.
4. Go to **Environment Variables** and add your `DISCORD_TOKEN`, `CLIENT_ID`, and Lavalink credentials.
5. Click **Start**!

### ☁️ Render.com
1. Create a **New Blueprint Instance** or **Web Service** on [Render.com](https://render.com/).
2. Render uses `render.yaml` and starts a built-in HTTP health check server on port `10000` so your deployment passes port scans.
3. Add your bot token in **Environment Variables**. You can plug your Render URL into [UptimeRobot](https://uptimerobot.com/) for 24/7 free uptime!

---


## 🎵 Commands

### Playback
| Command | Description |
|---|---|
| `/play <query>` | Play a song or playlist |
| `/pause` | Pause playback |
| `/resume` | Resume playback |
| `/stop` | Stop and disconnect |
| `/skip` | Skip current track |
| `/back` | Previous track |
| `/seek <time>` | Seek to position |
| `/nowplaying` | Show current track |
| `/replay` | Restart current track |

### Queue
| Command | Description |
|---|---|
| `/queue [page]` | View the queue |
| `/shuffle` | Shuffle queue |
| `/clear` | Clear queue |
| `/remove <pos>` | Remove a track |
| `/move <from> <to>` | Move a track |
| `/skipto <pos>` | Skip to position |
| `/loop <mode>` | Set loop mode |

### Audio
| Command | Description |
|---|---|
| `/volume [level]` | Get/set volume |
| `/filter <name>` | Toggle a filter |
| `/filters` | View all filters |

### DJ & Tools
| Command | Description |
|---|---|
| `/247` | Toggle 24/7 mode |
| `/join` | Join voice channel |
| `/leave` | Leave voice channel |
| `/grab` | Save song to DMs |
| `/lyrics [query]` | Show lyrics |

### Utility
| Command | Description |
|---|---|
| `/help [command]` | Show commands |
| `/ping` | Bot latency |
| `/stats` | Bot statistics |
| `/invite` | Invite link |

---

## 🛠️ Tech Stack

- **[discord.js](https://discord.js.org/)** v14 — Discord API wrapper
- **[discord-player](https://discord-player.js.org/)** v6 — Music framework
- **[@discord-player/extractor](https://www.npmjs.com/package/@discord-player/extractor)** — Multi-platform extractors
- **[genius-lyrics](https://www.npmjs.com/package/genius-lyrics)** — Lyrics search

---

## 📄 License

MIT © Reso
