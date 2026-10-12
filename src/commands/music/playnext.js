const path = require('path');
const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, createEmbed, EMOJIS, capitalize } = require('../../utils/embeds');
const {
    getVoiceChannel,
    checkVoicePermissions,
    truncate,
    formatMs,
    ensurePlayerNode,
    getHealthyNodes,
    getBestNode,
    extractYouTubeVideoId,
    isYouTubeUrl,
    isSpotifyUrl,
    cleanVideoTitle,
    isUrl: isUrlHelper,
} = require('../../utils/helpers');
const { resolveSpotify } = require('../../utils/spotifyResolver');
const { setTrackMetadata } = require('../../utils/trackMetadata');

// Map user-friendly source names to Lavalink search platforms
const SOURCE_MAP = {
    auto: 'ytsearch',
    youtube: 'ytsearch',
    youtubemusic: 'ytmsearch',
    spotify: 'spsearch',
    soundcloud: 'scsearch',
    apple: 'amsearch',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playnext')
        .setDescription('Add a song or audio file to play next (inserts at front of queue)')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song name or URL to play next (or upload an audio file below)')
                .setRequired(false)
        )
        .addAttachmentOption(option => {
            option.setName('file')
                .setDescription('Upload an audio file to play next (mp3, wav, flac, ogg, m4a)')
                .setRequired(false);
            const originalToJSON = option.toJSON.bind(option);
            option.toJSON = () => ({
                ...originalToJSON(),
                file_types: ['audio'],
            });
            return option;
        })
        .addStringOption(option =>
            option.setName('source')
                .setDescription('Where to search (default: YouTube)')
                .setRequired(false)
                .addChoices(
                    { name: '🔴 YouTube (Default - Fast & High Quality)', value: 'auto' },
                    { name: '🎵 YouTube Music (Clean Studio Audio)', value: 'youtubemusic' }
                )
        ),

    async execute(interaction) {
        let deferred = false;
        try {
            await interaction.deferReply();
            deferred = true;
        } catch (deferErr) {
            console.warn('[Reso] deferReply failed for playnext:', deferErr.message);
            return;
        }

        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            const embed = errorEmbed('You need to be in a voice channel!');
            return interaction.editReply({ embeds: [embed] }).catch(() => {});
        }

        const permCheck = checkVoicePermissions(voiceChannel, interaction.client.user);
        if (!permCheck.allowed) {
            const embed = errorEmbed(permCheck.reason);
            return interaction.editReply({ embeds: [embed] }).catch(() => {});
        }

        const rawStringQuery = interaction.options.getString('query')?.trim();
        const attachment = interaction.options.getAttachment('file');
        const source = interaction.options.getString('source') || 'auto';
        const manager = interaction.client.lavalink;

        if (!rawStringQuery && !attachment) {
            return interaction.editReply({
                embeds: [errorEmbed('Please provide either a song name/link in `query` or upload an audio file in `file`!')]
            });
        }

        let isAttachment = false;
        let query;
        let rawQuery;
        let searchSource;

        if (attachment) {
            isAttachment = true;
            rawQuery = attachment.name || 'Audio File';
            query = attachment.url;
            searchSource = undefined;

            const ext = path.extname(attachment.name || '').toLowerCase();
            const allowedExts = ['.mp3', '.wav', '.flac', '.ogg', '.opus', '.m4a', '.aac', '.webm', '.mp4'];
            const isAudio = allowedExts.includes(ext) || (attachment.contentType && attachment.contentType.startsWith('audio/'));

            if (!isAudio) {
                return interaction.editReply({
                    embeds: [errorEmbed('Please upload a valid audio file (`.mp3`, `.wav`, `.flac`, `.ogg`, `.m4a`).')]
                });
            }

            console.log(`[Reso] 📁 PlayNext audio attachment detected: ${attachment.name}`);
        } else {
            rawQuery = rawStringQuery;
            query = rawStringQuery;
            const queryIsUrl = isUrlHelper(rawQuery);

            if (queryIsUrl && !/^https?:\/\//i.test(query) && !query.startsWith('spotify:')) {
                query = `https://${query}`;
            }

            if (queryIsUrl) {
                query = query.replace(/^https?:\/\/youtube\.com\//i, 'https://www.youtube.com/');
            }

            searchSource = queryIsUrl ? undefined : (SOURCE_MAP[source] || 'spsearch');
        }

        const isUrlQuery = isUrlHelper(rawQuery);
        const ytVideoId = (isUrlQuery && isYouTubeUrl(query)) ? extractYouTubeVideoId(query) : null;

        try {
            // Pre-flight: ensure at least one Lavalink node is connected
            const connectedNodes = Array.from(manager.nodeManager.nodes.values()).filter(n => n.connected);
            if (connectedNodes.length === 0) {
                return interaction.editReply({
                    embeds: [errorEmbed('🔌 **No music server available**\n\nAll Lavalink nodes are currently offline. Please wait and try again.')]
                });
            }

            // Create or get the player (assigning primary-main node)
            const targetNode = getBestNode(manager) || connectedNodes[0];

            let player = manager.getPlayer(interaction.guild.id);
            if (!player) {
                player = manager.createPlayer({
                    guildId: interaction.guild.id,
                    voiceChannelId: voiceChannel.id,
                    textChannelId: interaction.channel.id,
                    selfDeaf: true,
                    volume: parseInt(process.env.DEFAULT_VOLUME) || 50,
                    node: targetNode.id,
                });
            }

            if (!player.connected) {
                await player.connect();
            }

            await ensurePlayerNode(player, interaction.client);

            // Simple, fast direct search
            let result = null;

            try {
                if (isAttachment || isUrlQuery) {
                    result = await player.search({ query }, interaction.user);
                } else {
                    result = await player.search({ query, source: searchSource }, interaction.user);
                }
            } catch (err) {
                console.warn(`[Reso] PlayNext initial search error: ${err.message}`);
            }

            // Quick fallbacks only if primary search found nothing
            if (!result || !result.tracks || result.tracks.length === 0) {
                // 1. Text search fallback: if spsearch returned nothing, try YouTube search
                if (!isUrlQuery && !isAttachment && searchSource === 'spsearch') {
                    try {
                        console.log(`[Reso] ↻ PlayNext spsearch yielded no results, falling back to ytsearch...`);
                        result = await player.search({ query, source: 'ytsearch' }, interaction.user);
                    } catch {}
                }

                // 2. YouTube URL fallback
                if (isUrlQuery && isYouTubeUrl(query)) {
                    const vid = extractYouTubeVideoId(query);
                    if (vid) {
                        try {
                            result = await player.search({ query: vid, source: 'ytsearch' }, interaction.user);
                        } catch {}
                    } else {
                        try {
                            result = await player.search({ query }, interaction.user);
                        } catch {}
                    }
                }

                // 3. Spotify URL fallback (individual song or playlist/album)
                if (isUrlQuery && isSpotifyUrl(rawQuery || query)) {
                    try {
                        console.log(`[Reso] 🟢 PlayNext: Lavalink returned no tracks for Spotify URL. Resolving via Spotify resolver: ${truncate(query, 80)}`);
                        const spotifyData = await resolveSpotify(query);
                        if (spotifyData) {
                            if (spotifyData.type === 'track') {
                                console.log(`[Reso] 🟢 PlayNext: Searching YouTube for Spotify track: "${spotifyData.searchQuery}"`);
                                let trackSearch = await player.search({ query: spotifyData.searchQuery, source: 'ytsearch' }, interaction.user);
                                if (!trackSearch?.tracks?.length && spotifyData.title) {
                                    trackSearch = await player.search({ query: spotifyData.title, source: 'ytsearch' }, interaction.user);
                                }

                                if (trackSearch?.tracks?.length > 0) {
                                    const matchedTrack = trackSearch.tracks[0];
                                    if (spotifyData.thumbnail) matchedTrack.info.artworkUrl = spotifyData.thumbnail;
                                    if (spotifyData.uri) matchedTrack.info.uri = spotifyData.uri;
                                    matchedTrack.info.sourceName = 'spotify';
                                    result = {
                                        loadType: 'track',
                                        tracks: [matchedTrack],
                                    };
                                }
                            } else if (spotifyData.type === 'playlist' && spotifyData.tracks?.length > 0) {
                                console.log(`[Reso] 🟢 PlayNext: Resolved Spotify playlist "${spotifyData.name}" with ${spotifyData.tracks.length} tracks`);
                                const firstItem = spotifyData.tracks[0];
                                let firstSearch = await player.search({ query: firstItem.searchQuery, source: 'ytsearch' }, interaction.user);
                                if (!firstSearch?.tracks?.length && firstItem.title) {
                                    firstSearch = await player.search({ query: firstItem.title, source: 'ytsearch' }, interaction.user);
                                }

                                if (firstSearch?.tracks?.length > 0) {
                                    const firstTrack = firstSearch.tracks[0];
                                    if (spotifyData.thumbnail) firstTrack.info.artworkUrl = spotifyData.thumbnail;
                                    if (firstItem.uri) firstTrack.info.uri = firstItem.uri;
                                    firstTrack.info.sourceName = 'spotify';
                                    firstTrack.requester = interaction.user;
                                    firstTrack.isAutoplay = false;
                                    firstTrack.isRecommendation = false;
                                    setTrackMetadata(interaction.guild.id, firstTrack, {
                                        isAutoplay: false,
                                        isRecommendation: false,
                                        requester: interaction.user,
                                    });

                                    // Insert at front of queue
                                    player.queue.add(firstTrack, 0);
                                    if (!player.playing) {
                                        await player.play();
                                    }

                                    // In background, load remaining tracks and insert in sequential order right after
                                    const remainingItems = spotifyData.tracks.slice(1);
                                    if (remainingItems.length > 0) {
                                        (async () => {
                                            const BATCH_SIZE = 4;
                                            let currentInsertIndex = 1;
                                            for (let i = 0; i < remainingItems.length; i += BATCH_SIZE) {
                                                if (!player || player.destroyed || !player.connected) break;
                                                const batch = remainingItems.slice(i, i + BATCH_SIZE);
                                                const batchPromises = batch.map(async (item) => {
                                                    try {
                                                        let res = await player.search({ query: item.searchQuery, source: 'ytsearch' }, interaction.user);
                                                        if (!res?.tracks?.length && item.title) {
                                                            res = await player.search({ query: item.title, source: 'ytsearch' }, interaction.user);
                                                        }
                                                        if (res?.tracks?.length > 0) {
                                                            const t = res.tracks[0];
                                                            if (item.uri) t.info.uri = item.uri;
                                                            t.info.sourceName = 'spotify';
                                                            t.requester = interaction.user;
                                                            t.isAutoplay = false;
                                                            t.isRecommendation = false;
                                                            setTrackMetadata(interaction.guild.id, t, {
                                                                isAutoplay: false,
                                                                isRecommendation: false,
                                                                requester: interaction.user,
                                                            });
                                                            return t;
                                                        }
                                                    } catch {}
                                                    return null;
                                                });

                                                const resolvedTracks = (await Promise.all(batchPromises)).filter(Boolean);
                                                if (!player || player.destroyed || !player.connected) break;
                                                if (resolvedTracks.length > 0) {
                                                    player.queue.add(resolvedTracks, currentInsertIndex);
                                                    currentInsertIndex += resolvedTracks.length;
                                                }
                                            }
                                        })().catch(err => console.error('[Reso] PlayNext background loader error:', err));
                                    }

                                    const playlistTitle = spotifyData.name || 'Spotify Playlist';
                                    const embed = createEmbed('Success')
                                        .setAuthor({ name: '📀 Playing Next: Spotify Playlist' })
                                        .setTitle(truncate(playlistTitle, 60))
                                        .setURL(/^https?:\/\//.test(query) ? query : undefined)
                                        .setDescription(`${EMOJIS.success} Added **${spotifyData.tracks.length}** tracks to play next at the front of the queue.`)
                                        .setThumbnail(spotifyData.thumbnail || null)
                                        .addFields(
                                            { name: `${EMOJIS.disc} Source`, value: 'Spotify', inline: true },
                                            { name: `${EMOJIS.dj} Requested by`, value: `${interaction.user}`, inline: true },
                                        );

                                    return interaction.editReply({ embeds: [embed] });
                                }
                            }
                        }
                    } catch (spotifyErr) {
                        console.warn(`[Reso] PlayNext Spotify resolver fallback error: ${spotifyErr.message}`);
                    }
                }
            }

            if (!result || !result.tracks || result.tracks.length === 0) {
                if (isAttachment) {
                    return interaction.editReply({
                        embeds: [errorEmbed(`Could not play **${truncate(rawQuery, 50)}**. Make sure the uploaded file is a valid, uncorrupted audio format.`)]
                    });
                }
                return interaction.editReply({
                    embeds: [errorEmbed(`No results found for **${truncate(rawQuery, 50)}**`)]
                });
            }

            // If it's a playlist or album loaded natively
            if (result.loadType === 'playlist' || result.playlist) {
                const tracks = result.tracks.map(track => {
                    track.requester = interaction.user;
                    track.isAutoplay = false;
                    track.isRecommendation = false;
                    setTrackMetadata(interaction.guild.id, track, {
                        isAutoplay: false,
                        isRecommendation: false,
                        requester: interaction.user,
                    });
                    return track;
                });
                player.queue.add(tracks, 0);

                if (!player.playing) {
                    await player.play();
                }

                const playlistTitle = result.playlist?.name || 'Playlist';
                const firstTrack = tracks[0];
                const firstInfo = firstTrack?.info || {};
                const sourceName = firstInfo.sourceName ? capitalize(firstInfo.sourceName) : 'Unknown';

                const embed = createEmbed('Success')
                    .setAuthor({ name: '📀 Playing Next: Playlist' })
                    .setTitle(truncate(playlistTitle, 60))
                    .setURL(/^https?:\/\//.test(query) ? query : undefined)
                    .setDescription(`${EMOJIS.success} Added **${tracks.length}** tracks to play next at the front of the queue.`)
                    .setThumbnail(firstInfo.artworkUrl || null)
                    .addFields(
                        { name: `${EMOJIS.disc} Source`, value: sourceName, inline: true },
                        { name: `${EMOJIS.dj} Requested by`, value: `${interaction.user}`, inline: true },
                    );

                return interaction.editReply({ embeds: [embed] });
            }

            // Get the first track
            const track = result.tracks[0];
            track.requester = interaction.user;

            if (isAttachment) {
                if (!track.info.title || track.info.title === 'Unknown title' || track.info.title.startsWith('http')) {
                    track.info.title = attachment.name.replace(/\.[^/.]+$/, '');
                }
                if (!track.info.author || track.info.author === 'Unknown author') {
                    track.info.author = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
                }
            }

            const { setTrackMetadata } = require('../../utils/trackMetadata');
            track.isAutoplay = false;
            track.isRecommendation = false;
            setTrackMetadata(interaction.guild.id, track, {
                isAutoplay: false,
                isRecommendation: false,
                requester: interaction.user,
            });

            // Insert at position 0 (front of queue) — this is the key difference from play
            player.queue.add(track, 0);

            if (!player.playing) {
                await player.play();
            }

            const info = track.info || {};
            const sourceDisplay = isAttachment ? 'Audio Upload' : capitalize(info.sourceName || 'Unknown');
            const embed = createEmbed('Success')
                .setDescription(
                    `${EMOJIS.playnext} **Playing Next:**\n\n` +
                    `**[${truncate(info.title || 'Unknown', 55)}](${info.uri || ''})**\n` +
                    `> ${info.author || 'Unknown Artist'} • ${sourceDisplay}\n` +
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
