const { Player, QueryType } = require('discord-player');
const { Client, GatewayIntentBits } = require('discord.js');

async function test() {
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    const player = new Player(client);
    
    await player.extractors.loadDefault();

    console.log("Searching SoundCloud...");
    const res = await player.search("on my way", {
        searchEngine: QueryType.SOUNDCLOUD_SEARCH
    });
    const track = res.tracks[0];
    console.log("Found:", track?.title);

    try {
        console.log("Getting stream...");
        const stream = await player.extractors.get('SoundCloudExtractor').createStream(track);
        console.log("Stream generated successfully!");
    } catch (e) {
        console.error("Stream generation failed:", e.message);
    }

    client.destroy();
    process.exit(0);
}

test().catch(console.error);
