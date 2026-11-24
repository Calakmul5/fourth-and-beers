#!/usr/bin/env node
'use strict';
// make_og_week.js v1.0.0 c1.0.0
// Builds the weekly share pages and cards from editions/semana-NN.json:
//   s/NN/index.html            static head with the Portada for WhatsApp, redirects to the page
//   assets/og/semana-NN.png    1200x630 card (only for weeks that have a Portada)
// Usage: node tools/make_og_week.js [weeks...] [--force] [--list-stale] [--out dir]
//   Without --out it writes into the repo and only runs when CI is set (the og-week workflow). Locally, always pass --out.
//   no weeks = every archived week. A week is redrawn only when its source hash changed (or with --force).
//   --list-stale prints the stale weeks and exits, with no browser. --out writes under dir instead of the repo (previews).
// First run needs the browser: npx playwright install chromium
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const L = require('./share_lib');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const force = args.includes('--force'), listStale = args.includes('--list-stale');
const oi = args.indexOf('--out');
if (oi < 0 && !process.env.CI) { console.error('Refusing to write s/ and assets/og/ into the working tree: only the og-week workflow writes them. Use --out <dir> for a preview.'); process.exit(1); }
const OUT = oi >= 0 ? path.resolve(args[oi + 1]) : ROOT;
const weeksArg = args.filter((a, i) => /^\d{1,2}$/.test(a) && !(oi >= 0 && i === oi + 1)).map(Number);

function loadEdition(w) {
  const f = path.join(ROOT, 'editions', 'semana-' + L.pad2(w) + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}
function allWeeks() {
  return fs.readdirSync(path.join(ROOT, 'editions')).map(f => /^semana-(\d+)\.json$/.exec(f)).filter(Boolean).map(m => Number(m[1])).sort((a, b) => a - b);
}
function currentHash(w) {
  const f = path.join(OUT, 's', L.pad2(w), 'index.html');
  if (!fs.existsSync(f)) return null;
  const m = /src:([0-9a-f]{40})/.exec(fs.readFileSync(f, 'utf8'));
  return m ? m[1] : null;
}
// The :root block of index.html is the one token source for the card.
function rootTokens() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const s = html.indexOf(':root{');
  return html.slice(s, html.indexOf('}', s) + 1);
}

const weeks = weeksArg.length ? weeksArg : allWeeks();
const todo = weeks.map(w => {
  const d = loadEdition(w);
  if (!d) { console.error('No editions/semana-' + L.pad2(w) + '.json, skipped'); return null; }
  const src = L.source(d);
  return { w, src, stale: force || currentHash(w) !== L.hashOf(src) };
}).filter(Boolean);

if (listStale) { console.log(todo.filter(x => x.stale).map(x => x.w).join(' ')); process.exit(0); }

(async () => {
  const stale = todo.filter(x => x.stale);
  if (!stale.length) { console.log('Nothing to do, every share page is current.'); return; }
  let browser = null, page = null;
  if (stale.some(x => x.src.portada)) {
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    page = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
    await page.goto(pathToFileURL(path.join(__dirname, 'og-week.html')).href);
    await page.addStyleTag({ content: rootTokens() });
    await page.evaluate(() => document.fonts.ready);
  }
  try {
    for (const x of stale) {
      const dir = path.join(OUT, 's', L.pad2(x.w));
      fs.mkdirSync(dir, { recursive: true });
      if (x.src.portada) {
        const r = await page.evaluate(d => window.render(d), { week: x.w, titulo: x.src.portada.titulo, texto: x.src.portada.texto, tema: x.src.tema, edicion: x.src.edicion });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(100);
        fs.mkdirSync(path.join(OUT, 'assets', 'og'), { recursive: true });
        const png = path.join(OUT, 'assets', 'og', 'semana-' + L.pad2(x.w) + '.png');
        await page.locator('#card').screenshot({ path: png });
        const size = fs.statSync(png).size;
        if (size >= 300 * 1024) throw new Error('semana ' + x.w + ' card is ' + size + ' bytes, over 300 KB');
        console.log('semana ' + x.w + ': card ' + size + ' bytes, headline ' + r.size + 'px in ' + r.lines + ' line(s)');
      } else console.log('semana ' + x.w + ': no Portada, default sello');
      fs.writeFileSync(path.join(dir, 'index.html'), L.sharePage(x.src));
    }
  } finally { if (browser) await browser.close(); }
})().catch(e => { console.error(e.message || e); process.exit(1); });
