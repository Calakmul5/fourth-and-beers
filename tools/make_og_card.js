#!/usr/bin/env node
'use strict';
// make_og_card.js v1.0.0 c1.0.0
// Renders tools/og-card.html with Playwright (headless Chromium) into the link preview art:
//   assets/og-card.png          1200x630  (#card)
//   assets/apple-touch-icon.png  180x180  (#icon)
//   assets/favicon-32.png         32x32   (#fav, drawn at 64x64 on a transparent background, then downscaled)
// Usage: node tools/make_og_card.js [outDir]   (default: assets). Not part of test.bat or deploy.bat.
// First run needs the browser: npx playwright install chromium
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'assets'));
const TEMPLATE = pathToFileURL(path.join(__dirname, 'og-card.html')).href;

async function shot(browser, id, w, h, scale, file, transparent) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  await page.goto(TEMPLATE + '#' + id);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.locator('#' + id).screenshot({ path: file, omitBackground: !!transparent });
  await ctx.close();
}

// Downscales a PNG to size x size in the browser, so no image dependency is needed.
async function downscale(browser, file, size) {
  const b64 = fs.readFileSync(file).toString('base64');
  const page = await browser.newPage();
  const out = await page.evaluate(async ({ b64, size }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, size, size);
    return c.toDataURL('image/png').split(',')[1];
  }, { b64, size });
  fs.writeFileSync(file, Buffer.from(out, 'base64'));
  await page.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    await shot(browser, 'card', 1200, 630, 1, path.join(OUT, 'og-card.png'));
    await shot(browser, 'icon', 180, 180, 1, path.join(OUT, 'apple-touch-icon.png'));
    const fav = path.join(OUT, 'favicon-32.png');
    await shot(browser, 'fav', 64, 64, 1, fav, true);
    await downscale(browser, fav, 32);
  } finally {
    await browser.close();
  }
  console.log('Wrote og-card.png, apple-touch-icon.png and favicon-32.png to ' + OUT);
})().catch(e => { console.error(e.message || e); process.exit(1); });
