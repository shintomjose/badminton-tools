/* ================= Match Tracker — Spielerliste (licence list) =================
 * The club's Spielberechtigungsliste (BWBV licence list): every licensed
 * player with pass number, date of birth, nationality and licence dates,
 * split into Herren and Damen. Personal data, so it lives only in Firestore
 * behind the owner-only rules — never in the repo. It gets there through the
 * import at the bottom of this view: a JSON file made from the PDF by
 * dev/roster-from-pdf.py (gitignored output), picked once from the phone or
 * the desktop. Reached from the settings view (gear), not from the sub-tabs.
 */
"use strict";

Object.assign(EN, {
  "Spielerliste": "Player list",
  "Herren": "Men",
  "Damen": "Women",
  "Pass-Nr.": "Pass no.",
  "Geb.-Datum": "Date of birth",
  "Alter": "Age",
  "Nation": "Nation",
  "Spielberechtigt ab": "Licensed from",
  "JFG": "JFG",
  "Jugendfreigabe": "Youth clearance",
  "Name suchen…": "Search name…",
  "{0} Spieler": "{0} players",
  "1 Spieler": "1 player",
  "Stand: {0}": "As of: {0}",
  "Noch keine Spielerliste importiert.": "No player list imported yet.",
  "Keine Treffer": "No matches",
  "Liste importieren": "Import list",
  "JSON-Datei aus dev/roster-from-pdf.py wählen. Die bestehende Liste wird komplett ersetzt.":
    "Pick the JSON file made by dev/roster-from-pdf.py. The existing list is replaced completely.",
  "Datei nicht lesbar": "File could not be read",
  "Keine Spielerliste in dieser Datei": "No player list in this file",
  "{0} Spieler importieren? Die bestehende Liste wird ersetzt.": "Import {0} players? The existing list is replaced.",
  "Spielerliste importiert": "Player list imported",
  "Spielerliste nicht ladbar": "Player list could not be loaded",
});

(function () {
  if (typeof MT === "undefined") return;

  const state = {
    host: null,
    list: [],
    source: "",          // where the list came from, as written by the import
    loaded: false,
    error: null,
    q: "",               // search text, folded
    busy: false,
  };

  /* Case- and diacritic-insensitive fold — "muller" finds "Müller". */
  function fold(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/ß/g, "ss")
      .normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function isoDate(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0) : null;
  }
  function fmtDate(v) {
    const d = isoDate(v);
    return d ? d.toLocaleDateString(DATE_LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" }) : String(v || "");
  }
  function age(v) {
    const d = isoDate(v);
    if (!d) return "";
    const n = new Date();
    let a = n.getFullYear() - d.getFullYear();
    const m = n.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
    return a;
  }

  function countLabel(n) { return n === 1 ? t("1 Spieler") : tt("{0} Spieler", n); }

  function byName(a, b) { return String(a.name || "").localeCompare(String(b.name || ""), DATE_LOCALE); }

  function filtered(sex) {
    const q = state.q;
    return state.list
      .filter(p => p.sex === sex && (!q || fold(p.name).indexOf(q) >= 0))
      .sort(byName);
  }

  function rowHtml(p, i) {
    return "<tr>" +
      '<td class="mtr-n">' + (i + 1) + "</td>" +
      '<td class="mtr-name">' + esc(p.name || "") +
        (p.jfg ? ' <span class="mt-badge trn" title="' + esc(t("Jugendfreigabe")) + '">' + esc(t("JFG")) + "</span>" : "") +
      "</td>" +
      '<td class="mtr-pass">' + esc(p.passNr || "") + "</td>" +
      '<td class="mtr-dob">' + esc(fmtDate(p.dob)) + '<span class="mtr-age">' + esc(String(age(p.dob))) + "</span></td>" +
      '<td class="mtr-nat">' + esc(p.nation || "") + "</td>" +
      '<td class="mtr-since">' + esc(fmtDate(p.since)) + "</td>" +
    "</tr>";
  }

  function tableHtml(list) {
    if (!list.length) return '<p class="mt-muted">' + esc(t(state.q ? "Keine Treffer" : "Noch keine Spielerliste importiert.")) + "</p>";
    return '<div class="mtr-wrap"><table class="mtr-table">' +
      "<thead><tr>" +
        "<th></th>" +
        "<th>" + esc(t("Name")) + "</th>" +
        "<th>" + esc(t("Pass-Nr.")) + "</th>" +
        "<th>" + esc(t("Geb.-Datum")) + ' <span class="mt-muted">(' + esc(t("Alter")) + ")</span></th>" +
        "<th>" + esc(t("Nation")) + "</th>" +
        "<th>" + esc(t("Spielberechtigt ab")) + "</th>" +
      "</tr></thead>" +
      "<tbody>" + list.map(rowHtml).join("") + "</tbody>" +
    "</table></div>";
  }

  function sectionHtml(title, list) {
    return '<section class="panel mt-card mtr-sec">' +
      "<h2>" + esc(title) + ' <span class="seg-count">' + list.length + "</span></h2>" +
      tableHtml(list) +
    "</section>";
  }

  /* The two tables only — the search field keeps its focus and caret. */
  function renderLists() {
    const box = state.host && state.host.querySelector("#mtrLists");
    if (!box) return;
    box.innerHTML = sectionHtml(t("Herren"), filtered("m")) + sectionHtml(t("Damen"), filtered("w"));
  }

  function render() {
    const host = state.host;
    if (!host) return;
    let meta;
    if (!state.loaded) meta = t("Laden …");
    else if (state.error) meta = t("Spielerliste nicht ladbar");
    else meta = countLabel(state.list.length) + (state.source ? " · " + tt("Stand: {0}", state.source) : "");
    host.innerHTML =
      '<section class="panel mt-card mtv-panel">' +
        '<div class="mt-trn-head">' +
          "<h2>" + esc(t("Spielerliste")) + "</h2>" +
          '<button type="button" class="btn small" data-act="back">' + esc(t("Zurück")) + "</button>" +
        "</div>" +
        '<p class="mt-sess-meta">' + esc(meta) + "</p>" +
        '<input type="search" class="mtr-search" placeholder="' + esc(t("Name suchen…")) + '"' +
          ' aria-label="' + esc(t("Name suchen…")) + '" autocomplete="off" value="' + esc(state.q) + '">' +
      "</section>" +
      '<div id="mtrLists"></div>' +
      '<section class="panel mt-card mtr-import">' +
        "<details><summary>" + esc(t("Liste importieren")) + "</summary>" +
          '<p class="mt-muted">' + esc(t("JSON-Datei aus dev/roster-from-pdf.py wählen. Die bestehende Liste wird komplett ersetzt.")) + "</p>" +
          '<input type="file" class="mtr-file" accept="application/json,.json"' + (state.busy ? " disabled" : "") + ">" +
        "</details>" +
      "</section>";
    renderLists();
  }

  async function load() {
    state.error = null;
    try {
      const res = await MT.repo.listRoster();
      state.list = Array.isArray(res.players) ? res.players : [];
      state.source = res.source || "";
      state.loaded = true;
    } catch (e) {
      state.loaded = true;
      state.error = e;
      MT.toastError(e, "Laden fehlgeschlagen");
    }
    render();
  }

  /* The import file: { source, players: [{ name, passNr, dob, sex, nation, since, first, jfg }] } */
  function parseImport(text) {
    let json;
    try { json = JSON.parse(text); } catch (e) { return { error: t("Datei nicht lesbar") }; }
    const raw = json && Array.isArray(json.players) ? json.players : (Array.isArray(json) ? json : null);
    if (!raw) return { error: t("Keine Spielerliste in dieser Datei") };
    const players = raw
      .filter(p => p && typeof p.name === "string" && p.name.trim() && typeof p.passNr === "string" && p.passNr.trim())
      .map(p => ({
        name: p.name.trim(),
        passNr: p.passNr.trim(),
        dob: String(p.dob || ""),
        sex: p.sex === "w" ? "w" : "m",
        nation: String(p.nation || ""),
        since: String(p.since || ""),
        first: String(p.first || ""),
        jfg: !!p.jfg,
      }));
    if (!players.length) return { error: t("Keine Spielerliste in dieser Datei") };
    return { players: players, source: String((json && json.source) || "") };
  }

  async function importFile(file) {
    if (!file || state.busy) return;
    let text;
    try { text = await file.text(); } catch (e) { toast(t("Datei nicht lesbar")); return; }
    const parsed = parseImport(text);
    if (parsed.error) { toast(parsed.error); return; }
    if (!window.confirm(tt("{0} Spieler importieren? Die bestehende Liste wird ersetzt.", parsed.players.length))) return;
    state.busy = true;
    render();
    try {
      await MT.repo.importRoster(parsed.players, parsed.source);
      toast(t("Spielerliste importiert"));
      await load();
    } catch (e) {
      MT.toastError(e, "Speichern fehlgeschlagen");
    } finally {
      state.busy = false;
      render();
    }
  }

  function onClick(e) {
    const btn = e.target && typeof e.target.closest === "function" ? e.target.closest("[data-act]") : null;
    if (!btn || !state.host || !state.host.contains(btn)) return;
    if (btn.dataset.act === "back") { MT.showView("settings"); return; }
  }

  function onInput(e) {
    const el = e.target;
    if (!el || !el.classList || !el.classList.contains("mtr-search")) return;
    state.q = fold(el.value).trim();
    renderLists();
  }

  function onChange(e) {
    const el = e.target;
    if (!el || !el.classList || !el.classList.contains("mtr-file")) return;
    const file = el.files && el.files[0];
    el.value = "";                                   // the same file can be picked again
    importFile(file);
  }

  MT.registerView("roster", {
    label: t("Spielerliste"),
    hidden: true,                      // reached from the settings view, not the sub-tabs
    mount: function (host) {
      state.host = host;
      state.q = "";
      host.addEventListener("click", onClick);
      host.addEventListener("input", onInput);
      host.addEventListener("change", onChange);
      render();
      load();
    },
    unmount: function () {
      if (state.host) {
        state.host.removeEventListener("click", onClick);
        state.host.removeEventListener("input", onInput);
        state.host.removeEventListener("change", onChange);
      }
      state.host = null;
    },
  });
})();
