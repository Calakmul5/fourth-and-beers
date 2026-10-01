'use strict';
// Mock-GAS tests for gas/Publish.js. Synthetic call signs only, no live Google or GitHub.
const A = require('./assert');
const { makeSheet, makeWorkbook, makeGithub, loadPublisher } = require('./mock_gas');

// ---- Fixtures ---------------------------------------------------------------

const CURLY_1 = 'Chitown’DemBoyz';       // Yahoo uses curly apostrophes
const CURLY_2 = 'Manolito’s winning picks';

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
  [CURLY_1.replace('’', "'"), 'Chicago, Wisconsin', ''],   // straight apostrophe in the sheet, curly in Yahoo
  [CURLY_2, 'Random', ''],
  ['KinkyKing', '', ''],                                         // blank, no entry
  ['Steel Man', 'Michigan', ''],                                 // college only
  ['Nobody On The Board', 'KC', ''],                             // not a Pick'em name, ignored
];

const COMMENTS = [
  ['Semana', 'Para', 'Texto', 'Publicar'],
  ['3', 'Silverback', 'Se roasteó solo.', 'TRUE'],
  ['3', 'Todos', 'Buen domingo, mal pick.', 'TRUE'],
  ['3', CURLY_1.replace('’', "'"), 'Para el de Chitown.', 'TRUE'],
  ['3', '', 'Sin destinatario.', 'TRUE'],
  ['3', 'Nadie Conocido', 'Destinatario raro.', 'TRUE'],
  ['3', 'Jorge_B', 'No marcado.', 'FALSE'],
  ['2', 'Jorge_B', 'Semana vieja.', 'TRUE'],
  ['3', 'Jorge_B', '', 'TRUE'],
];

function participants(boardRows, extra) {
  return makeWorkbook('participants', [
    makeSheet('PickEm_Board', boardRows || boardGrid()),
    makeSheet('Comentarios', (extra && extra.comments) || COMMENTS),
    makeSheet('Sheet1', (extra && extra.fans) || FANS),
  ]);
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
      ['comments', 'fans', 'pays', 'pickem', 'season', 'strikes', 'survivorOut', 'updated', 'week', 'weeklyPrize', 'weeks'], 'fields');
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

  ['Comentarios keeps only checked rows for the current week', () => {
    const c = build().d.comments;
    A.deep(c, [
      { para: 'Silverback', texto: 'Se roasteó solo.' },
      { para: '', texto: 'Buen domingo, mal pick.' },
      { para: CURLY_1, texto: 'Para el de Chitown.' },
      { para: '', texto: 'Sin destinatario.' },
      { para: '', texto: 'Destinatario raro.' },
    ]);
  }],

  ['Comentarios checkbox spellings and a missing tab', () => {
    const rows = [['Semana', 'Para', 'Texto', 'Publicar'],
      ['3', 'Todos', 'a', 'true'], ['3', 'Todos', 'b', 'x'], ['3', 'Todos', 'c', 'Sí'], ['3', 'Todos', 'd', 'no'], ['3', 'Todos', 'e', '']];
    A.deep(build({ comments: rows }).d.comments.map(x => x.texto), ['a', 'b', 'c']);
    const bare = makeWorkbook('participants', [makeSheet('PickEm_Board', boardGrid()), makeSheet('Sheet1', FANS)]);
    A.deep(build({ participants: bare }).d.comments, []);
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

  ['publishLeaderboard: first commit, no-change skip, change commits again', () => {
    const { ctx, github } = setup();
    const r1 = ctx.publishLeaderboard();
    A.match(r1, /Committed data\.json for week 3/);
    A.equal(github.state.puts.length, 1);
    A.equal(github.state.puts[0].hadSha, false, 'creating the file sends no sha');
    A.equal(github.state.puts[0].message, 'Semana 3: tabla actualizada');
    A.equal(github.state.puts[0].branch, 'main');
    A.equal(github.state.puts[0].auth, 'Bearer test-token');
    const written = JSON.parse(github.state.file.text);
    A.equal(written.week, 3);

    const r2 = ctx.publishLeaderboard();
    A.match(r2, /No changes, nothing committed/);
    A.equal(github.state.puts.length, 1, 'same numbers, only the timestamp differs, no commit');

    // A new week lands in the sheet.
    const rows = boardGrid().map((r, i) => i === 4 ? r.map((c, j) => j === 5 ? '88' : c) : r);
    const ctx2 = loadPublisher({ participants: participants(rows), model: model(), github });
    const r3 = ctx2.publishLeaderboard();
    A.match(r3, /Committed/);
    A.equal(github.state.puts.length, 2);
    A.equal(github.state.puts[1].hadSha, true, 'updating sends the sha it read');
  }],

  ['publishLeaderboard reads survivorOut from the live data.json', () => {
    const live = JSON.stringify({ week: 2, survivorOut: [{ name: 'Old Timer', week: 1 }] });
    const github = makeGithub(live);
    const { ctx } = setup({ github });
    ctx.publishLeaderboard();
    const written = JSON.parse(github.state.file.text);
    A.deep(written.survivorOut, [{ name: 'Old Timer', week: 1 }, { name: 'KinkyKing', week: 3 }]);
  }],

  ['a changed comment or strike alone triggers a commit', () => {
    const { ctx, github } = setup();
    ctx.publishLeaderboard();
    const field = FIELD.map(r => r[0] === 'Steel Man' ? r : (r[0] === 'My First-Rate Pick Set' ? [r[0], '3', r[2]] : r));
    const ctx2 = loadPublisher({ participants: participants(), model: model(field), github });
    A.match(ctx2.publishLeaderboard(), /Committed/);
    const written = JSON.parse(github.state.file.text);
    A.deep(written.survivorOut.map(o => o.name).sort(), ['KinkyKing', 'Steel Man']);
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
    github.state.file.sha = 'changed-under-us';
    const realFetch = github.fetch;
    // Serve a stale sha on GET, then the real (conflicting) PUT.
    ctx.UrlFetchApp.fetch = (url, opts) => {
      const r = realFetch(url, opts);
      if (!opts || !opts.method) {
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ sha: 'stale', content: Buffer.from('{"week":1}').toString('base64') }) };
      }
      return r;
    };
    let msg = '';
    try { ctx.publishLeaderboard(); } catch (e) { msg = e.message; }
    A.match(msg, /GitHub write failed \(409\)/);
  }],

  ['onBoardEdit ignores other tabs and publishes for the two input tabs', () => {
    const { ctx, github } = setup();
    const ev = name => ({ range: { getSheet: () => ({ getName: () => name }) } });
    ctx.onBoardEdit(ev('Sheet1'));
    A.equal(github.state.puts.length, 0, 'edit in Sheet1');
    ctx.onBoardEdit(ev('Comentarios'));
    A.equal(github.state.puts.length, 1, 'edit in Comentarios');
    ctx.onBoardEdit(ev(' pickem_board '));
    A.equal(github.state.puts.length, 1, 'edit in PickEm_Board, nothing new to commit');
    ctx.onBoardEdit(undefined);
  }],

  ['published data carries no email addresses or tokens', () => {
    const text = JSON.stringify(build().d);
    A.noMatch(text, /@/, 'email');
    A.noMatch(text, /ghp_|github_pat_|test-token/, 'token');
  }],
]);
