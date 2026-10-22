const express = require('express');
const { db } = require('./db');
const { importEvent, renamePlayer, unmatched, linkPlayer, refreshNames } = require('./service');
const app = express();
const TOKEN = process.env.ADMIN_TOKEN || 'change-me';

app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const admin = (req, res, next) =>
  req.get('x-admin-token') === TOKEN ? next() : res.status(401).json({ error: 'Bad admin token' });

app.get('/api/leaderboard', (req, res) =>
  res.json(db.prepare('select id,name,rating,events from players where events>0 order by rating desc').all()));

app.get('/api/events', (req, res) =>
  res.json(db.prepare(`select e.id,e.name,e.date,count(p.id) players from events e
    left join performances p on p.event_id=e.id group by e.id order by e.date desc, e.id desc`).all()));

app.get('/api/events/:id', (req, res) => {
  const event = db.prepare('select * from events where id=?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Not found' });
  const players = db.prepare(`select pl.id,pl.name,p.team,p.team_placement,p.placement,p.before,p.after
    from performances p join players pl on pl.id=p.player_id where p.event_id=?
    order by coalesce(p.placement, p.team_placement), p.team_placement, pl.name`).all(event.id);
  const teams = {};
  players.forEach(p => { if (p.team) (teams[p.team] ||= { name: p.team, placement: p.team_placement, players: [] }).players.push(p.name); });
  res.json({ event, players, teams: Object.values(teams).sort((a, b) => a.placement - b.placement) });
});

app.get('/api/players/:id', (req, res) => {
  const player = db.prepare('select id,name,rating,events from players where id=?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Not found' });
  const history = db.prepare(`select e.id event_id,e.name,e.date,p.team,p.team_placement,p.placement,p.before,p.after
    from performances p join events e on e.id=p.event_id where p.player_id=? order by e.date,e.id`).all(player.id);
  res.json({ player, history });
});

app.post('/api/import', admin, async (req, res) => {
  try {
    const { name, date, csv } = req.body;
    if (!name || !date || !csv) throw new Error('name, date and csv are required');
    res.json({ id: await importEvent(name, date, csv) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/rename', admin, (req, res) => {
  try { renamePlayer(req.body.old, req.body.new); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/unmatched', admin, (req, res) => res.json(unmatched()));

app.post('/api/link', admin, async (req, res) => {
  try { res.json({ id: await linkPlayer(req.body.player_id, req.body.uuid) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/refresh-names', admin, async (req, res) => res.json(await refreshNames()));
setInterval(() => refreshNames().catch(console.error), 24 * 60 * 60 * 1000); // daily

app.listen(process.env.PORT || 3000, () => console.log('Event Elo running on http://localhost:3000'));
