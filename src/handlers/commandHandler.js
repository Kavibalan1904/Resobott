const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

/**
 * Recursively load all command files from the commands directory
 */
async function loadCommands(client) {
    const commandsPath = path.join(__dirname, '..', 'commands');
    const categories = fs.readdirSync(commandsPath).filter(f =>
        fs.statSync(path.join(commandsPath, f)).isDirectory()
    );

    for (const category of categories) {
        const categoryPath = path.join(commandsPath, category);
        const commandFiles = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));

        for (const file of commandFiles) {
            const command = require(path.join(categoryPath, file));
            if (command.data && command.execute) {
                command.category = category;
                client.commands.set(command.data.name, command);
            } else {
                console.warn(`[Reso] ⚠ Skipping ${file} — missing 'data' or 'execute'`);
            }
        }
    }
}

/**
 * Register all slash commands globally via Discord REST API
 */
async function registerSlashCommands(client) {
    const commands = client.commands.map(cmd => cmd.data.toJSON());
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    const clientId = (process.env.CLIENT_ID && /^\d+$/.test(process.env.CLIENT_ID)) ? process.env.CLIENT_ID : client.user.id;
    try {
        await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands },
        );
    } catch (error) {
        console.error('[Reso] Failed to register slash commands:', error);
    }
}

module.exports = { loadCommands, registerSlashCommands };
