const {
    SlashCommandBuilder,
    ApplicationIntegrationType,
    InteractionContextType,
    OAuth2Scopes,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { createEmbed, EMOJIS } = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Get the invite link to add Reso to your server or personal account')
        .setIntegrationTypes([
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall,
        ])
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel,
        ]),

    async execute(interaction, client) {
        const guildInviteUrl = client.generateInvite({
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

        const userInstallUrl = `https://discord.com/oauth2/authorize?client_id=${client.user.id}&integration_type=1`;
        const universalUrl = `https://discord.com/oauth2/authorize?client_id=${client.user.id}`;

        const embed = createEmbed('Info')
            .setAuthor({ name: 'Add Reso to Discord', iconURL: client.user.displayAvatarURL() })
            .setDescription(
                `${EMOJIS.link} **Choose how you'd like to use Reso:**\n\n` +
                `🏰 **Add to Server**\n` +
                `Bring Reso to your server to play music in voice channels with friends.\n` +
                `👉 [**Invite to Server**](${guildInviteUrl})\n\n` +
                `👤 **Install to Your Apps (Account Install)**\n` +
                `Install Reso directly to your personal Discord account to use commands (` +
                `\`/lyrics\`, \`/ping\`, \`/stats\`, \`/help\`) in **DMs, Group Chats, and any server**!\n` +
                `👉 [**Install to My Profile**](${userInstallUrl})`
            )
            .setThumbnail(client.user.displayAvatarURL({ size: 256 }));

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Add to Server')
                .setStyle(ButtonStyle.Link)
                .setURL(guildInviteUrl)
                .setEmoji('🏰'),
            new ButtonBuilder()
                .setLabel('Install to Profile')
                .setStyle(ButtonStyle.Link)
                .setURL(userInstallUrl)
                .setEmoji('👤'),
        );

        return interaction.reply({ embeds: [embed], components: [row] });
    },
};
