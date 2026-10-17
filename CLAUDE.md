# Fourth and Beers leaderboard

Participants' newspaper for the 2026 Fourth and Beers league: 22 players, Yahoo Pick'em (group 27197) and Survivor (group 22943). The page is the **Fourth and Beers Tribune**, a Chicago Tribune homage in newsprint: banter, insights, fun facts and the prize race. Yahoo already has the detailed standings. The commissioner is Yo. The page is in Mexican Spanish, funny, in the same voice as the league's reglamento.

## Layout

- `index.html`: the page. GitHub Pages serves the repo root from `main`. It fetches `data.json` (or `editions/semana-NN.json` for `?ed=N`) and falls back to a seed copy embedded in the page.
- `data.json` and `editions/`: written ONLY by Publish.gs through the GitHub Contents API. Never edit, regenerate or commit them locally. Always take the remote version. `editions/semana-NN.json` is a full copy of that week's data.json, `editions/index.json` lists the weeks. A week that has moved on is never rewritten.
- `gas/`: the Apps Script project, managed with clasp. `Publish.js` is `Publish.gs` in the editor. The project holds only `Publish.js` and `appsscript.json`. History: the old web app host was undeployed and deleted on 2026-10-01.
- `docs/LEADERBOARD_ARCHITECTURE.html`: architecture doc. Same layout and diagram conventions as the model's `ARCHITECTURE.html` in `..\Model`.
- `docs/mockups/tribune-dia.html`: the approved mockup of the Tribune. Reference for layout, type, colors and copy tone.
- `test/`: Node tests. No live Google or GitHub access. `test/fixtures/week5.json` is the real week 5 data.json in the current schema, `week5-old.json` is the same week in the old schema.
- `..\Model`: the separate model repo. Read it for patterns (`deploy.bat`, `test.bat`, `test/`). Never change it from this repo.

## How it runs

- Inputs, participants workbook: `PickEm_Board` (Yahoo weekly performance table pasted at A1), `Tribune` (Semana, Sección, Para, Título, Texto, Publicar checkbox, plus G1 `Revisión` and the status cell H1) and `Participantes` (the old Sheet1. Only the columns Call Sign PickEm, Fan of and the optional Apodo, which setup inserts between G and H. Columns are found by header). `Sección` is a dropdown: Portada, Columna, Clasificado, Dato, Edición. Row meaning: Portada is the headline (Título) and deck (Texto), Para optional. Columna is one paragraph of the Portada story in sheet order, Título an optional crosshead. Clasificado is an ad (Título is the ad type, `Q.E.P.D.` or `QEPD` in any case makes it an esquela). Dato is a labeled fact. Edición is at most one per week: Título is a banner under the masthead, Texto replaces the tagline, Para is the theme key (only `muertos` exists). `Apodo` holds comma separated nicknames per participant (Kinky for KinkyKing, Osos for Osos de Grayslake, el Comish for Silverback) so the page can bold them. Emails are never published. `Comentarios` and `Premios` are retired: `migrateToTribune(dryRun)` moves them into Tribune and deletes them only when the counts match. Nothing else reads them.
- Input, model workbook: `Field` (Entrant, Strikes). Read only.
- Script properties: `GITHUB_TOKEN`, `GITHUB_REPO`, `SHEET_ID` (participants), `MODEL_SHEET_ID` (model).
- Revisión: every publish checks the current week's checked Tribune rows and writes Spanish warnings to H1, tinting the rows involved light red. It warns when the last place is named in more than one row or Columna paragraph, was also named last week, when Columna has no Portada, when there is more than one Edición or an unknown tema. It never blocks a publish and never edits text. A clean batch clears H1 and only the tint it set.
- Triggers: installable onEdit on the participants workbook (PickEm_Board and Tribune) and a daily 7am `publishLeaderboard`. Runs are serialized with a script lock.
- `publishLeaderboard` reads the live data.json first (for `survivorOut` and the sha), builds a new one, then writes the week's edition, the edition index and data.json, in that order. Each file is committed only when something other than `updated` changed. A missing Tribune tab publishes an empty `tribune`.
- data.json fields: `season`, `week`, `weeks`, `updated`, `prizes {regular[], survivor[], playoffs[], weekly, weeks}`, `pickem[] {name, weeks[], total, dropped}`, `strikes {name: n}`, `survivorOut[] {name, week}`, `fans {name: {nfl, ncaa} | {random, other}}`, `apodos {name: [alias]}`, `tribune {portada: {titulo, texto, para} | null, columna[] {titulo, para, texto}, clasificados[] {titulo, para, texto}, datos[] {titulo, para, texto}, edicion: {titulo, texto, tema} | null}`. Yahoo's Total and Dropped are canon. The prize amounts live in one `PRIZES` constant in Publish.js.
- `SURVIVOR_TO_PICKEM` in Publish.js maps Survivor call signs to Pick'em call signs. Apostrophes are normalized (Yahoo uses curly ones).
- The page still reads the old schema (pays, weeklyPrize, comments, awards) until the first publish after the 3.0 deploy, then ignores those fields. A data.json without apodos, edicion or Columna titulo renders as is.
- Names: one resolver, the same code block in `index.html` and `Publish.js` between `// BEGIN NAMES` and `// END NAMES` (a test fails if they differ). Call signs plus apodos, case-insensitive, curly and straight apostrophes equal, whole words, longest match first. The page bolds mentions with `<b class="nombre">` and gives the selected reader `.tuyo`. Sheet text is always escaped first.
- Last-place rule: the last place (every player tied for last, golf rule) is roasted at most once per edition. Priority: the Portada story (never cut), the first Clasificado, Datos, then the automatic facts, which carry `sujetos`. Items over budget are not rendered. Pizzas, prize tiles and the name panel are exempt.
- Themes: `THEMES` in index.html and `THEMES_KNOWN` in Publish.js, plus an `html[data-tema]` CSS block that only remaps tokens. `muertos` swaps the accent for a marigold. Chart and prize colors never change.

## Rules

- Versioning: every file carries `v major.minor.bug c major.minor.bug`. v tracks functionality, c tracks content. `index.html` (footer), `Publish.js` (header comment) and the doc (masthead and footer) version independently. Bump on every change.
- Deploy only with `deploy.bat`. Never run `clasp push`, `git push` or `git commit` by hand.
- `test.bat` must pass before any deploy.
- When a tab, data.json field, flow function, trigger or page section is added, renamed or retired, update the architecture doc in the same change and bump its version.
- Page: one self-contained HTML file, vanilla JS, no build step, mobile first. Newsprint, light only: `color-scheme: only light` plus explicit backgrounds so iOS dark mode cannot invert it. Every color is a token in the `:root` block and nowhere else. Every number and sentence is computed from data.json in the browser. The fact engine is deterministic rules, never a model call.
- Copy: Spanish page text in the reglamento's voice. Plain verbs, dry understatement, no em dashes, no semicolons chaining clauses. Roast the picks and the teams, never people's personal lives. Jorge_B picks at random and only teases the die-hard fans. Fact sentences never mention the commissioner's model or Jorge_B's random picking, and run about 120 characters at most.
- Penalties, per the reglamento: last place in the regular-season Pick'em pays the Super Bowl party pizzas for everyone, families included. The first Survivor elimination organizes the carne asada for all participants. Ties split the bill. Prize ties follow the golf rule.
- Privacy: this repo is public. Only call signs, points, strikes, fan teams, the reglamento's prize amounts and published Tribune rows belong here. Never put emails, real names, payment details, workbook IDs or tokens in code, tests, docs or commit messages.
- Yahoo is behind the commissioner's login. No scraping, no stored Yahoo credentials.
- Weekly Tribune batch, when asked: read the current data.json and the last four editions, then draft 1 Portada (headline and deck), 5 to 6 Columna paragraphs that form one story, 4 to 6 Clasificado rows and optional Dato and Edición rows, as a CSV file (Semana, Sección, Para, Título, Texto) ready to import. Last place is named in one row at most. Para is an exact Pick'em call sign, a comma separated list of them, or Todos. Same voice rules as above. Do not repeat what the fact engine already prints.

## Current versions

- index.html v3.1.0 c2.1.0
- Publish.js v2.2.0 c1.3.0
- docs/LEADERBOARD_ARCHITECTURE.html v3.1.1 c3.1.1

## Roadmap

- `Picks_Board` paste and pick-level facts: same team in consecutive Pick'em weeks, betraying your team, highest confidence lost, lone pick that won, unanimous pick that lost, pushes.
- Playoff leader in the playoffs card once Yahoo posts the playoff leaderboard (the page already reads `playoffs.pickem` when data.json carries it).
- Backfill editions 1 to 4 from the git history of data.json, if wanted.
- GitHub Action that runs the tests and `clasp push` on every push to main, so deploys work without this PC.
- Remove `migrateToTribune` and `LEGACY_TABS` from Publish.js once the migration has run.
