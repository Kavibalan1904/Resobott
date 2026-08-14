const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, createEmbed, createRecommendationComponents, EMOJIS } = require('../../utils/embeds');
const { getVoiceChannel, truncate, formatMs } = require('../../utils/helpers');
const { getRecommendations } = require('../../utils/recommendations');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('recommend')
        .setDescription('Get YouTube-style song recommendations based on current track'),

    async execute(interaction, client) {
        let deferred = false;
        try {
            await interaction.deferReply();
            deferred = true;
        } catch (deferErr) {
            console.warn('[Reso] deferReply failed for /recommend:', deferErr.message);
        }

        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            const embed = errorEmbed('You need to be in a voice channel!');
            if (interaction.deferred || interaction.replied || deferred) {
                return interaction.editReply({ embeds: [embed] }).catch(() => {});
            } else {
                return interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
            }
        }

        const player = client.lavalink.getPlayer(interaction.guild.id);
        if (!player || !player.playing || !player.queue.current) {
            const embed = errorEmbed('Nothing is playing right now.');
            if (interaction.deferred || interaction.replied || deferred) {
                return interaction.editReply({ embeds: [embed] }).catch(() => {});
            } else {
                return interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
            }
        }

        const currentTrack = player.queue.current;
        try {
            const recs = await getRecommendations(player, currentTrack, 5);

            if (!recs || recs.length === 0) {
                return interaction.editReply({
                    embeds: [errorEmbed('Could not find any song recommendations right now.')],
                });
            }

            // Save recommendations for menu handling
            client.recommendations.set(interaction.guild.id, recs);

            const recList = recs.map((rec, i) => {
                const info = rec.info || {};
                const dur = info.isStream ? 'Live' : formatMs(info.duration);
                return `\`${i + 1}.\` **[${truncate(info.title, 45)}](${info.uri})**\n　　 ${EMOJIS.clock} \`${dur}\` • ${info.author || 'Unknown Artist'}`;
            }).join('\n\n');

            const embed = createEmbed('Music')
                .setAuthor({ name: '💡 YouTube Song Recommendations' })
                .setTitle(`Based on: ${truncate(currentTrack.info?.title || 'Current Song', 50)}`)
                .setDescription(`${recList}\n\n*Select a song from the dropdown below to add to queue!*`);

            const row = createRecommendationComponents(recs, interaction.guild.id);

            return interaction.editReply({
                embeds: [embed],
                components: row ? [row] : [],
            });
        } catch (error) {
            console.error('[Reso] /recommend command error:', error);
            const embed = errorEmbed('Failed to generate recommendations.');
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ embeds: [embed] }).catch(() => {});
            } else {
                return interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
            }
        }
    },
};
