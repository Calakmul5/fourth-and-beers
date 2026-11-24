'use strict';
// share_lib.js v1.0.0 c1.0.0
// Pure helpers for the weekly share pages (s/NN/index.html) and their cards (assets/og/semana-NN.png).
// Used by tools/make_og_week.js and by the tests. No file or network access here.
const crypto = require('crypto');

const BASE = 'https://calakmul5.github.io/fourth-and-beers/';
const SITE = 'Fourth and Beers Tribune';
const DEFAULT_TITLE = 'Fourth and Beers Tribune';
const DEFAULT_DESC = 'La quiniela más grande del mundo. Información que nadie pidió.';
const DEFAULT_IMAGE = BASE + 'assets/og-card.png?v=2';
// Bump when the card design changes, so every week is redrawn.
const CARD_VERSION = 1;
const THEMES = ['muertos', 'gracias'];

function pad2(n) { return String(n).padStart(2, '0'); }

// Escapes text for HTML text and double or single quoted attributes. UTF-8 (curly apostrophes, accents) stays as is.
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// What the card and the share page show for an edition (data.json shape, editions/semana-NN.json).
function source(d) {
  const t = (d && d.tribune) || {}, p = t.portada, e = t.edicion;
  const portada = p && String(p.titulo || '').trim() ? { titulo: String(p.titulo).trim(), texto: String(p.texto || '').trim() } : null;
  const tema = e && THEMES.indexOf(e.tema) >= 0 ? e.tema : '';
  return { week: Number(d.week), portada, tema, edicion: e && e.titulo ? String(e.titulo).trim() : '' };
}

function hashOf(src) {
  const j = JSON.stringify([CARD_VERSION, src.week, src.portada, src.tema, src.edicion]);
  return crypto.createHash('sha1').update(j).digest('hex');
}

function pageUrl(week) { return BASE + 's/' + pad2(week) + '/'; }
function imageUrl(week, hash) { return BASE + 'assets/og/semana-' + pad2(week) + '.png?v=' + hash.slice(0, 8); }

function sharePage(src) {
  const nn = pad2(src.week), url = pageUrl(src.week), hash = hashOf(src);
  const has = !!src.portada;
  const title = has ? src.portada.titulo : DEFAULT_TITLE;
  const desc = has ? (src.portada.texto || DEFAULT_DESC) : DEFAULT_DESC;
  const img = has ? imageUrl(src.week, hash) : DEFAULT_IMAGE;
  const alt = has ? 'Portada de la semana ' + src.week + ': ' + title : 'Sello del Fourth and Beers Tribune, temporada 2026';
  const target = '../../?ed=' + nn;
  const m = (a, k, v) => '<meta ' + a + '="' + k + '" content="' + esc(v) + '">';
  return [
    '<!doctype html>',
    '<html lang="es">',
    '<head>',
    '<meta charset="utf-8">',
    '<!-- share page v1.0.0 src:' + hash + ' -->',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + esc(title) + '</title>',
    m('name', 'description', desc),
    '<link rel="canonical" href="' + esc(url) + '">',
    m('property', 'og:type', 'website'),
    m('property', 'og:site_name', SITE),
    m('property', 'og:locale', 'es_MX'),
    m('property', 'og:title', title),
    m('property', 'og:description', desc),
    m('property', 'og:url', url),
    m('property', 'og:image', img),
    m('property', 'og:image:secure_url', img),
    m('property', 'og:image:type', 'image/png'),
    m('property', 'og:image:width', '1200'),
    m('property', 'og:image:height', '630'),
    m('property', 'og:image:alt', alt),
    m('name', 'twitter:card', 'summary_large_image'),
    m('name', 'twitter:title', title),
    m('name', 'twitter:description', desc),
    m('name', 'twitter:image', img),
    '<noscript><meta http-equiv="refresh" content="0;url=' + esc(target) + '"></noscript>',
    '<script>',
    '(function(){var n=' + src.week + ',done=false,y="";try{var q=new URLSearchParams(location.search).get("yo");if(q)y="yo="+encodeURIComponent(q);}catch(e){}',
    'function go(live){if(done)return;done=true;var u=live?"../../":"../../?ed=' + nn + '";if(y)u+=(live?"?":"&")+y;try{u+=location.hash;}catch(e){}location.replace(u);}',
    'setTimeout(function(){go(false)},2500);',
    'try{fetch("../../data.json",{cache:"no-store"}).then(function(r){return r.json()}).then(function(d){go(Number(d.week)===n)}).catch(function(){go(false)});}catch(e){go(false)}})();',
    '</script>',
    '</head>',
    '<body>',
    '<p><a href="' + esc(target) + '">' + esc(title) + '</a></p>',
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

module.exports = { BASE, SITE, DEFAULT_TITLE, DEFAULT_DESC, DEFAULT_IMAGE, CARD_VERSION, THEMES, pad2, esc, source, hashOf, pageUrl, imageUrl, sharePage };
