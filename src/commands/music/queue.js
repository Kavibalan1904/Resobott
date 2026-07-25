const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, createEmbed, EMOJIS } = require('../../utils/embeds');
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

        if (tracks.length === 0) {
            const embed = createEmbed('Queue')
                .setAuthor({ name: `Queue for ${interaction.guild.name}`, iconURL: interaction.guild.iconURL() })
                .setDescription(
                    `**Now Playing:**\n` +
                    `[${truncate(currentInfo.title, 55)}](${currentInfo.uri}) — \`${currentInfo.isStream ? 'Live' : formatMs(currentInfo.duration)}\`\n\n` +
                    `*No more tracks in queue. Use \`/play\` to add more!*`
                )
                .addFields(
                    { name: 'Loop Mode', value: loopModes[player.repeatMode] || 'Off', inline: true },
                    { name: 'Volume', value: `${player.volume}%`, inline: true },
                );
            return interaction.reply({ embeds: [embed] });
        }

        const { items, currentPage, totalPages, totalItems } = paginate(tracks, page);

        const trackList = items.map((track, index) => {
            const info = track.info || {};
            const position = (currentPage - 1) * 10 + index + 1;
            const dur = info.isStream ? 'Live' : formatMs(info.duration);
            return `\`${position}.\` [${truncate(info.title, 45)}](${info.uri}) — \`${dur}\` | ${track.requester || 'Unknown'}`;
        }).join('\n');

        const embed = createEmbed('Queue')
            .setAuthor({ name: `Queue for ${interaction.guild.name}`, iconURL: interaction.guild.iconURL() })
            .setDescription(
                `**${EMOJIS.music} Now Playing:**\n` +
                `[${truncate(currentInfo.title, 55)}](${currentInfo.uri}) — \`${currentInfo.isStream ? 'Live' : formatMs(currentInfo.duration)}\` | ${currentTrack.requester || 'Unknown'}\n\n` +
                `**${EMOJIS.queue} Up Next:**\n${trackList}`
            )
            .addFields(
                { name: 'Total Tracks', value: `${totalItems + 1}`, inline: true },
                { name: 'Loop Mode', value: loopModes[player.repeatMode] || 'Off', inline: true },
                { name: 'Volume', value: `${player.volume}%`, inline: true },
            )
            .setFooter({ text: `Reso • Page ${currentPage}/${totalPages} • ${totalItems} tracks in queue` });

        return interaction.reply({ embeds: [embed] });
    },
};
