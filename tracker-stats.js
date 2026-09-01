/* =====================================================================
   Match Tracker — Phase 3: Stats & progress view
   Registers the "stats" view on the global MT foundation module.

   All numbers are computed client-side, in ONE pass over a single fetched
   match range, always from the perspective of the player flagged isMe.
   Training and tournament results are never merged.
   ===================================================================== */
(function () {
  "use strict";

  if (typeof MT === "undefined" || !MT) {
    console.warn("[tracker-stats] MT foundation module not found — stats view not registered.");
    return;
  }

  /* ---------- i18n: German keys, English values ---------------------- */
  /* Keys already present in app.js's EN map (Spieler, Gegner, Datum …)
     are deliberately not redefined here. */
  if (typeof EN !== "undefined" && EN) {
    Object.assign(EN, {
      "Statistik": "Stats",
      "Statistik konnte nicht geladen werden": "Stats could not be loaded",
      "Lade Statistik…": "Loading stats…",
      "Zeitraum": "Period",
      "Art": "Type",
      "Dieses Jahr": "This year",
      "Letzte 12 Wochen": "Last 12 weeks",
      "Gesamt": "All time",
      "Turnier": "Tournament",
      "Einzel": "Singles",
      "Doppel": "Doubles",
      "Spiele": "Matches",
      "Spiel": "Match",
      "Bilanz": "Record",
      "Siegquote": "Win rate",
      "Zusammen: {0} Spiele · {1}–{2}": "Combined: {0} matches · {1}–{2}",
      "Form": "Form",
      "Aktuelle Serie": "Current streak",
      "Letzte 10": "Last 10",
      "Letzte fünf Spiele, ältestes zuerst": "Last five matches, oldest first",
      "{0} Sieg in Folge": "{0} win in a row",
      "{0} Siege in Folge": "{0} wins in a row",
      "{0} Niederlage in Folge": "{0} loss in a row",
      "{0} Niederlagen in Folge": "{0} losses in a row",
      "S": "W",
      "N": "L",
      "Sieg": "Win",
      "Niederlage": "Loss",
      "Trend": "Trend",
      "Siegquote % pro Kalenderwoche": "Win rate % per calendar week",
      "Kalenderwoche": "Calendar week",
      "Siegquote in Prozent": "Win rate in percent",
      "Wochen ohne Spiel bleiben leer — sie sind keine 0 %.":
        "Weeks without a match stay empty — they are not 0 %.",
      "Blasse Balken beruhen auf weniger als {0} Spielen.":
        "Faded bars are based on fewer than {0} matches.",
      "Nur die letzten {0} Wochen werden gezeigt.": "Only the last {0} weeks are shown.",
      "Nicht genug Daten für einen Trend.": "Not enough data for a trend.",
      "Beste Partner": "Best partners",
      "Schwerste Gegner": "Toughest opponents",
      "Partner": "Partner",
      "Noch keine Doppel-Partner in diesem Zeitraum.": "No doubles partners in this period yet.",
      "Noch keine Gegner in diesem Zeitraum.": "No opponents in this period yet.",
      "wenig Daten ({0})": "little data ({0})",
      "Weniger als {0} Spiele — Reihenfolge sagt wenig aus.":
        "Fewer than {0} matches — the order says little.",
      "Nur Gegner mit mindestens {0} Spielen, schwerste zuerst.":
        "Only opponents with at least {0} matches, toughest first.",
      "Tag / Woche / Jahr": "Day / week / year",
      "Tag": "Day",
      "Woche": "Week",
      "Jahr": "Year",
      "Sp": "M",
      "KW {0}": "W{0}",
      "Noch keine abgeschlossenen Spiele in diesem Zeitraum.":
        "No finished matches in this period yet.",
      "{0} % ({1})": "{0}% ({1})",
      "Kleine Stichprobe: nur 1 Spiel": "Small sample: only 1 match",
      "Kleine Stichprobe: nur {0} Spiele": "Small sample: only {0} matches",
      "Statistik für {0}": "Stats for {0}"
    });
  }

  /* ---------- constants ---------------------------------------------- */
  var SMALL_N = 5;          // below this a percentage is flagged as thin evidence
  var OPP_MIN = 3;          // minimum matches to rank an opponent
  var TOP_PARTNERS = 8;
  var MAX_DAYS = 14;
  var MAX_WEEKS = 8;
  var MAX_CHART_WEEKS = 52; // keep the weekly trend readable on "all time"
  var ALL_TIME_FROM = new Date(2020, 0, 1);

  /* ---------- tiny helpers ------------------------------------------- */
  function H(v) { return esc(v == null ? "" : String(v)); }

  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v.toDate === "function") return v.toDate();       // Firestore Timestamp
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function parseDateKey(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  /* ISO-8601 week key ("2026-W36") for a local date. */
  function isoWeekKey(d) {
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + 3);          // Thursday of that week
    var y = t.getFullYear();
    var jan4 = new Date(y, 0, 4);
    var week1Mon = new Date(y, 0, 4 - ((jan4.getDay() + 6) % 7));
    var w = 1 + Math.round((t - week1Mon) / 604800000);
    return y + "-W" + (w < 10 ? "0" + w : String(w));
  }

  /* Monday of an ISO week key, or null when the key is malformed. */
  function isoWeekMonday(key) {
    var m = /^(\d{4})-W(\d{1,2})$/.exec(String(key || ""));
    if (!m) return null;
    var y = +m[1];
    var jan4 = new Date(y, 0, 4);
    return new Date(y, 0, 4 - ((jan4.getDay() + 6) % 7) + (+m[2] - 1) * 7);
  }

  function fmtDayShort(d) {
    return d.toLocaleDateString(DATE_LOCALE, { day: "2-digit", month: "2-digit" });
  }

  function fmtDayLabel(dateKey) {
    var d = parseDateKey(dateKey);
    if (!d) return String(dateKey || "");
    return d.toLocaleDateString(DATE_LOCALE, {
      weekday: "short", day: "2-digit", month: "2-digit", year: "2-digit"
    });
  }

  function weekNumber(weekKey) {
    var m = /^\d{4}-W(\d{1,2})$/.exec(String(weekKey || ""));
    return m ? +m[1] : null;
  }

  function fmtWeekLabel(weekKey) {
    var n = weekNumber(weekKey);
    var mon = isoWeekMonday(weekKey);
    if (n == null || !mon) return String(weekKey || "");
    var sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    return tt("KW {0}", n) + " · " + fmtDayShort(mon) + "–" + fmtDayShort(sun);
  }

  /* Every percentage is rendered together with its sample size, and a thin
     sample is visually and semantically marked. Never a bare percentage. */
  function pctHtml(wins, n) {
    if (!n) return '<span class="mts-pct mts-pct-empty">–</span>';
    var p = Math.round((wins / n) * 100);
    var label = tt("{0} % ({1})", p, n);
    if (n < SMALL_N) {
      var why = n === 1
        ? t("Kleine Stichprobe: nur 1 Spiel")
        : tt("Kleine Stichprobe: nur {0} Spiele", n);
      return '<span class="mts-pct mts-pct-weak" tabindex="0" title="' + H(why) +
             '" aria-label="' + H(label + " — " + why) + '">' + H(label) + "</span>";
    }
    return '<span class="mts-pct">' + H(label) + "</span>";
  }

  function wlHtml(rec) {
    return '<span class="mts-wl"><b class="mts-w">' + rec.w + "</b>" +
           '<i>–</i><b class="mts-l">' + rec.l + "</b></span>";
  }

  function nameBtn(id, name) {
    return '<button type="button" class="mts-name" data-pid="' + H(id) + '">' +
           H(name || id) + "</button>";
  }

  /* ---------- one-pass aggregation ------------------------------------ */
  function blank() { return { w: 0, l: 0 }; }
  function bump(rec, won) { if (won) rec.w++; else rec.l++; return rec; }

  function bumpKey(map, key, won) {
    if (key == null || key === "") return;
    var k = String(key);
    var rec = map.get(k);
    if (!rec) { rec = blank(); map.set(k, rec); }
    bump(rec, won);
  }

  function bumpPerson(map, id, name, won) {
    if (!id) return;
    var rec = map.get(id);
    if (!rec) { rec = { id: id, name: name || id, w: 0, l: 0 }; map.set(id, rec); }
    if (name) rec.name = name;                 // keep the most recent denormalised name
    bump(rec, won);
  }

  /**
   * Single linear pass over the fetched matches. Everything downstream reads
   * from these maps — no nested scans anywhere.
   *
   * Excluded here: unfinished matches, matches of the other record type,
   * matches I did not play in, and finished matches without a winnerSide
   * (retired / no result — there is nothing to attribute).
   */
  function aggregate(matches, meId, type) {
    var out = {
      n: 0,
      total: blank(), singles: blank(), doubles: blank(),
      seq: [],                                  // date desc, true = win
      day: new Map(), week: new Map(), year: new Map(),
      partners: new Map(), opponents: new Map()
    };
    if (!meId) return out;

    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      if (!m || m.status !== "finished" || m.type !== type) continue;
      if (m.winnerSide !== "A" && m.winnerSide !== "B") continue;

      var A = m.sideA || {}, B = m.sideB || {};
      var aIds = A.playerIds || [], bIds = B.playerIds || [];
      var mine = aIds.indexOf(meId) !== -1 ? "A" : (bIds.indexOf(meId) !== -1 ? "B" : null);
      if (!mine) continue;

      var won = m.winnerSide === mine;
      var isDoubles = m.discipline === "doubles";
      var mySide = mine === "A" ? A : B;
      var oppSide = mine === "A" ? B : A;

      out.n++;
      bump(out.total, won);
      bump(isDoubles ? out.doubles : out.singles, won);
      out.seq.push(won);

      var d = toDate(m.date);
      var dayKey = m.dateKey || (d ? d.getFullYear() + "-" +
        ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2) : "");
      var wkKey = m.weekKey || (d ? isoWeekKey(d) : "");
      var yrKey = m.yearKey != null ? String(m.yearKey) : (d ? String(d.getFullYear()) : "");

      bumpKey(out.day, dayKey, won);
      bumpKey(out.week, wkKey, won);
      bumpKey(out.year, yrKey, won);

      if (isDoubles) {
        var pIds = mySide.playerIds || [], pNames = mySide.names || [];
        for (var j = 0; j < pIds.length; j++) {
          if (pIds[j] !== meId) bumpPerson(out.partners, pIds[j], pNames[j], won);
        }
      }
      var oIds = oppSide.playerIds || [], oNames = oppSide.names || [];
      for (var k = 0; k < oIds.length; k++) bumpPerson(out.opponents, oIds[k], oNames[k], won);
    }
    return out;
  }

  /* ---------- section renderers --------------------------------------- */
  function discTile(labelKey, rec) {
    var n = rec.w + rec.l;
    return '<div class="mts-tile">' +
      '<div class="mts-tile-head">' + H(t(labelKey)) + "</div>" +
      '<div class="mts-tile-num">' + n + "</div>" +
      '<div class="mts-tile-unit">' + H(n === 1 ? t("Spiel") : t("Spiele")) + "</div>" +
      '<div class="mts-tile-row">' + wlHtml(rec) + "</div>" +
      '<div class="mts-tile-row">' + pctHtml(rec.w, n) + "</div>" +
      "</div>";
  }

  function renderTotals(agg) {
    var n = agg.total.w + agg.total.l;
    return '<section class="mts-card">' +
      '<h3 class="mts-h">' + H(t("Bilanz")) + "</h3>" +
      '<div class="mts-split">' +
        discTile("Einzel", agg.singles) +
        discTile("Doppel", agg.doubles) +
      "</div>" +
      '<p class="mts-combined">' +
        H(tt("Zusammen: {0} Spiele · {1}–{2}", n, agg.total.w, agg.total.l)) +
        " · " + pctHtml(agg.total.w, n) +
      "</p>" +
    "</section>";
  }

  function renderForm(agg) {
    var seq = agg.seq;
    if (!seq.length) return "";

    var first = seq[0], streak = 0;
    for (var i = 0; i < seq.length; i++) { if (seq[i] === first) streak++; else break; }
    var streakText = first
      ? (streak === 1 ? tt("{0} Sieg in Folge", streak) : tt("{0} Siege in Folge", streak))
      : (streak === 1 ? tt("{0} Niederlage in Folge", streak) : tt("{0} Niederlagen in Folge", streak));

    var last5 = seq.slice(0, 5).reverse();       // oldest first, reads as a timeline
    var badges = last5.map(function (won, idx) {
      return '<span class="mts-badge ' + (won ? "mts-badge-w" : "mts-badge-l") +
        (idx === last5.length - 1 ? " mts-badge-now" : "") + '" title="' +
        H(won ? t("Sieg") : t("Niederlage")) + '">' + H(won ? t("S") : t("N")) + "</span>";
    }).join("");

    var l10 = seq.slice(0, 10);
    var l10w = 0;
    for (var j = 0; j < l10.length; j++) if (l10[j]) l10w++;

    return '<section class="mts-card">' +
      '<h3 class="mts-h">' + H(t("Form")) + "</h3>" +
      '<div class="mts-form">' +
        '<div class="mts-form-block">' +
          '<div class="mts-label">' + H(t("Aktuelle Serie")) + "</div>" +
          '<div class="mts-badges" role="img" aria-label="' +
            H(t("Letzte fünf Spiele, ältestes zuerst")) + '">' + badges + "</div>" +
          '<div class="mts-streak">' + H(streakText) + "</div>" +
        "</div>" +
        '<div class="mts-form-block">' +
          '<div class="mts-label">' + H(t("Letzte 10")) + "</div>" +
          '<div class="mts-form-pct">' + pctHtml(l10w, l10.length) + "</div>" +
        "</div>" +
      "</div>" +
    "</section>";
  }

  /**
   * Inline SVG bar chart, no library. Weeks without a match are left blank
   * (a gap), never plotted as 0 % — that distinction is the whole point.
   * A real 0 % week gets a visible muted stub instead.
   */
  function renderTrend(weekMap) {
    var keys = [];
    weekMap.forEach(function (_v, k) { if (isoWeekMonday(k)) keys.push(k); });
    keys.sort();

    if (keys.length < 2) {
      return '<section class="mts-card mts-card-wide"><h3 class="mts-h">' + H(t("Trend")) + "</h3>" +
        '<p class="mts-note">' + H(t("Nicht genug Daten für einen Trend.")) + "</p></section>";
    }

    var slots = [];
    var cur = isoWeekMonday(keys[0]);
    var end = isoWeekMonday(keys[keys.length - 1]);
    var guard = 0;
    while (cur <= end && guard++ < 1000) {
      var key = isoWeekKey(cur);
      slots.push({ key: key, rec: weekMap.get(key) || null });
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 7);
    }
    var truncated = slots.length > MAX_CHART_WEEKS;
    if (truncated) slots = slots.slice(-MAX_CHART_WEEKS);

    var W = 320, Hh = 180, x0 = 24, x1 = 314, y0 = 10, y1 = 156;
    var slotW = (x1 - x0) / slots.length;
    var barW = Math.max(2, Math.min(12, slotW * 0.66));
    var svg = [];

    // horizontal grid + y ticks
    [0, 25, 50, 75, 100].forEach(function (v) {
      var y = y1 - (v / 100) * (y1 - y0);
      svg.push('<line x1="' + x0 + '" y1="' + y.toFixed(1) + '" x2="' + x1 + '" y2="' +
        y.toFixed(1) + '" stroke="var(--border)" stroke-width="1" />');
      if (v % 50 === 0) {
        svg.push('<text x="' + (x0 - 4) + '" y="' + (y + 3.2).toFixed(1) +
          '" text-anchor="end" class="mts-ax">' + v + "</text>");
      }
    });

    var step = Math.max(1, Math.ceil(slots.length / 5));
    slots.forEach(function (s, i) {
      var cx = x0 + slotW * (i + 0.5);
      if (s.rec) {
        var n = s.rec.w + s.rec.l;
        var pct = Math.round((s.rec.w / n) * 100);
        var y = y1 - (pct / 100) * (y1 - y0);
        var h = Math.max(2, y1 - y);
        var weak = n < SMALL_N;
        svg.push('<rect x="' + (cx - barW / 2).toFixed(1) + '" y="' + (y1 - h).toFixed(1) +
          '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) +
          '" rx="1.5" fill="var(--brand-teal)" fill-opacity="' + (weak ? "0.38" : "1") +
          '" class="mts-bar"><title>' +
          H(fmtWeekLabel(s.key) + " · " + tt("{0} % ({1})", pct, n)) + "</title></rect>");
      }
      if (i % step === 0 || i === slots.length - 1) {
        svg.push('<text x="' + cx.toFixed(1) + '" y="' + (y1 + 14) +
          '" text-anchor="middle" class="mts-ax">' + H(weekNumber(s.key)) + "</text>");
      }
    });

    // baseline
    svg.push('<line x1="' + x0 + '" y1="' + y1 + '" x2="' + x1 + '" y2="' + y1 +
      '" stroke="var(--text-muted)" stroke-width="1" />');
    svg.push('<text x="' + ((x0 + x1) / 2) + '" y="' + (Hh - 3) +
      '" text-anchor="middle" class="mts-ax mts-ax-title">' + H(t("Kalenderwoche")) + "</text>");

    var notes = [
      t("Wochen ohne Spiel bleiben leer — sie sind keine 0 %."),
      tt("Blasse Balken beruhen auf weniger als {0} Spielen.", SMALL_N)
    ];
    if (truncated) notes.push(tt("Nur die letzten {0} Wochen werden gezeigt.", MAX_CHART_WEEKS));

    return '<section class="mts-card mts-card-wide">' +
      '<h3 class="mts-h">' + H(t("Trend")) + "</h3>" +
      '<p class="mts-label">' + H(t("Siegquote % pro Kalenderwoche")) + "</p>" +
      '<div class="mts-chart-wrap">' +
        '<svg class="mts-chart" viewBox="0 0 ' + W + " " + Hh + '" role="img" aria-label="' +
          H(t("Siegquote in Prozent") + " — " + t("Kalenderwoche")) + '">' +
          svg.join("") +
        "</svg>" +
      "</div>" +
      '<p class="mts-note">' + H(notes.join(" ")) + "</p>" +
    "</section>";
  }

  function peopleRows(list) {
    return list.map(function (p) {
      var n = p.w + p.l;
      return "<tr><td>" + nameBtn(p.id, p.name) + "</td>" +
        '<td class="mts-num">' + n + "</td>" +
        '<td class="mts-num">' + wlHtml(p) + "</td>" +
        '<td class="mts-num">' + pctHtml(p.w, n) + "</td></tr>";
    }).join("");
  }

  function peopleTable(headKey, rows) {
    return '<div class="mts-tbl-wrap"><table class="mts-tbl">' +
      "<thead><tr><th>" + H(t(headKey)) + '</th><th class="mts-num">' + H(t("Sp")) +
      '</th><th class="mts-num">' + H(t("Bilanz")) + '</th><th class="mts-num">' +
      H(t("Siegquote")) + "</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
  }

  function renderPartners(agg) {
    var list = [];
    agg.partners.forEach(function (p) { list.push(p); });
    if (!list.length) {
      return '<section class="mts-card"><h3 class="mts-h">' + H(t("Beste Partner")) + "</h3>" +
        '<p class="mts-note">' + H(t("Noch keine Doppel-Partner in diesem Zeitraum.")) +
        "</p></section>";
    }
    // most-played first, then win rate — count leads so thin samples don't top the list
    list.sort(function (a, b) {
      var na = a.w + a.l, nb = b.w + b.l;
      if (nb !== na) return nb - na;
      return (b.w / nb) - (a.w / na);
    });
    return '<section class="mts-card">' +
      '<h3 class="mts-h">' + H(t("Beste Partner")) + "</h3>" +
      peopleTable("Partner", peopleRows(list.slice(0, TOP_PARTNERS))) +
    "</section>";
  }

  function renderOpponents(agg) {
    var ranked = [], thin = [];
    agg.opponents.forEach(function (p) {
      ((p.w + p.l) >= OPP_MIN ? ranked : thin).push(p);
    });
    if (!ranked.length && !thin.length) {
      return '<section class="mts-card"><h3 class="mts-h">' + H(t("Schwerste Gegner")) + "</h3>" +
        '<p class="mts-note">' + H(t("Noch keine Gegner in diesem Zeitraum.")) +
        "</p></section>";
    }
    // toughest first = my lowest win rate against them
    ranked.sort(function (a, b) {
      var pa = a.w / (a.w + a.l), pb = b.w / (b.w + b.l);
      if (pa !== pb) return pa - pb;
      return (b.w + b.l) - (a.w + a.l);
    });
    thin.sort(function (a, b) { return (b.w + b.l) - (a.w + a.l); });

    var html = '<section class="mts-card"><h3 class="mts-h">' + H(t("Schwerste Gegner")) + "</h3>";
    if (ranked.length) {
      html += '<p class="mts-note">' +
        H(tt("Nur Gegner mit mindestens {0} Spielen, schwerste zuerst.", OPP_MIN)) + "</p>" +
        peopleTable("Gegner", peopleRows(ranked));
    }
    if (thin.length) {
      html += '<details class="mts-details"><summary>' +
        H(tt("wenig Daten ({0})", thin.length)) + "</summary>" +
        '<p class="mts-note">' +
          H(tt("Weniger als {0} Spiele — Reihenfolge sagt wenig aus.", OPP_MIN)) + "</p>" +
        peopleTable("Gegner", peopleRows(thin)) + "</details>";
    }
    return html + "</section>";
  }

  function bucketRows(map, labelFn, limit) {
    var keys = [];
    map.forEach(function (_v, k) { keys.push(k); });
    keys.sort().reverse();
    if (limit) keys = keys.slice(0, limit);
    return keys.map(function (k) {
      var rec = map.get(k), n = rec.w + rec.l;
      return "<tr><th scope=\"row\">" + H(labelFn(k)) + "</th>" +
        '<td class="mts-num">' + n + "</td>" +
        '<td class="mts-num">' + wlHtml(rec) + "</td>" +
        '<td class="mts-num">' + pctHtml(rec.w, n) + "</td></tr>";
    }).join("");
  }

  function bucketTable(titleKey, colKey, rows) {
    return '<div class="mts-bucket"><h4 class="mts-h4">' + H(t(titleKey)) + "</h4>" +
      '<div class="mts-tbl-wrap"><table class="mts-tbl">' +
      "<thead><tr><th>" + H(t(colKey)) + '</th><th class="mts-num">' + H(t("Sp")) +
      '</th><th class="mts-num">' + H(t("Bilanz")) + '</th><th class="mts-num">' +
      H(t("Siegquote")) + "</th></tr></thead><tbody>" + rows + "</tbody></table></div></div>";
  }

  function renderBuckets(agg) {
    return '<section class="mts-card mts-card-wide">' +
      '<h3 class="mts-h">' + H(t("Tag / Woche / Jahr")) + "</h3>" +
      bucketTable("Tag", "Tag", bucketRows(agg.day, fmtDayLabel, MAX_DAYS)) +
      bucketTable("Woche", "Woche", bucketRows(agg.week, fmtWeekLabel, MAX_WEEKS)) +
      bucketTable("Jahr", "Jahr", bucketRows(agg.year, function (k) { return k; }, 0)) +
    "</section>";
  }

  /* ---------- view state ---------------------------------------------- */
  var PERIODS = [
    { id: "year", labelKey: "Dieses Jahr" },
    { id: "12w", labelKey: "Letzte 12 Wochen" },
    { id: "all", labelKey: "Gesamt" }
  ];
  var TYPES = [
    { id: "training", labelKey: "Training" },
    { id: "tournament", labelKey: "Turnier" }
  ];

  var state = { period: "year", type: "training" };
  var cache = new Map();        // period id -> match[]  (mount lifetime only)
  var meId = null;
  var meName = "";
  var rootEl = null;
  var token = 0;

  function periodRange(id) {
    var now = new Date();
    var to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    if (id === "12w") {
      return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 83), to: to };
    }
    if (id === "all") return { from: new Date(ALL_TIME_FROM.getTime()), to: to };
    return { from: new Date(now.getFullYear(), 0, 1), to: to };
  }

  /* One getMatches call per period; cached for the lifetime of the mount. */
  function fetchPeriod(id) {
    if (cache.has(id)) return Promise.resolve(cache.get(id));
    var r = periodRange(id);
    return MT.repo.getMatches({ from: r.from, to: r.to }).then(function (rows) {
      var list = rows || [];
      cache.set(id, list);
      return list;
    });
  }

  function segTabs(cls, group, items, active, label) {
    return '<div class="seg-tabs mts-seg" role="tablist" aria-label="' + H(label) + '">' +
      items.map(function (it) {
        return '<button type="button" role="tab" class="' + cls + '" data-group="' + group +
          '" data-val="' + H(it.id) + '" aria-selected="' +
          (it.id === active ? "true" : "false") + '">' + H(t(it.labelKey)) + "</button>";
      }).join("") + "</div>";
  }

  function shell(body) {
    return '<div class="mts-bar-top">' +
        segTabs("mts-tab", "type", TYPES, state.type, t("Art")) +
        segTabs("mts-tab", "period", PERIODS, state.period, t("Zeitraum")) +
      "</div>" +
      '<div class="mts-body">' + body + "</div>";
  }

  function paint(body) {
    if (rootEl) rootEl.innerHTML = shell(body);
  }

  function render() {
    if (!rootEl) return;
    var my = ++token;
    paint('<p class="mts-loading" role="status">' + H(t("Lade Statistik…")) + "</p>");

    fetchPeriod(state.period).then(function (matches) {
      if (my !== token || !rootEl) return;                 // a newer request won
      var agg = aggregate(matches, meId, state.type);
      if (!agg.n) {
        paint('<p class="empty-note mts-empty">' +
          H(t("Noch keine abgeschlossenen Spiele in diesem Zeitraum.")) + "</p>");
        return;
      }
      paint(
        (meName ? '<p class="mts-who">' + H(tt("Statistik für {0}", meName)) + "</p>" : "") +
        renderTotals(agg) +
        renderForm(agg) +
        renderTrend(agg.week) +
        renderPartners(agg) +
        renderOpponents(agg) +
        renderBuckets(agg)
      );
    }).catch(function (err) {
      if (my !== token || !rootEl) return;
      cache.delete(state.period);
      MT.toastError(err, "Statistik konnte nicht geladen werden");
      paint('<p class="empty-note mts-empty">' +
        H(t("Statistik konnte nicht geladen werden")) + "</p>");
    });
  }

  function onClick(ev) {
    var tab = ev.target.closest(".mts-tab");
    if (tab) {
      var g = tab.getAttribute("data-group"), v = tab.getAttribute("data-val");
      if (state[g] === v) return;
      state[g] = v;
      render();
      return;
    }
    var name = ev.target.closest(".mts-name");
    if (name) {
      var pid = name.getAttribute("data-pid");
      if (pid) MT.openPlayerProfile(pid);
    }
  }

  /* ---------- registration -------------------------------------------- */
  MT.registerView("stats", {
    label: t("Statistik"),

    mount: function (el) {
      // Rebuilt from scratch on every mount → idempotent, no duplicate listeners.
      el.innerHTML = "";
      rootEl = document.createElement("div");
      rootEl.className = "mts";
      rootEl.addEventListener("click", onClick);
      el.appendChild(rootEl);

      MT.ready.then(function () {
        if (!rootEl || rootEl.parentNode !== el) return;
        if (!MT.isOwner()) { el.innerHTML = ""; rootEl = null; return; }
        return Promise.resolve(MT.repo.listPlayers()).then(function (players) {
          var me = (players || []).filter(function (p) { return p && p.isMe; })[0];
          meId = me ? me.id : null;
          meName = me ? me.name : "";
          render();
        });
      }).catch(function (err) {
        if (!rootEl) return;
        MT.toastError(err, "Statistik konnte nicht geladen werden");
        paint('<p class="empty-note mts-empty">' +
          H(t("Statistik konnte nicht geladen werden")) + "</p>");
      });
    },

    unmount: function () {
      token++;                       // invalidate any in-flight render
      if (rootEl) {
        rootEl.removeEventListener("click", onClick);
        if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      }
      rootEl = null;
      cache.clear();                 // cache lives only for the mount lifetime
    }
  });
})();
