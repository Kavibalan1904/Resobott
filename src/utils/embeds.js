const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { createProgressBar, formatMs, truncate } = require('./helpers');

// ── Reso Brand Colors ──────────────────────────────────────────
const Colors = {
    Primary: 0x5865F2,   // Discord Blurple
    Success: 0x57F287,   // Green
    Warning: 0xFEE75C,   // Yellow
    Error: 0xED4245,     // Red
    Info: 0x5865F2,      // Blurple
    Music: 0xEB459E,     // Fuchsia
    Queue: 0x5865F2,     // Blurple
};

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
};

/**
 * Create a themed Reso embed
 */
function createEmbed(type = 'Primary') {
    const color = Colors[type] || Colors.Primary;
    return new EmbedBuilder()
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: 'Reso • Resonance' });
}

/**
 * Create a "Now Playing" embed for a Lavalink track
 * @param {object} track Lavalink track object (has track.info)
 * @param {object} player Lavalink player instance
 * @param {object} [client] Discord client instance (for resolving voice channel bitrate)
 * @param {Array} [recommendations] Array of recommended Lavalink tracks
 */
function nowPlayingEmbed(track, player, client, recommendations = []) {
    const info = track.info || track;
    const duration = info.duration || 0;
    const position = player.position || 0;
    const isStream = info.isStream || false;

    const progress = isStream
        ? '🔴 Live Stream'
        : createProgressBar(position, duration);

    // Resolve audio bitrate from the voice channel the bot is in
    let bitrateLabel = 'Unknown kbps';
    if (client && player.voiceChannelId) {
        const vc = client.channels?.cache?.get(player.voiceChannelId);
        if (vc && vc.bitrate) {
            bitrateLabel = `${Math.round(vc.bitrate / 1000)} kbps`;
        }
    }

    const embed = createEmbed('Music')
        .setAuthor({ name: 'Now Playing', iconURL: 'https://cdn.discordapp.com/emojis/741605543046807626.gif' })
        .setTitle(info.title || 'Unknown Track')
        .setURL(info.uri || null)
        .setThumbnail(info.artworkUrl || null)
        .addFields(
            { name: `${EMOJIS.clock} Duration`, value: isStream ? 'Live' : formatMs(duration), inline: true },
            { name: `${EMOJIS.dj} Requested by`, value: `${track.requester || 'Unknown'}`, inline: true },
            { name: `${EMOJIS.volume} Volume`, value: `${player.volume}%`, inline: true },
        )
        .setDescription(progress)
        .setFooter({ text: `Reso • ${bitrateLabel}` });

    if (info.sourceName) {
        embed.addFields({ name: `${EMOJIS.disc} Source`, value: capitalize(info.sourceName), inline: true });
    }

    const loopModes = ['Off', 'Track', 'Queue'];
    embed.addFields(
        { name: `${EMOJIS.loop} Loop`, value: loopModes[player.repeatMode] || 'Off', inline: true },
        { name: `${EMOJIS.queue} Queue`, value: `${player.queue.tracks.length} tracks`, inline: true },
    );

    return embed;
}

/**
 * Create interactive action row with recommendation dropdown menu
 * @param {Array} recommendations Array of recommended tracks
 * @param {string} guildId Guild ID
 * @returns {ActionRowBuilder|null}
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
        if (badge.startsWith('🎬')) emoji = '🎬';
        else if (badge.startsWith('🎤')) emoji = '🎤';
        else if (badge.startsWith('🎭')) emoji = '🎭';
        else if (badge.startsWith('🔥')) emoji = '🔥';
        else if (badge.startsWith('🎧')) emoji = '🎧';
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
        .setPlaceholder('🎵 Pick a recommended song to add to queue...')
        .addOptions(options);

    return new ActionRowBuilder().addComponents(selectMenu);
}

/**
 * Create a track-added embed for a Lavalink track
 */
function trackAddedEmbed(track) {
    const info = track.info || track;
    return createEmbed('Success')
        .setAuthor({ name: 'Added to Queue' })
        .setTitle(info.title || 'Unknown Track')
        .setURL(info.uri || null)
        .setThumbnail(info.artworkUrl || null)
        .addFields(
            { name: `${EMOJIS.clock} Duration`, value: info.isStream ? 'Live' : formatMs(info.duration), inline: true },
            { name: `${EMOJIS.dj} Requested by`, value: `${track.requester || 'Unknown'}`, inline: true },
            { name: `${EMOJIS.disc} Source`, value: capitalize(info.sourceName || 'Unknown'), inline: true },
        );
}

/**
 * Create an error embed
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
    createEmbed,
    nowPlayingEmbed,
    createRecommendationComponents,
    trackAddedEmbed,
    errorEmbed,
    successEmbed,
    warningEmbed,
    infoEmbed,
    capitalize,
};
