const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, createEmbed, EMOJIS, capitalize } = require('../../utils/embeds');
const { getVoiceChannel, truncate, formatMs, ensurePlayerNode, getHealthyNodes } = require('../../utils/helpers');

// Map user-friendly source names to Lavalink search platforms
const SOURCE_MAP = {
    auto: 'spsearch',
    spotify: 'spsearch',
    soundcloud: 'scsearch',
    youtubemusic: 'ytmsearch',
    youtube: 'ytsearch',
    apple: 'amsearch',
};

/**
 * Detect if a query is a URL
 */
function isUrl(query) {
    return /^(https?:\/\/|spotify:|www\.|open\.spotify\.com|music\.youtube\.com|youtube\.com|youtu\.be|soundcloud\.com)/i.test(query);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playnext')
        .setDescription('Add a song to play next (inserts at front of queue)')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song name or URL to play next')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('source')
                .setDescription('Where to search (default: Clean Studio Audio)')
                .setRequired(false)
                .addChoices(
                    { name: '🎵 YouTube Music (Default - Clean Studio Audio)', value: 'auto' },
                    { name: '🟢 Spotify (Official Tracks)', value: 'spotify' },
                    { name: '🟠 SoundCloud (Fast & Direct)', value: 'soundcloud' },
                    { name: '🔴 YouTube Video (Music Videos)', value: 'youtube' },
                    { name: '🍎 Apple Music', value: 'apple' },
                )
        ),

    async execute(interaction) {
        let deferred = false;
        try {
            await interaction.deferReply();
            deferred = true;
        } catch (deferErr) {
            console.warn('[Reso] deferReply failed for /playnext:', deferErr.message);
        }

        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            const embed = errorEmbed('You need to be in a voice channel!');
            if (interaction.deferred || interaction.replied || deferred) {
                return interaction.editReply({ embeds: [embed] }).catch(() => {});
            } else {
                return interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
            }
        }

        const rawQuery = interaction.options.getString('query', true).trim();
        const source = interaction.options.getString('source') || 'auto';
        const manager = interaction.client.lavalink;

        let query = rawQuery;
        const queryIsUrl = isUrl(rawQuery);

        if (queryIsUrl && !/^https?:\/\//i.test(query) && !query.startsWith('spotify:')) {
            query = `https://${query}`;
        }

        const searchSource = queryIsUrl ? undefined : (SOURCE_MAP[source] || 'spsearch');

        try {
            // Pre-flight: ensure at least one Lavalink node is connected
            const connectedNodes = Array.from(manager.nodeManager.nodes.values()).filter(n => n.connected);
            if (connectedNodes.length === 0) {
                return interaction.editReply({
                    embeds: [errorEmbed('🔌 **No music server available**\n\nAll Lavalink nodes are currently offline. Please wait and try again.')]
                });
            }

            // Create or get the player (assigning lowest-latency healthy node)
            const healthyNodes = getHealthyNodes(manager);
            const initialNode = healthyNodes[0] || connectedNodes[0];

            let player = manager.getPlayer(interaction.guild.id);
            if (!player) {
                player = manager.createPlayer({
                    guildId: interaction.guild.id,
                    voiceChannelId: voiceChannel.id,
                    textChannelId: interaction.channel.id,
                    selfDeaf: true,
                    volume: parseInt(process.env.DEFAULT_VOLUME) || 50,
                    node: initialNode.id,
                });
            }

            if (!player.connected) {
                await player.connect();
            }

            ensurePlayerNode(player, interaction.client);

            // Search
            const result = await player.search({
                query: query,
                source: searchSource,
            }, interaction.user);

            if (!result.tracks || result.tracks.length === 0) {
                return interaction.editReply({
                    embeds: [errorEmbed(`No results found for **${truncate(rawQuery, 50)}**`)]
                });
            }

            // Get the first track
            const track = result.tracks[0];
            track.requester = interaction.user;

            // Insert at position 0 (front of queue) — this is the key difference from /play
            player.queue.add(track, 0);

            if (!player.playing) {
                await player.play();
            }

            const info = track.info || {};
            const embed = createEmbed('Success')
                .setDescription(
                    `${EMOJIS.playnext} **Playing Next:**\n\n` +
                    `**[${truncate(info.title || 'Unknown', 55)}](${info.uri || ''})**\n` +
                    `> ${info.author || 'Unknown Artist'} • ${capitalize(info.sourceName || 'Unknown')}\n` +
                    `> ${EMOJIS.clock} \`${info.isStream ? 'Live' : formatMs(info.duration)}\` • Requested by ${interaction.user}`
                )
                .setThumbnail(info.artworkUrl || null);

            return interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('[Reso] PlayNext error:', error);
            const embed = errorEmbed(`Could not add song: ${truncate(error.message, 100)}`);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ embeds: [embed] }).catch(() => {});
            } else {
                return interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
            }
        }
    },
};
