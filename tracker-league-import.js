/* ================= Match Tracker — Spielbericht parser =================
   Turns the text of a nuLiga team-match report ("Spielbericht") into the
   eight slots of a Bezirksliga tie: HD1, HD2, DD, HE1, HE2, HE3, DE, GD —
   each with the home pair, the away pair and the set scores as printed
   (home points first). Pure text in, plain object out: no DOM, no repo,
   no MT state, so it runs under node for its tests (dev/league-import.test.js).

   Three copies of the same report reach us, and all three must parse:
     · the report page copied from the browser — one row per slot, cells
       separated by tabs, the two players of a pair on separate lines;
     · the PDF's text (pdftotext -raw, most PDF viewers) — the FIRST player
       of each pair sits on the line ABOVE the slot label, the second on the
       line below it, both columns on one line a single space apart;
     · the PDF copied from a browser viewer — column text interleaved, names
       glued together, one row's cells spilling into the next.
   The strategy is therefore token-based, not line-based: cut the body at
   the slot labels, read names and scores in the order they appear, and let
   a doubles slot that found only one pair after its label take the pair
   that trailed the previous slot. Whatever still does not add up is
   reported per slot as an issue; the entry view shows every slot for
   correction before anything is written.
========================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.MT && typeof root.MT === "object") root.MT.parseSpielbericht = api.parse;
  if (root) root.LeagueImport = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null), function () {
  "use strict";

  /* playing order of the tie; the labels nuLiga prints for each slot */
  var SLOTS = ["HD1", "HD2", "DD", "HE1", "HE2", "HE3", "DE", "GD"];
  var LABELS = {
    "1.HD": "HD1", "2.HD": "HD2", "DD": "DD", "1.HE": "HE1", "2.HE": "HE2", "3.HE": "HE3", "DE": "DE", "GD": "GD",
    "HD1": "HD1", "HD2": "HD2", "HE1": "HE1", "HE2": "HE2", "HE3": "HE3",
  };
  var PAIR = { HD1: 2, HD2: 2, DD: 2, HE1: 1, HE2: 1, HE3: 1, DE: 1, GD: 2 };
  /* The dotted labels are unmistakable even glued to junk ("Spielpu1.HD",
     "111.HE" in a viewer copy); the two-letter ones must not sit inside a word. */
  var LABEL_RE = /(?:([123]\.H[DE])|(?<![A-Za-zÄÖÜäöüß])(HD1|HD2|HE1|HE2|HE3|DD|DE|GD))(?![A-Za-zÄÖÜäöüß0-9])/g;
  var SCORE_RE = /(\d{1,3}):(\d{1,3})/g;
  var WO = "__WO__";                       // "nicht anwesend/nicht angetreten"
  var WO_RE = /nicht\s+anwesend(?:\s*\/\s*nicht\s+angetreten)?|nicht\s+angetreten|kampflos|w\.?\s?o\.?(?![a-zäöüß])/gi;
  /* words that belong to the surname when they precede it */
  var SURNAME_PREFIX = /^(dr|prof|von|van|de|da|del|della|di|le|la|du|mc|mac|el|al)\.?$/i;

  function fold(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/ß/g, "ss")
      .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  }
  function clean(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

  /** Known names (roster + players), longest first, so "Guda Vadla, Sai Kumar Reddy"
   *  is matched before any shorter name it might contain. */
  function knownIndex(known) {
    var list = (known || []).map(clean).filter(Boolean);
    var seen = {};
    list = list.filter(function (n) { var k = fold(n); if (seen[k]) return false; seen[k] = true; return true; });
    list.sort(function (a, b) { return b.length - a.length; });
    return list.map(function (n) { return { name: n, key: fold(n) }; });
  }

  /** Split one text fragment (no scores left in it) into "Last, First" names.
   *  Known names are cut out first; the rest falls back to comma heuristics. */
  function namesIn(fragment, known) {
    var text = clean(fragment.replace(/([a-zäöüß])([A-ZÄÖÜ])/g, "$1 $2"));   // un-glue "ChengchenDujic"
    if (!text) return [];
    var out = [];
    /* 1. known names, in textual order */
    var hits = [];
    var f = fold(text);
    known.forEach(function (k) {
      var from = 0, at;
      while ((at = f.indexOf(k.key, from)) >= 0) {
        var end = at + k.key.length;
        var before = at === 0 ? " " : f[at - 1], after = end >= f.length ? " " : f[end];
        var overlaps = hits.some(function (h) { return at < h.end && end > h.at; });
        if (!overlaps && !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) hits.push({ at: at, end: end, name: k.name });
        from = end;
      }
    });
    hits.sort(function (a, b) { return a.at - b.at; });
    /* 2. the gaps between known hits: comma heuristics */
    var pos = 0, parts = [];
    hits.forEach(function (h) {
      if (h.at > pos) parts.push({ text: f.slice(pos, h.at), orig: text.slice(pos, h.at), at: pos });
      parts.push({ name: h.name, at: h.at });
      pos = h.end;
    });
    if (pos < f.length) parts.push({ text: f.slice(pos), orig: text.slice(pos), at: pos });
    parts.forEach(function (p) {
      if (p.name) { out.push(p.name); return; }
      guessNames(p.orig).forEach(function (n) { out.push(n); });
    });
    return out;
  }

  /** "Stahl, Holger Keller, Christoph" → two names. The surname of a later
   *  name is its last word before the comma (plus a "Dr."-style prefix);
   *  everything before that still belongs to the previous given name. */
  function guessNames(text) {
    var s = clean(text);
    if (!s || s.indexOf(",") < 0) return [];
    var words = s.split(" ");
    var commaAt = [];
    words.forEach(function (w, i) { if (/,$/.test(w)) commaAt.push(i); });
    if (!commaAt.length) return [];
    var names = [], start = 0;
    for (var c = 0; c < commaAt.length; c++) {
      var surnameEnd = commaAt[c];
      var surnameStart = c === 0 ? 0 : surnameEnd;
      if (c > 0) {
        /* walk back over "Dr." / "van" style prefixes */
        while (surnameStart - 1 > commaAt[c - 1] && SURNAME_PREFIX.test(words[surnameStart - 1])) surnameStart--;
      }
      if (c > 0) {
        /* close the previous name: its given names run up to the surname start */
        var prev = names[names.length - 1];
        prev.given = words.slice(commaAt[c - 1] + 1, surnameStart);
      }
      names.push({ surname: words.slice(surnameStart, surnameEnd + 1), given: [] });
      start = surnameEnd + 1;
    }
    names[names.length - 1].given = words.slice(start);
    return names.map(function (n) {
      var sur = n.surname.join(" ").replace(/,$/, "");
      var giv = n.given.join(" ").replace(/[,.;]+$/, "");
      /* a trailing junk word that is not a name ("Spielpunkte") would have no capital; keep what looks like a name */
      giv = giv.split(" ").filter(function (w) { return /^[A-ZÄÖÜ]/.test(w) || /^[a-zäöüß'’-]+$/.test(w) && false; }).join(" ");
      return giv ? sur + ", " + giv : sur;
    }).filter(function (n) { return /^[A-ZÄÖÜ]/.test(n) && n.length > 2; });
  }

  /** Names and scores of one text segment in textual order. */
  function tokens(segment, known) {
    var text = segment.replace(WO_RE, " " + WO + " ");
    var list = [];
    /* cells: newlines, tabs and runs of two or more spaces separate columns */
    var cells = text.split(/\n|\t|\s{2,}/);
    cells.forEach(function (cell) {
      var last = 0, m;
      SCORE_RE.lastIndex = 0;
      var pieces = [];
      while ((m = SCORE_RE.exec(cell))) {
        pieces.push({ text: cell.slice(last, m.index) });
        pieces.push({ score: [Number(m[1]), Number(m[2])] });
        last = m.index + m[0].length;
      }
      pieces.push({ text: cell.slice(last) });
      pieces.forEach(function (p) {
        if (p.score) { list.push({ score: p.score }); return; }
        var t = p.text;
        if (!t || !t.trim()) return;
        /* a walkover marker counts as a name of its side */
        var parts = t.split(WO);
        parts.forEach(function (frag, i) {
          namesIn(frag, known).forEach(function (n) { list.push({ name: n }); });
          if (i < parts.length - 1) list.push({ name: WO });
        });
      });
    });
    return list;
  }

  /** The set scores among a slot's score tokens. The report prints the
   *  sets, then the "Spielpunkte" total — the exact sum of the sets — so the
   *  longest run of set-like tokens whose sum is printed right after them is
   *  the answer (a repeated 11:21 must not pass for a total). Without any
   *  total (garbled copy) the leading set-like tokens are taken as they are. */
  function setsOf(scores) {
    var lead = [];
    for (var i = 0; i < scores.length && lead.length < 3; i++) {
      var s = scores[i], max = Math.max(s[0], s[1]);
      /* a set: somebody reached 11 or more, nobody more than 30, no tie */
      if (max >= 11 && max <= 30 && s[0] !== s[1]) lead.push({ h: s[0], a: s[1] });
      else break;
    }
    for (var k = lead.length; k >= 1; k--) {
      var next = scores[k];
      if (!next) continue;
      var h = 0, a = 0;
      for (var j = 0; j < k; j++) { h += lead[j].h; a += lead[j].a; }
      if (next[0] === h && next[1] === a) return { sets: lead.slice(0, k), total: true };
    }
    return { sets: lead, total: false };
  }

  function parseHeader(head) {
    var out = { home: "", away: "", date: null, league: "" };
    var dm = /(\d{2})\.(\d{2})\.(\d{4})/.exec(head);
    if (dm) out.date = dm[3] + "-" + dm[2] + "-" + dm[1];
    var lines = head.split("\n").map(clean).filter(Boolean);
    var lg = lines.filter(function (l) { return /liga|klasse/i.test(l) && !/Mannschaftsmeisterschaft/i.test(l); })[0];
    if (lg) out.league = lg;
    /* teams: the line(s) with "A - B" or "A : B", trimmed of date and result */
    var joined = lines.filter(function (l) {
      return !/^(Mannschaftsmeisterschaft|Spielbericht|Bezirk|Landes|Verbands|Kreis|Hobby|BWBV)/i.test(l) &&
        !/^\d{1,2}\.\s*Satz/.test(l);
    }).join(" ");
    joined = joined.replace(/\s*,?\s*\d{2}\.\d{2}\.\d{4}.*$/, "")                // ", 10.10.2026, 14:00 Uhr …"
                   .replace(/\s+-\s+\d+\s*:\s*\d+\s*$/, "")                     // " - 5 : 3"
                   .replace(/\s*\(\s*[^)]*\)\s*$/, "");
    var m = /^(.+?)\s+:\s+(.+)$/.exec(joined) || /^(.+?)\s+-\s+(.+)$/.exec(joined);
    if (m) { out.home = clean(m[1]); out.away = clean(m[2]); }
    return out;
  }

  /**
   * parse(text, { known: [names] }) →
   * { home, away, date, time, league, total: {home, away}|null,
   *   slots: [{ slot, home: [], away: [], sets: [{h,a}], walkover: "home"|"away"|null, issues: [] }] }
   * Slots come back in playing order; a slot missing from the text has empty
   * sides and the issue "fehlt".
   */
  function parse(text, opts) {
    var known = knownIndex(opts && opts.known);
    var src = String(text || "").replace(/ /g, " ").replace(/\r\n?/g, "\n");
    /* the kick-off time, read before every "hh:mm Uhr" is removed — those
       would otherwise pass for results */
    var tm = /(\d{1,2}):(\d{2})\s*Uhr/.exec(src);
    var time = tm ? (tm[1].length < 2 ? "0" : "") + tm[1] + ":" + tm[2] : null;
    /* the footer notes carry times, never results — but the Spiele total can
       sit on the same line (report page), so cut from the word on, not the line */
    src = src.replace(/(Spielbeginn|Spielende|Letzte Änderung|erstellt am|nu\.Dokument).*$/gm, " ")
             .replace(/\d{1,2}:\d{2}\s*Uhr/g, " ");

    /* cut the body at the slot labels */
    var marks = [], m;
    LABEL_RE.lastIndex = 0;
    while ((m = LABEL_RE.exec(src))) marks.push({ at: m.index, end: m.index + m[0].length, slot: LABELS[m[1] || m[2]] });
    var head = marks.length ? src.slice(0, marks[0].at) : src;
    var header = parseHeader(head);

    var segments = [];
    /* names printed before the first label (PDF text: first pair of HD1) */
    var pre = tokens(head.split("\n").slice(-3).join("\n"), known).filter(function (t) { return t.name; });
    for (var i = 0; i < marks.length; i++) {
      var seg = src.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].at : src.length);
      segments.push({ slot: marks[i].slot, tokens: tokens(seg, known) });
    }

    var bySlot = {};
    var carry = pre.map(function (t) { return t.name; });     // names trailing the previous slot
    var lastScores = [];
    segments.forEach(function (sg) {
      var names = [], after = [], scores = [], seenScore = false;
      sg.tokens.forEach(function (t) {
        if (t.score) { scores.push(t.score); seenScore = true; }
        else if (seenScore) after.push(t.name);
        else names.push(t.name);
      });
      lastScores = scores;
      var n = PAIR[sg.slot];
      var row = { slot: sg.slot, home: [], away: [], sets: [], walkover: null, issues: [] };
      if (bySlot[sg.slot]) {                                    // a label printed twice: keep the first
        carry = carry.concat(names).slice(-2 * n);
        return;
      }
      if (n === 1) {
        if (names.length >= 2) { row.home = [names[0]]; row.away = [names[1]]; }
        else if (names.length === 1) { row.home = [names[0]]; row.issues.push("Gegner fehlt"); }
        else row.issues.push("Namen fehlen");
      } else {
        if (names.length >= 4) { row.home = [names[0], names[1]]; row.away = [names[2], names[3]]; }
        else if (names.length === 2 && carry.length >= 2) {
          var c = carry.slice(-2);
          row.home = [c[0], names[0]]; row.away = [c[1], names[1]];
        } else if (names.length === 2) { row.home = [names[0]]; row.away = [names[1]]; row.issues.push("je ein Spieler fehlt"); }
        else if (names.length === 3) { row.home = [names[0], names[1]]; row.away = [names[2]]; row.issues.push("ein Spieler fehlt"); }
        else if (names.length === 1) { row.home = [names[0]]; row.issues.push("Namen fehlen"); }
        else row.issues.push("Namen fehlen");
      }
      /* walkover: the absent side has no players */
      if (row.home.indexOf(WO) >= 0) { row.walkover = "home"; row.home = []; }
      if (row.away.indexOf(WO) >= 0) { row.walkover = "away"; row.away = []; }
      var st = setsOf(scores);
      row.sets = st.sets;
      if (!row.walkover) {
        if (!row.sets.length) row.issues.push("Sätze fehlen");
        else if (row.sets.length < 2) row.issues.push("nur ein Satz");
      }
      bySlot[sg.slot] = row;
      carry = after.slice(-2 * n);
    });

    /* totals: the last "a:b" with a + b ≤ 8 is the Spiele column's sum */
    var total = null;
    var all = [];
    SCORE_RE.lastIndex = 0;
    var body = marks.length ? src.slice(marks[marks.length - 1].end) : "";
    while ((m = SCORE_RE.exec(body))) all.push([Number(m[1]), Number(m[2])]);
    /* skip the last slot's own set/points/sets/game cells: look after its sets total */
    for (var k = all.length - 1; k >= 0; k--) {
      var s = all[k];
      if (s[0] + s[1] <= 8 && s[0] + s[1] >= 1 && (s[0] === 8 || s[1] === 8 || s[0] + s[1] === 8)) { total = { home: s[0], away: s[1] }; break; }
    }

    return {
      home: header.home, away: header.away, date: header.date, time: time, league: header.league,
      total: total,
      slots: SLOTS.map(function (s) {
        return bySlot[s] || { slot: s, home: [], away: [], sets: [], walkover: null, issues: ["fehlt"] };
      }),
    };
  }

  return { parse: parse, SLOTS: SLOTS, PAIR: PAIR, WO: WO };
});
