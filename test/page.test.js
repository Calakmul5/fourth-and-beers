'use strict';
// jsdom tests for index.html. The page fetches data.json (or an edition) and falls back to an embedded seed,
// so every scenario feeds it its own data and checks that it did not silently render the seed.
// The week 5 fixture is the real data.json of week 5 in the new schema.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const A = require('./assert');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const SEED = JSON.parse(/<script type="application\/json" id="seed">([\s\S]*?)<\/script>/.exec(HTML)[1]);
const W5 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'week5.json'), 'utf8'));
const FULL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'week5-full.json'), 'utf8'));
const W5_OLD = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'week5-old.json'), 'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));
const PF = require('./picks_fixture');
const PICK_RULES = ['lealtad', 'mismoequipo', 'costalazo', 'llanero', 'borregada', 'empate', 'olvido', 'rachapicks', 'perros', 'corriente'];
/** Week 5 data.json with the picks the publisher builds from the real Group Picks paste. */
const sum = a => a.reduce((x, y) => x + y, 0);
const min = a => Math.min.apply(null, a);
const normName = n => String(n).replace(/[\u2018\u2019\u0060\u00b4]/g, "'").trim().toLowerCase();
/**
 * The league as it stood after week k. Strikes after k are approximated: whoever went out later has 2.
 * (This was T.truncate in the page, before the no-repeat check read the real previous edition.)
 */
function truncate(D, k) {
  var WK = D.weeks || 18, kr = Math.min(k, WK), d = {};
  Object.keys(D).forEach(function(x){ d[x] = D[x]; });
  d.week = k;
  if (k>WK){ d.regularWeek = WK; } else { delete d.regularWeek; delete d.playoffs; }
  d.pickem = D.pickem.map(function(p){
    var w = p.weeks.slice(0,kr), s = sum(w), drop = kr>1 ? min(w) : 0;
    return {name:p.name, weeks:w, total:s-drop, dropped:drop};
  });
  if (k>WK && D.playoffs){
    var rr = k-WK;
    d.playoffs = {week:k, rounds:rr, winners:(D.playoffs.winners||[]).slice(0,rr), pickem:(D.playoffs.pickem||[]).map(function(p){
      var w = (p.weeks||[]).slice(0,rr);
      return {name:p.name, weeks:w, total: p.weeks ? sum(w) : p.total};
    })};
  }
  d.winners = (D.winners||[]).slice(0,kr);
  d.picks = {};
  Object.keys(D.picks||{}).forEach(function(w){ if (Number(w)<=k) d.picks[w] = D.picks[w]; });
  d.survivorOut = (D.survivorOut||[]).filter(function(o){ return o.week==null || o.week<=k; });
  var later = {};
  (D.survivorOut||[]).forEach(function(o){ if (o.week!=null && o.week>k) later[normName(o.name)] = 1; });
  d.strikes = {};
  Object.keys(D.strikes||{}).forEach(function(n){ d.strikes[n] = later[normName(n)] ? 2 : D.strikes[n]; });
  return d;
}
/** The league as it stood after week k (picks, winners, strikes), with no hand-written rows. */
async function weekAt(k) {
  const d = truncate(clone(FULL), k);
  if (k < 5) d.tribune = { portada: null, columna: [], clasificados: [], datos: [], edicion: null };
  return d;
}
/** Week 5 plus a synthetic week 6, for the no-repeat check. */
function week6() {
  const d = clone(FULL);
  d.week = 6;
  d.pickem.forEach((p, i) => {
    p.weeks.push(40 + (i * 7) % 50);
    const drop = Math.min.apply(null, p.weeks);
    p.dropped = drop; p.droppedWeek = p.weeks.indexOf(drop) + 1;
    p.total = p.weeks.reduce((x, y) => x + y, 0) - drop;
  });
  d.winners.push([d.pickem[0].name]);
  d.picks['6'] = clone(d.picks['5']);
  return d;
}
const P5 = () => { const d = clone(W5); d.picks = PF.picks5().picks; return d; };

// ---- Page harness -----------------------------------------------------------

/**
 * o.url: query and hash, e.g. '?ed=4'. o.data: what data.json returns (null = 404).
 * o.editions: {N: data, or 'bad' for broken JSON}. o.index: edition index, or null for 404. o.failFetch: every fetch rejects.
 * o.gate: {N: promise} holds that edition's reply until it resolves. o.probe(window, fetched) runs 150 ms in, before the page has rendered.
 */
async function load(data, o) {
  o = o || {};
  const errors = [], fetched = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e && e.stack || e).split('\n')[0]));
  const reply = body => Promise.resolve({ ok: body != null, status: body != null ? 200 : 404,
    json: () => body === 'bad' ? Promise.reject(new SyntaxError('Unexpected token')) : Promise.resolve(clone(body)) });
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', url: 'https://example.test/' + (o.url || ''), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.addEventListener('error', e => errors.push(String(e.message)));
      window.fetch = u => {
        u = String(u).replace(/\?t=\d+$/, '');
        fetched.push(u);
        if (o.failFetch) return Promise.reject(new Error('offline'));
        if (u === 'data.json') return reply(data);
        if (u === 'editions/index.json') return reply(o.index || null);
        const m = /^editions\/semana-(\d\d)\.json$/.exec(u);
        if (m) {
          const body = (o.editions || {})[Number(m[1])] || null, gate = (o.gate || {})[Number(m[1])];
          return gate ? gate.then(() => reply(body)) : reply(body);
        }
        return reply(null);
      };
      if (o.storage) Object.keys(o.storage).forEach(k => window.localStorage.setItem(k, o.storage[k]));
    },
  });
  const doc = dom.window.document;
  if (o.probe) { await new Promise(r => setTimeout(r, 150)); o.probe(dom.window, fetched); }
  for (let i = 0; i < 100 && !dom.window.__model && !errors.length; i++) await new Promise(r => setTimeout(r, 20));
  await new Promise(r => setTimeout(r, 20));
  return { dom, doc, win: dom.window, errors, fetched, M: dom.window.__model, T: dom.window.__tribune };
}

const text = (doc, sel) => (doc.querySelector(sel) || { textContent: '' }).textContent;
const all = (doc, sel) => [].slice.call(doc.querySelectorAll(sel));

/** Copy rules: no em dashes, no semicolons chaining clauses, no broken values. */
function lint(str, label) {
  A.noMatch(str, /—/, label + ': no em dashes');
  A.noMatch(str, /;/, label + ': no semicolons');
  A.noMatch(str, /\bNaN\b|\bundefined\b|\bnull\b|\bInfinity\b|\[object|\{\w+\}/, label + ': no broken values or open placeholders');
  A.noMatch(str, /comisionado/i, label + ': it is the Comish, not the comisionado');
}

/** Invariants every rendering must satisfy. */
/** What a reader sees: the body without scripts and styles. */
function visible(doc) {
  const b = doc.body.cloneNode(true);
  all(b, 'script, style').forEach(e => e.remove());
  return b.textContent;
}

function common(ctx, label) {
  A.deep(ctx.errors, [], label + ': no script errors');
  lint(visible(ctx.doc), label);
  A.equal(all(ctx.doc, '.fact, .cifra').filter(e => e.textContent.length > 330).length, 0, label + ': facts stay short');
}

// ---- Data builders for the synthetic scenarios ------------------------------

const NAMES = ['Silverback', 'Jorge_B', 'Alfa Dog', 'Bravo Bird', 'Charlie Chain', 'Delta Dash', 'Echo Edge', 'Foxtrot Fan'];
function score(i, k) { return 40 + ((i * 17 + k * 29 + i * k * 7) % 55); }
function make(opts) {
  const week = opts.week, names = opts.names || NAMES;
  const pickem = names.map((name, i) => {
    let weeks = [];
    for (let k = 0; k < week; k++) weeks.push(score(i, k));
    if (opts.weeks && opts.weeks[name]) weeks = opts.weeks[name];
    const s = weeks.reduce((a, b) => a + b, 0), dropped = week > 1 ? Math.min.apply(null, weeks) : 0;
    return { name, weeks, total: s - dropped, dropped };
  });
  const strikes = {};
  if (!opts.noStrikes) names.forEach((n, i) => { strikes[n] = i % 4; });
  return {
    season: 2026, week, weeks: opts.weeksTotal || 18, updated: '2026-10-01T12:00:00Z',
    prizes: { regular: [1050, 350], survivor: [1050, 350], playoffs: [700], weekly: 50, weeks: opts.weeksTotal || 18 },
    pickem, strikes, survivorOut: opts.survivorOut || [], fans: opts.fans || {},
    tribune: opts.tribune || { portada: null, columna: [], clasificados: [], datos: [] },
  };
}
const SB = '<script>alert(1)</script>';

// ---- Cases ------------------------------------------------------------------

A.run('index.html', [
  ['the week 5 fixture renders the Tribune, from the data and not the seed', async () => {
    const c = await load(W5);
    common(c, 'week 5');
    A.match(text(c.doc, '#dateline'), /Edición 5/);
    A.match(text(c.doc, '#dateline'), /15 de octubre de 2026/);
    A.match(text(c.doc, '#dateline'), /Una chela/);
    A.match(text(c.doc, '.mast'), /Fourth and Beers\s*Tribune/);
    A.match(c.doc.title, /^Fourth and Beers Tribune$/);
    A.match(text(c.doc, '.tag'), /La quiniela más grande del mundo\. Información que nadie pidió\./);
    A.equal(c.M.D.week, 5);
    A.equal(c.doc.querySelectorAll('#pick option').length, 23, 'placeholder plus 22 call signs');
  }],

  ['page order: dateline, masthead, picker, portada, clasificados, datos, premios, footer', async () => {
    const c = await load(W5);
    const order = ['dateline', '.mast', 'pickbox', 'portada', 'clasificados', 'datos', 'premios', '.foot'];
    const pos = order.map(s => { const e = c.doc.querySelector(s.charAt(0) === '.' ? s : '#' + s); A.ok(e, s + ' exists'); return e; });
    for (let i = 1; i < pos.length; i++) A.ok(pos[i - 1].compareDocumentPosition(pos[i]) & 4, order[i - 1] + ' comes before ' + order[i]);
    A.equal(all(c.doc, 'select').length, 1, 'the picker is the only control on the page');
    A.equal(all(c.doc, 'button').filter(b => !b.closest('#sheet')).length, 0, 'no other buttons outside the panel');
    A.deep(all(c.doc, '.sec').map(e => e.textContent), ['Clasificados', 'Datos que nadie pidió', 'Premios, pizzas y carne asada'], 'the sections of the Tribune: the Columna is the body of the Portada story');
    ['Cada semana uno por uno', 'Premios que no pagan', 'Palabras del Comish', 'Castigos', 'Cómo se cuenta'].forEach(t => A.noMatch(visible(c.doc), new RegExp(t), 'removed section ' + t));
    A.equal(c.doc.querySelector('#page #bumpbox'), null, 'the chart lives only in the panel');
    A.equal(c.doc.querySelectorAll('#heat, #board, .award').length, 0, 'old structures are gone');
  }],

  ['weekly winners from the fixture', async () => {
    const c = await load(W5);
    const w = c.M.weekly.map(x => [x.winners.join(','), x.max]);
    A.deep(w, [['Jorge_B', 93], ['Silverback', 76], ['Silverback', 101], ['King of The North', 90], ['Abogado', 94]]);
  }],

  ['facts: every claim about the week 5 data is found by the engine', async () => {
    const c = await load(W5);
    const f = {}; c.T.facts(c.M).forEach(x => { f[x.rule] = x; });
    A.deep([f.rebote.data.name, f.rebote.data.delta, f.rebote.data.from, f.rebote.data.to], ['KinkyKing', 60, 23, 83], 'KinkyKing +60');
    A.equal(f.rebote.valor, '+60');
    A.deep(f.arriba.data.names, ['Cyber70'], 'Cyber70 the only one above average all 5 weeks');
    A.equal(f.arriba.data.weeks, 5);
    A.deep(f.fotocopia.data.names.slice().sort(), ['Jorge_B', 'Mean Machine', 'Osos de Grayslake'], 'three at 281');
    A.equal(f.fotocopia.data.total, 281);
    A.deep([f.disco.data.name, f.disco.data.score, f.disco.data.times], ['This is our year', 65, 3], '65 three times');
    A.deep([f.racha.data.name, f.racha.data.weeks, f.racha.data.streak], ['MVP21', [35, 38, 53, 71], 3], 'MVP21 four weeks up');
    A.equal(f.racha.valor, '+36');
    A.deep([f.siempre.data.name, f.siempre.data.kind, f.siempre.data.weeks], ['Steel Man', 'last', 5], 'Steel Man last all 5 weeks');
    A.deep([f.remontada.data.name, f.remontada.data.from, f.remontada.data.to, f.remontada.data.streak], ['Silverback', 17, 1, 3], '17th to first, led 3 weeks');
    A.equal(f.remontada.valor, '17º→1º');
    A.deep([f.survivor.data.week, f.survivor.data.count], [4, 4], 'week 4 had 4 eliminations');
    A.equal(f.aficiones, undefined, 'aficiones lives in the fan-base note, not in Datos');
    A.equal(f.sotano, undefined, 'and the sótano gap in the pizza box');
  }],

  ['facts: La cifra de la semana is KinkyKing +60, and the facts read right', async () => {
    const c = await load(W5);
    A.equal(c.M.pk.cifra.rule, 'rebote');
    A.equal(text(c.doc, '.cifra .n'), '+60');
    A.match(text(c.doc, '.cifra'), /La cifra de la semana/);
    A.match(text(c.doc, '.cifra p'), /^KinkyKing hizo 23 en la semana 4 y 83 en la 5\. Nadie ha rebotado tanto\.$/);
    const facts = all(c.doc, '#facts .fact');
    A.ok(facts.length >= 4 && facts.length <= 6, 'up to 6 facts, got ' + facts.length);
    facts.forEach(f => A.ok(f.querySelector('.v').textContent && f.querySelector('strong').textContent, 'each fact has a number and a label'));
    A.equal(c.M.pk.picks.length, 6, 'the engine picks 6');
    const e = c.T.facts(c.M).filter(x => x.rule === 'remontada')[0];
    A.match(e.texto, /^El Comish era 17º después de la semana 1\. Lleva tres semanas de líder\. Nadie lo vio venir, ni él\.$/, 'the commissioner is el Comish');
    A.match(c.T.facts(c.M).filter(x => x.rule === 'fotocopia')[0].texto, /^Osos de Grayslake, Mean Machine y Jorge_B: 281 cada uno\./);
  }],

  ['facts: a rule that ran last week goes to the back when another candidate exists', async () => {
    const c = await load(W5);
    A.deep(c.T.prevRules(c.M), [], 'no archive of last week, so nothing is held out');
    const prev = ['racha', 'remontada', 'rebote', 'survivor', 'arriba'];
    const r = c.T.pickFacts(c.M, prev);
    A.equal(r.picks.length, 6);
    ['fotocopia', 'disco', 'siempre'].forEach(x => A.ok(r.picks.some(p => p.rule === x), x + ' is fresh and stays in'));
    A.ok(!r.picks.some(p => p.rule === 'peor'), 'a second fact about the last place is over budget even when fresh');
    A.equal(r.picks.filter(p => prev.indexOf(p.rule) >= 0).length, 3, 'only as many repeats as it takes to reach 6');
    A.equal(r.cifra.rule, 'rebote', 'La cifra can still repeat when nothing else is as big');
    const none = c.T.pickFacts(c.M, [], false);
    A.deep(none.picks.map(p => p.rule), ['rebote', 'racha', 'remontada', 'fotocopia', 'survivor', 'arriba'], 'with no history the 6 highest scores');
  }],

  ['facts: nothing mentions the model or the random picker, and every text stays short', async () => {
    const c = await load(W5);
    for (const k of [2, 3, 4, 5]) {
      const M = c.T.model(truncate(c.M.D, k));
      c.T.facts(M).forEach(f => {
        lint(f.texto + ' ' + f.titulo + ' ' + f.valor, 'week ' + k + ' ' + f.rule);
        A.noMatch(f.texto, /modelo|random|al azar|dado|moneda/i, f.rule + ' does not mention the model or random picks');
        A.ok(f.texto.length <= 125, f.rule + ' week ' + k + ' is ' + f.texto.length + ' chars: ' + f.texto);
      });
    }
  }],

  ['facts: every template group has 3 or more templates in 3 or more styles, an albur, and clean copy', async () => {
    const c = await load(W5);
    let n = 0;
    Object.keys(c.T.FT).forEach(k => {
      const g = c.T.FT[k], styles = {};
      g.forEach(t => {
        n++;
        styles[t.s] = 1;
        A.ok(c.T.STYLES.indexOf(t.s) >= 0, k + ' has a known style: ' + t.s);
        lint(t.t.replace(/\{\w+\}/g, 'Ab'), 'template ' + k);
        A.ok(t.t.replace(/\{\w+\}/g, 'Abogado').length <= 150 || t.s === 'calaverita', k + ' template is short: ' + t.t);
        if (t.s === 'calaverita') A.equal(t.t.split(' / ').length, 4, k + ' calaverita has 4 lines');
      });
      A.ok(g.length >= 3, k + ' has 3 or more templates');
      A.ok(Object.keys(styles).filter(x => x !== 'calaverita').length >= 3, k + ' has 3 or more styles');
      A.ok(styles.albur, k + ' has an albur');
      A.ok(g[0].s === 'carrilla' || g[0].s === 'albur' || g[0].s === 'refran' || g[0].s === 'nimodo' || g[0].s === 'nunca', k + ' starts with a plain template');
    });
    A.ok(n >= 150, 'enough templates (' + n + ')');
    A.ok(c.T.TPL.portadaStart.length === 1 && c.T.TPL.portadaCodas.length === 3, 'the portada fallbacks stay plain');
  }],

  ['facts: rules that do not fire with thin data return nothing', async () => {
    const d = make({ week: 1 });
    const c = await load(d);
    A.deep(c.T.facts(c.M).map(f => f.rule), [], 'week 1 has no history to talk about');
    const c2 = await load(make({ week: 2 }));
    A.ok(!c2.T.facts(c2.M).some(f => f.rule === 'racha' || f.rule === 'remontada' || f.rule === 'siempre'), 'no streaks in week 2');
    common(c, 'week 1'); common(c2, 'week 2');
  }],

  ['facts: a drop, a record and a falling streak are named as such', async () => {
    const d = make({ week: 5, weeks: { Silverback: [90, 80, 70, 60, 50], Jorge_B: [60, 60, 60, 60, 120], 'Alfa Dog': [50, 50, 50, 50, 20] } });
    const c = await load(d);
    const f = {}; c.T.facts(c.M).forEach(x => { f[x.rule] = x; });
    A.equal(f.rebote.data.name, 'Jorge_B');
    A.equal(f.rebote.titulo, 'Rebote');
    A.equal(f.racha.data.dir, -1, 'Silverback fell 4 straight');
    A.match(f.racha.titulo, /semanas en descenso/);
    A.equal(f.racha.valor, '−40');
    A.equal(f.record.data.kind, 'best', 'a season-best week');
    A.equal(f.record.valor, '120');
    A.equal(f.disco.data.name, 'Jorge_B', 'a repeated score');
    const d2 = make({ week: 4, weeks: { Silverback: [60, 60, 60, 20] } });
    const c2 = await load(d2);
    const g = c2.T.facts(c2.M).filter(x => x.rule === 'rebote')[0];
    A.equal(g.titulo, 'Caída');
    A.match(g.valor, /^−/);
    common(c, 'drop'); common(c2, 'drop 2');
  }],

  ['aficiones money: weekly $50s per fan base', async () => {
    const c = await load(W5);
    const m = {}; c.M.groups.forEach(g => { m[g.key] = g.money; });
    A.deep([m.PIT, m.SF, m.CHI, m.azar, m.DAL, m.GB], [100, 50, 50, 50, 0, 0], 'Steelers $100, 49ers $50, Bears $50, Video Juegos $50, Cowboys $0, Packers $0');
    A.deep(c.M.groups.map(g => g.n).sort((a, b) => a - b), [1, 1, 2, 3, 7, 8]);
  }],

  ['aficiones card: logo, count, bar, money; sorted by money then fans; no averages', async () => {
    const c = await load(W5);
    const rows = all(c.doc, '.afi .row');
    A.deep(rows.map(r => r.querySelector('.amt').textContent), ['$100', '$50', '$50', '$50', '$0', '$0']);
    A.deep(rows.map(r => r.querySelector('.cnt').textContent), ['×3', '×7', '×2', '×1', '×8', '×1'], 'ties by number of fans');
    A.deep(rows.map(r => r.querySelector('img').alt), ['Steelers', 'Bears', '49ers', 'Video Juegos', 'Cowboys', 'Packers'], 'alt text names the team');
    A.equal(rows[0].querySelector('.tr i').style.width, '100%');
    A.equal(rows[1].querySelector('.tr i').style.width, '50%');
    A.ok(rows[4].querySelector('.amt').classList.contains('zero'), '$0 rows are muted');
    A.equal(rows.filter(r => /Steelers|Bears|Cowboys/.test(r.textContent)).length, 0, 'no team name in the row text');
    A.match(text(c.doc, '.afi .note'), /Los 8 de Dallas todavía no ven un peso\./);
    A.noMatch(text(c.doc, '.afi'), /promedio|prom\./i, 'no averages anywhere');
    A.equal(c.doc.querySelectorAll('.fanplot, #fanplot').length, 0);
  }],

  ['aficiones money: final prizes count once they are paid', async () => {
    const d = make({ week: 2, weeksTotal: 2, names: ['Ana', 'Beto', 'Chuy'], weeks: { Ana: [80, 90], Beto: [70, 60], Chuy: [50, 40] },
      survivorOut: [{ name: 'Ana', week: 1 }, { name: 'Beto', week: 2 }], fans: { Ana: { nfl: 'DAL' }, Beto: { nfl: 'CHI' }, Chuy: { nfl: 'DAL' } } });
    d.strikes = { Ana: 3, Beto: 3, Chuy: 1 };
    const c = await load(d);
    A.equal(c.M.survivorDecided, true);
    const p = c.M.paid;
    A.deep([p.Ana, p.Beto, p.Chuy], [100 + 1050, 0 + 350 + 350, 0 + 1050], 'Ana weekly + 1st regular, Beto 2nd regular + 2nd Survivor, Chuy 1st Survivor');
    A.match(text(c.doc, '.box .pill'), /final/);
    common(c, 'final');
  }],

  ['initials: the expected list, all unique', async () => {
    const c = await load(W5);
    const ids = c.M.ids;
    const want = { Silverback: 'SI', Jorge_B: 'JB', 'King of The North': 'KN', Abogado: 'AB', 'Andrea’s Picks': 'AP', 'Manolito’s winning picks': 'MP', 'Osos de Grayslake': 'OG', KinkyKing: 'KK' };
    Object.keys(want).forEach(n => A.equal(ids[n], want[n], 'initials of ' + n));
    A.equal(Object.keys(ids).length, 22);
    A.equal(new Set(Object.values(ids)).size, 22, 'all 22 unique');
    A.equal(ids['X-Men Let’s go Boys'], 'XM'); A.equal(ids['Puto el que lo lea'], 'PL'); A.equal(ids['This is our year'], 'TY');
    A.equal(ids['MVP21'], 'MV', 'one word takes its first two letters');
    const same = c.T.initials(['Ana Banana', 'Alberto Bobo', 'Abel Blanco']);
    A.equal(new Set(Object.values(same)).size, 3, 'collisions get a third letter: ' + JSON.stringify(same));
    A.ok(Object.values(same).every(v => v.length >= 2));
  }],

  ['prizes: regular, Survivor and playoffs amounts and labels', async () => {
    const c = await load(W5);
    const boxes = all(c.doc, '#prizes .box');
    const by = h => boxes.filter(b => b.querySelector('.h').textContent.indexOf(h) === 0)[0];
    const reg = by('Quiniela regular');
    A.match(reg.querySelector('.pill').textContent, /en juego/);
    A.deep(all(reg, '.pzr').map(r => r.textContent.replace(/\s+/g, ' ').trim()), ['1ºSilverback, 304$1,050', '2ºAbogado, 289$350']);
    A.match(reg.querySelector('.note').textContent, /King of The North está a 2 puntos del dinero\. Faltan 13 semanas\./);
    const sv = by('Survivor');
    A.match(sv.querySelector('.pill').textContent, /16 vivos/);
    A.deep(all(sv, '.pzr').map(r => r.textContent.replace(/\s+/g, ' ').trim()), ['1ºEl último en pie$1,050', '2ºEl penúltimo$350']);
    A.match(sv.querySelector('.note').textContent, /Dura hasta el Super Bowl\. Juan1768 sigue sin strikes\./);
    const po = by('Quiniela de playoffs');
    A.match(po.querySelector('.pill').textContent, /en enero/);
    A.match(po.textContent, /Todos empiezan en cero/);
    A.match(po.textContent, /\$700/);
    A.equal(all(po, '.pzr').length, 1, 'only first place pays');
    A.deep(boxes.map(b => b.querySelector('.h').textContent.replace(/\s+/g, ' ').trim().replace(/ (en juego|\d+ de \d+|en enero|\d+ vivos)$/, '')),
      ['Quiniela regular', 'Premio semanal, $50', 'La tabla de las aficiones', 'Survivor', 'Quiniela de playoffs', 'Hoy pagaría las pizzas', 'Organiza la carne asada'], 'card order');
  }],

  ['prizes: the playoff leader shows once the playoff board exists', async () => {
    const d = clone(W5); d.playoffs = { pickem: [{ name: 'Abogado', total: 40 }, { name: 'Cyber70', total: 52 }] };
    const c = await load(d);
    const po = all(c.doc, '#prizes .box').filter(b => /playoffs/.test(b.textContent))[0];
    A.match(po.textContent, /Cyber70, 52/);
    A.match(po.querySelector('.pill').textContent, /en juego/);
  }],

  ['prizes: pizzas go to Steel Man and the carne asada to KinkyKing', async () => {
    const c = await load(W5);
    const pz = c.doc.querySelector('.box.pizza');
    A.match(pz.querySelector('.h').textContent, /Hoy pagaría las pizzas/);
    A.equal(pz.querySelector('.big').textContent, 'Steel Man');
    A.equal(pz.querySelector('.note').textContent, '179 puntos, a 32 del 21º. Último las cinco semanas.');
    const ca = all(c.doc, '#prizes .box').filter(b => /carne asada/.test(b.querySelector('.h').textContent))[0];
    A.equal(ca.querySelector('.big').textContent, 'KinkyKing');
    A.match(ca.querySelector('.note').textContent, /Primero fuera de Survivor, semana 3\. Ya es oficial\./);
  }],

  ['prizes: ties follow the golf rule and split the bill', async () => {
    const d = make({ week: 3, weeksTotal: 3, names: ['Ana', 'Beto', 'Chuy', 'Dora', 'Eli'],
      weeks: { Ana: [80, 70, 60], Beto: [80, 70, 60], Chuy: [60, 60, 60], Dora: [50, 50, 50], Eli: [50, 50, 50] } });
    d.pickem.forEach(p => { p.total = p.weeks.reduce((a, b) => a + b, 0) - Math.min.apply(null, p.weeks); p.dropped = Math.min.apply(null, p.weeks); });
    const c = await load(d);
    const reg = all(c.doc, '#prizes .box')[0];
    const rows = all(reg, '.pzr').map(r => r.textContent.replace(/\s+/g, ' ').trim());
    A.deep(rows, ['1ºAna y Beto, 150$700 c/u'], 'a tie for first splits first and second: (1050 + 350) / 2 each');
    A.match(reg.querySelector('.pill').textContent, /final/);
    const pz = c.doc.querySelector('.box.pizza');
    A.equal(pz.querySelector('.big').textContent, 'Dora y Eli');
    A.match(pz.querySelector('.note').textContent, /Empate: se dividen la cuenta\./);
    A.match(pz.querySelector('.h').textContent, /Paga las pizzas/);
  }],

  ['premio semanal: 18 tiles, played ink with initials, current outlined, future dashed', async () => {
    const c = await load(W5);
    const tiles = all(c.doc, '.grid18 .g');
    A.equal(tiles.length, 18);
    A.equal(tiles.filter(t => t.classList.contains('done')).length, 5);
    A.equal(tiles.filter(t => t.classList.contains('next')).length, 13);
    A.deep(tiles.slice(0, 5).map(t => t.querySelector('b').textContent), ['JB', 'SI', 'SI', 'KN', 'AB']);
    A.deep(tiles.slice(0, 5).map(t => t.textContent.replace(/\s+/g, '')), ['S1JB', 'S2SI', 'S3SI', 'S4KN', 'S5AB'].map(x => x), 'week label under the initials');
    A.equal(all(c.doc, '.g.now').length, 1);
    A.ok(tiles[4].classList.contains('now'), 'the current week is outlined');
    A.deep(tiles.slice(5).map(t => t.textContent), Array.from({ length: 13 }, (_, i) => 'S' + (i + 6) + '$50'));
    A.match(text(c.doc, '.grid18').length ? c.doc.querySelector('.grid18').parentNode.querySelector('.pill').textContent : '', /5 de 18/);
    const logos = tiles.slice(0, 5).map(t => t.querySelector('img'));
    A.deep(logos.map(i => i.alt), ['Video Juegos', 'Steelers', 'Steelers', 'Bears', '49ers']);
    logos.forEach(i => A.ok(/^https:\/\/(a\.espncdn\.com\/i\/teamlogos\/nfl\/500\/[a-z]+\.png|upload\.wikimedia\.org\/wikipedia\/commons\/f\/f7\/Cloud9_logo\.svg)$/.test(i.src), 'linked, not embedded: ' + i.src));
    A.noMatch(c.doc.documentElement.outerHTML, /500-dark/, 'the light logo set');
    A.equal(c.doc.querySelector('.grid18').parentNode.querySelector('.note').textContent, 'JB Jorge_B · SI Silverback · KN King of The North · AB Abogado');
    A.noMatch(c.doc.querySelector('.grid18').parentNode.textContent, /\b(93|76|101|90|94)\b/, 'no points on the tiles');
  }],

  ['premio semanal: a tie splits the tile and Washington uses wsh', async () => {
    const d = make({ week: 3, names: ['Ana', 'Beto', 'Chuy'], weeks: { Ana: [80, 70, 90], Beto: [80, 60, 90], Chuy: [50, 50, 50] }, fans: { Ana: { nfl: 'WAS' }, Beto: { nfl: 'DAL' } } });
    const c = await load(d);
    const tiles = all(c.doc, '.grid18 .g');
    A.ok(tiles[0].classList.contains('tie'), 'week 1 tied');
    A.deep(all(tiles[0], 'i').map(i => i.textContent), ['AN', 'BE'], 'both initials');
    A.ok(tiles[2].classList.contains('tie'));
    A.equal(tiles[1].querySelector('img').src, 'https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png', 'Washington is wsh');
    A.equal(c.M.paid.Ana, 25 + 50 + 25 + 0, 'a tie splits the $50');
    A.match(c.doc.querySelector('.grid18').parentNode.querySelector('.note').textContent, /AN Ana · BE Beto/);
  }],

  ['logos: Suiza and college-only keep an emoji, alt text is always set', async () => {
    const d = make({ week: 3, names: ['Ana', 'Beto', 'Chuy', 'Dora'], fans: { Beto: { ncaa: 'Michigan' }, Chuy: { random: true, other: 'League of Legends' }, Dora: { nfl: 'GB' } } });
    const c = await load(d);
    const rows = all(c.doc, '.afi .row');
    A.equal(rows.length, 4);
    const labels = rows.map(r => (r.querySelector('img') || r.querySelector('.lg')).getAttribute('alt') || r.querySelector('.lg').getAttribute('aria-label'));
    A.ok(labels.indexOf('Suiza, sin equipo') >= 0 && labels.indexOf('Solo college') >= 0 && labels.indexOf('Video Juegos') >= 0 && labels.indexOf('Packers') >= 0, JSON.stringify(labels));
    all(c.doc, 'img').forEach(i => A.ok(i.getAttribute('alt'), 'alt text on every image'));
  }],

  ['portada: the Tribune row wins, otherwise the biggest climber, otherwise the opening', async () => {
    const c = await load(W5);
    A.equal(text(c.doc, '#p-head'), 'Del sótano a la azotea');
    A.equal(text(c.doc, '#p-deck'), 'Abogado sube nueve lugares en una semana. Nadie pidió explicaciones.');
    A.equal(text(c.doc, '#p-by'), 'Por el Comish, que sigue líder y no piensa disculparse');
    A.match(text(c.doc, '#portada .kicker'), /Última hora/);
    const d = clone(W5); d.tribune.portada = { titulo: 'Titular de la hoja', texto: 'Bajada de la hoja.', para: 'Abogado' };
    const c2 = await load(d);
    A.equal(text(c2.doc, '#p-head'), 'Titular de la hoja');
    A.equal(text(c2.doc, '#p-deck'), 'Bajada de la hoja.');
    const c3 = await load(make({ week: 1 }));
    A.equal(text(c3.doc, '#p-head'), 'Arranca la temporada');
    A.match(text(c3.doc, '#p-deck'), /abre con \d+ puntos/);
    const quiet = make({ week: 2, weeks: Object.fromEntries(NAMES.map((n, i) => [n, [100 - i, 100 - i]])) });
    const c4 = await load(quiet);
    A.equal(text(c4.doc, '#p-head'), 'Semana sin sobresaltos');
    common(c3, 'week 1'); common(c4, 'quiet');
  }],

  ['story and clasificados show the Tribune rows, escaped, and hide when empty', async () => {
    const c = await load(W5);
    A.deep(all(c.doc, '#story p').map(p => p.textContent.replace(/■$/, '')), W5.tribune.columna.map(x => x.texto));
    A.deep(all(c.doc, '#ads .ad strong').map(b => b.textContent), W5.tribune.clasificados.map(x => x.titulo));
    const d = make({ week: 2 });
    const c2 = await load(d);
    A.equal(c2.doc.querySelector('#story').children.length, 0);
    A.equal(c2.doc.querySelector('#clasificados').hidden, true);
    const d3 = make({ week: 2, tribune: { portada: { titulo: SB, texto: SB, para: '' }, columna: [{ titulo: SB, para: '', texto: SB }], clasificados: [{ titulo: SB, para: '', texto: SB }], datos: [{ titulo: SB, para: '', texto: SB }] } });
    const c3 = await load(d3);
    A.equal(c3.doc.querySelectorAll('#page script').length, 0, 'sheet text never becomes markup');
    A.deep(c3.errors, []);
  }],

  ['datos: Dato rows come first, then the automatic facts, six at most', async () => {
    const d = clone(W5);
    d.tribune.datos = [{ titulo: 'Dato a mano', para: '', texto: 'Escrito por el Comish.' }, { titulo: 'Otro', para: '', texto: 'Otro dato.' }];
    const c = await load(d);
    const facts = all(c.doc, '#facts .fact');
    A.equal(facts[0].querySelector('strong').textContent, 'Dato a mano');
    A.equal(facts[1].querySelector('strong').textContent, 'Otro');
    A.ok(facts.length <= 6);
    A.equal(c.doc.querySelectorAll('.cifra').length, 1);
    const none = await load(W5);
    A.equal(all(none.doc, '#facts .fact').length, 5, 'without Dato rows: the cifra plus 5');
  }],

  ['name panel: picking a name opens the bottom sheet with chart and Survivor', async () => {
    const c = await load(W5);
    const sel = c.doc.querySelector('#pick'), sheet = c.doc.querySelector('#sheet');
    A.equal(sheet.hidden, true, 'closed on load');
    sel.value = 'Abogado'; sel.dispatchEvent(new c.win.Event('change'));
    A.equal(sheet.hidden, false);
    A.equal(text(c.doc, '#sh-name'), 'Abogado');
    A.equal(text(c.doc, '#sh-line'), '2º con 289 puntos. Survivor: 1 vida.');
    A.match(text(c.doc, '#sheet .kicker'), /Tu edición/);
    A.match(text(c.doc, '#sheet .pbar'), /Fourth and Beers Tribune/);
    A.match(text(c.doc, '#pick-label'), /Abogado/);
    A.equal(sel.value, '', 'the select resets so the same name can be picked again');
    A.equal(c.doc.querySelectorAll('#bumpbox .bl').length, 22);
    A.deep(all(c.doc, '#bumpbox .bl.sel').map(g => g.dataset.name), ['Abogado'], 'selected line');
    A.equal(c.doc.querySelectorAll('#bumpbox .bl.up').length, 1, 'biggest climber');
    A.equal(c.doc.querySelector('#bumpbox .bl.up').dataset.name, 'Abogado');
    A.equal(c.doc.querySelectorAll('#bumpbox .bl.down').length, 1);
    A.equal(c.doc.querySelector('#bumpbox .bl.down').dataset.name, 'Juan1768');
    A.match(text(c.doc, '#movers'), /Subió más en la semana 5: Abogado \+9 lugares/);
    A.match(text(c.doc, '#movers'), /Bajó más: Juan1768 −6 lugares/);
    A.equal(c.doc.querySelectorAll('.toggle button').length, 2);
    const two = Object.keys(W5.strikes).filter(n => W5.strikes[n] === 2).length;
    A.deep(all(c.doc, '#tally b').map(b => b.textContent), ['16', '1', String(two), '6'], 'vivos, sin strikes, en la cuerda floja, fuera');
    ['vivos', 'sin strikes', 'cuerda floja', 'fuera'].forEach(t => A.match(text(c.doc, '#tally'), new RegExp(t)));
    A.equal(c.doc.querySelectorAll('#surv .sv').length, 22);
    A.deep(all(c.doc, '#surv .sv.sel').map(s => s.dataset.name), ['Abogado'], 'the selected card is outlined');
    A.equal(c.doc.querySelectorAll('#surv .sv.out').length, 6);
    common(c, 'panel');
  }],

  ['name panel: toggle, tapping a line, close, and nothing else inside', async () => {
    const c = await load(W5);
    c.M.openSheet('Silverback', false);
    A.equal(text(c.doc, '#sh-line'), '1º con 304 puntos. Survivor: 1 vida.');
    c.doc.querySelector('.toggle button[data-mode="sola"]').click();
    A.equal(c.doc.querySelector('.toggle button[data-mode="sola"]').getAttribute('aria-pressed'), 'true');
    A.equal(c.doc.querySelectorAll('#bumpbox .bl').length, 22, 'still drawn');
    c.doc.querySelector('#bumpbox .bl[data-name="KinkyKing"]').dispatchEvent(new c.win.MouseEvent('click', { bubbles: true }));
    A.equal(text(c.doc, '#sh-name'), 'KinkyKing', 'tapping a line follows that player');
    A.equal(text(c.doc, '#sh-line'), 'Empatado en el 14º con 245 puntos. Survivor: fuera.');
    A.deep(all(c.doc, '#panel .sub').map(s => s.textContent), ['Subidas y bajadas', 'Survivor: strikes'], 'only the chart and the strikes');
    c.doc.querySelector('#close').click();
    A.equal(c.doc.querySelector('#sheet').hidden, true);
    c.M.openSheet('Jorge_B', false);
    c.doc.dispatchEvent(new c.win.KeyboardEvent('keydown', { key: 'Escape' }));
    A.equal(c.doc.querySelector('#sheet').hidden, true, 'Escape closes');
    c.M.openSheet('Jorge_B', false);
    c.doc.querySelector('#scrim').click();
    A.equal(c.doc.querySelector('#sheet').hidden, true, 'the scrim closes');
    A.equal(text(c.doc, '#sh-line') !== '', true);
  }],

  ['name panel: a tie reads as a tie', async () => {
    const c = await load(W5);
    c.M.openSheet('Mean Machine', false);
    A.equal(text(c.doc, '#sh-line'), 'Empatado en el 5º con 281 puntos. Survivor: 1 vida.');
  }],

  ['name panel: ?yo= and #name open it, a remembered name only fills the label', async () => {
    const a = await load(W5, { url: '?yo=Abogado' });
    A.equal(a.doc.querySelector('#sheet').hidden, false);
    A.equal(text(a.doc, '#sh-name'), 'Abogado');
    const b = await load(W5, { url: '#Silverback' });
    A.equal(text(b.doc, '#sh-name'), 'Silverback');
    const c = await load(W5, { url: "?yo=Andrea's%20Picks" });
    A.equal(text(c.doc, '#sh-name'), 'Andrea’s Picks', 'straight and curly apostrophes match');
    const d = await load(W5, { url: '?yo=Nadie' });
    A.equal(d.doc.querySelector('#sheet').hidden, true, 'an unknown name opens nothing');
    A.deep(d.errors, []);
    const e = await load(W5, { storage: { 'fab-me': 'Cyber70' } });
    A.equal(e.doc.querySelector('#sheet').hidden, true);
    A.match(text(e.doc, '#pick-label'), /Cyber70/);
  }],

  ['name panel: no Survivor data hides the strikes block', async () => {
    const c = await load(make({ week: 3, noStrikes: true }));
    c.M.openSheet('Silverback', false);
    A.equal(c.doc.querySelector('#svbox').hidden, true);
    A.noMatch(text(c.doc, '#sh-line'), /Survivor/);
    A.equal(all(c.doc, '#prizes .box').filter(b => /^Survivor/.test(b.querySelector('.h').textContent.trim())).length, 1);
    A.equal(c.doc.querySelector('#prizes .pill.soon') !== null, true);
    common(c, 'no strikes');
  }],

  ['archive: ?ed=4 loads the frozen edition with a banner and a way back', async () => {
    const base = await load(W5);
    const ed4 = truncate(W5, 4); ed4.updated = '2026-10-08T12:00:00Z';
    const c = await load(W5, { url: '?ed=4', editions: { 4: ed4 }, index: { weeks: [3, 4, 5] } });
    A.deep(c.errors, []);
    A.ok(c.fetched.indexOf('editions/semana-04.json') >= 0, 'asked for the edition file');
    A.equal(c.M.D.week, 4, 'rendered week 4, not the live week');
    A.match(text(c.doc, '#dateline'), /Edición 4/);
    A.match(text(c.doc, '#dateline'), /8 de octubre de 2026/);
    const b = c.doc.querySelector('#banner');
    A.equal(b.hidden, false);
    A.match(b.textContent, /Edición 4, archivo/);
    A.equal(b.querySelector('a').getAttribute('href'), '/', 'back to the current edition');
    A.deep(all(c.doc, '.grid18 .g.done').length, 4);
    common(c, 'ed 4');
    A.deep(all(c.doc, '#eds a').map(a => a.textContent), ['3', '5'], 'links to the other editions');
  }],

  ['archive: ?ed=5 renders, a missing edition falls back to the current one', async () => {
    const c = await load(W5, { url: '?ed=5', editions: { 5: W5 } });
    A.equal(c.M.D.week, 5);
    A.equal(c.doc.querySelector('#banner').hidden, false, 'an edition file is shown as the archive');
    A.match(text(c.doc, '#banner'), /Edición 5, archivo/);
    common(c, 'ed 5');
    const m = await load(W5, { url: '?ed=2', editions: {} });
    A.equal(m.M.D.week, 5, 'falls back to the current edition');
    A.equal(m.doc.querySelector('#banner').hidden, true, 'and says nothing about an archive');
    A.deep(m.errors, []);
    const bad = await load(W5, { url: '?ed=abc' });
    A.equal(bad.M.D.week, 5);
    A.deep(bad.fetched.filter(u => /editions\/semana/.test(u)), ['editions/semana-04.json'], "a bad value never asks for an edition, only for last week's archive");
  }],

  ['footer: earlier editions come from the index, and Yahoo is linked', async () => {
    const c = await load(W5, { index: { weeks: [3, 4, 5] } });
    A.equal(c.doc.querySelector('#eds').hidden, false);
    A.match(text(c.doc, '#eds'), /^Ediciones anteriores: 3 · 4$/);
    A.deep(all(c.doc, '#eds a').map(a => a.getAttribute('href')), ['?ed=3', '?ed=4']);
    A.match(text(c.doc, '.foot'), /La tabla completa vive en Yahoo\./);
    A.match(c.doc.querySelector('#yahoo').href, /^https:\/\/football\.fantasysports\.yahoo\.com\//);
    const none = await load(W5);
    A.equal(none.doc.querySelector('#eds').hidden, true, 'no index file, no line');
    A.match(text(none.doc, '.foot .ver'), /v\d+\.\d+\.\d+ c\d+\.\d+\.\d+/);
    A.match(HTML, /\.foot a\{[^}]*min-height:44px/, 'footer links are 44px targets');
  }],

  ['no data.json: the page falls back to the embedded seed', async () => {
    const c = await load(null, { failFetch: true });
    A.deep(c.errors, []);
    A.equal(c.M.D.week, SEED.week);
    A.equal(c.M.players.length, SEED.pickem.length, 'the seed is a whole league');
    A.equal(c.M.D.week, 5, 'the seed is the week 5 edition');
    A.equal(c.M.players[0].name, 'Silverback');
    A.equal(c.M.pk.cifra.valor, '+60');
    common(c, 'seed');
    const nf = await load(null);
    A.equal(nf.M.D.week, 5, 'a 404 also falls back to the seed');
    A.deep(nf.errors, []);
  }],

  ['old data.json (pays, weeklyPrize, comments, awards) still renders until the first publish', async () => {
    const c = await load(W5_OLD);
    common(c, 'old schema');
    A.match(c.doc.querySelector('#prizes .box').textContent, /\$1,050/);
    A.match(c.doc.querySelector('#prizes .box').textContent, /\$350/);
    A.match(c.doc.querySelector('.grid18').parentNode.querySelector('.h').textContent, /\$50/);
    A.equal(c.doc.querySelector('#story').children.length, 0, 'old comments are not read');
    A.equal(c.doc.querySelector('#clasificados').hidden, true, 'old awards are not read');
    A.equal(text(c.doc, '#p-head'), 'Del sótano a la azotea');
  }],

  ['page is newsprint: light only, tokens only, no dark mode, mobile first', async () => {
    A.match(HTML, /<meta name="color-scheme" content="only light">/);
    A.match(HTML, /:root\{\s*color-scheme:only light;/);
    A.noMatch(HTML, /prefers-color-scheme/, 'no dark mode media query');
    A.match(HTML, /<meta name="viewport" content="width=device-width, initial-scale=1/);
    A.match(HTML, /html,body\{background:var\(--paper\) !important/, 'explicit backgrounds so iOS cannot invert');
    ['UnifrakturMaguntia', 'Playfair+Display', 'Source+Serif+4', 'Libre+Franklin'].forEach(f => A.ok(HTML.indexOf(f) > 0, f));
    ['--paper:#F3EEE3', '--paper2:#E9E2D3', '--ink:#161514', '--ink2:#3B3834', '--muted:#6B655C', '--rule:#161514', '--hair:#B9B0A0', '--red:#A3191F', '--up:#2E7D4F', '--down:#C2610C', '--accent:var(--red)', '--marigold:#935D00'].forEach(t => A.ok(HTML.indexOf(t) > 0, t));
    A.noMatch(HTML, /overflow-x:\s*scroll/, 'no horizontal page scroll');
    const c = await load(W5);
    A.deep(c.errors, []);
  }],

  // ---- v3.1: last-place budget ------------------------------------------------

  ['last place: with no hand-written rows, only one printed fact is about the last place', async () => {
    const c = await load(W5);
    const rules = c.T.facts(c.M).map(f => f.rule);
    A.ok(rules.indexOf('siempre') >= 0, 'Siempre ahí is a candidate');
    A.equal(rules.indexOf('sotano'), -1, 'and the sótano gap is only in the pizza box');
    const shown = all(c.doc, '#facts .fact, .cifra').filter(e => /Steel Man/.test(e.textContent));
    A.equal(shown.length, 1, 'one roast of the last place, got ' + shown.length);
    A.match(shown[0].textContent, /Siempre ahí/);
    A.equal(c.M.plan.used, true);
    A.deep(c.M.plan.protect, ['Steel Man']);
    common(c, 'budget');
  }],

  ['last place: a Columna paragraph naming him spends the budget (facts, clasificados and datos about him go away)', async () => {
    const d = clone(W5);
    d.tribune.portada = { titulo: 'Titular', texto: 'Bajada.', para: '' };
    d.tribune.columna = [{ titulo: '', para: '', texto: 'Steel Man sigue donde mismo.' }];
    d.tribune.clasificados = [{ titulo: 'SE VENDE', para: 'Steel Man', texto: 'Picks usados.' }, { titulo: 'SE BUSCA', para: 'Abogado', texto: 'Un amigo.' }];
    d.tribune.datos = [{ titulo: 'Sótano', para: '', texto: 'Steel Man otra vez.' }];
    const c = await load(d);
    A.match(text(c.doc, '#story'), /Steel Man sigue donde mismo/, 'the story is never cut');
    A.deep(all(c.doc, '#ads .ad strong').map(e => e.textContent), ['SE BUSCA'], 'the clasificado about him is hidden');
    const rest = all(c.doc, '#facts .fact, .cifra').map(e => e.textContent).join(' ');
    A.noMatch(rest, /Steel Man/, 'no dato and no automatic fact about him');
    A.equal(all(c.doc, '#facts .fact').length + all(c.doc, '.cifra').length >= 5, true, 'other candidates fill the slots');
    A.equal(c.doc.querySelector('.box.pizza .big').textContent, 'Steel Man', 'the Pizzas card is exempt');
    A.match(text(c.doc, '#prizes'), /Hoy pagaría las pizzas/);
    common(c, 'budget story');
  }],

  ['last place: no story mention means the first clasificado keeps the slot, later ones and datos are hidden', async () => {
    const d = clone(W5);
    d.tribune.clasificados = [{ titulo: 'UNO', para: '', texto: 'Para Steel Man.' }, { titulo: 'DOS', para: 'Steel Man', texto: 'Otra vez.' }, { titulo: 'TRES', para: 'Abogado', texto: 'Sin él.' }];
    d.tribune.datos = [{ titulo: 'D1', para: '', texto: 'Steel Man de nuevo.' }, { titulo: 'D2', para: '', texto: 'Abogado.' }];
    const c = await load(d);
    A.deep(all(c.doc, '#ads .ad strong').map(e => e.textContent), ['UNO', 'TRES']);
    const dat = all(c.doc, '#facts .fact strong').map(e => e.textContent);
    A.ok(dat.indexOf('D1') < 0 && dat.indexOf('D2') >= 0, 'the second mention is hidden, the clean dato stays');
    A.noMatch(all(c.doc, '#facts .fact, .cifra').map(e => e.textContent).join(' '), /Steel Man/, 'the facts leave him alone');
  }],

  ['last place: only datos name him, so a Dato takes the slot before the automatic facts', async () => {
    const d = clone(W5);
    d.tribune.datos = [{ titulo: 'D1', para: 'Steel Man', texto: 'Constante.' }];
    const c = await load(d);
    A.equal(all(c.doc, '#facts .fact strong')[0].textContent, 'D1');
    A.noMatch(all(c.doc, '#facts .fact:not(:first-child), .cifra').map(e => e.textContent).join(' '), /Steel Man/);
  }],

  ['last place: a tie for last protects both players and they share one slot', async () => {
    const d = make({ week: 3, weeksTotal: 3, names: ['Ana', 'Beto', 'Chuy', 'Dora', 'Eli'],
      weeks: { Ana: [80, 70, 60], Beto: [75, 70, 60], Chuy: [60, 60, 60], Dora: [50, 50, 50], Eli: [50, 50, 50] } });
    d.pickem.forEach(p => { p.total = p.weeks.reduce((a, b) => a + b, 0) - Math.min.apply(null, p.weeks); p.dropped = Math.min.apply(null, p.weeks); });
    d.tribune = { portada: null, columna: [], datos: [], clasificados: [{ titulo: 'A', para: 'Dora', texto: 'Uno.' }, { titulo: 'B', para: 'Eli', texto: 'Dos.' }, { titulo: 'C', para: 'Ana', texto: 'Tres.' }] };
    const c = await load(d);
    A.deep(c.T.protectNames(c.M).slice().sort(), ['Dora', 'Eli']);
    A.deep(all(c.doc, '#ads .ad strong').map(e => e.textContent), ['A', 'C'], 'Eli shares Dora\'s slot, so B is hidden');
    c.T.facts(c.M).forEach(f => lint(f.texto, f.rule));
    const sot = c.T.facts(c.M).filter(f => f.rule === 'sotano');
    A.ok(!sot.length || sot[0].sujetos.length === 2);
  }],

  ['last place: when the whole league is tied nobody is protected', async () => {
    const c = await load(make({ week: 2, names: ['Ana', 'Beto'], weeks: { Ana: [50, 50], Beto: [50, 50] } }));
    A.deep(c.T.protectNames(c.M), []);
  }],

  // ---- v3.1: names ------------------------------------------------------------

  ['names: apodos, curly and straight apostrophes, longest match, boundaries', async () => {
    const c = await load(W5);
    const T = c.T, idx = c.M.idx;
    const names = text => T.mentions(idx, text).map(m => m.name);
    A.deep(names('Kinky se fue y KINKYKING volvió'), ['KinkyKing', 'KinkyKing'], 'apodo and call sign, any case');
    A.deep(names('Los Osos de Grayslake son los Osos'), ['Osos de Grayslake', 'Osos de Grayslake']);
    A.deep(names('Andrea\'s Picks y Andrea’s Picks'), ['Andrea’s Picks', 'Andrea’s Picks'], 'straight and curly apostrophes are equal');
    A.deep(names('Kinkyness y Ososos'), [], 'whole words only');
    A.deep(names('El Comish hizo 50'), ['Silverback'], 'el Comish is an apodo of the commissioner');
    const i2 = T.nameIndex(['Manolito’s winning picks', 'Ana'], { Ana: ['Manolito'] });
    A.deep(T.mentions(i2, 'Manolito’s winning picks y Manolito').map(m => m.name), ['Manolito’s winning picks', 'Ana'], 'longest match first');
    A.deep(T.mentions(T.nameIndex(['Ana'], { Ana: ['Ana'] }), 'Ana').map(m => m.name), ['Ana']);
    A.deep(T.mentions(T.nameIndex([], {}), 'nada'), []);
  }],

  ['names: sheet text is escaped, mentions are bold, the reader gets .tuyo and keeps it after the panel closes', async () => {
    const d = clone(W5);
    d.tribune.portada = { titulo: 'Kinky titular', texto: 'Bajada con Kinky y <i>Abogado</i>.', para: '' };
    d.tribune.columna = [{ titulo: 'Sobre <b>Abogado</b>', para: '', texto: 'Kinky <script>alert(1)</script> y Silverback.' }];
    d.tribune.clasificados = [{ titulo: 'SE BUSCA', para: 'Abogado', texto: 'Kinky busca a Osos.' }];
    const c = await load(d);
    A.deep(c.errors, []);
    A.equal(all(c.doc, '#page script').length, 0, 'no markup from the sheet');
    A.equal(c.doc.querySelector('#story i, #p-deck i'), null, 'no raw html from the sheet');
    A.match(c.doc.querySelector('#p-deck').innerHTML, /&lt;i&gt;<b class="nombre" data-n="Abogado">Abogado<\/b>&lt;\/i&gt;/);
    A.equal(c.doc.querySelector('#p-head').querySelector('b'), null, 'the headline is not wrapped');
    A.deep(all(c.doc, '#story b.nombre').map(b => b.getAttribute('data-n')), ['Abogado', 'KinkyKing', 'Silverback'], 'crosshead and paragraph mentions');
    A.deep(all(c.doc, '#ads b.nombre').map(b => b.getAttribute('data-n')), ['Abogado', 'KinkyKing', 'Osos de Grayslake'], 'the Para line is bolded too');
    A.equal(all(c.doc, 'b.nombre.tuyo').length, 0, 'nobody selected, nobody highlighted');
    const c2 = await load(d, { url: '?yo=KinkyKing' });
    const mine = all(c2.doc, 'b.nombre.tuyo');
    A.ok(mine.length >= 3, 'every mention of the reader');
    mine.forEach(b => A.equal(b.getAttribute('data-n'), 'KinkyKing'));
    A.equal(all(c2.doc, 'b.nombre').filter(b => !b.classList.contains('tuyo') && b.getAttribute('data-n') === 'KinkyKing').length, 0);
    c2.doc.querySelector('#close').click();
    A.equal(c2.doc.querySelector('#sheet').hidden, true);
    A.ok(all(c2.doc, 'b.nombre.tuyo').length >= 3, 'still highlighted with the panel closed');
    const sel = c2.doc.querySelector('#pick'); sel.value = 'Abogado'; sel.dispatchEvent(new c2.win.Event('change'));
    A.deep(all(c2.doc, 'b.nombre.tuyo').map(b => b.getAttribute('data-n')).filter((v, i, a) => a.indexOf(v) === i), ['Abogado'], 'picking another name moves the highlight');
    A.match(HTML, /b\.nombre\.tuyo\{color:var\(--red\)/);
  }],

  // ---- v3.1: the Portada story ------------------------------------------------

  ['portada story: headline, deck, byline, then the Columna rows, and no Columna section', async () => {
    const d = clone(W5);
    d.tribune.portada = { titulo: 'Titular', texto: 'Bajada.', para: '' };
    d.tribune.columna = [
      { titulo: '', para: '', texto: 'Primero.' },
      { titulo: 'La cuenta', para: '', texto: 'Segundo.' },
      { titulo: '', para: '', texto: 'Un verso\ncon dos líneas / y una tercera' },
      { titulo: '', para: '', texto: 'Último.' }];
    const c = await load(d);
    const sec = c.doc.querySelector('#portada');
    const order = ['.kicker', '#p-head', '#p-deck', '#p-by', '#story'].map(s => sec.querySelector(s));
    order.forEach((e, i) => { A.ok(e, 'part ' + i); if (i) A.ok(order[i - 1].compareDocumentPosition(e) & 4, 'in order ' + i); });
    A.equal(c.doc.querySelector('#columna'), null, 'no standalone Columna section');
    A.equal(all(c.doc, '.sec').filter(e => /Columna/.test(e.textContent)).length, 0);
    const ps = all(c.doc, '#story p');
    A.equal(ps.length, 4);
    A.equal(all(c.doc, '#story p.dc').length, 1, 'one drop cap');
    A.ok(ps[0].classList.contains('dc'), 'on the first paragraph');
    A.equal(c.doc.querySelector('#story .cross').textContent, 'La cuenta');
    A.ok(c.doc.querySelector('#story .cross').nextElementSibling === ps[1], 'the crosshead sits above its paragraph');
    A.ok(ps[2].classList.contains('verse'), 'a paragraph with breaks is verse');
    A.equal(ps[2].querySelectorAll('br').length, 2, 'a newline and " / " both break the line');
    A.equal(ps[2].classList.contains('dc'), false, 'no drop cap on verse');
    A.match(ps[3].textContent, /Último\.■$/, 'end mark after the last paragraph');
    A.equal(all(c.doc, '#story .end').length, 1);
    A.match(HTML, /\.story p\.verse\{text-align:left/, 'verse is left aligned, the rest justified');
    A.match(HTML, /\.story p\{[^}]*text-align:justify/);
    A.match(HTML, /\.story \.cross\{[^}]*font-variant-caps:all-small-caps[^}]*color:var\(--accent\)/, 'crosshead in small caps with the accent color');
    common(c, 'story');
  }],

  ['portada story: a verse first paragraph has no drop cap, and the fallbacks hold', async () => {
    const d = clone(W5);
    d.tribune.columna = [{ titulo: '', para: '', texto: 'Rosas son\nviolas son' }, { titulo: '', para: '', texto: 'Normal.' }];
    const c = await load(d);
    A.equal(all(c.doc, '#story p.dc').length, 0);
    const noPortada = clone(W5);
    noPortada.tribune.portada = null;
    const c2 = await load(noPortada);
    A.equal(text(c2.doc, '#p-head'), 'Del sótano a la azotea', 'automatic headline');
    A.equal(all(c2.doc, '#story p').length, 3, 'the Columna rows still form the body');
    const noColumna = clone(W5);
    noColumna.tribune.portada = { titulo: 'Solo titular', texto: 'Y bajada.', para: '' };
    noColumna.tribune.columna = [];
    const c3 = await load(noColumna);
    A.equal(text(c3.doc, '#p-head'), 'Solo titular');
    A.equal(c3.doc.querySelector('#story').children.length, 0, 'headline and deck only');
    common(c2, 'no portada'); common(c3, 'no columna');
  }],

  // ---- v3.1: esquelas ---------------------------------------------------------

  ['esquelas: Q.E.P.D. in any spelling gets the frame, the cross and Para in Playfair', async () => {
    const d = clone(W5);
    d.tribune.clasificados = [
      { titulo: 'Q.E.P.D.', para: 'Andrea’s Picks', texto: 'Sus picks de Survivor.' },
      { titulo: 'qepd', para: 'KinkyKing', texto: 'Su racha.' },
      { titulo: 'SE VENDE', para: 'Abogado', texto: 'Un lugar.' }];
    const c = await load(d);
    const esq = all(c.doc, '#ads .ad.esq');
    A.equal(esq.length, 2);
    esq.forEach(e => { A.equal(e.querySelector('.cruz').textContent, '✝'); A.ok(e.querySelector('.who'), 'Para is shown'); });
    A.match(esq[0].querySelector('.who').textContent, /Andrea’s Picks/);
    A.equal(c.doc.querySelectorAll('#ads .ad:not(.esq)').length, 1);
    A.match(HTML, /\.ad\.esq\{border:2px solid var\(--ink\)[^}]*text-align:center/);
    A.match(HTML, /\.ad\.esq \.who\{[^}]*var\(--head\)/);
    ['Q.E.P.D.', 'QEPD', 'q.e.p.d', 'Q E P D'].forEach(t => A.equal(c.T.isEsquela(t), true, t));
    A.equal(c.T.isEsquela('QEPDX'), false);
  }],

  // ---- v3.1.1: Para on every ad ------------------------------------------------

  ['clasificados: every ad shows who it is for, bolded, esquela or not, and a blank Para shows no line', async () => {
    const calls = c => c.M.players.map(p => p.name);
    const c = await load(W5);
    const ads = all(c.doc, '#ads .ad');
    A.equal(ads.length, W5.tribune.clasificados.length, 'all three week 5 ads render');
    W5.tribune.clasificados.forEach((x, i) => {
      const who = ads[i].querySelector('.who');
      A.ok(who, 'ad "' + x.titulo + '" shows its Para');
      x.para.split(',').map(t => t.trim()).forEach(n => {
        A.ok(who.textContent.indexOf(n) >= 0, n + ' is in the .who line');
        if (calls(c).indexOf(n) >= 0) A.ok(Array.from(who.querySelectorAll('b.nombre')).some(b => b.textContent === n), n + ' is bolded');
      });
      A.equal(ads[i].querySelector('strong').nextElementSibling, who, 'Título, then the .who line');
      A.equal(who.nextElementSibling.tagName, 'P', 'then the texto in a paragraph');
    });
    A.equal(ads[0].querySelectorAll('.who b.nombre').length, 3, 'several names, all bolded');
    const d = clone(W5);
    d.tribune.clasificados = [
      { titulo: 'Q.E.P.D.', para: 'Andrea’s Picks', texto: 'Sus picks.' },
      { titulo: 'SE VENDE', para: 'Abogado, KinkyKing', texto: 'Un lugar.' },
      { titulo: 'AVISO', para: '', texto: 'Para todos.' }];
    const c2 = await load(d);
    const a2 = all(c2.doc, '#ads .ad');
    A.ok(a2[0].classList.contains('esq') && a2[0].querySelector('.who'), 'esquela keeps its .who');
    A.equal(a2[1].querySelectorAll('.who b.nombre').length, 2);
    A.equal(a2[2].querySelector('.who'), null, 'blank Para, no line');
    A.equal(a2[2].querySelector('p').textContent, 'Para todos.');
    A.match(HTML, /\.ad \.who\{[^}]*14px/, 'the ad .who rule');
    A.match(HTML, /\.ad\.esq \.who\{[^}]*var\(--head\)/, 'the esquela rule is kept');
  }],

  // ---- v3.1: special editions -------------------------------------------------

  ['edición: banner, tagline and the muertos theme', async () => {
    const d = clone(W5);
    d.tribune.edicion = { titulo: 'Edición de Día de Muertos', texto: 'Los que se fueron de Survivor, presentes.', tema: 'muertos' };
    const c = await load(d);
    A.equal(c.doc.querySelector('#edicion').hidden, false);
    A.equal(text(c.doc, '#edicion'), 'Edición de Día de Muertos');
    A.equal(text(c.doc, '#tag'), 'Los que se fueron de Survivor, presentes.');
    A.equal(c.doc.documentElement.getAttribute('data-tema'), 'muertos');
    A.equal(c.doc.querySelector('#papel').hidden, false, 'papel picado strip');
    const mast = c.doc.querySelector('.mast'), papel = c.doc.querySelector('#papel'), ban = c.doc.querySelector('#edicion'), tag = c.doc.querySelector('#tag');
    A.ok((mast.compareDocumentPosition(papel) & 4) && (papel.compareDocumentPosition(ban) & 4) && (ban.compareDocumentPosition(tag) & 4), 'masthead, strip, banner, tagline');
    A.match(HTML, /html\[data-tema="muertos"\]\{--accent:var\(--marigold\)\}/, 'the theme overrides only the accent token');
    A.match(HTML, /\.edicion\{[^}]*text-transform:uppercase[^}]*color:var\(--accent\)/);
    A.noMatch(HTML, /\.bl\.sel[^}]*--accent|tok\("accent"\)/, 'the chart keeps its own colors');
    const plain = await load(W5);
    A.equal(plain.doc.documentElement.getAttribute('data-tema'), null, 'a normal edition stays plain');
    A.equal(plain.doc.querySelector('#edicion').hidden, true);
    A.equal(plain.doc.querySelector('#papel').hidden, true);
    common(c, 'muertos');
  }],

  ['edición: an unknown tema is ignored, a banner without Texto keeps the tagline', async () => {
    const d = clone(W5);
    d.tribune.edicion = { titulo: 'Edición rara', texto: '', tema: 'navidad' };
    const c = await load(d);
    A.equal(c.doc.documentElement.getAttribute('data-tema'), null);
    A.equal(c.doc.querySelector('#papel').hidden, true);
    A.equal(text(c.doc, '#edicion'), 'Edición rara');
    A.match(text(c.doc, '#tag'), /La quiniela más grande del mundo/);
    A.deep(c.errors, []);
  }],

  ['edición: ?ed=N applies that edition\'s theme while the current edition stays plain', async () => {
    const old = clone(W5); old.week = 4; old.pickem.forEach(p => { p.weeks = p.weeks.slice(0, 4); });
    old.tribune.edicion = { titulo: 'Muertos', texto: '', tema: 'muertos' };
    const cur = clone(W5);
    const a = await load(cur, { url: '?ed=4', editions: { 4: old }, index: { weeks: [4, 5] } });
    A.equal(a.doc.documentElement.getAttribute('data-tema'), 'muertos', 'the archived edition keeps its theme');
    const b = await load(cur, { editions: { 4: old }, index: { weeks: [4, 5] } });
    A.equal(b.doc.documentElement.getAttribute('data-tema'), null, 'the current edition is plain');
  }],

  ['old data.json without apodos, titulo or edicion still renders', async () => {
    const d = clone(W5); delete d.apodos; delete d.tribune.edicion; d.tribune.columna.forEach(c => { delete c.titulo; });
    const c = await load(d);
    common(c, 'no new fields');
    A.equal(all(c.doc, '#story p').length, 3);
    A.equal(c.doc.querySelector('#edicion').hidden, true);
  }],

  ['the page has no Claude API call and no Google or GitHub access', async () => {
    A.noMatch(HTML, /anthropic|api\.openai|script\.google|api\.github|googleusercontent/i);
  }],

  // ---- v3.2: pick-level facts and "Tus picks" ------------------------------------

  ['week 5 with picks: the pick facts run, stay short and follow the copy rules', async () => {
    const c = await load(P5());
    common(c, 'week 5 with picks');
    const picks = c.M.pk.all.filter(f => PICK_RULES.indexOf(f.rule) >= 0);
    A.ok(picks.length >= 5, 'several pick rules fire on week 5');
    picks.forEach(f => { lint(f.texto + ' ' + f.titulo, f.rule); A.ok(f.texto.length <= 140, f.rule + ' is ' + f.texto.length + ' characters'); });
    A.equal(c.M.pk.picks.length, 6, 'still 6 facts');
    const fact = r => c.M.pk.all.filter(f => f.rule === r)[0];
    A.equal(fact('llanero'), undefined, 'week 5: no side picked by 1 or 2 covered');
    A.equal(fact('empate'), undefined, 'no pushes in week 5');
    Object.keys(c.T.TPL).filter(k => /^(lealtad|mismo|costal|llanero|borregada|empate|olvido|rachaPicks|fuertes|perros|corriente)/.test(k))
      .forEach(k => c.T.TPL[k].forEach(t => lint(t.replace(/\{\w+\}/g, 'x'), 'TPL.' + k)));
  }],

  ['Costalazo week 5: 10 players lost a 15 and LAR sank 4 of them', async () => {
    const c = await load(P5());
    const f = c.M.pk.all.filter(x => x.rule === 'costalazo')[0];
    A.equal(f.data.conf, 15);
    A.equal(f.data.total, 10);
    A.equal(f.data.team, 'LAR');
    A.deep(f.data.names.slice().sort(), ['Niners', 'Osos de Grayslake', 'Steel Man', 'X-Men Let’s go Boys']);
    A.deep(f.sujetos, [], 'four players are not named, so the last place budget is untouched');
    A.match(f.texto, /4 jugadores le pusieron su 15 a los Rams/);
    A.match(f.texto, /10 perdieron un 15/);
  }],

  ['Borregada week 5: Cle picked by 16 of 21, NYJ covered', async () => {
    const c = await load(P5());
    const f = c.M.pk.all.filter(x => x.rule === 'borregada')[0];
    A.equal(f.data.team, 'CLE');
    A.equal(f.data.k, 16);
    A.equal(f.data.total, 21);
    A.equal(f.data.covered, 'NYJ');
    A.equal(f.valor, '16/21');
  }],

  ['Llanero solitario: a side with 1 or 2 pickers that covered, and not the lone NO pick that lost', async () => {
    const d = P5();
    const c = await load(d);
    A.equal(c.M.pk.all.filter(x => x.rule === 'llanero').length, 0, 'the lone NO pick by Niners lost');
    const flipped = clone(d);
    flipped.picks['5'].g[6][3] = 'U';                       // NO covers after all
    const c2 = await load(flipped);
    const f = c2.M.pk.all.filter(x => x.rule === 'llanero')[0];
    A.ok(f, 'now it fires');
    A.deep(f.data.names, ['Niners']);
    A.equal(f.data.team, 'NO');
    A.deep(f.sujetos, ['Niners']);
  }],

  ['Empate: points lost to a push', async () => {
    const d = P5();
    d.picks['5'].g[6][3] = 'P';
    const c = await load(d);
    const f = c.M.pk.all.filter(x => x.rule === 'empate')[0];
    A.ok(f, 'fires when a game pushes');
    A.equal(f.data.picks, 22, 'everyone had a pick on it');
    lint(f.texto, 'empate');
  }],

  ['Se le olvidó: the empty cells and what they were worth', async () => {
    const c = await load(P5());
    const f = c.M.pk.all.filter(x => x.rule === 'olvido')[0];
    A.deep(f.data.names.slice().sort(), ['Andrea’s Picks', 'Niners']);
    A.equal(f.data.left, 8, 'Niners had the 1 left over, Andrea the 7');
    A.match(f.texto, /hasta 8 puntos/);
  }],

  ['Racha de picks: correct picks in a row, in kickoff order', async () => {
    const c = await load(P5());
    const f = c.M.pk.all.filter(x => x.rule === 'rachapicks')[0];
    A.equal(f.data.run, 6);
    A.match(f.texto, /seis picks seguidos|Racha de seis aciertos/);
  }],

  ['Lealtad is about fan bases of 2 or more, never one player, and skips Jorge_B and the Suiza players', async () => {
    const c = await load(FULL);
    const f = c.M.pk.all.filter(x => x.rule === 'lealtad')[0];
    A.ok(f, 'fires with fan teams');
    A.deep([f.data.team, f.data.fans, f.data.net, f.data.kind], ['CHI', 7, 79, 'for'], 'the Bears fans won 79 picking for their team');
    A.deep(f.sujetos, [], 'it names the team, not a player');
    A.deep(f.alts.map(a => a.data.team), ['SF', 'PIT'], 'and keeps the next fan bases as alternates');
    A.noMatch(f.texto, /KinkyKing|Packers/, 'one fan (the Packers) is never a fan base');
    const d = clone(FULL);
    d.fans = { 'Jorge_B': { random: true, other: 'League of Legends' } };      // everybody else is Suiza
    const c2 = await load(d);
    A.equal(c2.M.pk.all.filter(x => x.rule === 'lealtad').length, 0, 'random and Suiza never qualify');
    const d2 = clone(FULL);
    Object.keys(d2.fans).forEach(n => { if (d2.fans[n].nfl !== 'CHI' && n !== 'Jorge_B') delete d2.fans[n]; });
    const c3 = await load(d2);
    A.deep(c3.M.pk.all.filter(x => x.rule === 'lealtad').map(x => x.data.team), ['CHI'], 'only the seven Bears fans make a fan base');
  }],

  ['Mismo equipo, Amante de los perros and Contra la corriente behave on a second week', async () => {
    const d = P5();
    const w4 = clone(d.picks['5']);                           // week 4 is the same table, so every pick repeats
    d.picks['4'] = w4;
    const c = await load(d);
    const same = c.M.pk.all.filter(x => x.rule === 'mismoequipo')[0];
    A.ok(same, 'the same team in weeks 4 and 5');
    A.equal(same.data.weeks, 2);
    lint(same.texto, 'mismoequipo');
    A.equal(c.M.pk.all.filter(x => x.rule === 'perros').length, 0, 'a tie at the top share names nobody');
    const live = await load(FULL);
    const dog = live.M.pk.all.filter(x => x.rule === 'perros')[0];
    A.deep([dog.data.name, dog.data.gap], ['Niners', 6], 'Niners 51% of underdogs against 46%, named with the gap and never the share');
    A.noMatch(dog.texto, /%|51|28/, 'no share or hits printed');
    A.ok(c.M.pk.all.filter(x => x.rule === 'corriente')[0], 'against the grain');
    const t = truncate(d, 4);
    A.deep(Object.keys(t.picks), ['4'], 'the league as it stood in week 4 has no week 5 picks');
  }],

  ['Tus picks, Silverback with week 5 only', async () => {
    const c = await load(P5());
    const lines = c.T.tusPicks(c.M, 'Silverback');
    A.equal(lines.length, 4);
    A.match(lines[0].t, /^1 de 3/, 'top 3: GB 15 covered, LAR 14 and Cle 13 did not');
    A.match(lines[1].t, /9 de tus 15 picks fueron underdogs y pegaron 4\. Con favoritos, 2 de 6\./);
    A.match(lines[2].t, /Packers te dieron más puntos \(\+15\)/);
    A.match(lines[2].t, /Rams te costaron más \(−14\)/);
    A.match(lines[3].t, /Con los Steelers: 1 de 1, \+7 puntos\. Contra ellos: nunca\./);
    lines.forEach(l => lint(l.k + ' ' + l.t, 'tus picks'));
    c.M.openSheet('Silverback', false);
    A.equal(c.doc.querySelector('#pkbox').hidden, false);
    A.deep(all(c.doc, '#panel .sub').map(s => s.textContent), ['Subidas y bajadas', 'Tus picks', 'Survivor: strikes']);
    A.equal(all(c.doc, '#pkbox p.pk').length, 4);
    A.ok(c.doc.querySelector('#bumpbox').compareDocumentPosition(c.doc.querySelector('#pkbox')) & 4, 'between the chart');
    A.ok(c.doc.querySelector('#pkbox').compareDocumentPosition(c.doc.querySelector('#svbox')) & 4, 'and the strikes');
    A.deep(c.errors, []);
  }],

  ['Tus picks: no team line for Jorge_B or a Suiza player, an arrow when the last 3 weeks differ from the season', async () => {
    const c = await load(P5());
    A.equal(c.T.tusPicks(c.M, 'Jorge_B').length, 3, 'no Tu equipo for the player who picks at random');
    A.ok(c.T.tusPicks(c.M, 'Silverback').some(l => l.k === 'Tu equipo'));
    const d = P5();
    delete d.fans['Silverback'];
    const c2 = await load(d);
    A.equal(c2.T.tusPicks(c2.M, 'Silverback').length, 3, 'a Suiza player has no team line');
    // five weeks of the same table, with week 1 flipped (Silverback's top 3 hit 2 of 3 there, 1 of 3 elsewhere)
    const d3 = P5();
    const real = d3.picks['5'];
    [1, 2, 3, 4].forEach(w => { d3.picks[String(w)] = clone(real); });
    d3.picks['1'].g.forEach(g => { g[3] = g[3] === 'F' ? 'U' : 'F'; });
    const c3 = await load(d3);
    const l = c3.T.tusPicks(c3.M, 'Silverback')[0];
    A.match(l.t, /en la temporada\. .* en las últimas 3 semanas\./);
    A.equal(l.a, '', 'the last 3 weeks trail the season by less than 10 points, so no arrow');
    const live = await load(FULL);
    A.equal(live.T.tusPicks(live.M, 'Steel Man')[0].a, '', 'Steel Man went from 1 of 15 to 1 of 9: no arrow');
    A.equal(live.T.tusPicks(live.M, 'Abogado')[0].a, 'up', 'Abogado went from 7 of 15 (47%) to 7 of 9 (78%)');
  }],

  ['Tus picks is hidden without picks, and the panel looks as it does today', async () => {
    const c = await load(W5);
    c.M.openSheet('Silverback', false);
    A.equal(c.doc.querySelector('#pkbox').hidden, true);
    A.equal(c.doc.querySelector('#pkbox').innerHTML, '');
    A.deep(all(c.doc, '#panel .sub').map(s => s.textContent), ['Subidas y bajadas', 'Survivor: strikes'], 'only the chart and the strikes');
    const d = P5();
    Object.keys(d.picks['5'].g).forEach(i => { d.picks['5'].g[i][3] = null; });          // picks without results
    const c2 = await load(d);
    c2.M.openSheet('Silverback', false);
    A.equal(c2.doc.querySelector('#pkbox').hidden, true, 'no week with results, no block');
    A.equal(c2.M.pk.all.filter(f => PICK_RULES.indexOf(f.rule) >= 0).length, 0, 'and no pick facts');
    A.deep(c2.errors, []);
  }],

  ['picks with an unknown call sign or a malformed week do not break the page', async () => {
    const d = P5();
    d.picks['5'].p['Fantasma'] = d.picks['5'].p['Abogado'];
    d.picks['9'] = { g: [], p: {} };
    d.picks['x'] = null;
    const c = await load(d);
    common(c, 'odd picks');
    A.equal(c.M.pk.picks.length, 6);
  }],

  ['Yahoo is canon for the weekly winner: a tie follows its green mark, an unmarked tie splits', async () => {
    const d = clone(W5);
    d.pickem.find(p => p.name === 'Cyber70').weeks[4] = 94;               // ties Abogado at the top of week 5
    const split = await load(d);
    A.deep(split.M.weekly[4].winners.slice().sort(), ['Abogado', 'Cyber70'], 'no mark, both share');
    A.equal(split.doc.querySelectorAll('#prizes .g.tie').length, 1, 'and the tile shows the tie');
    d.winners = [[], [], [], [], ['Cyber70']];
    const one = await load(d);
    A.deep(one.M.weekly[4].winners, ['Cyber70'], 'Yahoo broke the tie');
    A.equal(one.doc.querySelectorAll('#prizes .g.tie').length, 0);
    A.equal(one.M.paid['Cyber70'] - split.M.paid['Cyber70'], 25, 'the $50 is no longer split');
    A.equal(truncate(d, 4).winners.length, 4, 'the league as it stood in week 4');
    d.winners = [[], [], [], [], ['Nadie']];
    const bad = await load(d);
    A.deep(bad.M.weekly[4].winners.slice().sort(), ['Abogado', 'Cyber70'], 'an unknown name is ignored');
    A.deep(bad.errors, []);
  }],

  // ---- v4.0: the playoff phase ------------------------------------------------------------

  ['playoffs: week 20 is a playoff edition with its own card, portada and facts, and the regular season stays closed', async () => {
    const d = P5();
    d.week = 20; d.regularWeek = 5;
    const names = d.pickem.map(p => p.name);
    d.playoffs = { week: 20, rounds: 2, winners: [['Silverback'], []],
      pickem: names.map((n, i) => ({ name: n, weeks: [60 + (i % 7) * 3 + (n === 'Silverback' ? 20 : 0), 50 + (i % 5) * 4], total: 0 })) };
    d.playoffs.pickem.forEach(p => { p.total = p.weeks[0] + p.weeks[1]; });
    const c = await load(d);
    common(c, 'playoffs');
    A.equal(c.M.N, 5, 'the regular league stays at its last week');
    A.equal(c.M.EW, 20);
    A.match(text(c.doc, '#dateline'), /Edición 20, playoffs/);
    A.match(text(c.doc, '#p-head'), /Playoffs: ronda 2 de 4/);
    A.match(text(c.doc, '#p-deck'), /lidera con \d+ puntos, a \d+ del segundo\. Solo paga el primero\./);
    const box = all(c.doc, '#prizes .box').filter(b => /Quiniela de playoffs/.test(b.textContent))[0];
    A.ok(box, 'playoff card');
    A.match(box.textContent, /en juego/);
    A.equal(all(box, '.pzr').length, 5, 'top five');
    A.match(box.textContent, /Ronda 2 de 4\. Solo paga primer lugar\./);
    A.match(box.textContent, /Wild Card: Silverback/, 'round winners come from Yahoo');
    const rules = c.M.pk.all.map(f => f.rule);
    A.ok(rules.indexOf('playoffs') >= 0 && rules.indexOf('poronda') >= 0, 'playoff facts');
    ['rebote', 'racha', 'remontada', 'siempre', 'sotano', 'aficiones'].forEach(r => A.equal(rules.indexOf(r), -1, r + ' is a regular-season fact'));
    c.M.pk.all.forEach(f => lint(f.texto, f.rule));
    A.equal(c.M.pk.picks.length <= 6, true);
    // the money: nothing is paid until round 4
    const ppl = c.M.paid;
    A.equal(ppl['Silverback'], c.T.model(Object.assign({}, d, { playoffs: undefined, week: 5 })).paid['Silverback'], 'no playoff money yet');
    A.deep(c.errors, []);
  }],

  ['playoffs: round 4 pays the winner, a tie splits the 700, and the archive banner says playoffs', async () => {
    const d = P5();
    d.week = 22; d.regularWeek = 5;
    const names = d.pickem.map(p => p.name);
    const mk = (a, b) => ({ name: a, weeks: [b, b, b, b], total: b * 4 });
    d.playoffs = { week: 22, rounds: 4, winners: [[], [], [], []], pickem: names.map((n, i) => mk(n, n === 'Cyber70' ? 100 : 40 + (i % 9))) };
    const c = await load(d, { url: '?ed=22', editions: { 22: d }, index: { weeks: [20, 22] } });
    common(c, 'playoffs final');
    const box = all(c.doc, '#prizes .box').filter(b => /Quiniela de playoffs/.test(b.textContent))[0];
    A.match(box.textContent, /final/);
    A.match(box.textContent, /\$700/);
    A.match(box.textContent, /Terminó\. Solo paga primer lugar\./);
    A.match(text(c.doc, '#p-head'), /Se acabó la temporada/);
    A.match(text(c.doc, '#banner'), /Edición 22, playoffs, archivo/);
    const champ = c.M.pk.all.filter(f => f.rule === 'playoffs')[0];
    A.ok(champ && /Cyber70/.test(champ.texto) && /\$700/.test(champ.texto), 'champion fact: ' + (champ && champ.texto));
    A.ok(champ.tpls.length >= 4, 'with the same styled templates');
    const solo = c.T.model(d);
    A.equal(solo.paid['Cyber70'] - c.T.model(Object.assign({}, d, { playoffs: undefined, week: 5 })).paid['Cyber70'], 700);
    const t = clone(d);
    t.playoffs.pickem.find(p => p.name === 'Abogado').weeks = [100, 100, 100, 100];
    t.playoffs.pickem.find(p => p.name === 'Abogado').total = 400;
    const m2 = c.T.model(t);
    A.deep(m2.po.leaders.slice().sort(), ['Abogado', 'Cyber70']);
    A.equal(m2.paid['Cyber70'] - c.T.model(Object.assign({}, d, { playoffs: undefined, week: 5 })).paid['Cyber70'], 350, 'a tie splits it');
  }],

  ['playoffs: the old hook (playoffs.pickem with only totals) still shows the leader, the truncate helper rebuilds earlier editions', async () => {
    const d = clone(W5);
    d.playoffs = { pickem: [{ name: 'Abogado', total: 55 }, { name: 'Silverback', total: 40 }] };
    const c = await load(d);
    const box = all(c.doc, '#prizes .box').filter(b => /Quiniela de playoffs/.test(b.textContent))[0];
    A.match(box.textContent, /1º.*Abogado, 55/);
    const p = P5();
    p.week = 21; p.regularWeek = 5;
    p.playoffs = { week: 21, rounds: 3, winners: [[], [], []], pickem: p.pickem.map(q => ({ name: q.name, weeks: [10, 20, 30], total: 60 })) };
    const t19 = truncate(p, 19);
    A.equal(t19.playoffs.rounds, 1);
    A.deep(t19.playoffs.pickem[0].weeks, [10]);
    A.equal(t19.playoffs.pickem[0].total, 10);
    A.equal(truncate(p, 18).playoffs, undefined, 'at week 18 the playoffs have not started');
    A.equal('regularWeek' in truncate(p, 17), false);
    const m = c.T.model(p);
    A.deep(c.T.prevRules(m), [], 'no archive, nothing held out');
    m.prevD = truncate(p, 20);
    A.ok(Array.isArray(c.T.prevRules(m)), 'the no-repeat rule runs on the archived previous round');
  }],

  // ---- v4.1: Datos que nadie pidió ---------------------------------------------------------------------

  ['datos: the live week 5 Tribune owns Fotocopia, so neither it nor La cifra repeats it, and it returns without that Clasificado', async () => {
    const c = await load(FULL);
    A.ok(c.M.pk.picks.every(f => f.rule !== 'fotocopia'), 'Fotocopia is not printed');
    A.ok(c.M.pk.cifra && c.M.pk.cifra.rule !== 'fotocopia', 'and it is not La cifra');
    // With no archive of week 4 nothing is held out and Fotocopia never reaches the front of the line,
    // so the drop is checked with the six rules of the week 5 page sent to the back, as in week 6.
    const ran = ['rebote', 'polos', 'cuervos', 'acomodador', 'nunca', 'racha'];
    const pr = c.T.printed(c.M);
    const dr = c.T.pickFacts(c.M, ran, pr.used, pr.rows).dropped.filter(x => x.rule === 'fotocopia')[0];
    A.ok(dr, 'T.pickFacts lists the dropped fact');
    A.match(dr.por, /Clasificado "Fotocopia": nombra a Osos de Grayslake, Mean Machine y Jorge_B y trae 281/);
    const d = clone(FULL);
    d.tribune.clasificados = d.tribune.clasificados.filter(x => x.titulo !== 'Fotocopia');
    const c2 = await load(d);
    A.ok(c2.M.pk.all.some(f => f.rule === 'fotocopia'), 'it is a candidate again');
    const pr2 = c2.T.printed(c2.M), r2 = c2.T.pickFacts(c2.M, ran, pr2.used, pr2.rows);
    A.ok(!r2.dropped.some(x => x.rule === 'fotocopia'), 'and nothing drops it');
    A.ok(r2.picks.some(f => f.rule === 'fotocopia'), 'it prints once the six that ran go to the back');
  }],

  ['datos: aficiones and sótano never print, and nobody prints a number their own Tus picks lines show', async () => {
    const seen = {};
    for (const k of [1, 2, 3, 4, 5]) {
      const c = await load(await weekAt(k));
      const M = c.M;
      const pk = c.M.pk;
      pk.picks.forEach(f => {
        seen[f.rule] = 1;
        A.ok(['aficiones', 'sotano'].indexOf(f.rule) < 0, f.rule + ' is retired from Datos');
        A.noMatch(f.texto, /−34/, 'KinkyKing Packers 1 of 5 stays out of Datos');
        const h = f.huella;
        if (h && h.nombres.length === 1) {
          const lines = c.T.tusPicks(M, h.nombres[0]) || [];
          const nums = {};
          lines.forEach(l => (l.k + ' ' + l.t).replace(/semanas? \d+/g, '').split(/\D+/).filter(Boolean).forEach(x => { nums[x] = 1; }));
          h.numeros.forEach(x => A.ok(!nums[x], 'week ' + k + ' ' + f.rule + ' prints ' + x + ' that ' + h.nombres[0] + ' sees in Tus picks'));
        }
      });
    }
    A.ok(Object.keys(seen).length >= 8, 'a variety of rules printed across the weeks');
    const c5 = await load(FULL);
    A.noMatch(c5.doc.querySelector('#datos').textContent, /−34/);
  }],

  ['styles: every printed fact has an estilo, quotas hold for weeks 1 to 5, no albur on Andrea or Juan1768', async () => {
    for (const k of [1, 2, 3, 4, 5]) {
      const c = await load(await weekAt(k));
      const used = {};
      c.M.pk.picks.forEach(f => {
        A.ok(f.estilo, 'week ' + k + ' ' + f.rule + ' has an estilo');
        used[f.estilo] = (used[f.estilo] || 0) + 1;
        if (f.estilo === 'albur') A.noMatch(f.texto + ' ' + f.sujetos.join(' '), /Andrea’s Picks|Juan1768/, 'no albur on them');
        lint(f.texto, 'week ' + k + ' ' + f.rule);
        A.ok(f.texto.length <= 125 || f.estilo === 'calaverita', f.rule + ' week ' + k + ' is ' + f.texto.length + ': ' + f.texto);
      });
      A.ok((used.carrilla || 0) <= 2 && (used.albur || 0) <= 2, 'week ' + k + ' carrilla and albur quotas: ' + JSON.stringify(used));
      Object.keys(used).filter(x => x !== 'carrilla' && x !== 'albur').forEach(x => A.ok(used[x] <= 1, 'week ' + k + ' ' + x + ' once: ' + JSON.stringify(used)));
      A.equal(used.calaverita || 0, 0, 'no calaveritas outside muertos');
      const shown = all(c.doc, '#datos [data-estilo]').map(e => e.getAttribute('data-estilo'));
      A.equal(shown.length, c.M.pk.picks.filter(f => c.M.pk.cifra === f || c.M.pk.list.indexOf(f) >= 0).length, 'each rendered fact carries data-estilo');
      A.equal(all(c.doc, '#datos .est, #datos .estilo').length, 0, 'and no visible label');
    }
  }],

  ['styles: apodo only when a named player has one, and it uses it', async () => {
    const d = clone(FULL);
    const c = await load(d);
    const f = c.T.facts(c.M).filter(x => x.rule === 'rebote')[0];                // KinkyKing, apodo Kinky
    const ap = f.tpls.filter(t => t.s === 'apodo')[0];
    A.ok(ap, 'rebote has an apodo template');
    A.match(c.T.assignStyles(c.M, [Object.assign({}, f, { tpls: [ap] })])[0].texto, /^Kinky /, 'it names the apodo');
    A.equal(c.T.FT.costalazo1.filter(t => t.s === 'apodo').length, 1, 'single-player groups carry an apodo template');
    const noApodo = clone(FULL); noApodo.apodos = {};
    const c2 = await load(noApodo);
    c2.M.pk.picks.forEach(x => A.ok(x.estilo !== 'apodo', 'no apodo style without apodos'));
  }],

  ['rules 26 to 30 return the week 5 values', async () => {
    const c = await load(FULL);
    const f = {}; c.M.pk.all.forEach(x => { f[x.rule] = x; });
    A.deep([f.nunca.data.name, f.nunca.data.hits, f.nunca.data.hitsRank, f.nunca.data.pointsRank, f.nunca.data.gap], ['MVP21', 10, 2, 8, 6], 'MVP21 10 hits 2nd, 71 points 8th, gap 6 beats the tie with Steel Man and Juan1768');
    A.deep(f.orden.data.names.slice().sort(), ['Manolito’s winning picks', 'Puto el que lo lea'], 'same 15 games');
    A.deep([f.orden.data.games, f.orden.data.gap], [15, 14]);
    A.match(f.orden.texto, /14 puntos/);
    A.deep([f.polos.data.name, f.polos.data.agree, f.polos.data.both, f.polos.data.others], ['Niners', 2, 14, 3], 'Niners agreed on 2 of 14 with three players');
    A.deep([f.cuervos.data.team, f.cuervos.data.conf], ['GB', 572], 'the Packers cost 572');
    A.deep([f.acomodador.data.name, f.acomodador.data.points, f.acomodador.data.possible, f.acomodador.data.kind], ['Steel Man', 219, 386, 'worst'], 'the worst is Steel Man, last place');
    A.deep(f.acomodador.alts.map(a => [a.data.name, a.data.points, a.data.possible]).slice(0, 2), [['This is our year', 308, 516], ['Silverback', 354, 468]], 'This is our year is the worst outside last place, Silverback the best');
    [f.nunca, f.orden, f.polos, f.cuervos, f.acomodador].forEach(x => {
      A.ok(x.score >= 50 && x.score <= 95, x.rule + ' scores by rarity: ' + x.score);
      A.equal(x.alts.length <= 3, true, 'at most 3 alternates');
      A.equal(x.data.pct === undefined || x.data.pct >= 0.9 || x.rule === 'orden', true, x.rule + ' is in the top decile');
    });
    A.equal(f.acomodador.alts[0].data.name, 'This is our year');
  }],

  ['the last-place budget hands the slot to an alternate: This is our year when Steel Man is spent', async () => {
    const d = clone(FULL);
    d.tribune.columna = [{ titulo: '', para: '', texto: 'Steel Man sigue en el sótano.' }];
    d.tribune.clasificados = []; d.tribune.datos = [];
    const c = await load(d);
    const printed = c.M.pk.picks.filter(f => f.rule === 'acomodador')[0];
    if (printed) A.ok(printed.data.name !== 'Steel Man', 'Steel Man is not printed twice');
    const direct = c.T.pickFacts(c.M, [], true, []);
    const ac = direct.picks.filter(f => f.rule === 'acomodador')[0];
    A.ok(ac && ac.data.name === 'This is our year', 'with the slot spent the alternate prints: ' + (ac && ac.data.name));
  }],

  ['muertos: at most 2 calaveritas, 4 lines each, every line up to 34 characters', async () => {
    let seen = 0;
    for (const k of [1, 2, 3, 4, 5]) {
      const dk = await weekAt(k);
      dk.tribune.edicion = { titulo: 'Día de muertos', texto: '', tema: 'muertos' };
      const c = await load(dk);
      const cal = c.M.pk.picks.filter(f => f.estilo === 'calaverita');
      A.ok(cal.length <= 2, 'week ' + k + ' at most 2 calaveritas');
      cal.forEach(f => {
        seen++;
        const lines = f.texto.split(' / ');
        A.equal(lines.length, 4, 'four lines');
        lines.forEach(l => A.ok(l.length <= 34, 'line up to 34: ' + l));
        lint(f.texto, 'calaverita');
      });
      A.equal(c.doc.documentElement.getAttribute('data-tema'), 'muertos');
    }
    A.ok(seen >= 1, 'the muertos edition prints calaveritas when names fit (' + seen + ')');
  }],

  // ---- v4.1.1: the no-repeat check reads last week's real edition ---------------------------------------

  ['no-repeat: week 5 live, no semana-04.json, nothing is held out and the page prints its 6 facts', async () => {
    const c = await load(FULL, { index: { weeks: [5] } });
    A.deep(c.errors, []);
    A.ok(c.fetched.indexOf('editions/semana-04.json') >= 0, "asked for last week's edition");
    A.equal(c.M.prevD, null);
    A.deep(c.T.prevRules(c.M), []);
    A.deep(c.M.pk.picks.map(f => f.rule).sort(), ['acomodador', 'cuervos', 'nunca', 'polos', 'racha', 'rebote']);
    A.equal(c.M.pk.cifra.rule, 'rebote', 'La cifra');
  }],

  ['no-repeat: week 6 holds out exactly the 6 rules the week 5 page printed', async () => {
    const c = await load(week6(), { editions: { 5: FULL }, index: { weeks: [5, 6] } });
    A.deep(c.errors, []);
    A.equal(c.M.D.week, 6);
    A.ok(c.M.prevD && c.M.prevD.week === 5, 'the model carries the previous edition');
    A.deep(c.T.prevRules(c.M).sort(), ['acomodador', 'cuervos', 'nunca', 'polos', 'racha', 'rebote']);
  }],

  ['no-repeat: a rule whose desde is this week was not live last week and is never held out', async () => {
    const c = await load(week6(), { editions: { 5: FULL }, index: { weeks: [5, 6] } });
    const was = c.T.DESDE.polos;
    try {
      c.T.DESDE.polos = 6;
      const r = c.T.prevRules(c.M);
      A.ok(r.indexOf('polos') < 0, 'polos is new in week 6');
      A.equal(r.length, 5, 'the other five stay');
    } finally { c.T.DESDE.polos = was; }
    A.deep(Object.keys(c.T.DESDE).filter(k => c.T.DESDE[k] !== 5), [], 'every current rule is desde 5');
  }],

  ['no-repeat: semana-05.json missing or broken means no previous edition and no errors', async () => {
    for (const ed of [{}, { 5: 'bad' }]) {
      const c = await load(week6(), { editions: ed, index: { weeks: [5, 6] } });
      A.deep(c.errors, []);
      A.equal(c.M.prevD, null);
      A.deep(c.T.prevRules(c.M), []);
      A.equal(c.M.pk.picks.length, 6);
    }
  }],

  ['no-repeat: ?ed=5 loads semana-05.json and asks for semana-04.json, a 404 is handled the same way', async () => {
    const c = await load(FULL, { url: '?ed=5', editions: { 5: FULL }, index: { weeks: [5] } });
    A.deep(c.errors, []);
    A.equal(c.M.D.week, 5);
    A.ok(c.fetched.indexOf('editions/semana-05.json') >= 0 && c.fetched.indexOf('editions/semana-04.json') >= 0);
    A.equal(c.M.prevD, null);
    A.deep(c.T.prevRules(c.M), []);
    const c6 = await load(week6(), { url: '?ed=6', editions: { 5: FULL, 6: week6() }, index: { weeks: [5, 6] } });
    A.equal(c6.M.D.week, 6);
    A.ok(c6.fetched.indexOf('editions/semana-05.json') >= 0);
    A.equal(c6.T.prevRules(c6.M).length, 6, 'the archive of week 5 is read from ?ed=6');
  }],

  ['no-repeat: render waits for the previous edition request', async () => {
    let release; const gate = new Promise(r => { release = r; });
    let early = 'unset', asked = false;
    const c = await load(week6(), {
      editions: { 5: FULL }, index: { weeks: [5, 6] }, gate: { 5: gate },
      probe(win, fetched) { early = win.__model; asked = fetched.indexOf('editions/semana-05.json') >= 0; release(); },
    });
    A.ok(asked, 'the previous edition was requested');
    A.equal(early, undefined, 'nothing rendered while it was pending');
    A.ok(c.M && c.M.prevD, 'then it rendered with it');
    A.deep(c.errors, []);
  }],

  ['every template, filled with the week 5 data, stays at 120 characters and passes the copy lint', async () => {
    const c = await load(FULL);
    const cases = [];
    const grab = x => { cases.push(x); (x.alts || []).forEach(a => cases.push(a)); };
    for (const k of [1, 2, 3, 4, 5]) {
      const M = k === 5 ? c.M : c.T.model(await weekAt(k));
      c.T.facts(M).forEach(grab);
    }
    const flip = clone(FULL);                                 // forces llanero, empate and a tie-free playoff
    flip.picks['5'].g[6][3] = 'U';
    const cf = await load(flip); cf.T.facts(cf.M).forEach(grab);
    const push = clone(FULL);
    push.picks['5'].g[6][3] = 'P';
    const cp = await load(push); cp.T.facts(cp.M).forEach(grab);
    const rules = {}, long = {};
    cases.forEach(f => {
      rules[f.rule] = 1;
      f.tpls.forEach(t => {
        const text = c.T.renderFor(c.M, f, t);
        lint(text, f.rule + ' ' + t.s);
        if (t.s !== 'calaverita' && text.length > 120) long[text] = f.rule + ' ' + t.s + ' ' + text.length;
      });
    });
    A.deep(Object.keys(long).map(k => long[k] + ': ' + k), [], 'templates over 120 characters');
    ['rebote', 'racha', 'remontada', 'fotocopia', 'survivor', 'costalazo', 'llanero', 'borregada', 'empate', 'olvido', 'rachapicks', 'nunca', 'orden', 'polos', 'cuervos', 'acomodador', 'lealtad'].forEach(r =>
      A.ok(rules[r], r + ' was exercised'));
  }],
]);
