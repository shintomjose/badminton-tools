/* ===================== Match Tracker — entry view =====================
 * Mobile-first, courtside entry for BOTH record types. Registers itself as
 * the "entry" view on MT (tracker-core.js) and replaces the core placeholder.
 *
 * Design rules that drive this file:
 *  - only the FINAL result per game is entered — two big numeric fields,
 *    "21 : 15", never point-by-point
 *  - players come from the Firestore roster AND the club roster in app.js
 *    (window.LU_ROSTER); picking a club name creates its player doc silently
 *  - never leave the screen to create a player or a venue; the quick-add
 *    inputs stay behind a "+" toggle so they cost no vertical space
 *  - one game by default, "+ Satz" opts into best-of-3
 *  - the sticky "Fertig" bar stays reachable one-handed
 *
 * Training vs. tournament: both modes drive the SAME session card, match
 * list, editor, player picker and save path. Tournament adds exactly two
 * things — a one-off session header (name + category, asked once per
 * tournament day) and two optional per-match fields (round, opponent club).
 * Nothing on the training path gained a field or a tap.
 * ===================================================================== */
"use strict";

Object.assign(EN, {
  "Training": "Training",
  "Turnier": "Tournament",
  "Heute": "Today",
  "Spiele heute": "Matches today",
  "Noch keine Spiele heute — tippe auf „+ Spiel“.": "No matches today yet — tap “+ Match”.",
  "Neuer Ort": "New venue",
  "Hinzufügen": "Add",
  "Ort gilt ab jetzt — gespeicherte Spiele behalten ihren Ort": "The venue applies from now on — saved matches keep theirs",
  "+ Spiel": "+ Match",
  "Noch ein Spiel": "Another match",
  "+ Satz": "+ Game",
  "Satz {0}": "Game {0}",
  "Satz entfernen": "Remove game",
  "Neues Spiel": "New match",
  "Spiel bearbeiten": "Edit match",
  "Einzel": "Singles",
  "Doppel": "Doubles",
  /* Mixed reads the same in both languages; the app's abbreviation is GD → XD */
  "Mixed": "Mixed",
  "Disziplin": "Discipline",
  "Ziel": "Target",
  "Seite A": "Side A",
  "Seite B": "Side B",
  "Freier Platz": "Empty slot",
  "Fertig ✓": "Done ✓",
  "Abbrechen": "Cancel",
  "Offen speichern": "Save as open",
  "Bearbeiten": "Edit",
  "Sonderfall": "Special case",
  "Normal": "Normal",
  "Aufgabe A": "A retired",
  "Aufgabe B": "B retired",
  "Abbruch / unvollständig": "Abandoned / incomplete",
  "Sieg A": "A wins",
  "Sieg B": "B wins",
  "Kein Sieger": "No winner",
  "offen": "open",
  "Bitte alle Spieler wählen": "Please pick all players",
  "Kein Ergebnis — mindestens ein Satz muss entschieden sein": "No result — at least one game must be decided",
  "Spiel gespeichert": "Match saved",
  "Als offen gespeichert": "Saved as open",
  "Spiel gelöscht": "Match deleted",
  "Wirklich löschen?": "Really delete?",
  "Spieler hinzugefügt": "Player added",
  "Ort hinzugefügt": "Venue added",
  "Name eingeben": "Enter a name",
  "gegen": "vs",

  /* --- tournament flow (phase 4) --- */
  "Turnier heute": "Tournament today",
  "Turniername": "Tournament name",
  "Kategorie": "Category",
  "z. B. HE O35": "e.g. MS O35",
  "optional": "optional",
  "Einmal pro Turniertag eintragen — jedes Spiel erbt diese Angaben.":
    "Enter once per tournament day — every match inherits it.",
  "Turnier starten": "Start tournament",
  "Turnier speichern": "Save tournament",
  "Turnier bearbeiten": "Edit tournament",
  "Turniername eingeben": "Enter a tournament name",
  "Turnier gespeichert": "Tournament saved",
  "Runde": "Round",
  "Keine Runde": "No round",
  "Verein des Gegners": "Opponent club",
  /* round codes stay identical in both languages except Gruppe/Finale */
  "Gruppe": "Group",
  "R32": "R32",
  "R16": "R16",
  "VF": "VF",
  "HF": "HF",
  "Finale": "Final",

  /* --- type-ahead player slots, final-score entry --- */
  "Name tippen…": "Type a name…",
  "Vereinsliste": "Club roster",
  "„{0}“ neu anlegen": "Add “{0}” as new",
  "Ort hinzufügen": "Add venue",
  "Schließen": "Close",
  "Ergebnis {0}": "Score {0}",
  "Satz {0}: beide Ergebnisse eintragen": "Game {0}: enter both scores",
  "Satz {0}: nur ganze Zahlen von 0 bis {1}": "Game {0}: whole numbers from 0 to {1} only",

  /* --- winner named by first name instead of a side letter --- */
  "{0} gewinnt": "{0} wins",
  "{0} gewinnen": "{0} win",

  /* --- session header: date + matches logged today --- */
  "{0} Spiel": "{0} match",
  "{0} Spiele": "{0} matches",
  "Sätze {0}–{1}": "Sets {0}–{1}",
  /* abbreviated for the narrow summary rows; the long form rides along as a title */
  "S {0}–{1}": "S {0}–{1}",
  "Spiele {0}–{1}": "Matches {0}–{1}",

  /* --- day-wise totals ---
     Percentage keys mirror tracker-stats.js verbatim so both views read the
     same; assigning an identical value twice is harmless. */
  /* not "the last few days" — a row can be weeks old if that is when you last played */
  "Letzte Spieltage": "Last match days",
  "Noch keine Spiele erfasst": "No matches logged yet",
  "Bilanz nicht ladbar": "Record could not be loaded",
  "{0} % ({1})": "{0}% ({1})",
  "Kleine Stichprobe: nur 1 Spiel": "Small sample: only 1 match",
  "Kleine Stichprobe: nur {0} Spiele": "Small sample: only {0} matches",
});

(function () {
  if (typeof MT === "undefined") return;

  const DRAFT_KEY = "mt-draft-v1";
  const ME_SEED = "Mathew Jose, Shinto";
  const TARGETS = [11, 15, 21];
  const RECENT_DAYS = 90;
  const MAX_SCORE = 30;
  const SUGGEST_MAX = 8;     // rows in the type-ahead dropdown
  /* Current form is "the last days I actually played", not "the days I played
     inside the last fortnight" — a fortnight off would empty the panel. */
  const SUMMARY_DAYS = 90;   // look-back window for the day-wise totals
  const SUMMARY_ROWS = 5;    // how many play days to show
  const SMALL_N = 5;         // below this a percentage is flagged as thin evidence
  /* Stored verbatim on the match — the codes are the data, t() only labels them. */
  const ROUNDS = ["Gruppe", "R32", "R16", "VF", "HF", "Finale"];

  const state = {
    host: null,
    type: "training",      // in-memory only; every mount starts on Training
    session: null,
    matches: [],
    players: [],
    locations: [],
    recent: {},            // playerId -> ms of most recent match
    locationId: null,
    locationName: MT.DEFAULT_LOCATION,
    loaded: false,
    loadError: null,
    unwatch: null,
    draft: null,
    activeSlot: null,      // { side: "A"|"B", i: 0|1 }
    justSaved: false,
    /* tournament-day fields, asked once and inherited by every match of the day */
    trn: { name: "", category: "" },
    trnEdit: false,        // true while the session header is being re-edited
    addLocOpen: false,     // the venue quick-add input lives behind a "+" toggle
    /* type-ahead: which slot's field is open and what has been typed into it */
    pickQuery: "",
    pickOpen: null,        // { side: "A"|"B", i: 0|1 } | null
    pickBusy: false,       // guards against a double-tap creating two players
    summary: [],           // [{ dateKey, date, n, w, l }] most recent first
    summaryError: false,
  };

  /* ================= helpers ================= */
  function isTournament() { return state.type === "tournament"; }

  /* Case- and diacritic-insensitive fold, so "muller" finds "Müller"
     and "strauss" finds "Strauß". */
  function fold(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/ß/g, "ss")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  /* The TSG club roster maintained in app.js (Rangliste tab). Read lazily and
     defensively — the tracker must still work if that global ever goes away. */
  function clubRoster() {
    const list = window.LU_ROSTER;
    return Array.isArray(list) ? list.filter(n => typeof n === "string" && n.trim()) : [];
  }

  function playerByName(name) {
    const f = fold(name);
    return state.players.find(p => fold(p.name) === f) || null;
  }

  /* Names are stored "Last, First" — courtside the first name is what people
     actually say. Anything without a comma is used whole. */
  function firstName(full) {
    const s = String(full == null ? "" : full).trim();
    const c = s.indexOf(",");
    if (c < 0) return s;
    return s.slice(c + 1).trim() || s;
  }

  /* "Shinto gewinnt" / "Shinto & Nicolas gewinnen" instead of "Sieg A".
     Falls back to the side letter while the slots are still empty. */
  function winnerText(side, names) {
    const firsts = (names || []).filter(Boolean).map(firstName).filter(Boolean);
    if (!firsts.length) return side ? t("Sieg " + side) : t("Kein Sieger");
    return firsts.length === 1
      ? tt("{0} gewinnt", firsts[0])
      : tt("{0} gewinnen", firsts.join(" & "));
  }

  /* Winner label for a stored match — playerNames are denormalised on write,
     so this costs no lookups; ids are the fallback for older documents. */
  function matchWinnerText(m) {
    const side = m.status === "finished" ? m.winnerSide : null;
    if (!side) return t("Kein Sieger");
    const s = (side === "A" ? m.sideA : m.sideB) || {};
    const names = (s.playerNames && s.playerNames.length)
      ? s.playerNames
      : (s.playerIds || []).map(playerName);
    return winnerText(side, names);
  }

  /* Winner label for the draft being edited. */
  function draftWinnerText(d) {
    const side = MT.matchWinner(d);
    if (!side) return t("Kein Sieger");
    return winnerText(side, namesOf(side === "A" ? d.sideA : d.sideB));
  }
  function trnName() { return String(state.trn.name || "").trim(); }
  function trnCategory() { return String(state.trn.category || "").trim(); }

  /* The session document is the source of truth once it exists. */
  function hydrateTournament(session) {
    if (!session || state.trnEdit) return;
    state.trn.name = session.tournamentName || "";
    state.trn.category = session.tournamentCategory || "";
  }

  /* Datalist for the opponent-club field: every club we already know about,
     from the player roster plus clubs typed on earlier matches of this day. */
  function knownClubs() {
    const seen = {};
    state.players.forEach(p => { const c = String(p.club || "").trim(); if (c) seen[c] = 1; });
    state.matches.forEach(m => {
      const c = String(m.opponentClub || (m.tournament && m.tournament.opponentClub) || "").trim();
      if (c) seen[c] = 1;
    });
    return Object.keys(seen).sort((a, b) => a.localeCompare(b, DATE_LOCALE));
  }

  /* Shared convention with the core: anything that is not doubles or mixed
     normalises to singles. Mixed is a doubles shape with its own label —
     two players a side, target 21. */
  const DISCIPLINES = [
    ["singles", "Einzel"],
    ["doubles", "Doppel"],
    ["mixed", "Mixed"],
  ];
  function normDiscipline(v) {
    return (v === "doubles" || v === "mixed") ? v : "singles";
  }
  function disciplineLabel(v) {
    const hit = DISCIPLINES.find(x => x[0] === normDiscipline(v));
    return t(hit[1]);
  }
  function slotCount(d) { return normDiscipline(d.discipline) === "singles" ? 1 : 2; }
  function defaultTarget(disc) { return normDiscipline(disc) === "singles" ? 11 : 21; }
  function playerById(id) { return state.players.find(p => p.id === id) || null; }
  function playerName(id) { const p = playerById(id); return p ? p.name : "—"; }
  function meePlayer() { return state.players.find(p => p.isMe) || null; }

  function namesOf(ids) { return ids.filter(Boolean).map(playerName); }

  function sideHtml(ids, opts) {
    const list = (ids || []).filter(Boolean);
    if (!list.length) return esc(t("Freier Platz"));
    return list.map(id =>
      '<button type="button" class="mt-plink" data-act="player" data-id="' + esc(id) + '">' +
      esc(playerName(id)) + "</button>"
    ).join((opts && opts.sep) || " / ");
  }

  function draftIds(d) { return d.sideA.concat(d.sideB).filter(Boolean); }

  function normalizeSlots(d) {
    const n = slotCount(d);
    d.sideA = (d.sideA || []).slice(0, n);
    d.sideB = (d.sideB || []).slice(0, n);
    while (d.sideA.length < n) d.sideA.push(null);
    while (d.sideB.length < n) d.sideB.push(null);
  }

  function firstEmptySlot(d) {
    for (let i = 0; i < d.sideA.length; i++) if (!d.sideA[i]) return { side: "A", i: i };
    for (let i = 0; i < d.sideB.length; i++) if (!d.sideB[i]) return { side: "B", i: i };
    return null;
  }

  /* ================= local draft persistence =================
     A dying phone battery must not cost the match that is being entered. */
  function saveDraftLocal() {
    try {
      if (!state.draft) { localStorage.removeItem(DRAFT_KEY); return; }
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        dateKey: MT.keys(new Date()).dateKey,
        type: state.type,
        draft: state.draft,
        activeSlot: state.activeSlot,
      }));
    } catch (e) { /* private mode / quota — the draft simply is not restorable */ }
  }

  function restoreDraftLocal() {
    let raw = null;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) { return; }
    if (!raw) return;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return; }
    if (!parsed || parsed.dateKey !== MT.keys(new Date()).dateKey) {
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
      return;
    }
    if (parsed.type && parsed.type !== state.type) return;
    if (!parsed.draft) return;
    state.draft = parsed.draft;
    normalizeSlots(state.draft);
    state.activeSlot = parsed.activeSlot || firstEmptySlot(state.draft);
  }

  /* ================= data loading ================= */
  async function load() {
    state.loadError = null;
    try {
      const res = await Promise.all([MT.repo.listPlayers(), MT.repo.listLocations()]);
      state.players = res[0];
      state.locations = res[1];
      await seedDefaults();
      pickDefaultLocation();
      await loadRecent();
      const s = await MT.repo.findTodaySession(state.type);
      state.loaded = true;
      restoreDraftLocal();
      if (s) startWatch(s);
      renderAll();
      loadSummary();                       // best effort, never blocks entry
    } catch (e) {
      state.loaded = true;
      state.loadError = e;
      MT.toastError(e, "Laden fehlgeschlagen");
      renderAll();
    }
  }

  async function seedDefaults() {
    if (!state.locations.length) {
      const id = await MT.repo.addLocation(MT.DEFAULT_LOCATION, { isDefault: true });
      state.locations = [{ id: id, name: MT.DEFAULT_LOCATION, isDefault: true }];
    }
    if (!state.players.length) {
      const id = await MT.repo.addPlayer(ME_SEED, MT.DEFAULT_CLUB, { isMe: true });
      state.players = [{ id: id, name: ME_SEED, club: MT.DEFAULT_CLUB, isMe: true, active: true }];
    }
  }

  function pickDefaultLocation() {
    const def = state.locations.find(l => l.isDefault) || state.locations[0];
    if (def) { state.locationId = def.id; state.locationName = def.name; }
  }

  /* Best effort: powers "recently played with" chip ordering. Failing here
     (missing index, offline first run) must not block entry. */
  async function loadRecent() {
    try {
      const from = new Date();
      from.setDate(from.getDate() - RECENT_DAYS);
      const list = await MT.repo.getMatches({ from: from, to: new Date(), limit: 300 });
      const map = {};
      list.forEach(m => {
        const d = MT.toDate(m.date);
        const ms = d ? d.getTime() : 0;
        (m.playerIds || []).forEach(id => { if (!map[id] || map[id] < ms) map[id] = ms; });
      });
      state.recent = map;
    } catch (e) {
      console.warn("[MT] Kürzlich gespielte Spieler nicht ermittelbar:", e && e.code ? e.code : e);
      state.recent = {};
    }
  }

  /* Day-wise totals for the courtside glance. ONE ranged read, no snapshot —
     today's row is recomputed from the live session so it updates instantly.
     The window is wide but only the newest few play days are ever rendered;
     getMatches orders by date desc, so the cap can only drop the oldest. */
  async function loadSummary() {
    const wanted = state.type;
    try {
      const from = new Date();
      from.setDate(from.getDate() - (SUMMARY_DAYS - 1));
      const list = await MT.repo.getMatches({ from: from, to: new Date(), limit: 800 });
      if (state.type !== wanted) return;                 // mode switched meanwhile
      state.summary = groupByDay(list.filter(m => m.type === wanted));
      state.summaryError = false;
    } catch (e) {
      console.warn("[MT] Tagesbilanz nicht ermittelbar:", e && e.code ? e.code : e);
      state.summary = [];
      state.summaryError = true;
    }
    renderSummary();
  }

  function blankRec(dateKey, date) {
    return { dateKey: dateKey, date: date, n: 0, w: 0, l: 0, sw: 0, sl: 0 };
  }

  /* Attribution rules — deliberately the same for matches and for games, so a
     row never mixes two definitions of "played":
       - every match of the day counts towards `n`, mine or not;
       - only FINISHED matches I was on court for feed W–L and Sätze. A match
         still in progress contributes nothing beyond `n`, even if its first
         game is already decided;
       - within such a match, W–L needs a winnerSide (a retirement or an
         abandoned match has none, so it counts towards neither), while each
         individual game counts as soon as MT.gameWinner can decide it —
         undecided or half-entered games are skipped by that function. */
  function tallyDay(rec, m, meId) {
    rec.n++;
    if (!meId || m.status !== "finished") return;
    const inA = ((m.sideA && m.sideA.playerIds) || []).indexOf(meId) >= 0;
    const inB = ((m.sideB && m.sideB.playerIds) || []).indexOf(meId) >= 0;
    if (!inA && !inB) return;
    const mine = inA ? "A" : "B";
    if (m.winnerSide) { if (m.winnerSide === mine) rec.w++; else rec.l++; }
    const target = Number(m.targetScore) || defaultTarget(m.discipline);
    (Array.isArray(m.games) ? m.games : []).forEach(g => {
      const gw = MT.gameWinner(g, target);
      if (!gw) return;
      if (gw === mine) rec.sw++; else rec.sl++;
    });
  }

  function groupByDay(list) {
    const me = meePlayer();
    const meId = me ? me.id : null;
    const byKey = new Map();
    list.forEach(m => {
      const key = m.dateKey || MT.keys(MT.toDate(m.date) || new Date()).dateKey;
      let rec = byKey.get(key);
      if (!rec) { rec = blankRec(key, MT.toDate(m.date)); byKey.set(key, rec); }
      if (!rec.date) rec.date = MT.toDate(m.date);
      tallyDay(rec, m, meId);
    });
    return Array.from(byKey.values()).sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
  }

  /* Today, live from the watched session — shared by the header meta line and
     the first summary row so the two can never disagree. */
  function todayRecord() {
    const rec = blankRec(MT.keys(new Date()).dateKey, new Date());
    const me = meePlayer();
    const meId = me ? me.id : null;
    state.matches.forEach(m => tallyDay(rec, m, meId));
    return rec;
  }

  /* The newest SUMMARY_ROWS days on which there was actually play — every row
     is a real play day, so a fortnight off shows form rather than blanks.
     Today only earns a row when it has matches; the header meta already states
     today's record either way, so an empty row would just cost a slot. */
  function summaryRows() {
    const today = todayRecord();
    const rows = state.summary.filter(r => r.dateKey !== today.dateKey && r.n > 0);
    if (today.n) {
      rows.unshift(today);                     // live, and always the newest day
    } else {
      /* No live session attached yet (first paint, or tournament mode before
         the day is named) — fall back to what the ranged read saw for today. */
      const fetched = state.summary.find(r => r.dateKey === today.dateKey && r.n > 0);
      if (fetched) rows.unshift(fetched);
    }
    return rows.slice(0, SUMMARY_ROWS);
  }

  function startWatch(session) {
    stopWatch();
    state.session = session;
    hydrateTournament(session);
    state.unwatch = MT.repo.watchSession(session.id, function (payload) {
      if (payload.session) { state.session = payload.session; hydrateTournament(payload.session); }
      if (payload.matches) state.matches = payload.matches;
      renderSession();
      renderList();
      renderSummary();
    });
  }

  /* Re-attach the live session watch after the view was unmounted and mounted
     again (switching away to History and back would otherwise show a frozen list). */
  function resyncSession() {
    const wanted = state.type;
    MT.repo.findTodaySession(wanted)
      .then(s => {
        if (state.type !== wanted) return;          // toggled again meanwhile
        if (s) startWatch(s);
        renderSession();
        renderList();
      })
      .catch(e => MT.toastError(e, "Laden fehlgeschlagen"));
  }

  function stopWatch() {
    if (state.unwatch) { try { state.unwatch(); } catch (e) {} state.unwatch = null; }
  }

  /* ================= rendering ================= */
  function el(id) { return document.getElementById(id); }

  function renderAll() {
    renderTypeToggle();
    renderSession();
    renderList();
    renderSummary();
    renderEditor();
  }

  function renderTypeToggle() {
    const wrap = el("mtTypeToggle");
    if (!wrap) return;
    wrap.querySelectorAll("[data-act='type']").forEach(b => {
      b.setAttribute("aria-pressed", String(b.dataset.v === state.type));
    });
  }

  /* Venue picker — identical for both modes. The quick-add input hides behind
     a "+" toggle (same pattern as the Rangliste tab) so it costs no space. */
  function venueBlockHtml() {
    const addOpen = state.addLocOpen;
    return '<div class="mt-sec-head">' +
        '<div class="mt-label">' + esc(t("Ort")) + "</div>" +
        '<button type="button" class="btn icon-add" data-act="addloc-toggle"' +
          ' aria-expanded="' + addOpen + '" aria-controls="mtAddLoc"' +
          ' title="' + esc(addOpen ? t("Schließen") : t("Ort hinzufügen")) + '">' +
          (addOpen ? "×" : "+") + "</button>" +
      "</div>" +
      '<div class="mt-chips">' +
        state.locations.map(l =>
          '<button type="button" class="mt-chip" data-act="loc" data-id="' + esc(l.id) + '"' +
          ' aria-pressed="' + (l.id === state.locationId) + '">' + esc(l.name) + "</button>"
        ).join("") +
      "</div>" +
      '<form class="add-form mt-add-loc" id="mtAddLoc"' + (addOpen ? "" : " hidden") + ">" +
        '<input type="text" placeholder="' + esc(t("Neuer Ort")) + '" autocomplete="off" aria-label="' + esc(t("Neuer Ort")) + '">' +
        '<button type="submit" class="btn">' + esc(t("Hinzufügen")) + "</button>" +
      "</form>";
  }

  /* Short, glanceable date: "Mo., 01.09.2026" in DE, "Mon, 01/09/2026" in EN. */
  function shortDate(d) {
    return MT.fmtDate(d || new Date(), {
      weekday: "short", day: "2-digit", month: "2-digit", year: "numeric",
    });
  }

  function matchCountLabel(n) {
    return n === 1 ? tt("{0} Spiel", n) : tt("{0} Spiele", n);
  }

  function hasRecord(rec) { return !!(rec.w + rec.l + rec.sw + rec.sl); }

  /* App-wide convention: wins green, losses red, separator neutral.
     Numbers only — the surrounding words come from t()/tt() templates, whose
     literal parts are controlled constants and need no escaping. Zero values
     stay coloured on purpose: consistency beats a special case. */
  function winNum(n) { return '<span class="mt-w">' + (Number(n) || 0) + "</span>"; }
  function lossNum(n) { return '<span class="mt-l">' + (Number(n) || 0) + "</span>"; }
  function wlPair(w, l) { return winNum(w) + "–" + lossNum(l); }

  /* "3 Spiele · 2–1 · Sätze 5–3" — the W–L parts appear only once the isMe
     player has actually played something that day. Returns HTML. */
  function metaTailHtml(rec) {
    const parts = [esc(matchCountLabel(rec.n))];
    if (rec.w + rec.l) parts.push(wlPair(rec.w, rec.l));
    if (rec.sw + rec.sl) parts.push(tt("Sätze {0}–{1}", winNum(rec.sw), lossNum(rec.sl)));
    return parts.join(" · ");
  }

  /* Card heading — date and today's record are the two things worth seeing at
     a glance, in both modes. */
  function sessionHeadHtml() {
    const meta = esc(shortDate()) + " · " + metaTailHtml(todayRecord());
    if (!isTournament()) {
      return "<h2>" + esc(t("Heute")) + '</h2><p class="mt-sess-meta">' + meta + "</p>";
    }
    const cat = trnCategory();
    return '<div class="mt-trn-head">' +
      "<h2>" + esc(trnName() || t("Turnier")) + "</h2>" +
      '<button type="button" class="btn small" data-act="trnedit">' + esc(t("Turnier bearbeiten")) + "</button>" +
    "</div>" +
    /* the category is user input and stays escaped */
    '<p class="mt-sess-meta">' + (cat ? esc(cat) + " · " : "") + meta + "</p>";
  }

  /* Day-wise totals — a courtside glance, not the history tab. */
  function summaryHtml() {
    if (state.summaryError) {
      return '<p class="mt-muted">' + esc(t("Bilanz nicht ladbar")) + "</p>";
    }
    const rows = summaryRows();
    /* every row is a real play day now, so "empty" simply means none found */
    if (!rows.length) {
      return '<p class="mt-muted">' + esc(t("Noch keine Spiele erfasst")) + "</p>";
    }
    const todayKey = MT.keys(new Date()).dateKey;
    return '<ul class="mt-days">' + rows.map(r => {
      const isToday = r.dateKey === todayKey;
      const played = hasRecord(r);
      /* The stats group wraps to its own line before anything gets squeezed,
         and the Sätze cell is abbreviated with the long form as its title. */
      return '<li class="mt-day' + (isToday ? " today" : "") + '">' +
        '<span class="mt-day-date">' + esc(isToday ? t("Heute") : shortDate(r.date)) + "</span>" +
        '<span class="mt-day-stats">' +
          '<span class="mt-day-n">' + esc(matchCountLabel(r.n)) + "</span>" +
          (played
            ? '<span class="mt-day-wl" title="' + esc(tt("Spiele {0}–{1}", r.w, r.l)) + '">' +
                wlPair(r.w, r.l) + "</span>" +
              '<span class="mt-day-sets" title="' + esc(tt("Sätze {0}–{1}", r.sw, r.sl)) + '">' +
                tt("S {0}–{1}", winNum(r.sw), lossNum(r.sl)) + "</span>"
            : "") +
          pctHtml(r.w, r.w + r.l) +
        "</span>" +
      "</li>";
    }).join("") + "</ul>";
  }

  /* Never a bare percentage: the sample size rides along, and a thin sample
     is marked — same convention as the stats view. */
  function pctHtml(wins, n) {
    if (!n) return '<span class="mt-pct empty">–</span>';
    const label = tt("{0} % ({1})", Math.round((wins / n) * 100), n);
    if (n < SMALL_N) {
      const why = n === 1
        ? t("Kleine Stichprobe: nur 1 Spiel")
        : tt("Kleine Stichprobe: nur {0} Spiele", n);
      return '<span class="mt-pct weak" title="' + esc(why) + '"' +
        ' aria-label="' + esc(label + " — " + why) + '">' + esc(label) + "</span>";
    }
    return '<span class="mt-pct">' + esc(label) + "</span>";
  }

  function renderSummary() {
    const host = el("mtSummaryPanel");
    if (!host) return;
    /* the editor owns the screen while a match is being entered */
    if (state.draft || !state.loaded) { host.innerHTML = ""; return; }
    if (isTournament() && (!state.session || state.trnEdit)) { host.innerHTML = ""; return; }
    host.innerHTML =
      '<section class="panel mt-summary">' +
        "<h2>" + esc(t("Letzte Spieltage")) + "</h2>" +
        summaryHtml() +
      "</section>";
  }

  /* Asked once per tournament day: name (required) + category (optional).
     Shown only while no tournament session exists for today, or on re-edit. */
  function tournamentSetupHtml() {
    const editing = !!state.session;
    return '<section class="panel mt-session mt-trn-setup">' +
      "<h2>" + esc(t("Turnier heute")) + ' <span class="hint">— ' + esc(MT.fmtDate(new Date())) + "</span></h2>" +
      '<p class="mt-muted">' + esc(t("Einmal pro Turniertag eintragen — jedes Spiel erbt diese Angaben.")) + "</p>" +
      /* novalidate: the empty-name message must come from t(), not from the
         browser's own (untranslated) validation bubble */
      '<form class="mt-trn-form" novalidate>' +
        '<label class="mt-field">' +
          '<span class="mt-label">' + esc(t("Turniername")) + "</span>" +
          '<input type="text" class="mt-trn-name" required autocomplete="off" enterkeyhint="done"' +
            ' placeholder="' + esc(t("Turniername")) + '" aria-label="' + esc(t("Turniername")) + '"' +
            ' value="' + esc(trnName()) + '">' +
        "</label>" +
        '<label class="mt-field">' +
          '<span class="mt-label">' + esc(t("Kategorie")) + ' <span class="mt-muted">(' + esc(t("optional")) + ")</span></span>" +
          '<input type="text" class="mt-trn-cat" autocomplete="off"' +
            ' placeholder="' + esc(t("z. B. HE O35")) + '" aria-label="' + esc(t("Kategorie")) + '"' +
            ' value="' + esc(trnCategory()) + '">' +
        "</label>" +
        '<div class="mt-trn-actions">' +
          (editing ? '<button type="button" class="btn" data-act="trncancel">' + esc(t("Abbrechen")) + "</button>" : "") +
          '<button type="submit" class="btn primary mt-big">' +
            esc(editing ? t("Turnier speichern") : t("Turnier starten")) + "</button>" +
        "</div>" +
      "</form>" +
      venueBlockHtml() +
    "</section>";
  }

  function renderSession() {
    const host = el("mtSessionPanel");
    if (!host) return;
    const keep = host.querySelector(".mt-add-loc input");
    const kept = keep ? keep.value : "";
    host.innerHTML = (isTournament() && (!state.session || state.trnEdit))
      ? tournamentSetupHtml()
      : '<section class="panel mt-session">' + sessionHeadHtml() + venueBlockHtml() + "</section>";
    if (kept) { const inp = host.querySelector(".mt-add-loc input"); if (inp) inp.value = kept; }
  }

  function matchLine(m) {
    const games = Array.isArray(m.games) ? m.games : [];
    const winner = m.status === "finished" ? m.winnerSide : null;
    const cells = side => games.map(g =>
      '<span class="mt-sg-val">' + esc(String(side === "A" ? (g.a || 0) : (g.b || 0))) + "</span>").join("");
    const disc = disciplineLabel(m.discipline);
    /* Only an actual winner earns the green pill — a finished match without one
       (retired, abandoned) stays neutral. */
    const statusHtml = m.status === "finished"
      ? '<span class="mt-badge' + (winner ? " done" : "") + '">' + esc(matchWinnerText(m)) + "</span>"
      : '<span class="mt-badge open">' + esc(t("offen")) + "</span>";
    /* tournament extras only exist on tournament matches — null for training */
    const trn = m.tournament || {};
    const round = m.round || trn.round || "";
    const club = m.opponentClub || trn.opponentClub || "";
    const trnHtml =
      (round ? '<span class="mt-badge trn">' + esc(t(round)) + "</span>" : "") +
      (club ? '<span class="mt-badge trn">' + esc(club) + "</span>" : "");
    return '<li class="mt-match" data-id="' + esc(m.id) + '">' +
      '<div class="mt-match-top">' +
        '<span class="mt-badge">' + esc(disc + " · " + (m.targetScore || "")) + "</span>" +
        trnHtml +
        statusHtml +
      "</div>" +
      '<div class="mt-score-grid" style="--games:' + (games.length || 1) + '">' +
        '<span class="mt-sg-name' + (winner === "A" ? " win" : "") + '">' + sideHtml(m.sideA && m.sideA.playerIds) + "</span>" + cells("A") +
        '<span class="mt-sg-name' + (winner === "B" ? " win" : "") + '">' + sideHtml(m.sideB && m.sideB.playerIds) + "</span>" + cells("B") +
      "</div>" +
      '<div class="mt-match-actions">' +
        '<button type="button" class="btn small" data-act="edit" data-id="' + esc(m.id) + '">' + esc(t("Bearbeiten")) + "</button>" +
        '<button type="button" class="btn small" data-act="del" data-id="' + esc(m.id) + '">' + esc(t("Löschen")) + "</button>" +
      "</div>" +
    "</li>";
  }

  function renderList() {
    const host = el("mtListPanel");
    if (!host) return;
    /* Tournament: nothing to add matches to until the day has been named. */
    if (isTournament() && (!state.session || state.trnEdit)) { host.innerHTML = ""; return; }
    if (state.draft) { host.innerHTML = ""; return; }   // full focus on the editor
    if (!state.loaded) {
      host.innerHTML = '<p class="empty-note">' + esc(t("Verbinde…")) + "</p>";
      return;
    }
    if (state.loadError) {
      host.innerHTML = '<section class="panel mt-card"><h2>' + esc(t("Laden fehlgeschlagen")) + "</h2>" +
        '<div class="mt-card-actions"><button type="button" class="btn" data-act="reload">' + esc(t("Erneut prüfen")) + "</button></div></section>";
      return;
    }
    const list = state.matches;
    const addLabel = state.justSaved && list.length ? t("Noch ein Spiel") : t("+ Spiel");
    host.innerHTML =
      '<section class="panel mt-matches">' +
        "<h2>" + esc(t("Spiele heute")) + ' <span class="seg-count">' + list.length + "</span></h2>" +
        (list.length
          ? '<ul class="mt-match-list">' + list.map(matchLine).join("") + "</ul>"
          : '<p class="empty-note">' + esc(t("Noch keine Spiele heute — tippe auf „+ Spiel“.")) + "</p>") +
        '<button type="button" class="btn primary mt-big" data-act="newmatch">' + esc(addLabel) + "</button>" +
      "</section>";
  }

  function winnerBadgeHtml(d) {
    const w = MT.matchWinner(d);
    return '<span class="mt-badge ' + (w ? "done" : "open") + '" id="mtWinBadge">' +
      esc(draftWinnerText(d)) + "</span>";
  }

  /* Candidate list for the type-ahead: everyone with a Firestore players doc,
     plus every club-roster name that has no doc yet. Roster-only entries carry
     no id — picking one creates the doc on the fly (see pickByName).
     Order: recently played first (docs only), then everything else A→Z. */
  function pickerPool(d) {
    const used = draftIds(d);
    const usedNames = {};
    used.forEach(id => { const p = playerById(id); if (p) usedNames[fold(p.name)] = 1; });

    const out = [];
    const seen = {};
    state.players.forEach(p => {
      if (p.active === false || used.indexOf(p.id) >= 0) return;
      seen[fold(p.name)] = 1;
      out.push({ id: p.id, name: p.name, recent: state.recent[p.id] || 0, roster: false });
    });
    clubRoster().forEach(name => {
      const f = fold(name);
      if (seen[f] || usedNames[f]) return;
      seen[f] = 1;
      out.push({ id: null, name: name, recent: 0, roster: true });
    });

    return out.sort((a, b) => {
      if (b.recent !== a.recent) return b.recent - a.recent;   // recently played first
      return String(a.name).localeCompare(String(b.name), DATE_LOCALE);
    });
  }

  /* Substring match on the folded name, capped so the dropdown stays compact.
     An empty query lists the top candidates — courtside that is usually the
     people you just played with. */
  function suggestions(d) {
    const q = fold(state.pickQuery).trim();
    const pool = pickerPool(d);
    return (q ? pool.filter(c => fold(c.name).indexOf(q) >= 0) : pool).slice(0, SUGGEST_MAX);
  }

  /* Rows only — rebuilt on every keystroke, so it must never re-render the
     input itself or the caret would jump. */
  function suggestHtml(d) {
    const list = suggestions(d);
    const typed = String(state.pickQuery || "").trim();
    const exact = typed && list.some(c => fold(c.name) === fold(typed));
    const rows = list.map(c =>
      '<button type="button" class="mt-sg-row" data-act="pickname" data-name="' + esc(c.name) + '">' +
        '<span class="mt-sg-nm">' + esc(c.name) + "</span>" +
        (c.roster ? '<span class="mt-sg-tag">' + esc(t("Vereinsliste")) + "</span>" : "") +
      "</button>"
    ).join("");
    /* free-text add: the type-ahead is also the create path */
    const add = (typed && !exact)
      ? '<button type="button" class="mt-sg-row add" data-act="pickname" data-name="' + esc(typed) + '">' +
          '<span class="mt-sg-nm">' + esc(tt("„{0}“ neu anlegen", typed)) + "</span>" +
        "</button>"
      : "";
    if (!rows && !add) return "";
    return rows + add;
  }

  function slotIsOpen(sideKey, i) {
    return !!(state.pickOpen && state.pickOpen.side === sideKey && state.pickOpen.i === i);
  }

  /* One field per slot. Filled → the name with an ✕ that clears and reopens
     the field. Empty → a type-ahead input with an overlaid dropdown. */
  function slotHtml(d, sideKey, i) {
    const id = (sideKey === "A" ? d.sideA : d.sideB)[i];
    if (id) {
      return '<div class="mt-slot-wrap">' +
        '<button type="button" class="mt-slot filled" data-act="slot"' +
          ' data-side="' + sideKey + '" data-i="' + i + '">' +
          esc(playerName(id)) +
          '<span class="mt-slot-x" aria-hidden="true">✕</span>' +
        "</button>" +
      "</div>";
    }
    /* The dropdown box is always in the DOM (empty → display:none via CSS), so
       focusing a field never re-renders and never drops the mobile keyboard. */
    const open = slotIsOpen(sideKey, i);
    const boxId = "mtSuggest-" + sideKey + "-" + i;
    return '<div class="mt-slot-wrap">' +
      '<input type="text" class="mt-slot-input" data-side="' + sideKey + '" data-i="' + i + '"' +
        ' autocomplete="off" autocapitalize="words" enterkeyhint="done" role="combobox"' +
        ' aria-expanded="' + open + '" aria-autocomplete="list" aria-controls="' + boxId + '"' +
        ' placeholder="' + esc(t("Name tippen…")) + '"' +
        ' aria-label="' + esc(t("Seite " + sideKey)) + '"' +
        ' value="' + esc(open ? state.pickQuery : "") + '">' +
      '<div class="mt-suggest" id="' + boxId + '" role="listbox">' +
        (open ? suggestHtml(d) : "") +
      "</div>" +
    "</div>";
  }

  function slotInputEl(slot) {
    if (!state.host || !slot) return null;
    return state.host.querySelector(
      '.mt-slot-input[data-side="' + slot.side + '"][data-i="' + slot.i + '"]');
  }

  /* Swap just the open slot's dropdown contents — never the input itself,
     or the caret and the keyboard would go with it. */
  function patchSuggest() {
    const inp = slotInputEl(state.pickOpen);
    const box = inp && inp.parentNode ? inp.parentNode.querySelector(".mt-suggest") : null;
    if (!box || !state.draft) return;
    box.innerHTML = suggestHtml(state.draft);
    inp.setAttribute("aria-expanded", "true");
  }

  /* Closing is a DOM tweak, not a re-render: empty the box and drop the text
     that was never confirmed. */
  function closeSuggest() {
    const slot = state.pickOpen;
    if (!slot) return;
    const inp = slotInputEl(slot);
    if (inp) {
      const box = inp.parentNode ? inp.parentNode.querySelector(".mt-suggest") : null;
      if (box) box.innerHTML = "";
      inp.value = "";
      inp.setAttribute("aria-expanded", "false");
    }
    state.pickOpen = null;
    state.pickQuery = "";
  }

  function slotsHtml(d, sideKey) {
    const ids = sideKey === "A" ? d.sideA : d.sideB;
    return '<div class="mt-side" data-side="' + sideKey + '">' +
      "<h3>" + esc(t("Seite " + sideKey)) + "</h3>" +
      '<div class="mt-slots">' +
        ids.map((id, i) => slotHtml(d, sideKey, i)).join("") +
      "</div>" +
    "</div>";
  }

  /* Raw draft values are kept as typed (strings) so "empty" stays
     distinguishable from "0" until validation runs. */
  function scoreStr(v) { return v === null || v === undefined ? "" : String(v); }

  /* Final result only — "21 : 15", A left, B right, names above each field. */
  function gameHtml(d, gi) {
    const g = d.games[gi];
    const field = function (sideKey) {
      const s = sideKey.toLowerCase();
      const names = namesOf(sideKey === "A" ? d.sideA : d.sideB).join(" / ") || t("Seite " + sideKey);
      return '<label class="mt-res">' +
        '<span class="mt-res-name">' + esc(names) + "</span>" +
        '<input type="number" inputmode="numeric" class="mt-num" min="0" max="' + MAX_SCORE + '" step="1"' +
          ' data-g="' + gi + '" data-s="' + s + '"' +
          ' aria-label="' + esc(tt("Ergebnis {0}", names)) + '"' +
          ' value="' + esc(scoreStr(g[s])) + '">' +
      "</label>";
    };
    return '<div class="mt-game" data-g="' + gi + '">' +
      '<div class="mt-game-h">' + esc(tt("Satz {0}", gi + 1)) +
        (gi > 0 ? ' <button type="button" class="btn small" data-act="delgame" data-g="' + gi + '" aria-label="' + esc(t("Satz entfernen")) + '">✕</button>' : "") +
      "</div>" +
      '<div class="mt-res-row">' +
        field("A") +
        '<span class="mt-res-colon" aria-hidden="true">:</span>' +
        field("B") +
      "</div>" +
    "</div>";
  }

  /* Per-match tournament extras — both optional, both one tap / one field.
     Compact enough to sit under the discipline row without pushing the
     score fields below the fold. Training never renders this. */
  function tournamentExtrasHtml(d) {
    if (!isTournament()) return "";
    const clubs = knownClubs();
    return '<div class="mt-trn-extras">' +
      '<label class="mt-field">' +
        '<span class="mt-label">' + esc(t("Runde")) + "</span>" +
        '<select class="mt-trn-round" aria-label="' + esc(t("Runde")) + '">' +
          '<option value=""' + (d.round ? "" : " selected") + ">" + esc(t("Keine Runde")) + "</option>" +
          ROUNDS.map(r =>
            '<option value="' + esc(r) + '"' + (d.round === r ? " selected" : "") + ">" + esc(t(r)) + "</option>"
          ).join("") +
        "</select>" +
      "</label>" +
      '<label class="mt-field">' +
        '<span class="mt-label">' + esc(t("Verein des Gegners")) + "</span>" +
        '<input type="text" class="mt-trn-club" list="mtClubList" autocomplete="off"' +
          ' placeholder="' + esc(t("optional")) + '" aria-label="' + esc(t("Verein des Gegners")) + '"' +
          ' value="' + esc(d.opponentClub || "") + '">' +
        '<datalist id="mtClubList">' +
          clubs.map(c => '<option value="' + esc(c) + '"></option>').join("") +
        "</datalist>" +
      "</label>" +
    "</div>";
  }

  function renderEditor() {
    const host = el("mtEditorPanel");
    if (!host) return;
    const d = state.draft;
    if (!d) { host.innerHTML = ""; return; }
    const specials = [
      ["normal", t("Normal")],
      ["retiredA", t("Aufgabe A")],
      ["retiredB", t("Aufgabe B")],
      ["incomplete", t("Abbruch / unvollständig")],
    ];
    const currentSpecial = d.resultType === "retired" ? "retired" + (d.retiredSide || "A") : d.resultType;
    host.innerHTML =
      '<section class="panel mt-editor">' +
        "<h2>" + esc(d.id ? t("Spiel bearbeiten") : t("Neues Spiel")) + " " + winnerBadgeHtml(d) + "</h2>" +

        '<div class="mt-opt-row">' +
          '<div class="mt-toggle" role="group" aria-label="' + esc(t("Disziplin")) + '">' +
            DISCIPLINES.map(x =>
              '<button type="button" data-act="disc" data-v="' + x[0] + '"' +
              ' aria-pressed="' + (normDiscipline(d.discipline) === x[0]) + '">' + esc(t(x[1])) + "</button>"
            ).join("") +
          "</div>" +
          '<div class="mt-toggle" role="group" aria-label="' + esc(t("Ziel")) + '">' +
            TARGETS.map(v => '<button type="button" data-act="target" data-v="' + v + '" aria-pressed="' + (d.targetScore === v) + '">' + v + "</button>").join("") +
          "</div>" +
        "</div>" +

        tournamentExtrasHtml(d) +

        '<div class="mt-sides">' + slotsHtml(d, "A") +
          '<div class="mt-vs">' + esc(t("gegen")) + "</div>" +
          slotsHtml(d, "B") + "</div>" +

        '<div class="mt-games">' +
          d.games.map((g, i) => gameHtml(d, i)).join("") +
          (d.games.length < 3 ? '<button type="button" class="btn mt-addgame" data-act="addgame">' + esc(t("+ Satz")) + "</button>" : "") +
        "</div>" +

        '<details class="mt-special"><summary>' + esc(t("Sonderfall")) + "</summary>" +
          '<div class="mt-chips">' + specials.map(s =>
            '<button type="button" class="mt-chip" data-act="special" data-v="' + s[0] + '" aria-pressed="' + (currentSpecial === s[0]) + '">' + esc(s[1]) + "</button>"
          ).join("") + "</div>" +
        "</details>" +

        '<div class="mt-sticky">' +
          '<button type="button" class="btn" data-act="cancel">' + esc(t("Abbrechen")) + "</button>" +
          '<button type="button" class="btn" data-act="saveopen">' + esc(t("Offen speichern")) + "</button>" +
          '<button type="button" class="btn primary mt-done" data-act="done">' + esc(t("Fertig ✓")) + "</button>" +
        "</div>" +
      "</section>";
  }

  /* Typing a score must not re-render the card — that would eat the caret.
     Only the derived winner badge is refreshed in place. */
  function patchWinnerBadge() {
    const d = state.draft;
    if (!d) return;
    const badge = el("mtWinBadge");
    if (!badge) return;
    const w = MT.matchWinner(d);
    badge.textContent = w ? t("Sieg " + w) : t("Kein Sieger");
    badge.className = "mt-badge " + (w ? "done" : "open");
  }

  /* Games are validated only here, never while typing.
     requireComplete=true (Fertig) additionally demands both scores per game. */
  function validateGames(d, requireComplete) {
    for (let i = 0; i < d.games.length; i++) {
      const g = d.games[i];
      const raw = [scoreStr(g.a).trim(), scoreStr(g.b).trim()];
      const blank = raw.filter(v => v === "").length;
      if (blank === 2 && !requireComplete) continue;        // untouched game, saving open
      /* a half-filled game is wrong either way; an empty one only blocks Fertig */
      if (blank > 0) return tt("Satz {0}: beide Ergebnisse eintragen", i + 1);
      for (const v of raw) {
        const n = Number(v);
        if (!/^\d+$/.test(v) || !isFinite(n) || n < 0 || n > MAX_SCORE) {
          return tt("Satz {0}: nur ganze Zahlen von 0 bis {1}", i + 1, MAX_SCORE);
        }
      }
    }
    return null;
  }

  /* ================= draft actions ================= */
  function newDraft(prefill) {
    const last = prefill && state.matches.length ? state.matches[state.matches.length - 1] : null;
    const me = meePlayer();
    const disc = last ? normDiscipline(last.discipline) : "singles";
    const d = {
      id: null,
      discipline: disc,
      targetScore: last && last.targetScore ? last.targetScore : defaultTarget(disc),
      sideA: last && last.sideA ? (last.sideA.playerIds || []).slice() : (me ? [me.id] : []),
      sideB: last && last.sideB ? (last.sideB.playerIds || []).slice() : [],
      /* empty, not 0 — the final result gets typed in, and "" must stay
         distinguishable from a real 0 for validation */
      games: [{ a: "", b: "" }],
      resultType: "normal",
      retiredSide: null,
      /* "Noch ein Spiel" keeps the round (a group stage is several matches),
         but never the opponent club — that is a different opponent by definition. */
      round: (prefill && isTournament() && last && last.round) || null,
      opponentClub: "",
    };
    /* drop players that meanwhile vanished */
    d.sideA = d.sideA.filter(id => playerById(id));
    d.sideB = d.sideB.filter(id => playerById(id));
    if (!d.sideA.length && me) d.sideA = [me.id];
    normalizeSlots(d);
    state.draft = d;
    state.activeSlot = firstEmptySlot(d);
    state.justSaved = false;
    saveDraftLocal();
    renderList();
    renderEditor();
    scrollToEditor();
  }

  function openDraftFromMatch(id) {
    const m = state.matches.find(x => x.id === id);
    if (!m) return;
    const d = {
      id: m.id,
      discipline: normDiscipline(m.discipline),
      targetScore: m.targetScore || defaultTarget(m.discipline),
      sideA: ((m.sideA && m.sideA.playerIds) || []).slice(),
      sideB: ((m.sideB && m.sideB.playerIds) || []).slice(),
      games: (m.games && m.games.length ? m.games : [{ a: "", b: "" }])
        .map(g => ({ a: scoreStr(g.a), b: scoreStr(g.b) })),
      resultType: m.resultType || "normal",
      retiredSide: m.retiredSide || null,
      round: m.round || (m.tournament && m.tournament.round) || null,
      opponentClub: m.opponentClub || (m.tournament && m.tournament.opponentClub) || "",
    };
    normalizeSlots(d);
    state.draft = d;
    state.activeSlot = firstEmptySlot(d);
    saveDraftLocal();
    renderList();
    renderEditor();
    scrollToEditor();
  }

  function scrollToEditor() {
    const p = el("mtEditorPanel");
    if (p && p.scrollIntoView) {
      try { p.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { p.scrollIntoView(); }
    }
  }

  function closeEditor(saved) {
    state.draft = null;
    state.activeSlot = null;
    state.justSaved = !!saved;
    state.pickOpen = null;
    state.pickQuery = "";
    saveDraftLocal();
    renderList();
    renderSummary();
    renderEditor();
  }

  /* Focus an input inside the freshly rendered host, if it is there. */
  function focusIn(sel, shouldFocus) {
    if (!shouldFocus || !state.host) return;
    const inp = state.host.querySelector(sel);
    if (inp && inp.focus) { try { inp.focus(); } catch (e) {} }
  }

  /* Focus exactly the slot the type-ahead was just opened on — never merely
     the first field on the card. */
  function focusOpenSlot() {
    const s = state.pickOpen;
    if (!s) return;
    focusIn('.mt-slot-input[data-side="' + s.side + '"][data-i="' + s.i + '"]', true);
  }

  /* Fills the slot the type-ahead belongs to, then hops to the next empty one
     so a doubles line-up is four taps with no reaching for a picker. */
  function assignPlayer(playerId) {
    const d = state.draft;
    const s = state.pickOpen || state.activeSlot;
    if (!d || !s) return;
    (s.side === "A" ? d.sideA : d.sideB)[s.i] = playerId;
    const next = firstEmptySlot(d);
    state.activeSlot = next;
    state.pickOpen = next;                 // open the next field straight away
    state.pickQuery = "";
    saveDraftLocal();
    renderEditor();
    focusOpenSlot();
  }

  /* Picking a suggestion — or pressing Enter on typed text. Reuses the players
     doc if one exists (roster name or free text alike), otherwise creates it
     silently. The user sees the name land in the slot either way. */
  async function pickByName(name) {
    const clean = String(name || "").trim();
    if (!clean || !state.draft || state.pickBusy) return;
    if (!(state.pickOpen || state.activeSlot)) return;
    const existing = playerByName(clean);
    if (existing) { assignPlayer(existing.id); return; }
    state.pickBusy = true;                 // a double-tap must not create twins
    try {
      const id = await MT.repo.addPlayer(clean, MT.DEFAULT_CLUB);
      state.players = state.players.concat([
        { id: id, name: clean, club: MT.DEFAULT_CLUB, active: true, isMe: false },
      ]);
      assignPlayer(id);
      toast(t("Spieler hinzugefügt"));
    } catch (err) {
      MT.toastError(err, "Speichern fehlgeschlagen");
    } finally {
      state.pickBusy = false;
    }
  }

  function buildFields(d) {
    const idsA = d.sideA.filter(Boolean), idsB = d.sideB.filter(Boolean);
    const clubs = {};
    idsA.concat(idsB).forEach(id => { const p = playerById(id); if (p) clubs[id] = p.club || MT.DEFAULT_CLUB; });
    const me = meePlayer();
    const fields = {
      discipline: d.discipline,
      targetScore: d.targetScore,
      sideA: { playerIds: idsA, playerNames: namesOf(idsA) },
      sideB: { playerIds: idsB, playerNames: namesOf(idsB) },
      playerIds: idsA.concat(idsB),
      playerClubs: clubs,
      games: d.games.map(g => ({ a: Number(g.a) || 0, b: Number(g.b) || 0 })),
      resultType: d.resultType,
      retiredSide: d.retiredSide || null,
      involvesMe: me ? idsA.concat(idsB).indexOf(me.id) >= 0 : null,
      note: "",
    };
    if (isTournament()) {
      const round = d.round || null;
      const club = String(d.opponentClub || "").trim() || null;
      const category = trnCategory() || null;
      /* flat fields: the schema reserves them and matchDoc() writes them */
      fields.round = round;
      fields.category = category;
      fields.opponentClub = club;
      /* nested object: exactly what tracker-history.js reads for its badge */
      fields.tournament = {
        name: trnName() || (state.session && state.session.tournamentName) || "",
        category: category,
        round: round,
        opponentClub: club,
      };
    }
    return fields;
  }

  async function save(finish) {
    const d = state.draft;
    if (!d) return;
    const n = slotCount(d);
    if (d.sideA.filter(Boolean).length !== n || d.sideB.filter(Boolean).length !== n) {
      toast(t("Bitte alle Spieler wählen"));
      return;
    }
    /* Fertig demands a complete result per game; "Offen speichern" only
       rejects values that are outright unusable. */
    const badScore = validateGames(d, !!finish);
    if (badScore) { toast(badScore); return; }
    if (finish && d.resultType === "normal" && !MT.deriveWinner(d.games, d.targetScore)) {
      toast(t("Kein Ergebnis — mindestens ein Satz muss entschieden sein"));
      return;
    }
    const fields = buildFields(d);
    try {
      if (d.id) {
        const patch = Object.assign({}, fields);
        if (finish) { delete patch.status; }
        else { patch.status = "in_progress"; patch.winnerSide = null; }
        await MT.repo.updateMatch(d.id, patch);
        if (finish) await MT.repo.finishMatch(d.id, fields);
      } else {
        const payload = Object.assign({}, fields, { status: finish ? "finished" : "in_progress" });
        let newId = null;
        if (state.session) {
          newId = await MT.repo.addMatch(state.session.id, payload);
        } else {
          const res = await MT.repo.createSessionWithMatch({
            type: state.type,
            date: new Date(),
            locationId: state.locationId,
            locationName: state.locationName,
            tournamentName: trnName() || null,
          }, payload);
          newId = res.matchId;
          startWatch(res.session);
        }
        /* matchDoc() in the core builds a fixed shape and drops unknown keys,
           so the denormalised `tournament` object needs its own queued write.
           Training never reaches this — fields.tournament is undefined there. */
        if (newId && fields.tournament) {
          await MT.repo.updateMatch(newId, { tournament: fields.tournament });
        }
      }
      toast(t(finish ? "Spiel gespeichert" : "Als offen gespeichert"));
      closeEditor(true);
    } catch (e) {
      MT.toastError(e, "Spiel speichern fehlgeschlagen");
    }
  }

  async function removeMatch(id) {
    if (!window.confirm(t("Wirklich löschen?"))) return;
    try {
      await MT.repo.deleteMatch(id);
      toast(t("Spiel gelöscht"));
    } catch (e) {
      MT.toastError(e, "Löschen fehlgeschlagen");
    }
  }

  /* Creates (or updates) today's tournament session and stores the day-level
     fields on it. Every match of the day then inherits name + category. */
  async function saveTournament() {
    const name = trnName();
    if (!name) {
      toast(t("Turniername eingeben"));
      const inp = state.host && state.host.querySelector(".mt-trn-name");
      if (inp) inp.focus();
      return;
    }
    try {
      const s = await MT.repo.getOrCreateTodaySession("tournament", state.locationId);
      const patch = { tournamentName: name, tournamentCategory: trnCategory() || null };
      if (state.locationId) { patch.locationId = state.locationId; patch.locationName = state.locationName; }
      await MT.repo.updateSession(s.id, patch);
      state.trnEdit = false;
      startWatch(Object.assign({}, s, patch));
      toast(t("Turnier gespeichert"));
      renderAll();
    } catch (e) {
      MT.toastError(e, "Speichern fehlgeschlagen");
    }
  }

  /* Switching mode is a full reset: separate flows, separate lists. */
  function switchType(v) {
    state.type = v === "tournament" ? "tournament" : "training";
    state.trnEdit = false;
    closeEditor(false);
    stopWatch();
    state.session = null;
    state.matches = [];
    state.summary = [];                              // the two modes never merge
    state.summaryError = false;
    renderAll();
    if (!state.loaded) return;                       // load() picks up state.type
    const wanted = state.type;
    MT.repo.findTodaySession(wanted)
      .then(s => {
        if (state.type !== wanted) return;           // toggled again meanwhile
        if (s) startWatch(s);
        renderSession();
        renderList();
        renderSummary();
      })
      .catch(err => MT.toastError(err, "Laden fehlgeschlagen"));
    loadSummary();
  }

  async function selectLocation(id) {
    const loc = state.locations.find(l => l.id === id);
    if (!loc) return;
    state.locationId = loc.id;
    state.locationName = loc.name;
    renderSession();
    if (state.session) {
      try {
        await MT.repo.updateSession(state.session.id, { locationId: loc.id, locationName: loc.name });
        toast(t("Ort gilt ab jetzt — gespeicherte Spiele behalten ihren Ort"));
      } catch (e) { MT.toastError(e, "Speichern fehlgeschlagen"); }
    }
  }

  /* ================= events ================= */
  function onClick(e) {
    if (!e.target || typeof e.target.closest !== "function") return;
    const btn = e.target.closest("[data-act]");
    if (!btn || !state.host || !state.host.contains(btn)) return;
    const act = btn.dataset.act;
    const d = state.draft;

    if (act === "type") {
      const v = btn.dataset.v;
      if (v === state.type) return;
      switchType(v);
      return;
    }
    if (act === "trnedit") { state.trnEdit = true; renderSession(); renderList(); return; }
    if (act === "trncancel") {
      state.trnEdit = false;
      hydrateTournament(state.session);              // drop unsaved edits
      renderSession(); renderList();
      return;
    }
    if (act === "addloc-toggle") {
      state.addLocOpen = !state.addLocOpen;
      renderSession();
      focusIn(".mt-add-loc input", state.addLocOpen);
      return;
    }
    if (act === "reload") { state.loaded = false; state.loadError = null; renderList(); load(); return; }
    if (act === "loc") { selectLocation(btn.dataset.id); return; }
    if (act === "newmatch") { newDraft(true); return; }
    if (act === "edit") { openDraftFromMatch(btn.dataset.id); return; }
    if (act === "del") { removeMatch(btn.dataset.id); return; }
    if (act === "player") { MT.openPlayerProfile(btn.dataset.id); return; }
    if (!d) return;

    if (act === "disc") {
      const v = normDiscipline(btn.dataset.v);
      if (v === normDiscipline(d.discipline)) return;
      const wasSingles = normDiscipline(d.discipline) === "singles";
      d.discipline = v;
      /* Doppel ⇄ Mixed keeps the pairing and the target — only the shape
         change to or from singles resets them. */
      if (wasSingles !== (v === "singles")) d.targetScore = defaultTarget(v);
      normalizeSlots(d);
      state.activeSlot = firstEmptySlot(d);
      /* the slot that was being typed into may not exist any more */
      state.pickOpen = null;
      state.pickQuery = "";
      saveDraftLocal(); renderEditor();
      return;
    }
    if (act === "target") { d.targetScore = Number(btn.dataset.v) || d.targetScore; saveDraftLocal(); renderEditor(); return; }
    if (act === "slot") {
      /* tapping a filled slot (or its ✕) clears it and reopens the field */
      const sideKey = btn.dataset.side, i = Number(btn.dataset.i);
      const arr = sideKey === "A" ? d.sideA : d.sideB;
      arr[i] = null;
      state.activeSlot = { side: sideKey, i: i };
      state.pickOpen = { side: sideKey, i: i };
      state.pickQuery = "";
      saveDraftLocal(); renderEditor();
      focusOpenSlot();
      return;
    }
    if (act === "pickname") { pickByName(btn.dataset.name); return; }
    if (act === "addgame") { if (d.games.length < 3) { d.games.push({ a: "", b: "" }); saveDraftLocal(); renderEditor(); } return; }
    if (act === "delgame") {
      const gi = Number(btn.dataset.g);
      if (gi > 0 && d.games[gi]) { d.games.splice(gi, 1); saveDraftLocal(); renderEditor(); }
      return;
    }
    if (act === "special") {
      const v = btn.dataset.v;
      if (v === "retiredA") { d.resultType = "retired"; d.retiredSide = "A"; }
      else if (v === "retiredB") { d.resultType = "retired"; d.retiredSide = "B"; }
      else if (v === "incomplete") { d.resultType = "incomplete"; d.retiredSide = null; }
      else { d.resultType = "normal"; d.retiredSide = null; }
      saveDraftLocal(); renderEditor();
      return;
    }
    if (act === "cancel") { closeEditor(false); return; }
    if (act === "done") { save(true); return; }
    if (act === "saveopen") { save(false); return; }
  }

  /* Text/select fields keep their value in state so a re-render (adding a
     venue, tapping a slot) never loses what was typed. */
  function onInput(e) {
    const el2 = e.target;
    if (!el2 || !el2.classList || !state.host || !state.host.contains(el2)) return;
    if (el2.classList.contains("mt-trn-name")) { state.trn.name = el2.value; return; }
    if (el2.classList.contains("mt-trn-cat")) { state.trn.category = el2.value; return; }
    if (!state.draft) return;
    if (el2.classList.contains("mt-slot-input")) {
      state.pickQuery = el2.value;
      patchSuggest();                                 // rows only — keeps the caret
      return;
    }
    if (el2.classList.contains("mt-num")) {
      const gi = Number(el2.dataset.g), s = el2.dataset.s;
      const g = state.draft.games[gi];
      if (!g || (s !== "a" && s !== "b")) return;
      /* stored as typed; range/format is checked on save, not per keystroke */
      g[s] = el2.value;
      saveDraftLocal();
      patchWinnerBadge();
      return;
    }
    if (el2.classList.contains("mt-trn-round")) {
      state.draft.round = ROUNDS.indexOf(el2.value) >= 0 ? el2.value : null;
      saveDraftLocal();
      return;
    }
    if (el2.classList.contains("mt-trn-club")) {
      state.draft.opponentClub = el2.value;
      saveDraftLocal();
      return;
    }
  }

  /* Focusing a slot field opens its dropdown; the list starts unfiltered so
     the people you just played with are one tap away. */
  function onFocusIn(e) {
    const el2 = e.target;
    if (!el2 || !el2.classList || !state.draft) return;
    if (!el2.classList.contains("mt-slot-input")) return;
    const side = el2.dataset.side, i = Number(el2.dataset.i);
    if (slotIsOpen(side, i)) return;
    closeSuggest();                                   // collapse any other field
    state.pickOpen = { side: side, i: i };
    state.activeSlot = state.pickOpen;
    state.pickQuery = el2.value || "";
    patchSuggest();                                   // no re-render, no lost keyboard
  }

  /* Blur closes the dropdown, but a tap on a suggestion blurs first — the
     mousedown guard below keeps focus, and the delay covers the rest. */
  function onFocusOut(e) {
    const el2 = e.target;
    if (!el2 || !el2.classList || !el2.classList.contains("mt-slot-input")) return;
    setTimeout(function () {
      if (!state.host || !state.pickOpen) return;
      const active = document.activeElement;
      if (active && state.host.contains(active) && active.classList &&
          active.classList.contains("mt-slot-input")) return;   // moved to another slot
      closeSuggest();
    }, 180);
  }

  /* Keeps the input focused when a suggestion is tapped, so the click lands
     before the blur can tear the dropdown down. */
  function onMouseDown(e) {
    if (!e.target || typeof e.target.closest !== "function") return;
    if (e.target.closest(".mt-suggest")) e.preventDefault();
  }

  function onKeyDown(e) {
    const el2 = e.target;
    if (!el2 || !el2.classList || !el2.classList.contains("mt-slot-input")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeSuggest();
      el2.blur();
      return;
    }
    if (e.key === "Enter") {
      /* Enter is the free-text add path: exact match picks it, anything else
         creates the player. */
      e.preventDefault();
      const typed = String(state.pickQuery || el2.value || "").trim();
      if (!typed) return;
      const list = suggestions(state.draft);
      const exact = list.find(c => fold(c.name) === fold(typed));
      pickByName(exact ? exact.name : typed);
    }
  }

  async function onSubmit(e) {
    if (!e.target || typeof e.target.closest !== "function") return;
    const form = e.target.closest("form");
    if (!form || !state.host || !state.host.contains(form)) return;

    if (form.classList.contains("mt-trn-form")) {
      e.preventDefault();
      const nameInp = form.querySelector(".mt-trn-name");
      const catInp = form.querySelector(".mt-trn-cat");
      if (nameInp) state.trn.name = nameInp.value;
      if (catInp) state.trn.category = catInp.value;
      await saveTournament();
      return;
    }

    if (form.classList.contains("mt-add-loc")) {
      e.preventDefault();
      const inp = form.querySelector("input");
      const name = (inp.value || "").trim();
      if (!name) { toast(t("Name eingeben")); return; }
      try {
        const id = await MT.repo.addLocation(name);
        state.locations = state.locations.concat([{ id: id, name: name, isDefault: false }]);
        inp.value = "";
        state.addLocOpen = false;               // collapse again once it landed
        await selectLocation(id);
        toast(t("Ort hinzugefügt"));
      } catch (err) { MT.toastError(err, "Speichern fehlgeschlagen"); }
      return;
    }

    /* No player quick-add form any more — the slot type-ahead is the add path
       (see pickByName), so a new name never costs a detour. */
  }

  /* ================= view registration ================= */
  MT.registerView("entry", {
    label: t("Eintrag"),
    mount: function (host) {
      state.host = host;
      /* Spec: the mode toggle lives in memory only and every mount starts on
         Training. Coming back from Turnier therefore drops its session/draft. */
      if (state.type !== "training") {
        state.type = "training";
        state.trnEdit = false;
        stopWatch();
        state.session = null;
        state.matches = [];
        state.draft = null;
        state.activeSlot = null;
        state.pickOpen = null;
        state.pickQuery = "";
        saveDraftLocal();
      }
      host.innerHTML =
        '<div class="mt-toggle mt-type" id="mtTypeToggle" role="group" aria-label="' + esc(t("Training") + " / " + t("Turnier")) + '">' +
          '<button type="button" data-act="type" data-v="training" aria-pressed="true">' + esc(t("Training")) + "</button>" +
          '<button type="button" data-act="type" data-v="tournament" aria-pressed="false">' + esc(t("Turnier")) + "</button>" +
        "</div>" +
        '<div id="mtSessionPanel"></div>' +
        '<div id="mtListPanel"></div>' +
        '<div id="mtSummaryPanel"></div>' +
        '<div id="mtEditorPanel"></div>';
      host.addEventListener("click", onClick);
      host.addEventListener("submit", onSubmit);
      host.addEventListener("input", onInput);
      host.addEventListener("focusin", onFocusIn);
      host.addEventListener("focusout", onFocusOut);
      host.addEventListener("mousedown", onMouseDown);
      host.addEventListener("keydown", onKeyDown);
      renderAll();
      if (!state.loaded) load();
      else {
        if (!state.unwatch) resyncSession();      // re-attach after a remount
        loadSummary();
      }
    },
    unmount: function () {
      stopWatch();
      if (state.host) {
        state.host.removeEventListener("click", onClick);
        state.host.removeEventListener("submit", onSubmit);
        state.host.removeEventListener("input", onInput);
        state.host.removeEventListener("focusin", onFocusIn);
        state.host.removeEventListener("focusout", onFocusOut);
        state.host.removeEventListener("mousedown", onMouseDown);
        state.host.removeEventListener("keydown", onKeyDown);
      }
      state.host = null;
    },
  });
})();
