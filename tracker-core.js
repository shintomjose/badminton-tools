/* ===================== Match Tracker — core =====================
 * Firestore data layer + owner auth + PIN gate + view registry.
 *
 * Loaded AFTER app.js and relies on its globals:
 *   t(), tt(), EN, esc(), toast(), LANG, DATE_LOCALE, PIN_HASH, sha256Hex()
 *
 * The other tabs use the Firebase Realtime Database. This file only touches
 * Firestore in the same Firebase app — the RTDB features stay untouched.
 *
 * Writes resolve as soon as they are QUEUED locally (Firestore write promises
 * never settle while offline). Failures surface through MT.toastError, and the
 * sync chip in the tracker header reports the honest pending state.
 * ================================================================ */
"use strict";

Object.assign(EN, {
  "Private Spieldaten — nur mit deinem Google-Konto sichtbar.": "Private match data — visible only with your Google account.",
  "🔒 Spiele geschützt": "🔒 Matches locked",
  "PIN eingeben, um den Tracker zu öffnen.": "Enter the PIN to open the tracker.",
  "Verbinde…": "Connecting…",
  "● synchronisiert": "● synced",
  "⏳ ausstehend…": "⏳ pending…",
  "○ offline": "○ offline",
  "Deine Spieldaten sind privat": "Your match data is private",
  "Melde dich mit deinem Google-Konto an. Nur dein Konto darf diese Spiele lesen und schreiben — das erzwingen die Firestore-Regeln, nicht der PIN.":
    "Sign in with your Google account. Only your account may read or write these matches — enforced by the Firestore rules, not by the PIN.",
  "Mit Google anmelden": "Sign in with Google",
  "Die Google-Anmeldung funktioniert in der installierten App auf dem iPhone leider nicht (Apple-Einschränkung). Bitte diesen Bereich in Safari öffnen und dort anmelden.": "Google sign-in does not work in the installed app on iPhone (an Apple restriction). Please open this section in Safari and sign in there.",
  "Link kopieren": "Copy link",
  "Link kopiert — in Safari einfügen": "Link copied — paste it in Safari",
  "Anmeldung fehlgeschlagen": "Sign-in failed",
  "Anmeldung hier nicht möglich — Seite einmal im Browser öffnen und dort anmelden": "Sign-in not possible here — open the page in the browser once and sign in there",
  "Abmeldung fehlgeschlagen": "Sign-out failed",
  "Abmelden": "Sign out",
  "Einrichtung nötig": "Setup required",
  "Firestore verweigert den Zugriff. Trage die UID unten in firestore.rules als OWNER_UID ein und veröffentliche die Regeln neu (README → „Match Tracker setup“).":
    "Firestore denies access. Put the UID below into firestore.rules as OWNER_UID and re-publish the rules (README → “Match Tracker setup”).",
  "UID kopieren": "Copy UID",
  "UID kopiert": "UID copied",
  "Erneut prüfen": "Check again",
  "Firestore-SDK nicht geladen": "Firestore SDK not loaded",
  "Das Firestore-SDK konnte nicht geladen werden. Internetverbindung prüfen und die Seite neu laden.":
    "The Firestore SDK could not be loaded. Check your connection and reload the page.",
  "Zugriff verweigert — Firestore-Regeln prüfen": "Access denied — check the Firestore rules",
  "Offline — wird gesendet, sobald wieder Verbindung besteht": "Offline — will be sent once you are back online",
  "Firestore-Index fehlt — siehe README": "Firestore index missing — see the README",
  "Nicht angemeldet": "Not signed in",
  "Keine Datenbankverbindung": "No database connection",
  "Laden fehlgeschlagen": "Loading failed",
  "Spiel speichern fehlgeschlagen": "Saving the match failed",
  "Löschen": "Delete",
  "Ansicht konnte nicht geladen werden": "The view could not be loaded",
  "Eintrag": "Entry",
  "Profil folgt": "Profile coming soon",
  "Offline-Speicher nicht aktiv — Eingaben funktionieren, werden aber nicht zwischengespeichert.":
    "Offline storage is not active — entry still works, but nothing is cached.",
  "Spiele": "Results",
});

const MT = (function () {
  /* ================= constants ================= */
  const MT_PIN_TIMEOUT_MIN = 30;              // re-lock after this much inactivity
  const MT_PIN_DISABLED = true;               // flip to false to re-enable the tracker PIN
  const PIN_UNLOCK_KEY = "mt-pin-unlock";
  const PIN_LAST_KEY = "mt-pin-last";
  const DEFAULT_CLUB = "TSG Heilbronn";
  const DEFAULT_LOCATION = "TSG Heilbronn Hall";
  const COL = { sessions: "sessions", matches: "matches", players: "players", locations: "locations" };
  const OWNER_UID_PLACEHOLDER = "PASTE_OWNER_UID_HERE";

  /* ================= tiny helpers ================= */
  function pad2(n) { return String(n).padStart(2, "0"); }

  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v.toDate === "function") return v.toDate();     // Firestore Timestamp
    if (typeof v === "number") return new Date(v);
    if (typeof v === "string") { const d = new Date(v); return isNaN(d) ? null : d; }
    return null;
  }

  /* ISO-8601 week: week 1 is the week holding the first Thursday of the year,
     so the week year can differ from the calendar year around 1 January. */
  function isoWeek(d) {
    const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = dt.getUTCDay() || 7;                 // Mon=1 … Sun=7
    dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);        // move to the week's Thursday
    const weekYear = dt.getUTCFullYear();
    const yearStart = Date.UTC(weekYear, 0, 1);
    const week = Math.ceil(((dt.getTime() - yearStart) / 86400000 + 1) / 7);
    return { weekYear: weekYear, week: week };
  }

  function keys(date) {
    const d = toDate(date) || new Date();
    const iso = isoWeek(d);
    return {
      dateKey: d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()),
      weekKey: iso.weekYear + "-W" + pad2(iso.week),
      yearKey: String(d.getFullYear()),
    };
  }

  /* Monday…Sunday range of a "YYYY-Www" key — handy for grouped history headers. */
  function weekRange(weekKey) {
    const m = /^(\d{4})-W(\d{2})$/.exec(String(weekKey || ""));
    if (!m) return null;
    const year = Number(m[1]), week = Number(m[2]);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const monday = new Date(jan4.getTime() + (week - 1) * 7 * 86400000 - (jan4Day - 1) * 86400000);
    const start = new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate());
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return { start: start, end: end };
  }

  function fmtDate(date, opts) {
    const d = toDate(date);
    if (!d) return "";
    return d.toLocaleDateString(DATE_LOCALE, opts || { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  }

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0); }
  function endOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }

  /* One game counts as won at >= targetScore with any lead (club scoring, no deuce).
     The match goes to whoever won the majority of the decided games. */
  function gameWinner(game, targetScore) {
    if (!game) return null;
    const a = Number(game.a) || 0, b = Number(game.b) || 0;
    const target = Number(targetScore) || 0;
    if (a >= target && a > b) return "A";
    if (b >= target && b > a) return "B";
    return null;
  }

  function deriveWinner(games, targetScore) {
    const list = Array.isArray(games) ? games : [];
    let a = 0, b = 0;
    for (const g of list) {
      const w = gameWinner(g, targetScore);
      if (w === "A") a++;
      else if (w === "B") b++;
    }
    if (a === 0 && b === 0) return null;
    if (a > b) return "A";
    if (b > a) return "B";
    return null;                                        // tie → no winner yet
  }

  /* Retirement / abandonment beats the score when deriving the match winner. */
  function matchWinner(m) {
    if (!m) return null;
    if (m.resultType === "retired") {
      if (m.retiredSide === "A") return "B";
      if (m.retiredSide === "B") return "A";
      return null;
    }
    if (m.resultType === "incomplete") return null;
    return deriveWinner(m.games || [], m.targetScore);
  }

  /* ================= error surfacing ================= */
  const CODE_MSG = {
    "permission-denied": "Zugriff verweigert — Firestore-Regeln prüfen",
    "unavailable": "Offline — wird gesendet, sobald wieder Verbindung besteht",
    "failed-precondition": "Firestore-Index fehlt — siehe README",
    "unauthenticated": "Nicht angemeldet",
  };

  function toastError(err, germanMsg) {
    const base = germanMsg || "Speichern fehlgeschlagen";
    console.error("[MT] " + base, err);
    const code = err && err.code;
    const extra = code && CODE_MSG[code] ? CODE_MSG[code] : null;
    try {
      toast(extra ? t(base) + " — " + t(extra) : t(base));
    } catch (e) { /* toast unavailable — the console entry above is the fallback */ }
  }

  /* ================= firebase / firestore boot ================= */
  const state = {
    db: null,
    user: null,
    sdkError: null,          // "no-sdk" when firebase-firestore-compat.js is missing
    access: "unknown",       // "unknown" | "ok" | "denied"
    booted: false,
    phase: "idle",           // idle | loading | ready
    pendingWrites: 0,
    snapshotPending: false,
  };

  const api = {};
  api.persistenceOk = null;

  function firstAuthUser() {
    return new Promise(resolve => {
      let done = false;
      const finish = u => { if (!done) { done = true; resolve(u || null); } };
      let unsub = null;
      try {
        unsub = firebase.auth().onAuthStateChanged(u => { finish(u); if (unsub) { try { unsub(); } catch (e) {} } });
      } catch (e) { finish(null); return; }
      // Never hang the UI on a stalled auth handshake.
      setTimeout(() => finish(firebase.auth && firebase.auth().currentUser), 8000);
    });
  }

  const ready = (async function boot() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length || typeof firebase.firestore !== "function") {
      state.sdkError = "no-sdk";
      console.warn("[MT] Firestore-SDK nicht verfügbar — Tracker läuft im Fehlerzustand.");
      return { db: null, user: null };
    }
    let db = null;
    try {
      db = firebase.firestore();
    } catch (e) {
      state.sdkError = "no-sdk";
      console.warn("[MT] firebase.firestore() fehlgeschlagen:", e);
      return { db: null, user: null };
    }
    try {
      await db.enablePersistence({ synchronizeTabs: true });
      api.persistenceOk = true;
    } catch (e) {
      api.persistenceOk = false;
      console.warn("[MT] Offline-Persistenz nicht aktiv:", e && e.code ? e.code : e);
    }
    const user = await firstAuthUser();
    state.db = db;
    state.user = user;
    return { db: db, user: user };
  })();

  ready.catch(e => console.error("[MT] Initialisierung fehlgeschlagen", e));

  function currentUser() {
    try { return (window.firebase && firebase.auth && firebase.auth().currentUser) || null; }
    catch (e) { return null; }
  }
  function isOwner() {
    const u = currentUser();
    return !!(u && !u.isAnonymous);
  }
  function uid() {
    const u = currentUser();
    return u ? u.uid : null;
  }

  /* Complete a pending redirect sign-in (no-op when there is none). Without this,
     a signInWithRedirect round-trip can return to the app and go nowhere. */
  try {
    firebase.auth().getRedirectResult().catch(e => {
      if (e && e.code !== "auth/no-auth-event") toastError(e, "Anmeldung fehlgeschlagen");
    });
  } catch (e) {}

  function inStandalonePwa() {
    try {
      return window.matchMedia("(display-mode: standalone)").matches
        || window.navigator.standalone === true;
    } catch (e) { return false; }
  }

  /* When the page is served from the authDomain itself (Firebase Hosting),
     the auth helper is first-party: redirect sign-in works everywhere,
     including installed PWAs. */
  function sameOriginAuth() {
    try { return firebase.app().options.authDomain === location.host; }
    catch (e) { return false; }
  }

  async function signIn() {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      if (inStandalonePwa() && sameOriginAuth()) {
        /* First-party auth: redirect is the reliable flow in installed apps
           (popups may not return to the standalone context). */
        await firebase.auth().signInWithRedirect(provider);
        return;
      }
      try {
        /* Popup is the reliable flow everywhere: with authDomain on firebaseapp.com
           (a third-party origin for this page), the redirect flow silently loses the
           session on browsers with storage partitioning (mobile Safari/Chrome). */
        await firebase.auth().signInWithPopup(provider);
      } catch (popupErr) {
        const code = popupErr && popupErr.code;
        if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
          return; // user backed out — not an error, and no redirect fallback
        }
        console.warn("[MT] Popup-Anmeldung fehlgeschlagen, versuche Redirect:", code);
        if (inStandalonePwa()) {
          /* In an installed PWA both flows are unreliable — say so instead of looping. */
          toast(t("Anmeldung hier nicht möglich — Seite einmal im Browser öffnen und dort anmelden"));
        }
        await firebase.auth().signInWithRedirect(provider);
      }
    } catch (e) {
      toastError(e, "Anmeldung fehlgeschlagen");
    }
  }

  async function signOut() {
    try { await firebase.auth().signOut(); }
    catch (e) { toastError(e, "Abmeldung fehlgeschlagen"); }
  }

  /* ================= write plumbing ================= */
  function trackWrite(promise, germanMsg) {
    state.pendingWrites++;
    renderSync();
    promise.then(
      () => { state.pendingWrites--; renderSync(); },
      err => { state.pendingWrites--; renderSync(); toastError(err, germanMsg); }
    );
    return promise;
  }

  function noteSync(meta) {
    state.snapshotPending = !!(meta && meta.hasPendingWrites);
    renderSync();
  }

  function serverTs() { return firebase.firestore.FieldValue.serverTimestamp(); }
  function ts(d) { return firebase.firestore.Timestamp.fromDate(d); }
  function docData(d) { const o = d.data() || {}; o.id = d.id; return o; }

  async function need() {
    const r = await ready;
    if (!r.db) throw Object.assign(new Error("Firestore nicht verfügbar"), { code: "unavailable" });
    if (!uid()) throw Object.assign(new Error("Nicht angemeldet"), { code: "unauthenticated" });
    return r.db;
  }

  /* ================= document builders ================= */
  function sessionDoc(session, date, k, owner) {
    return {
      date: ts(date),
      dateKey: k.dateKey, weekKey: k.weekKey, yearKey: k.yearKey,
      locationId: session.locationId || null,
      locationName: session.locationName || DEFAULT_LOCATION,
      type: session.type === "tournament" ? "tournament" : "training",
      note: session.note || "",
      /* tournament-only fields stay null until phase 4 */
      tournamentName: session.tournamentName || null,
      ownerUid: owner,
      createdAt: serverTs(),
      updatedAt: serverTs(),
    };
  }

  function side(raw) {
    const s = raw || {};
    return {
      playerIds: Array.isArray(s.playerIds) ? s.playerIds.filter(Boolean) : [],
      playerNames: Array.isArray(s.playerNames) ? s.playerNames.slice() : [],
    };
  }

  function matchDoc(match, ctx, owner) {
    const m = match || {};
    const sideA = side(m.sideA), sideB = side(m.sideB);
    const discipline = m.discipline === "doubles" ? "doubles" : "singles";
    const targetScore = Number(m.targetScore) || (discipline === "doubles" ? 21 : 11);
    const games = (Array.isArray(m.games) ? m.games : []).map(g => ({
      a: Math.max(0, Number(g && g.a) || 0),
      b: Math.max(0, Number(g && g.b) || 0),
    }));
    const status = m.status === "finished" ? "finished" : "in_progress";
    const resultType = ["normal", "retired", "incomplete"].indexOf(m.resultType) >= 0 ? m.resultType : "normal";
    const shape = {
      games: games, targetScore: targetScore,
      resultType: resultType, retiredSide: m.retiredSide || null,
    };
    return {
      sessionId: ctx.sessionId,
      /* denormalised from the session so the history view reads one collection */
      date: ts(ctx.date),
      dateKey: ctx.k.dateKey, weekKey: ctx.k.weekKey, yearKey: ctx.k.yearKey,
      locationName: ctx.locationName || DEFAULT_LOCATION,
      type: ctx.type === "tournament" ? "tournament" : "training",
      discipline: discipline,
      targetScore: targetScore,
      sideA: sideA,
      sideB: sideB,
      playerIds: sideA.playerIds.concat(sideB.playerIds),
      /* club at the time of the match — a later club change must not rewrite history */
      playerClubs: m.playerClubs && typeof m.playerClubs === "object" ? m.playerClubs : {},
      games: games,
      status: status,
      resultType: resultType,
      retiredSide: m.retiredSide || null,
      winnerSide: status === "finished" ? (m.winnerSide !== undefined ? m.winnerSide : matchWinner(shape)) : null,
      /* true when the isMe player is not on court — kept so "matches I watched" stay out of my stats */
      involvesMe: m.involvesMe === undefined ? null : !!m.involvesMe,
      note: m.note || "",
      /* tournament-only, phase 4 */
      round: m.round || null,
      category: m.category || null,
      opponentClub: m.opponentClub || null,
      ownerUid: owner,
      createdAt: serverTs(),
      updatedAt: serverTs(),
    };
  }

  /* ================= repository ================= */
  const repo = {};

  /* Session + first match in ONE batch so a half-created session cannot exist.
     Resolves as soon as the batch is queued locally (works offline). */
  repo.createSessionWithMatch = async function (session, match) {
    const db = await need();
    const owner = uid();
    const date = toDate(session && session.date) || new Date();
    const k = keys(date);
    const sRef = db.collection(COL.sessions).doc();
    const mRef = db.collection(COL.matches).doc();
    const sData = sessionDoc(session || {}, date, k, owner);
    const batch = db.batch();
    batch.set(sRef, sData);
    batch.set(mRef, matchDoc(match, {
      sessionId: sRef.id, date: date, k: k,
      type: sData.type, locationName: sData.locationName,
    }, owner));
    trackWrite(batch.commit(), "Spiel speichern fehlgeschlagen");
    return { sessionId: sRef.id, matchId: mRef.id, session: Object.assign({ id: sRef.id }, sData, { date: date }) };
  };

  /* Denormalises date / locationName / type from the session document. */
  repo.addMatch = async function (sessionId, match) {
    const db = await need();
    const owner = uid();
    let sData = null;
    try {
      const snap = await db.collection(COL.sessions).doc(sessionId).get();
      if (snap.exists) sData = snap.data();
    } catch (e) {
      console.warn("[MT] Session konnte nicht gelesen werden, nutze Vorgaben:", e && e.code);
    }
    const date = toDate(sData && sData.date) || new Date();
    const k = keys(date);
    const ref = db.collection(COL.matches).doc();
    trackWrite(ref.set(matchDoc(match, {
      sessionId: sessionId, date: date, k: k,
      type: (sData && sData.type) || "training",
      locationName: (sData && sData.locationName) || DEFAULT_LOCATION,
    }, owner)), "Spiel speichern fehlgeschlagen");
    return ref.id;
  };

  repo.updateMatch = async function (id, patch) {
    const db = await need();
    const p = Object.assign({}, patch || {});
    delete p.id; delete p.ownerUid; delete p.createdAt;
    if (p.sideA || p.sideB) {
      const a = side(p.sideA), b = side(p.sideB);
      if (p.sideA) p.sideA = a;
      if (p.sideB) p.sideB = b;
      if (p.sideA && p.sideB) p.playerIds = a.playerIds.concat(b.playerIds);
    }
    if (p.date) { const d = toDate(p.date); const k = keys(d); p.date = ts(d); p.dateKey = k.dateKey; p.weekKey = k.weekKey; p.yearKey = k.yearKey; }
    p.updatedAt = serverTs();
    trackWrite(db.collection(COL.matches).doc(id).update(p), "Speichern fehlgeschlagen");
    return id;
  };

  /* Marks a match finished and stores the derived winner.
     Pass `data` (the local match object) to skip the read — important offline. */
  repo.finishMatch = async function (id, data) {
    const db = await need();
    let m = data;
    if (!m) {
      try {
        const snap = await db.collection(COL.matches).doc(id).get();
        m = snap.exists ? snap.data() : null;
      } catch (e) {
        toastError(e, "Laden fehlgeschlagen");
        return null;
      }
    }
    const winner = matchWinner(m || {});
    trackWrite(db.collection(COL.matches).doc(id).update({
      status: "finished", winnerSide: winner, updatedAt: serverTs(),
    }), "Speichern fehlgeschlagen");
    return winner;
  };

  repo.deleteMatch = async function (id) {
    const db = await need();
    trackWrite(db.collection(COL.matches).doc(id).delete(), "Löschen fehlgeschlagen");
    return id;
  };

  /* One-time read with an explicit range — never a live subscription. */
  repo.getMatches = async function (opts) {
    const db = await need();
    const o = opts || {};
    const from = toDate(o.from), to = toDate(o.to);
    function build(withOwner) {
      let q = db.collection(COL.matches);
      if (withOwner) q = q.where("ownerUid", "==", uid());
      if (from) q = q.where("date", ">=", ts(startOfDay(from)));
      if (to) q = q.where("date", "<=", ts(endOfDay(to)));
      q = q.orderBy("date", "desc");
      if (o.limit) q = q.limit(o.limit);
      return q;
    }
    try {
      const snap = await build(true).get();
      return snap.docs.map(docData);
    } catch (e) {
      if (e && e.code === "failed-precondition") {
        // Composite index not deployed yet — the rules already scope reads to the owner.
        console.warn("[MT] Index (ownerUid, date) fehlt — Fallback ohne ownerUid-Filter.");
        const snap = await build(false).get();
        return snap.docs.map(docData);
      }
      throw e;
    }
  };

  repo.getMatchesForPlayer = async function (playerId) {
    const db = await need();
    const base = db.collection(COL.matches).where("playerIds", "array-contains", playerId);
    try {
      const snap = await base.orderBy("date", "desc").get();
      return snap.docs.map(docData);
    } catch (e) {
      if (e && e.code === "failed-precondition") {
        console.warn("[MT] Index (playerIds, date) fehlt — sortiere clientseitig.");
        const snap = await base.get();
        return snap.docs.map(docData).sort((x, y) => {
          const dx = toDate(x.date), dy = toDate(y.date);
          return (dy ? dy.getTime() : 0) - (dx ? dx.getTime() : 0);
        });
      }
      throw e;
    }
  };

  /* Live view of the session currently being edited (session doc + its matches).
     cb({ session, matches, hasPendingWrites, fromCache }). Returns unsubscribe(). */
  repo.watchSession = function (sessionId, cb) {
    let stopped = false;
    const unsubs = [];
    let session = null, matches = [], pending = false, fromCache = false;
    function emit() {
      noteSync({ hasPendingWrites: pending });
      try { cb({ session: session, matches: matches, hasPendingWrites: pending, fromCache: fromCache }); }
      catch (e) { console.error("[MT] watchSession-Callback:", e); }
    }
    ready.then(function (r) {
      if (stopped || !r.db) return;
      const opts = { includeMetadataChanges: true };
      unsubs.push(r.db.collection(COL.sessions).doc(sessionId).onSnapshot(opts, function (snap) {
        session = snap.exists ? Object.assign({ id: snap.id }, snap.data()) : null;
        pending = snap.metadata.hasPendingWrites;
        fromCache = snap.metadata.fromCache;
        emit();
      }, function (e) { toastError(e, "Laden fehlgeschlagen"); }));
      /* No orderBy here on purpose: equality-only keeps this on the automatic
         single-field index, so no extra composite index is needed. */
      unsubs.push(r.db.collection(COL.matches).where("sessionId", "==", sessionId)
        .onSnapshot(opts, function (snap) {
          matches = snap.docs.map(docData).sort(function (a, b) {
            const ta = toDate(a.createdAt), tb = toDate(b.createdAt);
            return (ta ? ta.getTime() : Infinity) - (tb ? tb.getTime() : Infinity);
          });
          pending = snap.metadata.hasPendingWrites;
          fromCache = snap.metadata.fromCache;
          emit();
        }, function (e) { toastError(e, "Laden fehlgeschlagen"); }));
    });
    return function unsubscribe() {
      stopped = true;
      while (unsubs.length) { try { unsubs.pop()(); } catch (e) {} }
      noteSync({ hasPendingWrites: false });
    };
  };

  /* players / locations are small collections — read whole, sort in JS,
     so neither needs a composite index. */
  repo.listPlayers = async function () {
    const db = await need();
    const snap = await db.collection(COL.players).get();
    const me = uid();
    return snap.docs.map(docData)
      .filter(p => !p.ownerUid || p.ownerUid === me)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), DATE_LOCALE));
  };

  repo.addPlayer = async function (name, club, extra) {
    const db = await need();
    const ref = db.collection(COL.players).doc();
    const data = Object.assign({
      name: String(name || "").trim(),
      club: club || DEFAULT_CLUB,
      active: true,
      isMe: false,
      ownerUid: uid(),
      createdAt: serverTs(),
      updatedAt: serverTs(),
    }, extra || {});
    trackWrite(ref.set(data), "Speichern fehlgeschlagen");
    return ref.id;
  };

  repo.updatePlayer = async function (id, patch) {
    const db = await need();
    const p = Object.assign({}, patch || {});
    delete p.id; delete p.ownerUid; delete p.createdAt;
    p.updatedAt = serverTs();
    trackWrite(db.collection(COL.players).doc(id).update(p), "Speichern fehlgeschlagen");
    return id;
  };

  repo.listLocations = async function () {
    const db = await need();
    const snap = await db.collection(COL.locations).get();
    const me = uid();
    return snap.docs.map(docData)
      .filter(l => !l.ownerUid || l.ownerUid === me)
      .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0)
        || String(a.name || "").localeCompare(String(b.name || ""), DATE_LOCALE));
  };

  repo.addLocation = async function (name, extra) {
    const db = await need();
    const ref = db.collection(COL.locations).doc();
    trackWrite(ref.set(Object.assign({
      name: String(name || "").trim(),
      isDefault: false,
      ownerUid: uid(),
      createdAt: serverTs(),
      updatedAt: serverTs(),
    }, extra || {})), "Speichern fehlgeschlagen");
    return ref.id;
  };

  /* Equality on dateKey only → automatic single-field index, no composite needed. */
  repo.findTodaySession = async function (type, when) {
    const db = await need();
    const k = keys(when || new Date());
    const wanted = type === "tournament" ? "tournament" : "training";
    const snap = await db.collection(COL.sessions).where("dateKey", "==", k.dateKey).get();
    const me = uid();
    const hit = snap.docs.map(docData)
      .filter(s => s.type === wanted && (!s.ownerUid || s.ownerUid === me))[0];
    return hit || null;
  };

  repo.getOrCreateTodaySession = async function (type, locationId) {
    const existing = await repo.findTodaySession(type);
    if (existing) return existing;
    const db = await need();
    let locationName = DEFAULT_LOCATION;
    if (locationId) {
      try {
        const snap = await db.collection(COL.locations).doc(locationId).get();
        if (snap.exists) locationName = snap.data().name || locationName;
      } catch (e) { console.warn("[MT] Ort konnte nicht gelesen werden:", e && e.code); }
    }
    const date = new Date();
    const k = keys(date);
    const ref = db.collection(COL.sessions).doc();
    const data = sessionDoc({ type: type, locationId: locationId || null, locationName: locationName }, date, k, uid());
    trackWrite(ref.set(data), "Speichern fehlgeschlagen");
    return Object.assign({ id: ref.id }, data, { date: date });
  };

  repo.updateSession = async function (id, patch) {
    const db = await need();
    const p = Object.assign({}, patch || {});
    delete p.id; delete p.ownerUid; delete p.createdAt;
    p.updatedAt = serverTs();
    trackWrite(db.collection(COL.sessions).doc(id).update(p), "Speichern fehlgeschlagen");
    return id;
  };

  /* ================= PIN gate (tracker-only) ================= */
  function pinFresh() {
    const last = Number(localStorage.getItem(PIN_LAST_KEY) || 0);
    if (!last) return false;
    return (Date.now() - last) < MT_PIN_TIMEOUT_MIN * 60 * 1000;
  }
  function pinOk() {
    if (MT_PIN_DISABLED) return true;
    return localStorage.getItem(PIN_UNLOCK_KEY) === PIN_HASH && pinFresh();
  }
  function pinTouch() {
    if (localStorage.getItem(PIN_UNLOCK_KEY) === PIN_HASH) {
      try { localStorage.setItem(PIN_LAST_KEY, String(Date.now())); } catch (e) {}
    }
  }
  function pinLock() {
    try { localStorage.removeItem(PIN_UNLOCK_KEY); localStorage.removeItem(PIN_LAST_KEY); } catch (e) {}
  }
  function checkPinExpiry() {
    if (MT_PIN_DISABLED) return;
    if (localStorage.getItem(PIN_UNLOCK_KEY) === PIN_HASH && !pinFresh()) {
      pinLock();
      if (isVisible()) render();
    }
  }

  /* ================= view registry ================= */
  const views = [];
  let activeViewId = null;
  let mountedId = null;

  function registerView(id, def) {
    const entry = { id: id, def: def || {} };
    const i = views.findIndex(v => v.id === id);
    if (i >= 0) {
      views[i] = entry;
      if (mountedId === id) unmountView();
    } else {
      views.push(entry);
    }
    if (!activeViewId) activeViewId = id;
    if (state.phase === "ready" && isVisible()) renderViews();
  }

  function showView(id) {
    if (!views.some(v => v.id === id)) return;
    activeViewId = id;
    if (state.phase === "ready") renderViews();
  }

  function unmountView() {
    if (!mountedId) return;
    const v = views.find(x => x.id === mountedId);
    mountedId = null;
    if (v && typeof v.def.unmount === "function") {
      try { v.def.unmount(); } catch (e) { console.error("[MT] unmount:", e); }
    }
  }

  function labelOf(v) {
    const l = v.def && v.def.label;
    return typeof l === "function" ? l() : (l || v.id);
  }

  function renderViews() {
    const host = document.getElementById("mtViewHost");
    const nav = document.getElementById("mtSubnav");
    if (!host || !nav) return;
    if (!views.some(v => v.id === activeViewId)) activeViewId = views.length ? views[0].id : null;
    nav.innerHTML = views.map(v =>
      '<button role="tab" type="button" data-mtview="' + esc(v.id) + '" id="mtviewbtn-' + esc(v.id) + '"' +
      ' aria-selected="' + (v.id === activeViewId) + '" aria-controls="mtViewHost">' + esc(labelOf(v)) + "</button>"
    ).join("");
    if (mountedId === activeViewId) return;
    unmountView();
    host.innerHTML = "";
    const v = views.find(x => x.id === activeViewId);
    if (!v) return;
    mountedId = v.id;
    try {
      if (typeof v.def.mount === "function") v.def.mount(host);
    } catch (e) {
      console.error("[MT] mount:", e);
      host.innerHTML = '<p class="empty-note">' + esc(t("Ansicht konnte nicht geladen werden")) + "</p>";
    }
  }

  /* ================= UI: gate + chrome ================= */
  function panelEl() { return document.getElementById("tab-tracker"); }
  function isVisible() { const p = panelEl(); return !!p && !p.hidden; }

  function ensureSkeleton() {
    const p = panelEl();
    if (!p || p.dataset.mtReady === "1") return p;
    p.innerHTML =
      '<div class="mt-topbar">' +
        '<p class="tab-sub" id="mtSub">' + esc(t("Private Spieldaten — nur mit deinem Google-Konto sichtbar.")) + "</p>" +
        '<span class="mt-sync" id="mtSync" role="status" aria-live="polite"></span>' +
      "</div>" +
      '<div id="mtGate"></div>';
    p.dataset.mtReady = "1";
    return p;
  }

  function renderSync() {
    const el = document.getElementById("mtSync");
    if (!el) return;
    let cls = "ok", txt = "● synchronisiert";
    if (!navigator.onLine) { cls = "off"; txt = "○ offline"; }
    else if (state.pendingWrites > 0 || state.snapshotPending) { cls = "pending"; txt = "⏳ ausstehend…"; }
    el.className = "mt-sync " + cls;
    el.textContent = t(txt);
  }

  function card(title, bodyHtml, cls) {
    return '<section class="panel mt-card ' + (cls || "") + '"><h2>' + esc(title) + "</h2>" + bodyHtml + "</section>";
  }

  function renderPinGate(gate) {
    gate.innerHTML =
      '<div class="mt-pin-wrap"><div class="pin-box">' +
        "<h2>" + esc(t("🔒 Spiele geschützt")) + "</h2>" +
        "<p>" + esc(t("PIN eingeben, um den Tracker zu öffnen.")) + "</p>" +
        '<form class="mt-pin-form">' +
          '<input type="password" inputmode="numeric" maxlength="12" placeholder="PIN" aria-label="PIN" autocomplete="off">' +
        "</form>" +
      "</div></div>";
  }

  function isIos() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function renderSignIn(gate) {
    /* In an iOS home-screen app the Google sign-in cannot complete: the popup
       cannot message back into the standalone webview and the redirect flow
       loses its session to storage partitioning — and iOS standalone storage
       is separate from Safari, so signing in there does not carry over either.
       Be honest about it instead of looping through the account picker. */
    if (inStandalonePwa() && isIos() && !sameOriginAuth()) {
      gate.innerHTML = card(t("Deine Spieldaten sind privat"),
        "<p>" + esc(t("Die Google-Anmeldung funktioniert in der installierten App auf dem iPhone leider nicht (Apple-Einschränkung). Bitte diesen Bereich in Safari öffnen und dort anmelden.")) + "</p>" +
        '<div class="mt-card-actions"><button type="button" class="btn" data-mt="copylink">' + esc(t("Link kopieren")) + "</button></div>",
        "mt-auth");
      return;
    }
    gate.innerHTML = card(t("Deine Spieldaten sind privat"),
      "<p>" + esc(t("Melde dich mit deinem Google-Konto an. Nur dein Konto darf diese Spiele lesen und schreiben — das erzwingen die Firestore-Regeln, nicht der PIN.")) + "</p>" +
      '<div class="mt-card-actions"><button type="button" class="btn primary" data-mt="signin">' + esc(t("Mit Google anmelden")) + "</button></div>",
      "mt-auth");
  }

  function renderSetup(gate) {
    const u = currentUser();
    const id = u ? u.uid : "";
    gate.innerHTML = card(t("Einrichtung nötig"),
      "<p>" + esc(tt("Angemeldet als {0}", (u && (u.email || u.displayName)) || "—")) + "</p>" +
      "<p>" + esc(t("Firestore verweigert den Zugriff. Trage die UID unten in firestore.rules als OWNER_UID ein und veröffentliche die Regeln neu (README → „Match Tracker setup“).")) + "</p>" +
      '<code class="mt-uid" id="mtUid">' + esc(id) + "</code>" +
      '<div class="mt-card-actions">' +
        '<button type="button" class="btn primary" data-mt="copyuid">' + esc(t("UID kopieren")) + "</button>" +
        '<button type="button" class="btn" data-mt="retry">' + esc(t("Erneut prüfen")) + "</button>" +
        '<button type="button" class="btn" data-mt="signout">' + esc(t("Abmelden")) + "</button>" +
      "</div>" +
      '<p class="hint mt-hint">firestore.rules → OWNER_UID = "' + esc(OWNER_UID_PLACEHOLDER) + '"</p>',
      "mt-setup");
  }

  function renderNoSdk(gate) {
    gate.innerHTML = card(t("Firestore-SDK nicht geladen"),
      "<p>" + esc(t("Das Firestore-SDK konnte nicht geladen werden. Internetverbindung prüfen und die Seite neu laden.")) + "</p>",
      "mt-setup");
  }

  function render() {
    const p = ensureSkeleton();
    if (!p) return;
    const gate = document.getElementById("mtGate");
    if (!gate) return;
    renderSync();

    if (!pinOk()) { unmountView(); state.phase = "locked"; renderPinGate(gate); return; }

    if (!state.booted) { bootUi(); }

    if (state.sdkError) { unmountView(); state.phase = "error"; renderNoSdk(gate); return; }
    if (!state.db || state.phase === "loading" || state.phase === "idle") {
      unmountView();
      gate.innerHTML = '<p class="empty-note">' + esc(t("Verbinde…")) + "</p>";
      return;
    }
    if (!isOwner()) { unmountView(); gate.innerHTML = ""; renderSignIn(gate); return; }
    if (state.access === "denied") { unmountView(); renderSetup(gate); return; }

    if (!document.getElementById("mtViewHost")) {
      unmountView();
      gate.innerHTML = '<div class="seg-tabs mt-subnav" id="mtSubnav" role="tablist" aria-label="' + esc(t("Spiele")) + '"></div>' +
        '<div id="mtViewHost"></div>';
    }
    state.phase = "ready";
    renderViews();
  }

  async function bootUi() {
    if (state.booted) return;
    state.booted = true;
    state.phase = "loading";
    try {
      await ready;
      await checkAccess();
    } catch (e) {
      console.error("[MT] Boot:", e);
    }
    state.phase = state.sdkError ? "error" : "authed";
    if (isVisible()) render();
  }

  async function checkAccess() {
    if (!state.db || !isOwner()) { state.access = "unknown"; return state.access; }
    try {
      await state.db.collection(COL.players).limit(1).get();
      state.access = "ok";
    } catch (e) {
      if (e && e.code === "permission-denied") state.access = "denied";
      else { console.warn("[MT] Zugriffsprüfung nicht möglich:", e && e.code ? e.code : e); state.access = "ok"; }
    }
    return state.access;
  }

  /* ================= events ================= */
  function onGateClick(e) {
    if (!e.target || typeof e.target.closest !== "function") return;
    const btn = e.target.closest("[data-mt]");
    if (btn && panelEl() && panelEl().contains(btn)) {
      const act = btn.dataset.mt;
      if (act === "signin") { signIn(); return; }
      if (act === "signout") { signOut(); return; }
      if (act === "copylink") {
        const url = location.origin + location.pathname + "#tracker";
        navigator.clipboard.writeText(url)
          .then(() => toast(t("Link kopiert — in Safari einfügen")))
          .catch(() => toast(url));
        return;
      }
      if (act === "retry") {
        btn.disabled = true;
        checkAccess().then(() => { state.phase = "authed"; render(); });
        return;
      }
      if (act === "copyuid") {
        const u = currentUser();
        copyText(u ? u.uid : "");
        return;
      }
    }
    const vb = e.target.closest("[data-mtview]");
    if (vb && panelEl() && panelEl().contains(vb)) showView(vb.dataset.mtview);
  }

  function copyText(text) {
    if (!text) return;
    const done = () => toast(t("UID kopiert"));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      ta.remove();
      done();
    } catch (e) { toast(t("Kopieren fehlgeschlagen")); }
  }

  document.addEventListener("click", onGateClick);

  /* PIN form: auto-submit at 4+ chars mirrors the global gate's behaviour */
  document.addEventListener("input", function (e) {
    if (!e.target || typeof e.target.closest !== "function") return;
    const inp = e.target.closest("form.mt-pin-form input");
    if (!inp || inp.value.trim().length < 4) return;
    if (inp.form.requestSubmit) inp.form.requestSubmit();
    else inp.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  document.addEventListener("submit", async function (e) {
    if (!e.target || typeof e.target.closest !== "function") return;
    const form = e.target.closest("form.mt-pin-form");
    if (!form) return;
    e.preventDefault();
    const inp = form.querySelector("input");
    let h = "";
    try { h = await sha256Hex(inp.value.trim()); } catch (err) {}
    if (h === PIN_HASH) {
      try {
        localStorage.setItem(PIN_UNLOCK_KEY, h);
        localStorage.setItem(PIN_LAST_KEY, String(Date.now()));
      } catch (err) {}
      toast(t("Entsperrt"));
      render();
    } else {
      inp.value = "";
      toast(t("Falscher PIN"));
      inp.focus();
    }
  });

  /* keep the unlock alive while the tracker is actually being used */
  ["pointerdown", "keydown"].forEach(function (ev) {
    document.addEventListener(ev, function () { if (isVisible()) pinTouch(); }, { passive: true });
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") checkPinExpiry();
  });
  setInterval(checkPinExpiry, 60000);

  window.addEventListener("online", renderSync);
  window.addEventListener("offline", renderSync);

  try {
    firebase.auth().onAuthStateChanged(function (u) {
      state.user = u || null;
      if (!state.booted) return;
      state.access = "unknown";
      if (isOwner()) {
        checkAccess().then(function () { if (isVisible()) render(); });
      } else if (isVisible()) render();
    });
  } catch (e) { console.warn("[MT] onAuthStateChanged nicht verfügbar:", e); }

  /* English tab label + placeholder — app.js applied its static list before
     this file loaded, so the new tab is not covered by it. */
  if (LANG === "en") {
    const lbl = document.querySelector("#tabbtn-tracker .tlabel");
    if (lbl) lbl.textContent = "Results";
    const sub = document.querySelector("#tab-tracker .tab-sub");
    if (sub) sub.textContent = "Loading match tracker …";
  }

  /* Core registers the default view; tracker-entry.js replaces it with the real one. */
  registerView("entry", {
    label: t("Eintrag"),
    mount: function (host) { host.innerHTML = '<p class="empty-note">' + esc(t("Verbinde…")) + "</p>"; },
    unmount: function () {},
  });

  /* Boot lazily: nothing is read from Firestore until the tab is opened. */
  function onVisibility() {
    if (!isVisible()) return;
    checkPinExpiry();
    render();
  }
  const panel = panelEl();
  if (panel) {
    new MutationObserver(onVisibility).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
    /* app.js already ran showTab() — if the tracker is the active tab, start now
       (deferred so tracker-entry.js can replace the placeholder view first). */
    if (!panel.hidden) setTimeout(onVisibility, 0);
  }

  /* ================= public API ================= */
  api.ready = ready;
  api.currentUser = currentUser;
  api.isOwner = isOwner;
  api.uid = uid;
  api.signIn = signIn;
  api.signOut = signOut;
  api.keys = keys;
  api.weekRange = weekRange;
  api.fmtDate = fmtDate;
  api.toDate = toDate;
  api.deriveWinner = deriveWinner;
  api.gameWinner = gameWinner;
  api.matchWinner = matchWinner;
  api.repo = repo;
  api.registerView = registerView;
  api.showView = showView;
  api.render = render;
  api.noteSync = noteSync;
  api.toastError = toastError;
  api.openPlayerProfile = function (playerId) {
    void playerId;
    toast(t("Profil folgt"));
  };
  api.DEFAULT_CLUB = DEFAULT_CLUB;
  api.DEFAULT_LOCATION = DEFAULT_LOCATION;
  api.PIN_TIMEOUT_MIN = MT_PIN_TIMEOUT_MIN;
  api.COL = COL;

  return api;
})();

window.MT = MT;
