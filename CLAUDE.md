# Fourth and Beers leaderboard

Participants' leaderboard for the 2026 Fourth and Beers league: 22 players, Yahoo Pick'em (group 27197) and Survivor (group 22943). The commissioner is Yo. The page is in Mexican Spanish, funny, in the same voice as the league's reglamento.

## Layout

- `index.html`: the page. GitHub Pages serves the repo root from `main`. It fetches `data.json` and falls back to a seed copy embedded in the page.
- `data.json`: written ONLY by Publish.gs through the GitHub Contents API. Never edit, regenerate or commit it locally. Always take the remote version.
- `gas/`: the Apps Script project, managed with clasp. `Publish.js` is `Publish.gs` in the editor. `Code.js` + `index.html` in `gas/` are a retired web app host.
- `docs/LEADERBOARD_ARCHITECTURE.html`: architecture doc. Same layout and diagram conventions as the model's `ARCHITECTURE.html` in `..\Model`.
- `test/`: Node tests. No live Google or GitHub access.
- `..\Model`: the separate model repo. Read it for patterns (`deploy.bat`, `test.bat`, `test/`). Never change it from this repo.

## How it runs

- Inputs, participants workbook: `PickEm_Board` (Yahoo weekly performance table pasted at A1), `Comentarios` (Semana, Para, Texto, Publicar checkbox), `Sheet1` (only the columns Call Sign PickEm and Fan of).
- Input, model workbook: `Field` (Entrant, Strikes). Read only.
- Script properties: `GITHUB_TOKEN`, `GITHUB_REPO`, `SHEET_ID` (participants), `MODEL_SHEET_ID` (model).
- Triggers: installable onEdit on the participants workbook (PickEm_Board and Comentarios) and a daily 7am `publishLeaderboard`. Runs are serialized with a script lock.
- `publishLeaderboard` reads the live data.json first (for `survivorOut` and the sha), builds a new one, and commits only when something other than `updated` changed.
- data.json fields: `season`, `week`, `weeks`, `updated`, `pays`, `weeklyPrize`, `pickem[] {name, weeks[], total, dropped}`, `strikes {name: n}`, `survivorOut[] {name, week}`, `fans {name: {nfl, ncaa} | {random, other}}`, `comments[] {para, texto}`. Yahoo's Total and Dropped are canon.
- `SURVIVOR_TO_PICKEM` in Publish.js maps Survivor call signs to Pick'em call signs. Apostrophes are normalized (Yahoo uses curly ones).

## Rules

- Versioning: every file carries `v major.minor.bug c major.minor.bug`. v tracks functionality, c tracks content. `index.html` (footer), `Publish.js` (header comment) and the doc (masthead and footer) version independently. Bump on every change.
- Deploy only with `deploy.bat`. Never run `clasp push`, `git push` or `git commit` by hand.
- `test.bat` must pass before any deploy.
- When a tab, data.json field, flow function, trigger or page section is added, renamed or retired, update the architecture doc in the same change and bump its version.
- Page: one self-contained HTML file, vanilla JS, no build step, mobile first, dark mode forced so it reads well in iOS dark mode. Every number and sentence is computed from data.json.
- Copy: Spanish page text in the reglamento's voice. Plain verbs, dry understatement, no em dashes, no semicolons chaining clauses. Roast the picks and the teams, never people's personal lives. Jorge_B picks at random and only teases the die-hard fans.
- Penalties, per the reglamento: last place in the regular-season Pick'em pays the Super Bowl party pizzas for everyone, families included. The first Survivor elimination organizes the carne asada for all participants. Ties split the bill.
- Privacy: this repo is public. Only call signs, points, strikes, fan teams and published comments belong here. Never put emails, real names, money details, workbook IDs or tokens in code, tests, docs or commit messages.
- Yahoo is behind the commissioner's login. No scraping, no stored Yahoo credentials.
- Weekly comments, when asked: read the current data.json and draft 6 to 8 lines as TSV (Semana, Para, Texto). Para is an exact Pick'em call sign or Todos. Include at least one self-roast of the commissioner (Silverback).

## Current versions

- index.html v2.4.0 c1.5.0
- Publish.js v1.3.0 c1.0.0
- docs/LEADERBOARD_ARCHITECTURE.html v2.0.0 c2.1.0

## Roadmap

- Playoff Pick'em section and tab once Yahoo posts the playoff leaderboard.
- GitHub Action that runs the tests and `clasp push` on every push to main, so deploys work without this PC.
- Comment drafts written into Comentarios by Publish.js through the Claude API, unchecked, for review.
