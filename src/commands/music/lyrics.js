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
            const Genius = require('genius-lyrics');
            const Client = new Genius.Client();

            const searches = await Client.songs.search(query);

            if (!searches || searches.length === 0) {
                return interaction.editReply({ embeds: [errorEmbed(`No lyrics found for **${truncate(query, 50)}**`)] });
            }

            const song = searches[0];
            const lyrics = await song.lyrics();

            if (!lyrics) {
                return interaction.editReply({ embeds: [errorEmbed(`Could not fetch lyrics for **${song.title}**`)] });
            }

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
