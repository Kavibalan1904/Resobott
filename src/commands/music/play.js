const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed, createEmbed, EMOJIS, capitalize } = require('../../utils/embeds');
const { getVoiceChannel, truncate, formatMs, ensurePlayerNode, getHealthyNodes } = require('../../utils/helpers');

// Map user-friendly source names to Lavalink search platforms
// ytmsearch = YouTube Music (pure studio audio tracks with 0 movie dialogues/video skits)
const SOURCE_MAP = {
    auto: 'ytmsearch',
    youtubemusic: 'ytmsearch',
    spotify: 'spsearch',
    soundcloud: 'scsearch',
    youtube: 'ytsearch',
    apple: 'amsearch',
};

const SOURCE_EMOJIS = {
    auto: '🎵',
    youtubemusic: '🎵',
    spotify: '🟢',
    soundcloud: '🟠',
    youtube: '🔴',
    apple: '🍎',
};

/**
 * Detect if a query is a Spotify URL or URI
 * Matches: open.spotify.com/..., spotify:track:..., spotify:album:..., etc.
 */
function isSpotifyUrl(query) {
    return /^(https?:\/\/)?(www\.)?open\.spotify\.com\//i.test(query)
        || /^spotify:/i.test(query);
}

/**
 * Detect if a query is a YouTube/YouTube Music URL
 */
function isYouTubeUrl(query) {
    return /^(https?:\/\/)?(www\.|music\.)?youtube\.com\//i.test(query)
        || /^(https?:\/\/)?youtu\.be\//i.test(query);
}

/**
 * Detect if a query is a SoundCloud URL
 */
function isSoundCloudUrl(query) {
    return /^(https?:\/\/)?(www\.)?soundcloud\.com\//i.test(query);
}

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
        // Defer reply immediately to secure the 15-minute response window and prevent 3s Discord timeout (Unknown interaction 10062)
        let deferred = false;
        try {
            await interaction.deferReply();
            deferred = true;
        } catch (deferErr) {
            console.warn('[Reso] deferReply failed (interaction timed out or invalid):', deferErr.message);
        }

        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            const embed = errorEmbed('You need to be in a voice channel!');
            if (interaction.deferred || interaction.replied || deferred) {
                return interaction.editReply({ embeds: [embed] }).catch(() => { });
            } else {
                return interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => { });
            }
        }

        const rawQuery = interaction.options.getString('query', true).trim();
        const source = interaction.options.getString('source') || 'auto';
        const manager = interaction.client.lavalink;

        // Detect URLs, Spotify URIs, and domain-only links
        const isUrlPattern = /^(https?:\/\/|spotify:|www\.|open\.spotify\.com|music\.youtube\.com|youtube\.com|youtu\.be|soundcloud\.com)/i;
        let isUrl = isUrlPattern.test(rawQuery);
        let query = rawQuery;

        if (isUrl && !/^https?:\/\//i.test(query) && !query.startsWith('spotify:')) {
            query = `https://${query}`;
        }

        // Normalize youtube.com to www.youtube.com for Lavalink plugin compatibility
        if (isUrl) {
            query = query.replace(/^https?:\/\/youtube\.com\//i, 'https://www.youtube.com/');
        }

        // ── Determine the search source intelligently ──
        // For URLs: let Lavalink auto-detect the source plugin (LavaSrc for Spotify, etc.)
        // For text queries: use the user-selected source or default to Spotify
        let searchSource;
        let detectedPlatform = source; // Track what platform we detected for logging

        if (isUrl) {
            // URLs should be loaded directly — Lavalink/LavaSrc will handle them natively
            searchSource = undefined;

            // Detect which platform the URL is from for logging
            if (isSpotifyUrl(query)) {
                detectedPlatform = 'spotify';
                console.log(`[Reso] 🟢 Spotify URL detected: ${truncate(query, 80)}`);
            } else if (isYouTubeUrl(query)) {
                detectedPlatform = 'youtube';
                console.log(`[Reso] 🔴 YouTube URL detected: ${truncate(query, 80)}`);
            } else if (isSoundCloudUrl(query)) {
                detectedPlatform = 'soundcloud';
                console.log(`[Reso] 🟠 SoundCloud URL detected: ${truncate(query, 80)}`);
            } else {
                console.log(`[Reso] 🔗 URL detected: ${truncate(query, 80)}`);
            }
        } else {
            // Text query — use selected source or default (spsearch)
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

            // Ensure player is connected to a healthy, active Lavalink node
            ensurePlayerNode(player, interaction.client);

            // Search for the track or playlist
            let result = await player.search({
                query: query,
                source: searchSource,
            }, interaction.user);

            // Log which source actually resolved the track
            if (result.tracks && result.tracks.length > 0) {
                const resolvedSource = result.tracks[0]?.info?.sourceName || 'unknown';
                console.log(`[Reso] ✓ Resolved from: ${resolvedSource} (${result.tracks.length} track(s))`);
            }

            // ── Multi-platform search fallback for text queries ──
            // If the default source (e.g. spsearch) returned nothing, try other platforms.
            // This handles free public nodes that don't have LavaSrc/Spotify configured.
            if ((!result.tracks || result.tracks.length === 0) && !isUrl && (source === 'auto' || source === 'spotify')) {
                const fallbackSources = ['spsearch', 'ytmsearch', 'scsearch', 'ytsearch'];
                // Remove the source we already tried
                const alreadyTried = searchSource;
                const toTry = fallbackSources.filter(s => s !== alreadyTried);

                for (const fbSource of toTry) {
                    try {
                        console.log(`[Reso] ↻ Fallback text search with "${fbSource}" for: ${truncate(query, 60)}`);
                        const fbResult = await player.search({
                            query: query,
                            source: fbSource,
                        }, interaction.user);
                        if (fbResult.tracks && fbResult.tracks.length > 0) {
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

            // Fallback search across other connected nodes if primary node returned empty for a URL
            if ((!result.tracks || result.tracks.length === 0) && isUrl) {
                const connectedNodes = Array.from(manager.nodeManager.nodes.values()).filter(n => n.connected && n.id !== player.node?.id);
                for (const fallbackNode of connectedNodes) {
                    try {
                        console.log(`[Reso] ↻ Trying fallback node "${fallbackNode.id}" for URL...`);
                        const fallbackResult = await fallbackNode.search({
                            query: query,
                            source: undefined,
                        }, interaction.user);
                        if (fallbackResult.tracks && fallbackResult.tracks.length > 0) {
                            result = fallbackResult;
                            const resolvedSource = result.tracks[0]?.info?.sourceName || 'unknown';
                            console.log(`[Reso] ✓ Fallback resolved from: ${resolvedSource} via node "${fallbackNode.id}"`);
                            break;
                        }
                    } catch (e) {
                        // ignore node search error
                    }
                }
            }

            // If Spotify URL failed, try re-searching as text query with spsearch
            if ((!result.tracks || result.tracks.length === 0) && isUrl && isSpotifyUrl(rawQuery)) {
                console.log(`[Reso] ⚠ Spotify URL load failed — the Lavalink node may not have LavaSrc/Spotify configured`);
                // We can't do much here without LavaSrc, but let's log it clearly
            }

            if (!result.tracks || result.tracks.length === 0) {
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
            player.queue.add(track);

            if (!player.playing) {
                await player.play();
            }

            const info = track.info || {};
            const sourceEmoji = SOURCE_EMOJIS[detectedPlatform] || SOURCE_EMOJIS[source] || '🔍';
            const matchedSource = info.sourceName ? capitalize(info.sourceName) : 'Unknown';

            const embed = createEmbed('Success')
                .setDescription(
                    `${sourceEmoji} Found on **${matchedSource}**\n\n` +
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

