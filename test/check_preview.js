'use strict';
// Static check on the link preview tags in index.html: every URL is absolute https on the Pages host,
// the referenced assets exist with the right PNG dimensions (read from the IHDR header) and size.
const fs = require('fs');
const path = require('path');
const A = require('./assert');
const { JSDOM } = require('jsdom');
const L = require('../tools/share_lib');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const HOST = 'calakmul5.github.io';
const BASE = 'https://' + HOST + '/fourth-and-beers/';

function meta(attr, key) {
  const m = new RegExp('<meta ' + attr + '="' + key + '" content="([^"]*)">').exec(HTML);
  return m ? m[1] : null;
}
function link(rel) {
  const m = new RegExp('<link rel="' + rel + '"[^>]*href="([^"]*)"').exec(HTML);
  return m ? m[1] : null;
}
function png(rel) {
  const b = fs.readFileSync(path.join(ROOT, rel));
  A.equal(b.slice(1, 4).toString('latin1'), 'PNG', rel + ' is a PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), size: b.length };
}
function localFile(url) { return url.slice(BASE.length).split('?')[0]; }

const urls = {
  'og:url': meta('property', 'og:url'),
  'og:image': meta('property', 'og:image'),
  'og:image:secure_url': meta('property', 'og:image:secure_url'),
  'twitter:image': meta('name', 'twitter:image'),
  canonical: link('canonical'),
  icon: link('icon'),
  'apple-touch-icon': link('apple-touch-icon'),
};
const PREVIEW_CASES = [
  ['every preview URL is absolute https on the Pages host', () => {
    Object.keys(urls).forEach(k => {
      const u = urls[k];
      A.ok(u, k + ' is present');
      A.ok(u.startsWith(BASE), k + ' is absolute https on the Pages host: ' + u);
    });
    A.equal(urls['og:url'], BASE, 'og:url is the root');
    A.equal(urls.canonical, BASE, 'canonical is the root');
    A.equal(urls['og:image'], urls['og:image:secure_url'], 'secure_url matches og:image');
    A.equal(urls['og:image'], urls['twitter:image'], 'twitter:image matches og:image');
    A.ok(/\?v=\d+$/.test(urls['og:image']), 'og:image carries a ?v= cache buster');
    A.ok(/\?v=2$/.test(urls['og:image']), 'og:image is at ?v=2, the gray card');
  }],
  ['tags and the card',() => {
    
    A.equal(meta('property', 'og:type'), 'website', 'og:type');
    A.equal(meta('property', 'og:locale'), 'es_MX', 'og:locale');
    A.equal(meta('name', 'twitter:card'), 'summary_large_image', 'twitter:card');
    A.equal(meta('property', 'og:image:type'), 'image/png', 'og:image:type');
    A.equal(meta('property', 'og:description'), meta('name', 'description'), 'og:description is the page description');
    A.ok(meta('property', 'og:image:alt'), 'og:image:alt is present');
    
    const card = png(localFile(urls['og:image']));
    A.equal(card.w, 1200, 'og-card width');
    A.equal(card.h, 630, 'og-card height');
    A.ok(card.size < 300 * 1024, 'og-card is under 300 KB: ' + card.size);
    A.equal(Number(meta('property', 'og:image:width')), card.w, 'og:image:width matches the file');
    A.equal(Number(meta('property', 'og:image:height')), card.h, 'og:image:height matches the file');
    
    const touch = png(localFile(urls['apple-touch-icon']));
    A.equal(touch.w + 'x' + touch.h, '180x180', 'apple-touch-icon size');
    const fav = png(localFile(urls.icon));
    A.equal(fav.w + 'x' + fav.h, '32x32', 'favicon-32 size');
  }],
];

// ---- weekly share pages (s/NN/index.html, assets/og/semana-NN.png), built by tools/make_og_week.js in the og-week workflow ----
function parse(html) { return new JSDOM(html).window.document; }
function metaOf(doc, key) { const e = doc.querySelector('meta[property="' + key + '"],meta[name="' + key + '"]'); return e ? e.getAttribute('content') : null; }
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
const sDir = path.join(ROOT, 's');
const SHARE_WEEKS = fs.existsSync(sDir) ? fs.readdirSync(sDir).filter(d => /^\d\d$/.test(d) && fs.existsSync(path.join(sDir, d, 'index.html'))) : [];

A.run('Link preview and share pages', PREVIEW_CASES.concat([
  ['every s/NN page, and the page generated from every editions file, has absolute URLs, its own og:url and the Portada of its edition', () => {
    const EDITIONS = fs.readdirSync(path.join(ROOT, 'editions')).map(x => /^semana-(\d\d)\.json$/.exec(x)).filter(Boolean).map(m => m[1]);
    A.ok(EDITIONS.length >= 7, 'the archived editions are there');
    const pages = SHARE_WEEKS.map(nn => ({ nn, html: fs.readFileSync(path.join(sDir, nn, 'index.html'), 'utf8'), onDisk: true }))
      .concat(EDITIONS.map(nn => ({ nn, html: L.sharePage(L.source(readJson('editions/semana-' + nn + '.json'))), onDisk: false })));
    pages.forEach(({ nn, html, onDisk }) => {
      const doc = parse(html);
      const ed = readJson('editions/semana-' + nn + '.json'), src = L.source(ed);
      A.equal(src.week, Number(nn), nn + ': the edition file is that week');
      ['og:url', 'og:image', 'og:image:secure_url', 'twitter:image'].forEach(k => A.ok((metaOf(doc, k) || '').startsWith(BASE), nn + ' ' + k + ' is absolute on the Pages host'));
      A.equal(metaOf(doc, 'og:url'), BASE + 's/' + nn + '/', nn + ' og:url is its own');
      A.equal(doc.querySelector('link[rel="canonical"]').getAttribute('href'), BASE + 's/' + nn + '/');
      A.equal(metaOf(doc, 'og:image'), metaOf(doc, 'twitter:image'), nn + ' twitter:image matches');
      A.equal(metaOf(doc, 'og:site_name'), 'Fourth and Beers Tribune');
      A.equal(metaOf(doc, 'og:locale'), 'es_MX');
      A.equal(metaOf(doc, 'twitter:card'), 'summary_large_image');
      A.equal(metaOf(doc, 'og:image:type'), 'image/png');
      A.equal(metaOf(doc, 'og:image:width'), '1200');
      A.equal(metaOf(doc, 'og:image:height'), '630');
      A.ok(metaOf(doc, 'og:image:alt'), nn + ' has alt');
      A.equal(doc.title, src.portada ? src.portada.titulo : L.DEFAULT_TITLE, nn + ' title is the Portada headline');
      A.equal(metaOf(doc, 'og:title'), doc.title);
      A.equal(metaOf(doc, 'og:description'), src.portada ? (src.portada.texto || L.DEFAULT_DESC) : L.DEFAULT_DESC, nn + ' description is the deck');
      A.match(html, /src:[0-9a-f]{40}/, nn + ' carries a source hash');
      if (src.portada && onDisk) {
        const rel = localFile(metaOf(doc, 'og:image'));
        A.equal(rel, 'assets/og/semana-' + nn + '.png');
        const c = png(rel);
        A.equal(c.w + 'x' + c.h, '1200x630', nn + ' card size');
        A.ok(c.size < 300 * 1024, nn + ' card is under 300 KB: ' + c.size);
      } else if (!src.portada) A.equal(metaOf(doc, 'og:image'), L.DEFAULT_IMAGE, nn + ' falls back to the sello');
      else A.ok(metaOf(doc, 'og:image').startsWith(BASE + 'assets/og/semana-' + nn + '.png?v=') && /\?v=[0-9a-f]{8}$/.test(metaOf(doc, 'og:image')), nn + ' points at its card');
    });
  }],
  ['escaping: curly apostrophes, accents, quotes, ampersands and angle brackets survive a round trip', () => {
    const titulo = 'Andrea’s Picks dijo "ya mero" & <b>ganó</b> con \'cariño\'', texto = 'Más 3 < 4 y “comillas” ñandú.';
    const src = L.source({ week: 7, tribune: { portada: { titulo, texto }, edicion: null } });
    const html = L.sharePage(src), doc = parse(html);
    A.equal(doc.title, titulo);
    A.equal(metaOf(doc, 'og:title'), titulo);
    A.equal(metaOf(doc, 'twitter:title'), titulo);
    A.equal(metaOf(doc, 'og:description'), texto);
    A.equal(metaOf(doc, 'og:image:alt'), 'Portada de la semana 7: ' + titulo);
    A.ok(html.indexOf('<b>ganó') < 0, 'no raw markup from the copy');
    A.ok(html.indexOf('’') > 0 && html.indexOf('ñandú') > 0, 'UTF-8 characters are kept, not entity-mangled');
    A.equal(doc.querySelectorAll('meta[property^="og:"]').length, 12, 'one og tag each, no injected extras');
  }],
  ['a week without Portada gets the default title, tagline and sello card', () => {
    const doc = parse(L.sharePage(L.source({ week: 3, tribune: { portada: null, edicion: null } })));
    A.equal(doc.title, 'Fourth and Beers Tribune');
    A.equal(metaOf(doc, 'og:description'), L.DEFAULT_DESC);
    A.equal(metaOf(doc, 'og:image'), BASE + 'assets/og-card.png?v=2');
    A.equal(metaOf(doc, 'og:url'), BASE + 's/03/');
  }],
  ['the redirect goes to the plain page for the live week, to ?ed=NN otherwise, and keeps ?yo= and the #name', async () => {
    const doc = parse(L.sharePage(L.source({ week: 11, tribune: { portada: { titulo: 'X', texto: '' }, edicion: null } })));
    const code = doc.querySelector('script').textContent;
    // fakeFetch: what ../../data.json answers (a week number, or null for a failed request)
    const run = (search, hash, liveWeek) => new Promise(resolve => {
      const fakeFetch = () => liveWeek == null ? Promise.reject(new Error('offline')) : Promise.resolve({ json: () => Promise.resolve({ week: liveWeek }) });
      new Function('location', 'URLSearchParams', 'fetch', 'setTimeout', code)({ search, hash, replace: resolve }, URLSearchParams, fakeFetch, () => 0);
    });
    A.equal(await run('', '', 11), '../../', 'this week goes to the live page, no archive banner');
    A.equal(await run('', '', 12), '../../?ed=11', 'an older week goes to its edition');
    A.equal(await run('', '', null), '../../?ed=11', 'a failed data.json falls back to the edition');
    A.equal(await run('?yo=Cyber70', '', 11), '../../?yo=Cyber70');
    A.equal(await run('?yo=Cyber70', '', 12), '../../?ed=11&yo=Cyber70');
    A.equal(await run('?yo=Andrea%E2%80%99s%20Picks', '#Andrea', 12), '../../?ed=11&yo=Andrea%E2%80%99s%20Picks#Andrea');
    A.equal(await run('', '#Cyber70', 11), '../../#Cyber70');
    A.ok(doc.querySelector('noscript').innerHTML.indexOf('http-equiv="refresh" content="0;url=../../?ed=11"') >= 0, 'noscript meta refresh');
    A.equal(doc.querySelector('body a').getAttribute('href'), '../../?ed=11', 'plain fallback link');
  }],
  ['the source hash follows the Portada, the theme and the Edición banner, not the rest of the data', () => {
    const base = { week: 11, tribune: { portada: { titulo: 'A', texto: 'B' }, edicion: { titulo: 'E', tema: 'gracias' } }, pickem: [1] };
    const h = d => L.hashOf(L.source(d));
    const copy = () => JSON.parse(JSON.stringify(base));
    A.equal(h(base), h(Object.assign(copy(), { pickem: [2], updated: 'x' })), 'unrelated data does not redraw');
    const t = copy(); t.tribune.portada.titulo = 'AA'; A.ok(h(t) !== h(base), 'headline');
    const k = copy(); k.tribune.edicion.tema = 'muertos'; A.ok(h(k) !== h(base), 'theme');
    const e = copy(); e.tribune.edicion.titulo = 'EE'; A.ok(h(e) !== h(base), 'banner');
    const u = copy(); u.tribune.edicion.tema = 'navidad'; A.equal(L.source(u).tema, '', 'an unknown theme is ignored');
  }],
  ['the card applies the same theme accents as index.html', () => {
    const tpl = fs.readFileSync(path.join(ROOT, 'tools', 'og-week.html'), 'utf8');
    L.THEMES.forEach(t => {
      const page = new RegExp('html\\[data-tema="' + t + '"\\]\\{--accent:var\\((--[a-z]+)\\)\\}').exec(HTML);
      const card = new RegExp('\\.tema-' + t + '\\{--accent:var\\((--[a-z]+)\\)\\}').exec(tpl);
      A.ok(page && card, t + ' has an accent in both');
      A.equal(card[1], page[1], t + ' accent matches index.html');
    });
    A.ok(HTML.indexOf('--pumpkin:') > 0 && tpl.indexOf('var(--pumpkin)') > 0, 'the garland colors are tokens');
  }],
  ['the card template has no colors of its own and the workflow is wired as designed', () => {
    const tpl = fs.readFileSync(path.join(ROOT, 'tools', 'og-week.html'), 'utf8');
    const hex = (tpl.match(/(?<![&\w])#[0-9a-fA-F]{3,8}\b/g) || []).filter(x => !/^#(card|papel|head|deck|sello|semana|ed)$/.test(x));
    A.equal(hex.length, 0, 'no hex in og-week.html: ' + hex.join(', '));
    A.ok(!/\b(?:rgb|rgba|hsl)\s*\(/i.test(tpl), 'no color functions in og-week.html');
    A.ok(fs.readFileSync(path.join(ROOT, 'tools', 'make_og_week.js'), 'utf8').indexOf('rootTokens()') > 0, 'the card reads the :root tokens of index.html');
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'og-week.yml'), 'utf8');
    A.ok(wf.indexOf("paths: ['editions/semana-*.json']") > 0, 'triggers on the editions only');
    A.match(wf, /workflow_dispatch:[\s\S]*week:/, 'manual run with a week input');
    A.ok(wf.indexOf('contents: write') > 0 && wf.indexOf('pages: write') > 0, 'permissions');
    A.match(wf, /group: og-week\s+cancel-in-progress: false/, 'concurrency group');
    A.ok(wf.indexOf('git add s assets/og') > 0, 'commits only s and assets/og');
    A.ok(!/git add [^\n]*(editions|data\.json)/.test(wf), 'never commits editions or data.json');
    A.ok(wf.indexOf('pages/builds') > 0, 'asks Pages for a build after the push');
    const tests = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'tests.yml'), 'utf8');
    A.ok(tests.indexOf("'!assets/og/**'") > 0, 'tests.yml skips the cards');
    A.ok(tests.indexOf("'s/**'") < 0, 'tests.yml does not watch s/');
  }],
]));
