/* ================= Match Tracker — Phase 2: match history =================
   Registers the "history" sub-view on the MT core (tracker-core.js).
   Owns exactly this file + tracker-history.css.

   Grouping is FLAT and switchable: Jahr | Monat | Woche | Zeitraum.
   One level of collapsible groups at the chosen granularity — no nesting.
   Group keys come from the precomputed keys written at match-creation time
   (yearKey / weekKey / dateKey); month is dateKey.slice(0,7). Dates are parsed
   from those keys for *display formatting* only, never to re-derive grouping.
========================================================================= */
(function () {
  "use strict";

  /* ---------- hard guard: without the core there is nothing to hang off ---------- */
  if (typeof MT === "undefined" || !MT || typeof MT.registerView !== "function") {
    console.warn("[tracker-history] MT core unavailable — history view not registered.");
    return;
  }

  /* ---------- i18n: German text is the key, English is the translation ---------- */
  try {
    Object.assign(EN, {
      "Verlauf": "History",
      /* mode switch */
      "Jahr": "Year",
      "Monat": "Month",
      "Woche": "Week",
      "Zeitraum": "Range",
      "Ansicht": "View",
      /* custom range */
      "von": "from",
      "bis": "to",
      "Anzeigen": "Show",
      "Von-Datum muss vor Bis-Datum liegen": "Start date must not be after end date",
      "Zeitraum wählen und Anzeigen antippen": "Pick a range and tap Show",
      "Kein Zeitraum gewählt": "No range selected",
      /* filters */
      "Einzel": "Singles",
      "Doppel": "Doubles",
      /* "GD" -> "XD" is already in app.js's EN map; do not redeclare it here */
      "Mixed": "Mixed",
      "Training": "Training",
      "Turnier": "Tournament",
      "Disziplin": "Discipline",
      "Art": "Type",
      "Filter": "Filters",
      "{0}: Alle": "{0}: All",
      "Filter zurücksetzen": "Reset filters",
      /* states */
      "Verlauf wird geladen …": "Loading history …",
      "Noch keine Spiele aufgezeichnet": "No matches recorded yet",
      "Keine Spiele für diese Filter": "No matches for these filters",
      "Keine Spiele in diesem Zeitraum": "No matches in this range",
      "Spiele konnten nicht geladen werden": "Could not load matches",
      "Stammdaten konnten nicht geladen werden": "Could not load players and venues",
      "Früher laden ({0})": "Load earlier ({0})",
      "Lade …": "Loading …",
      /* row actions */
      "Löschen": "Delete",
      "Speichern": "Save",
      "Bearbeiten": "Edit",
      "Wirklich löschen?": "Really delete?",
      "Abbrechen": "Cancel",
      "Spiel gelöscht": "Match deleted",
      "Spiel gespeichert": "Match saved",
      "Ungültige Punktzahl": "Invalid score",
      /* stats + labels */
      "ohne mich": "not me",
      "{0} ohne mich": "{0} not me",
      "KW {0} · {1}–{2}": "Week {0} · {1}–{2}",
      "KW {0}": "Week {0}",
      "{0} Spiele": "{0} matches",
      "1 Spiel": "1 match",
      "Spiel {0}": "Match {0}",
      /* identical to the entry view's reorder keys */
      "Reihenfolge ändern": "Reorder",
      "Spiel {0} nach oben": "Move match {0} up",
      "Spiel {0} nach unten": "Move match {0} down",
      "{0} % ({1})": "{0}% ({1})",
      /* identical to the entry view's keys so both tabs read the same */
      "Spiele {0}–{1}": "Matches {0}–{1}",
      "Sätze {0}–{1}": "Sets {0}–{1}",
      "S {0}–{1}": "S {0}–{1}",
      "Niederlage": "Loss",
      "Sieg links": "Win left",
      "Sieg rechts": "Win right",
      "läuft": "in progress",
      "aufgegeben": "retired",
      "Satz {0}": "Game {0}",
      "Satz hinzufügen": "Add game",
      "Letzten Satz entfernen": "Remove last game",
      "Sieg": "Win",
      "Gruppe auf- oder zuklappen": "Expand or collapse group",
      "Profil von {0} öffnen": "Open profile of {0}",
      "Kein Ergebnis": "No result",
      "Keine Sätze": "No games"
    });
  } catch (err) {
    console.warn("[tracker-history] i18n map unavailable, falling back to German.", err);
  }

  /* ---------- safe aliases for the app-wide helpers ---------- */
  var T = (typeof t === "function") ? t : function (s) { return s; };
  var TT = (typeof tt === "function") ? tt : function (tpl) {
    var s = tpl;
    for (var i = 1; i < arguments.length; i++) s = s.replace("{" + (i - 1) + "}", arguments[i]);
    return s;
  };
  var ESC = (typeof esc === "function") ? esc : function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var TOAST = (typeof toast === "function") ? toast : function () {};
  var LOCALE = (typeof DATE_LOCALE === "string" && DATE_LOCALE) ? DATE_LOCALE : "de-DE";

  var FMT_DM = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  var FMT_DAY = new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
  var FMT_ROW = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" });
  var FMT_DAYFULL = new Intl.DateTimeFormat(LOCALE, {
    weekday: "short", day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC"
  });
  var FMT_MONTH = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: "UTC" });
  var DAY_MS = 86400000;

  var MODES = ["year", "month", "week", "range"];
  var MODE_LABEL = { year: "Jahr", month: "Monat", week: "Woche", range: "Zeitraum" };

  /* ================= module state (in memory only, per page lifetime) ================= */
  var state = {
    mode: "week",         // selected grouping; survives unmount, never persisted
    matches: [],          // year-cache, flat, sorted dateKey desc
    players: [],
    locations: [],
    meId: null,
    oldestYear: null,     // oldest calendar year already fetched into the cache
    loaded: false,
    loading: false,
    loadingMore: false,
    filters: { discipline: "all", type: "all", locationId: "all", playerId: "all" },
    range: { from: "", to: "", matches: null, loading: false },
    expanded: new Set(),  // group ids, namespaced per mode: "week:2026-W36"
    defaultsDone: new Set()
  };

  var root = null;
  var listEl = null;
  var moreEl = null;
  var mountToken = 0;         // guards against async races across mount/unmount
  var editing = null;         // { id, games: [{a,b}] }
  var pendingDelete = null;   // match id armed for the second delete tap
  var pendingBtn = null;
  var pendingTimer = null;
  var dayPos = Object.create(null);   // match id -> { pos, total, day }, per render
  var dragId = null;                  // id of the row being dragged
  var dragDay = null;                 // its dateKey — drops outside it are rejected

  /* ================= date helpers (display + range plumbing) ================= */

  /** Local calendar day as a "YYYY-MM-DD" key — matches how dateKey is written. */
  function localKey(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function parseKey(k) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k || ""));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  /** Monday (UTC) of an ISO week key "YYYY-Www". Display formatting only. */
  function isoWeekMonday(weekKey) {
    var m = /^(\d{4})-W(\d{1,2})$/.exec(String(weekKey || ""));
    if (!m) return null;
    var year = +m[1], week = +m[2];
    // ISO week 1 is the week containing 4 January.
    var jan4 = new Date(Date.UTC(year, 0, 4));
    var dow = jan4.getUTCDay() || 7;                                  // Mon=1 … Sun=7
    var week1Monday = Date.UTC(year, 0, 4 - (dow - 1));
    return new Date(week1Monday + (week - 1) * 7 * DAY_MS);
  }

  function weekLabel(weekKey) {
    var m = /^(\d{4})-W(\d{1,2})$/.exec(String(weekKey || ""));
    var num = m ? String(+m[2]) : String(weekKey || "?");
    var mon = isoWeekMonday(weekKey);
    if (!mon) return TT("KW {0}", num);
    var sun = new Date(mon.getTime() + 6 * DAY_MS);
    return TT("KW {0} · {1}–{2}", num, FMT_DM.format(mon), FMT_DM.format(sun));
  }

  function monthLabel(monthKey) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ""));
    if (!m) return String(monthKey || "?");
    return FMT_MONTH.format(new Date(Date.UTC(+m[1], +m[2] - 1, 1)));
  }

  function dayLabel(dateKey) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
    if (!m) return String(dateKey || "?");
    return FMT_DAY.format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  }

  /** Day banner inside a year/month/week group — carries the year the group header omits. */
  function dayHeadLabel(dateKey) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
    if (!m) return String(dateKey || "?");
    return FMT_DAYFULL.format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  }

  function rowDate(dateKey) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
    if (!m) return String(dateKey || "");
    return FMT_ROW.format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  }

  /** Current ISO week key — used ONLY to pick the default-expanded group. */
  function currentWeekKey() {
    var now = new Date();
    var d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    var dow = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dow);              // Thursday decides the ISO year
    var isoYear = d.getUTCFullYear();
    var jan1 = Date.UTC(isoYear, 0, 1);
    var week = Math.ceil(((d.getTime() - jan1) / DAY_MS + 1) / 7);
    return isoYear + "-W" + (week < 10 ? "0" + week : String(week));
  }

  /* ================= match helpers ================= */

  function sideIds(match, side) {
    var s = side === "A" ? match.sideA : match.sideB;
    return (s && Array.isArray(s.playerIds)) ? s.playerIds : [];
  }

  function sideNames(match, side) {
    var s = side === "A" ? match.sideA : match.sideB;
    /* the core denormalises names as `playerNames`; `names` kept as legacy fallback */
    if (s && Array.isArray(s.playerNames)) return s.playerNames;
    return (s && Array.isArray(s.names)) ? s.names : [];
  }

  /** Spec default when a match has no explicit targetScore. Mirrors the entry view. */
  /* Two players a side play to 21, singles to 11. An unknown/missing discipline
     keeps the old 11 fallback rather than silently changing on malformed docs. */
  function defaultTarget(discipline) {
    return (discipline === "doubles" || discipline === "mixed") ? 21 : 11;
  }

  /* Chip text: literal for singles/doubles, the app-wide GD/XD abbreviation for mixed. */
  function discAbbr(discipline) {
    if (discipline === "singles") return "1v1";
    if (discipline === "mixed") return T("GD");
    return "2v2";
  }

  function discName(discipline) {
    if (discipline === "singles") return T("Einzel");
    if (discipline === "mixed") return T("Mixed");
    return T("Doppel");
  }

  /** Prefer the core helper so history and entry can never disagree on a game. */
  function gameWinnerOf(game, target) {
    if (typeof MT.gameWinner === "function") return MT.gameWinner(game, target);
    // Fallback mirrors core: >= target with any lead (club scoring, no deuce).
    if (!game) return null;
    var a = Number(game.a) || 0, b = Number(game.b) || 0, tg = Number(target) || 0;
    if (a >= tg && a > b) return "A";
    if (b >= tg && b > a) return "B";
    return null;
  }

  /**
   * Aggregate a group from the isMe perspective — attribution copied from the
   * entry view's tallyDay() so the same day shows the same numbers in both tabs:
   *   played  — every match in the group, mine or not
   *   notMe   — matches I was not on court for (counted in played only)
   *   w / l   — only FINISHED matches of mine that carry a winnerSide. A retired
   *             or in-progress match contributes nothing beyond `played`
   *   sw / sl — games within those same finished matches, each counted as soon as
   *             gameWinner can decide it; half-entered games are skipped
   *   decided — w + l, the honest sample size behind the win %
   */
  function aggregate(list, meId) {
    var w = 0, l = 0, sw = 0, sl = 0, notMe = 0;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var inA = sideIds(m, "A").indexOf(meId) !== -1;
      var inB = sideIds(m, "B").indexOf(meId) !== -1;
      if (!meId || (!inA && !inB)) { notMe++; continue; }   // not on court
      if (m.status !== "finished") continue;                // no W–L, no Sätze
      var mine = inA ? "A" : "B";
      if (m.winnerSide) { if (m.winnerSide === mine) w++; else l++; }
      var target = Number(m.targetScore) || defaultTarget(m.discipline);
      var games = Array.isArray(m.games) ? m.games : [];
      for (var g = 0; g < games.length; g++) {
        var gw = gameWinnerOf(games[g], target);
        if (!gw) continue;
        if (gw === mine) sw++; else sl++;
      }
    }
    return { played: list.length, w: w, l: l, sw: sw, sl: sl, notMe: notMe, decided: w + l };
  }

  /* App-wide tracker convention: wins green, losses red, separator neutral.
     Both args are integers we counted ourselves, so interpolating them is safe. */
  function winNum(n) { return '<span class="mth-w">' + n + "</span>"; }
  function lossNum(n) { return '<span class="mth-l">' + n + "</span>"; }

  function statsLine(list) {
    var s = aggregate(list, state.meId);
    var parts = [];
    parts.push(s.played === 1 ? ESC(T("1 Spiel")) : ESC(TT("{0} Spiele", s.played)));
    parts.push('<span class="mth-wl" title="' + ESC(TT("Spiele {0}–{1}", s.w, s.l)) + '">' +
      winNum(s.w) + '<span class="mth-sep">–</span>' + lossNum(s.l) + "</span>");
    if (s.sw + s.sl > 0) {
      // The template supplies the "S" prefix and the neutral dash between the numbers.
      parts.push('<span class="mth-sets" title="' + ESC(TT("Sätze {0}–{1}", s.sw, s.sl)) + '">' +
        TT("S {0}–{1}", winNum(s.sw), lossNum(s.sl)) + "</span>");
    }
    if (s.decided > 0) {
      var pct = Math.round((s.w / s.decided) * 100);
      // Win % is always shown next to the sample it is based on (small-sample honesty).
      parts.push('<span class="mth-pct' + (s.decided < 5 ? " mth-thin" : "") + '">' +
        ESC(TT("{0} % ({1})", pct, s.decided)) + "</span>");
    } else {
      parts.push('<span class="mth-pct mth-thin">—</span>');
    }
    if (s.notMe > 0) parts.push('<span class="mth-notme">' + ESC(TT("{0} ohne mich", s.notMe)) + "</span>");
    return parts.join('<span class="mth-dot">·</span>');
  }

  /**
   * Winner derived from the games. Defers to the core so an inline score edit
   * writes the same winnerSide the entry view would have written.
   */
  function deriveWinner(games, target) {
    if (typeof MT.deriveWinner === "function") return MT.deriveWinner(games, target);
    var a = 0, b = 0;
    for (var i = 0; i < games.length; i++) {
      var gw = gameWinnerOf(games[i], target);
      if (gw === "A") a++; else if (gw === "B") b++;
    }
    if (a === 0 && b === 0) return null;
    if (a === b) return null;
    return a > b ? "A" : "B";
  }

  /* ================= filtering ================= */

  function passesFilters(m) {
    var f = state.filters;
    if (f.discipline !== "all" && m.discipline !== f.discipline) return false;
    if (f.type !== "all" && m.type !== f.type) return false;
    if (f.locationId !== "all" && m.locationId !== f.locationId) return false;
    if (f.playerId !== "all") {
      var ids = Array.isArray(m.playerIds) ? m.playerIds : [];
      if (ids.indexOf(f.playerId) === -1) return false;
    }
    return true;
  }

  function filtersActive() {
    var f = state.filters;
    return f.discipline !== "all" || f.type !== "all" || f.locationId !== "all" || f.playerId !== "all";
  }

  /* ================= flat grouping ================= */

  /** Group key for one match at the active granularity. Range mode groups by day. */
  function groupKeyOf(m, mode) {
    var dk = m.dateKey || "";
    if (mode === "year") return m.yearKey || (dk.length >= 4 ? dk.slice(0, 4) : "?");
    if (mode === "month") return dk.length >= 7 ? dk.slice(0, 7) : "?";
    if (mode === "week") return m.weekKey || "?";
    return dk || "?";
  }

  function groupLabel(key, mode) {
    if (mode === "year") return key;
    if (mode === "month") return monthLabel(key);
    if (mode === "week") return weekLabel(key);
    return dayLabel(key);
  }

  /** Ordered (desc) list of { key, matches }. All key formats sort desc lexicographically. */
  function groupFlat(list, mode) {
    var map = Object.create(null), keys = [];
    for (var i = 0; i < list.length; i++) {
      var k = groupKeyOf(list[i], mode);
      if (!map[k]) { map[k] = { key: k, matches: [] }; keys.push(k); }
      map[k].matches.push(list[i]);
    }
    keys.sort(function (a, b) { return a < b ? 1 : (a > b ? -1 : 0); });
    return keys.map(function (k) { return map[k]; });
  }

  /**
   * Consecutive same-day runs inside one group body. The list is already day-sorted,
   * so a run break is simply a change of dateKey — no second pass over the data.
   */
  function dayRuns(list) {
    var runs = [], cur = null;
    for (var i = 0; i < list.length; i++) {
      var k = list[i].dateKey || "";
      if (!cur || cur.key !== k) { cur = { key: k, matches: [] }; runs.push(cur); }
      cur.matches.push(list[i]);
    }
    return runs;
  }

  function currentGroupKey(mode) {
    var now = new Date();
    if (mode === "year") return String(now.getFullYear());
    if (mode === "month") return localKey(now).slice(0, 7);
    if (mode === "week") return currentWeekKey();
    return localKey(now);
  }

  function gid(mode, key) { return mode + ":" + key; }

  /**
   * Default expansion, applied once per mode: the current period only.
   * If nothing was played in the current period, open the most recent group that
   * has matches — a blank screen after a successful load reads like a bug.
   * Range mode opens every day, since the user explicitly asked for that window.
   */
  function applyDefaultExpansion(mode, groups) {
    if (state.defaultsDone.has(mode)) return;
    state.defaultsDone.add(mode);
    if (!groups.length) return;

    if (mode === "range") {
      groups.forEach(function (g) { state.expanded.add(gid(mode, g.key)); });
      return;
    }
    var cur = currentGroupKey(mode);
    var hit = groups.some(function (g) { return g.key === cur; });
    state.expanded.add(gid(mode, hit ? cur : groups[0].key));
  }

  function isOpen(id) { return state.expanded.has(id); }

  /* ================= rendering ================= */

  function renderModes() {
    var out = ['<div class="seg-tabs mth-modes" role="tablist" aria-label="' + ESC(T("Ansicht")) + '">'];
    MODES.forEach(function (m) {
      var on = state.mode === m;
      out.push('<button type="button" role="tab" data-act="mode" data-m="' + m + '"' +
        ' aria-selected="' + (on ? "true" : "false") + '">' + ESC(T(MODE_LABEL[m])) + "</button>");
    });
    out.push("</div>");
    return out.join("");
  }

  function opt(value, text, current) {
    return '<option value="' + ESC(value) + '"' +
      (current === value ? " selected" : "") + ">" + ESC(text) + "</option>";
  }

  /**
   * One filter dropdown. The "Alle" option carries the filter's own name
   * ("Disziplin: Alle") so the closed select is self-describing without an
   * external label — there is no room for four visible labels on a phone.
   */
  function fsel(field, label, options) {
    var active = state.filters[field] !== "all";
    return '<select class="mth-fsel' + (active ? " on" : "") + '"' +
      ' data-act="sel" data-f="' + ESC(field) + '" aria-label="' + ESC(label) + '">' +
      opt("all", TT("{0}: Alle", label), state.filters[field]) + options + "</select>";
  }

  function byName(a, b) {
    return String(a.name || "").localeCompare(String(b.name || ""), LOCALE);
  }

  function renderFilters() {
    var f = state.filters;

    var disc = opt("singles", T("Einzel"), f.discipline) +
               opt("doubles", T("Doppel"), f.discipline) +
               opt("mixed", T("Mixed"), f.discipline);

    var typ = opt("training", T("Training"), f.type) +
              opt("tournament", T("Turnier"), f.type);

    var loc = state.locations.slice().sort(byName).map(function (l) {
      return opt(l.id, l.name || l.id, f.locationId);
    }).join("");

    var pl = state.players.slice().sort(byName).map(function (p) {
      return opt(p.id, p.name || p.id, f.playerId);
    }).join("");

    return '' +
      '<div class="mth-filters">' +
        '<div class="mth-selrow" role="group" aria-label="' + ESC(T("Filter")) + '">' +
          fsel("discipline", T("Disziplin"), disc) +
          fsel("type", T("Art"), typ) +
          fsel("locationId", T("Ort"), loc) +
          fsel("playerId", T("Spieler"), pl) +
        "</div>" +
        (filtersActive()
          ? '<div class="mth-resetrow">' +
              '<button type="button" class="btn mth-btn mth-reset" data-act="reset">' +
                ESC(T("Filter zurücksetzen")) + "</button>" +
            "</div>"
          : "") +
      "</div>";
  }

  function renderRangeBar() {
    if (state.mode !== "range") return "";
    return '<div class="mth-rangebar">' +
      '<label class="mth-sel">' +
        '<span class="mth-flabel">' + ESC(T("von")) + "</span>" +
        '<input type="date" data-r="from" value="' + ESC(state.range.from) + '" aria-label="' + ESC(T("von")) + '">' +
      "</label>" +
      '<label class="mth-sel">' +
        '<span class="mth-flabel">' + ESC(T("bis")) + "</span>" +
        '<input type="date" data-r="to" value="' + ESC(state.range.to) + '" aria-label="' + ESC(T("bis")) + '">' +
      "</label>" +
      '<button type="button" class="btn primary mth-btn mth-show" data-act="showrange"' +
        (state.range.loading ? " disabled" : "") + ">" +
        ESC(state.range.loading ? T("Lade …") : T("Anzeigen")) + "</button>" +
    "</div>";
  }

  function nameButtons(match, side) {
    var ids = sideIds(match, side);
    var names = sideNames(match, side);
    var out = [];
    var n = Math.max(ids.length, names.length);
    for (var i = 0; i < n; i++) {
      var nm = names[i] || "?";
      var pid = ids[i];
      if (pid) {
        out.push('<button type="button" class="mth-name" data-act="player" data-pid="' + ESC(pid) + '"' +
          ' title="' + ESC(TT("Profil von {0} öffnen", nm)) + '">' + ESC(nm) + "</button>");
      } else {
        out.push('<span class="mth-name mth-name-plain">' + ESC(nm) + "</span>");
      }
    }
    return out.join("");
  }

  function scoreText(match) {
    var games = Array.isArray(match.games) ? match.games : [];
    if (!games.length) return "";
    return games.map(function (g) { return g.a + ":" + g.b; }).join(" · ");
  }


  function renderEdit(match) {
    var games = (editing && editing.id === match.id) ? editing.games : [];
    var rows = games.map(function (g, i) {
      var lbl = TT("Satz {0}", i + 1);
      return '<div class="mth-edit-row" data-g="' + i + '">' +
        '<span class="mth-edit-lbl">' + ESC(lbl) + "</span>" +
        '<input class="mth-num" type="number" inputmode="numeric" min="0" max="99" step="1"' +
          ' data-side="a" value="' + ESC(g.a) + '" aria-label="' + ESC(lbl) + ' A">' +
        '<span class="mth-colon">:</span>' +
        '<input class="mth-num" type="number" inputmode="numeric" min="0" max="99" step="1"' +
          ' data-side="b" value="' + ESC(g.b) + '" aria-label="' + ESC(lbl) + ' B">' +
        "</div>";
    }).join("");

    return '<div class="mth-edit">' +
      '<div class="mth-edit-rows">' + (rows || '<p class="mth-muted">' + ESC(T("Keine Sätze")) + "</p>") + "</div>" +
      '<div class="mth-edit-acts">' +
        '<button type="button" class="btn mth-btn" data-act="rmgame"' + (games.length ? "" : " disabled") +
          ' title="' + ESC(T("Letzten Satz entfernen")) + '">−</button>' +
        '<button type="button" class="btn mth-btn" data-act="addgame"' + (games.length >= 5 ? " disabled" : "") +
          ' title="' + ESC(T("Satz hinzufügen")) + '">+</button>' +
        '<span class="mth-edit-spacer"></span>' +
        '<button type="button" class="btn mth-btn" data-act="cancel">' + ESC(T("Abbrechen")) + "</button>" +
        '<button type="button" class="btn primary mth-btn" data-act="save" data-id="' + ESC(match.id) + '">' +
          ESC(T("Speichern")) + "</button>" +
      "</div>" +
    "</div>";
  }

  /**
   * One team block. Win/loss colouring is purely result-based here (not isMe-based):
   * the winning side is green, the losing side red, an undecided match neutral.
   * Colour is never the only signal — each decided side carries screen-reader text
   * and a title, and the verdict caption under the score spells the result out.
   */
  function teamBlock(match, side, winner) {
    var cls = "mth-team mth-team-" + side.toLowerCase();
    var sr = "";
    if (winner === side) {
      cls += " win";
      sr = '<span class="mth-sr">' + ESC(T("Sieg")) + "</span>";
    } else if (winner) {
      cls += " lost";
      sr = '<span class="mth-sr">' + ESC(T("Niederlage")) + "</span>";
    }
    return '<div class="' + cls + '">' + sr + nameButtons(match, side) + "</div>";
  }

  /** The caption under the score: the verdict, or the live/retired badge when undecided. */
  function verdict(match) {
    if (match.winnerSide === "A" || match.winnerSide === "B") {
      var word = match.winnerSide === "A" ? T("Sieg links") : T("Sieg rechts");
      return '<span class="mth-verdict"><span aria-hidden="true">✓</span> ' + ESC(word) + "</span>";
    }
    if (match.status === "in_progress") {
      return '<span class="mth-badge mth-badge-live">' + ESC(T("läuft")) + "</span>";
    }
    if (match.status === "retired") {
      return '<span class="mth-badge mth-badge-ret">' + ESC(T("aufgegeben")) + "</span>";
    }
    return "";
  }

  function leadCol(match, showDate, canOrder) {
    var disc = discAbbr(match.discipline);
    var discLabel = discName(match.discipline);
    var venue = match.locationName || "";
    var seq = seqOf(match);
    return '<div class="mth-lead">' +
      '<div class="mth-leadtop">' +
        // Desktop drag handle; hidden on touch, where the ▲/▼ nudges are the path.
        (canOrder ? '<span class="mth-grip" aria-hidden="true" title="' + ESC(T("Reihenfolge ändern")) + '">⠿</span>' : "") +
        '<span class="mth-disc" title="' + ESC(discLabel) + '" aria-label="' + ESC(discLabel) + '">' + ESC(disc) + "</span>" +
        // Read-only reflection of the entry view's manual order; legacy docs show none.
        (seq !== null
          ? '<span class="mth-seq" title="' + ESC(TT("Spiel {0}", seq)) + '">#' + seq + "</span>"
          : "") +
      "</div>" +
      (showDate ? '<span class="mth-rowdate">' + ESC(rowDate(match.dateKey)) + "</span>" : "") +
      (venue ? '<span class="mth-loc" title="' + ESC(venue) + '">' + ESC(venue) + "</span>" : "") +
    "</div>";
  }

  /* The nudges join the actions cluster rather than the 92px lead column: that
     column is already carrying grip + chip + serial + date + venue, and two more
     44px targets would not fit without widening every row. */
  function rowActions(match, pos, canOrder) {
    var no = pos.pos + 1;
    return '<div class="mth-rowacts">' +
      (canOrder
        ? '<span class="mth-nudge">' +
            '<button type="button" class="mth-move" data-act="moveup" data-id="' + ESC(match.id) + '"' +
              (pos.pos === 0 ? " disabled" : "") +
              ' aria-label="' + ESC(TT("Spiel {0} nach oben", no)) + '">▲</button>' +
            '<button type="button" class="mth-move" data-act="movedown" data-id="' + ESC(match.id) + '"' +
              (pos.pos === pos.total - 1 ? " disabled" : "") +
              ' aria-label="' + ESC(TT("Spiel {0} nach unten", no)) + '">▼</button>' +
          "</span>"
        : "") +
      '<button type="button" class="mth-editbtn" data-act="edit" data-id="' + ESC(match.id) + '">' +
        ESC(T("Bearbeiten")) + "</button>" +
      '<button type="button" class="mth-del" data-act="del" data-id="' + ESC(match.id) + '">' +
        ESC(T("Löschen")) + "</button>" +
    "</div>";
  }

  /* Rows never carry their own date any more: the day banner above the run does. */
  function renderMatch(match) {
    var isEditing = !!(editing && editing.id === match.id);
    var score = scoreText(match);
    var pos = dayPos[match.id] || { pos: 0, total: 1, day: match.dateKey || "" };
    // A one-match day has nothing to reorder, and an open editor owns the row.
    var canOrder = reorderEnabled() && pos.total > 1 && !isEditing;

    // Editing drops the ledger grid entirely and stacks: context line, then the form.
    if (isEditing) {
      return '<article class="mth-row editing" data-mid="' + ESC(match.id) + '">' +
        '<div class="mth-editctx">' +
          leadCol(match, true, false) +
          '<div class="mth-editnames">' +
            ESC(sideNames(match, "A").join(" / ")) +
            '<span class="mth-vs-lite"> vs </span>' +
            ESC(sideNames(match, "B").join(" / ")) +
          "</div>" +
        "</div>" +
        renderEdit(match) +
      "</article>";
    }

    var trn = "";
    if (match.type === "tournament") {
      var tname = (match.tournament && match.tournament.name) ? match.tournament.name : T("Turnier");
      trn = '<span class="mth-badge mth-badge-trn" title="' + ESC(tname) + '">' + ESC(tname) + "</span>";
    }
    var cap = verdict(match);

    return '<article class="mth-row" data-mid="' + ESC(match.id) + '"' +
        ' data-day="' + ESC(pos.day) + '" data-pos="' + pos.pos + '"' +
        (canOrder ? ' draggable="true"' : "") + ">" +
      leadCol(match, false, canOrder) +
      teamBlock(match, "A", match.winnerSide) +
      '<div class="mth-score">' +
        '<div class="mth-games">' +
          (score ? ESC(score) : '<span class="mth-muted">' + ESC(T("Kein Ergebnis")) + "</span>") +
        "</div>" +
        ((cap || trn) ? '<div class="mth-cap">' + cap + trn + "</div>" : "") +
      "</div>" +
      teamBlock(match, "B", match.winnerSide) +
      rowActions(match, pos, canOrder) +
    "</article>";
  }

  function groupHeader(id, title, list) {
    var open = isOpen(id);
    return '<button type="button" class="mth-gh" data-act="toggle" data-gid="' + ESC(id) + '"' +
      ' aria-expanded="' + (open ? "true" : "false") + '"' +
      ' title="' + ESC(T("Gruppe auf- oder zuklappen")) + '">' +
      '<span class="mth-caret" aria-hidden="true">' + (open ? "▾" : "▸") + "</span>" +
      '<span class="mth-gt">' + ESC(title) + "</span>" +
      '<span class="mth-gs">' + statsLine(list) + "</span>" +
    "</button>";
  }

  /** Day banner + its matches, banded so neighbouring days read apart at a glance. */
  function renderDayRun(run, alt) {
    var n = run.matches.length;
    var out = ['<div class="mth-day' + (alt ? " mth-day-alt" : "") + '">'];
    out.push('<div class="mth-dayhead">' +
      '<span class="mth-daylabel">' + ESC(dayHeadLabel(run.key)) + "</span>" +
      '<span class="mth-daycount">' +
        ESC(n === 1 ? T("1 Spiel") : TT("{0} Spiele", n)) +
      "</span>" +
    "</div>");
    run.matches.forEach(function (m) { out.push(renderMatch(m)); });
    out.push("</div>");
    return out.join("");
  }

  function note(text) { return '<p class="empty-note">' + ESC(text) + "</p>"; }

  function renderList() {
    var mode = state.mode;
    var isRange = mode === "range";

    if (isRange) {
      if (state.range.loading) return note(T("Verlauf wird geladen …"));
      if (state.range.matches === null) return note(T("Zeitraum wählen und Anzeigen antippen"));
    } else {
      if (!state.loaded) return note(T("Verlauf wird geladen …"));
    }

    var source = isRange ? state.range.matches : state.matches;
    if (!source.length) return note(isRange ? T("Keine Spiele in diesem Zeitraum") : T("Noch keine Spiele aufgezeichnet"));

    var visible = source.filter(passesFilters);
    if (!visible.length) return note(T("Keine Spiele für diese Filter"));

    // Defaults are decided on the unfiltered set so filtering never silently
    // reopens or recloses a group the user has already toggled.
    applyDefaultExpansion(mode, groupFlat(source, mode));

    // Positions come from the UNFILTERED pool so "first/last of the day" — and
    // therefore the disabled nudges — reflect the real day, not the view.
    dayPos = buildDayPos(source);

    // Range mode already groups by day; the other modes get a day banner per run.
    var byDay = !isRange;
    var out = [];
    groupFlat(visible, mode).forEach(function (g) {
      var id = gid(mode, g.key);
      out.push('<section class="mth-group">');
      out.push(groupHeader(id, groupLabel(g.key, mode), g.matches));
      if (isOpen(id)) {
        out.push('<div class="mth-gbody">');
        if (byDay) {
          dayRuns(g.matches).forEach(function (run, i) { out.push(renderDayRun(run, i % 2 === 1)); });
        } else {
          g.matches.forEach(function (m) { out.push(renderMatch(m)); });
        }
        out.push("</div>");
      }
      out.push("</section>");
    });
    return out.join("");
  }

  function renderMore() {
    // The custom range is explicit — widening it is the date inputs' job, not this button's.
    if (state.mode === "range" || !state.loaded || state.oldestYear === null) return "";
    var prev = state.oldestYear - 1;
    return '<button type="button" class="btn mth-more-btn" data-act="more"' +
      (state.loadingMore ? " disabled" : "") + ">" +
      ESC(state.loadingMore ? T("Lade …") : TT("Früher laden ({0})", prev)) + "</button>";
  }

  /** Full re-render of everything state-dependent. Idempotent. */
  function render() {
    if (!root) return;
    if (!listEl) {
      root.innerHTML = '<div class="mth">' +
        '<div class="mth-modebar"></div>' +
        '<div class="mth-filterbar"></div>' +
        '<div class="mth-list"></div>' +
        '<div class="mth-more"></div>' +
      "</div>";
      listEl = root.querySelector(".mth-list");
      moreEl = root.querySelector(".mth-more");
      var host = root.querySelector(".mth");
      host.addEventListener("click", onClick);
      host.addEventListener("change", onChange);
      host.addEventListener("dragstart", onDragStart);
      host.addEventListener("dragend", onDragEnd);
      host.addEventListener("dragover", onDragOver);
      host.addEventListener("drop", onDrop);
    }
    root.querySelector(".mth-modebar").innerHTML = renderModes();
    root.querySelector(".mth-filterbar").innerHTML = renderRangeBar() + renderFilters();
    listEl.innerHTML = renderList();
    moreEl.innerHTML = renderMore();
    clearPending(true);
  }

  /* ================= interaction ================= */

  /* ---------- drag to reorder (desktop; touch uses the ▲/▼ nudges) ---------- */

  function rowUnder(e) {
    return (e.target && typeof e.target.closest === "function")
      ? e.target.closest("article.mth-row") : null;
  }

  function clearDropMarks() {
    if (!listEl) return;
    var marked = listEl.querySelectorAll(".drop-above,.drop-below");
    for (var i = 0; i < marked.length; i++) marked[i].classList.remove("drop-above", "drop-below");
  }

  function onDragStart(e) {
    var row = rowUnder(e);
    if (!row || !row.getAttribute("draggable")) return;
    // a drag must start on the row surface, never on one of its controls
    if (e.target.closest && e.target.closest("button")) { e.preventDefault(); return; }
    dragId = row.dataset.mid;
    dragDay = row.dataset.day;
    row.classList.add("dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", dragId); } catch (err) {}
    }
  }

  function onDragEnd() {
    dragId = null;
    dragDay = null;
    if (listEl) {
      var d = listEl.querySelectorAll(".dragging");
      for (var i = 0; i < d.length; i++) d[i].classList.remove("dragging");
    }
    clearDropMarks();
  }

  function onDragOver(e) {
    if (!dragId) return;
    var row = rowUnder(e);
    if (!row) return;
    clearDropMarks();
    // No drop affordance outside the source row's day — reordering is intra-day.
    if (row.dataset.day !== dragDay) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    var rect = row.getBoundingClientRect();
    row.classList.add(e.clientY > rect.top + rect.height / 2 ? "drop-below" : "drop-above");
  }

  function onDrop(e) {
    if (!dragId) return;
    var row = rowUnder(e);
    if (!row) return;
    e.preventDefault();
    var id = dragId, day = dragDay;
    if (row.dataset.day !== day) { onDragEnd(); return; }   // cross-day drop: no-op
    var rect = row.getBoundingClientRect();
    var pos = Number(row.dataset.pos) + (e.clientY > rect.top + rect.height / 2 ? 1 : 0);
    onDragEnd();
    dropMatch(id, day, pos);
  }

  function clearPending(skipRestore) {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    if (!skipRestore && pendingBtn && pendingBtn.isConnected) {
      pendingBtn.textContent = T("Löschen");
      pendingBtn.classList.remove("armed");
    }
    pendingBtn = null;
    pendingDelete = null;
  }

  function cssEscape(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  /** Pull typed values back into state before any re-render of the edit form. */
  function syncEditFromDom() {
    if (!editing || !listEl) return;
    var card = listEl.querySelector('.mth-row[data-mid="' + cssEscape(editing.id) + '"]');
    if (!card) return;
    var rows = card.querySelectorAll(".mth-edit-row");
    var games = [];
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i].querySelector('input[data-side="a"]');
      var b = rows[i].querySelector('input[data-side="b"]');
      games.push({ a: a ? a.value : "", b: b ? b.value : "" });
    }
    editing.games = games;
  }

  /** Keep typed range dates out of the way of re-renders. */
  function syncRangeFromDom() {
    if (!root) return;
    var f = root.querySelector('input[data-r="from"]');
    var to = root.querySelector('input[data-r="to"]');
    if (f) state.range.from = f.value || "";
    if (to) state.range.to = to.value || "";
  }

  function findMatch(id) {
    var pools = [state.matches, state.range.matches || []];
    for (var p = 0; p < pools.length; p++) {
      for (var i = 0; i < pools[p].length; i++) if (pools[p][i].id === id) return pools[p][i];
    }
    return null;
  }

  function onChange(e) {
    var el = e.target.closest ? e.target.closest('select[data-act="sel"], input[data-r]') : null;
    if (!el) return;
    if (el.tagName === "SELECT") {
      syncRangeFromDom();            // re-render redraws the range bar; keep typed dates
      state.filters[el.dataset.f] = el.value;
      render();
      return;
    }
    state.range[el.dataset.r] = el.value || "";       // no re-render: don't fight the picker
  }

  function onClick(e) {
    var btn = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!btn || btn.tagName === "SELECT" || btn.tagName === "INPUT") return;
    var act = btn.dataset.act;

    if (act !== "del") clearPending();

    if (act === "mode") {
      var m = btn.dataset.m;
      if (MODES.indexOf(m) === -1 || m === state.mode) return;
      syncEditFromDom();
      syncRangeFromDom();
      editing = null;
      state.mode = m;
      if (m === "range" && !state.range.from && !state.range.to) {
        var now = new Date();
        state.range.to = localKey(now);
        state.range.from = localKey(new Date(now.getTime() - 30 * DAY_MS));
      }
      render();
      return;
    }

    if (act === "toggle") {
      var g = btn.dataset.gid;
      if (state.expanded.has(g)) state.expanded.delete(g); else state.expanded.add(g);
      syncEditFromDom();
      syncRangeFromDom();
      render();
      return;
    }

    if (act === "reset") {
      syncRangeFromDom();
      state.filters = { discipline: "all", type: "all", locationId: "all", playerId: "all" };
      render();
      return;
    }

    if (act === "player") {
      if (typeof MT.openPlayerProfile === "function") MT.openPlayerProfile(btn.dataset.pid);
      return;
    }

    if (act === "edit") {
      var match = findMatch(btn.dataset.id);
      if (!match) return;
      var games = (Array.isArray(match.games) ? match.games : []).map(function (x) { return { a: x.a, b: x.b }; });
      if (!games.length) games.push({ a: 0, b: 0 });
      editing = { id: match.id, games: games };
      render();
      return;
    }

    if (act === "cancel") { editing = null; render(); return; }

    if (act === "addgame") {
      if (!editing) return;
      syncEditFromDom();
      if (editing.games.length < 5) editing.games.push({ a: 0, b: 0 });
      render();
      return;
    }

    if (act === "rmgame") {
      if (!editing) return;
      syncEditFromDom();
      editing.games.pop();
      render();
      return;
    }

    if (act === "moveup") { moveMatch(btn.dataset.id, -1); return; }
    if (act === "movedown") { moveMatch(btn.dataset.id, 1); return; }

    if (act === "save") { saveScores(btn.dataset.id); return; }

    if (act === "del") {
      var id = btn.dataset.id;
      if (pendingDelete !== id) {
        // Two-tap confirm: first tap arms, second deletes, 4s to change your mind.
        clearPending();
        pendingDelete = id;
        pendingBtn = btn;
        btn.textContent = T("Wirklich löschen?");
        btn.classList.add("armed");
        pendingTimer = setTimeout(function () { clearPending(); }, 4000);
        return;
      }
      clearPending();
      doDelete(id);
      return;
    }

    if (act === "showrange") { showRange(); return; }
    if (act === "more") { loadEarlier(); return; }
  }

  /* ================= repo writes ================= */

  function saveScores(id) {
    var match = findMatch(id);
    if (!match || !editing || editing.id !== id) return;
    syncEditFromDom();

    var games = [];
    for (var i = 0; i < editing.games.length; i++) {
      var a = Number(editing.games[i].a);
      var b = Number(editing.games[i].b);
      if (!isFinite(a) || !isFinite(b) || a < 0 || b < 0 || a % 1 !== 0 || b % 1 !== 0) {
        TOAST(T("Ungültige Punktzahl"));
        return;
      }
      games.push({ a: a, b: b });
    }

    var patch = { games: games };
    // winnerSide is denormalised and derived from the score — keep it in step, but
    // never invent one for a retired match, where the score does not decide the winner.
    if (match.status === "finished") {
      patch.winnerSide = deriveWinner(games, Number(match.targetScore) || defaultTarget(match.discipline));
    }

    var token = mountToken;
    Promise.resolve(MT.repo.updateMatch(id, patch)).then(function () {
      // The same doc can sit in both the year-cache and the range result.
      applyToAll(id, function (m) {
        m.games = games;
        if (Object.prototype.hasOwnProperty.call(patch, "winnerSide")) m.winnerSide = patch.winnerSide;
      });
      editing = null;
      if (token === mountToken) render();
      TOAST(T("Spiel gespeichert"));
    }).catch(function (err) {
      MT.toastError(err, "Speichern fehlgeschlagen");
    });
  }

  function applyToAll(id, fn) {
    state.matches.forEach(function (m) { if (m.id === id) fn(m); });
    if (state.range.matches) state.range.matches.forEach(function (m) { if (m.id === id) fn(m); });
  }

  function doDelete(id) {
    var token = mountToken;
    Promise.resolve(MT.repo.deleteMatch(id)).then(function () {
      var drop = function (m) { return m.id !== id; };
      state.matches = state.matches.filter(drop);
      if (state.range.matches) state.range.matches = state.range.matches.filter(drop);
      if (editing && editing.id === id) editing = null;
      if (token === mountToken) render();
      TOAST(T("Spiel gelöscht"));
    }).catch(function (err) {
      MT.toastError(err, "Löschen fehlgeschlagen");
    });
  }

  /* ================= data loading (one-time reads only, never onSnapshot) ================= */

  /**
   * Days stay newest-first, but WITHIN one day the rows follow the manual order
   * the entry view writes: numeric `seq` ascending (Spiel 1 first), then legacy
   * documents that have no seq, in the order the repo handed them over.
   * seqOf mirrors the entry view's version exactly — the `v > 0` guard is what
   * turns undefined/null/"" on legacy docs into "unnumbered" rather than 0.
   */
  function seqOf(m) {
    var v = Number(m && m.seq);
    return isFinite(v) && v > 0 ? v : null;
  }

  /* ================= manual reordering (within one day only) =================
     Same idiom as the entry view: ▲/▼ nudges are the touch path, HTML5 drag is
     the desktop convenience. A reorder renumbers that day 1..n, so the
     "numbered before unnumbered" fallback collapses for that day on first use —
     exactly what entry does. Reordering never crosses a dateKey boundary. */

  function activePool() {
    return state.mode === "range" ? (state.range.matches || []) : state.matches;
  }

  /** id -> { pos, total, day } computed per day over the UNFILTERED pool. */
  function buildDayPos(pool) {
    var byDay = Object.create(null), map = Object.create(null);
    pool.forEach(function (m) {
      var dk = m.dateKey || "";
      (byDay[dk] || (byDay[dk] = [])).push(m.id);
    });
    Object.keys(byDay).forEach(function (dk) {
      var arr = byDay[dk];
      arr.forEach(function (id, i) { map[id] = { pos: i, total: arr.length, day: dk }; });
    });
    return map;
  }

  /**
   * Reordering is offered only on an unfiltered list. With a filter on, a nudge
   * would swap the row past a hidden neighbour: the seq changes but the visible
   * position does not, which reads as a broken button. Better to withhold the
   * control than to ship a move that looks like it did nothing.
   */
  function reorderEnabled() { return !filtersActive(); }

  function dayIdsOf(dateKey) {
    return activePool()
      .filter(function (m) { return (m.dateKey || "") === dateKey; })
      .map(function (m) { return m.id; });
  }

  function resortPools() {
    state.matches = sortDesc(state.matches);
    if (state.range.matches) state.range.matches = sortDesc(state.range.matches);
  }

  /** Renumber one day 1..n; write only the docs whose number actually moved. */
  function applyOrder(ids) {
    var writes = 0;
    ids.forEach(function (id, idx) {
      var m = findMatch(id);
      if (!m) return;
      var want = idx + 1;
      if (seqOf(m) === want) return;
      applyToAll(id, function (x) { x.seq = want; });      // optimistic, both pools
      writes++;
      Promise.resolve(MT.repo.updateMatch(id, { seq: want })).catch(function (err) {
        MT.toastError(err, "Speichern fehlgeschlagen");
      });
    });
    if (writes) { resortPools(); render(); }
    return writes;
  }

  function moveMatch(id, delta) {
    if (!reorderEnabled()) return;
    var m = findMatch(id);
    if (!m) return;
    var ids = dayIdsOf(m.dateKey || "");
    var from = ids.indexOf(id);
    var to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    applyOrder(ids);
  }

  /** Drop `id` at position `pos` within `dateKey`. A different day is a no-op. */
  function dropMatch(id, dateKey, pos) {
    if (!reorderEnabled()) return;
    var m = findMatch(id);
    if (!m || (m.dateKey || "") !== dateKey) return;       // never reorder across days
    var ids = dayIdsOf(dateKey);
    var from = ids.indexOf(id);
    if (from < 0) return;
    var to = pos;
    if (to > from) to--;                                   // removing the source shifts the target
    if (to === from || to < 0 || to > ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    applyOrder(ids);
  }

  function sortDesc(list) {
    return list
      .map(function (m, i) { return { m: m, i: i, s: seqOf(m) }; })
      .sort(function (a, b) {
        var ak = a.m.dateKey || "", bk = b.m.dateKey || "";
        if (ak !== bk) return ak < bk ? 1 : -1;        // days: newest first
        if (a.s !== null && b.s !== null) return a.s - b.s || a.i - b.i;
        if (a.s !== null) return -1;                   // numbered before unnumbered
        if (b.s !== null) return 1;
        return a.i - b.i;                              // both legacy: keep incoming order
      })
      .map(function (x) { return x.m; });
  }

  function loadInitial() {
    if (state.loading || state.loaded) return Promise.resolve();
    state.loading = true;

    var now = new Date();
    var year = now.getFullYear();
    var from = new Date(year, 0, 1, 0, 0, 0, 0);
    var to = new Date(year, now.getMonth(), now.getDate(), 23, 59, 59, 999);
    var token = mountToken;

    return Promise.all([
      Promise.resolve(MT.repo.listPlayers()).catch(function (err) {
        MT.toastError(err, "Stammdaten konnten nicht geladen werden");
        return [];
      }),
      Promise.resolve(MT.repo.listLocations()).catch(function (err) {
        MT.toastError(err, "Stammdaten konnten nicht geladen werden");
        return [];
      }),
      Promise.resolve(MT.repo.getMatches({ from: from, to: to }))
    ]).then(function (res) {
      state.players = Array.isArray(res[0]) ? res[0] : [];
      state.locations = Array.isArray(res[1]) ? res[1] : [];
      var me = state.players.filter(function (p) { return p.isMe; })[0];
      state.meId = me ? me.id : null;
      state.matches = sortDesc(Array.isArray(res[2]) ? res[2] : []);
      state.oldestYear = year;
      state.loaded = true;
    }).catch(function (err) {
      MT.toastError(err, "Spiele konnten nicht geladen werden");
      state.loaded = true;                 // show the empty state, not a stuck spinner
    }).then(function () {
      state.loading = false;
      if (token === mountToken) render();
    });
  }

  function loadEarlier() {
    if (state.loadingMore || state.oldestYear === null) return;
    var year = state.oldestYear - 1;
    state.loadingMore = true;
    render();

    var from = new Date(year, 0, 1, 0, 0, 0, 0);
    var to = new Date(year, 11, 31, 23, 59, 59, 999);
    var token = mountToken;

    Promise.resolve(MT.repo.getMatches({ from: from, to: to })).then(function (older) {
      var seen = Object.create(null);
      state.matches.forEach(function (m) { seen[m.id] = true; });
      var add = (Array.isArray(older) ? older : []).filter(function (m) { return !seen[m.id]; });
      state.matches = sortDesc(state.matches.concat(add));
      state.oldestYear = year;
    }).catch(function (err) {
      MT.toastError(err, "Spiele konnten nicht geladen werden");
    }).then(function () {
      state.loadingMore = false;
      if (token === mountToken) render();
    });
  }

  function showRange() {
    syncRangeFromDom();
    var fromKey = state.range.from, toKey = state.range.to;
    var from = parseKey(fromKey), to = parseKey(toKey);
    if (!from || !to) { TOAST(T("Kein Zeitraum gewählt")); return; }
    if (fromKey > toKey) { TOAST(T("Von-Datum muss vor Bis-Datum liegen")); return; }

    state.defaultsDone.delete("range");        // a new window re-opens its days
    editing = null;

    // Cheap cache hit: the whole window already sits in the year-cache.
    var todayKey = localKey(new Date());
    if (state.loaded && state.oldestYear !== null &&
        from.getFullYear() >= state.oldestYear && toKey <= todayKey) {
      state.range.matches = state.matches.filter(function (m) {
        var dk = m.dateKey || "";
        return dk >= fromKey && dk <= toKey;
      });
      render();
      return;
    }

    state.range.loading = true;
    render();
    var token = mountToken;
    var fromD = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0);
    var toD = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);

    Promise.resolve(MT.repo.getMatches({ from: fromD, to: toD })).then(function (res) {
      state.range.matches = sortDesc(Array.isArray(res) ? res : []);
    }).catch(function (err) {
      MT.toastError(err, "Spiele konnten nicht geladen werden");
      state.range.matches = [];
    }).then(function () {
      state.range.loading = false;
      if (token === mountToken) render();
    });
  }

  /* ================= view registration ================= */

  MT.registerView("history", {
    label: T("Verlauf"),

    mount: function (containerEl) {
      mountToken++;
      var token = mountToken;
      root = containerEl;
      listEl = null;
      moreEl = null;
      editing = null;
      clearPending(true);

      Promise.resolve(MT.ready).then(function () {
        if (token !== mountToken) return;                 // unmounted while awaiting
        if (!MT.isOwner()) { containerEl.innerHTML = ""; root = null; return; }
        containerEl.innerHTML = "";
        render();                                          // shell + loading state
        return loadInitial();
      }).catch(function (err) {
        console.warn("[tracker-history] mount failed", err);
      });
    },

    unmount: function () {
      mountToken++;
      syncRangeFromDom();
      clearPending(true);
      editing = null;
      if (root) root.innerHTML = "";
      root = null;
      listEl = null;
      moreEl = null;
      // mode / filters / expanded / matches deliberately survive: in-memory session state.
    }
  });
})();
