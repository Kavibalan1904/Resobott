const { SlashCommandBuilder } = require('discord.js');
const { createEmbed, successEmbed, errorEmbed, EMOJIS, Colors } = require('../../utils/embeds');
const { getVoiceChannel, truncate } = require('../../utils/helpers');
const { voiceDjService } = require('../../ai/voiceDjService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voicedj')
        .setDescription('🎙️ Spotify-Style AI Voice DJ — Charismatic radio host intros for your music')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Action to perform (default: toggle)')
                .setRequired(false)
                .addChoices(
                    { name: '🎙️ Toggle On / Off', value: 'toggle' },
                    { name: '📊 Status & Settings', value: 'status' },
                    { name: '⚡ Preview Sample DJ Line', value: 'preview' },
                    { name: '⏱️ Change Frequency', value: 'frequency' },
                    { name: '🗣️ Change Voice Style', value: 'voice' },
                )
        )
        .addStringOption(option =>
            option.setName('frequency')
                .setDescription('How often the DJ introduces tracks')
                .setRequired(false)
                .addChoices(
                    { name: '🎵 Every Track (Max Hype)', value: 'every' },
                    { name: '⚖️ Every 2 Tracks (Balanced - Default)', value: 'every_2' },
                    { name: '📻 Every 3 Tracks (Subtle)', value: 'every_3' },
                    { name: '👤 User Requests Only', value: 'request_only' },
                )
        )
        .addStringOption(option =>
            option.setName('voice')
                .setDescription('Radio voice style')
                .setRequired(false)
                .addChoices(
                    { name: '📻 Radio Host (US)', value: 'radio' },
                    { name: '🎩 Classic BBC (UK)', value: 'british' },
                    { name: '🌊 Chill Vibes (AU)', value: 'chill' },
                    { name: '🌸 Smooth Radio (Female)', value: 'female' },
                )
        ),

    aliases: ['vdj', 'djvoice', 'aidj'],
    category: 'music',

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const action = interaction.options.getString('action') || 'toggle';
        const selectedFreq = interaction.options.getString('frequency');
        const selectedVoice = interaction.options.getString('voice');

        const currentSettings = voiceDjService.getSettings(guildId);

        // ── Action: Toggle ─────────────────────────────────────────────
        if (action === 'toggle') {
            const newState = !currentSettings.enabled;
            voiceDjService.updateSettings(guildId, { enabled: newState });

            const embed = createEmbed(newState ? 'Success' : 'Primary')
                .setAuthor({ name: '🎙️ Reso Spotify-Style Voice DJ' })
                .setDescription(
                    `### Voice DJ is now **${newState ? '✅ ENABLED' : '❌ DISABLED'}**\n` +
                    `> Reso will ${newState ? 'bring charismatic radio DJ introductions before tracks!' : 'no longer introduce tracks in this server.'}\n\n` +
                    `**⚙️ Current Configuration:**\n` +
                    `• **Frequency:** \`${currentSettings.frequency || 'every_2'}\`\n` +
                    `• **Voice Style:** \`${currentSettings.voice || 'radio'}\`\n` +
                    `• **Smart Fallback:** \`Active (Zero Delay)\`\n\n` +
                    `*💡 Tip: Use \`/voicedj action:preview\` to test a live radio line right now!*`
                );

            return interaction.reply({ embeds: [embed] }).catch(() => {});
        }

        // ── Action: Status ─────────────────────────────────────────────
        if (action === 'status') {
            const isEnabled = currentSettings.enabled;
            const embed = createEmbed('Info')
                .setAuthor({ name: '🎙️ Reso Voice DJ Status & Configuration' })
                .setDescription(
                    `### State: ${isEnabled ? '✅ Enabled' : '❌ Disabled'}\n` +
                    `> **Experience:** Spotify AI DJ-style contextual track introductions\n` +
                    `> **Engine:** Google Gemini 2.0 Flash + Zero-Delay Deterministic Fallback\n\n` +
                    `**🎛️ Settings:**\n` +
                    `• **Frequency:** \`${currentSettings.frequency || 'every_2'}\` *(How often DJ speaks)*\n` +
                    `• **Voice Accent:** \`${currentSettings.voice || 'radio'}\`\n` +
                    `• **Background Caching:** \`✅ Active (Pre-computes next track in queue)\`\n\n` +
                    `**Command Shortcuts:**\n` +
                    `• \`/voicedj action:toggle\` — Switch on/off\n` +
                    `• \`/voicedj action:preview\` — Preview an announcement\n` +
                    `• \`/voicedj action:frequency frequency:every\` — Announce every track`
                );

            return interaction.reply({ embeds: [embed] }).catch(() => {});
        }

        // ── Action: Frequency ──────────────────────────────────────────
        if (action === 'frequency') {
            if (!selectedFreq) {
                return interaction.reply({
                    embeds: [errorEmbed('Please select a frequency option (e.g. `Every Track`, `Every 2 Tracks`, etc.).')],
                    ephemeral: true,
                }).catch(() => {});
            }

            voiceDjService.updateSettings(guildId, { frequency: selectedFreq });
            const embed = successEmbed(`🎙️ Voice DJ frequency updated to: **\`${selectedFreq}\`**!`);
            return interaction.reply({ embeds: [embed] }).catch(() => {});
        }

        // ── Action: Voice Style ────────────────────────────────────────
        if (action === 'voice') {
            if (!selectedVoice) {
                return interaction.reply({
                    embeds: [errorEmbed('Please choose a voice style (e.g. `Radio Host`, `Classic BBC`, etc.).')],
                    ephemeral: true,
                }).catch(() => {});
            }

            voiceDjService.updateSettings(guildId, { voice: selectedVoice });
            const embed = successEmbed(`🗣️ Voice DJ style updated to: **\`${selectedVoice}\`**!`);
            return interaction.reply({ embeds: [embed] }).catch(() => {});
        }

        // ── Action: Preview ────────────────────────────────────────────
        if (action === 'preview') {
            await interaction.deferReply().catch(() => {});

            const player = interaction.client.lavalink?.getPlayer(guildId);
            const sampleTrack = player?.queue?.current || {
                info: {
                    title: 'Blinding Lights',
                    author: 'The Weeknd',
                },
                requester: interaction.user,
            };

            const intro = await voiceDjService.getOrGenerateAnnouncement(guildId, sampleTrack);

            const embed = createEmbed('Music')
                .setAuthor({ name: '🎙️ Reso DJ — Live Preview' })
                .setDescription(
                    `### 📻 Incoming Broadcast:\n` +
                    `> 🎙️ **DJ Reso:** *"${intro?.text || 'Up next, enjoy the beat!'}"*\n\n` +
                    `**Target Track:** **${truncate(sampleTrack.info?.title || 'Track', 40)}** by ${sampleTrack.info?.author || 'Artist'}\n` +
                    `**Requester:** <@${interaction.user.id}>\n` +
                    `**Engine:** Fast AI / Zero-Delay Fallback (${intro?.preparedAt ? 'Cached' : 'Generated'})`
                );

            return interaction.editReply({ embeds: [embed] }).catch(() => {});
        }

        return interaction.reply({
            embeds: [errorEmbed('Invalid action specified. Use `/voicedj` to toggle or configure.')],
            ephemeral: true,
        }).catch(() => {});
    },
};
