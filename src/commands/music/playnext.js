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
                if (isUrlQuery && isYouTubeUrl(query)) {
                    const vid = extractYouTubeVideoId(query);
                    if (vid) {
                        try {
                            result = await player.search({ query: vid, source: 'ytsearch' }, interaction.user);
                        } catch {}
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
