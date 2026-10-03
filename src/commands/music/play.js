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
    extractYouTubeVideoId,
    isYouTubeUrl,
    isSpotifyUrl,
    isSoundCloudUrl,
    isUrl: isUrlHelper,
    cleanVideoTitle,
} = require('../../utils/helpers');

// Map user-friendly source names to Lavalink search platforms
const SOURCE_MAP = {
    auto: 'spsearch',
    spotify: 'spsearch',
    youtubemusic: 'ytmsearch',
    youtube: 'ytsearch',
    soundcloud: 'scsearch',
    apple: 'amsearch',
};

const SOURCE_EMOJIS = {
    auto: '🟢',
    spotify: '🟢',
    youtubemusic: '🎵',
    soundcloud: '🟠',
    youtube: '🔴',
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
                .setDescription('Where to search (default: Spotify / YouTube for links)')
                .setRequired(false)
                .addChoices(
                    { name: '🟢 Spotify (Default - Official Tracks)', value: 'auto' },
                    { name: '🎵 YouTube Music (Clean Studio Audio)', value: 'youtubemusic' },
                    { name: '🟠 SoundCloud (Fast & Direct)', value: 'soundcloud' },
                    { name: '🔴 YouTube Video (Music Videos)', value: 'youtube' },
                    { name: '🍎 Apple Music', value: 'apple' },
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

            // Create or get the player (assigning the lowest-latency healthy node)
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

            // Connect to voice if not connected
            if (!player.connected) {
                await player.connect();
            }

            // Ensure player is connected to the lowest-latency healthy Lavalink node
            await ensurePlayerNode(player, interaction.client);

            // Search with a 4s timeout helper so slow sources don't stall Discord
            const searchWithTimeout = (promise, ms = 4000) => Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Search timed out')), ms))
            ]);

            // Execute primary search based on query type
            let result = null;

            if (ytVideoId) {
                // 1. YouTube Video link: try direct URL load (supported with active OAuth), with ytsearch fallback
                try {
                    console.log(`[Reso] 🔴 YouTube video link detected (${ytVideoId}). Loading via native YouTube stream...`);
                    const directRes = await searchWithTimeout(player.search({
                        query: query,
                        source: undefined,
                    }, interaction.user), 3000);

                    if (directRes && directRes.tracks && directRes.tracks.length > 0) {
                        result = directRes;
                    }
                } catch {
                    /* fallback to ytsearch with video ID below */
                }

                if (!result || !result.tracks || result.tracks.length === 0) {
                    try {
                        console.log(`[Reso] ↻ Direct YouTube load fallback: Querying via ytsearch with ID ${ytVideoId}...`);
                        const ytRes = await searchWithTimeout(player.search({
                            query: ytVideoId,
                            source: 'ytsearch',
                        }, interaction.user), 3500);

                        if (ytRes && ytRes.tracks && ytRes.tracks.length > 0) {
                            const exactMatch = ytRes.tracks.find(t => t.info.identifier === ytVideoId);
                            result = exactMatch ? { ...ytRes, tracks: [exactMatch] } : ytRes;
                        }
                    } catch (err) {
                        console.warn(`[Reso] ytsearch with videoId failed: ${err.message}. Trying oEmbed fallback...`);
                    }
                }
            } else if (isUrl) {
                // 2. Other URLs (Spotify, SoundCloud, etc.) or YouTube Playlist
                try {
                    result = await searchWithTimeout(player.search({
                        query: query,
                        source: undefined,
                    }, interaction.user), 4000);
                } catch (err) {
                    console.warn(`[Reso] Direct URL search failed: ${err.message}. Trying fallbacks...`);
                    result = { tracks: [] };
                }
            } else if (isAttachment) {
                // 3. Audio file attachment
                try {
                    result = await searchWithTimeout(player.search({
                        query: query,
                        source: undefined,
                    }, interaction.user), 4000);
                } catch (err) {
                    console.warn(`[Reso] Attachment search failed: ${err.message}`);
                    result = { tracks: [] };
                }
            } else {
                // 4. Plain text search: Spotify first
                try {
                    result = await searchWithTimeout(player.search({
                        query: query,
                        source: searchSource,
                    }, interaction.user), 4000);
                } catch (err) {
                    console.warn(`[Reso] Initial text search failed: ${err.message}. Trying fallback sources...`);
                    result = { tracks: [] };
                }
            }

            // Log which source resolved
            if (result && result.tracks && result.tracks.length > 0) {
                const resolvedSource = result.tracks[0]?.info?.sourceName || 'unknown';
                console.log(`[Reso] ✓ Resolved from: ${resolvedSource} (${result.tracks.length} track(s))`);
            }

            // ── Fallback 1: YouTube URLs (if ytsearch:<videoId> or direct URL failed) ──
            if ((!result || !result.tracks || result.tracks.length === 0) && isUrl && isYouTubeUrl(query)) {
                try {
                    console.log(`[Reso] ↻ YouTube URL fallback: Resolving title via YouTube oEmbed...`);
                    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(query)}&format=json`;
                    const oembedRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(3000) });
                    if (oembedRes.ok) {
                        const oembedData = await oembedRes.json();
                        const rawTitle = oembedData.title;
                        const cleanTitle = cleanVideoTitle(rawTitle);
                        console.log(`[Reso] ✓ Extracted YouTube title: "${rawTitle}" (Cleaned: "${cleanTitle}")`);

                        // Order: YouTube first -> Spotify -> SoundCloud last
                        const ytFallbacks = ['ytsearch', 'ytmsearch', 'spsearch', 'scsearch'];
                        for (const fbSource of ytFallbacks) {
                            try {
                                console.log(`[Reso] ↻ Fallback search with "${fbSource}" for: ${truncate(cleanTitle, 60)}`);
                                const fbResult = await searchWithTimeout(player.search({
                                    query: cleanTitle,
                                    source: fbSource,
                                }, interaction.user), 3500);

                                if (fbResult && fbResult.tracks && fbResult.tracks.length > 0) {
                                    result = fbResult;
                                    const resolvedSource = result.tracks[0]?.info?.sourceName || fbSource;
                                    console.log(`[Reso] ✓ Fallback resolved from: ${resolvedSource} (${result.tracks.length} track(s))`);
                                    break;
                                }
                            } catch (e) {
                                console.log(`[Reso] ⚠ Fallback source "${fbSource}" errored: ${e.message}`);
                            }
                        }
                    }
                } catch (oembedErr) {
                    console.warn(`[Reso] YouTube oEmbed resolution failed: ${oembedErr.message}`);
                }
            }

            // ── Fallback 2: Spotify URLs (if LavaSrc credentials missing on Lavalink) ──
            if ((!result || !result.tracks || result.tracks.length === 0) && isUrl && isSpotifyUrl(query)) {
                try {
                    console.log(`[Reso] ↻ Spotify URL fallback: Resolving title via Spotify oEmbed...`);
                    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(query)}`;
                    const oembedRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(3000) });
                    if (oembedRes.ok) {
                        const oembedData = await oembedRes.json();
                        const trackTitle = cleanVideoTitle(oembedData.title);
                        console.log(`[Reso] ✓ Extracted Spotify title: "${trackTitle}". Searching via YouTube Music -> SoundCloud...`);

                        const spFallbacks = ['ytmsearch', 'ytsearch', 'scsearch'];
                        for (const fbSource of spFallbacks) {
                            try {
                                const fbResult = await searchWithTimeout(player.search({
                                    query: trackTitle,
                                    source: fbSource,
                                }, interaction.user), 3500);

                                if (fbResult && fbResult.tracks && fbResult.tracks.length > 0) {
                                    result = fbResult;
                                    const resolvedSource = result.tracks[0]?.info?.sourceName || fbSource;
                                    console.log(`[Reso] ✓ Spotify fallback resolved from: ${resolvedSource} (${result.tracks.length} track(s))`);
                                    break;
                                }
                            } catch { /* skip */ }
                        }
                    }
                } catch (oembedErr) {
                    console.warn(`[Reso] Spotify oEmbed resolution failed: ${oembedErr.message}`);
                }
            }

            // ── Fallback 3: Text queries ──
            // Order per user: Spotify first -> YouTube next -> SoundCloud last
            if ((!result || !result.tracks || result.tracks.length === 0) && !isUrl && !isAttachment) {
                const fallbackSources = ['spsearch', 'ytmsearch', 'ytsearch', 'scsearch'];
                const alreadyTried = searchSource;
                const toTry = fallbackSources.filter(s => s !== alreadyTried);

                for (const fbSource of toTry) {
                    try {
                        console.log(`[Reso] ↻ Fallback text search with "${fbSource}" for: ${truncate(query, 60)}`);
                        const fbResult = await searchWithTimeout(player.search({
                            query: query,
                            source: fbSource,
                        }, interaction.user), 3500);

                        if (fbResult && fbResult.tracks && fbResult.tracks.length > 0) {
                            result = fbResult;
                            const resolvedSource = result.tracks[0]?.info?.sourceName || fbSource;
                            console.log(`[Reso] ✓ Fallback resolved from: ${resolvedSource} (${result.tracks.length} track(s))`);
                            break;
                        }
                    } catch (e) {
                        console.log(`[Reso] ⚠ Fallback source "${fbSource}" errored: ${e.message}`);
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
                    `${EMOJIS.clock} \`${info.isStream ? 'Live' : formatMs(info.duration)}\` • Requested by ${interaction.user}`
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

