/* ================= Match Tracker — demo mode (?demo=1) =================
   Development aid: replaces MT.repo with an in-memory copy of demo-data.json
   so every tracker view (entry, history, stats, profile) renders realistic
   data for the current and previous year without Google sign-in.

   NOTHING IS PERSISTED. Writes mutate the in-memory arrays only and are lost
   on reload. tracker-core.js additionally throws from need() in demo mode, so
   any repo method this file forgot to replace fails instead of touching
   Firestore. Loads only when the URL carries ?demo=1.
========================================================================= */
(function () {
  "use strict";
  if (typeof MT === "undefined" || !MT) return;
  if (!MT.DEMO_MODE) {
    /* Flag in the URL but the core does not know it: a cached, older
       tracker-core.js. Shout — otherwise the views silently show REAL data. */
    if (/[?&]demo=1(&|$)/.test(location.search)) {
      var msg = "Demo-Modus NICHT aktiv: alte tracker-core.js im Cache. Seite hart neu laden (Strg+Shift+R) - die Ansicht zeigt gerade echte Daten.";
      console.error("[MT demo] " + msg);
      document.addEventListener("DOMContentLoaded", function () {
        var b = document.createElement("div");
        b.setAttribute("role", "alert");
        b.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:9999;padding:.6rem 1rem;background:#b00020;color:#fff;font:600 14px/1.3 system-ui,sans-serif;text-align:center";
        b.textContent = msg;
        document.body.appendChild(b);
      });
    }
    return;
  }

  var DATA_URL = "demo-data.json";
  var DEFAULT_CLUB = MT.DEFAULT_CLUB, DEFAULT_LOCATION = MT.DEFAULT_LOCATION;
  var toDate = MT.toDate, keys = MT.keys;
  var OWNER = "demo-owner";
  var store = { players: [], locations: [], sessions: [], matches: [] };
  var watchers = [];                  // { sessionId, cb }
  var idn = 1000;

  function nextId(prefix) { return prefix + "-" + (++idn); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  /* Dates come back as ISO strings from the JSON; hand out Date objects like
     Firestore Timestamps would resolve through MT.toDate(). */
  function hydrate(doc) {
    var d = clone(doc);
    ["date", "createdAt", "updatedAt"].forEach(function (f) { if (d[f]) d[f] = toDate(d[f]); });
    return d;
  }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0); }
  function endOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
  function ms(v) { var d = toDate(v); return d ? d.getTime() : 0; }
  function byDateDesc(a, b) { return ms(b.date) - ms(a.date); }
  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function now() { return new Date().toISOString(); }

  function notify(sessionId) {
    watchers.forEach(function (w) { if (w.sessionId === sessionId) emit(w); });
  }
  function emit(w) {
    var s = find(store.sessions, w.sessionId);
    var ms_ = store.matches.filter(function (m) { return m.sessionId === w.sessionId; })
      .map(hydrate).sort(function (a, b) { return ms(a.createdAt) - ms(b.createdAt); });
    try { w.cb({ session: s ? hydrate(s) : null, matches: ms_, hasPendingWrites: false, fromCache: false }); }
    catch (e) { console.error("[MT demo] watchSession callback:", e); }
  }

  /* ---------- document builders (mirror tracker-core.js) ---------- */
  function side(raw) {
    var s = raw || {};
    return {
      playerIds: Array.isArray(s.playerIds) ? s.playerIds.filter(Boolean) : [],
      playerNames: Array.isArray(s.playerNames) ? s.playerNames.slice() : [],
    };
  }
  function sessionDoc(session, date, k) {
    return {
      id: nextId("s"), date: date.toISOString(),
      dateKey: k.dateKey, weekKey: k.weekKey, yearKey: k.yearKey,
      locationId: session.locationId || null,
      locationName: session.locationName || DEFAULT_LOCATION,
      type: session.type === "tournament" ? "tournament" : "training",
      note: session.note || "",
      tournamentName: session.tournamentName || null,
      tournamentCategory: session.tournamentCategory || null,
      tournamentDisciplines: Array.isArray(session.tournamentDisciplines) ? session.tournamentDisciplines.slice() : null,
      tournamentPartners: session.tournamentPartners || null,
      ownerUid: OWNER, createdAt: now(), updatedAt: now(),
    };
  }
  function matchDoc(match, ctx) {
    var m = match || {};
    var sideA = side(m.sideA), sideB = side(m.sideB);
    var discipline = (m.discipline === "doubles" || m.discipline === "mixed") ? m.discipline : "singles";
    var targetScore = Number(m.targetScore) || (discipline === "singles" ? 11 : 21);
    var games = (Array.isArray(m.games) ? m.games : []).map(function (g) {
      return { a: Math.max(0, Number(g && g.a) || 0), b: Math.max(0, Number(g && g.b) || 0) };
    });
    var status = m.status === "finished" ? "finished" : "in_progress";
    var resultType = ["normal", "retired", "incomplete"].indexOf(m.resultType) >= 0 ? m.resultType : "normal";
    var shape = { games: games, targetScore: targetScore, resultType: resultType, retiredSide: m.retiredSide || null };
    return {
      id: nextId("m"), sessionId: ctx.sessionId,
      date: ctx.date.toISOString(),
      dateKey: ctx.k.dateKey, weekKey: ctx.k.weekKey, yearKey: ctx.k.yearKey,
      locationName: ctx.locationName || DEFAULT_LOCATION,
      type: ctx.type === "tournament" ? "tournament" : "training",
      discipline: discipline, targetScore: targetScore,
      sideA: sideA, sideB: sideB,
      playerIds: sideA.playerIds.concat(sideB.playerIds),
      playerClubs: m.playerClubs && typeof m.playerClubs === "object" ? m.playerClubs : {},
      games: games, status: status, resultType: resultType,
      retiredSide: m.retiredSide || null,
      winnerSide: status === "finished" ? (m.winnerSide !== undefined ? m.winnerSide : MT.matchWinner(shape)) : null,
      involvesMe: m.involvesMe === undefined ? null : !!m.involvesMe,
      note: m.note || "",
      seq: m.seq === undefined ? null : m.seq,
      round: m.round || null, category: m.category || null, opponentClub: m.opponentClub || null,
      ownerUid: OWNER, createdAt: now(), updatedAt: now(),
    };
  }
  function applyPatch(doc, patch) {
    var p = Object.assign({}, patch || {});
    delete p.id; delete p.ownerUid; delete p.createdAt;
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      doc[k] = v instanceof Date ? v.toISOString() : v;
    });
    doc.updatedAt = now();
    return doc;
  }

  /* ---------- in-memory repo ---------- */
  var repo = {};

  repo.getMatches = async function (opts) {
    var o = opts || {};
    var from = toDate(o.from), to = toDate(o.to);
    var lo = from ? startOfDay(from).getTime() : -Infinity;
    var hi = to ? endOfDay(to).getTime() : Infinity;
    var list = store.matches.filter(function (m) { var t = ms(m.date); return t >= lo && t <= hi; })
      .map(hydrate).sort(byDateDesc);
    return o.limit ? list.slice(0, o.limit) : list;
  };

  repo.getMatchesForPlayer = async function (playerId) {
    return store.matches.filter(function (m) { return (m.playerIds || []).indexOf(playerId) >= 0; })
      .map(hydrate).sort(byDateDesc);
  };

  repo.watchSession = function (sessionId, cb) {
    var w = { sessionId: sessionId, cb: cb };
    watchers.push(w);
    setTimeout(function () { if (watchers.indexOf(w) >= 0) emit(w); }, 0);
    return function unsubscribe() {
      var i = watchers.indexOf(w);
      if (i >= 0) watchers.splice(i, 1);
    };
  };

  repo.listPlayers = async function () {
    return store.players.map(hydrate)
      .sort(function (a, b) { return String(a.name || "").localeCompare(String(b.name || ""), "de"); });
  };

  repo.listLocations = async function () {
    return store.locations.map(hydrate)
      .sort(function (a, b) {
        return (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0)
          || String(a.name || "").localeCompare(String(b.name || ""), "de");
      });
  };

  repo.findTodaySession = async function (type, when) {
    var k = keys(when || new Date());
    var wanted = type === "tournament" ? "tournament" : "training";
    var hit = store.sessions.filter(function (s) { return s.dateKey === k.dateKey && s.type === wanted; })[0];
    return hit ? hydrate(hit) : null;
  };

  repo.findRecentSession = async function (type, days, before) {
    var end = toDate(before) || new Date();
    var start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (Number(days) || 14));
    var lo = keys(start).dateKey, hi = keys(end).dateKey;
    var wanted = type === "tournament" ? "tournament" : "training";
    var hits = store.sessions
      .filter(function (s) { return s.type === wanted && s.dateKey >= lo && s.dateKey <= hi; })
      .sort(function (a, b) { return a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0; });
    return hits[0] ? hydrate(hits[0]) : null;
  };

  repo.getOrCreateSession = async function (type, locationId, when) {
    var date = toDate(when) || new Date();
    var existing = await repo.findTodaySession(type, date);
    if (existing) return existing;
    var loc = locationId ? find(store.locations, locationId) : null;
    var s = sessionDoc({ type: type, locationId: locationId || null, locationName: loc ? loc.name : DEFAULT_LOCATION }, date, keys(date));
    store.sessions.push(s);
    return hydrate(s);
  };
  repo.getOrCreateTodaySession = function (type, locationId) {
    return repo.getOrCreateSession(type, locationId, new Date());
  };

  repo.moveSession = async function (id, when) {
    var date = toDate(when) || new Date();
    var k = keys(date);
    var fields = { date: date, dateKey: k.dateKey, weekKey: k.weekKey, yearKey: k.yearKey };
    var s = find(store.sessions, id);
    if (s) applyPatch(s, fields);
    store.matches.forEach(function (m) { if (m.sessionId === id) applyPatch(m, fields); });
    notify(id);
    return id;
  };

  repo.createSessionWithMatch = async function (session, match) {
    var date = toDate(session && session.date) || new Date();
    var k = keys(date);
    var s = sessionDoc(session || {}, date, k);
    store.sessions.push(s);
    var m = matchDoc(match, { sessionId: s.id, date: date, k: k, type: s.type, locationName: s.locationName });
    store.matches.push(m);
    notify(s.id);
    return { sessionId: s.id, matchId: m.id, session: hydrate(s) };
  };

  repo.addMatch = async function (sessionId, match) {
    var s = find(store.sessions, sessionId);
    var date = toDate(s && s.date) || new Date();
    var m = matchDoc(match, {
      sessionId: sessionId, date: date, k: keys(date),
      type: (s && s.type) || "training",
      locationName: (s && s.locationName) || DEFAULT_LOCATION,
    });
    store.matches.push(m);
    notify(sessionId);
    return m.id;
  };

  repo.updateMatch = async function (id, patch) {
    var m = find(store.matches, id);
    if (!m) return id;
    var p = Object.assign({}, patch || {});
    if (p.sideA || p.sideB) {
      var a = side(p.sideA || m.sideA), b = side(p.sideB || m.sideB);
      if (p.sideA) p.sideA = a;
      if (p.sideB) p.sideB = b;
      p.playerIds = a.playerIds.concat(b.playerIds);
    }
    if (p.date) { var d = toDate(p.date); var k = keys(d); p.date = d; p.dateKey = k.dateKey; p.weekKey = k.weekKey; p.yearKey = k.yearKey; }
    applyPatch(m, p);
    notify(m.sessionId);
    return id;
  };

  repo.finishMatch = async function (id, data) {
    var m = find(store.matches, id);
    if (!m) return null;
    var winner = MT.matchWinner(data || m);
    applyPatch(m, { status: "finished", winnerSide: winner });
    notify(m.sessionId);
    return winner;
  };

  repo.deleteMatch = async function (id) {
    var m = find(store.matches, id);
    if (!m) return id;
    store.matches.splice(store.matches.indexOf(m), 1);
    notify(m.sessionId);
    return id;
  };

  repo.addPlayer = async function (name, club, extra) {
    var p = Object.assign({
      id: nextId("p"), name: String(name || "").trim(), club: club || DEFAULT_CLUB,
      active: true, isMe: false, ownerUid: OWNER, createdAt: now(), updatedAt: now(),
    }, extra || {});
    store.players.push(p);
    return p.id;
  };

  repo.updatePlayer = async function (id, patch) {
    var p = find(store.players, id);
    if (p) applyPatch(p, patch);
    return id;
  };

  repo.addLocation = async function (name, extra) {
    var l = Object.assign({
      id: nextId("l"), name: String(name || "").trim(), isDefault: false,
      ownerUid: OWNER, createdAt: now(), updatedAt: now(),
    }, extra || {});
    store.locations.push(l);
    return l.id;
  };

  repo.updateSession = async function (id, patch) {
    var s = find(store.sessions, id);
    if (s) { applyPatch(s, patch); notify(id); }
    return id;
  };

  /* Any repo method not listed above keeps the core implementation, which
     throws in demo mode — a loud failure beats a silent Firestore write. */
  Object.keys(repo).forEach(function (k) { MT.repo[k] = repo[k]; });

  /* ---------- load fixture, then let the views render ---------- */
  var loaded = fetch(DATA_URL, { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error(DATA_URL + ": HTTP " + r.status); return r.json(); })
    .then(function (json) {
      store.players = json.players || [];
      store.locations = json.locations || [];
      store.sessions = json.sessions || [];
      store.matches = json.matches || [];
      console.info("[MT demo] " + store.matches.length + " Spiele, " + store.sessions.length + " Sessions, " +
        store.players.length + " Spieler geladen — nichts wird gespeichert.");
      pinChip();
    })
    .catch(function (e) {
      console.error("[MT demo] Fixture konnte nicht geladen werden:", e);
      MT.toastError(e, "Demo-Daten konnten nicht geladen werden");
    });

  /* The sync chip would claim "synchronisiert"; relabel it and keep the label
     whenever the core re-renders it. */
  var CHIP_TEXT = "◌ Demo — nichts wird gespeichert";
  function pinChip() {
    var chip = document.getElementById("mtSync");
    if (!chip) { setTimeout(pinChip, 500); return; }
    function set() { if (chip.textContent !== CHIP_TEXT) { chip.className = "mt-sync pending"; chip.textContent = CHIP_TEXT; } }
    set();
    new MutationObserver(set).observe(chip, { childList: true, characterData: true, subtree: true, attributes: true });
  }

  /* Reads wait for the fixture so a view mounted before the fetch resolves
     never sees an empty store. */
  ["getMatches", "getMatchesForPlayer", "listPlayers", "listLocations", "findTodaySession"].forEach(function (k) {
    var fn = MT.repo[k];
    MT.repo[k] = function () { var args = arguments; return loaded.then(function () { return fn.apply(null, args); }); };
  });

  MT.demo = { store: store, reload: function () { return loaded; } };
})();
