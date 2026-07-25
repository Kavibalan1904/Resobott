const { Player, QueryType } = require('discord-player');
const { BridgeProvider, BridgeSource } = require('@discord-player/extractor');
const { Client, GatewayIntentBits } = require('discord.js');

async function test() {
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    const player = new Player(client, {
        bridgeProvider: new BridgeProvider(BridgeSource.SoundCloud)
    });
    
    await player.extractors.loadDefault();

    console.log("Searching...");
    const res = await player.search("on my way", {
        searchEngine: QueryType.SPOTIFY_SEARCH
    });
    const track = res.tracks[0];
    console.log("Found:", track?.title);

    try {
        console.log("Getting stream...");
        const stream = await player.extractors.get('SpotifyExtractor').createStream(track);
        console.log("Stream generated successfully! Stream constructor:", stream.constructor.name);
    } catch (e) {
        console.error("Stream generation failed:", e.message);
    }

    client.destroy();
    process.exit(0);
}

test().catch(console.error);
