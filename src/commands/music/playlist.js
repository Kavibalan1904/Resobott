const { SlashCommandBuilder } = require('discord.js');
const { createEmbed, errorEmbed, successEmbed, EMOJIS } = require('../../utils/embeds');
const { getVoiceChannel, truncate, formatMs, getBestNode, ensurePlayerNode } = require('../../utils/helpers');
const { getDesignatedChannel } = require('../../utils/settings');
const { savePlaylist, getPlaylist, getUserPlaylists, deletePlaylist } = require('../../utils/playlistStore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playlist')
        .setDescription('Save, load, and manage custom playlists')
        .addSubcommand(subcommand =>
            subcommand
                .setName('save')
                .setDescription('Save the current queue as a custom playlist')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name for your playlist')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('load')
                .setDescription('Load and play a saved custom playlist')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name of the playlist to load')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('View all your saved custom playlists')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Delete a saved custom playlist')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name of the playlist to delete')
                        .setRequired(true)
                )
        ),

    aliases: ['pl', 'playlists'],
    category: 'music',

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand ? interaction.options.getSubcommand() : 'save';

        // ── /playlist save <name> ──────────────────────────────────────
        if (subcommand === 'save') {
            const name = interaction.options.getString('name');
            if (!name || name.trim().length === 0) {
                return interaction.reply({
                    embeds: [errorEmbed('Please provide a name for your playlist! Example: `/playlist save favorites`')],
                    ephemeral: true,
                }).catch(() => {});
            }

            const player = client.lavalink.getPlayer(interaction.guild.id);
            if (!player || (!player.queue.current && (!player.queue.tracks || player.queue.tracks.length === 0))) {
                return interaction.reply({
                    embeds: [errorEmbed('There are no songs currently playing or in the queue to save!')],
                    ephemeral: true,
                }).catch(() => {});
            }

            const tracksToSave = [];
            if (player.queue.current) {
                tracksToSave.push(player.queue.current);
            }
            if (player.queue.tracks && player.queue.tracks.length > 0) {
                tracksToSave.push(...player.queue.tracks);
            }

            const serialized = tracksToSave.map(t => ({
                title: t.info?.title || 'Unknown Track',
                author: t.info?.author || 'Unknown Artist',
                uri: t.info?.uri || '',
                duration: t.info?.duration || 0,
                identifier: t.info?.identifier || '',
                sourceName: t.info?.sourceName || 'youtube',
            }));

            try {
                const saved = savePlaylist(interaction.user.id, name, serialized);
                const embed = createEmbed('Success')
                    .setAuthor({ name: '📁 Custom Playlist Saved' })
                    .setTitle(`"${saved.name}"`)
                    .setDescription(
                        `${EMOJIS.success} Successfully saved **${serialized.length}** song${serialized.length !== 1 ? 's' : ''} to your playlist!\n\n` +
                        `Use \`${process.env.PREFIX || '>'}playlist load ${saved.name}\` or \`/playlist load ${saved.name}\` to play it anytime.`
                    );

                return interaction.reply({ embeds: [embed] }).catch(() => {});
            } catch (err) {
                return interaction.reply({
                    embeds: [errorEmbed(`Failed to save playlist: ${err.message}`)],
                    ephemeral: true,
                }).catch(() => {});
            }
        }

        // ── /playlist load <name> ──────────────────────────────────────
        if (subcommand === 'load') {
            const name = interaction.options.getString('name');
            if (!name || name.trim().length === 0) {
                return interaction.reply({
                    embeds: [errorEmbed('Please provide a playlist name to load! Example: `/playlist load favorites`')],
                    ephemeral: true,
                }).catch(() => {});
            }

            const voiceChannel = getVoiceChannel(interaction);
            if (!voiceChannel) {
                return interaction.reply({
                    embeds: [errorEmbed('You need to be in a voice channel to load and play a playlist!')],
                    ephemeral: true,
                }).catch(() => {});
            }

            const playlist = getPlaylist(interaction.user.id, name);
            if (!playlist) {
                return interaction.reply({
                    embeds: [errorEmbed(`Playlist **"${name}"** was not found.\nUse \`/playlist list\` to view all your saved playlists.`)],
                    ephemeral: true,
                }).catch(() => {});
            }

            if (!playlist.tracks || playlist.tracks.length === 0) {
                return interaction.reply({
                    embeds: [errorEmbed(`Playlist **"${playlist.name}"** is empty.`)],
                    ephemeral: true,
                }).catch(() => {});
            }

            if (interaction.deferReply) {
                await interaction.deferReply().catch(() => {});
            }

            const manager = client.lavalink;
            const targetNode = getBestNode(manager) || Array.from(manager.nodeManager.nodes.values()).find(n => n.connected);
            const targetTextChannelId = getDesignatedChannel(interaction.guild.id) || interaction.channel.id;

            let player = manager.getPlayer(interaction.guild.id);
            if (!player) {
                player = manager.createPlayer({
                    guildId: interaction.guild.id,
                    voiceChannelId: voiceChannel.id,
                    textChannelId: targetTextChannelId,
                    selfDeaf: true,
                    volume: parseInt(process.env.DEFAULT_VOLUME) || 50,
                    node: targetNode?.id,
                });
            } else if (getDesignatedChannel(interaction.guild.id)) {
                player.textChannelId = getDesignatedChannel(interaction.guild.id);
            }

            if (!player.connected) {
                await player.connect();
            }
            await ensurePlayerNode(player, client);

            // Chunked resolution to prevent rate limits while resolving fast
            const resolvedTracks = [];
            const chunkSize = 5;
            for (let i = 0; i < playlist.tracks.length; i += chunkSize) {
                const chunk = playlist.tracks.slice(i, i + chunkSize);
                const chunkResults = await Promise.all(chunk.map(async (item) => {
                    try {
                        const query = item.uri && item.uri.startsWith('http') ? item.uri : `${item.author} - ${item.title}`;
                        const res = await player.search({ query, source: 'youtube' }, interaction.user);
                        if (res?.tracks?.length > 0) {
                            const trk = res.tracks[0];
                            trk.requester = interaction.user;
                            return trk;
                        }
                    } catch {
                        return null;
                    }
                }));
                resolvedTracks.push(...chunkResults.filter(Boolean));
            }

            if (resolvedTracks.length === 0) {
                const errEmbed = errorEmbed(`Could not resolve any tracks from playlist **"${playlist.name}"**.`);
                if (interaction.editReply) {
                    return interaction.editReply({ embeds: [errEmbed] }).catch(() => {});
                } else {
                    return interaction.reply({ embeds: [errEmbed] }).catch(() => {});
                }
            }

            // Enqueue all resolved tracks
            player.queue.add(resolvedTracks);

            // If player isn't playing, start playback
            if (!player.playing) {
                await player.play().catch(() => {});
            }

            const embed = createEmbed('Success')
                .setAuthor({ name: '📂 Playlist Loaded' })
                .setTitle(`"${playlist.name}"`)
                .setDescription(
                    `${EMOJIS.success} Queued **${resolvedTracks.length}** song${resolvedTracks.length !== 1 ? 's' : ''} from your saved playlist!\n\n` +
                    `🎵 **Now Playing:** ${player.queue.current?.info?.title ? truncate(player.queue.current.info.title, 50) : truncate(resolvedTracks[0].info?.title, 50)}`
                );

            if (interaction.editReply) {
                return interaction.editReply({ embeds: [embed] }).catch(() => {});
            } else {
                return interaction.reply({ embeds: [embed] }).catch(() => {});
            }
        }

        // ── /playlist list ─────────────────────────────────────────────
        if (subcommand === 'list') {
            const playlists = getUserPlaylists(interaction.user.id);
            if (playlists.length === 0) {
                const embed = createEmbed('Info')
                    .setAuthor({ name: '📁 Your Saved Playlists' })
                    .setDescription(
                        `You have no saved playlists yet!\n\n` +
                        `*Play some songs and type \`/playlist save <name>\` to save your current queue!*`
                    );
                return interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
            }

            const listText = playlists.map((pl, idx) => {
                const date = new Date(pl.createdAt).toLocaleDateString();
                return `\`${idx + 1}.\` **${pl.name}** — **${pl.trackCount}** song${pl.trackCount !== 1 ? 's' : ''} *(Created: ${date})*`;
            }).join('\n');

            const embed = createEmbed('Info')
                .setAuthor({ name: `📁 ${interaction.user.username}'s Saved Playlists` })
                .setDescription(`${listText}\n\n*Use \`/playlist load <name>\` to play any of your playlists.*`);

            return interaction.reply({ embeds: [embed] }).catch(() => {});
        }

        // ── /playlist delete <name> ────────────────────────────────────
        if (subcommand === 'delete') {
            const name = interaction.options.getString('name');
            if (!name || name.trim().length === 0) {
                return interaction.reply({
                    embeds: [errorEmbed('Please provide the playlist name to delete!')],
                    ephemeral: true,
                }).catch(() => {});
            }

            const deleted = deletePlaylist(interaction.user.id, name);
            if (!deleted) {
                return interaction.reply({
                    embeds: [errorEmbed(`Playlist **"${name}"** was not found.`)],
                    ephemeral: true,
                }).catch(() => {});
            }

            return interaction.reply({
                embeds: [successEmbed(`Successfully deleted playlist **"${name}"**. 🗑️`)],
            }).catch(() => {});
        }
    },
};
