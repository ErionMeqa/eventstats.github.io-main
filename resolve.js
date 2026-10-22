// Usage: npm run resolve
// Gives UUIDs to players that were imported without one (for example when Mojang rate limited the import).
const { resolveUnmatched } = require('./service');
resolveUnmatched().then(r => { console.log(`Linked ${r.linked} players, ${r.left} still without a UUID.`); process.exit(0); });
