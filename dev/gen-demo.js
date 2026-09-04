/* Generates demo-data.json: same document shape as the Firestore collections
   (sessions, matches, players, locations), dates as ISO strings. Deterministic. */
"use strict";
const fs = require("fs");
const OUT = process.argv[2];
const TODAY = new Date(2026, 8, 3, 0, 0, 0, 0);          // 2026-09-03 (local)
const OWNER = "demo-owner";
const CLUB = "TSG Heilbronn";
const HALL = "TSG Heilbronn Hall";

/* ---- seeded PRNG (mulberry32) ---- */
let seed = 20260903;
function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---- date keys (same rules as tracker-core.js) ---- */
function pad2(n) { return String(n).padStart(2, "0"); }
function isoWeek(d) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dow);
  const y = dt.getUTCFullYear();
  const jan1 = new Date(Date.UTC(y, 0, 1));
  return { weekYear: y, week: Math.ceil(((dt - jan1) / 86400000 + 1) / 7) };
}
function keys(d) {
  const w = isoWeek(d);
  return { dateKey: d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()),
           weekKey: w.weekYear + "-W" + pad2(w.week), yearKey: String(d.getFullYear()) };
}
function at(d, h, m) { const x = new Date(d); x.setHours(h, m, 0, 0); return x; }
function iso(d) { return d.toISOString(); }

/* ---- roster ---- */
let idn = 0;
function id(prefix) { return prefix + "-" + String(++idn).padStart(3, "0"); }
const players = [];
function addPlayer(name, club, isMe) {
  const p = { id: id("p"), name, club, active: true, isMe: !!isMe, ownerUid: OWNER,
              createdAt: iso(new Date(2024, 11, 20, 18, 0)), updatedAt: iso(new Date(2024, 11, 20, 18, 0)) };
  players.push(p); return p;
}
const ME = addPlayer("Mathew Jose, Shinto", CLUB, true);
const club = ["Weber, Nicolas", "Hoffmann, Lena", "Becker, Jonas", "Schulz, Mira", "Krüger, Tobias", "Lindner, Anna", "Brandt, Felix", "Kaiser, David"].map(n => addPlayer(n, CLUB));
const guests = [
  addPlayer("Roth, Daniel", "BC Neckarsulm"), addPlayer("Klein, Sophie", "BC Neckarsulm"),
  addPlayer("Vogt, Markus", "SV Böckingen"), addPlayer("Berger, Julia", "TV Flein"),
  addPlayer("Ahmed, Samir", "TSV Öhringen"), addPlayer("Huber, Nina", "TSV Öhringen"),
  addPlayer("Fischer, Leon", "SG Bietigheim"), addPlayer("Maier, Clara", "SG Bietigheim"),
];
const women = new Set(["Hoffmann, Lena", "Schulz, Mira", "Lindner, Anna", "Klein, Sophie", "Berger, Julia", "Huber, Nina", "Maier, Clara"]);
const isW = p => women.has(p.name);

const locations = [
  { id: id("l"), name: HALL, isDefault: true, ownerUid: OWNER, createdAt: iso(new Date(2024, 11, 20, 18, 0)), updatedAt: iso(new Date(2024, 11, 20, 18, 0)) },
  { id: id("l"), name: "Sporthalle Böckingen", isDefault: false, ownerUid: OWNER, createdAt: iso(new Date(2025, 0, 10, 18, 0)), updatedAt: iso(new Date(2025, 0, 10, 18, 0)) },
];

/* ---- score generation ---- */
function gameScore(target, winnerIsA, close) {
  let w = target, l = close ? ri(target - 3, target - 1) : ri(Math.round(target * 0.35), target - 2);
  if (l >= target - 1) { const ext = ri(0, 3); w = target + ext; l = w - 2; if (target === 21 && w > 30) { w = 30; l = 29; } }
  return winnerIsA ? { a: w, b: l } : { a: l, b: w };
}
function bestOf3(target, aWins) {
  const games = [];
  const straight = rnd() < 0.55;
  if (straight) { games.push(gameScore(target, aWins, rnd() < 0.4)); games.push(gameScore(target, aWins, rnd() < 0.4)); }
  else { games.push(gameScore(target, aWins, true)); games.push(gameScore(target, !aWins, rnd() < 0.5)); games.push(gameScore(target, aWins, true)); }
  return games;
}

const sessions = [], matches = [];
function session(date, type, loc, extra) {
  const k = keys(date);
  const s = Object.assign({ id: id("s"), date: iso(date), dateKey: k.dateKey, weekKey: k.weekKey, yearKey: k.yearKey,
    locationId: loc.id, locationName: loc.name, type, note: "", tournamentName: null, tournamentCategory: null,
    ownerUid: OWNER, createdAt: iso(date), updatedAt: iso(date) }, extra || {});
  sessions.push(s); return s;
}
function match(s, seq, o) {
  const sa = o.sideA, sb = o.sideB;
  const discipline = o.discipline;
  const target = o.targetScore || (discipline === "singles" ? 11 : 21);
  const ids = sa.concat(sb).map(p => p.id);
  const clubs = {}; sa.concat(sb).forEach(p => { clubs[p.id] = p.club; });
  const status = o.status || "finished";
  const resultType = o.resultType || "normal";
  let games, winnerSide = null;
  if (status === "finished") {
    if (resultType === "retired") { games = [gameScore(target, o.aWins, true), o.aWins ? { a: ri(5, 12), b: ri(3, 9) } : { a: ri(3, 9), b: ri(5, 12) }]; winnerSide = o.aWins ? "A" : "B"; }
    else if (resultType === "incomplete") { games = [gameScore(target, o.aWins, false), { a: ri(4, 12), b: ri(4, 12) }]; winnerSide = null; }
    else { games = bestOf3(target, o.aWins); winnerSide = o.aWins ? "A" : "B"; }
  } else { games = [gameScore(target, o.aWins, true), { a: ri(3, 9), b: ri(3, 9) }]; }
  const created = new Date(new Date(s.date).getTime() + seq * ri(14, 22) * 60000);
  const m = {
    id: id("m"), sessionId: s.id, date: s.date, dateKey: s.dateKey, weekKey: s.weekKey, yearKey: s.yearKey,
    locationName: s.locationName, type: s.type, discipline, targetScore: target,
    sideA: { playerIds: sa.map(p => p.id), playerNames: sa.map(p => p.name) },
    sideB: { playerIds: sb.map(p => p.id), playerNames: sb.map(p => p.name) },
    playerIds: ids, playerClubs: clubs, games, status, resultType,
    retiredSide: resultType === "retired" ? (o.aWins ? "B" : "A") : null,
    winnerSide, involvesMe: ids.indexOf(ME.id) >= 0, note: o.note || "", seq,
    round: o.round || null, category: o.category || null, opponentClub: o.opponentClub || null,
    ownerUid: OWNER, createdAt: iso(created), updatedAt: iso(created),
  };
  matches.push(m); return m;
}

/* ---- training: Tuesdays + every third Thursday, minus breaks ---- */
function inBreak(d) {
  const m = d.getMonth(), day = d.getDate();
  if (m === 7 && day <= 24) return true;                 // summer hall closure
  if (m === 11 && day >= 20) return true;                // Christmas
  if (m === 0 && day <= 6) return true;
  return false;
}
function trainingMatches(s, meIn) {
  const n = ri(2, 4);
  const pool = shuffle(club).slice(0, ri(5, 7));
  for (let i = 1; i <= n; i++) {
    const withMe = meIn && (i <= n - 1 || rnd() < 0.7);
    const disc = pick(["singles", "singles", "doubles", "doubles", "mixed"]);
    let sa, sb;
    const others = shuffle(pool);
    if (disc === "singles") { sa = withMe ? [ME] : [others[0]]; sb = [withMe ? others[0] : others[1]]; }
    else if (disc === "doubles") { sa = withMe ? [ME, others[0]] : [others[0], others[1]]; sb = withMe ? [others[1], others[2]] : [others[2], others[3]]; }
    else {
      const w = shuffle(pool.filter(isW)), mn = shuffle(pool.filter(p => !isW(p)));
      if (w.length < 2 || mn.length < 1) { sa = withMe ? [ME] : [others[0]]; sb = [withMe ? others[0] : others[1]]; match(s, i, { discipline: "singles", sideA: sa, sideB: sb, aWins: rnd() < 0.58 }); continue; }
      sa = withMe ? [ME, w[0]] : [mn[0], w[0]]; sb = [withMe ? mn[0] : (mn[1] || others[0]), w[1]];
    }
    const r = rnd();
    const opts = { discipline: disc, sideA: sa, sideB: sb, aWins: withMe ? rnd() < 0.58 : rnd() < 0.5 };
    if (r < 0.04) opts.resultType = "retired"; else if (r < 0.07) opts.resultType = "incomplete";
    match(s, i, opts);
  }
}
for (let d = new Date(2025, 0, 7); d < TODAY; d.setDate(d.getDate() + 1)) {
  const dow = d.getDay();
  const isTue = dow === 2, isThu = dow === 4 && (isoWeek(d).week % 3 === 0);
  if (!(isTue || isThu) || inBreak(d)) continue;
  if (rnd() < 0.1) continue;                              // missed a session
  const s = session(at(d, isTue ? 19 : 20, 0), "training", rnd() < 0.15 ? locations[1] : locations[0]);
  trainingMatches(s, rnd() < 0.9);
}

/* ---- today: live session with an in-progress match (entry view) ---- */
{
  const s = session(at(TODAY, 19, 0), "training", locations[0]);
  match(s, 1, { discipline: "singles", sideA: [ME], sideB: [club[0]], aWins: true });
  match(s, 2, { discipline: "doubles", sideA: [ME, club[2]], sideB: [club[0], club[4]], aWins: false });
  match(s, 3, { discipline: "mixed", sideA: [ME, club[1]], sideB: [club[2], club[3]], aWins: true, status: "in_progress" });
}

/* ---- tournaments ---- */
/* category = tournament class letter ("A" | "B"); partner = { id, name } for
   doubles/mixed, stored on the session like the entry view does. */
function tournament(date, name, category, disc, partner, oppPool) {
  const partners = { doubles: null, mixed: null };
  if (partner) partners[disc] = { playerId: partner.id, playerName: partner.name };
  const s = session(at(date, 9, 30), "tournament", pick(locations), {
    tournamentName: name, tournamentCategory: category,
    tournamentDisciplines: [disc], tournamentPartners: partners,
  });
  const opp = shuffle(oppPool);
  const rounds = ["Gruppe", "Gruppe", "Gruppe", "R16", "VF", "HF", "Finale"];
  let seq = 0, alive = true;
  for (const round of rounds) {
    if (!alive) break;
    const o = opp[seq % opp.length];
    const sa = partner ? [ME, partner] : [ME];
    let sb;
    if (disc === "singles") sb = [o];
    else if (disc === "doubles") { const rest = opp.filter(x => x !== o); sb = [o, rest.find(x => x.club === o.club) || rest[seq % rest.length]]; }
    else { const mn = opp.filter(x => !isW(x)), wm = opp.filter(isW); sb = [mn[seq % mn.length], wm[seq % wm.length]]; }
    const grp = round === "Gruppe";
    const aWins = grp ? rnd() < 0.6 : rnd() < 0.5;
    seq++;
    match(s, seq, { discipline: disc, targetScore: 21, sideA: sa, sideB: sb, aWins, round, category, opponentClub: o.club });
    if (!grp && !aWins) alive = false;
    if (grp && seq === 3 && rnd() < 0.25) alive = false;  // did not leave the group
  }
}
const men = guests.filter(p => !isW(p));
tournament(new Date(2025, 2, 15), "Heilbronner Stadtmeisterschaft", "B", "singles", null, men);
tournament(new Date(2025, 5, 28), "Unterland Open", "B", "doubles", club[0], men);
tournament(new Date(2025, 10, 8), "Neckar Cup", "B", "mixed", club[1], guests);
tournament(new Date(2026, 2, 14), "Heilbronner Stadtmeisterschaft", "A", "singles", null, men);
tournament(new Date(2026, 5, 27), "Unterland Open", "B", "doubles", club[2], men);

/* ---- sort: sessions/matches by date asc ---- */
sessions.sort((a, b) => a.date.localeCompare(b.date));
matches.sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);

const out = { _comment: "Demo fixture for ?demo=1 - same shape as the Firestore docs, dates as ISO strings. Never written to Firestore.",
              generatedFor: keys(TODAY).dateKey, players, locations, sessions, matches };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
const by = {}; matches.forEach(m => { const k = m.yearKey + "/" + m.type; by[k] = (by[k] || 0) + 1; });
console.log("sessions", sessions.length, "matches", matches.length, by, "me-not-involved", matches.filter(m => !m.involvesMe).length);
