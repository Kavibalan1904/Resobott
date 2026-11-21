const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, createEmbed, EMOJIS } = require('../../utils/embeds');
const { getVoiceChannel, truncate } = require('../../utils/helpers');
const { autoplayStore, guildContextManager } = require('../../autoplay');

const VALID_MODES = ['Balanced', 'Familiar', 'Discovery', 'Artist Focus', 'Session Focus'];

function normalizeMode(input) {
    if (!input || typeof input !== 'string') return null;
    const clean = input.trim().toLowerCase();
    for (const valid of VALID_MODES) {
        if (valid.toLowerCase() === clean) return valid;
    }
    if (clean.includes('familiar')) return 'Familiar';
    if (clean.includes('discover')) return 'Discovery';
    if (clean.includes('balance')) return 'Balanced';
    if (clean.includes('artist')) return 'Artist Focus';
    if (clean.includes('session')) return 'Session Focus';
    return null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoplay')
        .setDescription('Configure Reso Smart Autoplay (YouTube Music radio)')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Action to perform (default: toggle)')
                .setRequired(false)
                .addChoices(
                    { name: '🔄 Toggle On / Off', value: 'toggle' },
                    { name: '📊 Status & Seed', value: 'status' },
                    { name: '🎯 Change Recommendation Mode', value: 'mode' },
                    { name: '💡 Explain Last Recommendation', value: 'explain' },
                    { name: '🧹 Clear Autoplay History', value: 'clearhistory' },
                    { name: '👍 Like Current Song / Artist', value: 'like' },
                    { name: '👎 Dislike Current Song / Artist', value: 'dislike' }
                )
        )
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('Recommendation mode (when action is mode)')
                .setRequired(false)
                .addChoices(
                    { name: '⚖️ Balanced (Relevance + Diversity)', value: 'Balanced' },
                    { name: '📻 Familiar (Known Artists & Past Hits)', value: 'Familiar' },
                    { name: '🔭 Discovery (Fresh & New Artists)', value: 'Discovery' },
                    { name: '🎤 Artist Focus (Stay near current artist)', value: 'Artist Focus' },
                    { name: '📜 Session Focus (Anchor to manual requests)', value: 'Session Focus' }
                )
        ),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const rawAction = interaction.options.getString('action');
        const rawMode = interaction.options.getString('mode');
        const context = guildContextManager.getContext(guildId);
        const player = interaction.client.lavalink?.getPlayer(guildId);

        // Intelligently detect if mode was requested directly, via mode option, or via action parameter
        const requestedMode = normalizeMode(rawMode) || normalizeMode(rawAction);

        // ── Direct Mode Switch ──
        if (requestedMode) {
            autoplayStore.setMode(guildId, requestedMode);
            context.mode = requestedMode;

            // If action was specifically 'status', show status embed with updated mode
            if (rawAction === 'status') {
                const isEnabled = autoplayStore.isEnabled(guildId) || interaction.client.autoplayGuilds?.has(guildId);
                const seed = context.getRecommendationSeed();
                const lastPicked = context.lastSelectedTrack;

                const embed = createEmbed('Info')
                    .setAuthor({ name: '🔄 Reso Smart Autoplay Status' })
                    .setDescription(
                        `### State: ${isEnabled ? '✅ Enabled' : '❌ Disabled'}\n` +
                        `> **Engine:** Resonance AI DJ (YouTube Music Radio)\n` +
                        `> **Active Mode:** \`${requestedMode}\` *(Updated)*\n\n` +
                        `**🌱 Current Recommendation Seed:**\n` +
                        `> ${seed?.info ? `**${truncate(seed.info.title, 45)}** by ${seed.info.author || 'Unknown'}` : '*No seed yet (play a song to set seed)*'}\n\n` +
                        `**🎧 Last Autoplay Selection:**\n` +
                        `> ${lastPicked?.info ? `**${truncate(lastPicked.info.title, 45)}** (${context.lastSelectionReason || 'Recommended'})` : '*None in current session*'}\n\n` +
                        `**📜 History Memory:**\n` +
                        `> \`${context.recentHistory.length}\` tracks tracked | \`${context.explicitLikes.size}\` likes | \`${context.explicitDislikes.size}\` dislikes`
                    )
                    .setFooter({ text: 'Use /autoplay action:mode to switch recommendation style' });

                return interaction.reply({ embeds: [embed] });
            }

            const embed = createEmbed('Success')
                .setDescription(`🎯 **Autoplay mode** updated to **\`${requestedMode}\`**! ${EMOJIS.sparkle}`);
            return interaction.reply({ embeds: [embed] });
        }

        const action = rawAction || 'toggle';

        // Subaction: Status
        if (action === 'status') {
            const isEnabled = autoplayStore.isEnabled(guildId) || interaction.client.autoplayGuilds?.has(guildId);
            const currentMode = autoplayStore.getMode(guildId);
            const seed = context.getRecommendationSeed();
            const lastPicked = context.lastSelectedTrack;

            const embed = createEmbed('Info')
                .setAuthor({ name: '🔄 Reso Smart Autoplay Status' })
                .setDescription(
                    `### State: ${isEnabled ? '✅ Enabled' : '❌ Disabled'}\n` +
                    `> **Engine:** Resonance AI DJ (YouTube Music Radio)\n` +
                    `> **Active Mode:** \`${currentMode}\`\n\n` +
                    `**🌱 Current Recommendation Seed:**\n` +
                    `> ${seed?.info ? `**${truncate(seed.info.title, 45)}** by ${seed.info.author || 'Unknown'}` : '*No seed yet (play a song to set seed)*'}\n\n` +
                    `**🎧 Last Autoplay Selection:**\n` +
                    `> ${lastPicked?.info ? `**${truncate(lastPicked.info.title, 45)}** (${context.lastSelectionReason || 'Recommended'})` : '*None in current session*'}\n\n` +
                    `**📜 History Memory:**\n` +
                    `> \`${context.recentHistory.length}\` tracks tracked | \`${context.explicitLikes.size}\` likes | \`${context.explicitDislikes.size}\` dislikes`
                )
                .setFooter({ text: 'Use /autoplay action:mode to switch recommendation style' });

            return interaction.reply({ embeds: [embed] });
        }

        // Subaction: Mode
        if (action === 'mode') {
            const currentMode = autoplayStore.getMode(guildId);
            const embed = createEmbed('Info')
                .setAuthor({ name: '🎯 Autoplay Recommendation Modes' })
                .setDescription(
                    `Current Mode: **\`${currentMode}\`**\n\n` +
                    `**Available Modes:**\n` +
                    `• **\`Balanced\`** (Default) — 30% seed relevance, 20% artist match, 15% session vibe, 15% feedback, 10% novelty, 10% quality.\n` +
                    `• **\`Familiar\`** — Heavily prefers known artists, past hits, and positive feedback.\n` +
                    `• **\`Discovery\`** — Introduces more new and fresh artists within the same genre/language.\n` +
                    `• **\`Artist Focus\`** — Stays tightly focused on the current artist's catalog.\n` +
                    `• **\`Session Focus\`** — Gives dominant weight to the recent sequence of manual requests.\n\n` +
                    `*Select a mode with \`/autoplay action:mode mode:<Choice>\` or \`/autoplay mode:<Choice>\`*`
                );
            return interaction.reply({ embeds: [embed] });
        }

        // Subaction: Explain
        if (action === 'explain') {
            const lastPicked = context.lastSelectedTrack;
            if (!lastPicked || !lastPicked.scoreBreakdown) {
                return interaction.reply({
                    embeds: [errorEmbed('No autoplay track has been selected in this session yet to explain.')],
                    ephemeral: true,
                });
            }

            const breakdown = lastPicked.scoreBreakdown;
            const embed = createEmbed('Autoplay')
                .setAuthor({ name: '💡 Autoplay Recommendation Explanation' })
                .setTitle(truncate(lastPicked.info?.title || 'Unknown Track', 50))
                .setDescription(
                    `**Reason:** ${context.lastSelectionReason || 'Session and seed relevance'}\n` +
                    `**Total Composite Score:** \`${breakdown.totalScore}/100\` (Mode: \`${breakdown.mode}\`)\n\n` +
                    `### Scoring Signal Breakdown:\n` +
                    `• **Seed Relevance:** \`${breakdown.seedRelevance}/100\`\n` +
                    `• **Artist Association:** \`${breakdown.artistAssociation}/100\`\n` +
                    `• **Session Relevance:** \`${breakdown.sessionRelevance}/100\`\n` +
                    `• **User Feedback & Likes:** \`${breakdown.feedbackMatch}/100\`\n` +
                    `• **Novelty & Discovery:** \`${breakdown.novelty}/100\`\n` +
                    `• **Audio Quality & Duration:** \`${breakdown.candidateQuality}/100\``
                )
                .setThumbnail(lastPicked.info?.artworkUrl || null);

            return interaction.reply({ embeds: [embed] });
        }

        // Subaction: Clear History
        if (action === 'clearhistory') {
            context.clearHistory();
            return interaction.reply({
                embeds: [successEmbed('🧹 Autoplay session history, skip metrics, and cached seeds cleared for this server.')]
            });
        }

        // Subaction: Like
        if (action === 'like') {
            const currentTrack = player?.queue?.current;
            if (!currentTrack?.info) {
                return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now to like.')], ephemeral: true });
            }
            const artist = currentTrack.info.author;
            autoplayStore.addLike(guildId, artist);
            context.explicitLikes.add(artist.toLowerCase());
            return interaction.reply({
                embeds: [successEmbed(`👍 Saved **${truncate(artist, 40)}** to your server's positive autoplay preferences!`)]
            });
        }

        // Subaction: Dislike
        if (action === 'dislike') {
            const currentTrack = player?.queue?.current;
            if (!currentTrack?.info) {
                return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now to dislike.')], ephemeral: true });
            }
            const artist = currentTrack.info.author;
            autoplayStore.addDislike(guildId, artist);
            context.explicitDislikes.add(artist.toLowerCase());
            return interaction.reply({
                embeds: [successEmbed(`👎 Saved **${truncate(artist, 40)}** to negative feedback. Autoplay will avoid recommending this in future!`)]
            });
        }

        // Default: Toggle
        const isCurrentlyEnabled = autoplayStore.isEnabled(guildId) || interaction.client.autoplayGuilds?.has(guildId);

        if (isCurrentlyEnabled) {
            autoplayStore.setEnabled(guildId, false);
            interaction.client.autoplayGuilds?.delete(guildId);
            context.enabled = false;

            const embed = createEmbed('Info')
                .setDescription(
                    `${EMOJIS.autoplay} **Autoplay** has been **disabled**.\n\n` +
                    `> The queue will stop when all songs are played.\n` +
                    `> Use \`/autoplay\` again to re-enable.`
                );
            return interaction.reply({ embeds: [embed] });
        } else {
            autoplayStore.setEnabled(guildId, true);
            interaction.client.autoplayGuilds?.add(guildId);
            context.enabled = true;

            const currentMode = autoplayStore.getMode(guildId);
            const embed = createEmbed('Success')
                .setDescription(
                    `${EMOJIS.autoplay} **Reso Smart Autoplay** has been **enabled**! ${EMOJIS.sparkle}\n\n` +
                    `> **Engine:** Resonance AI DJ (Mode: \`${currentMode}\`)\n` +
                    `> When the queue ends, I will intelligently discover and queue similar songs\n` +
                    `> based on your current seed, artist peers, and listening session.\n` +
                    `> Use \`/autoplay action:status\` to inspect or \`/autoplay\` to toggle.`
                );
            return interaction.reply({ embeds: [embed] });
        }
    },
};
