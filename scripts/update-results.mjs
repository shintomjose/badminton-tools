/* Fetch the nuLiga group page and rewrite results.js with the results of the
 * own team's played league matches (window.RESULTS, keyed by the match id
 * used by the Termine schedule in app.js).
 *
 * Run by .github/workflows/update-results.yml after every match day;
 * local test: node scripts/update-results.mjs [--from-file page.html]
 *
 * Exits 0 with "unchanged"/"updated" on stdout; exits 1 when the page
 * cannot be fetched or the table cannot be parsed (the workflow then
 * fails visibly instead of committing garbage).
 *
 * Same parser as scripts/update-standings.mjs in the tsg-heilbronn repo —
 * keep the two in sync.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const URL_ =
  "https://bwbv-badminton.liga.nu/cgi-bin/WebObjects/nuLigaBADDE.woa/wa/groupPage?championship=NB+26%2F27&group=40186";
const RESULTS_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "results.js");
const OWN_TEAM = "SG Heilbronn/Leingarten IV";
const NULIGA_ORIGIN = "https://bwbv-badminton.liga.nu";

function textOf(cellHtml) {
  return cellHtml
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* Results of the own team's matches from the "Spielplan" table.
 * Returns { "<yyyy-mm-dd-HHMM>": { own, opp, report } } — the score is always
 * seen from the own team's side, report links to the nuLiga match report. */
function parseResults(html) {
  const tables = html.match(/<table[^>]*class="result-set"[\s\S]*?<\/table>/g) || [];
  const table = tables.find(
    (t) => t.includes(">Heimmannschaft<") && t.includes(">Gastmannschaft<")
  );
  if (!table) throw new Error("schedule table not found on the page");

  const results = {};
  let date = null; // rows of the same day repeat the date only once
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    if (tr.includes("<th")) continue;
    const raw = tr.match(/<td[\s\S]*?<\/td>/g) || [];
    if (raw.length < 7) continue;
    const cells = raw.map(textOf);
    // layout: tag datum zeit ort heim gast spiele ...
    const [, datum, zeit, , home, guest] = cells;
    const d = datum.match(/^(\d\d)\.(\d\d)\.(\d{4})$/);
    if (d) date = `${d[3]}-${d[2]}-${d[1]}`;
    const tm = zeit.match(/^(\d\d):(\d\d)$/);
    if (!date || !tm) continue;
    if (home !== OWN_TEAM && guest !== OWN_TEAM) continue;

    const score = cells[6].match(/^(\d+):(\d+)$/);
    if (!score) continue; // not played yet
    const href = (raw[6].match(/href="([^"]+)"/) || [])[1];
    const ownIsHome = home === OWN_TEAM;
    results[`${date}-${tm[1]}${tm[2]}`] = {
      own: Number(ownIsHome ? score[1] : score[2]),
      opp: Number(ownIsHome ? score[2] : score[1]),
      report: href ? NULIGA_ORIGIN + href.replace(/&amp;/g, "&") : "",
    };
  }
  return results;
}

function renderResults(results) {
  const lines = Object.keys(results)
    .sort()
    .map((id) => {
      const r = results[id];
      return `  ${JSON.stringify(id)}: { own: ${r.own}, opp: ${r.opp}, report: ${JSON.stringify(r.report)} },`;
    });
  return `window.RESULTS = {\n${lines.join("\n")}\n};\n`;
}

const fileArg = process.argv.indexOf("--from-file");
const html =
  fileArg >= 0
    ? readFileSync(process.argv[fileArg + 1], "utf8")
    : await (async () => {
        const res = await fetch(URL_, { headers: { "User-Agent": "badminton-tools results updater" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })();

const results = parseResults(html);
const current = readFileSync(RESULTS_PATH, "utf8");
const head = current.slice(0, current.indexOf("window.RESULTS"));
if (!head) throw new Error("results.js: window.RESULTS marker not found");
const next = head + renderResults(results);

if (next === current) {
  console.log("unchanged");
} else {
  writeFileSync(RESULTS_PATH, next);
  console.log("updated");
}
