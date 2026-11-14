const { SlashCommandBuilder } = require('discord.js');
const { createQuickGuideEmbed, checkAndPromptFirstTimeGuide } = require('../../utils/onboarding');
const { resetAnsweredGuide } = require('../../utils/settings');

module.exports = {
    aliases: ['quickguide', 'onboarding'],
    data: new SlashCommandBuilder()
        .setName('guide')
        .setDescription('Show the Reso quick start guide or reset the onboarding prompt')
        .addBooleanOption(option =>
            option.setName('reset')
                .setDescription('Reset your onboarding status to trigger the interactive prompt again')
                .setRequired(false)
        ),

    async execute(interaction) {
        const resetOption = interaction.options?.getBoolean?.('reset') ||
            (typeof interaction.options?.getString === 'function' && interaction.options.getString('reset')?.toLowerCase() === 'reset');

        const userId = interaction.user?.id;
        const guildId = interaction.guildId || interaction.guild?.id;

        if (resetOption) {
            if (userId) resetAnsweredGuide(userId);
            if (guildId) resetAnsweredGuide(guildId);

            await interaction.reply({
                content: '🔄 Onboarding status reset! Triggering prompt below...',
                ephemeral: true,
            }).catch(() => {});

            if (interaction.channel) {
                await checkAndPromptFirstTimeGuide(interaction.channel, interaction.user, guildId);
            }
            return;
        }

        const embed = createQuickGuideEmbed(guildId, interaction.user);
        return interaction.reply({ embeds: [embed] });
    },
};
