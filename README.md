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

## 🚀 Deploy to HeavenCloud

1. **Sign up** at [heavencloud.in](https://heavencloud.in)
2. **Create a new server** → Select **Node.js** as the runtime
3. **Upload your files** via the File Manager or SFTP:
   - Upload the entire project folder (`src/`, `package.json`, `.env`, etc.)
   - ⚠️ Do NOT upload `node_modules/` — it will be installed on the server
4. **Open the Console** and run:
   ```bash
   npm install
   ```
5. **Set environment variables** in the `.env` file via the File Manager
6. **Start the bot** — click the Start button or run `npm start` in the console
7. ✅ Your bot is now live 24/7!

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
