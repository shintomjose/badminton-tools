/* ============================================================================
 * tracker-profile.js — Match Tracker Phase 5: player profile overlay
 *
 * Owns exactly one global side effect: it overrides MT.openPlayerProfile with
 * the real implementation (tracker-core.js ships a stub). Everything else in
 * this file is private to the IIFE.
 *
 * Contract used (see tracker-core.js):
 *   MT.ready                          -> Promise<{ db, user|null }>
 *   MT.isOwner()                      -> boolean
 *   MT.repo.getMatchesForPlayer(id)   -> Promise<match[]>  (date desc)
 *   MT.repo.listPlayers()             -> [{id,name,club,active,isMe}]
 *   MT.repo.updatePlayer(id, patch)   -> Promise<void>
 *   MT.toastError(err, germanMsg)
 * ========================================================================== */
(function () {
  "use strict";

  if (typeof MT === "undefined" || !MT) {
    console.warn("[tracker-profile] MT is not available — player profile overlay disabled.");
    return;
  }

  /* ------------------------------------------------------------------ i18n */
  /* German text is the key (repo convention); English values go into EN. */
  var STRINGS = {
    "Spielerprofil": "Player profile",
    "Profil von {0}": "Profile of {0}",
    "Profil schließen": "Close profile",
    "Zurück zum vorherigen Spieler": "Back to previous player",
    "Neu laden": "Reload",
    "Name & Verein bearbeiten": "Edit name & club",
    "Verein": "Club",
    "kein Verein": "no club",
    "Abbrechen": "Cancel",
    "Speichern": "Save",
    "Name darf nicht leer sein": "Name must not be empty",
    "Profil gespeichert": "Profile saved",
    "Profil konnte nicht gespeichert werden": "Profile could not be saved",
    "Ich": "Me",
    "Inaktiv": "Inactive",
    "Lade Spiele…": "Loading matches…",
    "Spiele konnten nicht geladen werden": "Matches could not be loaded",
    "Erneut versuchen": "Try again",
    "Keine Spiele mit diesem Spieler": "No matches with this player",
    "Spieler nicht gefunden": "Player not found",
    "Unbekannter Spieler": "Unknown player",
    "Nicht angemeldet — Profil nicht verfügbar": "Not signed in — profile unavailable",
    "Bilanz": "Record",
    "Turnier": "Tournament",
    "Einzel": "Singles",
    "Doppel": "Doubles",
    "Gesamt": "Total",
    "Keine gewerteten Spiele": "No counted matches",
    "Laufende und abgebrochene Spiele zählen nicht in die Bilanz.":
      "In-progress and retired matches are not counted in the record.",
    "Kopf-an-Kopf": "Head to head",
    "Gegen mich": "Against me",
    "Als Partner": "As partner",
    "Noch keine gemeinsamen Spiele": "No matches together yet",
    "Spielverlauf": "Match history",
    "{0} % ({1})": "{0}% ({1})",
    "Kleine Stichprobe — nur {0} Spiele": "Small sample — only {0} matches",
    "läuft": "in progress",
    "abgebrochen": "retired",
    "Sieg": "Win",
    "Niederlage": "Loss",
    "{0} Siege, {1} Niederlagen": "{0} wins, {1} losses",
    "S–N": "W–L",
    "Spiele": "Matches",
  };

  try {
    /* EN is a top-level `const` in app.js — reachable by bare name once that
       script has run. Guarded so a bad script order degrades to German only. */
    if (typeof EN === "object" && EN) Object.assign(EN, STRINGS);
    else console.warn("[tracker-profile] EN map missing — English strings not registered.");
  } catch (err) {
    console.warn("[tracker-profile] could not register English strings:", err);
  }

  /* Thin, late-bound wrappers so load order can never throw on a missing global. */
  function T(s) { return typeof t === "function" ? t(s) : s; }
  function TT() {
    if (typeof tt === "function") return tt.apply(null, arguments);
    var s = arguments[0];
    for (var i = 1; i < arguments.length; i++) s = s.replace("{" + (i - 1) + "}", arguments[i]);
    return s;
  }
  function E(s) {
    if (typeof esc === "function") return esc(s);
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function notify(msg) { if (typeof toast === "function") toast(msg); }

  var dateFmt = null;
  function fmtDate(value) {
    var d = toDate(value);
    if (!d) return "—";
    if (!dateFmt) {
      var loc;
      try { loc = typeof DATE_LOCALE === "string" ? DATE_LOCALE : undefined; } catch (e) { loc = undefined; }
      dateFmt = new Intl.DateTimeFormat(loc, { day: "2-digit", month: "2-digit", year: "2-digit" });
    }
    return dateFmt.format(d);
  }

  /* Firestore Timestamp | Date | {seconds} | ISO string -> Date | null */
  function toDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") { try { return value.toDate(); } catch (e) { return null; } }
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  /* ----------------------------------------------------------------- cache */
  /* Page-lifetime caches. Both are promise caches so concurrent opens of the
     same player share one request; a rejected promise is evicted so that the
     inline retry button actually retries. */
  var matchCache = new Map();   // playerId -> Promise<match[]>
  var playersPromise = null;    // Promise<player[]>

  function getPlayers(force) {
    if (force || !playersPromise) {
      playersPromise = Promise.resolve()
        .then(function () { return MT.repo.listPlayers(); })
        .then(function (list) { return Array.isArray(list) ? list : []; })
        .catch(function (err) { playersPromise = null; throw err; });
    }
    return playersPromise;
  }

  function getMatches(playerId, force) {
    if (force) matchCache.delete(playerId);
    var p = matchCache.get(playerId);
    if (!p) {
      p = Promise.resolve()
        .then(function () { return MT.repo.getMatchesForPlayer(playerId); })
        .then(function (list) { return Array.isArray(list) ? list : []; })
        .catch(function (err) { matchCache.delete(playerId); throw err; });
      matchCache.set(playerId, p);
    }
    return p;
  }

  /* ------------------------------------------------------------------- DOM */
  var root = null, sheet = null, headEl = null, titleEl = null, bodyEl = null;
  var backBtn = null, refreshBtn = null, closeBtn = null;

  var isOpen = false;
  var currentId = null;
  var navStack = [];            // previously viewed ids, for the ← button
  var returnFocus = null;       // element focus came from
  var loadToken = 0;            // guards against out-of-order async renders
  var prevBodyOverflow = "";

  function build() {
    if (root) return;
    root = document.createElement("div");
    root.className = "mtp-root";
    root.hidden = true;
    root.innerHTML =
      '<div class="mtp-backdrop" data-mtp-dismiss="1"></div>' +
      '<div class="mtp-sheet" role="dialog" aria-modal="true" aria-label="' + E(T("Spielerprofil")) + '">' +
        '<header class="mtp-head">' +
          '<button type="button" class="mtp-icon mtp-back" hidden></button>' +
          '<h2 class="mtp-title"></h2>' +
          '<button type="button" class="mtp-icon mtp-refresh"></button>' +
          '<button type="button" class="mtp-icon mtp-close"></button>' +
        '</header>' +
        '<div class="mtp-body"></div>' +
      '</div>';
    document.body.appendChild(root);

    sheet = root.querySelector(".mtp-sheet");
    headEl = root.querySelector(".mtp-head");
    titleEl = root.querySelector(".mtp-title");
    bodyEl = root.querySelector(".mtp-body");
    backBtn = root.querySelector(".mtp-back");
    refreshBtn = root.querySelector(".mtp-refresh");
    closeBtn = root.querySelector(".mtp-close");

    backBtn.textContent = "←";
    refreshBtn.textContent = "⟳";
    closeBtn.textContent = "✕";
    backBtn.setAttribute("aria-label", T("Zurück zum vorherigen Spieler"));
    backBtn.title = T("Zurück zum vorherigen Spieler");
    refreshBtn.setAttribute("aria-label", T("Neu laden"));
    refreshBtn.title = T("Neu laden");
    closeBtn.setAttribute("aria-label", T("Profil schließen"));
    closeBtn.title = T("Profil schließen");

    closeBtn.addEventListener("click", close);
    backBtn.addEventListener("click", goBack);
    refreshBtn.addEventListener("click", function () {
      if (currentId) load(currentId, true);
    });

    /* One delegated handler for everything rendered into the body. */
    root.addEventListener("click", onRootClick);
    /* Keydown sits on document, not on root: Esc must still close even if
       focus has drifted outside the sheet (browser chrome, dev tools, …). */
  }

  function onRootClick(ev) {
    if (ev.target && ev.target.getAttribute && ev.target.getAttribute("data-mtp-dismiss")) {
      close();
      return;
    }
    var el = ev.target.closest ? ev.target.closest("[data-pid],[data-mtp-act]") : null;
    if (!el || !root.contains(el)) return;

    var act = el.getAttribute("data-mtp-act");
    if (act === "retry") { if (currentId) load(currentId, true); return; }
    if (act === "edit") { startEdit(); return; }
    if (act === "cancel-edit") { renderCurrent(); return; }
    if (act === "save-edit") { saveEdit(el); return; }

    var pid = el.getAttribute("data-pid");
    if (pid) {
      ev.preventDefault();
      /* Re-open through the public entry point so the overlay switches in
         place instead of stacking a second one. */
      MT.openPlayerProfile(pid);
    }
  }

  function onDocKeydown(ev) {
    if (!isOpen) return;
    if (ev.key === "Escape") {
      ev.stopPropagation();
      ev.preventDefault();
      close();
      return;
    }
    if (ev.key !== "Tab") return;
    var items = focusables();
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    var active = document.activeElement;
    if (!sheet.contains(active)) { ev.preventDefault(); first.focus(); return; }
    if (ev.shiftKey && active === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && active === last) { ev.preventDefault(); first.focus(); }
  }

  function focusables() {
    return Array.prototype.filter.call(
      sheet.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
      function (el) { return el.offsetParent !== null || el === document.activeElement; }
    );
  }

  /* --------------------------------------------------------- open / close */
  function open(playerId) {
    build();
    if (isOpen) {
      if (playerId !== currentId) navStack.push(currentId);
    } else {
      navStack = [];
      returnFocus = document.activeElement;
      isOpen = true;
      root.hidden = false;
      document.addEventListener("keydown", onDocKeydown, true);
      /* Force a frame so the slide-up transition actually runs. */
      requestAnimationFrame(function () { root.classList.add("mtp-open"); });
      prevBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    load(playerId, false);
    /* Focus lands on close: reachable with a thumb, and Shift+Tab reaches the
       rest of the header immediately. */
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    loadToken++;                       // abandon any in-flight render
    document.removeEventListener("keydown", onDocKeydown, true);
    root.classList.remove("mtp-open");
    root.hidden = true;
    document.body.style.overflow = prevBodyOverflow;
    currentId = null;
    navStack = [];
    bodyEl.innerHTML = "";
    if (returnFocus && document.contains(returnFocus) && typeof returnFocus.focus === "function") {
      returnFocus.focus();
    }
    returnFocus = null;
  }

  function goBack() {
    var prev = navStack.pop();
    if (!prev) { close(); return; }
    load(prev, false);
  }

  function syncBackBtn() {
    backBtn.hidden = navStack.length === 0;
  }

  /* ------------------------------------------------------------- data load */
  var lastRender = null;  // { playerId, player, matches, me } for re-renders

  function load(playerId, force) {
    if (!playerId) { close(); return; }
    var token = ++loadToken;
    currentId = playerId;
    lastRender = null;
    syncBackBtn();
    setTitle(T("Spielerprofil"));
    renderLoading();

    Promise.resolve(MT.ready)
      .then(function () {
        if (token !== loadToken) return null;
        if (typeof MT.isOwner === "function" && !MT.isOwner()) {
          renderNotice(T("Nicht angemeldet — Profil nicht verfügbar"));
          return null;
        }
        return Promise.all([getPlayers(force), getMatches(playerId, force)]);
      })
      .then(function (res) {
        if (!res || token !== loadToken) return;
        renderProfile(playerId, res[0], res[1]);
      })
      .catch(function (err) {
        if (token !== loadToken) return;
        if (typeof MT.toastError === "function") {
          /* Core owns the translation of this message (param is `germanMsg`). */
          MT.toastError(err, "Spiele konnten nicht geladen werden");
        } else {
          console.error("[tracker-profile]", err);
        }
        renderError();
      });
  }

  function setTitle(name) {
    titleEl.textContent = name;
    sheet.setAttribute("aria-label", TT("Profil von {0}", name));
  }

  /* ------------------------------------------------------------ stats math */
  /* Which side is this player on? Prefers the flat side arrays, falls back to
     the denormalised playerIds array only for sanity checks. */
  function sideOf(match, playerId) {
    var a = match && match.sideA && match.sideA.playerIds;
    var b = match && match.sideB && match.sideB.playerIds;
    if (Array.isArray(a) && a.indexOf(playerId) !== -1) return "A";
    if (Array.isArray(b) && b.indexOf(playerId) !== -1) return "B";
    return null;
  }

  function isCounted(match) {
    /* Only finished matches with a decided winner feed any record. */
    return match && match.status === "finished" && (match.winnerSide === "A" || match.winnerSide === "B");
  }

  function emptyRec() { return { n: 0, w: 0, l: 0 }; }
  function addRec(rec, won) { rec.n++; if (won) rec.w++; else rec.l++; }

  function buildRecords(matches, playerId) {
    var out = {
      training: { total: emptyRec(), singles: emptyRec(), doubles: emptyRec(), seen: 0 },
      tournament: { total: emptyRec(), singles: emptyRec(), doubles: emptyRec(), seen: 0 },
      openCount: 0,
    };
    matches.forEach(function (m) {
      var bucket = m.type === "tournament" ? out.tournament : out.training;
      bucket.seen++;
      if (!isCounted(m)) { out.openCount++; return; }
      var side = sideOf(m, playerId);
      if (!side) return;                 // player not on either side — ignore
      var won = m.winnerSide === side;
      addRec(bucket.total, won);
      if (m.discipline === "singles") addRec(bucket.singles, won);
      else if (m.discipline === "doubles") addRec(bucket.doubles, won);
    });
    return out;
  }

  /* Head-to-head from MY perspective: opponent record + partner record,
     each kept split by training / tournament (never merged). */
  function buildH2H(matches, playerId, meId) {
    var out = {
      vs: { training: emptyRec(), tournament: emptyRec() },
      with: { training: emptyRec(), tournament: emptyRec() },
    };
    matches.forEach(function (m) {
      if (!isCounted(m)) return;
      var mine = sideOf(m, meId);
      var theirs = sideOf(m, playerId);
      if (!mine || !theirs) return;
      var key = m.type === "tournament" ? "tournament" : "training";
      var iWon = m.winnerSide === mine;
      if (mine === theirs) addRec(out.with[key], iWon);
      else addRec(out.vs[key], iWon);
    });
    return out;
  }

  function recTotal(pair) {
    return pair.training.n + pair.tournament.n;
  }

  /* ------------------------------------------------------------- rendering */
  function pctHtml(rec) {
    if (!rec.n) return '<span class="mtp-dash">—</span>';
    var pct = Math.round((rec.w / rec.n) * 100);
    var cls = "mtp-pct" + (rec.n < 5 ? " mtp-low" : "");
    var title = rec.n < 5 ? ' title="' + E(TT("Kleine Stichprobe — nur {0} Spiele", rec.n)) + '"' : "";
    return '<span class="' + cls + '"' + title + '>' + E(TT("{0} % ({1})", pct, rec.n)) + "</span>";
  }

  /* App-wide convention: wins green, losses red, separator neutral.
     The title carries the same information without relying on colour. */
  function wlHtml(rec) {
    return (
      '<span class="mtp-stat-wl" title="' + E(TT("{0} Siege, {1} Niederlagen", rec.w, rec.l)) + '">' +
        '<span class="mtp-w">' + rec.w + "</span>" +
        '<span class="mtp-wl-sep" aria-hidden="true">–</span>' +
        '<span class="mtp-l">' + rec.l + "</span>" +
      "</span>"
    );
  }

  function statRowHtml(label, rec) {
    return (
      '<div class="mtp-stat-row">' +
        '<span class="mtp-stat-label">' + E(label) + "</span>" +
        wlHtml(rec) +
        pctHtml(rec) +
      "</div>"
    );
  }

  function recordBlockHtml(label, bucket) {
    var rows = statRowHtml(T("Gesamt"), bucket.total);
    if (bucket.singles.n) rows += statRowHtml(T("Einzel"), bucket.singles);
    if (bucket.doubles.n) rows += statRowHtml(T("Doppel"), bucket.doubles);
    if (!bucket.total.n) rows = '<p class="mtp-note">' + E(T("Keine gewerteten Spiele")) + "</p>";
    return (
      '<div class="mtp-block">' +
        '<div class="mtp-block-h">' + E(label) + "</div>" +
        rows +
      "</div>"
    );
  }

  function h2hBlockHtml(label, pair) {
    var rows = "";
    if (pair.training.n) rows += statRowHtml(T("Training"), pair.training);
    if (pair.tournament.n) rows += statRowHtml(T("Turnier"), pair.tournament);
    if (!rows) rows = '<p class="mtp-note">' + E(T("Noch keine gemeinsamen Spiele")) + "</p>";
    return (
      '<div class="mtp-block">' +
        '<div class="mtp-block-h">' + E(label) + "</div>" +
        rows +
      "</div>"
    );
  }

  function nameHtml(pid, name, playerId) {
    var label = name || T("Unbekannter Spieler");
    if (pid && pid === playerId) {
      return '<span class="mtp-name mtp-name-self">' + E(label) + "</span>";
    }
    if (!pid) return '<span class="mtp-name mtp-name-plain">' + E(label) + "</span>";
    return '<button type="button" class="mtp-name mtp-name-link" data-pid="' + E(pid) + '">' + E(label) + "</button>";
  }

  function sideHtml(side, playerId) {
    var ids = side && Array.isArray(side.playerIds) ? side.playerIds : [];
    var names = side && Array.isArray(side.playerNames) ? side.playerNames
      : (side && Array.isArray(side.names) ? side.names : []);
    var count = Math.max(ids.length, names.length);
    if (!count) return '<span class="mtp-name mtp-name-plain">' + E(T("Unbekannter Spieler")) + "</span>";
    var parts = [];
    for (var i = 0; i < count; i++) parts.push(nameHtml(ids[i] || "", names[i] || "", playerId));
    return parts.join('<span class="mtp-sep">/</span>');
  }

  function scoresHtml(match, side) {
    var games = Array.isArray(match.games) ? match.games : [];
    if (!games.length) return "";
    return games.map(function (g) {
      var v = side === "A" ? (g && g.a) : (g && g.b);
      return '<span class="mtp-pt">' + E(v === undefined || v === null ? "–" : v) + "</span>";
    }).join("");
  }

  function matchRowHtml(match, playerId) {
    var counted = isCounted(match);
    var mySide = sideOf(match, playerId);
    var metaBits =
      '<span class="mtp-m-date">' + E(fmtDate(match.date)) + "</span>" +
      '<span class="mtp-m-disc">' + E(match.discipline === "singles" ? T("Einzel") : T("Doppel")) + "</span>";
    if (match.type === "tournament") {
      var tname = match.tournament && match.tournament.name ? match.tournament.name : T("Turnier");
      metaBits += '<span class="mtp-badge mtp-badge-tour">' + E(tname) + "</span>";
    }
    if (match.locationName) metaBits += '<span class="mtp-m-loc">' + E(match.locationName) + "</span>";
    if (match.status === "in_progress") metaBits += '<span class="mtp-chip">' + E(T("läuft")) + "</span>";
    else if (match.status === "retired") metaBits += '<span class="mtp-chip">' + E(T("abgebrochen")) + "</span>";

    var lines = ["A", "B"].map(function (s) {
      var win = counted && match.winnerSide === s;
      /* Only the profiled player's own defeat is marked red. Marking the other
         side's loss too would paint a red ✕ on every win of theirs. */
      var myLoss = counted && !win && mySide === s;
      var cls = "mtp-side" + (win ? " mtp-side-win" : "") + (mySide === s ? " mtp-side-mine" : "");
      var markCls = "mtp-mark" + (win ? " mtp-mark-win" : (myLoss ? " mtp-mark-loss" : ""));
      var glyph = win ? "✓" : (myLoss ? "✕" : "");
      var srText = win ? T("Sieg") : (myLoss ? T("Niederlage") : "");
      return (
        '<div class="' + cls + '">' +
          '<span class="' + markCls + '">' +
            '<span aria-hidden="true">' + glyph + "</span>" +
            (srText ? '<span class="mtp-sr">' + E(srText) + "</span>" : "") +
          "</span>" +
          '<span class="mtp-side-names">' + sideHtml(s === "A" ? match.sideA : match.sideB, playerId) + "</span>" +
          '<span class="mtp-pts">' + scoresHtml(match, s) + "</span>" +
        "</div>"
      );
    }).join("");

    return '<li class="mtp-match"><div class="mtp-m-meta">' + metaBits + "</div>" + lines + "</li>";
  }

  function identityHtml(player, editing) {
    if (editing) {
      return (
        '<div class="mtp-ident mtp-ident-edit">' +
          '<label class="mtp-field"><span>' + E(T("Name")) + "</span>" +
            '<input type="text" class="mtp-input" id="mtp-in-name" value="' + E(player.name || "") + '" autocomplete="off"></label>' +
          '<label class="mtp-field"><span>' + E(T("Verein")) + "</span>" +
            '<input type="text" class="mtp-input" id="mtp-in-club" value="' + E(player.club || "") + '" autocomplete="off"></label>' +
          '<div class="mtp-ident-actions">' +
            '<button type="button" class="mtp-btn" data-mtp-act="cancel-edit">' + E(T("Abbrechen")) + "</button>" +
            '<button type="button" class="mtp-btn mtp-btn-primary" data-mtp-act="save-edit">' + E(T("Speichern")) + "</button>" +
          "</div>" +
        "</div>"
      );
    }
    var badges = "";
    if (player.isMe) badges += '<span class="mtp-badge mtp-badge-me">' + E(T("Ich")) + "</span>";
    if (player.active === false) badges += '<span class="mtp-badge mtp-badge-off">' + E(T("Inaktiv")) + "</span>";
    var canEdit = !!(MT.repo && typeof MT.repo.updatePlayer === "function");
    return (
      '<div class="mtp-ident">' +
        '<div class="mtp-ident-main">' +
          '<div class="mtp-ident-name">' + E(player.name || T("Unbekannter Spieler")) + badges + "</div>" +
          '<div class="mtp-ident-club">' + E(player.club || T("kein Verein")) + "</div>" +
        "</div>" +
        (canEdit
          ? '<button type="button" class="mtp-icon mtp-edit" data-mtp-act="edit" aria-label="' +
            E(T("Name & Verein bearbeiten")) + '" title="' + E(T("Name & Verein bearbeiten")) + '">✎</button>'
          : "") +
      "</div>"
    );
  }

  function renderLoading() {
    refreshBtn.hidden = true;
    bodyEl.innerHTML = '<p class="mtp-state" role="status">' + E(T("Lade Spiele…")) + "</p>";
  }

  function renderNotice(msg) {
    refreshBtn.hidden = true;
    bodyEl.innerHTML = '<p class="mtp-state">' + E(msg) + "</p>";
  }

  function renderError() {
    refreshBtn.hidden = true;
    bodyEl.innerHTML =
      '<div class="mtp-state mtp-state-err" role="alert">' +
        "<p>" + E(T("Spiele konnten nicht geladen werden")) + "</p>" +
        '<button type="button" class="mtp-btn" data-mtp-act="retry">' + E(T("Erneut versuchen")) + "</button>" +
      "</div>";
  }

  function renderProfile(playerId, players, matches) {
    var player = null;
    for (var i = 0; i < players.length; i++) if (players[i].id === playerId) { player = players[i]; break; }
    if (!player) {
      /* Deleted player, or an id only present on old matches: fall back to the
         denormalised name from the match documents so the page still reads. */
      player = { id: playerId, name: nameFromMatches(matches, playerId) || T("Spieler nicht gefunden"), club: "", active: true, isMe: false };
    }
    var me = null;
    for (var j = 0; j < players.length; j++) if (players[j].isMe) { me = players[j]; break; }

    var sorted = matches.slice().sort(function (a, b) {
      var da = toDate(a.date), db = toDate(b.date);
      return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    });

    lastRender = { playerId: playerId, player: player, matches: sorted, me: me };
    setTitle(player.name);
    refreshBtn.hidden = false;
    renderBody(false);
  }

  function nameFromMatches(matches, playerId) {
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var sides = [m.sideA, m.sideB];
      for (var s = 0; s < 2; s++) {
        var side = sides[s];
        if (!side || !Array.isArray(side.playerIds)) continue;
        var idx = side.playerIds.indexOf(playerId);
        var nm = side.playerNames || side.names;
        if (idx !== -1 && nm && nm[idx]) return nm[idx];
      }
    }
    return "";
  }

  function renderCurrent() { if (lastRender) renderBody(false); }

  function renderBody(editing) {
    var d = lastRender;
    if (!d) return;
    var html = identityHtml(d.player, editing);

    if (!d.matches.length) {
      html += '<p class="mtp-state">' + E(T("Keine Spiele mit diesem Spieler")) + "</p>";
      bodyEl.innerHTML = html;
      if (editing) focusEdit();
      return;
    }

    /* 2. overall record — training and tournament never merged */
    var rec = buildRecords(d.matches, d.playerId);
    html += '<section class="mtp-sec"><h3 class="mtp-sec-h">' + E(T("Bilanz")) + "</h3>" + '<div class="mtp-grid">';
    if (rec.training.seen) html += recordBlockHtml(T("Training"), rec.training);
    if (rec.tournament.seen) html += recordBlockHtml(T("Turnier"), rec.tournament);
    html += "</div>";
    if (rec.openCount) {
      html += '<p class="mtp-note">' + E(T("Laufende und abgebrochene Spiele zählen nicht in die Bilanz.")) + "</p>";
    }
    html += "</section>";

    /* 3. head-to-head vs me — skipped when this profile IS me */
    if (d.me && d.me.id !== d.playerId) {
      var h2h = buildH2H(d.matches, d.playerId, d.me.id);
      if (recTotal(h2h.vs) || recTotal(h2h.with)) {
        html += '<section class="mtp-sec"><h3 class="mtp-sec-h">' + E(T("Kopf-an-Kopf")) + "</h3>" +
          '<div class="mtp-grid">' +
            h2hBlockHtml(T("Gegen mich"), h2h.vs) +
            h2hBlockHtml(T("Als Partner"), h2h.with) +
          "</div></section>";
      }
    }

    /* 4. match history */
    html += '<section class="mtp-sec"><h3 class="mtp-sec-h">' + E(T("Spielverlauf")) + "</h3>" +
      '<ul class="mtp-matches">' +
      d.matches.map(function (m) { return matchRowHtml(m, d.playerId); }).join("") +
      "</ul></section>";

    bodyEl.innerHTML = html;
    bodyEl.scrollTop = 0;
    if (editing) focusEdit();
  }

  /* ------------------------------------------------------------ name/club */
  function startEdit() {
    if (!lastRender) return;
    renderBody(true);
  }

  function focusEdit() {
    var input = bodyEl.querySelector("#mtp-in-name");
    if (input) { input.focus(); input.select(); }
  }

  function saveEdit(btn) {
    if (!lastRender) return;
    var nameInput = bodyEl.querySelector("#mtp-in-name");
    var clubInput = bodyEl.querySelector("#mtp-in-club");
    if (!nameInput) return;
    var name = nameInput.value.trim();
    var club = clubInput ? clubInput.value.trim() : "";
    if (!name) {
      notify(T("Name darf nicht leer sein"));
      nameInput.focus();
      return;
    }
    var player = lastRender.player;
    if (name === (player.name || "") && club === (player.club || "")) { renderCurrent(); return; }

    btn.disabled = true;
    Promise.resolve()
      .then(function () { return MT.repo.updatePlayer(player.id, { name: name, club: club }); })
      .then(function () {
        /* Keep the cached player list in sync; match documents keep their
           denormalised historic names on purpose (spec: don't rewrite history). */
        player.name = name;
        player.club = club;
        setTitle(name);
        notify(T("Profil gespeichert"));
        renderBody(false);
      })
      .catch(function (err) {
        btn.disabled = false;
        if (typeof MT.toastError === "function") MT.toastError(err, "Profil konnte nicht gespeichert werden");
        else console.error("[tracker-profile]", err);
      });
  }

  /* --------------------------------------------------------------- export */
  /* Override the core stub. Everyone else keeps calling MT.openPlayerProfile. */
  MT.openPlayerProfile = function (playerId) {
    if (!playerId) return;
    open(String(playerId));
  };
})();
