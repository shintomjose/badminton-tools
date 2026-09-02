# Badminton Tools — TSG Heilbronn

A static, build-step-free web app (plain HTML/CSS/JS + Firebase compat SDK) for
the TSG Heilbronn badminton teams: rankings, lineup builder, fixtures with shared
availability, directions, the VICTOR club shop — and a private match tracker.

There is nothing to build: open `index.html`, or serve the folder with any
static server. Every push to `main` deploys automatically to GitHub Pages and
to both Firebase Hosting sites (via `.github/workflows/deploy-hosting.yml`).

## App links

| App | URL | Notes |
| --- | --- | --- |
| **Badminton Tools** (this repo) | https://tsg-badminton-fansite.web.app | Primary. Use this one to install the PWA — Google sign-in for the match tracker works inside the installed app here (first-party auth domain). |
| Badminton Tools (mirror) | https://badminton-tools-c6b27.web.app | Firebase default site, same deploys. |
| Badminton Tools (mirror) | https://shintomjose.github.io/badminton-tools/ | GitHub Pages. Tracker sign-in works via popup only. |
| Match tracker direct link | https://tsg-badminton-fansite.web.app/#tracker | Tab 6 ("Spiele"/"Results"), owner-only data. |
| **Team 4 app** (repo `tsg-heilbronn`) | https://tsg-badminton-our-team.web.app | Share this with Team 4 members; installs as the "Team 4" PWA. |
| Team 4 app (mirror) | https://shintomjose.github.io/tsg-heilbronn/ | GitHub Pages. |

Both apps share the same Firebase Realtime Database — availability and team
data sync between them in both directions.

| File | Purpose |
| --- | --- |
| `index.html` | App shell, tab markup |
| `app.js` | i18n (DE default / EN dictionary), theme, tabs, PIN, tabs 1–5 |
| `tracker-core.js` | Match tracker: Firestore layer, Google owner auth, PIN gate, view registry (`MT`) |
| `tracker-entry.js` | Match tracker: training entry flow |
| `style.css` | Design tokens and all styling |
| `sw.js` / `pwa.js` | Service worker and PWA bootstrap |
| `firestore.rules` | Security rules for the match tracker collections |
| `firestore.indexes.json` | Composite indexes required by the tracker queries |

Tabs 1–5 use the Firebase **Realtime Database** with anonymous auth. The match
tracker (tab 6) uses **Firestore** with Google sign-in, in the same Firebase
project. The two are independent.

## Match Tracker setup

The match tracker stores private data. The PIN on the tab protects the UI only —
the actual boundary is Firestore security rules bound to one Google account.
Do these four steps once:

1. **Create the Firestore database.** Firebase console → *Firestore Database* →
   *Create database*. In the current console flow: edition **Standard** (the
   Enterprise/MongoDB engine does not work with this app's web SDK), database ID
   **`(default)`** (the SDK only connects to the default database — do not use a
   custom ID), location **`europe-west3`** (Frankfurt), and in the *Configure*
   step pick the **locked / production-mode rules** (deny all — never test
   mode). Denying everything is the right starting point; step 3 opens it up
   for exactly one account.

2. **Enable Google sign-in.** Firebase console → *Authentication* → *Sign-in
   method* → enable the **Google** provider. Then under *Settings → Authorized
   domains* add `shintomjose.github.io` and `localhost`. (Leave the existing
   **Anonymous** provider enabled — tabs 1–5 still use it.)

3. **Publish rules and indexes.** Paste the contents of `firestore.rules` into
   *Firestore Database → Rules* and publish, and create the two composite
   indexes from `firestore.indexes.json` under *Firestore Database → Indexes*.
   With the Firebase CLI both steps are one command:

   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```

   Index builds take a few minutes; until they finish, the history and stats
   queries fall back to a slower client-side sort.

4. **Bind the rules to your account.** Open the app, go to the **Spiele /
   Matches** tab, enter the PIN, and sign in with Google. The first Firestore
   read will be denied, and the tracker shows a *setup card* with your uid and a
   **UID kopieren** button. Paste that uid into `firestore.rules` in place of
   `PASTE_OWNER_UID_HERE`, publish the rules again, then tap **Erneut prüfen**
   in the app. From then on the tracker works — including fully offline, since
   Firestore offline persistence is enabled.

### Notes

- The tracker PIN is the existing app PIN. It unlocks only the tracker tab
  (`localStorage` keys `mt-pin-unlock` / `mt-pin-last`) and re-locks after 30
  minutes of inactivity (`MT_PIN_TIMEOUT_MIN` in `tracker-core.js`; set
  `MT_PIN_DISABLED = true` there to bypass it during development).
- Collections: `sessions`, `matches`, `players`, `locations` — flat and
  top-level, so history and stats can query across everything without
  collection-group queries.
- Writes resolve as soon as they are queued locally, so entry keeps working in a
  hall with no reception. The chip in the tracker header reports the honest
  state: `● synchronisiert` / `⏳ ausstehend…` / `○ offline`.
