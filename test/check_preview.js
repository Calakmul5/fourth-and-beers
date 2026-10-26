'use strict';
// Static check on the link preview tags in index.html: every URL is absolute https on the Pages host,
// the referenced assets exist with the right PNG dimensions (read from the IHDR header) and size.
const fs = require('fs');
const path = require('path');
const A = require('./assert');

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
A.run('Link preview', [
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
]);
