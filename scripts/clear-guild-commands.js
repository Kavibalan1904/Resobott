/**
 * Reso — Slash Command Duplicate Cleaner
 * Clears guild-scoped slash commands so only global commands exist,
 * resolving the issue where commands show up twice in Discord.
 */

require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

async function cleanGuildCommands() {
    const token = process.env.DISCORD_TOKEN;

    if (!token) {
        console.error('❌ DISCORD_TOKEN is missing in .env');
        process.exit(1);
    }

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    client.once('ready', async () => {
        try {
            console.log(`[Reso Cleaner] 🤖 Logged in as ${client.user.tag} (${client.user.id})`);
            const oauthGuilds = await client.guilds.fetch();
            console.log(`[Reso Cleaner] 🔍 Found ${oauthGuilds.size} server(s). Purging guild-level duplicate commands...`);

            const rest = new REST({ version: '10' }).setToken(token);
            const clientId = process.env.CLIENT_ID || client.user.id;

            for (const [guildId, oauthGuild] of oauthGuilds) {
                try {
                    await rest.put(
                        Routes.applicationGuildCommands(clientId, guildId),
                        { body: [] },
                    );
                    console.log(`[Reso Cleaner] ✓ Purged duplicate guild commands in: "${oauthGuild.name}" (${guildId})`);
                } catch (err) {
                    console.warn(`[Reso Cleaner] ⚠ Could not clear in "${oauthGuild.name}": ${err.message}`);
                }
            }

            console.log('\n[Reso Cleaner] ✅ Done! Duplicate guild commands removed.');
            console.log('[Reso Cleaner] 💡 Tip: Press Ctrl+R in Discord (or restart Discord) to refresh the slash command cache.');
        } catch (err) {
            console.error('[Reso Cleaner] ❌ Error:', err.message || err);
        } finally {
            client.destroy();
            process.exit(0);
        }
    });

    client.login(token).catch(err => {
        console.error('❌ Failed to login to Discord:', err.message);
        process.exit(1);
    });
}

cleanGuildCommands();
