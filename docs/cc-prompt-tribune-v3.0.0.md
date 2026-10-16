# Fourth and Beers Tribune: leaderboard redesign

Read CLAUDE.md first and follow every rule in it unless this prompt changes it on purpose. Plan before you build: show me the plan, wait for my OK, then implement. Ship only through deploy.bat.

## Reference

The approved mockup is `docs\mockups\tribune-dia.html` (I saved it from chat). It is the source of truth for layout, typography, colors and copy tone. The week 5 data.json produced it. Match it.

## Goal

The page stops being a standings page. Yahoo already has the detailed standings. The page becomes the league newspaper: banter, insights and fun facts, plus the prize race. Name: **Fourth and Beers Tribune**, a Chicago Tribune homage, day edition (newsprint).

## 1. Participants workbook

### New tab `Tribune`
- Columns: `Semana | Sección | Para | Título | Texto | Publicar`. Header row frozen.
- `Sección` has a dropdown with exactly: Portada, Columna, Clasificado, Dato.
- `Publicar` is a checkbox. Only checked rows of the current week publish.
- Meaning by Sección:
  - Portada: Título is the headline, Texto is the deck, Para is the player it is about (optional).
  - Columna: the Comish's jokes. Texto only. Para optional.
  - Clasificado: Título is the ad type (SE VENDE, SE RENTA, SE BUSCA, SE REGALA or similar), Texto is the ad, Para the player.
  - Dato: a hand-written fun fact. Título is the label, Texto the fact. Shown ahead of the automatic facts.
- Add `setupTribuneTab()` that creates the tab with validation and formatting. Idempotent.

### Retire the legacy tabs `Comentarios` and `Premios`
- Add `migrateToTribune(dryRun)`:
  - Comentarios rows become Columna rows (Semana, Para, Texto, Publicar kept).
  - Premios rows become Clasificado rows (Titulo goes to Título).
  - Dry run logs row counts per source and per week and writes nothing.
  - Real run appends to Tribune, then checks that the counts match. Only if they match does it delete `Comentarios` and `Premios`. If they do not match it stops and deletes nothing.
- I run the dry run and the real run myself from the Apps Script editor. Tell me when they are ready. Sheets version history is the backup.
- After migration nothing reads Comentarios or Premios. Remove them from the code, the onEdit trigger filter, tests, docs and CLAUDE.md.
- `PickEm_Board` and `Sheet1` (Call Sign PickEm, Fan of) stay as they are. Model workbook `Field` stays read-only.

## 2. Publish.js

- onEdit fires for `PickEm_Board` and `Tribune`. Daily 7am run stays.
- data.json:
  - Remove `comments` and `awards`.
  - Add `tribune`: `{ portada: {titulo, texto, para} | null, columna: [{para, texto}], clasificados: [{titulo, para, texto}], datos: [{titulo, para, texto}] }` from checked rows of the current week.
  - Add `prizes`: `{ regular: [1050, 350], survivor: [1050, 350], playoffs: [700], weekly: 50, weeks: 18 }`. Amounts come from the reglamento: after the weekly $50s the pot splits 30/10 regular, 30/10 Survivor, 20 playoffs. Keep them in one config constant in Publish.js. `pays` and `weeklyPrize` can go once the page reads `prizes`.
- Archive: every publish also writes `editions/semana-NN.json`, a full copy of that week's data.json. When the week moves on, the old file stays frozen. Keep `editions/index.json` with the list of weeks.
- Everything else (strikes, survivorOut, fans, SURVIVOR_TO_PICKEM, commit only on change) stays.

## 3. index.html, complete redesign

### Look
- Newsprint, forced. `color-scheme: only light` plus explicit backgrounds so iOS dark mode cannot invert it. This replaces the "dark mode forced" rule in CLAUDE.md. Update the rule.
- Tokens on `:root` (only place colors are written): paper #F3EEE3, paper2 #E9E2D3, ink #161514, ink2 #3B3834, muted #6B655C, rule #161514, hairline #B9B0A0, red #A3191F (the only spot color: kickers, labels, current week, selected player).
- Type, from Google Fonts with system fallbacks: UnifrakturMaguntia (masthead), Playfair Display 700/800/900 (headlines, big numbers), Source Serif 4 (body), Libre Franklin 600 to 900 (small caps labels, section bars).
- Section headers are centered small caps between a 3px rule and a 1px rule. Mobile first, 390px wide reference, no horizontal scroll, 44px touch targets.

### Page order (opens here, no other controls)
1. Dateline (Edición N, date of the last update, "Una chela"), masthead "Fourth and Beers / Tribune" in blackletter, tagline "La quiniela más grande del mundo. Información que nadie pidió.", double rule.
2. Name picker "¿Quién eres? Escoge tu nombre". This is the only control on the page. `?yo=` and `#name` links keep working and open the panel.
3. Portada: kicker "Última hora", headline, deck, byline "Por el Comish". If there is no Portada row for the week, build one from the biggest climber (e.g. "Del sótano a la azotea" + "X sube N lugares en una semana.").
4. Columna del Comish: the Columna rows, signed "El Comish".
5. Clasificados: two columns with a column rule, ad type in bold caps.
6. Datos que nadie pidió: "La cifra de la semana" in a reversed ink block, then up to 6 facts (number on the left, red label, sentence). Dato rows first, then automatic facts.
7. Premios, pizzas y carne asada (last section), cards in this order:
   - Quiniela regular: 1º and 2º with call sign, points and amount, pill "en juego", note with who is closest to the money and weeks left. Golf-rule ties.
   - Premio semanal $50: 6 × 3 grid of `prizes.weeks` tiles. Played week: ink tile, winner initials, week label under them, winner's team logo in a small cream circle top right. Current week outlined red. Future weeks dashed "$50". A tie splits the tile diagonally with both initials. Pill "N de 18". One key line under the grid lists initials and call signs of winners only. No points on tiles, no per-player totals.
   - La tabla de las aficiones: one row per fan base, team logo (no team name), "×n" fans, bar, cumulative prize money won by its fans (weekly $50s paid so far, final prizes once paid). Sorted by money, ties by fan count. $0 rows muted. Computed note naming the biggest fan base with $0. No averages anywhere.
   - Survivor: 1º $1,050 and 2º $350, labels "El último en pie" and "El penúltimo" until decided, pill "N vivos", note that it runs to the Super Bowl.
   - Quiniela de playoffs: 1º $700 only, pill "en enero", "Todos empiezan en cero". Leave a hook to show the leader once the playoff board exists.
   - Pizzas: current last place (golf ties split the bill), points, gap to the next one, weeks in last.
   - Carne asada: first Survivor elimination (ties split).
8. Footer: "Ediciones anteriores" links (`?ed=N`), "La tabla completa vive en Yahoo" with the Yahoo link, version.

### Initials
First letter of the first two meaningful words. Split on spaces, `_`, `-`, camelCase. Strip a trailing ’s or 's from a word. Skip: of, the, de, la, el, is, our, go, que, lo, let’s, winning. A one-word name takes its first two letters. Guarantee uniqueness (add a third letter on collision). Expected: Silverback SI, Jorge_B JB, King of The North KN, Abogado AB, Andrea’s Picks AP, Manolito’s winning picks MP, Osos de Grayslake OG, KinkyKing KK.

### Logos
Same approach as prod's `logo()`: link, do not embed. NFL from `https://a.espncdn.com/i/teamlogos/nfl/500/<abbr>.png` (the light `500` set, not `500-dark`, because the page is now light; WAS stays `wsh`). Video Juegos uses the Cloud9 URL prod already uses. Keep prod's handling for Suiza and college-only fans. Always set alt text with the team name.

### Name panel (bottom sheet on selection)
- Mini masthead and a close button, kicker "Tu edición", the call sign, one line "Nº con X puntos. Survivor: N vidas."
- Then prod's **Subidas y bajadas** chart, reused as is (both toggles, biggest climber and biggest drop lines, tap a line to follow), restyled with the new tokens: selected player in red, climber green #2E7D4F, drop burnt orange #C2610C, other lines ink at low opacity.
- Then prod's **Survivor: strikes** summary as is (four counts and the grid), selected player's card outlined red.
- Nothing else in the panel.

### Removed from the page
La tabla with bars, the standalone Subidas y bajadas section, Cada semana uno por uno, the heatmap, Premios que no pagan, Palabras del Comish, Castigos (moved into the prizes section), the averages dot plot of aficiones, the standalone Survivor section, Cómo se cuenta, the old ¿Quién eres? card.

### Archive
`?ed=N` loads `editions/semana-NN.json` and renders the same page frozen, with a small banner "Edición N, archivo" and a link back to the current edition. If the file is missing, fall back to the current edition.

## 4. Fact engine (no Claude API, ever)

Deterministic rules over data.json in the page. Each rule returns `{rule, valor, titulo, texto, score}` or nothing. Pick the 6 highest scores. Do not repeat a rule used in the previous week's edition when another candidate exists. The highest-scoring numeric fact becomes La cifra de la semana. For each rule write 2 or 3 Spanish sentence templates in the reglamento voice (plain verbs, dry understatement, no em dashes, no semicolons, roast the picks not the people, never mention the commissioner's model or Jorge_B's random picking, max about 120 characters).

Rules:
1. Rebote / caída: biggest week-over-week change in a player's score.
2. Arriba del promedio: players above the weekly league average every week (1 or 2 players only).
3. Fotocopia: 3 or more players with the same total.
4. Disco rayado: a player with the same weekly score 3 or more times.
5. Racha: 3 or more consecutive weekly increases (or drops).
6. Récord: new season-best or season-worst week this week.
7. Remontada: biggest rise from the week 1 rank, and the current leader's streak.
8. Siempre ahí: a player first or last every week so far.
9. Peor que tu mejor: one player's worst week beats another's best week.
10. Survivor: eliminations this week, the only player with no strikes, the week with the most eliminations.
11. Aficiones as a detector only: e.g. none of a fan base with 3+ fans is in the money, both money spots belong to fans of teams with few fans, biggest fan base with $0 won.

Leave a hook for pick-level rules (same team in consecutive Pick'em weeks, betraying your team, highest confidence lost, lone pick that won, unanimous pick that lost, pushes). They need a `Picks_Board` paste that does not exist yet. Out of scope now. Note it in the roadmap.

## 5. Tests (test.bat must pass)

Use the current week 5 data.json as a fixture. Assert at least:
- Weekly winners: S1 Jorge_B 93, S2 Silverback 76, S3 Silverback 101, S4 King of The North 90, S5 Abogado 94.
- Facts: KinkyKing +60 (23 to 83, weeks 4 to 5) is the cifra. Cyber70 is the only player above average all 5 weeks. Osos de Grayslake, Mean Machine and Jorge_B tie at 281. This is our year scored 65 three times. MVP21 rose 4 straight weeks (35, 38, 53, 71). Steel Man was last all 5 weeks. Silverback was 17th after week 1 and has led 3 weeks. Week 4 had 4 Survivor eliminations. 0 of the 15 Bears and Dallas fans are in the money.
- Aficiones money: Steelers $100, 49ers $50, Bears $50, Video Juegos $50, Cowboys $0, Packers $0.
- Initials: the expected list above, all 22 unique.
- Prize cards: regular, Survivor and playoff amounts. Pizzas Steel Man. Carne asada KinkyKing.
- Migration: mock Comentarios and Premios rows land in Tribune with the right Sección, counts verified, legacy tabs deleted only on a match.
- Copy lint: no em dashes or chained semicolons in any page string.
- Page renders with no data.json (seed fallback) and with `?ed=5`.

## 6. Versions, docs and deploy
- Bump per the convention. Major functional bump for index.html (v3.0.0) and Publish.js (v2.0.0) because tabs and data.json change incompatibly. Content bumps as appropriate. Bump the architecture doc.
- Update `docs\LEADERBOARD_ARCHITECTURE.html`: Tribune tab added, Comentarios and Premios retired, new data.json fields, editions/ folder, new page sections, name panel.
- Update CLAUDE.md: layout, inputs, the newsprint rule, current versions, and replace the weekly comments and awards instructions with: "Weekly Tribune batch, when asked: read the current data.json and draft 1 Portada, 6 to 8 Columna, 4 to 6 Clasificado and optional Dato rows as a CSV file (Semana, Sección, Para, Título, Texto) ready to import." Roadmap: Picks_Board and pick-level facts, playoff leader in the playoffs card.
- Publish.js must keep working if the Tribune tab does not exist yet (publish with an empty `tribune`, page uses its fallbacks).
- Order of work: plan, then code and tests, then `deploy.bat --check`, then `deploy.bat` (the migration functions only exist in Apps Script after the push). Then tell me to run `setupTribuneTab`, the migration dry run and the real migration, in that order. Finish by running `publishLeaderboard` once and checking that data.json carries the migrated week 5 rows.
