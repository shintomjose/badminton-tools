"""Turn the BWBV Spielberechtigungsliste PDF into the JSON the tracker's
Spielerliste view imports.

    python dev/roster-from-pdf.py docs/<licence list>.pdf dev/roster-import.json

Needs PyMuPDF (pip install pymupdf). The output holds personal data (pass
numbers, dates of birth) and is gitignored; the PDF is gitignored too. The
list only ever reaches Firestore, behind the owner-only rules.

Layout of the PDF text (one value per line, per player):
    Name, Vorname / Pass-Nr. / Geb.-Datum / [(JFG)] / Geschl. / Nation /
    Spielberechtigt ab / Erstspielberechtigung
"""
import json
import re
import sys

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    sys.exit("PyMuPDF missing: pip install pymupdf")

PASS = re.compile(r"^\d{2}-\d{6}$")
DATE = re.compile(r"^\d{2}\.\d{2}\.\d{4}$")


def iso(d):
    p = d.split(".")
    return f"{p[2]}-{p[1]}-{p[0]}"


def parse(pdf_path):
    doc = fitz.open(pdf_path)
    lines = []
    for page in doc:
        lines += [l.strip() for l in page.get_text().split("\n")]
    header = [l for l in lines if l.startswith("Spielberechtigungsliste") or "(" in l and ")" in l and l.startswith("TSG")]
    players = []
    i = 0
    while i < len(lines):
        if i + 2 < len(lines) and PASS.match(lines[i + 1]) and DATE.match(lines[i + 2]):
            name, pass_nr, dob = lines[i], lines[i + 1], lines[i + 2]
            j = i + 3
            jfg = False
            if j < len(lines) and lines[j] == "(JFG)":
                jfg = True
                j += 1
            sex, nation, since, first = lines[j], lines[j + 1], lines[j + 2], lines[j + 3]
            players.append({
                "name": name, "passNr": pass_nr, "dob": iso(dob),
                "sex": "w" if sex == "w" else "m", "nation": nation,
                "since": iso(since), "first": iso(first), "jfg": jfg,
            })
            i = j + 4
        else:
            i += 1
    stamp = ""
    for l in lines:
        m = re.search(r"erstellt am (\d{2}\.\d{2}\.\d{4})", l)
        if m:
            stamp = m.group(1)
            break
    club = next((l for l in lines if re.match(r"^TSG .*\(\d+\)$", l)), "")
    source = " ".join(x for x in ["Spielberechtigungsliste", club, stamp] if x).strip()
    return {"source": source, "players": players}


def main(argv):
    if len(argv) != 3:
        sys.exit(__doc__)
    out = parse(argv[1])
    with open(argv[2], "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    men = sum(1 for p in out["players"] if p["sex"] == "m")
    print(f"{len(out['players'])} players ({men} m, {len(out['players']) - men} w) -> {argv[2]}")


if __name__ == "__main__":
    main(sys.argv)
