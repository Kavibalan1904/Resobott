const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { createEmbed, EMOJIS } = require('../../utils/embeds');
const { setDesignatedChannel, removeDesignatedChannel } = require('../../utils/settings');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('Set a designated channel for the bot (ignores commands in other channels)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to restrict commands to (leave blank to remove restriction)')
                .addChannelTypes(ChannelType.GuildText)
        ),
    category: 'utility',
    async execute(interaction, client) {
        const channel = interaction.options.getChannel('channel');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setchannel_yes').setLabel('Yes').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('setchannel_no').setLabel('No').setStyle(ButtonStyle.Danger)
        );

        let embed;
        if (!channel) {
            embed = createEmbed('Warning')
                .setTitle('Remove Designated Channel')
                .setDescription('Are you sure you want to remove the channel restriction? The bot will respond in all channels again.');
        } else {
            embed = createEmbed('Warning')
                .setTitle('Set Designated Channel')
                .setDescription(`Are you sure you want to restrict the bot to only respond in <#${channel.id}>?`);
        }
        
        // Wait, if it's a prefix command via our mock interaction, `interaction.reply` doesn't return a message object that supports collectors natively without `fetchReply: true`.
        // We'll use `fetchReply: true` to get the message object.
        const response = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

        // Sometimes mock interactions from prefix commands return undefined for reply if it's a raw message.reply.
        // If response is undefined, we can try fetching the message from the channel's last message, or just not use collectors for prefix commands.
        // To be safe, we'll try to use the channel's awaitMessageComponent.
        
        try {
            const filter = i => i.user.id === interaction.user.id && i.customId.startsWith('setchannel_');
            
            // Wait for a button click
            const confirmation = await response.awaitMessageComponent({ filter, time: 60000 });
            
            if (confirmation.customId === 'setchannel_yes') {
                if (channel) {
                    setDesignatedChannel(interaction.guildId, channel.id);
                    await confirmation.update({ content: `✅ Successfully set designated channel to <#${channel.id}>.`, embeds: [], components: [] });
                } else {
                    removeDesignatedChannel(interaction.guildId);
                    await confirmation.update({ content: `✅ Successfully removed channel restriction.`, embeds: [], components: [] });
                }
            } else {
                await confirmation.update({ content: `❌ Operation cancelled.`, embeds: [], components: [] });
            }
        } catch (err) {
            // Timed out or error
            interaction.editReply({ content: '⏳ Command timed out or error occurred.', embeds: [], components: [] }).catch(() => {});
        }
    }
};
