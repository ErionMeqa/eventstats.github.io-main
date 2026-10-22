# Event Elo

Elo ratings for team-based Minecraft events (MCC-style), using both individual placement and team standings.

Requires Node.js 22.5 or newer (uses the built-in SQLite, so only Express is installed).

## Run
    npm install
    ADMIN_TOKEN=pick-a-secret npm start      # http://localhost:3000

## Add an event (CSV)
Columns: `player,team,team_placement,individual_placement`, plus an optional `uuid` column (leave team columns blank for solo events). See `sample/`.

Command line:
    node import.js sample/event1.csv "Sample Event 1" 2026-01-01

Or over HTTP:
    curl -X POST localhost:3000/api/import -H "x-admin-token: pick-a-secret" -H "content-type: application/json" \
      -d '{"name":"Sample Event 1","date":"2026-01-01","csv":"player,team,team_placement,individual_placement\nA,Red,1,1\n..."}'

Import events in any order: every import replays all events by date.

## Renamed players
    curl -X POST localhost:3000/api/rename -H "x-admin-token: pick-a-secret" -H "content-type: application/json" \
      -d '{"old":"OldName","new":"NewName"}'
The old name becomes an alias, so old CSVs and new ones land on the same player.

## Tune the rating
Edit the numbers at the top of `rating.js`: `K` (speed), `W` (individual vs team weight), `CARRY` (teammate comparison bonus).

## UUIDs and current names
- Players are identified by Minecraft UUID. The displayed name is always the latest known IGN, on every old event.
- On import, a row is matched by: its `uuid` column, then an alias, then the name (looked up with Mojang's API; lookups are cached).
- Players Mojang cannot match (old names) show up on the **Admin** page (`#/admin`, log in with your admin token). Look the name up on NameMC yourself, paste the UUID, and press Link. If the UUID already belongs to someone, the two are merged and the old name is kept as an alias.
- The server refreshes everyone's current name from Mojang once a day. You can also press the button on the Admin page or `POST /api/refresh-names`.
- Fastest for old data: put the UUID in the CSV `uuid` column when you collect results, so no lookup is needed.
- Please check NameMC's terms before automating anything with it. This project only links to it for manual searches.

## Real event data (`data/real/`)
Run `npm run seed` to import the real events listed in `data/real/events.json` (it skips ones already imported).

| Event | Date | Data included |
|---|---|---|
| Pandora's Box 1 | 2022-03-06 | team standings, 8 teams |
| MC Championship Rising | 2021-10-02 | individual standings, 40 players |
| Pandora's Box 12 | 2024-04-07 | team standings, 8 teams |
| Pandora's Box Dragon Pit: Ascension | 2024-11-03 | team standings, 8 teams |

Notes:
- Source for all four: the community wikis (mcchampionship.fandom.com, pandoras-box-event.fandom.com). Facts only were typed in; check them against the wiki before relying on them.
- For Pandora's Box, `team_placement` is the "Final Team Leaderboard" (points) ranking. The event winner is decided by a finals series, so it can differ (e.g. Hazel Hydras won PB1 while Crimson Cyclopes led on points).
- Dragon Pit: Ascension uses the wiki roster, which differs from the pre-event announcement for 2 players (probably substitutes).
- Events with only team standings (no `individual_placement`) are rated on the team part alone; events with only individual placements are rated on the individual part alone.
- Not included because I could not get complete data: MCC 30 (full individual standings found, but only 3 of 10 team rosters and no confirmed date) and other MCC / Pandora's Box events whose pages I could only see in part.

## Importing a whole stats sheet
For sheets laid out like the Pandora's Box event stats sheet (events side by side, each with its teams, an INDIVIDUAL BOARD and a header like `Pandora's Box S1 - Mar 6, 2022`):

1. In Google Sheets open the overview tab and choose File > Download > Comma-separated values (.csv).
2. Run `node tools/sheet-to-csv.js overview.csv sheet-out`. It writes one CSV per event plus `sheet-out/events.json`, and prints warnings (renamed players matched by points, substitutions written like `A/B`, missing dates, events with no team data or no individual board).
3. Check the warnings, fix any CSVs or dates by hand, then run `node seed.js sheet-out`.
4. Resolve renamed players on the Admin page (`#/admin`) by linking their UUID.

`sample/sheet-overview-sample.csv` shows the expected layout. It was built to imitate the Pandora's Box sheet, so other sheets (MCC, BW, Mayhem...) may need small changes to the parser if their layout differs.

## If Mojang rate limits you
Lookups are spaced out and retried, and after repeated rate limits the importer stops asking for 10 minutes and imports the remaining players without UUIDs. Nothing is lost:
- Wait 10 to 15 minutes, then run `npm run resolve` to give those players their UUIDs.
- Or skip lookups during import: PowerShell `$env:SKIP_MOJANG="1"; npm run seed`, Mac/Linux `SKIP_MOJANG=1 npm run seed`. Run `npm run resolve` later.
