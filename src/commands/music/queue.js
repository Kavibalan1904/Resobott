const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, createEmbed, EMOJIS, getSourceBadge } = require('../../utils/embeds');
const { truncate, paginate, formatMs } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show the current music queue')
        .addIntegerOption(option =>
            option.setName('page')
                .setDescription('Page number')
                .setMinValue(1)
                .setRequired(false)
        ),

    async execute(interaction) {
        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player || !player.playing) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        const currentTrack = player.queue.current;
        const currentInfo = currentTrack?.info || {};
        const tracks = player.queue.tracks;
        const page = interaction.options.getInteger('page') || 1;

        const loopModes = ['Off', '🔂 Track', '🔁 Queue'];
        const source = getSourceBadge(currentInfo.sourceName);

        // Calculate total queue duration
        let totalDurationMs = currentInfo.duration || 0;
        for (const t of tracks) {
            if (t.info?.duration && !t.info?.isStream) totalDurationMs += t.info.duration;
        }
        const totalDuration = formatMs(totalDurationMs);

        // Autoplay status
        const autoplayOn = interaction.client.autoplayGuilds?.has(interaction.guild.id);

        if (tracks.length === 0) {
            const embed = createEmbed('Queue')
                .setAuthor({ name: `📋 Queue — ${interaction.guild.name}`, iconURL: interaction.guild.iconURL() })
                .setDescription(
                    `### ▶ Now Playing\n` +
                    `${source.color} **[${truncate(currentInfo.title, 50)}](${currentInfo.uri})** — \`${currentInfo.isStream ? 'Live' : formatMs(currentInfo.duration)}\`\n` +
                    `> ${currentInfo.author || 'Unknown'} • Requested by ${currentTrack.requester || 'Unknown'}\n\n` +
                    `*No more tracks in queue. Use \`/play\` to add more!*`
                )
                .addFields(
                    { name: '🔁 Loop', value: loopModes[player.repeatMode] || 'Off', inline: true },
                    { name: '🔊 Volume', value: `\`${player.volume}%\``, inline: true },
                    { name: '🔄 Autoplay', value: autoplayOn ? '✅ On' : '❌ Off', inline: true },
                );
            return interaction.reply({ embeds: [embed] });
        }

        const { items, currentPage, totalPages, totalItems } = paginate(tracks, page);

        const trackList = items.map((track, index) => {
            const info = track.info || {};
            const position = (currentPage - 1) * 10 + index + 1;
            const dur = info.isStream ? 'Live' : formatMs(info.duration);
            const src = getSourceBadge(info.sourceName);
            return `\`${position}.\` ${src.color} **[${truncate(info.title, 42)}](${info.uri})** — \`${dur}\`\n　　 ${info.author || 'Unknown'} • ${track.requester || 'Unknown'}`;
        }).join('\n');

        const embed = createEmbed('Queue')
            .setAuthor({ name: `📋 Queue — ${interaction.guild.name}`, iconURL: interaction.guild.iconURL() })
            .setDescription(
                `### ▶ Now Playing\n` +
                `${source.color} **[${truncate(currentInfo.title, 50)}](${currentInfo.uri})** — \`${currentInfo.isStream ? 'Live' : formatMs(currentInfo.duration)}\`\n` +
                `> ${currentInfo.author || 'Unknown'} • Requested by ${currentTrack.requester || 'Unknown'}\n\n` +
                `### ${EMOJIS.queue} Up Next\n${trackList}`
            )
            .addFields(
                { name: '🎵 Total', value: `\`${totalItems + 1} songs\``, inline: true },
                { name: '⏱️ Duration', value: `\`${totalDuration}\``, inline: true },
                { name: '🔁 Loop', value: loopModes[player.repeatMode] || 'Off', inline: true },
                { name: '🔊 Volume', value: `\`${player.volume}%\``, inline: true },
                { name: '🔄 Autoplay', value: autoplayOn ? '✅ On' : '❌ Off', inline: true },
            )
            .setFooter({ text: `Reso  ♪  Page ${currentPage}/${totalPages} • ${totalItems} tracks in queue` });

        return interaction.reply({ embeds: [embed] });
    },
};
