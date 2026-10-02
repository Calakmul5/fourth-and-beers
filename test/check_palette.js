'use strict';
// Static check on index.html:
//   1. No hex or rgb()/hsl() color anywhere outside the :root token block (CSS, inline styles, JS, SVG strings, meta tags).
//   2. The palette tokens read well: --text and --muted at least 4.5:1 on --bg and --surface.
const fs = require('fs');
const path = require('path');
const A = require('./assert');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const rootStart = HTML.indexOf(':root{');
const rootEnd = HTML.indexOf('}', rootStart);
const ROOT = HTML.slice(rootStart, rootEnd + 1);
const REST = HTML.slice(0, rootStart) + HTML.slice(rootEnd + 1);

// Hex colors (not HTML entities like &#8217;) and color functions.
const HEX = /(?<![&\w])#[0-9a-fA-F]{3,8}\b/g;
const FUNC = /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\s*\(/gi;

function tokens() {
  const out = {};
  const re = /--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g;
  let m;
  while ((m = re.exec(ROOT))) out[m[1]] = m[2];
  return out;
}
function rgb(hex) { return [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16)); }
function lum(c) {
  const l = rgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

A.run('Palette', [
  ['the token block exists and defines the palette', () => {
    A.ok(rootStart > 0 && rootEnd > rootStart, ':root block found');
    const t = tokens();
    ['bg', 'surface', 'surface2', 'line', 'text', 'muted', 'accent', 'accent-soft', 'on-accent', 'red', 'green'].forEach(k => A.ok(t[k], '--' + k));
    A.ok(!/--amber/.test(HTML), 'old --amber names are gone');
  }],
  ['no hex color outside the :root block', () => {
    const hits = (REST.match(HEX) || []);
    A.equal(hits.length, 0, 'hex colors outside :root: ' + hits.slice(0, 5).join(', '));
  }],
  ['no rgb(), rgba() or hsl() outside the :root block', () => {
    const hits = (REST.match(FUNC) || []);
    A.equal(hits.length, 0, 'color functions outside :root: ' + hits.slice(0, 5).join(', '));
  }],
  ['dark is forced: one scheme, no light overrides', () => {
    A.ok(/color-scheme:\s*dark/.test(ROOT), 'color-scheme dark in :root');
    A.ok(!/prefers-color-scheme:\s*light/.test(HTML), 'no light media query');
    A.ok(/<meta name="color-scheme" content="dark">/.test(HTML), 'color-scheme meta');
  }],
  ['--text and --muted reach 4.5:1 on --bg and --surface', () => {
    const t = tokens();
    ['text', 'muted'].forEach(fg => ['bg', 'surface'].forEach(bg => {
      const c = contrast(t[fg], t[bg]);
      A.ok(c >= 4.5, '--' + fg + ' on --' + bg + ' is ' + c.toFixed(2) + ':1, needs 4.5');
    }));
  }],
  ['accent, red and green stay legible on the grounds they sit on (3:1, the large-text and UI floor)', () => {
    const t = tokens();
    A.ok(contrast(t['on-accent'], t.accent) >= 4.5, '--on-accent on --accent ' + contrast(t['on-accent'], t.accent).toFixed(2));
    ['accent', 'red', 'green'].forEach(fg => ['bg', 'surface'].forEach(bg => {
      const c = contrast(t[fg], t[bg]);
      A.ok(c >= 3, '--' + fg + ' on --' + bg + ' is ' + c.toFixed(2) + ':1');
    }));
    A.ok(contrast(t.muted, t.surface2) >= 4.5, '--muted on --surface2 (selected row) ' + contrast(t.muted, t.surface2).toFixed(2));
  }],
]);
