const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed, createEmbed, EMOJIS, capitalize } = require('../../utils/embeds');
const { getVoiceChannel, truncate, formatMs } = require('../../utils/helpers');

// Map user-friendly source names to Lavalink search platforms
const SOURCE_MAP = {
    auto: 'ytsearch',        // Default to YouTube search
    youtube: 'ytsearch',
    spotify: 'spsearch',
    soundcloud: 'scsearch',
    apple: 'amsearch',
};

const SOURCE_EMOJIS = {
    auto: '🔍',
    youtube: '🔴',
    spotify: '🟢',
    soundcloud: '🟠',
    apple: '🍎',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist by name, URL, or link')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song name, URL, or playlist link (just type a song name!)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('source')
                .setDescription('Where to search (default: auto-detect)')
                .setRequired(false)
                .addChoices(
                    { name: '🔍 Auto Detect (default)', value: 'auto' },
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
            // Create or get the player
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

            // Connect to voice if not connected
            if (!player.connected) {
                await player.connect();
            }

            // Search for the track
            const isUrl = /^https?:\/\//.test(query);
            const result = await player.search({
                query: query,
                source: isUrl ? undefined : searchPlatform,
            }, interaction.user);

            if (!result.tracks || result.tracks.length === 0) {
                const sourceLabel = source === 'auto' ? 'any platform' : capitalize(source);
                return interaction.editReply({
                    embeds: [errorEmbed(`No results found for **${truncate(query, 50)}** on ${sourceLabel}.\n\nTry a different search term or source.`)]
                });
            }

            // Handle 24/7 mode
            if (interaction.client.twentyFourSeven?.has(interaction.guild.id)) {
                // 24/7 mode: keep player alive
            }

            // If it's a playlist
            if (result.loadType === 'playlist') {
                // Add all tracks to queue
                for (const track of result.tracks) {
                    track.requester = interaction.user;
                    player.queue.add(track);
                }

                // Start playing if not already
                if (!player.playing) {
                    await player.play();
                }

                const embed = createEmbed('Success')
                    .setAuthor({ name: '📀 Playlist Queued' })
                    .setTitle(result.playlist?.name || 'Playlist')
                    .setURL(query)
                    .setDescription(`${EMOJIS.success} Added **${result.tracks.length}** tracks to the queue.`)
                    .setThumbnail(result.tracks[0]?.info?.artworkUrl || null)
                    .addFields(
                        { name: `${EMOJIS.disc} Source`, value: capitalize(result.tracks[0]?.info?.sourceName || 'Unknown'), inline: true },
                        { name: `${EMOJIS.dj} Requested by`, value: `${interaction.user}`, inline: true },
                    );
                return interaction.editReply({ embeds: [embed] });
            }

            // Single track
            const track = result.tracks[0];
            track.requester = interaction.user;
            player.queue.add(track);

            if (!player.playing) {
                await player.play();
            }

            const info = track.info;
            const sourceEmoji = SOURCE_EMOJIS[source] || '🔍';
            const matchedSource = info.sourceName ? capitalize(info.sourceName) : 'Unknown';

            const embed = createEmbed('Success')
                .setDescription(
                    `${sourceEmoji} Found on **${matchedSource}**\n\n` +
                    `**[${truncate(info.title, 55)}](${info.uri})**\n` +
                    `${EMOJIS.clock} \`${info.isStream ? 'Live' : formatMs(info.duration)}\` • Requested by ${interaction.user}`
                )
                .setThumbnail(info.artworkUrl || null);

            return interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('[Reso] Play error:', error);
            return interaction.editReply({ embeds: [errorEmbed(`Could not play: ${truncate(error.message, 100)}`)] });
        }
    },
};
