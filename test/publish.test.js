'use strict';
// Mock-GAS tests for gas/Publish.js. Synthetic call signs only, no live Google or GitHub.
const A = require('./assert');
const { makeSheet, makeWorkbook, makeGithub, loadPublisher } = require('./mock_gas');
const PF = require('./picks_fixture');

// ---- Fixtures ---------------------------------------------------------------

const CURLY_1 = 'Chitown’DemBoyz';       // Yahoo uses curly apostrophes
const CURLY_2 = 'Manolito’s winning picks';
const STRAIGHT_1 = CURLY_1.replace('’', "'");

// Yahoo weekly table. Weeks 1 to 3 played (Billy Beaner missed week 2), 4 to 18 still blank.
const PLAYERS = [
  // name, [wk1, wk2, wk3], total, dropped
  ['Silverback', [57, 76, 101], 177, 57],
  ['Jorge_B', [93, 39, 56], 149, 39],
  ['Billy Beaner', [78, 0, 50], 128, 0],
  ['This is our year', [57, 65, 65], 130, 57],
  [CURLY_1, [60, 63, 60], 123, 60],
  [CURLY_2, [72, 49, 54], 126, 49],
  ['KinkyKing', [51, 59, 52], 111, 51],
  ['Steel Man', [45, 47, 43], 92, 43],
];

function boardGrid() {
  const head = ['Rank', 'Pick Set Name'];
  for (let w = 1; w <= 18; w++) head.push('Wk ' + w);
  head.push('Total', 'Dropped');
  const rows = [['Fourth and Beers 2026'], ['Weekly performance'], [], head];
  PLAYERS.forEach((p, i) => {
    const r = [String(i + 1), p[0]];
    for (let w = 0; w < 18; w++) r.push(w < p[1].length ? String(p[1][w]) : '');
    r.push(String(p[2]), String(p[3]));
    rows.push(r);
  });
  return rows;
}

// Same table, pasted as tab-separated text that landed entirely in column A.
function boardTabbed() { return boardGrid().map(r => [r.join('\t')]); }

// Same table with week 4 scored for everyone (column 5 is Wk 4).
function boardWeek4() { return boardGrid().map((r, i) => i >= 4 ? r.map((c, j) => j === 5 ? '50' : c) : r); }

const FIELD = [
  ['Field'], [], [],
  ['Entrant', 'Strikes', 'Alive?'],
  ['Beeeeeerman', '1', 'yes'],                       // alias -> This is our year
  ['My Great Pick Set (YOU)', '0', 'yes'],           // alias plus the (YOU) suffix -> Jorge_B
  ['silverback (you)', '2', 'yes'],                  // direct match, suffix in lower case
  ['Nem’s Pick Set', '1', 'yes'],               // curly apostrophe in the alias key -> Chitown
  ["Manuel's marvelous picks", '2', 'yes'],          // straight apostrophe, Yahoo name is curly
  ['My First-Rate Pick Set', '2', 'yes'],            // alias -> Steel Man
  ['KinkyKing', '3', 'OUT'],
  ['Totally Unknown Team', '1', 'yes'],              // no Pick'em match, skipped and logged
];

const FANS = [
  ['Call Sign PickEm', 'Fan of', 'Notes'],
  ['Silverback', 'PIT', ''],
  ['Jorge_B', 'League of Legends', ''],
  ['Billy Beaner', 'Dallas Cowboys and Michigan', ''],
  ['This is our year', 'Cowboys', ''],
  [STRAIGHT_1, 'Chicago, Wisconsin', ''],   // straight apostrophe in the sheet, curly in Yahoo
  [CURLY_2, 'Random', ''],
  ['KinkyKing', '', ''],                                         // blank, no entry
  ['Steel Man', 'Michigan', ''],                                 // college only
  ['Nobody On The Board', 'KC', ''],                             // not a Pick'em name, ignored
];

// Tribune: Semana | Sección | Para | Título | Texto | Publicar. Row number in the sheet = index + 1.
const TRIBUNE_HEAD = ['Semana', 'Sección', 'Para', 'Título', 'Texto', 'Publicar'];
const TRIBUNE = [
  TRIBUNE_HEAD,
  ['3', 'Portada', 'Abogado', 'Del sótano a la azotea', 'Sube nueve lugares.', 'TRUE'],      // row 2
  ['3', 'Portada', '', 'Segunda portada', 'No cuenta.', 'TRUE'],                              // row 3, only one per week
  ['3', 'Columna', 'Silverback', '', 'Se roasteó solo.', 'TRUE'],
  ['3', 'Columna', 'Todos', '', 'Buen domingo, mal pick.', 'TRUE'],
  ['3', 'Columna', STRAIGHT_1, '', 'Para el de Chitown.', 'TRUE'],
  ['3', 'Columna', 'Nadie Conocido', '', 'Destinatario raro.', 'TRUE'],
  ['3', 'Columna', 'Jorge_B', '', 'No marcado.', 'FALSE'],
  ['2', 'Columna', 'Jorge_B', '', 'Semana vieja.', 'TRUE'],
  ['3', 'Columna', 'Jorge_B', '', '', 'TRUE'],                                                // row 10, no Texto
  ['3', 'Clasificado', 'Silverback', 'SE VENDE', 'Semana de 101 puntos.', 'TRUE'],
  ['3', 'clasificado', 'Jorge_B, ' + STRAIGHT_1 + ',  Silverback', 'SE BUSCA', 'Varios.', 'TRUE'],
  ['3', 'Clasificado', '', 'SE REGALA', 'Para todos.', 'TRUE'],
  ['3', 'Clasificado', 'Jorge_B', '', 'Sin título.', 'TRUE'],                                 // row 14, no Título
  ['3', 'Dato', 'Steel Man', 'Último', 'Último las tres semanas.', 'TRUE'],
  ['3', 'Dato', '', 'Sin texto', '', 'TRUE'],                                                 // row 16, no Texto
  ['3', 'Chisme', 'Jorge_B', 'X', 'Y', 'TRUE'],                                               // row 17, not a Sección
];

/** opts.tribune: rows, or null for no Tribune tab. opts.extra: more tabs for the workbook. */
function participants(boardRows, o) {
  o = o || {};
  const tabs = [makeSheet('PickEm_Board', boardRows || boardGrid()), makeSheet('Sheet1', o.fans || FANS)];
  if (o.tribune !== null) tabs.push(makeSheet('Tribune', o.tribune || TRIBUNE));
  (o.extra || []).forEach(t => tabs.push(t));
  return makeWorkbook('participants', tabs);
}
const model = (rows) => makeWorkbook('model', [makeSheet('Field', rows || FIELD)]);

function setup(o) {
  o = o || {};
  const github = o.github || makeGithub(null);
  const ctx = loadPublisher({
    participants: o.participants || participants(o.board, o),
    model: o.model || model(o.field),
    github,
    props: o.props,
  });
  return { ctx, github };
}

/** Builds data.json without touching GitHub. */
function build(o) {
  const { ctx } = setup(o);
  const d = ctx.buildData_(ctx.SpreadsheetApp.openById('participants'), ctx.SpreadsheetApp.openById('model'), o && o.prev || null);
  return { d: JSON.parse(JSON.stringify(d)), ctx };
}

function without(d, key) { const c = JSON.parse(JSON.stringify(d)); delete c[key]; return c; }
/** The Warnings table of a Tribune tab: [{text, week, color}] for the rows that have a warning. */
const warnTable = sh => sh.rows().slice(1).map((r, i) => ({ text: String(r[8] || ''), week: r[9] === '' || r[9] == null ? null : Number(r[9]), color: sh.bg(i + 2, 8) })).filter(x => x.text);
const tab = (ws, name) => ws.getSheets().find(t => t.getName() === name);
const tabNames = ws => ws.getSheets().map(t => t.getName());

// ---- Cases ------------------------------------------------------------------

A.run('Publish.js', [
  ['both paste shapes give the same data', () => {
    const grid = build({ board: boardGrid() }).d;
    const tabbed = build({ board: boardTabbed() }).d;
    A.deep(without(tabbed, 'updated'), without(grid, 'updated'));
    A.equal(grid.pickem.length, PLAYERS.length, 'players');
    A.equal(grid.week, 3, 'week is the last week anyone scored');
    A.deep(grid.pickem[0], { name: 'Silverback', weeks: [57, 76, 101], total: 177, dropped: 57 }, 'first row');
    A.deep(grid.pickem[2].weeks, [78, 0, 50], 'a missed week stays a zero in the middle');
    A.equal(grid.pickem[2].dropped, 0, 'Yahoo dropped is canon');
    A.deep(Object.keys(grid).sort(),
      ['apodos', 'fans', 'pickem', 'picks', 'prizes', 'season', 'strikes', 'survivorOut', 'tribune', 'updated', 'week', 'weeks'], 'fields: apodos and picks added, no comments, awards, pays or weeklyPrize');
  }],

  ['display values with a header only (no scores) throw a clear error', () => {
    const rows = boardGrid().map((r, i) => i <= 3 ? r : r.map((c, j) => (j >= 2 && j < 20) ? '' : c));
    const { ctx } = setup({ board: rows });
    let msg = '';
    try { ctx.buildData_(ctx.SpreadsheetApp.openById('participants'), ctx.SpreadsheetApp.openById('model'), null); } catch (e) { msg = e.message; }
    A.match(msg, /No scores yet/);
  }],

  ['strikes: curly and straight apostrophes, (YOU) suffix, aliases, unknown names', () => {
    const { d, ctx } = build();
    A.equal(d.strikes['This is our year'], 1, 'Beeeeeerman alias');
    A.equal(d.strikes['Jorge_B'], 0, 'alias plus (YOU)');
    A.equal(d.strikes['Silverback'], 2, 'direct, lower-case (you)');
    A.equal(d.strikes[CURLY_1], 1, 'curly alias key, Yahoo name keeps its curly apostrophe');
    A.equal(d.strikes[CURLY_2], 2, 'straight Survivor apostrophe against a curly Yahoo name');
    A.equal(d.strikes['Steel Man'], 2, 'First-Rate alias');
    A.equal(d.strikes['KinkyKing'], 3);
    A.ok(!('Billy Beaner' in d.strikes), 'no Field row, no strikes entry');
    A.ok(!('Totally Unknown Team' in d.strikes), 'unknown Survivor name is skipped');
    A.equal(Object.keys(d.strikes).length, 7, 'only matched names');
    A.ok(ctx._logs.some(l => /Totally Unknown Team/.test(l)), 'unknown name is logged for SURVIVOR_TO_PICKEM');
  }],

  ['no Field tab skips Survivor without failing', () => {
    const { d } = build({ model: makeWorkbook('model', [makeSheet('Other', [['x']])]) });
    A.deep(d.strikes, {});
    A.deep(d.survivorOut, []);
  }],

  ['Fan of parsing', () => {
    const f = build().d.fans;
    A.deep(f['Silverback'], { nfl: 'PIT' }, 'abbreviation');
    A.deep(f['Jorge_B'], { random: true, other: 'League of Legends' }, 'the non-fan');
    A.deep(f['Billy Beaner'], { nfl: 'DAL', ncaa: 'Michigan' }, 'team name and college');
    A.deep(f['This is our year'], { nfl: 'DAL' }, 'nickname');
    A.deep(f[CURLY_1], { nfl: 'CHI', ncaa: 'Wisconsin' }, 'city, comma, college, apostrophe normalized');
    A.deep(f[CURLY_2], { random: true, other: '' }, 'Random');
    A.deep(f['Steel Man'], { ncaa: 'Michigan' }, 'college only');
    A.ok(!('KinkyKing' in f), 'blank is no entry');
    A.ok(!('Nobody On The Board' in f), 'names off the board are ignored');
  }],

  ['Fan of: the first NFL team listed wins', () => {
    const fans = [['Call Sign PickEm', 'Fan of'], ['Silverback', 'Dallas and Chicago'], ['Jorge_B', 'Bears / Cowboys']];
    const f = build({ fans }).d.fans;
    A.deep(f['Silverback'], { nfl: 'DAL' });
    A.deep(f['Jorge_B'], { nfl: 'CHI' });
  }],

  ['no Fan of tab gives empty fans', () => {
    const { d } = build({ fans: [['Name', 'Other'], ['Silverback', 'x']] });
    A.deep(d.fans, {});
  }],

  ['prizes: one config constant, the reglamento split', () => {
    const p = build().d.prizes;
    A.deep(p, { regular: [1050, 350], survivor: [1050, 350], playoffs: [700], weekly: 50, weeks: 18 });
    A.deep([p.regular[0], p.regular[1], p.survivor[0], p.survivor[1], p.playoffs[0]].map(x => x / 350), [3, 1, 3, 1, 2], '30/10 regular, 30/10 Survivor, 20 playoffs');
  }],

  ['Tribune: only checked rows of the current week, grouped by Sección', () => {
    const t = build().d.tribune;
    A.deep(Object.keys(t), ['portada', 'columna', 'clasificados', 'datos', 'edicion']);
    A.equal(t.edicion, null, 'no Edición row, no edición');
    A.deep(t.portada, { titulo: 'Del sótano a la azotea', texto: 'Sube nueve lugares.', para: 'Abogado' }, 'first Portada wins');
    A.deep(t.columna, [
      { titulo: '', para: 'Silverback', texto: 'Se roasteó solo.' },
      { titulo: '', para: '', texto: 'Buen domingo, mal pick.' },
      { titulo: '', para: CURLY_1, texto: 'Para el de Chitown.' },
      { titulo: '', para: 'Nadie Conocido', texto: 'Destinatario raro.' },
    ], 'Columna, sheet order, Todos is blank, apostrophes normalized');
    A.deep(t.clasificados, [
      { titulo: 'SE VENDE', para: 'Silverback', texto: 'Semana de 101 puntos.' },
      { titulo: 'SE BUSCA', para: 'Jorge_B, ' + CURLY_1 + ', Silverback', texto: 'Varios.' },
      { titulo: 'SE REGALA', para: '', texto: 'Para todos.' },
    ], 'Clasificados, Sección in any case, several names, blank means everyone');
    A.deep(t.datos, [{ titulo: 'Último', para: 'Steel Man', texto: 'Último las tres semanas.' }], 'Dato');
  }],

  ['Tribune: skipped rows are logged, unknown names publish as typed', () => {
    const { ctx } = build();
    A.ok(ctx._logs.some(l => /row 3: only one Portada/.test(l)), 'second Portada');
    A.ok(ctx._logs.some(l => /row 10 is a checked Columna without Texto/.test(l)), 'Columna without Texto');
    A.ok(ctx._logs.some(l => /row 14 is checked but has no Título or no Texto/.test(l)), 'Clasificado without Título');
    A.ok(ctx._logs.some(l => /row 16 is checked but has no Título or no Texto/.test(l)), 'Dato without Texto');
    A.ok(ctx._logs.some(l => /row 17 .*"Chisme" is not one of/.test(l)), 'unknown Sección');
    A.ok(ctx._logs.some(l => /Nadie Conocido/.test(l)), 'unknown name');
  }],

  ['Tribune: a Portada without a Título is skipped', () => {
    const rows = [TRIBUNE_HEAD, ['3', 'Portada', '', '', 'Solo deck.', 'TRUE']];
    A.equal(build({ tribune: rows }).d.tribune.portada, null);
  }],

  ['Tribune: checkbox spellings, header lookup, and no Tribune tab', () => {
    const rows = [TRIBUNE_HEAD,
      ['3', 'Columna', 'Todos', '', 'a', 'true'], ['3', 'Columna', 'Todos', '', 'b', 'x'], ['3', 'Columna', 'Todos', '', 'c', 'Sí'],
      ['3', 'Columna', 'Todos', '', 'd', 'no'], ['3', 'Columna', 'Todos', '', 'e', '']];
    A.deep(build({ tribune: rows }).d.tribune.columna.map(x => x.texto), ['a', 'b', 'c']);
    // Columns found by header name, so a reordered sheet still reads right.
    const swapped = [['Publicar', 'Texto', 'Semana', 'Sección', 'Título', 'Para'], ['TRUE', 'Hola.', '3', 'Columna', '', 'Silverback']];
    A.deep(build({ tribune: swapped }).d.tribune.columna, [{ titulo: '', para: 'Silverback', texto: 'Hola.' }]);
    A.deep(build({ tribune: null }).d.tribune, { portada: null, columna: [], clasificados: [], datos: [], edicion: null }, 'no tab, empty tribune, no failure');
  }],

  ['survivorOut carries forward, adds new outs, drops corrected ones', () => {
    const prev = { survivorOut: [
      { name: 'Silverback', week: 2 },      // strikes now 2: corrected below 3, dropped
      { name: 'Old Timer', week: 1 },       // not on the Field tab any more, kept
      { name: 'KinkyKing', week: 2 },       // still 3, keeps the earlier week
    ] };
    const d = build({ prev }).d;
    A.deep(d.survivorOut, [
      { name: 'Old Timer', week: 1 },
      { name: 'KinkyKing', week: 2 },
    ]);
    const fresh = build().d;
    A.deep(fresh.survivorOut, [{ name: 'KinkyKing', week: 3 }], 'no previous file: first seen this week');
  }],

  ['publishLeaderboard: edition, index, then data.json; no-change skip; change commits again', () => {
    const { ctx, github } = setup();
    const r1 = ctx.publishLeaderboard();
    A.match(r1, /Committed editions\/semana-03\.json, editions\/index\.json, data\.json \(week 3\)/);
    A.deep(github.state.puts.map(p => p.path), ['editions/semana-03.json', 'editions/index.json', 'data.json'], 'data.json goes last');
    A.deep(github.state.puts.map(p => p.message), ['Semana 3: edición archivada', 'Semana 3: índice de ediciones', 'Semana 3: tabla actualizada']);
    A.ok(github.state.puts.every(p => !p.hadSha), 'creating files sends no sha');
    A.ok(github.state.puts.every(p => p.branch === 'main' && p.auth === 'Bearer test-token'));
    A.equal(github.state.files['editions/semana-03.json'].text, github.state.file.text, 'the edition is a full copy of data.json');
    A.deep(JSON.parse(github.state.files['editions/index.json'].text), { weeks: [3] });
    A.equal(JSON.parse(github.state.file.text).week, 3);

    const r2 = ctx.publishLeaderboard();
    A.match(r2, /No changes, nothing committed/);
    A.equal(github.state.puts.length, 3, 'same numbers, only the timestamp differs, no commit');

    // A score changes in the sheet. Edition and data.json update, the index does not.
    const rows = boardGrid().map((r, i) => i === 4 ? r.map((c, j) => j === 4 ? '88' : c) : r);
    const ctx2 = loadPublisher({ participants: participants(rows), model: model(), github });
    const r3 = ctx2.publishLeaderboard();
    A.match(r3, /Committed editions\/semana-03\.json, data\.json/);
    A.equal(github.state.puts.length, 5);
    A.ok(github.state.puts[3].hadSha && github.state.puts[4].hadSha, 'updating sends the sha it read');
  }],

  ['editions: a new week adds its file and the index, and the old week stays frozen', () => {
    const { ctx, github } = setup();
    ctx.publishLeaderboard();
    const frozen = github.state.files['editions/semana-03.json'];
    const frozenText = frozen.text, frozenSha = frozen.sha;
    const ctx2 = loadPublisher({ participants: participants(boardWeek4()), model: model(), github });
    A.match(ctx2.publishLeaderboard(), /Committed editions\/semana-04\.json, editions\/index\.json, data\.json \(week 4\)/);
    A.deep(JSON.parse(github.state.files['editions/index.json'].text), { weeks: [3, 4] });
    A.equal(JSON.parse(github.state.files['editions/semana-04.json'].text).week, 4);
    A.equal(github.state.files['editions/semana-03.json'].text, frozenText, 'week 3 text untouched');
    A.equal(github.state.files['editions/semana-03.json'].sha, frozenSha, 'week 3 never rewritten');
    A.equal(github.state.puts.filter(p => p.path === 'editions/semana-03.json').length, 1, 'week 3 written once');
    ctx2.publishLeaderboard();
    A.equal(github.state.puts.length, 6, 'a rerun of week 4 commits nothing');
  }],

  ['editions: a missing edition is written even when data.json already matches', () => {
    const { ctx, github } = setup();
    ctx.publishLeaderboard();
    delete github.state.files['editions/semana-03.json'];
    delete github.state.files['editions/index.json'];
    const before = github.state.puts.length;
    A.match(ctx.publishLeaderboard(), /Committed editions\/semana-03\.json, editions\/index\.json \(week 3\)/);
    A.deep(github.state.puts.slice(before).map(p => p.path), ['editions/semana-03.json', 'editions/index.json'], 'data.json left alone');
  }],

  ['publishLeaderboard reads survivorOut from the live data.json and replaces the old schema', () => {
    const live = JSON.stringify({ week: 2, pays: [1050, 350], weeklyPrize: 50, comments: [{ para: '', texto: 'viejo' }], awards: [], survivorOut: [{ name: 'Old Timer', week: 1 }] });
    const github = makeGithub(live);
    const { ctx } = setup({ github });
    ctx.publishLeaderboard();
    const written = JSON.parse(github.state.file.text);
    A.deep(written.survivorOut, [{ name: 'Old Timer', week: 1 }, { name: 'KinkyKing', week: 3 }]);
    ['pays', 'weeklyPrize', 'comments', 'awards'].forEach(k => A.ok(!(k in written), k + ' is gone'));
    A.ok(written.prizes && written.tribune, 'prizes and tribune are in');
  }],

  ['a changed strike alone triggers a commit', () => {
    const { ctx, github } = setup();
    ctx.publishLeaderboard();
    const field = FIELD.map(r => r[0] === 'My First-Rate Pick Set' ? [r[0], '3', r[2]] : r);
    const ctx2 = loadPublisher({ participants: participants(), model: model(field), github });
    A.match(ctx2.publishLeaderboard(), /Committed/);
    const written = JSON.parse(github.state.file.text);
    A.deep(written.survivorOut.map(o => o.name).sort(), ['KinkyKing', 'Steel Man']);
  }],

  ['Tribune: checking a box or editing a Texto republishes, an unrelated rerun does not', () => {
    const { ctx, github } = setup();
    ctx.publishLeaderboard();
    const n = github.state.puts.length;
    A.match(ctx.publishLeaderboard(), /No changes/);
    A.equal(github.state.puts.length, n, 'same rows, no commit');
    const checked = TRIBUNE.map(r => r[4] === 'No marcado.' ? [r[0], r[1], r[2], r[3], r[4], 'TRUE'] : r);
    const ctx2 = loadPublisher({ participants: participants(null, { tribune: checked }), model: model(), github });
    A.match(ctx2.publishLeaderboard(), /Committed/);
    A.ok(JSON.parse(github.state.file.text).tribune.columna.some(x => x.texto === 'No marcado.'), 'it is in data.json');
    const edited = checked.map(r => r[4] === 'Se roasteó solo.' ? [r[0], r[1], r[2], r[3], 'Texto cambiado.', r[5]] : r);
    const ctx3 = loadPublisher({ participants: participants(null, { tribune: edited }), model: model(), github });
    A.match(ctx3.publishLeaderboard(), /Committed/);
    A.ok(JSON.parse(github.state.file.text).tribune.columna.some(x => x.texto === 'Texto cambiado.'), 'an edited Texto commits');
  }],

  ['publish works without a Tribune tab', () => {
    const { ctx, github } = setup({ tribune: null });
    ctx.publishLeaderboard();
    A.deep(JSON.parse(github.state.file.text).tribune, { portada: null, columna: [], clasificados: [], datos: [], edicion: null });
  }],

  ['missing script properties fail loudly', () => {
    const { ctx } = setup({ props: { GITHUB_TOKEN: '' } });
    let msg = '';
    try { ctx.publishLeaderboard(); } catch (e) { msg = e.message; }
    A.match(msg, /Missing Script properties/);
  }],

  ['a GitHub write failure throws', () => {
    const github = makeGithub('{"week":1}');
    const { ctx } = setup({ github });
    github.state.files['data.json'].sha = 'changed-under-us';
    const realFetch = github.fetch;
    // Serve a stale sha for data.json on GET, then the real (conflicting) PUT.
    ctx.UrlFetchApp.fetch = (url, opts) => {
      const r = realFetch(url, opts);
      if ((!opts || !opts.method) && /contents\/data\.json/.test(url)) {
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ sha: 'stale', content: Buffer.from('{"week":1}').toString('base64') }) };
      }
      return r;
    };
    let msg = '';
    try { ctx.publishLeaderboard(); } catch (e) { msg = e.message; }
    A.match(msg, /GitHub write failed \(409\) for data\.json/);
  }],

  ['onBoardEdit publishes for PickEm_Board, Picks_Board and Tribune only', () => {
    const { ctx, github } = setup();
    const ev = name => ({ range: { getSheet: () => ({ getName: () => name }) } });
    ctx.onBoardEdit(ev('Sheet1'));
    A.equal(github.state.gets, 0, 'edit in Sheet1 never reaches the publisher');
    ctx.onBoardEdit(ev('Tribune'));
    A.equal(github.state.puts.length, 3, 'edit in Tribune publishes');
    const gets = github.state.gets;
    ctx.onBoardEdit(ev(' pickem_board '));
    A.ok(github.state.gets > gets, 'edit in PickEm_Board reaches the publisher, case and spaces ignored');
    const gets2 = github.state.gets;
    ['Comentarios', 'Premios', 'Premios de la temporada', 'Picks_Log', 'Field'].forEach(n => ctx.onBoardEdit(ev(n)));
    A.equal(github.state.gets, gets2, 'the retired tabs, the log and other tabs are ignored');
    ctx.onBoardEdit(undefined);
    A.equal(github.state.gets, gets2, 'no event, no run');
  }],

  ['setupTribuneTab: header, frozen row, Sección dropdown, checkboxes', () => {
    const ws = makeWorkbook('participants', [makeSheet('PickEm_Board', boardGrid())]);
    const { ctx } = setup({ participants: ws });
    ctx.setupTribuneTab();
    const sh = tab(ws, 'Tribune');
    A.ok(sh, 'tab created');
    A.deep(sh.rows()[0].slice(0, 6), TRIBUNE_HEAD, 'header');
    A.deep(sh.rows()[0].slice(6, 10), ['', 'Color', 'Warnings', 'Warning week'], 'G is a blank separator, H1:J1 head the warnings table');
    A.equal(sh.log.widths[7], 20, 'the separator is narrow');
    A.deep(sh.log.bold[0].slice(0, 4), [1, 1, 1, 6], 'bold header row');
    A.equal(sh.log.frozen, 1, 'frozen header');
    A.ok(sh.log.checkboxes.indexOf('r2c6') >= 0, 'checkboxes start at F2');
    const v = sh.log.validations[0];
    A.equal(v.at, 'r2c2', 'dropdown starts at B2');
    A.deep(JSON.parse(JSON.stringify(v.rule.list)), ['Portada', 'Columna', 'Clasificado', 'Dato', 'Edición'], 'exactly these five');
    A.equal(v.rule.dropdown, true);
    A.equal(sh.rows().length, 1, 'no rows seeded');
  }],

  ['setupTribuneTab is idempotent and leaves rows alone', () => {
    const ws = participants();
    const { ctx } = setup({ participants: ws });
    const body = () => JSON.stringify(tab(ws, 'Tribune').rows().slice(1));
    const before = body();
    ctx.setupTribuneTab();
    const once = JSON.stringify(ws.getSheets().map(t => t.rows()));
    ctx.setupTribuneTab();
    A.equal(tabNames(ws).filter(n => n === 'Tribune').length, 1, 'one Tribune tab');
    A.equal(body(), before, 'rows untouched');
    A.equal(JSON.stringify(ws.getSheets().map(t => t.rows())), once, 'a second run changes nothing');
  }],

  ['nothing in the code reads the retired tabs', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'gas', 'Publish.js'), 'utf8');
    const onEdit = /function onBoardEdit[\s\S]*?\n}/.exec(src)[0];
    A.noMatch(onEdit, /Comentarios|Premios|commentsTab|awardsTab/, 'onEdit filter');
    A.noMatch(src, /readComments_|readAwards_|setupComentarios|setupPremios|PREMIOS_SEED|CFG\.pays|weeklyPrize/, 'old readers and setups');
  }],

  // ---- v2.1: Edición, Apodo, Revisión ---------------------------------------

  ['Tribune: Edición is read once, Para is the theme key, line breaks stay', () => {
    const rows = [TRIBUNE_HEAD,
      ['3', 'Portada', '', 'Titular', 'Bajada.', 'TRUE'],
      ['3', 'Columna', '', 'La cuenta', 'Verso uno\nverso dos \n', 'TRUE'],
      ['3', 'Edición', 'Muertos', 'Día de Muertos', 'Los de Survivor, presentes.', 'TRUE'],      // row 4
      ['3', 'edición', 'muertos', 'Otra', 'No cuenta.', 'TRUE'],                                   // row 5
      ['3', 'Edición', 'muertos', '', 'Sin banner.', 'TRUE'],                                      // row 6
      ['2', 'Edición', 'muertos', 'Semana vieja', '', 'TRUE']];
    const { d, ctx } = build({ tribune: rows });
    A.deep(d.tribune.edicion, { titulo: 'Día de Muertos', texto: 'Los de Survivor, presentes.', tema: 'muertos' });
    A.deep(d.tribune.columna, [{ titulo: 'La cuenta', para: '', texto: 'Verso uno\nverso dos' }], 'crosshead kept, newline kept, ends trimmed');
    A.ok(ctx._logs.some(l => /row 5: only one Edición/.test(l)), 'second Edición');
    A.ok(ctx._logs.some(l => /row 6 is a checked Edición without a Título/.test(l)), 'Edición without Título');
    A.ok(!ctx._logs.some(l => /muertos.*not a Pick'em name/i.test(l)), 'the theme key is not read as a name');
  }],

  ['editions: the archive carries its own edicion', () => {
    const rows = [TRIBUNE_HEAD, ['3', 'Edición', 'muertos', 'Día de Muertos', '', 'TRUE']];
    const { ctx, github } = setup({ tribune: rows });
    ctx.publishLeaderboard();
    A.equal(JSON.parse(github.state.files['editions/semana-03.json'].text).tribune.edicion.tema, 'muertos');
    A.equal(JSON.parse(github.state.file.text).tribune.edicion.titulo, 'Día de Muertos');
  }],

  ['Apodo: read per call sign, bad aliases dropped, emails never read, missing column is fine', () => {
    const fans = [['Call Sign PickEm', 'Fan of', 'Email', 'Apodo'],
      ['Silverback', 'PIT', 'a@example.test', 'el Comish, Silverback, el comish'],
      ['KinkyKing', '', 'b@example.test', ' Kinky '],
      ['Steel Man', '', 'c@example.test', 'Acero, Kinky'],
      ['Jorge_B', '', 'd@example.test', ''],
      ['Nobody On The Board', '', '', 'Fantasma']];
    const { d, ctx } = build({ fans });
    A.deep(d.apodos, { Silverback: ['el Comish', 'el comish'], KinkyKing: ['Kinky'], 'Steel Man': ['Acero'] });
    A.ok(ctx._logs.some(l => /Apodo "Silverback" is a call sign/.test(l)), 'an alias equal to a call sign is dropped');
    A.ok(ctx._logs.some(l => /Apodo "Kinky" belongs to two players/.test(l)), 'a shared alias is dropped for the second player');
    A.noMatch(JSON.stringify(d), /@/, 'no emails');
    A.deep(build().d.apodos, {}, 'no Apodo column');
  }],

  ['setupTribuneTab adds the Apodo header once, touching nothing else, and the Edición option to an old dropdown', () => {
    const ws = participants();
    const { ctx } = setup({ participants: ws });
    const sheet1 = tab(ws, 'Sheet1');
    const before = JSON.stringify(sheet1.rows());
    ctx.setupTribuneTab();
    ctx.setupTribuneTab();
    const rows = sheet1.rows();
    A.equal(rows[0].filter(c => c === 'Apodo').length, 1, 'one Apodo header');
    A.equal(rows[0][3], 'Apodo', 'a list narrower than G gets it in the first free column');
    A.deep(sheet1.log.inserted, [], 'no column inserted');
    A.deep(rows.map(r => r.slice(0, 3)), JSON.parse(before).map(r => r.slice(0, 3)), 'other columns untouched');
    A.deep(rows.slice(1).map(r => r[3] || ''), rows.slice(1).map(() => ''), 'no values written');
    A.equal(sheet1.getName(), 'Participantes', 'Sheet1 is renamed');
    A.deep(tabNames(ws), ['PickEm_Board', 'Participantes', 'Tribune', 'Picks_Board', 'Picks_Log'], 'renamed, plus the two Picks tabs');
    const v = tab(ws, 'Tribune').log.validations;
    A.deep(JSON.parse(JSON.stringify(v[v.length - 1].rule.list)).slice(-1), ['Edición'], 'the dropdown is refreshed on the existing tab');
  }],

  ['setupTribuneTab inserts Apodo between G and H, shifting the table in H, and still reads the list by header', () => {
    const wide = FANS.map((r, i) => {
      const o = r.slice(0, 3); while (o.length < 7) o.push('');
      return o.concat([i === 0 ? 'Tabla' : 'x' + i, i === 0 ? 'Total' : String(i)]);   // a table that starts in H
    });
    wide[1][5] = 'keep';                                                               // data in F must stay put
    const ws = participants(null, { fans: wide });
    const { ctx, github } = setup({ participants: ws });
    const sh = tab(ws, 'Sheet1');
    ctx.setupTribuneTab();
    ctx.setupTribuneTab();
    const rows = sh.rows();
    A.deep(sh.log.inserted, [7], 'one column inserted after G, once');
    A.deep(rows[0].slice(6, 10), ['', 'Apodo', 'Tabla', 'Total'], 'Apodo is column H and the table moved to I');
    A.equal(rows[1][5], 'keep', 'columns before G untouched');
    A.deep(rows.slice(1).map(r => r[8] + '|' + r[9]), wide.slice(1).map(r => r[7] + '|' + r[8]), 'table values intact, one column right');
    A.equal(sh.getName(), 'Participantes');
    ctx.publishLeaderboard();
    A.ok(github.state.puts.length >= 1, 'publishes from the renamed, widened list');
  }],

  ['setupTribuneTab leaves an existing Apodo column where it is and never renames onto an existing Participantes tab', () => {
    const fans = FANS.map((r, i) => r.slice(0, 3).concat(i === 0 ? ['Apodo'] : ['']));
    const ws = participants(null, { fans });
    ws.insertSheet('Participantes');
    const { ctx } = setup({ participants: ws });
    const sh = tab(ws, 'Sheet1');
    ctx.setupTribuneTab();
    A.deep(sh.log.inserted, [], 'nothing inserted');
    A.equal(sh.rows()[0].filter(c => c === 'Apodo').length, 1);
    A.equal(sh.getName(), 'Sheet1', 'name collision, left alone');
  }],

  ['name resolver: Publish.js and index.html carry the identical block, and it matches apodos and apostrophes', () => {
    const fs = require('fs'), path = require('path');
    const block = t => t.slice(t.indexOf('// BEGIN NAMES'), t.indexOf('// END NAMES')).replace(/\r\n/g, '\n');
    const pub = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Publish.js'), 'utf8');
    const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    A.ok(block(pub).length > 500, 'block found in Publish.js');
    A.equal(block(page), block(pub), 'the shared resolver is the same code in both files');
    const { ctx } = setup();
    const idx = ctx.nameIndex(['KinkyKing', CURLY_2, 'Ana'], { KinkyKing: ['Kinky'], Ana: ['Manolito'] });
    const names = t => ctx.mentions(idx, t).map(m => m.name);
    A.deep(names("kinky y KINKYKING, Manolito's winning picks y Manolito"), ['KinkyKing', 'KinkyKing', CURLY_2, 'Ana']);
    A.deep(names('Kinkyness'), [], 'whole words only');
  }],

  ['Warnings: one per row in H with its color in G and its week in I, the same color on the rows it points at', () => {
    const rows = [TRIBUNE_HEAD,
      ['2', 'Columna', '', '', 'Steel Man ya andaba abajo.', 'TRUE'],                       // last week names him
      ['3', 'Portada', '', 'Titular', 'Bajada.', 'TRUE'],
      ['3', 'Columna', '', '', 'Steel Man otra vez.', 'TRUE'],                              // row 4
      ['3', 'Columna', '', '', 'Y Steel Man de nuevo.', 'TRUE'],                            // row 5
      ['3', 'Columna', '', '', 'Abogado no está en esta.', 'TRUE'],                         // row 6
      ['3', 'Clasificado', 'Steel Man', 'SE VENDE', 'Picks.', 'FALSE']];                    // unchecked, ignored
    const ws = participants(null, { tribune: rows });
    const { ctx, github } = setup({ participants: ws });
    ctx.publishLeaderboard();
    const sh = tab(ws, 'Tribune'), t = warnTable(sh);
    A.deep(sh.rows()[0].slice(6, 10), ['', 'Color', 'Warnings', 'Warning week'], 'headers are written by the publish too');
    A.equal(t.length, 3, 'three warnings, three rows');
    A.match(t[0].text, /^Steel Man sale en 2 filas \(4, 5\)\. Mejor una sola\./);
    A.match(t[1].text, /^Steel Man sale en 2 párrafos de la Columna \(filas 4, 5\)\./);
    A.match(t[2].text, /^Steel Man ya salió en la Tribune de la semana 2\. Segunda semana seguida\./);
    A.deep(t.map(x => x.week), [3, 3, 3], 'each carries its week');
    A.deep(t.map(x => x.color), ['#f4cccc', '#fff2cc', '#d9ead3'], 'a color legend, one color per warning');
    A.deep([2, 3, 6].map(r => sh.bg(r, 1)), [null, null, null], 'rows no warning points at are untouched');
    A.deep([1, 2, 3, 4, 5, 6].map(c => sh.bg(4, c)), ['#f4cccc', '#fff2cc', '#d9ead3', '#f4cccc', '#fff2cc', '#d9ead3'], 'a row in three warnings is striped with their colors');
    A.ok(github.state.puts.length >= 3, 'a warning never blocks the publish');
    A.match(JSON.stringify(JSON.parse(github.state.file.text).tribune.columna), /Steel Man otra vez/, 'and never edits the text');
    A.equal(sh.rows()[3][4], 'Steel Man otra vez.', 'the sheet text is untouched');
  }],

  ['Warnings: a row only one warning points at takes that warning color', () => {
    const rows = [TRIBUNE_HEAD,
      ['3', 'Columna', '', '', 'Sin portada.', 'TRUE'],                                      // row 2
      ['3', 'Edición', 'navidad', 'Una', '', 'TRUE']];                                       // row 3
    const ws = participants(null, { tribune: rows });
    const { ctx } = setup({ participants: ws });
    ctx.publishLeaderboard();
    const sh = tab(ws, 'Tribune'), t = warnTable(sh);
    A.deep(t.map(x => x.color), ['#f4cccc', '#fff2cc']);
    A.deep([1, 2, 3, 4, 5, 6].map(c => sh.bg(2, c)), Array(6).fill('#f4cccc'), 'whole row, first warning');
    A.deep([1, 6].map(c => sh.bg(3, c)), ['#fff2cc', '#fff2cc'], 'whole row, second warning');
  }],

  ['Warnings: a clean batch clears the table and only the palette tints, reruns write nothing new', () => {
    const rows = [TRIBUNE_HEAD,
      ['3', 'Portada', '', 'Titular', 'Bajada.', 'TRUE'],
      ['3', 'Columna', '', '', 'Steel Man otra vez.', 'TRUE'],
      ['3', 'Columna', '', '', 'Y Steel Man de nuevo.', 'TRUE']];
    const ws = participants(null, { tribune: rows });
    const { ctx } = setup({ participants: ws });
    const sh = tab(ws, 'Tribune');
    ctx.publishLeaderboard();
    A.equal(sh.bg(3, 1), '#f4cccc');
    const writes = sh.log.writes;
    ctx.publishLeaderboard();
    A.equal(sh.log.writes, writes, 'same warnings, nothing rewritten');
    sh.getRange(2, 1, 1, 6).setBackground('#ffff00');                                  // the user's own highlight
    sh.getRange(4, 5, 1, 1).setValues([['Abogado sube.']]);                            // fixes the second mention
    sh.getRange(3, 5, 1, 1).setValues([['Abogado baja.']]);
    ctx.publishLeaderboard();
    A.deep(warnTable(sh), [], 'clean, the table is empty');
    A.deep([3, 4].map(r => sh.bg(r, 1)), [null, null], 'the tint is removed');
    A.deep([sh.bg(2, 1), sh.bg(2, 6)], ['#ffff00', '#ffff00'], 'the user own color is left alone');
    A.equal(sh.bg(2, 8), null, 'no swatch left');
  }],

  ['Warnings: rolling. Last weeks stay as a log for three weeks, older ones roll off, this week is recomputed', () => {
    const rows = [TRIBUNE_HEAD,
      ['3', 'Columna', '', '', 'Sin portada.', 'TRUE']];                                    // row 2: a week 3 warning
    const ws = participants(null, { tribune: rows });
    const { ctx } = setup({ participants: ws });
    const sh = tab(ws, 'Tribune');
    sh.getRange(1, 8, 1, 3).setValues([['Color', 'Warnings', 'Warning week']]);
    sh.getRange(3, 9, 1, 2).setValues([['Aviso de la semana 2.', 2]]);
    sh.getRange(4, 9, 1, 2).setValues([['Aviso de la semana 1.', 1]]);
    sh.getRange(5, 9, 1, 2).setValues([['Aviso viejo de la semana 3.', 3]]);               // stale, this week is recomputed
    sh.getRange(5, 8, 1, 1).setBackground('#d9ead3');
    ctx.publishLeaderboard();
    const t = warnTable(sh);
    A.deep(t.map(x => x.week), [3, 2, 1], 'this week first, then the log');
    A.match(t[0].text, /Hay Columna sin fila de Portada/);
    A.deep(t.map(x => x.color), ['#f4cccc', null, null], 'only this week has a color');
    const writes = sh.log.writes;
    ctx.publishLeaderboard();
    A.equal(sh.log.writes, writes, 'a second run changes nothing');
  }],

  ['Warnings: a table still in G:I moves one column right when the separator is inserted, once', () => {
    const rows = [TRIBUNE_HEAD.concat(['Color', 'Warnings', 'Warning week']),
      ['3', 'Columna', '', '', 'Sin portada.', 'TRUE', '', 'Aviso viejo.', 2]];
    const ws = participants(null, { tribune: rows });
    const { ctx } = setup({ participants: ws });
    const sh = tab(ws, 'Tribune');
    ctx.setupTribuneTab();
    ctx.setupTribuneTab();
    ctx.publishLeaderboard();
    A.deep(sh.log.inserted, [6], 'one column inserted after F, once');
    A.deep(sh.rows()[0].slice(5, 10), ['Publicar', '', 'Color', 'Warnings', 'Warning week']);
    A.deep(warnTable(sh).map(x => x.week), [3, 2], 'the old log survived the move');
  }],

  ['Warnings: the separator column does not inherit the checkboxes or colors of Publicar', () => {
    const rows = [TRIBUNE_HEAD.concat(['Color', 'Warnings', 'Warning week']),
      ['3', 'Columna', '', '', 'Sin portada.', 'TRUE', '', 'Aviso viejo.', 2]];
    const ws = participants(null, { tribune: rows });
    const { ctx } = setup({ participants: ws });
    const sh = tab(ws, 'Tribune');
    sh.getRange(2, 6, 999, 1).insertCheckboxes();                // Publicar checkboxes, as setup left them
    sh.getRange(2, 1, 1, 6).setBackground('#fff2cc');            // a tinted row, as a warning leaves it
    sh.getRange(3, 6, 1, 1).setBackground('#d9ead3');
    ctx.setupTribuneTab();
    ctx.publishLeaderboard();
    const clean = () => { for (const r of [1, 2, 3, 500, 1000]) { if (sh.vmap(r, 7) || sh.bg(r, 7)) return false; } return true; };
    A.ok(sh.vmap(2, 6) === 'checkbox', 'Publicar keeps its checkboxes');
    A.ok(clean(), 'G has no checkboxes and no colors after the insert');
    // a sheet that was already damaged by the first version of the insert is repaired on the next run
    sh.getRange(2, 7, 999, 1).insertCheckboxes();
    sh.getRange(2, 7, 1, 1).setBackground('#fff2cc');
    sh.getRange(3, 7, 1, 1).setValues([[false]]);
    A.ok(!clean(), 'damage in place');
    ctx.publishLeaderboard();
    A.ok(clean(), 'repaired');
    A.equal(sh.getRange(3, 7, 1, 1).getValue(), '', 'a stray checkbox value is cleared');
    A.equal(sh.rows()[1][4], 'Sin portada.', 'rows untouched');
    A.deep(sh.rows()[0].slice(7, 10), ['Color', 'Warnings', 'Warning week'], 'the table is still where it was');
  }],

  ['Warnings: a log entry more than three weeks old rolls off', () => {
    const ws = participants();
    const { ctx } = setup({ participants: ws });
    const sh = tab(ws, 'Tribune');
    sh.getRange(3, 9, 1, 2).setValues([['De la semana 5.', 5]]);
    sh.getRange(4, 9, 1, 2).setValues([['De la semana 3.', 3]]);
    sh.getRange(5, 9, 1, 2).setValues([['De la semana 2.', 2]]);
    ctx.writeWarnings_(sh, [{ text: 'Nueva.', rows: [] }], 6);
    A.deep(warnTable(sh).map(x => x.week), [6, 5, 3], 'weeks 5 and 3 stay, week 2 is gone');
  }],

  ['Warnings: a checked Clasificado with a blank Para is flagged and still published; Todos and unchecked rows are not', () => {
    const rows = [TRIBUNE_HEAD,
      ['3', 'Portada', '', 'Titular', 'Bajada.', 'TRUE'],
      ['3', 'Clasificado', '', 'SE VENDE', 'Sin destinatario.', 'TRUE'],                     // row 3, flagged
      ['3', 'Clasificado', 'Todos', 'AVISO', 'Para todos.', 'TRUE'],                         // row 4, fine
      ['3', 'Clasificado', 'Abogado', 'SE BUSCA', 'Con destinatario.', 'TRUE'],              // row 5, fine
      ['3', 'Clasificado', '', 'VIEJO', 'No cuenta.', 'FALSE'],                              // unchecked
      ['3', 'Dato', '', 'Dato', 'Un dato sin Para.', 'TRUE']];                               // only Clasificados are checked
    const ws = participants(null, { tribune: rows });
    const { ctx, github } = setup({ participants: ws });
    ctx.publishLeaderboard();
    const sh = tab(ws, 'Tribune'), t = warnTable(sh);
    A.deep(t.map(x => x.text), ['Clasificado sin Para en la fila 3.']);
    A.deep([2, 3, 4, 5, 6, 7].map(r => !!sh.bg(r, 1)), [false, true, false, false, false, false], 'only that row is tinted');
    A.ok(github.state.puts.length >= 3, 'it still publishes');
    const ads = JSON.parse(github.state.file.text).tribune.clasificados;
    A.deep(ads.map(a => a.titulo), ['SE VENDE', 'AVISO', 'SE BUSCA'], 'the row is published anyway');
    A.equal(ads[0].para, '');
  }],

  ['Warnings: apodos count, Columna needs a Portada, one Edición, known temas', () => {
    const fans = FANS.map((r, i) => i === 0 ? r.concat(['Apodo']) : r[0] === 'Steel Man' ? r.concat(['Acero']) : r);
    const rows = [TRIBUNE_HEAD,
      ['3', 'Columna', '', '', 'El Acero no se mueve.', 'TRUE'],                              // row 2, names him by apodo
      ['3', 'Clasificado', 'Steel Man', 'SE VENDE', 'Usado.', 'TRUE'],                       // row 3, by Para
      ['3', 'Edición', 'navidad', 'Una', '', 'TRUE'],                                        // row 4, unknown tema
      ['3', 'Edición', 'muertos', 'Dos', '', 'TRUE']];                                       // row 5, extra
    const ws = participants(null, { tribune: rows, fans });
    const { ctx } = setup({ participants: ws });
    ctx.publishLeaderboard();
    const sh = tab(ws, 'Tribune'), all = warnTable(sh).map(x => x.text).join('\n');
    A.match(all, /Steel Man sale en 2 filas \(2, 3\)/, 'an apodo and a Para both count');
    A.match(all, /Hay Columna sin fila de Portada \(filas 2\)\./);
    A.match(all, /Hay 2 filas de Edición\. Solo cuenta la primera \(fila 4\)\./);
    A.match(all, /Tema desconocido "navidad" en la fila 4\. Temas: muertos\./);
    A.ok([2, 3, 4, 5].every(r => sh.bg(r, 1)), 'every row involved is tinted');
    A.equal(ctx.THEMES_KNOWN.join(), 'muertos');
  }],

  ['Revisión: the golf rule protects every player tied for last, and a missing Tribune tab is fine', () => {
    const { ctx } = setup();
    A.deep(Array.from(ctx.lastPlace_([{ name: 'A', total: 5 }, { name: 'B', total: 5 }, { name: 'C', total: 9 }])), ['A', 'B']);
    A.deep(Array.from(ctx.lastPlace_([{ name: 'A', weeks: [10, 20], total: null }, { name: 'B', weeks: [40], total: null }])), ['A']);
    const ws = participants(null, { tribune: null });
    const { ctx: c2, github } = setup({ participants: ws });
    c2.publishLeaderboard();
    A.ok(github.state.puts.length >= 1, 'publishes without a Tribune tab');
  }],

  ['published data carries no email addresses or tokens', () => {
    const text = JSON.stringify(build().d);
    A.noMatch(text, /@/, 'email');
    A.noMatch(text, /ghp_|github_pat_|test-token/, 'token');
  }],

  // ---- v2.6: Picks_Board, Picks_Log, result inference ------------------------------

  ['Picks_Board: both paste shapes parse to 22 pick sets and 15 games', () => {
    const { ctx } = setup();
    const grid = ctx.parsePicksGrid_(ctx.gridOf_(makeSheet('x', PF.paste())));
    const tabbed = ctx.parsePicksGrid_(ctx.gridOf_(makeSheet('x', PF.pasteTabbed())));
    A.deep(JSON.parse(JSON.stringify(tabbed)), JSON.parse(JSON.stringify(grid)), 'same result from both shapes');
    A.equal(grid.sets.length, 22);
    A.equal(grid.games.length, 15);
    A.deep(JSON.parse(JSON.stringify(grid.games[0])), { fav: 'DAL', spread: 8.5, dog: 'TB' }, 'Yahoo case is normalized');
    const by = n => grid.sets.find(s => s.name === n);
    A.equal(by('Niners').picks[0], null, 'Niners game 1 is a missed pick');
    A.equal(by('Andrea’s Picks').picks[7], null, 'Andrea game 8 is a missed pick');
    A.deep(Array.from(by('Manolito’s winning picks').picks[1]), ['JAX', 0], 'a confidence 0 pick is a pick');
    A.deep(Array.from(by('Abogado').picks[0]), ['TB', 6], 'team and confidence on two lines');
    A.equal(by('Abogado').points, 94);
    A.equal(ctx.parsePicksGrid_([['nada']]), null, 'garbage is not a table');
    A.equal(ctx.parsePicksGrid_(ctx.gridOf_(makeSheet('x', PF.paste().map(r => r.map(c => c === 'Phi (7)' ? 'Phi 7' : c))))), null, 'an unreadable cell is not a table');
  }],

  ['Picks_Board: the week is the one PickEm_Board week the Points match', () => {
    const { ctx } = setup({ board: PF.board5() });
    const board = ctx.readBoard_(ctx.SpreadsheetApp.openById('participants'));
    const parsed = ctx.parsePicksGrid_(ctx.gridOf_(makeSheet('x', PF.paste())));
    A.deep(Array.from(ctx.weeksMatching_(parsed.sets, board)), [5]);
    const off = ctx.parsePicksGrid_(ctx.gridOf_(makeSheet('x', PF.paste({ points: { 'Abogado': 95 } }))));
    A.deep(Array.from(ctx.weeksMatching_(off.sets, board)), [], 'one wrong Points value matches no week');
  }],

  ['Picks_Board: the solver returns the Winner row, every mark matches and the points add up', () => {
    const { ctx } = setup();
    const parsed = ctx.parsePicksGrid_(ctx.gridOf_(makeSheet('x', PF.paste())));
    const sol = ctx.solvePicks_(parsed.games, parsed.sets);
    A.equal(sol.status, 'one');
    A.deep(Array.from(sol.res), PF.WINNER_RES);
    PF.sets.forEach(s => {
      let pts = 0;
      s.cells.forEach((c, g) => {
        if (!c) return;
        const won = (c.team.toUpperCase() === PF.favored[g].toUpperCase() ? 'F' : 'U') === sol.res[g];
        A.equal(won, c.mark === '+', s.name + ' game ' + (g + 1) + ' against the Yahoo mark');
        if (won) pts += c.conf;
      });
      A.equal(pts, s.points, s.name + ' points');
    });
    const bad = ctx.parsePicksGrid_(ctx.gridOf_(makeSheet('x', PF.paste({ points: { 'Abogado': 95 } }))));
    A.equal(ctx.solvePicks_(bad.games, bad.sets).status, 'none', 'Abogado 95 has no solution');
    const loose = ctx.parsePicksGrid_(ctx.gridOf_(makeSheet('x', PF.paste())));
    loose.sets = loose.sets.slice(0, 1);
    A.equal(ctx.solvePicks_(loose.games, loose.sets).status, 'many', 'one pick set alone does not pin the results');
  }],

  ['Picks_Board: a good paste lands in Picks_Log and data.json picks', () => {
    const ws = participants(PF.board5(), { extra: [makeSheet('Picks_Board', PF.paste())] });
    const { ctx, github } = setup({ participants: ws });
    ctx.publishLeaderboard();
    const log = tab(ws, 'Picks_Log');
    A.deep(log.rows()[0], ['Semana', 'Pick Set', 'Juego', 'Favorito', 'Spread', 'Underdog', 'Pick', 'Confianza', 'Resultado']);
    A.equal(log.rows().length, 1 + 22 * 15, 'one row per pick set and game');
    A.deep(log.rows()[1], [5, 'Abogado', 1, 'DAL', 8.5, 'TB', 'TB', 6, 'U']);
    const niners = log.rows().find(r => r[1] === 'Niners' && r[2] === 1);
    A.deep(niners.slice(6, 8), ['', ''], 'a missed pick is a row with no pick');
    const d = JSON.parse(github.state.files['data.json'].text);
    A.deep(Object.keys(d.picks), ['5']);
    A.deep(d.picks['5'].g[0], ['DAL', 8.5, 'TB', 'U']);
    A.deep(d.picks['5'].g.map(g => g[3]), PF.WINNER_RES);
    A.deep(d.picks['5'].p['Abogado'][0], ['TB', 6]);
    A.equal(d.picks['5'].p['Niners'][0], null);
    A.deep(d.picks['5'].p['Manolito’s winning picks'][1], ['JAX', 0]);
    A.equal(Object.keys(d.picks['5'].p).length, 22);
    const w = warnTable(tab(ws, 'Tribune'));
    A.equal(w.filter(x => /Picks_Board/.test(x.text)).length, 0, 'no warnings');
    const writes = log.log.writes;
    ctx.publishLeaderboard();
    A.equal(log.log.writes, writes, 'a second publish does not rewrite the log');
  }],

  ['Picks_Board: a re-paste replaces only that week in Picks_Log', () => {
    const ws = participants(PF.board5(), { extra: [makeSheet('Picks_Board', PF.paste())] });
    const log = makeSheet('Picks_Log', [['Semana', 'Pick Set', 'Juego', 'Favorito', 'Spread', 'Underdog', 'Pick', 'Confianza', 'Resultado'],
      [6, 'Silverback', 1, 'KC', 3, 'LV', 'KC', 5, 'F'],
      [4, 'Silverback', 1, 'BUF', 3, 'MIA', 'MIA', 9, 'U'],
      [5, 'Silverback', 1, 'XXX', 1, 'YYY', 'XXX', 1, 'F'],
      [5, 'Silverback', 2, 'XXX', 1, 'YYY', 'YYY', 2, 'F']]);
    ws.getSheets().push(log);
    const { ctx } = setup({ participants: ws });
    ctx.publishLeaderboard();
    const rows = log.rows().slice(1).filter(r => r[0] !== '');
    A.equal(rows.length, 22 * 15 + 2, 'old week 5 rows gone, weeks 4 and 6 kept');
    A.deep(rows[0], [4, 'Silverback', 1, 'BUF', 3, 'MIA', 'MIA', 9, 'U'], 'weeks stay in order, week 4 first');
    A.deep(rows[rows.length - 1], [6, 'Silverback', 1, 'KC', 3, 'LV', 'KC', 5, 'F'], 'and week 6 last');
    A.ok(rows.filter(r => r[0] === 5).every(r => r[3] !== 'XXX'), 'week 5 is the new paste');
    A.equal(tabNames(ws).filter(n => n === 'Picks_Log').length, 1, 'one log tab');
  }],

  ['Picks_Board: points that match no week store nothing and warn', () => {
    const ws = participants(PF.board5(), { extra: [makeSheet('Picks_Board', PF.paste({ points: { 'Abogado': 95 } }))] });
    const { ctx, github } = setup({ participants: ws });
    ctx.publishLeaderboard();
    const log = tab(ws, 'Picks_Log');
    A.ok(!log || log.rows().slice(1).every(r => r.every(c => c === '')), 'nothing stored');
    A.deep(JSON.parse(github.state.files['data.json'].text).picks, {});
    A.match(warnTable(tab(ws, 'Tribune')).map(x => x.text).join('\n'), /Picks_Board: los puntos no coinciden con ninguna semana de PickEm_Board/);
  }],

  ['Picks_Board: a week that fits the points but has no solution is stored without results and warns', () => {
    const { ctx } = setup({ board: PF.board5() });
    const ss = ctx.SpreadsheetApp.openById('participants');
    const board = ctx.readBoard_(ss);
    const parsed = ctx.parsePicksGrid_(ctx.gridOf_(makeSheet('x', PF.paste({ points: { 'Abogado': 95 } }))));
    const warn = [];
    ctx.storePicksWeek_(ss, board, 5, parsed, warn);
    A.match(warn.join('\n'), /Picks_Board semana 5: ninguna combinación de resultados da los puntos de Yahoo\. Guardé los picks sin resultado/);
    const picks = JSON.parse(JSON.stringify(ctx.readPicksLog_(ss)));
    A.equal(picks['5'].g.length, 15);
    A.ok(picks['5'].g.every(g => g[3] === null), 'every Resultado is blank');
    A.deep(picks['5'].p['Abogado'][0], ['TB', 6], 'the picks are there');
  }],

  ['Picks_Board: an unknown call sign is a warning, not a crash', () => {
    const paste = PF.paste();
    paste.push(['Fantasma'].concat(paste[4].slice(1, 16), ['10']));
    const ws = participants(PF.board5(), { extra: [makeSheet('Picks_Board', paste)] });
    const { ctx, github } = setup({ participants: ws });
    ctx.publishLeaderboard();
    A.match(warnTable(tab(ws, 'Tribune')).map(x => x.text).join('\n'), /"Fantasma" no está en PickEm_Board/);
    A.equal(Object.keys(JSON.parse(github.state.files['data.json'].text).picks['5'].p).length, 22, 'the other 22 are stored');
  }],

  ['Picks_Board: an unreadable paste warns and everything else still publishes', () => {
    const ws = participants(PF.board5(), { extra: [makeSheet('Picks_Board', [['esto no es la tabla']])] });
    const { ctx, github } = setup({ participants: ws });
    ctx.publishLeaderboard();
    A.match(warnTable(tab(ws, 'Tribune')).map(x => x.text).join('\n'), /Picks_Board: no pude leer la tabla/);
    A.ok(github.state.files['data.json'], 'published');
  }],

  ['commissioner-only tabs are never read, written, renamed or deleted', () => {
    const trap = new Proxy(makeSheet('Premios de la temporada', [['Cuota por participante', '50']]), {
      get(t, k) { if (k === 'getName') return t.getName; throw new Error('touched Premios de la temporada: ' + String(k)); },
    });
    const ws = participants(PF.board5(), { extra: [makeSheet('Picks_Board', PF.paste()), trap] });
    const { ctx } = setup({ participants: ws });
    ctx.setupTribuneTab();
    ctx.publishLeaderboard();
    ctx.onBoardEdit({ range: { getSheet: () => ({ getName: () => 'Premios de la temporada' }) } });
    A.ok(tabNames(ws).indexOf('Premios de la temporada') >= 0, 'still there');
  }],

  ['static: only the allowed tabs are named, nothing is cleared or deleted, no migration code is left', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'gas', 'Publish.js'), 'utf8');
    const { ctx } = setup();
    A.deep([ctx.CFG.boardTab, ctx.CFG.participantsTab, ctx.CFG.tribuneTab, ctx.CFG.picksTab, ctx.CFG.logTab, ctx.CFG.fieldTab],
      ['PickEm_Board', 'Participantes', 'Tribune', 'Picks_Board', 'Picks_Log', 'Field'], 'tab names');
    const lookups = src.match(/(?:findTab_|insertSheet)\((?:ss, ?)?[^)]*\)/g) || [];
    A.ok(lookups.length > 5, 'found the tab lookups');
    lookups.filter(x => !/^findTab_\(sheet|function/.test(x)).forEach(u => A.match(u, /(CFG\.\w+Tab|name|'Sheet1')\)$/, 'tab lookup ' + u));
    A.noMatch(src, /deleteSheet|\.clear\(|\.clearContent\(|\.clearContents\(|\.deleteRows?\(|\.deleteColumns?\(|removeSheet/, 'no clear or delete calls');
    A.noMatch(src, /Premios|Comentarios|migrate|LEGACY_TABS/, 'no retired tabs, no migration');
  }],
]);
