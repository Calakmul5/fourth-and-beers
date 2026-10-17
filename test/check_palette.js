'use strict';
// Static check on index.html, the newsprint page:
//   1. No hex or rgb()/hsl() color anywhere outside the :root token block (CSS, inline styles, JS, SVG strings, meta tags).
//   2. Light only: one scheme, no dark media query, so iOS dark mode cannot invert the page.
//   3. The ink tokens read well on the paper: 4.5:1 for text, 3:1 for the chart colors.
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
  ['the token block exists and defines the newsprint palette', () => {
    A.ok(rootStart > 0 && rootEnd > rootStart, ':root block found');
    const t = tokens();
    A.deep(
      ['paper', 'paper2', 'ink', 'ink2', 'muted', 'rule', 'hair', 'red'].map(k => t[k]),
      ['#F3EEE3', '#E9E2D3', '#161514', '#3B3834', '#6B655C', '#161514', '#B9B0A0', '#A3191F'], 'the approved tokens');
    A.equal(t.up, '#2E7D4F', 'climber green');
    A.equal(t.down, '#C2610C', 'drop burnt orange');
    ['blush', 'stone', 'marigold'].forEach(k => A.ok(t[k], '--' + k));
    A.ok(/--accent:var\(--red\)/.test(ROOT), 'the accent starts as the red');
    ['bg', 'surface', 'amber', 'on-accent'].forEach(k => A.ok(!new RegExp('--' + k + '\\b').test(HTML), 'old --' + k + ' is gone'));
  }],
  ['no hex color outside the :root block', () => {
    const hits = (REST.match(HEX) || []);
    A.equal(hits.length, 0, 'hex colors outside :root: ' + hits.slice(0, 5).join(', '));
  }],
  ['no rgb(), rgba() or hsl() outside the :root block', () => {
    const hits = (REST.match(FUNC) || []);
    A.equal(hits.length, 0, 'color functions outside :root: ' + hits.slice(0, 5).join(', '));
  }],
  ['light only: one scheme, no dark override, explicit backgrounds', () => {
    A.ok(/color-scheme:\s*only light/.test(ROOT), 'color-scheme only light in :root');
    A.ok(/<meta name="color-scheme" content="only light">/.test(HTML), 'color-scheme meta');
    A.ok(!/prefers-color-scheme/.test(HTML), 'no media query for dark mode');
    A.ok(/html,body\{[^}]*background:var\(--paper\) !important/.test(HTML), 'html and body have an explicit paper background');
    A.ok(/\.pick select\{[^}]*background:var\(--paper\)/.test(HTML), 'the native select has an explicit background');
  }],
  ['ink and muted reach 4.5:1 on the paper', () => {
    const t = tokens();
    // --paper2 only paints the empty bar track, so no text sits on it besides ink.
    ['ink', 'ink2', 'muted'].forEach(fg => {
      const c = contrast(t[fg], t.paper);
      A.ok(c >= 4.5, '--' + fg + ' on --paper is ' + c.toFixed(2) + ':1, needs 4.5');
    });
    ['ink', 'ink2'].forEach(fg => A.ok(contrast(t[fg], t.paper2) >= 4.5, '--' + fg + ' on --paper2'));
  }],
  ['red labels, the reversed blocks and the chart colors stay legible', () => {
    const t = tokens();
    ['paper', 'paper2'].forEach(bg => A.ok(contrast(t.red, t[bg]) >= 4.5, '--red on --' + bg + ' ' + contrast(t.red, t[bg]).toFixed(2)));
    ['paper', 'stone', 'blush'].forEach(fg => A.ok(contrast(t[fg], t.ink) >= 4.5, '--' + fg + ' on --ink (the cifra and the winner tiles) ' + contrast(t[fg], t.ink).toFixed(2)));
    ['up', 'down'].forEach(fg => A.ok(contrast(t[fg], t.paper) >= 3, '--' + fg + ' on --paper is ' + contrast(t[fg], t.paper).toFixed(2) + ':1, the 3:1 floor for lines and large text'));
  }],
  ['special editions: the marigold passes 4.5:1, and a theme only remaps tokens', () => {
    const t = tokens();
    // --paper2 only paints the empty bar track, no text sits on it, so the marigold is checked on the paper.
    A.ok(contrast(t.marigold, t.paper) >= 4.5, '--marigold on --paper is ' + contrast(t.marigold, t.paper).toFixed(2) + ':1, needs 4.5');
    const themes = HTML.match(/html\[data-tema="[a-z]+"\]\{[^}]*\}/g) || [];
    A.ok(themes.length >= 1, 'a theme block exists');
    themes.forEach(b => A.ok(/^html\[data-tema="[a-z]+"\]\{(--[a-z0-9-]+:var\(--[a-z0-9-]+\);?)+\}$/.test(b), 'theme block only remaps tokens: ' + b));
    A.ok(!/data-tema="muertos"\]\{[^}]*--red/.test(HTML), 'the red (chart and prize color) is not overridden');
  }],
]);
