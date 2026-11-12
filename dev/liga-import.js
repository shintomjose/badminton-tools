#!/usr/bin/env node
/* Liga import from badhub: logs my matches of every played fixture of the
   Termine schedule (app.js) into Firestore, with the official team result
   as league.score + scoreFixed — the same shape the tracker writes.

   Preview (writes nothing):   node dev/liga-import.js
   Write:                      node dev/liga-import.js --apply
   One fixture only:           --fixture 2026-11-14-1400
   Player found under another name:   --map "Badhub Name=Name in der App"
   Player who really is new:          --new "Badhub Name"

   Needs the service-account key badminton-tools-c6b27-*.json in the repo root
   (gitignored) and `npm install` in dev/. Slots already in a fixture's session
   are left alone, so running it twice changes nothing. */
"use strict";
process.env.TZ = "Europe/Berlin";

const fs = require("fs");
const path = require("path");

/* the season's group on badhub — change with the season */
const BADHUB = { org: "bwbv", gruppe: 40690, saison: "26/27" };
const DEFAULT_CLUB = "TSG Heilbronn";
const SLOTS = ["HD1", "HD2", "DD", "HE1", "HE2", "HE3", "DE", "GD"];
const DISCIPLINE = { HD1: "doubles", HD2: "doubles", DD: "doubles", HE1: "singles", HE2: "singles", HE3: "singles", DE: "singles", GD: "mixed" };

const ROOT = path.resolve(__dirname, "..");

/* ---------- args ---------- */
const argv = process.argv.slice(2);
const opt = { apply: false, fixture: null, map: {}, isNew: new Set() };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--apply") opt.apply = true;
  else if (a === "--fixture") opt.fixture = argv[++i];
  else if (a === "--map") { const [from, to] = String(argv[++i] || "").split("="); opt.map[norm(from)] = to; }
  else if (a === "--new") opt.isNew.add(norm(argv[++i]));
  else { console.error("Unbekannte Option: " + a); process.exit(2); }
}

/* ---------- helpers ---------- */
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ").trim();
}
/* "Mathew Jose, Shinto" and "Shinto Mathew Jose" give the same set */
function tokens(s) { return norm(s).split(/[\s,.\-]+/).filter(t => t.length >= 2); }
function sameSet(a, b) { return a.length === b.length && a.every(t => b.indexOf(t) >= 0); }
function shared(a, b) { return a.filter(t => b.indexOf(t) >= 0).length; }
function teamKey(s) { return norm(s).replace(/\s+/g, ""); }
function decode(s) {
  return String(s || "").replace(/<wbr\s*\/?>/g, "").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}
function pad2(n) { return String(n).padStart(2, "0"); }
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { weekYear: t.getUTCFullYear(), week: Math.ceil(((t - y0) / 86400000 + 1) / 7) };
}
function keys(d) {
  const w = isoWeek(d);
  return {
    dateKey: d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()),
    weekKey: w.weekYear + "-W" + pad2(w.week),
    yearKey: String(d.getFullYear()),
  };
}
function winner(games) {
  let a = 0, b = 0;
  games.forEach(g => { if (g.a >= 21 && g.a > g.b) a++; else if (g.b >= 21 && g.b > g.a) b++; });
  return a > b ? "A" : b > a ? "B" : null;
}
/* "Sai Kumar Reddy Guda Vadla" + "S. Guda Vadla" → "Guda Vadla, Sai Kumar Reddy" */
function appName(full, short) {
  const sur = String(short || "").replace(/^\S+\.\s*/, "").trim();
  if (sur && full.endsWith(" " + sur)) return sur + ", " + full.slice(0, -sur.length - 1).trim();
  const parts = full.split(" ");
  return parts.length > 1 ? parts.pop() + ", " + parts.join(" ") : full;
}

/* ---------- schedule from app.js ---------- */
function schedule() {
  const src = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const team = (/window\.LEAGUE_TEAM\s*=\s*"([^"]+)"/.exec(src) || [])[1];
  const name = (/window\.LEAGUE_NAME\s*=\s*"([^"]+)"/.exec(src) || [])[1] || "";
  const block = (/const MATCHES = \[([\s\S]*?)\n\];/.exec(src) || [])[1] || "";
  const fixtures = [];
  block.replace(/\{([^}]*)\}/g, (_, body) => {
    const g = k => (new RegExp(k + ':\\s*"([^"]*)"').exec(body) || [])[1];
    fixtures.push({ id: g("id"), round: g("round") || "", time: g("time"), opponent: g("opp"), home: /home:\s*true/.test(body) });
  });
  return { team, division: name.replace(/\s*\d{4}\/\d{2}$/, ""), fixtures };
}
function fixtureDate(f) {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/.exec(f.id);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

/* ---------- badhub ---------- */
async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": "badminton-tools liga-import" } });
  if (!r.ok) throw new Error(url + " → HTTP " + r.status);
  return r.text();
}
async function badhubFixtures() {
  const url = "https://badhub.de/" + BADHUB.org + "/tabelle.php?gruppe=" + BADHUB.gruppe + "&saison=" + encodeURIComponent(BADHUB.saison);
  const html = await get(url);
  const out = [];
  for (const row of html.match(/<tr[^>]*row--clickable[\s\S]*?<\/tr>/g) || []) {
    const id = (/begegnung\.php\?id=(\d+)/.exec(row) || [])[1];
    const dt = /(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/.exec(decode((/class="date-long">([\s\S]*?)<\/span>/.exec(row) || [])[1]));
    const home = decode((/td-team--home[^>]*>([\s\S]*?)<\/td>/.exec(row) || [])[1]);
    const guest = decode((/td-team--guest[^>]*>([\s\S]*?)<\/td>/.exec(row) || [])[1]);
    const pts = [...row.matchAll(/score-pt[^>]*>(\d+)</g)].map(m => +m[1]);
    if (!id || !dt) continue;
    out.push({
      id, home, guest,
      key: dt[3] + "-" + dt[2] + "-" + dt[1] + "-" + dt[4] + dt[5],
      score: pts.length === 2 ? { home: pts[0], guest: pts[1] } : null,
      provisional: /badge--open/.test(row),
    });
  }
  return out;
}
function sideNames(td) {
  return [...td.matchAll(/class="name-full">([^<]*)<\/span><span class="name-short">([^<]*)</g)]
    .map(m => ({ full: decode(m[1]), short: decode(m[2]) }));
}
async function badhubRubbers(id) {
  const html = await get("https://badhub.de/" + BADHUB.org + "/begegnung.php?id=" + id);
  return (html.match(/<tr class="bericht-row[\s\S]*?<\/tr>/g) || []).map(row => {
    const tds = row.match(/<td[\s\S]*?<\/td>/g) || [];
    const disc = decode((/disziplin-name">([^<]*)</.exec(row) || [])[1]);   // "1.HD", "DD", "GD"
    const m = /^(\d)\.(\w+)$/.exec(disc);
    return {
      slot: m ? m[2] + m[1] : disc,
      walkover: /badge[^>]*>\s*WO\s*</.test(row),
      home: sideNames(tds[0] || ""), guest: sideNames(tds[2] || ""),
      games: [...row.matchAll(/set-score">(\d+):(\d+)</g)].map(s => ({ home: +s[1], guest: +s[2] })),
    };
  });
}

/* ---------- main ---------- */
(async () => {
  const keyFile = fs.readdirSync(ROOT).find(f => /^badminton-tools-c6b27-.*\.json$/.test(f));
  if (!keyFile) { console.error("Kein Service-Account-Key (badminton-tools-c6b27-*.json) im Repo-Root."); process.exit(1); }
  const admin = require("firebase-admin");
  admin.initializeApp({ credential: admin.credential.cert(require(path.join(ROOT, keyFile))) });
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const sched = schedule();
  const ourKey = teamKey(sched.team);
  const playersSnap = await db.collection("players").get();
  const players = playersSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  const me = players.find(p => p.isMe);
  if (!me) throw new Error("Kein Spieler mit isMe");
  const owner = me.ownerUid;

  /* badhub name → player; returns { player } | { create } | { unresolved } */
  function resolve(n, club) {
    const k = norm(n.full);
    if (opt.map[k]) {
      const hit = players.filter(p => norm(p.name) === norm(opt.map[k]));
      return hit.length === 1 ? { player: hit[0], how: "--map" } : { unresolved: "„" + opt.map[k] + "“ nicht eindeutig gefunden" };
    }
    if (opt.isNew.has(k)) return { create: appName(n.full, n.short), club };
    const t = tokens(n.full);
    const exact = players.filter(p => sameSet(tokens(p.name), t));
    if (exact.length === 1) return { player: exact[0], how: "=" };
    if (exact.length > 1) {
      const sameClub = exact.filter(p => p.club === club);
      if (sameClub.length === 1) return { player: sameClub[0], how: "=" };
      return { unresolved: "mehrfach: " + exact.map(p => p.name + " [" + p.club + "]").join(" | ") };
    }
    const strong = players.filter(p => shared(tokens(p.name), t) >= 2);
    if (strong.length === 1) return { player: strong[0], how: "~" };
    const weak = players.filter(p => shared(tokens(p.name), t) >= 1 && t.length > 1);
    if (strong.length || weak.length) {
      return { unresolved: "ähnlich: " + strong.concat(weak).slice(0, 5).map(p => p.name + " [" + p.club + "]").join(" | ") };
    }
    return { create: appName(n.full, n.short), club };
  }

  const today = new Date();
  const played = sched.fixtures.filter(f => (!opt.fixture || f.id === opt.fixture) && fixtureDate(f) <= today);
  if (!played.length) { console.log("Keine gespielten Spieltage im Plan" + (opt.fixture ? " für " + opt.fixture : "") + "."); return; }
  const remote = await badhubFixtures();

  const plan = [];      // { f, sess, score, add: [...], sessPatch }
  const unresolved = [];
  const toCreate = new Map();   // norm(full) → { name, club }

  for (const f of played) {
    const b = remote.find(r => r.key === f.id && (teamKey(r.home) === ourKey || teamKey(r.guest) === ourKey));
    if (!b) { console.log(f.id + "  " + f.opponent + ": nicht auf badhub gefunden"); continue; }
    if (!b.score) { console.log(f.id + "  " + f.opponent + ": noch kein Ergebnis"); continue; }
    const weHome = teamKey(b.home) === ourKey;
    const score = weHome ? { us: b.score.home, them: b.score.guest } : { us: b.score.guest, them: b.score.home };

    const sSnap = await db.collection("sessions").where("fixtureId", "==", f.id).get();
    const sess = sSnap.docs.map(d => Object.assign({ id: d.id, ref: d.ref }, d.data())).find(s => s.ownerUid === owner) || null;
    const have = new Set();
    if (sess) {
      const mSnap = await db.collection("matches").where("sessionId", "==", sess.id).get();
      mSnap.docs.forEach(d => { const m = d.data(); if (m.ownerUid === owner && m.slot) have.add(m.slot); });
    }

    const add = [];
    for (const r of await badhubRubbers(b.id)) {
      const ours = weHome ? r.home : r.guest, theirs = weHome ? r.guest : r.home;
      const ourRes = ours.map(n => Object.assign({ n }, resolve(n, DEFAULT_CLUB)));
      if (!ourRes.some(x => x.player && x.player.id === me.id)) continue;
      if (have.has(r.slot)) { add.push({ slot: r.slot, skip: "schon eingetragen" }); continue; }
      if (r.walkover) { add.push({ slot: r.slot, skip: "kampflos (WO), nicht gespielt" }); continue; }
      const theirRes = theirs.map(n => Object.assign({ n }, resolve(n, f.opponent)));
      ourRes.concat(theirRes).forEach(x => {
        if (x.unresolved) unresolved.push(f.id + " " + r.slot + ": " + x.n.full + " — " + x.unresolved);
        if (x.create) toCreate.set(norm(x.n.full), { name: x.create, club: x.club });
      });
      const games = r.games.map(g => weHome ? { a: g.home, b: g.guest } : { a: g.guest, b: g.home });
      add.push({ slot: r.slot, ours: ourRes, theirs: theirRes, games });
    }

    const sessPatch = {};
    if (sess) {
      const lg = sess.league || {};
      const sc = lg.score || {};
      if (!lg.scoreFixed || sc.us !== score.us || sc.them !== score.them) Object.assign(sessPatch, { "league.score": score, "league.scoreFixed": true });
      if (!lg.division && sched.division) sessPatch["league.division"] = sched.division;
    }
    plan.push({ f, sess, score, add, sessPatch, provisional: b.provisional });
  }

  /* ---------- report ---------- */
  const label = x => x.player ? x.player.name + (x.how === "=" ? "" : " (" + x.how + " " + x.n.full + ")")
    : x.create ? x.create + " (neu, " + x.club + ")" : x.n.full + " (?)";
  for (const p of plan) {
    console.log("\n" + p.f.id + "  " + (p.f.home ? "vs " : "@ ") + p.f.opponent + "  " + p.score.us + ":" + p.score.them +
      (p.provisional ? "  (vorläufig)" : "") + (p.sess ? "" : "  [neue Session]"));
    if (!p.add.length) console.log("  keine Spiele von mir");
    p.add.forEach(a => {
      if (a.skip) { console.log("  = " + a.slot + "  " + a.skip); return; }
      const w = winner(a.games);
      console.log("  + " + a.slot.padEnd(4) + a.ours.map(label).join(" / ") + "  vs  " + a.theirs.map(label).join(" / ") +
        "   " + a.games.map(g => g.a + ":" + g.b).join(" ") + "  " + (w === "A" ? "Sieg" : w === "B" ? "Niederlage" : "?"));
    });
    Object.keys(p.sessPatch).forEach(k => console.log("  ~ " + k + " = " + JSON.stringify(p.sessPatch[k])));
  }
  if (toCreate.size) console.log("\nNeue Spieler: " + [...toCreate.values()].map(c => c.name + " [" + c.club + "]").join(", "));
  if (unresolved.length) {
    console.log("\nUngeklärte Namen — mit --map \"Badhub Name=App Name\" oder --new \"Badhub Name\" auflösen:");
    unresolved.forEach(u => console.log("  " + u));
  }
  const work = plan.some(p => p.add.some(a => !a.skip) || Object.keys(p.sessPatch).length);
  if (!opt.apply) { console.log("\nVorschau — nichts geschrieben." + (work ? " Mit --apply schreiben." : " Nichts zu tun.")); return; }
  if (unresolved.length) { console.log("\nAbbruch: erst die Namen klären."); process.exit(1); }
  if (!work) { console.log("\nNichts zu tun."); return; }

  /* ---------- write ---------- */
  const batch = db.batch();
  const created = new Map();
  for (const [k, c] of toCreate) {
    const ref = db.collection("players").doc();
    batch.set(ref, { name: c.name, club: c.club, active: true, isMe: false, ownerUid: owner, createdAt: now, updatedAt: now });
    created.set(k, { id: ref.id, name: c.name, club: c.club });
  }
  const who = x => x.player || created.get(norm(x.n.full));
  for (const p of plan) {
    const date = fixtureDate(p.f), k = keys(date);
    const ts = admin.firestore.Timestamp.fromDate(date);
    let sessRef = p.sess && p.sess.ref, sData = p.sess;
    if (!sessRef && p.add.some(a => !a.skip)) {
      sessRef = db.collection("sessions").doc();
      sData = {
        date: ts, dateKey: k.dateKey, weekKey: k.weekKey, yearKey: k.yearKey,
        locationId: null, locationName: p.f.home ? "Heimspiel" : "Auswärts · " + p.f.opponent,
        type: "league", note: "", fixtureId: p.f.id,
        league: { fixtureId: p.f.id, opponent: p.f.opponent, home: p.f.home, round: p.f.round, time: p.f.time,
          team: sched.team, score: p.score, scoreFixed: true, division: sched.division },
        tournamentName: null, tournamentCategory: null, tournamentDisciplines: null, tournamentPartners: null,
        ownerUid: owner, createdAt: now, updatedAt: now,
      };
      batch.set(sessRef, sData);
    } else if (sessRef && Object.keys(p.sessPatch).length) {
      batch.update(sessRef, Object.assign({ updatedAt: now }, p.sessPatch));
    }
    for (const a of p.add) {
      if (a.skip) continue;
      const A = a.ours.map(who), B = a.theirs.map(who);
      const clubs = {};
      A.concat(B).forEach(pl => { clubs[pl.id] = pl.club || DEFAULT_CLUB; });
      const ids = A.concat(B).map(pl => pl.id);
      const w = winner(a.games);
      batch.set(db.collection("matches").doc(), {
        sessionId: sessRef.id, date: ts, dateKey: k.dateKey, weekKey: k.weekKey, yearKey: k.yearKey,
        locationName: sData.locationName, type: "league", discipline: DISCIPLINE[a.slot] || "doubles", targetScore: 21,
        sideA: { playerIds: A.map(x => x.id), playerNames: A.map(x => x.name) },
        sideB: { playerIds: B.map(x => x.id), playerNames: B.map(x => x.name) },
        playerIds: ids, playerClubs: clubs, games: a.games, status: "finished", resultType: "normal",
        retiredSide: null, winnerSide: w, involvesMe: ids.indexOf(me.id) >= 0, note: "",
        seq: SLOTS.indexOf(a.slot), round: null, category: null, opponentClub: p.f.opponent, tournament: null,
        slot: a.slot, league: { fixtureId: p.f.id, opponent: p.f.opponent, home: p.f.home, team: (sData.league && sData.league.team) || sched.team },
        ownerUid: owner, createdAt: now, updatedAt: now,
      });
    }
  }
  await batch.commit();
  console.log("\nGeschrieben.");
})().catch(e => { console.error(e && e.message || e); process.exit(1); });
