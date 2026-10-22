const { db, transaction, recalc, parseCsv } = require('./db');
const mojang = require('./mojang');

const byUuid = u => db.prepare('select id from players where uuid=?').get(u)?.id;
const byAlias = n => db.prepare('select player_id id from aliases where alias=?').get(n)?.id;

function create(name, uuid) {
  const exists = db.prepare('select 1 x from players where name=?').get(name);
  const label = exists && uuid ? `${name} (${uuid.slice(0, 6)})` : name;
  return Number(db.prepare('insert into players(name,uuid) values(?,?)').run(label, uuid).lastInsertRowid);
}

// Change a player's displayed name; the old name is kept as an alias. Skips if the name is taken.
function setName(id, newName) {
  const cur = db.prepare('select name from players where id=?').get(id);
  if (!cur || cur.name === newName) return false;
  if (db.prepare('select 1 x from players where name=? and id!=?').get(newName, id)) return false;
  db.prepare('insert or replace into aliases(alias,player_id) values(?,?)').run(cur.name, id);
  db.prepare('update players set name=? where id=?').run(newName, id);
  return true;
}

// Which player does this CSV row belong to?  uuid column > alias > name (+ Mojang lookup).
function resolve(r, lookups) {
  if (r.uuid) return byUuid(r.uuid) ?? create(r.player, r.uuid);
  const a = byAlias(r.player);
  if (a) return a;
  const n = db.prepare('select id, uuid from players where name=?').get(r.player);
  const u = lookups.get(r.player.toLowerCase());
  if (u) {
    const id = byUuid(u);
    if (id) return id;
    if (n && !n.uuid) { db.prepare('update players set uuid=? where id=?').run(u, n.id); return n.id; }
    if (!n) return create(r.player, u);
  }
  return n ? n.id : create(r.player, null);
}

async function importEvent(name, date, csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) throw new Error('CSV has no rows');
  const lookups = new Map(); // name -> uuid, fetched before the database transaction
  for (const r of rows) {
    const okInd = /^\d+$/.test(r.individual_placement || '');
    const okTeam = r.team && /^\d+$/.test(r.team_placement || '');
    if (!r.player || !(okInd || okTeam)) throw new Error(`Bad row: ${JSON.stringify(r)}`);
    if (r.uuid) {
      r.uuid = mojang.normUuid(r.uuid);
      if (!r.uuid) throw new Error(`Bad uuid for ${r.player}`);
      continue;
    }
    if (byAlias(r.player)) continue;
    const key = r.player.toLowerCase();
    const known = db.prepare('select uuid from players where name=?').get(r.player);
    if (!lookups.has(key) && !(known && known.uuid)) lookups.set(key, await mojang.lookupName(r.player));
  }
  const seen = new Set();
  const eid = transaction(() => {
    const id = Number(db.prepare('insert into events(name,date) values(?,?)').run(name, date).lastInsertRowid);
    for (const r of rows) {
      const pid = resolve(r, lookups);
      if (seen.has(pid)) throw new Error(`Duplicate player in event: ${r.player}`);
      seen.add(pid);
      db.prepare('insert into performances(event_id,player_id,team,team_placement,placement) values(?,?,?,?,?)')
        .run(id, pid, r.team || null, r.team_placement ? +r.team_placement : null,
          r.individual_placement ? +r.individual_placement : null);
    }
    return id;
  })();
  recalc();
  return eid;
}

// Players with no uuid yet: these need a manual link.
const unmatched = () =>
  db.prepare('select id, name, events from players where uuid is null order by events desc, name').all();

// Attach a uuid to a player. If another player already has it, merge the two.
async function linkPlayer(playerId, uuidRaw, refreshName = true) {
  const uuid = mojang.normUuid(uuidRaw);
  if (!uuid) throw new Error('Not a valid UUID');
  const src = db.prepare('select id, name from players where id=?').get(playerId);
  if (!src) throw new Error('Player not found');
  const target = byUuid(uuid);
  transaction(() => {
    if (target && target !== src.id) {
      if (db.prepare(`select 1 x from performances a join performances b on a.event_id=b.event_id
          where a.player_id=? and b.player_id=?`).get(src.id, target))
        throw new Error('Both players appear in the same event, so they cannot be the same person');
      db.prepare('update performances set player_id=? where player_id=?').run(target, src.id);
      db.prepare('update aliases set player_id=? where player_id=?').run(target, src.id);
      db.prepare('insert or replace into aliases(alias,player_id) values(?,?)').run(src.name, target);
      db.prepare('delete from players where id=?').run(src.id);
    } else {
      db.prepare('update players set uuid=? where id=?').run(uuid, src.id);
    }
  })();
  const id = target || src.id;
  recalc();
  if (refreshName) {
    const cur = await mojang.lookupUuid(uuid).catch(() => null);
    if (cur) setName(id, cur);
  }
  return id;
}

// Ask Mojang for everyone's current IGN. Old names stay as aliases.
async function refreshNames() {
  let checked = 0, changed = 0, failed = 0;
  for (const p of db.prepare('select id, uuid from players where uuid is not null').all()) {
    try { const n = await mojang.lookupUuid(p.uuid); checked++; if (n && setName(p.id, n)) changed++; }
    catch { failed++; }
  }
  return { checked, changed, failed };
}

function renamePlayer(oldName, newName) {
  const id = byAlias(oldName) ?? db.prepare('select id from players where name=?').get(oldName)?.id;
  if (!id) throw new Error('Player not found');
  if (!setName(id, newName)) throw new Error('Name unchanged or already used by another player');
}

// Look up UUIDs for players that have none yet (e.g. after a rate-limited import).
async function resolveUnmatched() {
  let linked = 0, left = 0;
  for (const p of unmatched()) {
    const uuid = await mojang.lookupName(p.name);
    if (!uuid) { left++; continue; }
    try { await linkPlayer(p.id, uuid, false); linked++; } catch (e) { console.log(`${p.name}: ${e.message}`); left++; }
  }
  return { linked, left };
}

module.exports = { resolveUnmatched, importEvent, unmatched, linkPlayer, refreshNames, renamePlayer };
