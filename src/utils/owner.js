/**
 * Helper to identify if a Discord user is the bot owner
 * Supports:
 *  1. process.env.OWNER_ID (single ID)
 *  2. process.env.OWNER_IDS (comma-separated IDs)
 *  3. Auto-detected Discord Application Owner (User or Team)
 */
async function isOwner(userId, client) {
    if (!userId) return false;

    // 1. Explicit single ID in environment
    if (process.env.OWNER_ID && process.env.OWNER_ID.trim() === userId) {
        return true;
    }

    // 2. Comma-separated list in environment
    if (process.env.OWNER_IDS) {
        const ids = process.env.OWNER_IDS.split(',').map(s => s.trim());
        if (ids.includes(userId)) return true;
    }

    // 3. Fallback to Discord Application Owner
    try {
        if (!client?.application?.owner) {
            await client?.application?.fetch?.();
        }
        const owner = client?.application?.owner;
        if (!owner) return false;

        // Single user owner
        if (owner.id === userId) return true;

        // Team owner
        if (owner.members) {
            return owner.members.some(m => (m.id || m.user?.id) === userId);
        }
    } catch {
        // Ignored
    }

    return false;
}

module.exports = { isOwner };

