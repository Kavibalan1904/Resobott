/**
 * Reso AI DJ Command (/vibe and >vibe)
 * Interprets natural language music requests and curates playlists using existing Lavalink infrastructure.
 */

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { createEmbed, errorEmbed, successEmbed, EMOJIS, Colors, getSourceBadge } = require('../../utils/embeds');
const {
    getVoiceChannel,
    checkVoicePermissions,
    isInSameVoiceChannel,
    truncate,
    formatMs,
    ensurePlayerNode,
    getBestNode,
} = require('../../utils/helpers');
const { djService } = require('../../ai/djService');
const { feedbackStore } = require('../../ai/feedbackStore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vibe')
        .setDescription('🎧 AI Music DJ — Curate a playlist matching any vibe, mood, language, or era')
        .addStringOption(option =>
            option.setName('request')
                .setDescription('Describe your vibe (e.g., "relaxing Tamil melodies from 2000s", "hype gaming EDM")')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('count')
                .setDescription('Number of tracks to generate (3 to 25, default: 10)')
                .setMinValue(3)
                .setMaxValue(25)
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('replace')
                .setDescription('Replace current queue instead of appending (default: false)')
                .setRequired(false)
        ),

    async execute(interaction, client) {
        // 1. Defer immediately to avoid Discord 3s timeout
        let deferred = false;
        try {
            await interaction.deferReply();
            deferred = true;
        } catch (deferErr) {
            console.warn('[Reso DJ] deferReply failed:', deferErr.message);
            return;
        }

        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.editReply({
                embeds: [errorEmbed('You must be in a voice channel to use the AI DJ!')],
            }).catch(() => { });
        }

        // 2. Validate voice channel permissions
        const permCheck = checkVoicePermissions(voiceChannel, interaction.client.user);
        if (!permCheck.allowed) {
            return interaction.editReply({
                embeds: [errorEmbed(permCheck.reason)],
            }).catch(() => { });
        }

        // 3. Same voice channel check
        if (!isInSameVoiceChannel(interaction)) {
            return interaction.editReply({
                embeds: [errorEmbed('I am currently active in another voice channel. Join my channel or wait until I am free!')],
            }).catch(() => { });
        }

        // 4. Rate limiting per user
        const rateCheck = djService.checkRateLimit(interaction.user.id);
        if (!rateCheck.allowed) {
            return interaction.editReply({
                embeds: [errorEmbed(`⏳ Please slow down! You can request another vibe in **${rateCheck.waitSeconds}s**.`)]
            }).catch(() => { });
        }

        // 5. Concurrency lock per guild/user
        const lockAcquired = djService.acquireLock(interaction.guild.id, interaction.user.id);
        if (!lockAcquired) {
            return interaction.editReply({
                embeds: [errorEmbed('⏳ Another AI DJ playlist is currently being generated for this session. Please wait a moment.')]
            }).catch(() => { });
        }

        try {
            const rawRequest = interaction.options.getString('request') || interaction.options.getString('query');
            const targetCount = interaction.options.getInteger('count') || null;
            const replaceQueue = interaction.options.getBoolean('replace') || false;

            if (!rawRequest) {
                return interaction.editReply({
                    embeds: [errorEmbed('Please describe what music or vibe you would like me to play!')]
                });
            }

            // 6. Connect to Lavalink node & player
            const manager = interaction.client.lavalink;
            const connectedNodes = Array.from(manager.nodeManager.nodes.values()).filter(n => n.connected);
            if (connectedNodes.length === 0) {
                return interaction.editReply({
                    embeds: [errorEmbed('🔌 All music nodes are currently offline or reconnecting. Please try again in a few moments.')]
                });
            }

            const targetNode = getBestNode(manager) || connectedNodes[0];
            const { getDesignatedChannel } = require('../../utils/settings');
            const targetTextChannelId = getDesignatedChannel(interaction.guild.id) || interaction.channel.id;

            let player = manager.getPlayer(interaction.guild.id);
            if (!player) {
                player = manager.createPlayer({
                    guildId: interaction.guild.id,
                    voiceChannelId: voiceChannel.id,
                    textChannelId: targetTextChannelId,
                    selfDeaf: true,
                    volume: parseInt(process.env.DEFAULT_VOLUME) || 50,
                    node: targetNode.id,
                });
            } else if (getDesignatedChannel(interaction.guild.id)) {
                player.textChannelId = getDesignatedChannel(interaction.guild.id);
            }

            if (!player.connected) {
                await player.connect();
            }
            await ensurePlayerNode(player, interaction.client);

            // Context from currently playing track (if any)
            const context = player?.queue?.current?.info ? {
                title: player.queue.current.info.title,
                author: player.queue.current.info.author,
            } : null;

            // 7. Interpret Request (AI -> Deterministic Fallback)
            const { intent, isFallback, fallbackReason } = await djService.interpretRequest(rawRequest, targetCount, context);

            // 8. Discover and rank genuine tracks
            const discovery = await djService.discoverAndRankTracks(player, intent, interaction.user, interaction.guild.id);
            const tracks = discovery.tracks;

            if (!tracks || tracks.length === 0) {
                return interaction.editReply({
                    embeds: [errorEmbed(
                        `Could not find any tracks matching that vibe: **"${truncate(rawRequest, 60)}"**.\n\n` +
                        `💡 **Tip**: Try broader terms (e.g., \`>vibe chill acoustic pop\` or \`>vibe 90s Tamil melodies\`).`
                    )]
                });
            }

            // Calculate total playlist duration
            let totalMs = 0;
            for (const t of tracks) {
                if (t.info?.duration && !t.info?.isStream) totalMs += t.info.duration;
            }
            const totalDurationStr = formatMs(totalMs);

            // Build preview embed
            const trackLines = tracks.map((track, i) => {
                const info = track.info || {};
                const src = getSourceBadge(info.sourceName);
                const dur = info.isStream ? 'Live' : formatMs(info.duration);
                return `\`${i + 1}.\` ${src.color} **[${truncate(info.title, 42)}](${info.uri || ''})**\n　　 ${EMOJIS.clock} \`${dur}\` • ${info.author || 'Unknown'}`;
            }).join('\n');

            const vibeDetails = [];
            if (intent.mood) vibeDetails.push(`**Mood**: \`${intent.mood}\``);
            if (intent.languages?.length > 0) vibeDetails.push(`**Language**: \`${intent.languages.join(', ')}\``);
            if (intent.genres?.length > 0) vibeDetails.push(`**Genre**: \`${intent.genres.join(', ')}\``);
            if (intent.eras?.length > 0) vibeDetails.push(`**Era**: \`${intent.eras.join(', ')}\``);
            if (intent.energy) vibeDetails.push(`**Energy**: \`${intent.energy}\``);
            if (intent.excludedTerms?.length > 0) vibeDetails.push(`**Excluded**: \`${intent.excludedTerms.join(', ')}\``);

            const engineTag = isFallback
                ? (fallbackReason ? `*(Offline Rules Engine — ${truncate(fallbackReason, 45)})*` : '*(Offline Rules Engine)*')
                : '*(AI Powered)*';

            const embed = createEmbed('Music')
                .setAuthor({
                    name: `🎧 Reso AI DJ — ${intent.summary || 'Curated Vibe'}`,
                    iconURL: interaction.client.user.displayAvatarURL(),
                })
                .setDescription(
                    `> *"${truncate(rawRequest, 100)}"* ${engineTag}\n\n` +
                    vibeDetails.join(' • ') + '\n\n' +
                    `### 🎶 Playlist Preview (${tracks.length} Songs • ${totalDurationStr})\n` +
                    `${trackLines}\n\n` +
                    `*Click **Add to Queue** to listen without interrupting current playback!*`
                )
                .setFooter({
                    text: `Reso DJ  ♪  Requested by ${interaction.user.username} • Auto-expires in 60s`,
                });

            // Action buttons
            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`vibe_add_${interaction.id}`)
                    .setLabel('➕ Add to Queue')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`vibe_shuffle_${interaction.id}`)
                    .setLabel('🔀 Add & Shuffle')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`vibe_cancel_${interaction.id}`)
                    .setLabel('❌ Cancel')
                    .setStyle(ButtonStyle.Secondary),
            );

            const feedbackRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`vibe_like_${interaction.id}`)
                    .setLabel('👍 More like this')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`vibe_dislike_${interaction.id}`)
                    .setLabel('👎 Less like this')
                    .setStyle(ButtonStyle.Secondary),
            );

            const replyMessage = await interaction.editReply({
                embeds: [embed],
                components: [actionRow, feedbackRow],
            });

            // Component Collector (60 seconds)
            const collector = replyMessage.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 60_000,
            });

            collector.on('collect', async (btnInt) => {
                if (btnInt.user.id !== interaction.user.id) {
                    return btnInt.reply({
                        content: '❌ Only the person who requested this vibe can control this menu.',
                        ephemeral: true,
                    });
                }

                const cid = btnInt.customId;

                // ── Feedback: Like ──
                if (cid === `vibe_like_${interaction.id}`) {
                    const tag = intent.mood || intent.genres[0] || intent.languages[0] || 'vibe';
                    feedbackStore.addLike(interaction.guild.id, interaction.user.id, tag);
                    return btnInt.reply({
                        content: `✨ Noted! I will favor **${tag}** tracks in future playlists for you.`,
                        ephemeral: true,
                    });
                }

                // ── Feedback: Dislike ──
                if (cid === `vibe_dislike_${interaction.id}`) {
                    const tag = intent.mood || intent.genres[0] || intent.languages[0] || 'vibe';
                    feedbackStore.addDislike(interaction.guild.id, interaction.user.id, tag);
                    return btnInt.reply({
                        content: `Got it! I will reduce **${tag}** tracks in future playlists for you.`,
                        ephemeral: true,
                    });
                }

                // ── Cancel ──
                if (cid === `vibe_cancel_${interaction.id}`) {
                    collector.stop('cancelled');
                    const cancelEmbed = createEmbed('Info')
                        .setDescription(`❌ AI DJ playlist request cancelled. Queue was not modified.`);
                    return btnInt.update({
                        embeds: [cancelEmbed],
                        components: [],
                    }).catch(() => { });
                }

                // ── Add to Queue (Standard or Shuffled) ──
                if (cid === `vibe_add_${interaction.id}` || cid === `vibe_shuffle_${interaction.id}`) {
                    collector.stop('added');
                    await btnInt.deferUpdate().catch(() => { });

                    // Re-verify player and voice channel
                    const { getDesignatedChannel } = require('../../utils/settings');
                    const targetTextChannelId = getDesignatedChannel(interaction.guild.id) || interaction.channel.id;

                    let activePlayer = manager.getPlayer(interaction.guild.id);
                    if (!activePlayer) {
                        activePlayer = manager.createPlayer({
                            guildId: interaction.guild.id,
                            voiceChannelId: voiceChannel.id,
                            textChannelId: targetTextChannelId,
                            selfDeaf: true,
                            volume: parseInt(process.env.DEFAULT_VOLUME) || 50,
                            node: targetNode.id,
                        });
                    } else if (getDesignatedChannel(interaction.guild.id)) {
                        activePlayer.textChannelId = getDesignatedChannel(interaction.guild.id);
                    }

                    if (!activePlayer.connected) {
                        await activePlayer.connect();
                    }
                    await ensurePlayerNode(activePlayer, interaction.client);

                    // If user explicitly chose queue replacement
                    if (replaceQueue && activePlayer.queue.tracks.length > 0) {
                        await activePlayer.queue.splice(0, activePlayer.queue.tracks.length);
                    }

                    // Add tracks to queue
                    activePlayer.queue.add(tracks);

                    if (cid === `vibe_shuffle_${interaction.id}`) {
                        activePlayer.queue.shuffle();
                    }

                    // Start playback only if currently stopped/idle (DOES NOT INTERRUPT current playing song)
                    const wasPlaying = activePlayer.playing;
                    if (!wasPlaying) {
                        await activePlayer.play();
                    }

                    const queuedEmbed = createEmbed('Success')
                        .setAuthor({
                            name: `🎧 Playlist Queued — ${intent.summary || 'Reso AI DJ'}`,
                            iconURL: interaction.client.user.displayAvatarURL(),
                        })
                        .setDescription(
                            `${EMOJIS.success} Added **${tracks.length}** tracks (\`${totalDurationStr}\`) to the queue!\n\n` +
                            (wasPlaying
                                ? `▶ Current song **[${truncate(activePlayer.queue.current?.info?.title || 'Current Song', 45)}](${activePlayer.queue.current?.info?.uri || ''})** is still playing undisturbed.\n${EMOJIS.queue} Vibe tracks will play next in order.`
                                : `▶ Now playing the first track from the vibe!`) +
                            (cid === `vibe_shuffle_${interaction.id}` ? '\n🔀 Queue was shuffled.' : '')
                        )
                        .setFooter({ text: 'Reso  ♪  Resonance in every beat' });

                    return interaction.editReply({
                        embeds: [queuedEmbed],
                        components: [],
                    }).catch(() => { });
                }
            });

            collector.on('end', async (_, reason) => {
                if (reason === 'time') {
                    // Disable components on timeout
                    const disabledAction = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('d1').setLabel('➕ Add to Queue').setStyle(ButtonStyle.Success).setDisabled(true),
                        new ButtonBuilder().setCustomId('d2').setLabel('🔀 Add & Shuffle').setStyle(ButtonStyle.Primary).setDisabled(true),
                        new ButtonBuilder().setCustomId('d3').setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary).setDisabled(true),
                    );
                    await interaction.editReply({ components: [disabledAction] }).catch(() => { });
                }
            });

        } catch (error) {
            console.error('[Reso DJ] Execution error:', error);
            const errEmbed = errorEmbed(`Could not generate AI DJ playlist: ${truncate(error.message, 100)}`);
            return interaction.editReply({ embeds: [errEmbed] }).catch(() => { });
        } finally {
            // Always release concurrency lock
            djService.releaseLock(interaction.guild.id, interaction.user.id);
        }
    },
};
