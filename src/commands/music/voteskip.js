const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { errorEmbed, createEmbed, EMOJIS } = require('../../utils/embeds');
const { getVoiceChannel, truncate } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voteskip')
        .setDescription('Start a democratic vote to skip the current song (requires >50% of VC members)'),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        const player = interaction.client.lavalink.getPlayer(interaction.guild.id);
        if (!player || !player.playing) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], ephemeral: true });
        }

        const guildId = interaction.guild.id;

        // Check if a vote is already in progress
        if (interaction.client.voteSkips?.has(guildId)) {
            return interaction.reply({
                embeds: [errorEmbed('A vote skip is already in progress! Click the button to vote.')],
                ephemeral: true,
            });
        }

        // Count human members in VC
        const humanCount = voiceChannel.members.filter(m => !m.user.bot).size;

        // If only 1 person, skip directly
        if (humanCount <= 1) {
            const currentTrack = player.queue.current;
            const title = truncate(currentTrack?.info?.title || 'Unknown', 50);
            await player.skip();
            const embed = createEmbed('Success')
                .setDescription(`${EMOJIS.voteskip} Skipped **${title}** (only you in the channel)`);
            return interaction.reply({ embeds: [embed] });
        }

        const needed = Math.ceil(humanCount / 2);
        const currentTrack = player.queue.current;
        const title = truncate(currentTrack?.info?.title || 'Unknown', 50);

        // Initialize vote
        const voteData = {
            voters: new Set([interaction.user.id]), // Initiator auto-votes
            timeout: null,
        };

        interaction.client.voteSkips.set(guildId, voteData);

        // Check if initiator's vote alone is enough
        if (voteData.voters.size >= needed) {
            await player.skip();
            interaction.client.voteSkips.delete(guildId);
            const embed = createEmbed('Success')
                .setDescription(`${EMOJIS.voteskip} Vote skip passed! (**1/${needed}** votes) ⏭️\n> Skipped **${title}**`);
            return interaction.reply({ embeds: [embed] });
        }

        // Create vote button
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`voteskip_${guildId}`)
                .setLabel(`🗳️ Vote Skip (1/${needed})`)
                .setStyle(ButtonStyle.Primary)
        );

        const embed = createEmbed('Info')
            .setDescription(
                `${EMOJIS.voteskip} **Vote Skip** — **${title}**\n\n` +
                `> ${interaction.user} wants to skip! Click the button to vote.\n` +
                `> Need **${needed}** votes (>50% of ${humanCount} members in VC)\n` +
                `> Vote expires in **30 seconds**`
            );

        await interaction.reply({ embeds: [embed], components: [row] });

        // Set 30-second timeout
        voteData.timeout = setTimeout(async () => {
            const data = interaction.client.voteSkips.get(guildId);
            if (!data) return; // Already resolved

            interaction.client.voteSkips.delete(guildId);

            try {
                const expiredEmbed = createEmbed('Warning')
                    .setDescription(
                        `${EMOJIS.voteskip} Vote skip expired! (**${data.voters.size}/${needed}** votes)\n` +
                        `> Not enough votes to skip **${title}**`
                    );
                await interaction.editReply({ embeds: [expiredEmbed], components: [] }).catch(() => {});
            } catch { /* message may be gone */ }
        }, 30_000);
    },
};
