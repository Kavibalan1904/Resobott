const { MessageFlags } = require('discord.js');
const { nowPlayingEmbed, createPlayerControls, successEmbed, errorEmbed, warningEmbed, EMOJIS } = require('../utils/embeds');
const { truncate } = require('../utils/helpers');

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
            content: '❌ This can only be used in a server.',
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
    }

    // Security: user must be in the same voice channel as the bot
    const memberVC = interaction.member?.voice?.channel;
    if (!memberVC) {
        return interaction.reply({
            content: '🎧 You need to be in a voice channel to use player controls!',
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
    }

    const player = client.lavalink.getPlayer(guildId);
    if (!player) {
        return interaction.reply({
            content: '❌ No active player in this server.',
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
    }

    // Ensure user is in the same VC as bot
    if (player.voiceChannelId && memberVC.id !== player.voiceChannelId) {
        return interaction.reply({
            content: '❌ You need to be in the same voice channel as the bot!',
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
                        content: '⏮️ No previous track in history.',
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

                // Re-add the previous track and play it
                player.queue.add(previousTrack, 0);
                await player.skip();

                await interaction.reply({
                    embeds: [successEmbed(`⏮️ Playing previous: **${truncate(previousTrack.info?.title || 'Unknown', 50)}**`)],
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
                            embeds: [successEmbed('▶️ Resumed playback!')],
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
                            embeds: [successEmbed('⏸️ Paused playback!')],
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
                        content: '⏭️ Nothing to skip to.',
                        flags: MessageFlags.Ephemeral,
                    }).catch(() => {});
                }

                await player.skip();

                await interaction.reply({
                    embeds: [successEmbed(`⏭️ Skipped **${title}**`)],
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
                break;
            }

            case 'player_shuffle': {
                const queue = player.queue.tracks;
                if (queue.length < 2) {
                    return interaction.reply({
                        content: '🔀 Need at least 2 songs in queue to shuffle.',
                        flags: MessageFlags.Ephemeral,
                    }).catch(() => {});
                }

                player.queue.shuffle();

                await interaction.reply({
                    embeds: [successEmbed(`🔀 Shuffled **${queue.length}** songs in the queue!`)],
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
                break;
            }

            case 'player_stop': {
                player.queue.clear();
                await player.destroy();

                // Update the original message to disable buttons
                try {
                    await interaction.update({
                        components: [], // Remove all buttons
                    }).catch(() => {});
                } catch {
                    await interaction.reply({
                        embeds: [successEmbed('⏹️ Stopped playback and cleared queue.')],
                        flags: MessageFlags.Ephemeral,
                    }).catch(() => {});
                }
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
