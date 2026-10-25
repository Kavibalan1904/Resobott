const { SlashCommandBuilder } = require('discord.js');
const { createEmbed, successEmbed, errorEmbed, EMOJIS, Colors } = require('../../utils/embeds');
const { getVoiceChannel, truncate, getBestNode, ensurePlayerNode } = require('../../utils/helpers');
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
                    { name: '🎛️ Change Mode (Voice/Text/Both)', value: 'mode' },
                    { name: '🗣️ Change Voice Personality', value: 'voice' },
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
            option.setName('mode')
                .setDescription('Announcement output style')
                .setRequired(false)
                .addChoices(
                    { name: '🎙️ Voice + Chat Embed (Default)', value: 'both' },
                    { name: '🔊 Voice Channel Only', value: 'voice' },
                    { name: '💬 Chat Embed Only (No VC Voice)', value: 'text' },
                )
        )
        .addStringOption(option =>
            option.setName('voice')
                .setDescription('DJ Voice Personality')
                .setRequired(false)
                .addChoices(
                    { name: '🎙️ DJ Xavier (Spotify AI DJ - Deep Host [OpenAI])', value: 'onyx' },
                    { name: '🎙️ DJ Brian (Charismatic Radio Announcer [ElevenLabs])', value: 'brian' },
                    { name: '🌸 DJ Nova (Upbeat & Energetic Female Host)', value: 'nova' },
                    { name: '📻 DJ Echo (Smooth & Casual Male Host)', value: 'echo' },
                    { name: '📻 DJ Carter (Classic US Web Radio)', value: 'radio' },
                    { name: '🎩 DJ Arthur (Classic UK Web Radio)', value: 'british' },
                    { name: '🌊 DJ Leo (Chill Australian Vibes)', value: 'chill' },
                    { name: '🌸 DJ Sarah (Smooth Female Web)', value: 'female' },
                )
        ),

    aliases: ['vdj', 'djvoice', 'aidj'],
    category: 'music',

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const action = interaction.options.getString('action') || 'toggle';
        const selectedFreq = interaction.options.getString('frequency');
        const selectedMode = interaction.options.getString('mode');
        const selectedVoice = interaction.options.getString('voice');

        const currentSettings = voiceDjService.getSettings(guildId);
        const activeEngine = voiceDjService.getActiveTtsEngine();

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
                    `• **Voice Engine:** \`${activeEngine.name}\` ${activeEngine.isHuman ? '🌟' : '🤖'}\n` +
                    `• **Mode:** \`${currentSettings.mode || 'both'}\` *(voice, text, both)*\n` +
                    `• **Frequency:** \`${currentSettings.frequency || 'every_2'}\`\n` +
                    `• **Voice Style:** \`${currentSettings.voice || 'onyx'}\`\n\n` +
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
                    `> **Voice Engine:** \`${activeEngine.name}\` ${activeEngine.isHuman ? '🌟 (Human Studio Quality)' : '🤖 (Synthesizer Fallback)'}\n\n` +
                    `**🎛️ Settings:**\n` +
                    `• **Mode:** \`${currentSettings.mode || 'both'}\` *(Voice & Chat Embed)*\n` +
                    `• **Frequency:** \`${currentSettings.frequency || 'every_2'}\` *(How often DJ speaks)*\n` +
                    `• **Voice Personality:** \`${currentSettings.voice || 'onyx'}\`\n` +
                    `• **Background Caching:** \`✅ Active (Zero-delay pre-caching)\`\n\n` +
                    (!activeEngine.isHuman
                        ? `> 💡 **Tip:** Add \`OPENAI_API_KEY\` (Onyx) or \`ELEVENLABS_API_KEY\` to your \`.env\` file for deep, velvety Spotify DJ Xavier speech! Or use \`/voicedj action:mode mode:text\` for silent chat speech bubbles.\n\n`
                        : '') +
                    `**Command Shortcuts:**\n` +
                    `• \`/voicedj action:toggle\` — Switch on/off\n` +
                    `• \`/voicedj action:mode mode:text\` — Text-only speech bubbles\n` +
                    `• \`/voicedj action:voice voice:onyx\` — Select radio voice\n` +
                    `• \`/voicedj action:preview\` — Preview an announcement aloud`
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

        // ── Action: Mode ───────────────────────────────────────────────
        if (action === 'mode') {
            if (!selectedMode) {
                return interaction.reply({
                    embeds: [errorEmbed('Please select an announcement mode (`Voice + Chat Embed`, `Voice Channel Only`, or `Chat Embed Only`).')],
                    ephemeral: true,
                }).catch(() => {});
            }

            voiceDjService.updateSettings(guildId, { mode: selectedMode });
            const modeDesc = selectedMode === 'text'
                ? '💬 **Chat Embed Only** (Speech bubble in Now Playing, no voice in VC)'
                : (selectedMode === 'voice' ? '🔊 **Voice Channel Only** (Voice in VC only)' : '🎙️ **Voice + Chat Embed** (Full Spotify DJ experience)');
            const embed = successEmbed(`🎛️ Voice DJ mode updated to: ${modeDesc}!`);
            return interaction.reply({ embeds: [embed] }).catch(() => {});
        }

        // ── Action: Voice Style ────────────────────────────────────────
        if (action === 'voice') {
            if (!selectedVoice) {
                return interaction.reply({
                    embeds: [errorEmbed('Please choose a voice personality (e.g. `DJ Xavier`, `DJ Brian`, `DJ Nova`, etc.).')],
                    ephemeral: true,
                }).catch(() => {});
            }

            voiceDjService.updateSettings(guildId, { voice: selectedVoice });
            const embed = successEmbed(`🗣️ Voice DJ personality updated to: **\`${selectedVoice}\`**!`);
            return interaction.reply({ embeds: [embed] }).catch(() => {});
        }

        // ── Action: Preview ────────────────────────────────────────────
        if (action === 'preview') {
            await interaction.deferReply().catch(() => {});

            const voiceChannel = getVoiceChannel(interaction);
            const manager = interaction.client.lavalink;
            let player = manager?.getPlayer ? manager.getPlayer(guildId) : null;

            const sampleTrack = player?.queue?.current || {
                info: {
                    title: 'Blinding Lights',
                    author: 'The Weeknd',
                },
                requester: interaction.user,
            };

            const intro = await voiceDjService.getOrGenerateAnnouncement(guildId, sampleTrack);
            let spokeInVoice = false;

            // If user is in a voice channel, speak aloud into the voice channel!
            if (voiceChannel && manager) {
                try {
                    const connectedNodes = Array.from(manager.nodeManager.nodes.values()).filter(n => n.connected);
                    if (connectedNodes.length > 0) {
                        const targetNode = getBestNode(manager) || connectedNodes[0];
                        if (!player) {
                            player = manager.createPlayer({
                                guildId,
                                voiceChannelId: voiceChannel.id,
                                textChannelId: interaction.channelId,
                                selfDeaf: true,
                                volume: parseInt(process.env.DEFAULT_VOLUME) || 50,
                                node: targetNode.id,
                            });
                        }
                        if (!player.connected) {
                            await player.connect();
                        }
                        await ensurePlayerNode(player, interaction.client);

                        let playableUrl = intro?.audioUrl;
                        let djMessage = null;

                        // If high-fidelity studio voice buffer is available, upload to Discord for Lavalink
                        if (intro?.audioBuffer && interaction.channel) {
                            try {
                                const { AttachmentBuilder } = require('discord.js');
                                const attachment = new AttachmentBuilder(intro.audioBuffer, { name: 'voicedj.mp3' });
                                djMessage = await interaction.channel.send({
                                    content: `🎙️ **Reso DJ Preview:** *"${intro.text}"*`,
                                    files: [attachment],
                                });
                                const cdnUrl = djMessage?.attachments?.first()?.url;
                                if (cdnUrl) playableUrl = cdnUrl;
                            } catch (e) {
                                console.warn('[Reso DJ Preview] Upload note:', e.message);
                            }
                        }

                        if (playableUrl && player.node && player.node.connected) {
                            const searchPromise = player.search({ query: playableUrl }, interaction.user);
                            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TTS timeout')), 2500));
                            const ttsRes = await Promise.race([searchPromise, timeoutPromise]);

                            if (ttsRes?.tracks?.length > 0) {
                                const djTrack = ttsRes.tracks[0];
                                djTrack._isVoiceDj = true;
                                djTrack._djMessage = djMessage;
                                djTrack.info.title = `🎙️ DJ: "${truncate(intro.text, 35)}"`;
                                djTrack.info.author = 'Reso Voice DJ';

                                // If music was already playing, queue current song back so it resumes after intro
                                if (player.playing && player.queue.current) {
                                    player.queue.tracks.unshift(player.queue.current);
                                }
                                player.queue.current = djTrack;
                                await player.play();
                                spokeInVoice = true;
                            }
                        }
                    }
                } catch (playErr) {
                    console.warn('[Reso DJ] Live preview playback note:', playErr.message);
                }
            }

            const voiceStatus = spokeInVoice
                ? `🔊 **Broadcasting live into <#${voiceChannel.id}>!**`
                : (voiceChannel
                    ? `*(Audio played as text — music node reconnecting)*`
                    : `*(Join a voice channel to hear the DJ speak aloud!)*`);

            const embed = createEmbed('Music')
                .setAuthor({ name: '🎙️ Reso DJ — Live Preview' })
                .setDescription(
                    `### 📻 Incoming Broadcast:\n` +
                    `> 🎙️ **DJ Reso:** *"${intro?.text || 'Up next, enjoy the beat!'}"*\n\n` +
                    `${voiceStatus}\n\n` +
                    `**Voice Engine:** \`${activeEngine.name}\` ${activeEngine.isHuman ? '🌟' : '🤖'}\n` +
                    `**Target Track:** **${truncate(sampleTrack.info?.title || 'Track', 40)}** by ${sampleTrack.info?.author || 'Artist'}\n` +
                    `**Requester:** <@${interaction.user.id}>\n` +
                    `**State:** Fast AI / Zero-Delay Fallback (${intro?.preparedAt ? 'Cached' : 'Generated'})`
                );

            return interaction.editReply({ embeds: [embed] }).catch(() => {});
        }

        return interaction.reply({
            embeds: [errorEmbed('Invalid action specified. Use `/voicedj` to toggle or configure.')],
            ephemeral: true,
        }).catch(() => {});
    },
};
