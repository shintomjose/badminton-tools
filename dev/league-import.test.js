/* Tests for tracker-league-import.js — run with: node dev/league-import.test.js
   Three real copies of nuLiga team-match reports: the report page copied from
   the browser, the PDF's text, and the PDF copied out of a browser viewer. */
"use strict";
const assert = require("assert");
const { parse } = require("../tracker-league-import.js");

/* the club licence list, as app.js carries it (the names that matter here) */
const KNOWN = [
  "Pelzl, Oskar", "Guda Vadla, Sai Kumar Reddy", "Bolt-Bevilacqua, Nicolas", "Chu, Cuong Xuan",
  "Amalraj, Gnana", "Zhao, Chengchen", "Dujic, Lucija", "Croll, Alessia",
  "Prabhala, Shreyash Mohit", "Cherian, Sanju", "Mathew Jose, Shinto", "Banik, Udayan",
  "Schebesch, Carolin", "Schebesch, Marc",
];

/* ---- 1. the report page, copied from the browser (tabs between cells) ---- */
const HTML_COPY = [
  "Mannschaftsmeisterschaft 2026/2027 - Bezirk Nordbaden",
  'Bezirksliga "Neckar-Odenwald" (3-4)',
  "SG Heilbronn/Leingarten V",
  "          - ",
  "          SG Heilbronn/Leingarten IV",
  "        , 10.10.2026, ",
  "        14:00 Uhr",
  "",
  "Spielbericht",
  "",
  "\tSG Heilbronn/Leingarten V\tSG Heilbronn/Leingarten IV\t1. Satz\t2. Satz\t3. Satz\tSpielpunkte\tSätze\tSpiele\t",
  "1.HD\tPelzl, Oskar",
  " ",
  "",
  " Guda Vadla, Sai Kumar Reddy\tBolt-Bevilacqua, Nicolas",
  " ",
  "",
  " Chu, Cuong Xuan\t11:21\t11:21\t\t22:42\t0:2\t0:1\t",
  "DD\tAmalraj, Gnana",
  " ",
  "",
  " Zhao, Chengchen\tDujic, Lucija",
  " ",
  "",
  " Croll, Alessia\t11:21\t10:21\t\t21:42\t0:2\t0:1\t",
  "2.HD\tPrabhala, Shreyash Mohit",
  " ",
  "",
  " Cherian, Sanju\tMathew Jose, Shinto",
  " ",
  "",
  " Banik, Udayan\t12:21\t11:21\t\t23:42\t0:2\t0:1\t",
  "\t",
  "1.HE\tGuda Vadla, Sai Kumar Reddy\tBolt-Bevilacqua, Nicolas\t5:21\t9:21\t\t14:42\t0:2\t0:1\t",
  "DE\tAmalraj, Gnana\tDujic, Lucija\t5:21\t4:21\t\t9:42\t0:2\t0:1\t",
  "\t",
  "GD\tPelzl, Oskar",
  " ",
  "",
  " Zhao, Chengchen\tMathew Jose, Shinto",
  " ",
  "",
  " Schebesch, Carolin\t19:21\t10:21\t\t29:42\t0:2\t0:1\t",
  "\t",
  "2.HE\tPrabhala, Shreyash Mohit\tChu, Cuong Xuan\t7:21\t6:21\t\t13:42\t0:2\t0:1\t",
  "3.HE\tCherian, Sanju\tBanik, Udayan\t13:21\t9:21\t\t22:42\t0:2\t0:1\t",
  "\t\t153:336\t0:16\t0:8\tSpielbeginn: 14:00 Uhr - Spielende: 16:43 Uhr",
  "",
  "Spielbericht noch nicht genehmigt.",
].join("\n");

/* ---- 2. the PDF's text (pdftotext -raw), an older report with a walkover and a three-set match ---- */
const PDF_TEXT = `Mannschaftsmeisterschaft 2018/2019 - Bezirk Nordbaden
Bezirksliga "Neckar-Odenwald" (3-4)
Spielbericht (genehmigt)
TSV Pfedelbach : SG Heilbronn/Leingarten V - 5 : 3
09.02.2019, 19:00 Uhr
TSV Pfedelbach SG Heilbronn/Leingarten V 1. Satz 2. Satz 3. Satz Spielpunkte Sätze Spiele
Stahl, Holger Keller, Christoph
1.HD
Schmied, Thorsten Wagner, Klaus
21:10 21:14 42:24 2:0 1:0
Boß, Pascale nicht anwesend/nicht angetreten
DD
Schilling, Janina nicht anwesend/nicht angetreten
21:0 21:0 42:0 2:0 1:0
Dr. Haemisch, Jan Schuster, Ralf
2.HD
Traub, Jochen Krieger, Michael
10:21 15:21 25:42 0:2 0:1
1.HE Stahl, Holger Keller, Christoph 21:9 21:16 42:25 2:0 1:0
DE Schilling, Janina Wenninger, Carolin 15:21 16:21 31:42 0:2 0:1
Traub, Jochen Krieger, Michael
GD
Boß, Pascale Wenninger, Carolin
13:21 14:21 27:42 0:2 0:1
2.HE Schmied, Thorsten Schuster, Ralf 21:7 21:6 42:13 2:0 1:0
3.HE Dr. Haemisch, Jan Wagner, Klaus 16:21 21:19 21:17 58:57 2:1 1:0
309:245 10:7 5:3
Spielbeginn: 19:00 Uhr - Spielende: 21:00
Letzte Änderung Verein: 10.02.19 12:00
Letzte Änderung Admin: 13.02.19 19:38
nu.Dokument 011e, erstellt am 11.10.2026 17:42 11.10.2026 17:42 | Seite 1`;

/* ---- 3. the PDF copied out of a browser viewer: columns interleaved, cells glued ---- */
const VIEWER_GARBLE = `Bezirksliga "Neckar-Odenwald" (3-4)
SG Heilbronn/Leingarten V - SG Heilbronn/Leingarten IV , 10.10.2026, 14:00 Uhr
Spielbericht
     SG Heilbronn/Leingarten V    SG Heilbronn/Leingarten IV    1. Satz    2. Satz    3. Satz    Spielpu1.HD    Pelzl, Oskar
Guda Vadla, Sai Kumar Reddy    Bolt-Bevilacqua, Nicolas
Chu, Cuong Xuan    11:21      11:21           22:42      0:2      Zhao, ChengchenDujic, Lucija0:1
DD    Amalraj, Gnana
nkte    Sätze    Spiele
Croll, Alessia    11:21      10:21           21:42      0:2      0:1
2.HD    Prabhala, Shreyash Mohit
Cherian, Sanju    Mathew Jose, Shinto
Banik, Udayan    12:21      111.HE    Guda Vadla, Sai Kumar Reddy    Bolt-Bevilacqua, Nicolas    5:21      9:21           14:42      0:2      0:1
DE    Amalraj, Gnana    Dujic, Lucija    5:21      4:21           9:42      0:2      0:1

GD    Pelzl, Oskar
Zhao, Chengchen    Mathew Jose, Shinto
Schebesch, Carolin    19:21      10:21           29:42      0:2      0:1

2.HE    Pr3.HE    Cherian, Sanju    Banik, Udayan    13:21      9:21           22:42      0:2      0:1
          153:336    0:16    0:8abhala, Shreyash Mohit    Chu, Cuong Xuan    7:21      6:21           13:42      0:2      0:1
:21           23:42      0:2      0:1`;

/* the fixtures double as sample input for a browser run */
module.exports = { HTML_COPY, PDF_TEXT, VIEWER_GARBLE, KNOWN };
if (require.main !== module) return;

function slot(r, s) { return r.slots.find(x => x.slot === s); }
function sets(r, s) { return slot(r, s).sets.map(x => x.h + ":" + x.a).join(" "); }
function pair(list) { return list.slice().sort().join(" / "); }

let failed = 0;
function test(name, fn) {
  try { fn(); console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + (e.message || e)); }
}

test("HTML copy: header", () => {
  const r = parse(HTML_COPY, { known: KNOWN });
  assert.strictEqual(r.home, "SG Heilbronn/Leingarten V");
  assert.strictEqual(r.away, "SG Heilbronn/Leingarten IV");
  assert.strictEqual(r.date, "2026-10-10");
  assert.strictEqual(r.time, "14:00");
  assert.deepStrictEqual(r.total, { home: 0, away: 8 });
});

test("HTML copy: every slot, pairs and sets", () => {
  const r = parse(HTML_COPY, { known: KNOWN });
  assert.strictEqual(pair(slot(r, "HD1").home), "Guda Vadla, Sai Kumar Reddy / Pelzl, Oskar");
  assert.strictEqual(pair(slot(r, "HD1").away), "Bolt-Bevilacqua, Nicolas / Chu, Cuong Xuan");
  assert.strictEqual(sets(r, "HD1"), "11:21 11:21");
  assert.strictEqual(pair(slot(r, "DD").home), "Amalraj, Gnana / Zhao, Chengchen");
  assert.strictEqual(pair(slot(r, "DD").away), "Croll, Alessia / Dujic, Lucija");
  assert.strictEqual(pair(slot(r, "HD2").home), "Cherian, Sanju / Prabhala, Shreyash Mohit");
  assert.strictEqual(pair(slot(r, "HD2").away), "Banik, Udayan / Mathew Jose, Shinto");
  assert.strictEqual(sets(r, "HD2"), "12:21 11:21");
  assert.deepStrictEqual(slot(r, "HE1").home, ["Guda Vadla, Sai Kumar Reddy"]);
  assert.deepStrictEqual(slot(r, "HE1").away, ["Bolt-Bevilacqua, Nicolas"]);
  assert.strictEqual(sets(r, "HE1"), "5:21 9:21");
  assert.deepStrictEqual(slot(r, "DE").away, ["Dujic, Lucija"]);
  assert.strictEqual(sets(r, "DE"), "5:21 4:21");
  assert.strictEqual(pair(slot(r, "GD").home), "Pelzl, Oskar / Zhao, Chengchen");
  assert.strictEqual(pair(slot(r, "GD").away), "Mathew Jose, Shinto / Schebesch, Carolin");
  assert.strictEqual(sets(r, "GD"), "19:21 10:21");
  assert.strictEqual(sets(r, "HE2"), "7:21 6:21");
  assert.strictEqual(sets(r, "HE3"), "13:21 9:21");
  r.slots.forEach(s => assert.deepStrictEqual(s.issues, [], s.slot + " issues: " + s.issues));
});

test("PDF text: header with result, teams split on ':'", () => {
  const r = parse(PDF_TEXT, { known: [] });
  assert.strictEqual(r.home, "TSV Pfedelbach");
  assert.strictEqual(r.away, "SG Heilbronn/Leingarten V");
  assert.strictEqual(r.date, "2019-02-09");
  assert.strictEqual(r.time, "19:00");
  assert.deepStrictEqual(r.total, { home: 5, away: 3 });
});

test("PDF text: first pair above the label, no roster needed", () => {
  const r = parse(PDF_TEXT, { known: [] });
  assert.strictEqual(pair(slot(r, "HD1").home), "Schmied, Thorsten / Stahl, Holger");
  assert.strictEqual(pair(slot(r, "HD1").away), "Keller, Christoph / Wagner, Klaus");
  assert.strictEqual(sets(r, "HD1"), "21:10 21:14");
  assert.strictEqual(pair(slot(r, "HD2").home), "Dr. Haemisch, Jan / Traub, Jochen");
  assert.strictEqual(pair(slot(r, "HD2").away), "Krieger, Michael / Schuster, Ralf");
  assert.strictEqual(pair(slot(r, "GD").home), "Boß, Pascale / Traub, Jochen");
  assert.strictEqual(pair(slot(r, "GD").away), "Krieger, Michael / Wenninger, Carolin");
  assert.deepStrictEqual(slot(r, "HE3").home, ["Dr. Haemisch, Jan"]);
  assert.strictEqual(sets(r, "HE3"), "16:21 21:19 21:17");
  assert.strictEqual(sets(r, "HE2"), "21:7 21:6");
});

test("PDF text: walkover side has no players, is flagged", () => {
  const r = parse(PDF_TEXT, { known: [] });
  const dd = slot(r, "DD");
  assert.strictEqual(dd.walkover, "away");
  assert.strictEqual(pair(dd.home), "Boß, Pascale / Schilling, Janina");
  assert.deepStrictEqual(dd.away, []);
  assert.strictEqual(sets(r, "DD"), "21:0 21:0");
});

test("viewer garble: what survives, and honest issues for the rest", () => {
  const r = parse(VIEWER_GARBLE, { known: KNOWN });
  assert.strictEqual(r.home, "SG Heilbronn/Leingarten V");
  assert.strictEqual(r.away, "SG Heilbronn/Leingarten IV");
  assert.strictEqual(r.date, "2026-10-10");
  assert.strictEqual(pair(slot(r, "HD1").home), "Guda Vadla, Sai Kumar Reddy / Pelzl, Oskar");
  assert.strictEqual(pair(slot(r, "HD1").away), "Bolt-Bevilacqua, Nicolas / Chu, Cuong Xuan");
  assert.strictEqual(sets(r, "HD1"), "11:21 11:21");
  /* the DD away pair spilled into HD1's row; it is picked up as the carried pair */
  assert.strictEqual(pair(slot(r, "DD").home).indexOf("Amalraj, Gnana") >= 0, true);
  assert.strictEqual(sets(r, "DD"), "11:21 10:21");
  assert.strictEqual(pair(slot(r, "HD2").away), "Banik, Udayan / Mathew Jose, Shinto");
  assert.strictEqual(sets(r, "HD2"), "12:21");                 // the second set is lost in the copy …
  assert.ok(slot(r, "HD2").issues.indexOf("nur ein Satz") >= 0);   // … and the slot says so
  assert.strictEqual(sets(r, "HE1"), "5:21 9:21");
  assert.strictEqual(sets(r, "DE"), "5:21 4:21");
  assert.strictEqual(pair(slot(r, "GD").away), "Mathew Jose, Shinto / Schebesch, Carolin");
  assert.strictEqual(sets(r, "GD"), "19:21 10:21");
  assert.strictEqual(sets(r, "HE3"), "13:21 9:21");
  assert.deepStrictEqual(r.total, { home: 0, away: 8 });
});

test("empty and junk input", () => {
  const r = parse("", {});
  assert.strictEqual(r.slots.length, 8);
  r.slots.forEach(s => assert.deepStrictEqual(s.issues, ["fehlt"]));
  assert.strictEqual(r.total, null);
});

if (failed) { console.log(failed + " failing"); process.exit(1); }
console.log("all passing");
