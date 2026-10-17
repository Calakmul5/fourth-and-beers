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
const W5_OLD = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'week5-old.json'), 'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));

// ---- Page harness -----------------------------------------------------------

/**
 * o.url: query and hash, e.g. '?ed=4'. o.data: what data.json returns (null = 404).
 * o.editions: {N: data}. o.index: edition index, or null for 404. o.failFetch: every fetch rejects.
 */
async function load(data, o) {
  o = o || {};
  const errors = [], fetched = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e && e.stack || e).split('\n')[0]));
  const reply = body => Promise.resolve({ ok: body != null, status: body != null ? 200 : 404, json: () => Promise.resolve(clone(body)) });
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
        if (m) return reply((o.editions || {})[Number(m[1])] || null);
        return reply(null);
      };
      if (o.storage) Object.keys(o.storage).forEach(k => window.localStorage.setItem(k, o.storage[k]));
    },
  });
  const doc = dom.window.document;
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
    A.deep([f.aficiones.data.inMoney, f.aficiones.data.total, f.aficiones.data.bases.slice().sort()], [0, 15, ['CHI', 'DAL']], '0 of the 15 Bears and Dallas fans');
    A.equal(f.aficiones.valor, '0/15');
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
    A.match(c.T.facts(c.M).filter(x => x.rule === 'aficiones')[0].texto, /^Hay 15 fans de Chicago y Dallas\. Ninguno cobra hoy\. Los que cobran le van a Pittsburgh y San Francisco\.$/);
  }],

  ['facts: a rule that ran last week goes to the back when another candidate exists', async () => {
    const c = await load(W5);
    A.ok(c.T.prevRules(c.M).indexOf('survivor') >= 0, 'week 4 would have run the Survivor fact');
    const prev = ['aficiones', 'racha', 'remontada', 'rebote', 'survivor', 'arriba'];
    const r = c.T.pickFacts(c.M, prev);
    A.equal(r.picks.length, 6);
    ['fotocopia', 'disco', 'siempre'].forEach(x => A.ok(r.picks.some(p => p.rule === x), x + ' is fresh and stays in'));
    A.ok(!r.picks.some(p => p.rule === 'peor' || p.rule === 'sotano'), 'a second fact about the last place is over budget even when fresh');
    A.equal(r.picks.filter(p => prev.indexOf(p.rule) >= 0).length, 3, 'only as many repeats as it takes to reach 6');
    A.equal(r.cifra.rule, 'rebote', 'La cifra can still repeat when nothing else is as big');
    const none = c.T.pickFacts(c.M, [], false);
    A.deep(none.picks.map(p => p.rule), ['rebote', 'aficiones', 'racha', 'remontada', 'fotocopia', 'survivor'], 'with no history the 6 highest scores');
  }],

  ['facts: nothing mentions the model or the random picker, and every text stays short', async () => {
    const c = await load(W5);
    for (const k of [2, 3, 4, 5]) {
      const M = c.T.model(c.T.truncate(c.M.D, k));
      c.T.facts(M).forEach(f => {
        lint(f.texto + ' ' + f.titulo + ' ' + f.valor, 'week ' + k + ' ' + f.rule);
        A.noMatch(f.texto, /modelo|random|al azar|dado|moneda/i, f.rule + ' does not mention the model or random picks');
        A.ok(f.texto.length <= 125, f.rule + ' week ' + k + ' is ' + f.texto.length + ' chars: ' + f.texto);
      });
    }
  }],

  ['facts: every template line is clean', async () => {
    const c = await load(W5);
    let n = 0;
    Object.keys(c.T.TPL).forEach(k => c.T.TPL[k].forEach(t => {
      n++;
      lint(t.replace(/\{\w+\}/g, 'Ab'), 'template ' + k);
      A.ok(t.replace(/\{\w+\}/g, 'Abogado').length <= 135, k + ' template is short: ' + t);
    }));
    A.ok(n >= 40, 'enough templates (' + n + ')');
    ['rebote', 'caida', 'arriba', 'fotocopia', 'disco', 'racha', 'record', 'remontada', 'siempre', 'peor', 'surv', 'aficiones'].forEach(p =>
      A.ok(Object.keys(c.T.TPL).some(k => k.toLowerCase().indexOf(p) === 0) , 'templates for ' + p));
    A.ok(c.T.TPL.reboteUp.length >= 2 && c.T.TPL.fotocopia.length >= 2 && c.T.TPL.survMuchos.length >= 2, '2 or 3 per rule');
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
    const ed4 = base.T.truncate(W5, 4); ed4.updated = '2026-10-08T12:00:00Z';
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
    A.ok(!bad.fetched.some(u => /editions\/semana/.test(u)), 'a bad value never asks for a file');
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

  ['last place: with no hand-written rows, Siempre ahí and Cuentas del sótano compete and only one is printed', async () => {
    const c = await load(W5);
    const rules = c.T.facts(c.M).map(f => f.rule);
    A.ok(rules.indexOf('siempre') >= 0 && rules.indexOf('sotano') >= 0, 'both are candidates');
    const sotano = c.T.facts(c.M).filter(f => f.rule === 'sotano')[0];
    A.equal(sotano.titulo, 'Cuentas del sótano');
    A.deep(sotano.sujetos, ['Steel Man']);
    A.match(sotano.texto, /^Los picks de Steel Man suman 179, a 32 del penúltimo lugar\. Las pizzas ya traen su nombre\.$/);
    const shown = all(c.doc, '#facts .fact, .cifra').filter(e => /Steel Man/.test(e.textContent));
    A.equal(shown.length, 1, 'one roast of the last place, got ' + shown.length);
    A.match(shown[0].textContent, /Siempre ahí/, 'the higher-scoring candidate takes the slot');
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
    A.deep(all(c.doc, '#ads b.nombre').map(b => b.getAttribute('data-n')), ['KinkyKing', 'Osos de Grayslake']);
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
]);
