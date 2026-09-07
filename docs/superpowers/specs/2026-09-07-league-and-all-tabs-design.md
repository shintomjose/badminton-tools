# Match tracker: "Alle" overview and "Liga" team matches

Date: 2026-09-07. Status: approved in chat, implementation follows.

## Goal

The entry tab of the match tracker (tab 06) gets two more modes next to
Training and Turnier:

- **Alle** — the landing mode. Read-only overview of today's matches of every
  type and of the last play days across all types, each row leading into the
  mode and day it belongs to.
- **Liga** — the Bezirksliga team matches of SG Heilbronn/Leingarten IV. A
  fixture is picked from the season's schedule (the same list the Termine tab
  renders) and all eight matches of that team match are logged, mine and my
  team-mates' alike, in the official slot order.

Liga is a full third match type: Verlauf filters on it, Statistik gets a Liga
tab, player profiles get a Liga bucket.

## Non-goals

Standings, league points, walkover handling beyond the existing retired /
abandoned result types, and any coupling with the availability grid of the
Termine tab.

## Data model

No new collections, no rule changes (rules whitelist collections only), no new
composite index.

**Session** (`sessions/{id}`), one per fixture:

```
type: "league"
fixtureId: "2026-10-17-1400"          // flat, for the equality lookup
league: {
  fixtureId, opponent, home: bool, round: "vor"|"rueck", time: "14:00",
  team: "SG Heilbronn/Leingarten IV",
  score: { us: 5, them: 3 } | null    // derived from the matches, kept in sync
}
```

Two fixtures on one Saturday (14:00 and 18:00) are two sessions, so the lookup
is by `fixtureId`, never by date. `date` is the fixture date at its start time,
so grouping keys and the history order are right.

**Match** (`matches/{id}`): the existing document plus

```
type: "league"
slot: "HD1" | "HD2" | "DD" | "HE1" | "HE2" | "HE3" | "DE" | "GD"
league: { fixtureId, opponent, home, team }   // denormalised, like `tournament`
opponentClub: <opponent>                       // reuses the existing flat field
```

Side A is always our team, side B the opponent. Opponent players are
quick-added with `club` = the fixture's opponent name. Target score is 21,
best of three, for every slot.

## Fixture source

`app.js` already holds the season schedule for the Termine tab. It now exposes
it as `window.LEAGUE_FIXTURES` (the same array) and `window.LEAGUE_TEAM`.
The tracker derives `dateKey` from the fixture id (`YYYY-MM-DD-HHMM`) and
reads `opp`, `home`, `round`, `time` as they are. One source of truth.

## Entry view

Mode toggle: **Alle · Training · Turnier · Liga**. Every mount starts on Alle.

### Alle

- Header card: today's date and today's record across all types.
- List: today's matches of every type, read-only cards (no edit, delete,
  drag or nudge), each with a type badge. Tapping a card opens that type on
  that day.
- Panel "Letzte Spieltage": last five play days across all types (one 90-day
  read, no type filter), grouped by day and type, each row with a type badge,
  a name where there is one (tournament name, "vs Opponent"), my W–L, sets and
  win %. Tapping a row opens that type and day.
- No editor, no "+ Spiel".

### Liga

- Landing: the fixture list, upcoming first (nearest on top), then played
  (newest on top). A fixture with a session shows its team score; one without
  shows nothing. One tap opens it.
- Open fixture: header with opponent, date and time, Heim / Auswärts, team
  score (from the stored matches), my Sieg / Niederlage chips and W–L, a
  "Spielplan" button back to the list. Venue picker as on other days.
- List: the eight slots in order HD1, HD2, DD, HE1, HE2, HE3, DE, GD. A filled
  slot renders the normal match card with the slot as its number; an empty
  slot is a placeholder with an "eintragen" button. No drag, no nudges: the
  order is the league's.
- Editor for a slot: discipline fixed by the slot, target 21, side A labelled
  with the team name, side B with the opponent. Team-mates come from the
  club roster type-ahead as today; opponents are typed and quick-added with
  the opponent club. The session is created with the first saved match
  (batched, like a training day), later matches join it.
- Team score is recomputed from the eight winners after every change and
  written to the session when it differs, so the fixture list and the
  history can show it without reading matches.
- Panel "Letzte Spieltage" in Liga mode: the last fixtures with a session,
  each with team score and my W–L.

## Other views

- **Verlauf**: Art filter gains Liga; rows get badges "Liga", "vs Opponent",
  and the slot.
- **Statistik**: a Liga tab next to Training and Turnier.
- **Profil**: a Liga bucket in the record block and in head-to-head, never
  merged with the other two.
- **Core**: `type` normalises to training / tournament / league everywhere it
  is written or filtered; `findSessionByFixture(fixtureId)` added; session and
  match builders pass the new fields through.

## Demo data

`dev/gen-demo.js` adds two league fixtures of the 2026/27 season: one played
(all eight slots filled) and one upcoming with nothing logged, using the real
schedule ids so the fixture list in demo mode matches production.

## Verification

No test runner in the repo. Verify in demo mode (`?demo=1`): all four entry
modes, slot entry with a new opponent, the team score, Verlauf with the Liga
filter, Statistik Liga tab, a player profile, light and dark theme. Bump the
service worker cache version.
