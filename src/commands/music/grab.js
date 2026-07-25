const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed, createEmbed, EMOJIS, capitalize } = require('../../utils/embeds');
const { truncate, formatMs } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('grab')
        .setDescription('Save the currently playing song details to your DMs'),

    async execute(interaction) {
        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player || !player.playing) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        const track = player.queue.current;
        const info = track?.info || {};

        const embed = createEmbed('Music')
            .setAuthor({ name: `${EMOJIS.grab} Saved Song` })
            .setTitle(info.title || 'Unknown')
            .setURL(info.uri || null)
            .setThumbnail(info.artworkUrl || null)
            .addFields(
                { name: `${EMOJIS.clock} Duration`, value: info.isStream ? 'Live' : formatMs(info.duration), inline: true },
                { name: `${EMOJIS.disc} Source`, value: capitalize(info.sourceName || 'Unknown'), inline: true },
                { name: `${EMOJIS.link} URL`, value: `[Click here](${info.uri})`, inline: true },
            )
            .setFooter({ text: `Reso • Saved from ${interaction.guild.name}` });

        try {
            await interaction.user.send({ embeds: [embed] });
            return interaction.reply({ embeds: [successEmbed(`${EMOJIS.grab} Song details sent to your DMs!`)], ephemeral: true });
        } catch (error) {
            return interaction.reply({ embeds: [errorEmbed('Could not send a DM. Please make sure your DMs are open.')], ephemeral: true });
        }
    },
};
