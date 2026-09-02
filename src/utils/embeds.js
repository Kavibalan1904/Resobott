const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { createProgressBar, formatMs, truncate } = require('./helpers');

// ── Reso Premium Color Palette ─────────────────────────────────
// Signature gradient-inspired palette: deep violet → electric pink → warm coral
const Colors = {
    Primary: 0x7C3AED,   // Deep Violet (signature Reso color)
    Success: 0x10B981,   // Emerald Green
    Warning: 0xF59E0B,   // Amber
    Error: 0xEF4444,     // Soft Red
    Info: 0x6366F1,      // Indigo
    Music: 0xEC4899,     // Electric Pink (now playing)
    Queue: 0x8B5CF6,     // Purple (queue embeds)
    NowPlaying: 0xEC4899, // Electric Pink
    Autoplay: 0x06B6D4,  // Cyan (autoplay indicator)
};

// ── Premium Source Badges ──────────────────────────────────────
const SOURCE_BADGES = {
    youtube: { emoji: '🔴', label: 'YouTube', color: '🔴' },
    spotify: { emoji: '🟢', label: 'Spotify', color: '🟢' },
    soundcloud: { emoji: '🟠', label: 'SoundCloud', color: '🟠' },
    applemusic: { emoji: '🍎', label: 'Apple Music', color: '🍎' },
    deezer: { emoji: '🟣', label: 'Deezer', color: '🟣' },
    tidal: { emoji: '⬛', label: 'Tidal', color: '⬛' },
    bandcamp: { emoji: '🔵', label: 'Bandcamp', color: '🔵' },
    twitch: { emoji: '🟣', label: 'Twitch', color: '🟣' },
    vimeo: { emoji: '🔷', label: 'Vimeo', color: '🔷' },
};

function getSourceBadge(sourceName) {
    if (!sourceName) return { emoji: '🎵', label: 'Unknown', color: '⚪' };
    const key = sourceName.toLowerCase().replace(/\s+/g, '');
    return SOURCE_BADGES[key] || { emoji: '🎵', label: capitalize(sourceName), color: '⚪' };
}

const EMOJIS = {
    music: '🎵',
    play: '▶️',
    pause: '⏸️',
    stop: '⏹️',
    skip: '⏭️',
    back: '⏮️',
    loop: '🔁',
    loopOne: '🔂',
    shuffle: '🔀',
    volume: '🔊',
    volumeMute: '🔇',
    volumeLow: '🔉',
    queue: '📋',
    filter: '🎛️',
    lyrics: '📝',
    clock: '⏱️',
    disc: '💿',
    star: '⭐',
    link: '🔗',
    ping: '🏓',
    info: 'ℹ️',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    grab: '💾',
    dj: '🎧',
    live: '🔴',
    search: '🔍',
    autoplay: '🔄',
    speed: '⏩',
    playnext: '📌',
    voteskip: '🗳️',
    fire: '🔥',
    sparkle: '✨',
    wave: '🌊',
    headphones: '🎧',
};

/**
 * Create a themed Reso embed with premium styling
 */
function createEmbed(type = 'Primary') {
    const color = Colors[type] || Colors.Primary;
    return new EmbedBuilder()
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: 'Reso  ♪  Resonance in every beat' });
}

// ── Premium Progress Bar ───────────────────────────────────────
/**
 * Create a premium visual progress bar
 * Uses filled/empty blocks with a slider indicator
 */
function premiumProgressBar(position, duration, length = 12) {
    if (!duration || duration <= 0) return '`🔴` ━━━━━━━━━━━━ `LIVE`';

    const progress = Math.min(position / duration, 1);
    const filledLength = Math.round(progress * length);
    const emptyLength = Math.max(0, length - filledLength - 1);

    const filled = '━'.repeat(filledLength);
    const slider = '◉';
    const empty = '━'.repeat(emptyLength);

    const elapsed = formatMs(position);
    const total = formatMs(duration);

    return `\`${elapsed}\` ${filled}${slider}${empty} \`${total}\``;
}

// ── Volume Icon Helper ─────────────────────────────────────────
function getVolumeEmoji(volume) {
    if (volume === 0) return EMOJIS.volumeMute;
    if (volume <= 40) return EMOJIS.volumeLow;
    return EMOJIS.volume;
}

// ── Loop Mode Label ────────────────────────────────────────────
function getLoopLabel(repeatMode) {
    const modes = [
        { emoji: '▬', label: 'Off' },
        { emoji: '🔂', label: 'Track' },
        { emoji: '🔁', label: 'Queue' },
    ];
    return modes[repeatMode] || modes[0];
}

/**
 * Create a premium "Now Playing" embed with rich visual design
 */
function nowPlayingEmbed(track, player, client, recommendations = []) {
    const info = track.info || track;
    const duration = info.duration || 0;
    const position = player.position || 0;
    const isStream = info.isStream || false;

    // Progress bar
    const progress = isStream
        ? '`🔴` ━━━━━━━━━━━━ `LIVE STREAM`'
        : premiumProgressBar(position, duration);

    // Source badge
    const source = getSourceBadge(info.sourceName);

    // Volume emoji
    const volEmoji = getVolumeEmoji(player.volume);

    // Loop mode
    const loop = getLoopLabel(player.repeatMode);

    // Resolve audio bitrate
    let bitrateLabel = '';
    if (client && player.voiceChannelId) {
        const vc = client.channels?.cache?.get(player.voiceChannelId);
        if (vc && vc.bitrate) {
            bitrateLabel = `${Math.round(vc.bitrate / 1000)}kbps`;
        }
    }

    // Queue info
    const queueLength = player.queue.tracks.length;
    const queueText = queueLength > 0 ? `${queueLength} song${queueLength !== 1 ? 's' : ''} in queue` : 'Queue empty';

    // Filters active
    const activeFilters = player.activeFilters ? player.activeFilters.size : 0;
    const filterText = activeFilters > 0 ? ` • 🎛️ ${activeFilters} filter${activeFilters !== 1 ? 's' : ''}` : '';

    // Autoplay status
    const autoplayOn = client?.autoplayGuilds?.has(player.guildId);
    const autoplayText = autoplayOn ? ' • 🔄 Autoplay' : '';

    // Build the rich description
    const description = [
        `### ${source.color} [${truncate(info.title || 'Unknown Track', 55)}](${info.uri || ''})`,
        `> **${info.author || 'Unknown Artist'}** • ${source.label}`,
        '',
        progress,
        '',
        `${volEmoji} \`${player.volume}%\`  ${loop.emoji} \`${loop.label}\`  ${EMOJIS.queue} \`${queueText}\`${filterText}${autoplayText}`,
    ].join('\n');

    const embed = new EmbedBuilder()
        .setColor(Colors.NowPlaying)
        .setAuthor({
            name: '♪ Now Playing',
            iconURL: 'https://cdn.discordapp.com/emojis/741605543046807626.gif',
        })
        .setDescription(description)
        .setThumbnail(info.artworkUrl || null)
        .setFooter({
            text: `Reso  ♪  ${bitrateLabel ? bitrateLabel + ' • ' : ''}Requested by ${track.requester?.username || track.requester?.tag || 'Unknown'}`,
        })
        .setTimestamp();

    return embed;
}

/**
 * Create interactive player control buttons
 * [ ⏮ ] [ ⏸/▶ ] [ ⏭ ] [ 🔀 ] [ ⏹ ]
 */
function createPlayerControls(isPaused = false) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('player_back')
            .setEmoji('⏮️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('player_pause')
            .setEmoji(isPaused ? '▶️' : '⏸️')
            .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('player_skip')
            .setEmoji('⏭️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('player_shuffle')
            .setEmoji('🔀')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('player_stop')
            .setEmoji('⏹️')
            .setStyle(ButtonStyle.Danger),
    );
    return row;
}

/**
 * Create disabled player controls (for ended tracks)
 */
function createDisabledControls() {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('player_back')
            .setEmoji('⏮️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('player_pause')
            .setEmoji('⏸️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('player_skip')
            .setEmoji('⏭️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('player_shuffle')
            .setEmoji('🔀')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('player_stop')
            .setEmoji('⏹️')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(true),
    );
    return row;
}

/**
 * Create interactive action row with recommendation dropdown menu
 */
function createRecommendationComponents(recommendations = [], guildId = '') {
    if (!recommendations || recommendations.length === 0) return null;

    const sliced = recommendations.slice(0, 5);
    const options = sliced.map((rec, idx) => {
        const rInfo = rec.info || {};
        const rTitle = truncate(rInfo.title || `Song ${idx + 1}`, 70);
        const badge = rec.categoryLabel || '🎵 Recommended';
        const dur = rInfo.isStream ? 'Live' : formatMs(rInfo.duration || 0);

        let emoji = '🎵';
        if (badge.startsWith('🎬')) emoji = '🎬';       // Tier 2: Same Movie/Album
        else if (badge.startsWith('🎤')) emoji = '🎤';   // Tier 3: Same Singer/Artist
        else if (badge.startsWith('🎧')) emoji = '🎧';   // Tier 1: Composer Collab
        else if (badge.startsWith('🔥')) emoji = '🔥';   // Tier 4: Genre Match
        else if (badge.startsWith('✨')) emoji = '✨';    // Tier 5: Discovery/Trending
        else if (badge.startsWith('🎭')) emoji = '🎭';
        else if (badge.startsWith('🎲')) emoji = '🎲';

        return {
            label: `${idx + 1}. ${rTitle}`,
            description: `${badge} • ${dur}`,
            value: String(idx),
            emoji: emoji,
        };
    });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`rec_select_${guildId}`)
        .setPlaceholder('✨ Pick a recommended song to add to queue...')
        .addOptions(options);

    return new ActionRowBuilder().addComponents(selectMenu);
}

/**
 * Create a premium track-added embed
 */
function trackAddedEmbed(track) {
    const info = track.info || track;
    const source = getSourceBadge(info.sourceName);

    return createEmbed('Success')
        .setAuthor({ name: '✨ Added to Queue' })
        .setDescription(
            `**[${truncate(info.title || 'Unknown Track', 55)}](${info.uri || ''})**\n` +
            `> ${info.author || 'Unknown Artist'} • ${source.color} ${source.label}`
        )
        .setThumbnail(info.artworkUrl || null)
        .addFields(
            { name: `${EMOJIS.clock} Duration`, value: info.isStream ? '🔴 Live' : `\`${formatMs(info.duration)}\``, inline: true },
            { name: `${EMOJIS.dj} Requested by`, value: `${track.requester || 'Unknown'}`, inline: true },
        );
}

/**
 * Create an error embed with premium styling
 */
function errorEmbed(message) {
    return createEmbed('Error')
        .setDescription(`${EMOJIS.error} ${message}`);
}

/**
 * Create a success embed
 */
function successEmbed(message) {
    return createEmbed('Success')
        .setDescription(`${EMOJIS.success} ${message}`);
}

/**
 * Create a warning embed
 */
function warningEmbed(message) {
    return createEmbed('Warning')
        .setDescription(`${EMOJIS.warning} ${message}`);
}

/**
 * Create an info embed
 */
function infoEmbed(message) {
    return createEmbed('Info')
        .setDescription(`${EMOJIS.info} ${message}`);
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = {
    Colors,
    EMOJIS,
    SOURCE_BADGES,
    getSourceBadge,
    createEmbed,
    nowPlayingEmbed,
    premiumProgressBar,
    createPlayerControls,
    createDisabledControls,
    createRecommendationComponents,
    trackAddedEmbed,
    errorEmbed,
    successEmbed,
    warningEmbed,
    infoEmbed,
    capitalize,
};
