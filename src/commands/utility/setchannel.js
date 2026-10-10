const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { createEmbed, EMOJIS } = require('../../utils/embeds');
const { setDesignatedChannel, removeDesignatedChannel } = require('../../utils/settings');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('Set this channel as the designated bot channel (or remove the restriction)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Action to perform (default: set to this channel)')
                .addChoices(
                    { name: 'Set to this channel', value: 'set' },
                    { name: 'Remove restriction', value: 'remove' }
                )
        ),
    category: 'utility',
    async execute(interaction, client) {
        const action = interaction.options.getString('action') || 'set';
        const channel = interaction.channel;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setchannel_yes').setLabel('Yes').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('setchannel_no').setLabel('No').setStyle(ButtonStyle.Danger)
        );

        let embed;
        if (action === 'remove') {
            embed = createEmbed('Warning')
                .setTitle('Remove Designated Channel')
                .setDescription('Are you sure you want to remove the channel restriction? The bot will respond in all channels again.');
        } else {
            embed = createEmbed('Warning')
                .setTitle('Set Designated Channel')
                .setDescription(`Are you sure you want to restrict the bot to only respond in <#${channel.id}>?`);
        }
        
        const response = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

        try {
            const filter = i => i.user.id === interaction.user.id && i.customId.startsWith('setchannel_');
            
            // Wait for a button click
            const confirmation = await response.awaitMessageComponent({ filter, time: 60000 });
            
            if (confirmation.customId === 'setchannel_yes') {
                if (action === 'set') {
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
