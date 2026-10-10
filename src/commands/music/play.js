const path = require('path');
const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed, createEmbed, EMOJIS, capitalize } = require('../../utils/embeds');
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
    isSoundCloudUrl,
    isUrl: isUrlHelper,
    cleanVideoTitle,
} = require('../../utils/helpers');

// Map user-friendly source names to Lavalink search platforms
const SOURCE_MAP = {
    auto: 'ytsearch',
    youtube: 'ytsearch',
    youtubemusic: 'ytmsearch',
    spotify: 'spsearch',
    soundcloud: 'scsearch',
    apple: 'amsearch',
};

const SOURCE_EMOJIS = {
    auto: '🔴',
    youtube: '🔴',
    youtubemusic: '🎵',
    spotify: '🟢',
    soundcloud: '🟠',
    apple: '🍎',
    file: '📁',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist by name, URL, or audio file')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song name, URL, or playlist link (or upload an audio file below)')
                .setRequired(false)
        )
        .addAttachmentOption(option => {
            option.setName('file')
                .setDescription('Upload an audio file to play (mp3, wav, flac, ogg, m4a)')
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
                    { name: '🎵 YouTube Music (Clean Audio)', value: 'youtubemusic' }
                )
        ),

    async execute(interaction) {
        // Defer reply immediately to secure the 15-minute response window and prevent 3s Discord timeout (Unknown interaction 10062)
        let deferred = false;
        try {
            await interaction.deferReply();
            deferred = true;
        } catch (deferErr) {
            console.warn('[Reso] deferReply failed (interaction timed out or invalid):', deferErr.message);
            return; // Interaction is dead, cannot reply further
        }

        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            const embed = errorEmbed('You need to be in a voice channel!');
            return interaction.editReply({ embeds: [embed] }).catch(() => { });
        }

        // Validate bot permissions in the voice channel
        const permCheck = checkVoicePermissions(voiceChannel, interaction.client.user);
        if (!permCheck.allowed) {
            const embed = errorEmbed(permCheck.reason);
            return interaction.editReply({ embeds: [embed] }).catch(() => { });
        }

        const rawStringQuery = interaction.options.getString('query')?.trim();
        const attachment = interaction.options.getAttachment('file');
        const source = interaction.options.getString('source') || 'auto';
        const manager = interaction.client.lavalink;

        if (!rawStringQuery && !attachment) {
            const embed = errorEmbed('Please provide either a song name/link in `query` or upload an audio file in `file`!');
            return interaction.editReply({ embeds: [embed] });
        }

        let isAttachment = false;
        let isUrl = false;
        let query;
        let rawQuery;

        if (attachment) {
            isAttachment = true;
            rawQuery = attachment.name || 'Audio File';
            query = attachment.url;
            isUrl = true;

            // Extra client-side validation for audio file types
            const ext = path.extname(attachment.name || '').toLowerCase();
            const allowedExts = ['.mp3', '.wav', '.flac', '.ogg', '.opus', '.m4a', '.aac', '.webm', '.mp4'];
            const isAudio = allowedExts.includes(ext) || (attachment.contentType && attachment.contentType.startsWith('audio/'));

            if (!isAudio) {
                return interaction.editReply({
                    embeds: [errorEmbed('Please upload a valid audio file (`.mp3`, `.wav`, `.flac`, `.ogg`, `.m4a`).')]
                });
            }

            console.log(`[Reso] 📁 Audio file attachment detected: ${attachment.name}`);
        } else {
            rawQuery = rawStringQuery;
            query = rawStringQuery;
            isUrl = isUrlHelper(rawQuery);

            if (isUrl && !/^https?:\/\//i.test(query) && !query.startsWith('spotify:')) {
                query = `https://${query}`;
            }

            // Normalize youtube.com to www.youtube.com for Lavalink plugin compatibility
            if (isUrl) {
                query = query.replace(/^https?:\/\/youtube\.com\//i, 'https://www.youtube.com/');
            }
        }

        // ── Determine the search source intelligently ──
        let searchSource;
        let detectedPlatform = source;
        const ytVideoId = (isUrl && isYouTubeUrl(query)) ? extractYouTubeVideoId(query) : null;

        if (isAttachment) {
            searchSource = undefined;
            detectedPlatform = 'file';
        } else if (isUrl) {
            searchSource = undefined;
            if (isSpotifyUrl(query)) {
                detectedPlatform = 'spotify';
                console.log(`[Reso] 🟢 Spotify URL detected: ${truncate(query, 80)}`);
            } else if (isYouTubeUrl(query)) {
                detectedPlatform = 'youtube';
                console.log(`[Reso] 🔴 YouTube URL detected (Video ID: ${ytVideoId || 'playlist'}): ${truncate(query, 80)}`);
            } else if (isSoundCloudUrl(query)) {
                detectedPlatform = 'soundcloud';
                console.log(`[Reso] 🟠 SoundCloud URL detected: ${truncate(query, 80)}`);
            } else {
                console.log(`[Reso] 🔗 URL detected: ${truncate(query, 80)}`);
            }
        } else {
            // Text query — default to Spotify (spsearch) or user's chosen source
            searchSource = SOURCE_MAP[source] || 'spsearch';
            console.log(`[Reso] 🔍 Text search on ${source} (${searchSource}): ${truncate(query, 80)}`);
        }

        try {
            // ── Pre-flight: ensure at least one Lavalink node is connected ──
            const connectedNodes = Array.from(manager.nodeManager.nodes.values()).filter(n => n.connected);
            if (connectedNodes.length === 0) {
                const embed = errorEmbed(
                    '🔌 **No music server available**\n\n' +
                    'All Lavalink nodes are currently offline or reconnecting.\n' +
                    'Please wait a moment and try again — nodes usually reconnect within 30 seconds.'
                );
                return interaction.editReply({ embeds: [embed] });
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

            // Connect to voice if not connected
            if (!player.connected) {
                await player.connect();
            }

            // Ensure player is connected to the lowest-latency healthy Lavalink node
            await ensurePlayerNode(player, interaction.client);

            // Simple, fast direct search
            let result = null;
            let fallbackNote = null;

            try {
                if (isAttachment) {
                    // File attachment: load directly
                    result = await player.search({ query }, interaction.user);
                } else if (isUrl && ytVideoId) {
                    // YouTube video URL: go STRAIGHT to ytsearch with video ID.
                    console.log(`[Reso] 🔴 YouTube video link detected (${ytVideoId}). Loading via ytsearch...`);
                    result = await player.search({ query: ytVideoId, source: 'ytsearch' }, interaction.user);
                } else if (isUrl) {
                    // Non-YouTube URL (Spotify, SoundCloud, playlist, etc.): load directly
                    result = await player.search({ query }, interaction.user);
                } else {
                    // Text query: use the selected search source
                    result = await player.search({ query, source: searchSource }, interaction.user);
                }
            } catch (err) {
                console.warn(`[Reso] Initial search error: ${err.message}`);
            }

            // Quick fallbacks only if primary search found nothing
            if (!result || !result.tracks || result.tracks.length === 0) {
                if (isUrl && isYouTubeUrl(query)) {
                    // YouTube URL failed — try direct URL as last resort (handles playlists)
                    if (ytVideoId) {
                        try {
                            console.log(`[Reso] ↻ YouTube ytsearch failed, trying direct URL...`);
                            result = await player.search({ query }, interaction.user);
                            if (result?.tracks?.length > 0) fallbackNote = 'Loaded via direct YouTube stream';
                        } catch { }
                    } else {
                        // Playlist URL — retry
                        try {
                            console.log(`[Reso] ↻ YouTube playlist failed, retrying...`);
                            result = await player.search({ query }, interaction.user);
                        } catch { }
                    }
                }
            }

            if (!result.tracks || result.tracks.length === 0) {
                if (isAttachment) {
                    return interaction.editReply({
                        embeds: [errorEmbed(`Could not play **${truncate(rawQuery, 50)}**. Make sure the uploaded file is a valid, uncorrupted audio format.`)]
                    });
                }

                const sourceLabel = source === 'auto' ? 'any platform' : capitalize(source);
                let tipMessage = '\n\nTry a different search term or valid link.';

                if (isUrl && isSpotifyUrl(rawQuery)) {
                    tipMessage = '\n\n💡 **Tip**: Spotify URLs require the Lavalink server to have the **LavaSrc plugin** with Spotify credentials configured. Try using `/play` with just the song name instead.';
                } else if (isUrl && query.includes('youtube.com')) {
                    tipMessage = '\n\n💡 **Tip**: Make sure YouTube playlists are set to **Public** or **Unlisted** (Private playlists cannot be loaded).';
                }

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
                    track.requester = interaction.user;
                    return track;
                });
                player.queue.add(tracks);

                // Start playing if not already
                if (!player.playing) {
                    await player.play();
                }

                const playlistTitle = result.playlist?.name || 'Playlist';
                const firstTrack = tracks[0];
                const firstInfo = firstTrack?.info || {};
                const sourceName = firstInfo.sourceName ? capitalize(firstInfo.sourceName) : 'Unknown';

                const embed = createEmbed('Success')
                    .setAuthor({ name: '📀 Playlist Queued' })
                    .setTitle(truncate(playlistTitle, 60))
                    .setURL(/^https?:\/\//.test(query) ? query : undefined)
                    .setDescription(`${EMOJIS.success} Added **${tracks.length}** tracks to the queue.`)
                    .setThumbnail(firstInfo.artworkUrl || null)
                    .addFields(
                        { name: `${EMOJIS.disc} Source`, value: sourceName, inline: true },
                        { name: `${EMOJIS.dj} Requested by`, value: `${interaction.user}`, inline: true },
                    );

                return interaction.editReply({ embeds: [embed] });
            }

            // Single track
            let track = result.tracks[0];
            track.requester = interaction.user;

            if (isAttachment) {
                if (!track.info.title || track.info.title === 'Unknown title' || track.info.title.startsWith('http')) {
                    track.info.title = attachment.name.replace(/\.[^/.]+$/, '');
                }
                if (!track.info.author || track.info.author === 'Unknown author') {
                    track.info.author = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
                }
            }

            player.queue.add(track);

            if (!player.playing) {
                await player.play();
            }

            const info = track.info || {};
            const sourceEmoji = SOURCE_EMOJIS[detectedPlatform] || SOURCE_EMOJIS[source] || '🔍';
            const matchedSource = isAttachment ? 'Audio Upload' : (info.sourceName ? capitalize(info.sourceName) : 'Unknown');

            const embed = createEmbed('Success')
                .setDescription(
                    `${sourceEmoji} ${isAttachment ? 'Loaded from' : 'Found on'} **${matchedSource}**\n\n` +
                    `**[${truncate(info.title || 'Unknown Track', 55)}](${info.uri || ''})**\n` +
                    `${EMOJIS.clock} \`${info.isStream ? 'Live' : formatMs(info.duration)}\` • Requested by ${interaction.user}` +
                    (fallbackNote ? `\n\n> *${fallbackNote}*` : '')
                )
                .setThumbnail(info.artworkUrl || null);

            return interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('[Reso] Play error:', error);
            const embed = errorEmbed(`Could not play: ${truncate(error.message, 100)}`);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ embeds: [embed] }).catch(() => { });
            } else {
                return interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => { });
            }
        }
    },
};

