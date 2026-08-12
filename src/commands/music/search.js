const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { errorEmbed, createEmbed, EMOJIS, capitalize } = require('../../utils/embeds');
const { getVoiceChannel, truncate, formatMs } = require('../../utils/helpers');

const SOURCE_MAP = {
    auto: 'ytsearch',
    youtube: 'ytsearch',
    spotify: 'spsearch',
    soundcloud: 'scsearch',
    apple: 'amsearch',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search for a song and pick from results')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song name to search for')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('source')
                .setDescription('Where to search (default: auto)')
                .setRequired(false)
                .addChoices(
                    { name: '🔍 Auto Detect', value: 'auto' },
                    { name: '🔴 YouTube', value: 'youtube' },
                    { name: '🟢 Spotify', value: 'spotify' },
                    { name: '🟠 SoundCloud', value: 'soundcloud' },
                    { name: '🍎 Apple Music', value: 'apple' },
                )
        ),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        const query = interaction.options.getString('query', true);
        const source = interaction.options.getString('source') || 'auto';
        const manager = interaction.client.lavalink;
        const searchPlatform = SOURCE_MAP[source] || 'ytsearch';

        await interaction.deferReply();

        try {
            // Create or get the player for searching
            let player = manager.getPlayer(interaction.guild.id);
            if (!player) {
                player = manager.createPlayer({
                    guildId: interaction.guild.id,
                    voiceChannelId: voiceChannel.id,
                    textChannelId: interaction.channel.id,
                    selfDeaf: true,
                    volume: parseInt(process.env.DEFAULT_VOLUME) || 50,
                });
            }

            let result = await player.search({
                query: query,
                source: searchPlatform,
            }, interaction.user);

            // ── Multi-platform search fallback ──
            // If the default source returned nothing (e.g. node lacks LavaSrc), try others
            if ((!result.tracks || result.tracks.length === 0) && source === 'auto') {
                const fallbackSources = ['ytsearch', 'ytmsearch', 'scsearch'];
                const toTry = fallbackSources.filter(s => s !== searchPlatform);
                for (const fbSource of toTry) {
                    try {
                        const fbResult = await player.search({
                            query: query,
                            source: fbSource,
                        }, interaction.user);
                        if (fbResult.tracks && fbResult.tracks.length > 0) {
                            result = fbResult;
                            break;
                        }
                    } catch { /* skip */ }
                }
            }

            if (!result.tracks || result.tracks.length === 0) {
                return interaction.editReply({
                    embeds: [errorEmbed(`No results found for **${truncate(query, 50)}**`)]
                });
            }

            // Show up to 10 results
            const tracks = result.tracks.slice(0, 10);

            const trackList = tracks.map((track, i) => {
                const info = track.info;
                const src = info.sourceName ? capitalize(info.sourceName) : '';
                const dur = info.isStream ? 'Live' : formatMs(info.duration);
                return `\`${i + 1}.\` **[${truncate(info.title, 45)}](${info.uri})**\n　　 ${EMOJIS.clock} \`${dur}\` • ${src}`;
            }).join('\n\n');

            const embed = createEmbed('Music')
                .setAuthor({ name: `${EMOJIS.search} Search Results` })
                .setDescription(
                    `Results for: **${truncate(query, 40)}**\n\n` +
                    `${trackList}\n\n` +
                    `*Select a song from the dropdown below.*`
                );

            // Build select menu
            const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

            const options = tracks.map((track, i) => ({
                label: truncate(track.info.title, 95),
                description: `${track.info.isStream ? 'Live' : formatMs(track.info.duration)} • ${capitalize(track.info.sourceName || 'Unknown')}`,
                value: String(i),
                emoji: numberEmojis[i],
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('search_select')
                .setPlaceholder('Pick a song to play...')
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const response = await interaction.editReply({
                embeds: [embed],
                components: [row],
            });

            // Wait for selection (30 seconds)
            try {
                const collected = await response.awaitMessageComponent({
                    filter: (i) => i.user.id === interaction.user.id && i.customId === 'search_select',
                    time: 30_000,
                });

                const selectedIndex = parseInt(collected.values[0]);
                const selectedTrack = tracks[selectedIndex];

                await collected.deferUpdate();

                // Connect if not connected
                if (!player.connected) {
                    await player.connect();
                }

                // Play the selected track
                selectedTrack.requester = interaction.user;
                player.queue.add(selectedTrack);

                if (!player.playing) {
                    await player.play();
                }

                // Handle 24/7 mode
                if (interaction.client.twentyFourSeven?.has(interaction.guild.id)) {
                    // 24/7 mode: keep player alive
                }

                const info = selectedTrack.info;
                const confirmEmbed = createEmbed('Success')
                    .setDescription(
                        `${EMOJIS.success} Selected: **[${truncate(info.title, 50)}](${info.uri})**\n` +
                        `${EMOJIS.clock} \`${info.isStream ? 'Live' : formatMs(info.duration)}\` • ${capitalize(info.sourceName || 'Unknown')}`
                    )
                    .setThumbnail(info.artworkUrl || null);

                await interaction.editReply({ embeds: [confirmEmbed], components: [] });

            } catch (timeoutError) {
                // Selection timed out
                const timeoutEmbed = createEmbed('Warning')
                    .setDescription(`${EMOJIS.warning} Search selection timed out. Use \`/play\` to play directly.`);
                await interaction.editReply({ embeds: [timeoutEmbed], components: [] }).catch(() => {});
            }

        } catch (error) {
            console.error('[Reso] Search error:', error);
            return interaction.editReply({ embeds: [errorEmbed(`Search failed: ${truncate(error.message, 100)}`)] });
        }
    },
};
