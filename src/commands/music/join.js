const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed, successEmbed } = require('../../utils/embeds');
const { getVoiceChannel } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Join your current voice channel'),

    async execute(interaction) {
        const voiceChannel = getVoiceChannel(interaction);
        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        const manager = interaction.client.lavalink;
        let player = manager.getPlayer(interaction.guild.id);

        if (player?.voiceChannelId === voiceChannel.id) {
            return interaction.reply({ embeds: [errorEmbed('I\'m already in your voice channel!')], ephemeral: true });
        }

        try {
            if (!player) {
                player = manager.createPlayer({
                    guildId: interaction.guild.id,
                    voiceChannelId: voiceChannel.id,
                    textChannelId: interaction.channel.id,
                    selfDeaf: true,
                    volume: parseInt(process.env.DEFAULT_VOLUME) || 50,
                });
            } else {
                // Move to the new voice channel
                player.voiceChannelId = voiceChannel.id;
            }

            if (!player.connected) {
                await player.connect();
            }

            return interaction.reply({ embeds: [successEmbed(`Joined **${voiceChannel.name}**! 🎧`)] });
        } catch (error) {
            console.error('[Reso] Join error:', error);
            return interaction.reply({ embeds: [errorEmbed('Could not join the voice channel.')] });
        }
    },
};
