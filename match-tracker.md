# Feature: Badminton Match Tracker (new tab after "Shop")

## Context first — do not write code yet

Before proposing anything, read the existing codebase and report back:
- The routing/navigation setup and how the existing tabs (including "Shop") are registered
- The existing PIN/auth mechanism, if any
- **The Firestore setup**: how the SDK is initialised, whether Firebase Auth is in use
  and in what mode, where security rules live, existing collection structure and
  naming conventions, whether offline persistence is enabled, and how reads/writes are
  wrapped (hooks? a repository/service layer? direct SDK calls in components?)
- The i18n setup — where translation files live and how keys are namespaced
- The component library, styling system, and date-handling library in use
- Existing conventions: file layout, naming, TypeScript strictness, test setup

Match all of the above. Do not introduce a new state library, styling approach, or
date library unless you explain why the existing one can't do the job.

## Goal

A private, PIN-protected section where I log every badminton match I play, so I can
track my progress over time. I enter scores **on my phone, courtside, between
games** — entry speed on mobile is the single most important quality bar. Analysis
happens later on desktop.

## Scope

### 1. Navigation & access
- New top-level tab placed immediately after "Shop"
- PIN gate on entry, reusing the existing PIN mechanism. Unlocked state persists for
  the browser session; re-lock after inactivity (make the timeout a constant)
- **Be explicit about the security boundary.** A client-side PIN protects the UI, not
  the data. The actual protection must be Firestore security rules tied to Firebase
  Auth. In your plan, state which auth mode this app uses and write rules so that only
  my authenticated user can read or write the match data. If the app currently has no
  auth at all, say so and propose the smallest workable option rather than shipping an
  open collection.

### 2. Two separate record types — keep them apart
Training and Tournament matches share one underlying match model but must have
**separate entry flows and separate views**. Mixing them makes the lists unreadable.
Use a top-level toggle or sub-tab, defaulting to Training.

- **Training** — the common case, optimised for fast repeat entry
- **Tournament** — rarer, richer: tournament name, category/draw, round, opponent
  club. Entering one must not slow down the training flow

### 3. Firestore data model
Design it explicitly and show it to me before implementing.

**Collections** — prefer flat top-level collections over deep subcollections so I can
query across all matches without collection-group gymnastics. Propose the structure
and justify it.

`sessions/{sessionId}` — a training day or tournament day
- date (Timestamp), locationId, locationName (denormalised), type
  (`training` | `tournament`), optional note, ownerUid

`matches/{matchId}`
- sessionId, and **denormalised** date, locationName, and type — so the history view
  reads one collection instead of joining
- **Precomputed grouping keys**: `dateKey` (`2026-09-01`), `weekKey` (ISO week,
  `2026-W36`), `yearKey` (`2026`). These make the grouped list and the day/week/year
  summaries a simple equality filter with no composite-index pain. Compute them on
  write, never derive them by scanning on read
- discipline: `singles` | `doubles`
- targetScore: default **11 for singles, 21 for doubles**, overridable per match
  (I sometimes play 15, or 21 singles)
- sides A and B, each 1 player (singles) or 2 (doubles). Store **both** playerIds and
  denormalised player names, so rendering a list never costs N extra reads
- `playerIds: string[]` — a flat array of everyone in the match, so
  `array-contains` powers the player-profile query
- games: 1–3 game scores, but **default the UI to a single game** — most club play is
  one game to a fixed target. Don't force a best-of-3 flow for one game
- status: `in_progress` | `finished`. I mark finished explicitly; winner is **derived**
  from the score, not entered separately. Also store `winnerSide` denormalised on
  finish, so win-rate queries don't recompute
- ownerUid, createdAt, updatedAt

`players/{playerId}`
- name, club (default **TSG Heilbronn**), active flag, `isMe` on exactly one player —
  all personal stats key off this
- quick-add inline during match entry; I must never leave the entry screen to create
  a player

`locations/{locationId}`
- name, isDefault. Default **TSG Heilbronn Hall**; picker of previously used
  locations plus free-text entry for new ones

Handle in the model, not as afterthoughts: a match I didn't play in, a retired or
incomplete match, and a player who changes club (don't rewrite history).

### 4. Firestore usage rules
- **Enable offline persistence** (`persistentLocalCache` with multi-tab support). The
  hall has poor reception — entry must work fully offline and sync when it recovers.
  The UI must show pending-write state honestly rather than pretending a write landed
- Use `onSnapshot` only for the current session being edited. History and stats views
  use one-time `getDocs` with explicit range filters — never subscribe to the whole
  match collection
- Write a session and its first match with a batched write so a half-created session
  can't exist
- List every **composite index** the queries need and generate `firestore.indexes.json`
  — don't leave me discovering them from console errors in production
- Compute stats **client-side** from a fetched date range. At my volume (a few
  thousand matches over several years) this is cheap and keeps the model simple. Do
  not build aggregation documents or Cloud Functions unless you can show the read
  volume actually justifies it — and if you think it does, tell me before building it
- Handle write failures visibly. A silently dropped match is worse than an error

### 5. Mobile-first entry flow
The part to over-invest in:
- Large touch targets; score entry via +/- steppers, not a keyboard
- Player selection ordered by recently-played-with first, alphabetical after
- Within a session, "add another match" pre-fills date, location, and the previous
  match's players — most training days are the same four people rotating
- Sticky save/finish button reachable with a thumb
- One-handed operation; every match editable and deletable after saving

### 6. Lists & grouping
Chronological history, grouped and collapsible, driven by the precomputed keys:
- **Year → Week (ISO week, with date range) → Day**
- Each group header shows matches played, W–L, win %
- Default: current week expanded, everything else collapsed
- Filters: discipline, location, player, training/tournament

### 7. Stats & progress
For me by default:
- Totals and win % by **day**, **week**, and **year**
- Split by discipline — my singles and doubles records are different stories
- Trend over time (win % by week), current form / streak
- Breakdowns: best partners (doubles win % when partnered with X), toughest
  opponents, head-to-head records
- Training and tournament performance shown separately, never merged

Be honest about small samples — 100% from 2 matches must be visually distinguishable
from 100% from 40.

### 8. Player profiles
Tapping any player name anywhere opens their profile: overall record, match history
(`where playerIds array-contains playerId`), and head-to-head against me. Read-only
apart from editing name/club.

## Constraints
- **The app is German with an existing language switch.** All new strings go through
  the existing i18n layer with both DE and EN translations — no hardcoded text
  anywhere, including error messages, empty states, and date/week labels. Week
  numbering and date formatting must follow the active locale
- Mobile browser is the primary target; desktop good but secondary
- Follow existing code conventions; add tests where the repo already has them

## How to proceed
1. Report your findings on the existing codebase, especially the Firestore and auth setup
2. Propose the collection structure, security rules, required indexes, and the
   screen-by-screen flow (short outline — no ASCII mockups)
3. **Stop and wait for my approval**
4. Then implement in phases, each independently usable:
    - Phase 1: Firestore collections + security rules + indexes, PIN gate, nav tab,
      training match entry
    - Phase 2: grouped history list and filters
    - Phase 3: stats and progress views
    - Phase 4: tournament flow
    - Phase 5: player profiles

Flag any assumption you had to make rather than silently deciding. If a requirement
conflicts with something in the existing codebase, tell me — don't work around it
quietly.

## No need to ask me for all permissions, unless any urgent design questions arise
## Eventhough we have the PIN protection, disable it using a switch for the time being. later I will instruct you to activate it.