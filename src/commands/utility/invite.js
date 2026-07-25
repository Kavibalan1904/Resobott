const { SlashCommandBuilder, OAuth2Scopes, PermissionFlagsBits } = require('discord.js');
const { createEmbed, EMOJIS } = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Get the invite link to add Reso to your server'),

    async execute(interaction, client) {
        const inviteUrl = client.generateInvite({
            scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
            permissions: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.UseVAD,
            ],
        });

        const embed = createEmbed('Info')
            .setAuthor({ name: 'Invite Reso', iconURL: client.user.displayAvatarURL() })
            .setDescription(
                `${EMOJIS.link} **Add Reso to your server!**\n\n` +
                `[**Click here to invite**](${inviteUrl})\n\n` +
                `Reso brings high-quality music streaming to your Discord server with ` +
                `support for YouTube, Spotify, SoundCloud, and more.`
            )
            .setThumbnail(client.user.displayAvatarURL({ size: 256 }));

        return interaction.reply({ embeds: [embed] });
    },
};
