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
    console.log("Found:", res.tracks[0]?.title);
    
    if (res.tracks.length > 0) {
        console.log("Track source:", res.tracks[0].source);
        const bridge = player.extractors.get('YoutubeiExtractor');
        console.log("Bridge:", bridge ? 'Exists' : 'None');
    }

    client.destroy();
    process.exit(0);
}

test().catch(console.error);
