# 🎵 Reso — High-Quality Discord Music Bot

**Reso** (short for *Resonance*) is a feature-rich, high-performance Discord music bot powered by **Lavalink v4** and **discord.js v14**. It supports YouTube, Spotify, SoundCloud, Apple Music, and more — with interactive button controls, audio filters, autoplay, and a sleek embed interface.

---

## ✨ Features

- 🎶 **Multi-source streaming** — YouTube, YouTube Music, Spotify, SoundCloud, Apple Music, and more
- 🎮 **Interactive Player Buttons** — Play/Pause, Skip, Back, Shuffle, and Stop directly from the Now Playing embed
- 🔄 **Autoplay Mode** — Automatically finds and queues similar songs when your queue ends
- ⏩ **Speed Control** — Adjust playback speed (0.5x to 2.0x) with pitch preservation
- 📌 **Play Next** — Priority queue insertion to play your song next
- 🗳️ **Democratic Vote Skip** — Vote-based skipping for group voice sessions
- 🔊 **11 Audio Filters** — Bass Boost, Nightcore, 8D, Vaporwave, Lo-Fi, Karaoke, and more
- 📋 **Full Queue Management** — Shuffle, remove, move, skip-to, pagination, total duration calculation
- 🔁 **Loop Modes** — Track, Queue, or Off
- 📝 **Lyrics Search** — Powered by Genius
- 🎧 **24/7 Mode** — Keep the bot in voice channel indefinitely
- 💾 **Grab** — Save track information to your DMs
- ⚡ **34 Slash Commands** — Modern Discord interactions with auto-complete

---

## 📦 Setup & Installation

### 1. Prerequisites
- **Node.js 18+** installed
- A **Discord Bot Token** and **Client ID** from the [Discord Developer Portal](https://discord.com/developers/applications)

### 2. Configure Environment
Copy the `.env.example` template:
```bash
cp .env.example .env
```
Edit `.env` and fill in your credentials:
```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
DEFAULT_VOLUME=50
LAVALINK_HOST=lava-v4.millohost.my.id
LAVALINK_PORT=443
LAVALINK_PASSWORD=https://discord.gg/mjS5J2K3ep
LAVALINK_SECURE=true
```

### 3. Install Dependencies & Start
```bash
npm install
npm start
```

---

## 🚀 Hosting on bot-hosting.net (Pterodactyl Panel)

1. Create a **Node.js** server on [bot-hosting.net](https://bot-hosting.net/).
2. In the **Files** manager:
   - Upload your project files (or clone your GitHub repository).
   - Create or upload your `.env` file with your credentials.
3. In the **Startup** tab:
   - Main File: `index.js`
4. Click **Start**!

---

## 🎵 Commands

### Playback & Controls
| Command | Description |
|---|---|
| `/play <query> [source]` | Play a song or playlist (YouTube, YT Music, Spotify, SoundCloud, Apple Music) |
| `/playnext <query>` | Add a song to play next (front of queue) |
| `/pause` | Pause playback |
| `/resume` | Resume playback |
| `/stop` | Stop playback and disconnect |
| `/skip` | Skip the current track |
| `/voteskip` | Start a democratic vote to skip current track |
| `/back` | Play the previous track from history |
| `/seek <time>` | Seek to a specific timestamp |
| `/speed <multiplier>` | Change playback speed (0.5x to 2.0x) |
| `/nowplaying` | Show current track with interactive controls |
| `/replay` | Restart the current track from beginning |

### Queue & Discovery
| Command | Description |
|---|---|
| `/queue [page]` | View current queue with total duration and source tags |
| `/autoplay` | Toggle automatic recommendations queueing |
| `/recommend` | Get song recommendations based on current track |
| `/search <query>` | Search and pick from top 10 results |
| `/shuffle` | Shuffle the queue |
| `/clear` | Clear all tracks from the queue |
| `/remove <position>` | Remove a track from the queue |
| `/move <from> <to>` | Move a track to a new position |
| `/skipto <position>` | Skip directly to a specific track |
| `/loop <mode>` | Set loop mode (Off, Track, Queue) |

### Audio & Customization
| Command | Description |
|---|---|
| `/volume [level]` | View or set playback volume (0-100) |
| `/filter <name>` | Toggle an audio filter (Bass Boost, Nightcore, 8D, Lo-Fi, etc.) |
| `/filters` | List all available filters and active status |

### Utilities & Tools
| Command | Description |
|---|---|
| `/247` | Toggle 24/7 voice channel mode |
| `/join` | Summon the bot to your voice channel |
| `/leave` | Disconnect the bot from voice channel |
| `/grab` | Send current song details to your DMs |
| `/lyrics [query]` | Fetch song lyrics |
| `/help [command]` | Interactive help menu |
| `/ping` | Check bot & WebSocket latency |
| `/stats` | View memory, player, and node statistics |
| `/invite` | Get bot invite link |

---

## 🛠️ Tech Stack

- **[discord.js](https://discord.js.org/)** v14 — Discord API interaction
- **[lavalink-client](https://github.com/Tomato6966/lavalink-client)** v2 — Lavalink v4 audio client
- **[genius-lyrics](https://www.npmjs.com/package/genius-lyrics)** — Lyrics search

---

## 📄 License

MIT © Reso
