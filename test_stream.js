const { Player } = require('discord-player');
const { Client, GatewayIntentBits } = require('discord.js');

async function test() {
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    const player = new Player(client);

    await player.extractors.loadDefault();
    // await player.extractors.register((await import('discord-player-youtubei')).YoutubeiExtractor, {});

    console.log("Searching...");
    const res = await player.search("Shape of you");
    console.log("Found:", res.tracks[0]?.title);

    const bridge = player.extractors.get('YouTubeExtractor');
    console.log("Stream info:", bridge.constructor.name);

    client.destroy();
    process.exit(0);
}

test().catch(console.error);
