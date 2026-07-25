const { Player } = require('discord-player');
const { Client, GatewayIntentBits } = require('discord.js');

async function test() {
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    const player = new Player(client);
    await player.extractors.loadDefault((ext) => ext !== 'YouTubeExtractor');
    const { YoutubeiExtractor } = await import('discord-player-youtubei');
    await player.extractors.register(YoutubeiExtractor, {});

    console.log("Searching...");
    const res = await player.search("Shape of you");
    const track = res.tracks[0];
    console.log("Found:", track?.title);

    try {
        console.log("Getting stream...");
        const stream = await player.extractors.get('YoutubeiExtractor').createStream(track);
        console.log("Stream generated successfully!");
    } catch (e) {
        console.error("Stream generation failed:", e.message);
    }

    client.destroy();
    process.exit(0);
}

test().catch(console.error);
