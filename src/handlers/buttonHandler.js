const { MessageFlags } = require('discord.js');
const { nowPlayingEmbed, createPlayerControls, successEmbed, errorEmbed, warningEmbed, EMOJIS } = require('../utils/embeds');
const { truncate } = require('../utils/helpers');
const { setTrackMetadata } = require('../utils/trackMetadata');
const { guildContextManager } = require('../autoplay');

/**
 * Handle all player button interactions (⏮ ⏸ ⏭ 🔀 ⏹)
 * Buttons are attached to the Now Playing embed
 */
async function handlePlayerButton(interaction, client) {
    const customId = interaction.customId;

    // Only handle player_ prefixed buttons
    if (!customId.startsWith('player_')) return false;

    const guildId = interaction.guild?.id;
    if (!guildId) {
        return interaction.reply({
            content: '✨ This button is for voice channels inside a server.',
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
    }

    // Security: user must be in the same voice channel as the bot
    const memberVC = interaction.member?.voice?.channel;
    if (!memberVC) {
        return interaction.reply({
            content: '🎧 Hop into the voice channel first so you can control the music!',
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
    }

    const player = client.lavalink.getPlayer(guildId);
    if (!player) {
        return interaction.reply({
            content: '☕ Nothing is playing right now.',
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
    }

    // Ensure user is in the same VC as bot
    if (player.voiceChannelId && memberVC.id !== player.voiceChannelId) {
        return interaction.reply({
            content: '🎧 Join my voice channel so we can listen together!',
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
    }

    try {
        switch (customId) {
            case 'player_back': {
                // Play previous track from history
                const history = client.trackHistory?.get(guildId) || [];
                if (history.length < 2) {
                    return interaction.reply({
                        content: '⏮️ We are at the very beginning — no earlier songs yet.',
                        flags: MessageFlags.Ephemeral,
                    }).catch(() => {});
                }

                const previousTrack = history[history.length - 2];
                if (!previousTrack) {
                    return interaction.reply({
                        content: '⏮️ No previous track available.',
                        flags: MessageFlags.Ephemeral,
                    }).catch(() => {});
                }

                previousTrack.requester = interaction.user;
                previousTrack.isAutoplay = false;
                previousTrack.isRecommendation = false;
                setTrackMetadata(guildId, previousTrack, {
                    isAutoplay: false,
                    isRecommendation: false,
                    requester: interaction.user,
                });
                player.queue.add(previousTrack, 0);
                await player.skip(0, false);

                await interaction.reply({
                    embeds: [successEmbed(`⏮️ Taking it back to: **${truncate(previousTrack.info?.title || 'Unknown', 50)}** ✨`)],
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
                break;
            }

            case 'player_pause': {
                if (player.paused) {
                    await player.resume();
                    // Update the button on the message to show ⏸
                    const track = player.queue.current;
                    if (track) {
                        const embed = nowPlayingEmbed(track, player, client);
                        const controls = createPlayerControls(false);
                        await interaction.update({
                            embeds: [embed],
                            components: [controls],
                        }).catch(() => {});
                    } else {
                        await interaction.reply({
                            embeds: [successEmbed('▶️ Music resumed — enjoy the vibes! ✨')],
                            flags: MessageFlags.Ephemeral,
                        }).catch(() => {});
                    }
                } else {
                    await player.pause();
                    // Update the button to show ▶
                    const track = player.queue.current;
                    if (track) {
                        const embed = nowPlayingEmbed(track, player, client);
                        const controls = createPlayerControls(true);
                        await interaction.update({
                            embeds: [embed],
                            components: [controls],
                        }).catch(() => {});
                    } else {
                        await interaction.reply({
                            embeds: [successEmbed('⏸️ Paused for a moment. Take your time! ☕')],
                            flags: MessageFlags.Ephemeral,
                        }).catch(() => {});
                    }
                }
                break;
            }

            case 'player_skip': {
                const currentTrack = player.queue.current;
                const title = truncate(currentTrack?.info?.title || 'Unknown', 50);

                if (player.queue.tracks.length === 0 && !player.queue.current) {
                    return interaction.reply({
                        content: '⏭️ Nothing to skip to right now.',
                        flags: MessageFlags.Ephemeral,
                    }).catch(() => {});
                }

                await player.skip(0, false);

                await interaction.reply({
                    embeds: [successEmbed(`⏭️ Skipped **${title}** — moving along ✨`)],
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
                break;
            }

            case 'player_shuffle': {
                const queue = player.queue.tracks;
                if (queue.length < 2) {
                    return interaction.reply({
                        content: '🔀 Add at least 2 songs in the queue to shuffle the mix!',
                        flags: MessageFlags.Ephemeral,
                    }).catch(() => {});
                }

                player.queue.shuffle();

                await interaction.reply({
                    embeds: [successEmbed(`🔀 Shuffled **${queue.length}** songs into a fresh mix! 🍃`)],
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
                break;
            }

            case 'player_stop': {
                if (player.repeatMode && player.repeatMode !== 'off') {
                    await player.setRepeatMode('off').catch(() => {});
                }

                player.setData('manualStop', true);
                try {
                    guildContextManager.getContext(guildId)?.nextGeneration();
                } catch { /* ignore */ }

                if (player.queue?.tracks?.length > 0) {
                    await player.queue.splice(0, player.queue.tracks.length);
                }

                await player.stopPlaying(true, false);

                // Delete the Now Playing message to keep channel clean
                try {
                    await interaction.message?.delete().catch(() => {});
                } catch { /* ignore */ }

                await interaction.reply({
                    embeds: [successEmbed('⏹️ Stopped playback and cleared the queue. Ready whenever you are! ☕')],
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
                break;
            }

            default:
                return false;
        }
    } catch (error) {
        console.error('[Reso] Button handler error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                embeds: [errorEmbed('Something went wrong with the player controls.')],
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    }

    return true;
}

module.exports = { handlePlayerButton };
