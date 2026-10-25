# 🎵 Reso — High-Quality Discord Music Bot

**Reso** (short for *Resonance*) is a feature-rich, high-performance Discord music bot powered by **Lavalink v4** and **discord.js v14**. It supports YouTube, Spotify, SoundCloud, Apple Music, and more — with interactive button controls, audio filters, autoplay, and a sleek embed interface.

---

## ✨ Features

- 🎧 **AI Music DJ (`/vibe`)** — Interpret natural language requests ("relaxing 2000s Tamil melodies", "ranked gaming hype EDM") and generate curated, deduplicated playlists with interactive previews and preference feedback
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
- ⚡ **35 Slash Commands** — Modern Discord interactions with auto-complete and prefix support

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
| `>play <query> [source]` | Play a song or playlist (YouTube, YT Music, Spotify, SoundCloud, Apple Music) |
| `>playnext <query>` | Add a song to play next (front of queue) |
| `>pause` | Pause playback |
| `>resume` | Resume playback |
| `>stop` | Stop playback and disconnect |
| `>skip` | Skip the current track |
| `>voteskip` | Start a democratic vote to skip current track |
| `>back` | Play the previous track from history |
| `>seek <time>` | Seek to a specific timestamp |
| `>speed <multiplier>` | Change playback speed (0.5x to 2.0x) |
| `>nowplaying` | Show current track with interactive controls |
| `>replay` | Restart the current track from beginning |

### Queue & Discovery
| Command | Description |
|---|---|
| `>vibe <request> [count]` | 🎧 **AI DJ**: Generate smart playlists matching any vibe, mood, or era |
| `>voicedj [action]` | 🎙️ **Voice DJ**: Spotify AI DJ-style track intros with background caching & zero delay |
| `>queue [page]` | View current queue with total duration and source tags |
| `>autoplay` | Toggle automatic recommendations queueing |
| `>recommend` | Get song recommendations based on current track |
| `>search <query>` | Search and pick from top 10 results |
| `>shuffle` | Shuffle the queue |
| `>clear` | Clear all tracks from the queue |
| `>remove <position>` | Remove a track from the queue |
| `>move <from> <to>` | Move a track to a new position |
| `>skipto <position>` | Skip directly to a specific track |
| `>loop <mode>` | Set loop mode (Off, Track, Queue) |

### Audio & Customization
| Command | Description |
|---|---|
| `>volume [level]` | View or set playback volume (0-100) |
| `>filter <name>` | Toggle an audio filter (Bass Boost, Nightcore, 8D, Lo-Fi, etc.) |
| `>filters` | List all available filters and active status |

### Utilities & Tools
| Command | Description |
|---|---|
| `>247` | Toggle 24/7 voice channel mode |
| `>join` | Summon the bot to your voice channel |
| `>leave` | Disconnect the bot from voice channel |
| `>grab` | Send current song details to your DMs |
| `>lyrics [query]` | Fetch song lyrics |
| `>help [command]` | Interactive help menu |
| `>ping` | Check bot & WebSocket latency |
| `>stats` | View memory, player, and node statistics |
| `>invite` | Get bot invite link |
| `>setchannel [action]` | Set this channel as the designated bot channel (or remove restriction) |

---

## 🎧 Reso AI Music DJ

Reso includes an intelligent, production-quality AI Music DJ that interprets natural-language music requests and curates tailored playlists using Reso's existing Lavalink audio nodes and search engine.

### Example Requests
* `>vibe Play relaxing Tamil melodies from the 2000s`
* `>vibe Give me energetic music for ranked gaming`
* `>vibe Play nostalgic Tamil songs from the 1990s`
* `>vibe Make a chill English indie playlist with 15 songs`
* `>vibe Find songs similar to the current track`
* `>vibe Give me upbeat songs without sad romantic tracks`
* `>vibe Create a 12-song midnight lo-fi study playlist`

Or via Slash Command:
`/vibe request:"late-night Tamil melodies from the 2000s" count:12`

### Interactive Controls
Every generated vibe presents a rich preview embed with interactive buttons:
* **➕ Add to Queue**: Safely enqueues the tracks to your current session without interrupting any currently playing song.
* **🔀 Add & Shuffle**: Adds the curated tracks and instantly shuffles the queue.
* **❌ Cancel**: Cancels the playlist request without modifying the queue.
* **👍 More like this**: Records your preference to favor this artist/mood in future DJ sessions.
* **👎 Less like this**: Reduces this artist/mood in future sessions.

### Provider Configuration
The AI DJ supports Google Gemini and any OpenAI-compatible provider (Groq, OpenRouter, Ollama) via native HTTP REST without external heavyweight dependencies.

Configure in `.env`:
```env
# AI Provider: "gemini" (default) or "openai"
AI_PROVIDER=gemini
AI_API_KEY=your_api_key_here
AI_MODEL=gemini-2.0-flash
# AI_BASE_URL=https://api.openai.com/v1 # Optional custom endpoint
```

### Running Without AI Credentials (Offline Fallback)
AI is completely optional! If `AI_API_KEY` is not provided (or if the AI service experiences a timeout or network glitch), Reso automatically switches to its deterministic offline rule engine. It recognizes moods, languages, decades, genres, and negative exclusions locally with zero API cost.

### Testing Locally
Reso includes an automated test suite verifying intent parsing, deduplication, queue safety, timeouts, and preference isolation:
```bash
npm test
```

### Known Limitations
* Track discovery relies on Lavalink's configured search providers (YouTube / YouTube Music).
* Highly niche independent releases with unusual spelling may fall back to broader genre hits.
* Live streams and videos shorter than 30s or longer than 20m are automatically excluded to preserve playlist pacing.

### Deployment & Rollback Instructions
* **Deploy**: Upload files or pull `main`, ensure `.env` contains your Discord token and Lavalink credentials, run `npm test` to verify, and start with `npm start`.
* **Rollback**: To disable AI features instantly, simply remove `AI_API_KEY` from `.env` and restart the bot — Reso will automatically operate via its offline deterministic rules without any downtime.

---

## 🎙️ Spotify-Style AI Voice DJ

Reso introduces an authentic **Spotify-Style AI Voice DJ** that introduces upcoming tracks in your voice channel with charismatic radio personality, requester shoutouts, and contextual track commentary.

### Key Features
* **Background Pre-Caching**: Synthesizes announcements asynchronously while the current song is playing, guaranteeing zero interruption or transition lag.
* **Studio Human Radio Voices**: Native integration with **OpenAI Audio TTS** (voice: `onyx` - deep, velvety radio host just like Spotify DJ Xavier) and **ElevenLabs** (voice: `brian` / `adam`).
* **Flexible Modes**:
  * `both`: Plays studio voice in VC and renders a speech bubble inside the Now Playing embed.
  * `voice`: Broadcasts radio commentary directly into your voice channel.
  * `text`: Silent chat mode (renders Spotify DJ speech bubble in Now Playing without voice audio).
* **Zero-Delay Fallback**: If an external TTS provider fails or is not configured, Reso instantly falls back to its deterministic radio lines and web speech synthesizer.

### Configuration
```env
# Optional: Studio Voice Engines for deep, human radio DJ speech
OPENAI_API_KEY=your_openai_key_here     # Model tts-1 (voice: onyx)
ELEVENLABS_API_KEY=your_elevenlabs_key  # Model eleven_turbo_v2_5 (voice: Brian)
```

### Slash Commands
* `/voicedj action:toggle` — Turn Voice DJ on or off for the server
* `/voicedj action:status` — Check active voice engine, mode, frequency, and settings
* `/voicedj action:mode mode:both` — Switch between `both`, `voice`, or `text`
* `/voicedj action:voice voice:onyx` — Select your DJ personality (DJ Xavier, Brian, Nova, Echo, etc.)
* `/voicedj action:frequency frequency:every_2` — Control how often the DJ speaks
* `/voicedj action:preview` — Test a live radio broadcast in your voice channel immediately

---

## 🛠️ Tech Stack

- **[discord.js](https://discord.js.org/)** v14 — Discord API interaction
- **[lavalink-client](https://github.com/Tomato6966/lavalink-client)** v2 — Lavalink v4 audio client
- **[genius-lyrics](https://www.npmjs.com/package/genius-lyrics)** — Lyrics search

---

## 📄 License

MIT © Reso
