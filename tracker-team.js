/* ================= Match Tracker — Mannschaft 4 (Termine-Spieler) =================
 * Owner-only editor for the names in the Termine availability table: the
 * Realtime Database list avail/players, shared live with the Team 4 app.
 * Add a player from the licence list (Spielerliste) or the BWBV ranking,
 * remove one, move one up or down. The database rules bind these writes to
 * the owner's uid, so the view sits behind the tracker's Google sign-in like
 * every other tracker view. Removing a name keeps its marks in the database
 * — they merely stop being shown — so an undo is one add away. A player's
 * gender (for the Herren/Damen counters) is written next to the list under
 * avail/gender/{nameKey}; the ranking in app.js stays the fallback. The
 * Ersatz toggle marks a replacement player (avail/role/{nameKey} = "sub"):
 * both apps list them behind a divider and count their ✓ as "+n" beside
 * the Herren/Damen minimum instead of inside it.
 * Reached from the checklist button in the tracker top bar.
 */
"use strict";

Object.assign(EN, {
  "Mannschaft 4": "Team 4",
  "Spieler der Termine-Tabelle — gilt sofort hier und in der Team-4-App.":
    "Players of the availability table — applies at once here and in the Team 4 app.",
  "{0} Spieler · {1} Herren · {2} Damen": "{0} players · {1} men · {2} women",
  "Noch keine Spieler in der Liste.": "No players in the list yet.",
  "Spieler hinzufügen": "Add player",
  "Aus der Spielerliste und der Rangliste; ein Tipp fügt hinzu.": "From the licence list and the ranking; one tap adds.",
  "Alle passenden Spieler stehen schon in der Liste.": "Every matching player is already in the list.",
  "{0} weitere — Suche eingrenzen": "{0} more — narrow the search",
  "{0} hinzugefügt": "{0} added",
  "{0} entfernt": "{0} removed",
  "Ersatz": "Sub",
  "{0} Ersatz": "{0} subs",
  "Als Ersatzspieler markieren": "Mark as replacement player",
  "Als Stammspieler markieren": "Mark as regular player",
  "{0} ist Ersatzspieler": "{0} is a replacement player",
  "{0} ist Stammspieler": "{0} is a regular player",
  "Nach oben": "Move up",
  "Nach unten": "Move down",
  "Entfernen": "Remove",
  "Keine Verbindung zur Datenbank": "No database connection",
  "Liste nicht ladbar ({0})": "List could not be loaded ({0})",
  "Speichern fehlgeschlagen — nur der Besitzer darf die Liste ändern":
    "Save failed — only the owner may change the list",
});

(function () {
  if (typeof MT === "undefined") return;

  const HITS_MAX = 20;

  const state = {
    host: null,
    ref: null,            // Realtime Database ref "avail"
    onValue: null,
    players: [],
    gender: {},           // nameKey → "m" | "f", as stored under avail/gender
    role: {},             // nameKey → "sub" for replacement players (avail/role)
    loaded: false,
    error: "",
    roster: [],           // the licence list from Firestore
    qRaw: "",
    q: "",                // search text, folded
    busy: false,
  };

  /* Names as database keys: forbidden characters replaced — same as app.js */
  function avKey(name) { return String(name).replace(/[.#$/\[\]]/g, "_"); }

  /* Case- and diacritic-insensitive fold — "muller" finds "Müller". */
  function fold(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/ß/g, "ss")
      .normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function isSub(name) { return state.role[avKey(name)] === "sub"; }

  function genderOf(name) {
    const g = state.gender[avKey(name)];
    if (g === "m" || g === "f") return g;
    const r = (window.LU_ROSTER_MAP || {})[name];
    return r === "m" || r === "f" ? r : "";
  }

  function badge(g) {
    if (g !== "m" && g !== "f") return "";
    return ' <span class="mt-badge mtt-g ' + g + '">' + esc(t(g === "f" ? "Damen" : "Herren")) + "</span>";
  }

  /* Everyone who could be added: licence list plus ranking, one entry per
     name, minus the names already listed. */
  function candidates() {
    const listed = new Set(state.players);
    const seen = new Map();
    state.roster.forEach(p => { if (p && typeof p.name === "string" && p.name) seen.set(p.name, p.sex === "w" ? "f" : "m"); });
    Object.entries(window.LU_ROSTER_MAP || {}).forEach(([n, g]) => { if (!seen.has(n)) seen.set(n, g); });
    return [...seen.entries()]
      .filter(([n]) => !listed.has(n))
      .sort((a, b) => a[0].localeCompare(b[0], DATE_LOCALE))
      .map(([name, g]) => ({ name: name, g: g }));
  }

  function iconBtn(act, name, sym, label, disabled) {
    return '<button type="button" class="btn mt-icon-btn mtt-btn" data-act="' + act + '" data-name="' + esc(name) + '"' +
      ' aria-label="' + esc(label) + '" title="' + esc(label) + '"' + (disabled || state.busy ? " disabled" : "") + ">" + sym + "</button>";
  }

  function rowHtml(name, i) {
    const last = state.players.length - 1;
    const sub = isSub(name);
    return '<li class="mtt-row' + (sub ? " sub" : "") + '">' +
      '<span class="mtt-n">' + (i + 1) + "</span>" +
      '<span class="mtt-name">' + esc(name) + badge(genderOf(name)) +
        (sub ? ' <span class="mt-badge mtt-g">' + esc(t("Ersatz")) + "</span>" : "") + "</span>" +
      '<span class="mtt-actions">' +
        '<button type="button" class="btn small mtt-sub' + (sub ? " on" : "") + '" data-act="sub" data-name="' + esc(name) + '"' +
          ' aria-pressed="' + sub + '" aria-label="' + esc(t(sub ? "Als Stammspieler markieren" : "Als Ersatzspieler markieren")) + '"' +
          ' title="' + esc(t(sub ? "Als Stammspieler markieren" : "Als Ersatzspieler markieren")) + '"' + (state.busy ? " disabled" : "") + ">" +
          esc(t("Ersatz")) + "</button>" +
        iconBtn("up", name, "▲", t("Nach oben"), i === 0) +
        iconBtn("down", name, "▼", t("Nach unten"), i === last) +
        iconBtn("remove", name, "✕", t("Entfernen"), false) +
      "</span>" +
    "</li>";
  }

  function renderList() {
    const box = state.host && state.host.querySelector("#mttList");
    if (!box) return;
    let body;
    if (!state.loaded) body = '<p class="mt-muted">' + esc(t("Laden …")) + "</p>";
    else if (state.error) body = '<p class="mt-muted">' + esc(state.error) + "</p>";
    else if (!state.players.length) body = '<p class="mt-muted">' + esc(t("Noch keine Spieler in der Liste.")) + "</p>";
    else body = '<ol class="mtt-list">' + state.players.map(rowHtml).join("") + "</ol>";
    const m = state.players.filter(n => genderOf(n) === "m").length;
    const f = state.players.filter(n => genderOf(n) === "f").length;
    const subs = state.players.filter(isSub).length;
    box.innerHTML = '<section class="panel mt-card">' +
      '<p class="mt-sess-meta">' + esc(tt("{0} Spieler · {1} Herren · {2} Damen", state.players.length, m, f) +
        (subs ? " · " + tt("{0} Ersatz", subs) : "")) + "</p>" +
      body + "</section>";
  }

  /* Hits only — the search field keeps its focus and caret. */
  function renderHits() {
    const box = state.host && state.host.querySelector("#mttHits");
    if (!box) return;
    const all = candidates();
    const q = state.q;
    const hits = q ? all.filter(c => fold(c.name).indexOf(q) >= 0) : all;
    if (!hits.length) {
      box.innerHTML = '<p class="mt-muted">' + esc(t(q ? "Keine Treffer" : "Alle passenden Spieler stehen schon in der Liste.")) + "</p>";
      return;
    }
    box.innerHTML = '<ul class="mtt-hits">' + hits.slice(0, HITS_MAX).map(c =>
      '<li><button type="button" class="btn small mtt-hit" data-act="add" data-name="' + esc(c.name) + '" data-g="' + c.g + '"' +
        (state.busy ? " disabled" : "") + ">" + esc(c.name) + badge(c.g) + "</button></li>").join("") + "</ul>" +
      (hits.length > HITS_MAX ? '<p class="mt-muted">' + esc(tt("{0} weitere — Suche eingrenzen", hits.length - HITS_MAX)) + "</p>" : "");
  }

  function render() {
    const host = state.host;
    if (!host) return;
    host.innerHTML =
      '<section class="panel mt-card mtv-panel">' +
        '<div class="mt-trn-head">' +
          "<h2>" + esc(t("Mannschaft 4")) + "</h2>" +
          '<button type="button" class="btn small" data-act="back">' + esc(t("Zurück")) + "</button>" +
        "</div>" +
        '<p class="mt-sess-meta">' + esc(t("Spieler der Termine-Tabelle — gilt sofort hier und in der Team-4-App.")) + "</p>" +
      "</section>" +
      '<div id="mttList"></div>' +
      '<section class="panel mt-card mtt-add">' +
        "<h3>" + esc(t("Spieler hinzufügen")) + "</h3>" +
        '<p class="mt-muted">' + esc(t("Aus der Spielerliste und der Rangliste; ein Tipp fügt hinzu.")) + "</p>" +
        '<input type="search" class="mtr-search mtt-search" placeholder="' + esc(t("Name suchen…")) + '"' +
          ' aria-label="' + esc(t("Name suchen…")) + '" autocomplete="off" value="' + esc(state.qRaw) + '">' +
        '<div id="mttHits"></div>' +
      "</section>";
    renderList();
    renderHits();
  }

  /* ---- database ---- */
  async function connect() {
    const db = window.fbReady ? await window.fbReady : null;
    if (!state.host) return;                       // unmounted while waiting
    if (!db) {
      state.loaded = true;
      state.error = t("Keine Verbindung zur Datenbank");
      renderList();
      return;
    }
    state.ref = db.ref("avail");
    state.onValue = snap => {
      const v = snap.val() || {};
      state.players = Array.isArray(v.players) ? v.players.filter(n => typeof n === "string") : [];
      state.gender = v.gender && typeof v.gender === "object" ? v.gender : {};
      state.role = v.role && typeof v.role === "object" ? v.role : {};
      state.loaded = true;
      state.error = "";
      renderList();
      renderHits();
    };
    state.ref.on("value", state.onValue, err => {
      console.error("[MT team] listener cancelled:", err);
      state.loaded = true;
      state.error = tt("Liste nicht ladbar ({0})", (err && err.code) || String(err));
      renderList();
    });
  }

  function disconnect() {
    if (state.ref && state.onValue) {
      try { state.ref.off("value", state.onValue); } catch (e) {}
    }
    state.ref = null;
    state.onValue = null;
  }

  async function loadRoster() {
    try {
      const res = await MT.repo.listRoster();
      state.roster = res && Array.isArray(res.players) ? res.players : [];
    } catch (e) {
      console.warn("[MT team] Spielerliste nicht ladbar:", e && e.code ? e.code : e);
      state.roster = [];
    }
    renderHits();
  }

  /* One multi-path update: the list plus gender and role patches (null deletes). */
  async function write(players, genderPatch, rolePatch) {
    if (!state.ref) { toast(t("Keine Verbindung zur Datenbank")); throw new Error("no db"); }
    const upd = { players: players };
    Object.keys(genderPatch || {}).forEach(k => { upd["gender/" + k] = genderPatch[k]; });
    Object.keys(rolePatch || {}).forEach(k => { upd["role/" + k] = rolePatch[k]; });
    state.busy = true;
    renderList();
    renderHits();
    try {
      await state.ref.update(upd);
    } catch (e) {
      console.error("[MT team] write:", e);
      toast(t("Speichern fehlgeschlagen — nur der Besitzer darf die Liste ändern"));
      throw e;
    } finally {
      state.busy = false;
      renderList();
      renderHits();
    }
  }

  async function add(name, g) {
    if (!name || state.players.includes(name) || state.busy) return;
    const patch = {};
    if (g === "m" || g === "f") patch[avKey(name)] = g;
    try {
      await write(state.players.concat([name]), patch);
      toast(tt("{0} hinzugefügt", name));
      state.qRaw = "";
      state.q = "";
      const inp = state.host && state.host.querySelector(".mtt-search");
      if (inp) inp.value = "";
      renderHits();
    } catch (e) {}
  }

  async function remove(name) {
    if (!state.players.includes(name) || state.busy) return;
    const k = avKey(name);
    const clear = {}; clear[k] = null;
    try {
      await write(state.players.filter(n => n !== name), clear, clear);
      toast(tt("{0} entfernt", name));
    } catch (e) {}
  }

  async function toggleSub(name) {
    if (!state.players.includes(name) || state.busy) return;
    const makeSub = !isSub(name);
    const patch = {}; patch[avKey(name)] = makeSub ? "sub" : null;
    try {
      await write(state.players, null, patch);
      toast(tt(makeSub ? "{0} ist Ersatzspieler" : "{0} ist Stammspieler", name));
    } catch (e) {}
  }

  async function move(name, dir) {
    const i = state.players.indexOf(name);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= state.players.length || state.busy) return;
    const p = state.players.slice();
    p[i] = state.players[j];
    p[j] = state.players[i];
    try { await write(p); } catch (e) {}
  }

  /* ---- events ---- */
  function onClick(e) {
    if (!e.target || typeof e.target.closest !== "function" || !state.host) return;
    const btn = e.target.closest("[data-act]");
    if (!btn || !state.host.contains(btn)) return;
    const act = btn.dataset.act;
    const name = btn.dataset.name || "";
    if (act === "back") { MT.showView("entry"); return; }
    if (act === "add") { add(name, btn.dataset.g); return; }
    if (act === "remove") { remove(name); return; }
    if (act === "sub") { toggleSub(name); return; }
    if (act === "up") { move(name, -1); return; }
    if (act === "down") { move(name, 1); return; }
  }

  function onInput(e) {
    const el = e.target;
    if (!el || !el.classList || !el.classList.contains("mtt-search")) return;
    state.qRaw = el.value;
    state.q = fold(el.value).trim();
    renderHits();
  }

  MT.registerView("team", {
    label: t("Mannschaft 4"),
    hidden: true,                      // reached from the top bar button, not the sub-tabs
    mount: function (host) {
      state.host = host;
      state.qRaw = "";
      state.q = "";
      state.loaded = false;
      state.error = "";
      host.addEventListener("click", onClick);
      host.addEventListener("input", onInput);
      render();
      connect();
      loadRoster();
    },
    unmount: function () {
      disconnect();
      if (state.host) {
        state.host.removeEventListener("click", onClick);
        state.host.removeEventListener("input", onInput);
      }
      state.host = null;
    },
  });
})();
