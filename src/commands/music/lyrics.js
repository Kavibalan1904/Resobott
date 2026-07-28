const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, createEmbed, EMOJIS } = require('../../utils/embeds');
const { truncate } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lyrics')
        .setDescription('Search for song lyrics')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song name to search (defaults to current track)')
                .setRequired(false)
        ),

    async execute(interaction) {
        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        const query = interaction.options.getString('query')
            || player?.queue?.current?.info?.title;

        if (!query) {
            return interaction.reply({ embeds: [errorEmbed('No song specified and nothing is playing. Please provide a song name.')], ephemeral: true });
        }

        await interaction.deferReply();

        try {
            // Use lrclib.net API instead of Genius (which heavily blocks scraping)
            const response = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();

            if (!data || data.length === 0 || !data[0].plainLyrics) {
                return interaction.editReply({ embeds: [errorEmbed(`No lyrics found for **${truncate(query, 50)}**`)] });
            }

            const song = {
                title: data[0].trackName,
                fullTitle: `${data[0].artistName} - ${data[0].trackName}`,
                url: `https://lrclib.net`,
                thumbnail: null
            };
            const lyrics = data[0].plainLyrics;

            // Split lyrics if too long (Discord embed limit is 4096 chars)
            const chunks = splitText(lyrics, 4000);

            const embed = createEmbed('Music')
                .setAuthor({ name: `${EMOJIS.lyrics} Lyrics` })
                .setTitle(`${song.fullTitle}`)
                .setURL(song.url)
                .setDescription(chunks[0])
                .setThumbnail(song.thumbnail || null);

            await interaction.editReply({ embeds: [embed] });

            // Send additional chunks as follow-ups
            for (let i = 1; i < chunks.length; i++) {
                const continuedEmbed = createEmbed('Music')
                    .setDescription(chunks[i])
                    .setFooter({ text: `Reso • Page ${i + 1}/${chunks.length}` });

                await interaction.followUp({ embeds: [continuedEmbed] });
            }

        } catch (error) {
            console.error('[Reso] Lyrics error:', error);
            return interaction.editReply({ embeds: [errorEmbed(`Failed to fetch lyrics for **${truncate(query, 50)}**`)] });
        }
    },
};

function splitText(text, maxLength) {
    const chunks = [];
    let current = '';

    for (const line of text.split('\n')) {
        if ((current + '\n' + line).length > maxLength) {
            chunks.push(current.trim());
            current = line;
        } else {
            current += '\n' + line;
        }
    }

    if (current.trim()) chunks.push(current.trim());
    return chunks;
}
