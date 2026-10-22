// Imports events listed in <folder>/events.json (default data/real). Skips events already imported.
// Usage: node seed.js [folder]
const fs = require('fs'), path = require('path');
const { db } = require('./db');
const { importEvent } = require('./service');
const dir = process.argv[2] || 'data/real';
const list = JSON.parse(fs.readFileSync(path.join(dir, 'events.json'), 'utf8'));
(async () => {
  for (const e of list) {
    if (!e.date) { console.log('skip (no date):', e.name); continue; }
    if (db.prepare('select 1 x from events where name=?').get(e.name)) { console.log('skip (already imported):', e.name); continue; }
    try { await importEvent(e.name, e.date, fs.readFileSync(path.join(dir, e.file), 'utf8')); console.log('imported', e.name); }
    catch (err) { console.log('FAILED', e.name, '-', err.message); }
  }
  process.exit(0);
})();
