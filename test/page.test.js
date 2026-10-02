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
    A.match(text(c.doc, '#fanplot'), /Al azar/);
    A.match(text(c.doc, '#fanplot'), /Cowboys/);
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

  ['data.json unreachable: the page falls back to its embedded seed', async () => {
    const c = await load(null, { failFetch: true });
    A.deep(c.errors, [], 'no script errors');
    A.deep(rowNames(c.doc).sort(), SEED.pickem.map(p => p.name).sort(), 'seed names');
    A.match(text(c.doc, '#t-h1'), new RegExp('Semana ' + SEED.week + '\\.'));
  }],

  ['the embedded seed is valid current data', () => {
    A.equal(SEED.pickem.length, 22);
    A.ok(SEED.pickem.every(p => p.weeks.length === SEED.week), 'every player has one score per played week');
    A.equal(typeof SEED.pays[0], 'number');
  }],
]);
