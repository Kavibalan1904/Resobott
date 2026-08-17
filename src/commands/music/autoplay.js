const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed, createEmbed, EMOJIS } = require('../../utils/embeds');
const { getVoiceChannel } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoplay')
        .setDescription('Toggle autoplay — automatically queue similar songs when the queue ends'),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        const guildId = interaction.guild.id;
        const isEnabled = interaction.client.autoplayGuilds?.has(guildId);

        if (isEnabled) {
            // Disable autoplay
            interaction.client.autoplayGuilds.delete(guildId);

            const embed = createEmbed('Info')
                .setDescription(
                    `${EMOJIS.autoplay} **Autoplay** has been **disabled**.\n\n` +
                    `> The queue will stop when all songs are played.\n` +
                    `> Use \`/autoplay\` again to re-enable.`
                );
            return interaction.reply({ embeds: [embed] });
        } else {
            // Enable autoplay
            interaction.client.autoplayGuilds.add(guildId);

            const embed = createEmbed('Success')
                .setDescription(
                    `${EMOJIS.autoplay} **Autoplay** has been **enabled**! ${EMOJIS.sparkle}\n\n` +
                    `> When the queue ends, I'll automatically find and play similar songs\n` +
                    `> based on what you've been listening to.\n` +
                    `> Use \`/autoplay\` again to disable.`
                );
            return interaction.reply({ embeds: [embed] });
        }
    },
};
