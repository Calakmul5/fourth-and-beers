'use strict';
// jsdom tests for index.html. The page fetches data.json and falls back to an embedded seed,
// so every scenario feeds it its own data and checks that it did not silently render the seed.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const A = require('./assert');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const SEED = JSON.parse(/<script type="application\/json" id="seed">([\s\S]*?)<\/script>/.exec(HTML)[1]);

// ---- Data builders ----------------------------------------------------------

const NAMES = ['Silverback', 'Jorge_B', 'Alfa Dog', 'Bravo Bird', 'Charlie Chain', 'Delta Dash',
  'Echo Edge', 'Foxtrot Fan', 'Golf Gap', 'Hotel Huddle', 'India Ink', 'Juliet Jam'];

/** Deterministic scores, one row per player. */
function score(i, k) { return 40 + ((i * 17 + k * 29 + i * k * 7) % 55); }

function make(opts) {
  const week = opts.week;
  const names = opts.names || NAMES;
  const pickem = names.map((name, i) => {
    let weeks = [];
    for (let k = 0; k < week; k++) weeks.push(score(i, k));
    if (opts.weeks && opts.weeks[name]) weeks = opts.weeks[name];
    const sum = weeks.reduce((a, b) => a + b, 0);
    const dropped = week > 1 ? Math.min.apply(null, weeks) : 0;
    return { name, weeks, total: sum - dropped, dropped };
  });
  const strikes = {};
  names.forEach((n, i) => { strikes[n] = i % 4; });
  return {
    season: 2026, week, weeks: 18, updated: '2026-10-01T12:00:00Z', pays: [1050, 350], weeklyPrize: 50,
    pickem, strikes, survivorOut: opts.survivorOut || [], fans: opts.fans || {}, comments: opts.comments || [],
  };
}

// ---- Page harness -----------------------------------------------------------

async function load(data, o) {
  o = o || {};
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e && e.stack || e).split('\n')[0]));
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', url: 'https://example.test/', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.addEventListener('error', e => errors.push(String(e.message)));
      window.fetch = o.failFetch
        ? () => Promise.reject(new Error('offline'))
        : () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(data))) });
      if (o.storage) Object.keys(o.storage).forEach(k => window.localStorage.setItem(k, o.storage[k]));
    },
  });
  const doc = dom.window.document;
  for (let i = 0; i < 100 && !doc.querySelector('#board .row'); i++) await new Promise(r => setTimeout(r, 20));
  await new Promise(r => setTimeout(r, 30));
  return { dom, doc, win: dom.window, errors };
}

const text = (doc, sel) => (doc.querySelector(sel) || { textContent: '' }).textContent;
const rowNames = doc => [].map.call(doc.querySelectorAll('#board .row'), r => r.dataset.name);

/** Invariants every rendering must satisfy. */
function common(ctx, data, label) {
  const { doc, errors } = ctx;
  A.deep(errors, [], label + ': no script errors');
  A.deep(rowNames(doc).sort(), data.pickem.map(p => p.name).sort(), label + ': renders this data, not the seed');
  A.match(text(doc, '#t-h1'), new RegExp('Semana ' + data.week + '\\.'), label + ': headline week');
  A.noMatch(doc.body.textContent, /\bNaN\b|\bundefined\b|\bInfinity\b|\[object/, label + ': no broken numbers or text');
  A.noMatch(doc.body.textContent, /—/, label + ': no em dashes in page text');
  A.noMatch(doc.body.textContent, /comisionado/i, label + ': it is the Comish, not the comisionado');
}

// ---- Previous-week awards helpers -----------------------------------------------

/** Data from an explicit table: one array of weekly scores per name in NAMES, same length. */
function fromRows(rows, extra) {
  const week = rows[0].length;
  const d = make({ week });
  d.pickem = NAMES.map((name, i) => {
    const w = rows[i].slice();
    const dropped = week > 1 ? Math.min.apply(null, w) : 0;
    return { name, weeks: w, total: w.reduce((a, b) => a + b, 0) - dropped, dropped };
  });
  return Object.assign(d, extra || {});
}

/** Independent oracle. Standings after k weeks: sum minus the worst week (none with one week), ties share the better rank. */
function ranksAfter(rows, k) {
  const tot = rows.map(w => { const x = w.slice(0, k); return x.reduce((a, b) => a + b, 0) - (k > 1 ? Math.min.apply(null, x) : 0); });
  return tot.map(t => 1 + tot.filter(u => u > t).length);
}
function oracle(rows) {
  const week = rows[0].length;
  const prev = ranksAfter(rows, week - 1), now = ranksAfter(rows, week);
  const moves = prev.map((p, i) => p - now[i]);
  const up = Math.max.apply(null, [0].concat(moves)), down = Math.max.apply(null, [0].concat(moves.map(m => -m)));
  return {
    ups: up > 0 ? NAMES.filter((n, i) => moves[i] === up) : [],
    downs: down > 0 ? NAMES.filter((n, i) => moves[i] === -down) : [],
  };
}

const CLIMB = 'Del sótano a la azotea', DROP = 'La cruda de la semana';
const REMOVED = ['Montaña rusa', 'Reloj suizo', 'Foto finish', 'Doble amenaza', 'Nadie está muerto', 'Se empieza a estirar', 'La cruda de la semana 1'];

function awardsOf(doc) {
  return [].map.call(doc.querySelectorAll('#awards .award'), a => ({
    titulo: a.querySelector('h3').textContent, para: a.querySelector('.who').textContent, texto: a.querySelector('p').textContent,
  }));
}
const byTitle = (list, t) => list.find(a => a.titulo === t);

// Deterministic table generator for the oracle comparison.
function genRows(seed, weeks) {
  return NAMES.map((n, i) => { const w = []; for (let k = 0; k < weeks; k++) w.push(30 + ((i * (seed + 3) + k * 13 + i * k * seed + seed * 7) % 60)); return w; });
}

// ---- Cases ------------------------------------------------------------------

A.run('index.html', [
  ['full season mid-way: three weeks, standings, sections', async () => {
    const data = make({ week: 3, fans: { Silverback: { nfl: 'PIT' }, Jorge_B: { random: true, other: 'League of Legends' } } });
    const c = await load(data);
    common(c, data, 'week 3');
    const top = data.pickem.slice().sort((a, b) => b.total - a.total)[0];
    A.equal(rowNames(c.doc)[0], top.name, 'leader first');
    A.equal(c.doc.querySelectorAll('#board .row').length, NAMES.length);
    A.match(text(c.doc, '#t-lede'), /12 jugadores, 3 semanas jugadas, 15 por jugar/);
    A.match(text(c.doc, '#t-drop'), /se cae la más baja de esas 3/);
    A.match(text(c.doc, '#t-paid'), /\$150 repartidos de \$900/);
    A.ok(c.doc.querySelectorAll('#awards .award').length > 0, 'awards drawn');
    A.ok(c.doc.querySelectorAll('#heat tr').length > 0, 'heat map drawn');
    A.ok(c.doc.querySelectorAll('#surv > *').length > 0, 'survivor drawn');
    A.ok(c.doc.querySelector('#bumpbox svg'), 'bump chart drawn');
    A.match(c.doc.title, /semana 3/);
  }],

  ['week 1: one week played, nothing dropped', async () => {
    const data = make({ week: 1 });
    const c = await load(data);
    common(c, data, 'week 1');
    A.match(text(c.doc, '#t-lede'), /1 semana jugada, 17 por jugar/);
    A.match(text(c.doc, '#t-drop'), /todavía no se cae nada/);
    A.match(text(c.doc, '#t-paid'), /\$50 repartidos/);
    A.equal(c.doc.querySelectorAll('#weeks > *').length > 0, true, 'weekly section drawn');
  }],

  ['a missed week: a zero in the middle of the season', async () => {
    const data = make({ week: 3, weeks: { 'Alfa Dog': [70, 0, 66], 'Bravo Bird': [0, 55, 60] } });
    const missed = data.pickem.filter(p => p.weeks.indexOf(0) >= 0);
    A.equal(missed.length, 2, 'fixture has two missed weeks');
    A.deep(missed.map(p => p.dropped), [0, 0], 'Yahoo drops the zero');
    const c = await load(data);
    common(c, data, 'missed week');
    const row = [].find.call(c.doc.querySelectorAll('#board .row'), r => r.dataset.name === 'Alfa Dog');
    A.match(row.getAttribute('aria-label'), /136 puntos, se cae una semana de 0/);
  }],

  ['ties share the better rank', async () => {
    const data = make({ week: 3, weeks: { 'Alfa Dog': [60, 60, 60], 'Bravo Bird': [60, 60, 60], 'Charlie Chain': [10, 10, 10] } });
    const c = await load(data);
    common(c, data, 'ties');
    const rank = n => text(c.doc, '#board .row[data-name="' + n + '"] .rk');
    A.equal(rank('Alfa Dog'), rank('Bravo Bird'), 'tied players share a rank');
    const lowest = text(c.doc, '#board .row:last-of-type .rk');
    A.equal(lowest, String(1 + data.pickem.filter(p => p.total > 20).length), 'last place counts everyone above');
  }],

  ['a tie for last place still renders the penalty block', async () => {
    const data = make({ week: 3, weeks: { 'Alfa Dog': [10, 10, 10], 'Bravo Bird': [10, 10, 10] } });
    const c = await load(data);
    common(c, data, 'tie for last');
    A.equal(c.doc.getElementById('grill-h').hidden, false, 'penalties visible');
    A.match(text(c.doc, '#grill'), /Alfa Dog/);
    A.match(text(c.doc, '#grill'), /Bravo Bird/);
  }],

  ['no fans: the fan section stays hidden', async () => {
    const data = make({ week: 3, fans: {} });
    const c = await load(data);
    common(c, data, 'no fans');
    A.equal(c.doc.getElementById('aficiones').hidden, true);
  }],

  ['fans: section shows, Jorge_B is the random one', async () => {
    const fans = {};
    NAMES.forEach((n, i) => { fans[n] = i % 3 === 0 ? { nfl: 'DAL' } : i % 3 === 1 ? { nfl: 'CHI', ncaa: 'Michigan' } : { nfl: 'PIT' }; });
    fans['Jorge_B'] = { random: true, other: 'League of Legends' };
    const data = make({ week: 3, fans });
    const c = await load(data);
    common(c, data, 'fans');
    A.equal(c.doc.getElementById('aficiones').hidden, false);
    A.match(text(c.doc, '#fanplot'), /Video Juegos/);
    A.match(text(c.doc, '#fanplot'), /Cowboys/);
    A.ok(c.doc.querySelectorAll('#fanawards .award').length > 0, 'fan awards still computed by the page');
    A.match(text(c.doc, '#fanawards'), /League of Legends|Video Juegos|Jorge_B/, 'Jorge_B is still teased in the fan awards');
  }],

  ['comments: shown, addressed, and escaped', async () => {
    const data = make({
      week: 3,
      comments: [
        { para: 'Silverback', texto: 'Se roasteó solo.' },
        { para: '', texto: 'Para todos <b>y</b> & más.' },
      ],
    });
    const c = await load(data);
    common(c, data, 'comments');
    A.equal(c.doc.getElementById('quotes-box').hidden, false);
    A.equal(c.doc.getElementById('quotes-box').tagName, 'SECTION', 'the Comish has a section of their own');
    A.equal(c.doc.querySelector('#premios #quotes-box'), null, 'not nested in Premios que no pagan');
    A.equal(text(c.doc, '#quotes-box h2'), 'Palabras del Comish');
    A.equal(text(c.doc, '#premios h2'), 'Premios que no pagan');
    const q = c.doc.querySelectorAll('#quotes .quote');
    A.equal(q.length, 2);
    A.match(q[0].textContent, /Para Silverback/);
    A.match(q[0].textContent, /Se roasteó solo\./);
    A.equal(q[1].querySelector('b'), null, 'comment text is not parsed as HTML');
    A.match(q[1].textContent, /Para todos <b>y<\/b> & más\./);
    A.equal(q[1].querySelector('.to'), null, 'no addressee means no "Para" tag');
  }],

  ['no comments: the quotes box stays hidden', async () => {
    const data = make({ week: 3 });
    const c = await load(data);
    common(c, data, 'no comments');
    A.equal(c.doc.getElementById('quotes-box').hidden, true);
  }],

  ['survivor: first elimination is named, apostrophes in names match strikes', async () => {
    const names = NAMES.slice();
    names[2] = 'Alfa’s Picks';
    const data = make({ week: 3, names });
    data.strikes = {}; names.forEach((n, i) => { data.strikes[n.replace('’', "'")] = i === 2 ? 3 : 0; });
    data.survivorOut = [{ name: names[2], week: 2 }];
    const c = await load(data);
    common(c, data, 'survivor');
    A.match(text(c.doc, '#grill') + text(c.doc, '#tally') + text(c.doc, '#surv'), /Alfa’s Picks/);
  }],

  ['picking a name opens the personal card and is remembered', async () => {
    const data = make({ week: 3 });
    const c = await load(data);
    common(c, data, 'pick');
    const sel = c.doc.getElementById('pick');
    sel.value = 'Jorge_B';
    sel.dispatchEvent(new c.win.Event('change'));
    A.ok(c.doc.getElementById('me').classList.contains('on'), 'card visible');
    A.match(text(c.doc, '#me'), /Jorge_B/);
    A.equal(c.win.localStorage.getItem('fab-me'), 'Jorge_B');
    const again = await load(data, { storage: { 'fab-me': 'Jorge_B' } });
    A.ok(again.doc.getElementById('me').classList.contains('on'), 'remembered on the next visit');
  }],

  ['colors come from the :root tokens: SVG and heat map are painted, not blank', async () => {
    const data = make({ week: 3 });
    const c = await load(data);
    common(c, data, 'tokens');
    const html = c.doc.getElementById('bumpbox') ? c.doc.getElementById('bumpbox').innerHTML : c.doc.querySelector('.bumpbox').innerHTML;
    const all = html + c.doc.getElementById('heat').innerHTML + c.doc.querySelector('#weeks').innerHTML;
    A.noMatch(all, /(fill|stroke)="(undefined|null)?"/, 'no empty or undefined paint');
    A.noMatch(all, /(fill|stroke)="[^"#a-z]/i, 'paint values are colors');
    const css = HTML.slice(HTML.indexOf(':root{'));
    const tok = n => new RegExp('--' + n + ':\s*(#[0-9A-Fa-f]{6})').exec(css)[1].toLowerCase();
    const cells = c.doc.querySelectorAll('#heat td.h[style*="background:#"]');
    A.ok(cells.length > 0, 'heat cells carry hex backgrounds');
    const bgOf = el => /background:\s*(#[0-9a-f]{6})/i.exec(el.getAttribute('style'))[1].toLowerCase();
    const best = [].filter.call(cells, el => /title="1º/.test(el.outerHTML.replace(/\u00ba/g, 'º')));
    A.ok(best.length > 0, 'someone finished 1st in a week');
    A.equal(bgOf(best[0]), tok('accent'), '1st is --accent');
    const last = [].filter.call(cells, el => el.getAttribute('title') === '' + (NAMES.length) + 'º de la semana');
    A.ok(last.length > 0, 'someone finished last in a week');
    A.equal(bgOf(last[0]), tok('surface'), 'last is --surface');
    A.equal(c.doc.querySelector('meta[name="theme-color"]').getAttribute('content').toLowerCase(), tok('bg'), 'theme-color follows --bg');
  }],

  ['climb and drop compare with the PREVIOUS week, one player each', async () => {
    // Week 1: 100, 95, 90 ... 45. Week 2: Delta Dash (index 5) scores 82 and passes Charlie Chain (index 4, 80).
    const w1 = NAMES.map((n, i) => 100 - 5 * i);
    const rows = w1.map((v, i) => [v, i === 5 ? 82 : 40]);
    const c = await load(fromRows(rows));
    common(c, fromRows(rows), 'one climber');
    const aw = awardsOf(c.doc);
    const up = byTitle(aw, CLIMB), down = byTitle(aw, DROP);
    A.equal(up.para, 'Delta Dash');
    A.match(up.texto, /^Era 6º la semana pasada, hoy es 5º\. \S/, 'fact line, then a joke');
    A.equal(down.para, 'Charlie Chain');
    A.match(down.texto, /^Era 5º la semana pasada, hoy es 6º\. \S/);
    A.deep(aw.map(a => a.titulo).slice(0, 2), [CLIMB, DROP], 'fixed awards come first');
    A.equal(aw.length, 2, 'nothing else computed by the page');
  }],

  ['ties for the biggest move list everyone', async () => {
    // Week 1: 100, 95 ... 45. Week 2: India Ink (10) scores 101, Juliet Jam (11) scores 100.
    // India Ink goes 11º to 1º, Juliet Jam 12º to 2º (tied with Silverback on 100). Both climb 10.
    // Everyone from Jorge_B to Hotel Huddle falls 2 places.
    const w1 = NAMES.map((n, i) => 100 - 5 * i);
    const rows = w1.map((v, i) => [v, i === 10 ? 101 : i === 11 ? 100 : i === 0 ? 60 : 40]);
    const data = fromRows(rows);
    const c = await load(data);
    common(c, data, 'ties');
    const aw = awardsOf(c.doc);
    const up = byTitle(aw, CLIMB), down = byTitle(aw, DROP);
    A.equal(up.para, 'India Ink, Juliet Jam');
    A.match(up.texto, /^Subieron 10 lugares cada uno: India Ink del 11º al 1º, Juliet Jam del 12º al 2º\./);
    A.equal(down.para, NAMES.slice(1, 10).join(', '), 'all nine who fell two places');
    A.match(down.texto, /^Bajaron 2 lugares cada uno: Jorge_B del 2º al 4º, /);
    const o = oracle(rows);
    A.deep(up.para.split(', ').sort(), o.ups.slice().sort(), 'matches the oracle');
    A.deep(down.para.split(', ').sort(), o.downs.slice().sort(), 'matches the oracle');
  }],

  ['nobody moved: neither fixed award shows', async () => {
    const w1 = NAMES.map((n, i) => 100 - 5 * i);
    const rows = w1.map(v => [v, v - 1]);   // week 2 never beats week 1, totals stay the week 1 order
    A.deep(oracle(rows), { ups: [], downs: [] }, 'fixture really has no movers');
    const data = fromRows(rows);
    const c = await load(data);
    common(c, data, 'nobody moved');
    A.equal(awardsOf(c.doc).length, 0, 'no award cards at all');
    A.equal(c.doc.querySelectorAll('#awards .award').length, 0);
  }],

  ['week 1: no fixed awards', async () => {
    const data = make({ week: 1 });
    const c = await load(data);
    common(c, data, 'week 1 awards');
    A.equal(awardsOf(c.doc).length, 0);
  }],

  ['week 2 compares week 2 with week 1 only', async () => {
    const rows = genRows(5, 2);
    const o = oracle(rows);
    const data = fromRows(rows);
    const c = await load(data);
    common(c, data, 'week 2');
    const aw = awardsOf(c.doc);
    const up = byTitle(aw, CLIMB), down = byTitle(aw, DROP);
    if (o.ups.length) A.deep(up.para.split(', ').sort(), o.ups.slice().sort(), 'climbers'); else A.equal(up, undefined, 'no climber award');
    if (o.downs.length) A.deep(down.para.split(', ').sort(), o.downs.slice().sort(), 'fallers'); else A.equal(down, undefined, 'no faller award');
  }],

  ['weeks 3 and 4 match the oracle across many tables, ties included', async () => {
    let withTies = 0, withBoth = 0;
    for (const weeks of [3, 4]) {
      for (let seed = 1; seed <= 6; seed++) {
        const rows = genRows(seed, weeks), o = oracle(rows);
        const c = await load(fromRows(rows));
        const aw = awardsOf(c.doc);
        const up = byTitle(aw, CLIMB), down = byTitle(aw, DROP);
        A.deep(up ? up.para.split(', ').sort() : [], o.ups.slice().sort(), 'climbers, week ' + weeks + ' seed ' + seed);
        A.deep(down ? down.para.split(', ').sort() : [], o.downs.slice().sort(), 'fallers, week ' + weeks + ' seed ' + seed);
        A.deep(c.errors, [], 'no script errors, week ' + weeks + ' seed ' + seed);
        if (o.ups.length > 1 || o.downs.length > 1) withTies++;
        if (o.ups.length && o.downs.length) withBoth++;
      }
    }
    A.ok(withTies > 0, 'the generated tables include at least one tie');
    A.ok(withBoth > 0, 'and at least one table with both awards');
  }],

  ['the six retired awards are gone from the page', async () => {
    const data = make({ week: 3 });
    const c = await load(data);
    common(c, data, 'retired awards');
    const titles = awardsOf(c.doc).map(a => a.titulo);
    REMOVED.forEach(t => A.ok(titles.indexOf(t) < 0, t + ' must not be computed any more'));
    A.ok(!/Montaña rusa|Reloj suizo|Foto finish|Doble amenaza|Nadie está muerto|Se empieza a estirar/.test(HTML.replace(/<script type="application\/json" id="seed">[\s\S]*?<\/script>/, '')), 'no leftover code or jokes');
  }],

  ['sheet awards render after the fixed ones, escaped, in sheet order', async () => {
    const rows = genRows(2, 3);
    const data = fromRows(rows, { awards: [
      { titulo: 'Premio <b>uno</b>', para: 'Silverback, Jorge_B', texto: 'Texto & más <i>x</i>.' },
      { titulo: 'Premio dos', para: '', texto: 'Sin Para.' },
      { titulo: 'Sin texto', para: 'Todos', texto: '' },
      null,
    ] });
    const c = await load(data);
    common(c, data, 'sheet awards');
    const aw = awardsOf(c.doc);
    const fixed = aw.filter(a => a.titulo === CLIMB || a.titulo === DROP).length;
    A.equal(aw.length, fixed + 2, 'fixed awards plus the two valid sheet awards');
    const sheet = aw.slice(fixed);
    A.deep(aw.slice(0, fixed).map(a => a.titulo).filter(t => t !== CLIMB && t !== DROP), [], 'fixed awards first');
    A.equal(sheet[0].titulo, 'Premio <b>uno</b>', 'title shown as text');
    A.equal(sheet[0].para, 'Silverback, Jorge_B');
    A.equal(sheet[0].texto, 'Texto & más <i>x</i>.');
    A.equal(c.doc.querySelector('#awards h3 b'), null, 'title is not parsed as HTML');
    A.equal(c.doc.querySelector('#awards p i'), null, 'texto is not parsed as HTML');
    A.equal(sheet[1].titulo, 'Premio dos');
    A.equal(sheet[1].para, 'Todos', 'blank Para reads as Todos');
  }],

  ['empty or missing awards: only the fixed ones, no errors', async () => {
    const rows = genRows(2, 3);
    const o = oracle(rows);
    for (const extra of [{ awards: [] }, {}, { awards: null }]) {
      const data = fromRows(rows, extra);
      if (!('awards' in extra)) delete data.awards;
      const c = await load(data);
      common(c, data, 'awards ' + JSON.stringify(extra));
      A.equal(awardsOf(c.doc).length, (o.ups.length ? 1 : 0) + (o.downs.length ? 1 : 0), 'only the fixed awards');
    }
  }],

  ['week 1 still shows the sheet awards', async () => {
    const data = make({ week: 1 });
    data.awards = [{ titulo: 'Premio de arranque', para: 'Todos', texto: 'Hola.' }];
    const c = await load(data);
    common(c, data, 'week 1 sheet award');
    A.deep(awardsOf(c.doc), [{ titulo: 'Premio de arranque', para: 'Todos', texto: 'Hola.' }]);
  }],

  ['data.json unreachable: the page falls back to its embedded seed', async () => {
    const c = await load(null, { failFetch: true });
    A.deep(c.errors, [], 'no script errors');
    A.deep(rowNames(c.doc).sort(), SEED.pickem.map(p => p.name).sort(), 'seed names');
    A.match(text(c.doc, '#t-h1'), new RegExp('Semana ' + SEED.week + '\\.'));
    A.deep(awardsOf(c.doc).filter(a => a.titulo !== CLIMB && a.titulo !== DROP).map(a => a.titulo), SEED.awards.map(a => a.titulo), 'the seed carries awards[] too');
  }],

  ['the embedded seed is valid current data', () => {
    A.equal(SEED.pickem.length, 22);
    A.ok(SEED.pickem.every(p => p.weeks.length === SEED.week), 'every player has one score per played week');
    A.equal(typeof SEED.pays[0], 'number');
    A.ok(Array.isArray(SEED.awards) && SEED.awards.length > 0, 'seed has the awards field');
    A.ok(SEED.awards.every(a => a.titulo && a.para && a.texto), 'each seed award has titulo, para and texto');
  }],
]);
