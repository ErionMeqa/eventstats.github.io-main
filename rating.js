#!/usr/bin/env node
// Converts a downloaded "overview" tab of an event stats sheet (CSV) into one CSV per event,
// plus an events.json manifest that `node seed.js <folder>` can import.
//
// Expected layout (as in the Pandora's Box stats sheet): events side by side in blocks of 3 columns
// [rank/label | name | points], a header cell per block like "Pandora's Box S1 - Mar 6, 2022",
// then each team (team name + points row, then its players, the first one labelled 1st/2nd/...),
// then "INDIVIDUAL BOARD" with rank | name | points.
//
// Usage: node tools/sheet-to-csv.js overview.csv [outFolder=sheet-out]
const fs = require('fs'), path = require('path');

function parseCsv(text) { // RFC 4180 (quotes, embedded commas/newlines)
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const [file, outDir = 'sheet-out'] = process.argv.slice(2);
if (!file) { console.log('Usage: node tools/sheet-to-csv.js overview.csv [outFolder]'); process.exit(1); }
const rows = parseCsv(fs.readFileSync(file, 'utf8')).map(r => r.map(c => c.replace(/\\_/g, '_').trim()));
const cell = (r, c) => (rows[r] && rows[r][c]) || '';
const num = s => { const n = Number(String(s).replace(/,/g, '')); return Number.isFinite(n) && s !== '' ? n : null; };
const yearRe = /\b(19|20)\d\d\b/, labelRe = /^\d+(st|nd|rd|th)$/i;

// 1. header row = the row with the most "name - date" cells
let hr = -1, best = 0;
for (let r = 0; r < Math.min(20, rows.length); r++) {
  const n = rows[r].filter(v => v.includes(' - ') && yearRe.test(v)).length;
  if (n > best) { best = n; hr = r; }
}
if (hr < 0) { console.error('Could not find the row with event headers like "Event S1 - Mar 6, 2022".'); process.exit(1); }
const starts = []; rows[hr].forEach((v, c) => { if (v.includes(' - ') && yearRe.test(v)) starts.push(c); });

fs.mkdirSync(outDir, { recursive: true });
const manifest = [];
const used = new Set();

for (const c of starts) {
  const warnings = [];
  const header = rows[hr][c], cut = header.lastIndexOf(' - ');
  const name = header.slice(0, cut).trim(), d = new Date(header.slice(cut + 3).trim() + ' UTC');
  const date = isNaN(d) ? '' : d.toISOString().slice(0, 10);
  if (!date) warnings.push('date could not be read: fill it in events.json');

  // team blocks
  const labeled = []; let boardAt = -1, end = rows.length;
  for (let r = hr + 1; r < rows.length; r++) {
    const v = cell(r, c);
    if (/^INDIVIDUAL BOARD/i.test(v)) { boardAt = r; break; }
    if (/^GAMES PLAYED/i.test(v)) { end = r; break; }
    if (labelRe.test(v)) labeled.push(r);
  }
  const stop = boardAt >= 0 ? boardAt : end;
  const players = []; // {name, pts, team, tp}
  labeled.forEach((L, i) => {
    const team = cell(L - 1, c + 1), tp = parseInt(cell(L, c), 10);
    const last = i + 1 < labeled.length ? labeled[i + 1] - 2 : stop - 1;
    for (let r = L; r <= last; r++) {
      const n = cell(r, c + 1); if (!n) continue;
      players.push({ name: n, pts: num(cell(r, c + 2)), team, tp });
    }
  });

  // individual board
  const board = [];
  if (boardAt >= 0) for (let r = boardAt + 1; r < rows.length && /^\d+$/.test(cell(r, c)); r++)
    board.push({ rank: +cell(r, c), name: cell(r, c + 1), pts: num(cell(r, c + 2)) });

  // combine: match by name first, then by points (the sheet sometimes shows renamed players differently)
  let out;
  if (!players.length && !board.length) { console.log(`skip ${name}: no data`); continue; }
  if (!players.length) {
    out = board.map(b => ({ player: b.name, team: '', tp: '', ip: b.rank }));
    warnings.push('no team data found: individual placements only');
  } else {
    const free = board.slice();
    players.forEach(p => {
      const i = free.findIndex(b => b.name.toLowerCase() === p.name.toLowerCase());
      if (i >= 0) { p.ip = free[i].rank; free.splice(i, 1); }
    });
    players.filter(p => p.ip == null).forEach(p => {
      const i = free.findIndex(b => b.pts != null && b.pts === p.pts);
      if (i >= 0) { warnings.push(`${p.name} is "${free[i].name}" on the individual board (matched by points)`); p.ip = free[i].rank; free.splice(i, 1); }
    });
    free.forEach(b => warnings.push(`board entry "${b.name}" (#${b.rank}) matches no team player`));
    const missing = players.filter(p => p.ip == null);
    if (board.length && missing.length) warnings.push(`no individual placement for: ${missing.map(p => p.name).join(', ')} (event will be rated on team standings only)`);
    if (!board.length) warnings.push('no individual board found: team standings only');
    out = players.map(p => ({ player: p.name, team: p.team, tp: p.tp, ip: board.length && !missing.length ? p.ip : '' }));
  }
  out.filter(o => o.player.includes('/')).forEach(o => warnings.push(`"${o.player}" looks like a substitution: split it by hand`));

  let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
  while (used.has(slug)) slug += '-2';
  used.add(slug);
  const q = s => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  fs.writeFileSync(path.join(outDir, slug + '.csv'),
    'player,team,team_placement,individual_placement\n' + out.map(o => [o.player, o.team, o.tp, o.ip].map(q).join(',')).join('\n') + '\n');
  manifest.push({ file: slug + '.csv', name, date, source: 'event stats sheet', notes: warnings.join(' | ') });
  console.log(`${name} (${date || 'no date'}): ${out.length} players${warnings.length ? ', ' + warnings.length + ' warning(s)' : ''}`);
  warnings.forEach(w => console.log('   - ' + w));
}
fs.writeFileSync(path.join(outDir, 'events.json'), JSON.stringify(manifest, null, 2));
console.log(`\nWrote ${manifest.length} events to ${outDir}/. Review any warnings, then run: node seed.js ${outDir}`);
