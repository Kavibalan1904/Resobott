const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed, createEmbed, EMOJIS, capitalize } = require('../../utils/embeds');
const { getVoiceChannel, truncate, formatMs } = require('../../utils/helpers');

// Map user-friendly source names to Lavalink search platforms
const SOURCE_MAP = {
    auto: 'ytsearch',        // Default to YouTube search
    youtube: 'ytsearch',
    spotify: 'spsearch',
    soundcloud: 'scsearch',
    apple: 'amsearch',
};

const SOURCE_EMOJIS = {
    auto: '🔍',
    youtube: '🔴',
    spotify: '🟢',
    soundcloud: '🟠',
    apple: '🍎',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist by name, URL, or link')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song name, URL, or playlist link (just type a song name!)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('source')
                .setDescription('Where to search (default: auto-detect)')
                .setRequired(false)
                .addChoices(
                    { name: '🔍 Auto Detect (default)', value: 'auto' },
                    { name: '🔴 YouTube', value: 'youtube' },
                    { name: '🟢 Spotify', value: 'spotify' },
                    { name: '🟠 SoundCloud', value: 'soundcloud' },
                    { name: '🍎 Apple Music', value: 'apple' },
                )
        ),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        const rawQuery = interaction.options.getString('query', true).trim();
        const source = interaction.options.getString('source') || 'auto';
        const manager = interaction.client.lavalink;
        const searchPlatform = SOURCE_MAP[source] || 'ytsearch';

        // Detect URLs, Spotify URIs, and domain-only links (e.g., open.spotify.com/playlist/... or youtube.com/playlist?list=...)
        const isUrlPattern = /^(https?:\/\/|spotify:|www\.|open\.spotify\.com|music\.youtube\.com|youtube\.com|youtu\.be)/i;
        let isUrl = isUrlPattern.test(rawQuery);
        let query = rawQuery;

        if (isUrl && !/^https?:\/\//i.test(query) && !query.startsWith('spotify:')) {
            query = `https://${query}`;
        }

        // Normalize youtube.com to www.youtube.com for Lavalink plugin compatibility
        if (isUrl) {
            query = query.replace(/^https?:\/\/youtube\.com\//i, 'https://www.youtube.com/');
        }

        await interaction.deferReply();

        try {
            // Create or get the player
            let player = manager.getPlayer(interaction.guild.id);
            if (!player) {
                player = manager.createPlayer({
                    guildId: interaction.guild.id,
                    voiceChannelId: voiceChannel.id,
                    textChannelId: interaction.channel.id,
                    selfDeaf: true,
                    volume: parseInt(process.env.DEFAULT_VOLUME) || 50,
                });
            }

            // Connect to voice if not connected
            if (!player.connected) {
                await player.connect();
            }

            // Search for the track or playlist
            let result = await player.search({
                query: query,
                source: isUrl ? undefined : searchPlatform,
            }, interaction.user);

            // Fallback search across other connected nodes if primary node returned empty for a URL
            if ((!result.tracks || result.tracks.length === 0) && isUrl) {
                const connectedNodes = Array.from(manager.nodeManager.nodes.values()).filter(n => n.connected && n.id !== player.node?.id);
                for (const fallbackNode of connectedNodes) {
                    try {
                        const fallbackResult = await fallbackNode.search({
                            query: query,
                            source: undefined,
                        }, interaction.user);
                        if (fallbackResult.tracks && fallbackResult.tracks.length > 0) {
                            result = fallbackResult;
                            break;
                        }
                    } catch (e) {
                        // ignore node search error
                    }
                }
            }

            if (!result.tracks || result.tracks.length === 0) {
                const sourceLabel = source === 'auto' ? 'any platform' : capitalize(source);
                const tipMessage = isUrl && query.includes('youtube.com') 
                    ? '\n\n💡 **Tip**: Make sure YouTube playlists are set to **Public** or **Unlisted** (Private playlists cannot be loaded).'
                    : '\n\nTry a different search term or valid link.';

                return interaction.editReply({
                    embeds: [errorEmbed(`No results found for **${truncate(rawQuery, 50)}** on ${sourceLabel}.${tipMessage}`)]
                });
            }

            // Handle 24/7 mode
            if (interaction.client.twentyFourSeven?.has(interaction.guild.id)) {
                // 24/7 mode: keep player alive
            }

            // If it's a playlist or album
            if (result.loadType === 'playlist' || result.playlist) {
                const tracks = result.tracks.map(track => {
                    // Force Spotify tracks to be resolved via YouTube search to get playable audio
                    // Do NOT pass sourceName or uri — those cause circular Spotify→Spotify resolution
                    if (track.info?.sourceName === 'spotify' || query.includes('spotify')) {
                        return manager.utils.buildUnresolvedTrack({
                            title: track.info?.title,
                            author: track.info?.author,
                            artworkUrl: track.info?.artworkUrl,
                            duration: track.info?.duration || 0,
                        }, interaction.user);
                    }
                    track.requester = interaction.user;
                    return track;
                });
                player.queue.add(tracks);

                // Start playing if not already
                if (!player.playing) {
                    await player.play();
                }

                const playlistTitle = result.playlist?.name || 'Playlist';
                const firstTrack = tracks[0]?.info;
                const sourceName = firstTrack?.sourceName ? capitalize(firstTrack.sourceName) : 'Unknown';

                const embed = createEmbed('Success')
                    .setAuthor({ name: '📀 Playlist Queued' })
                    .setTitle(truncate(playlistTitle, 60))
                    .setURL(/^https?:\/\//.test(query) ? query : undefined)
                    .setDescription(`${EMOJIS.success} Added **${tracks.length}** tracks to the queue.`)
                    .setThumbnail(firstTrack?.artworkUrl || null)
                    .addFields(
                        { name: `${EMOJIS.disc} Source`, value: sourceName, inline: true },
                        { name: `${EMOJIS.dj} Requested by`, value: `${interaction.user}`, inline: true },
                    );

                return interaction.editReply({ embeds: [embed] });
            }

            // Single track
            let track = result.tracks[0];
            // Force Spotify tracks to be resolved via YouTube search to get playable audio
            // Do NOT pass sourceName or uri — those cause circular Spotify→Spotify resolution
            if (track.info?.sourceName === 'spotify' || query.includes('spotify')) {
                track = manager.utils.buildUnresolvedTrack({
                    title: track.info?.title,
                    author: track.info?.author,
                    artworkUrl: track.info?.artworkUrl,
                    duration: track.info?.duration || 0,
                }, interaction.user);
            } else {
                track.requester = interaction.user;
            }
            player.queue.add(track);

            if (!player.playing) {
                await player.play();
            }

            const info = track.info || {};
            const sourceEmoji = SOURCE_EMOJIS[source] || '🔍';
            const matchedSource = info.sourceName ? capitalize(info.sourceName) : 'Unknown';

            const embed = createEmbed('Success')
                .setDescription(
                    `${sourceEmoji} Found on **${matchedSource}**\n\n` +
                    `**[${truncate(info.title, 55)}](${info.uri})**\n` +
                    `${EMOJIS.clock} \`${info.isStream ? 'Live' : formatMs(info.duration)}\` • Requested by ${interaction.user}`
                )
                .setThumbnail(info.artworkUrl || null);

            return interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('[Reso] Play error:', error);
            return interaction.editReply({ embeds: [errorEmbed(`Could not play: ${truncate(error.message, 100)}`)] });
        }
    },
};
