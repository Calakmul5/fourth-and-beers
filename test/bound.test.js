'use strict';
// Mock-GAS tests for gas/Code.js, the Publicar button (same Apps Script project as Publish.js, bound to the
// participants workbook). No live Google access. publishManual is a stub that returns each status the publisher can give.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execFileSync } = require('child_process');
const A = require('./assert');

const ROOT = path.join(__dirname, '..');
const BOUND = path.join(ROOT, 'gas');
const CODE = fs.readFileSync(path.join(BOUND, 'Code.js'), 'utf8');

/** Loads Code.js with a fake workbook. opts.result: what Leaderboard.publishManual returns, opts.throws: it throws. */
function load(opts) {
  opts = opts || {};
  const events = [];
  const images = (opts.images || []).slice();
  const menus = [];
  const sheet = {
    getImages: () => images,
    insertImage(url, col, row, ox, oy) {
      const img = { url, col, row, ox, oy, script: null, alt: '', assignScript(fn) { img.script = fn; return img; }, setAltTextTitle(t) { img.alt = t; return img; }, getAltTextTitle: () => img.alt, remove() { images.splice(images.indexOf(img), 1); events.push('remove'); } };
      images.push(img); events.push('insert');
      return img;
    },
  };
  const ss = {
    toast: (m, t, s) => events.push('toast:' + m),
    getSpreadsheetTimeZone: () => 'America/Chicago',
    getSheetByName: n => (opts.noTab || n !== 'Tribune') ? null : sheet,
  };
  const ui = {
    ButtonSet: { OK: 'OK' },
    alert: (title, msg, buttons) => events.push('alert:' + msg),
    createMenu: name => { const m = { name, items: [], addItem(l, f) { m.items.push([l, f]); return m; }, addToUi() { menus.push(m); } }; return m; },
  };
  const ctx = {
    Logger: { log: () => {} },
    SpreadsheetApp: { getActive: () => ss, getUi: () => { if (opts.noUi) throw new Error("Cannot call SpreadsheetApp.getUi() from this context."); return ui; } },
    Utilities: { formatDate: (d, tz, f) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d) },
    setWarningWidths_: sh => events.push('widths'),
    publishManual: () => { events.push('publish'); if (opts.throws) throw new Error(opts.throws); return opts.result; },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename: 'Code.js' });
  ctx._events = events; ctx._images = images; ctx._menus = menus;
  return ctx;
}

const PUBLISHED = { status: 'published', week: 6, commitSha: 'abc1234def5678', updatedAt: '2026-10-17T18:42:10.000Z', message: 'Committed data.json (week 6).' };

function popup(result, extra) {
  const ctx = load(Object.assign({ result }, extra || {}));
  ctx.publishNow();
  return ctx._events;
}

A.run('Publicar button (bound project)', [
  ['published: toast first, then the publisher, then the popup with week, short sha and local time', () => {
    const ev = popup(PUBLISHED);
    A.deep(ev, ['toast:Publicando...', 'publish', 'alert:Publicado. Semana 6, commit abc1234, 13:42']);
  }],

  ['no_changes, busy: the exact Spanish messages', () => {
    A.equal(popup({ status: 'no_changes', week: 6, commitSha: '', updatedAt: '', message: 'No changes' })[2], 'alert:Sin cambios. data.json ya estaba al día.');
    A.equal(popup({ status: 'busy', week: 0, commitSha: '', updatedAt: '', message: '' })[2], 'alert:Ya se está publicando. Intenta en un minuto.');
  }],

  ['error: the reason follows "No se publicó:"', () => {
    A.equal(popup({ status: 'error', message: 'GitHub write failed (409) for data.json' })[2], 'alert:No se publicó: GitHub write failed (409) for data.json');
  }],

  ['error: missing properties is shown as it is, the properties live in this same project', () => {
    const m = popup({ status: 'error', message: 'Missing Script properties. Set GITHUB_TOKEN, GITHUB_REPO and SHEET_ID in Project Settings.' })[2];
    A.match(m, /^alert:No se publicó: Missing Script properties/);
  }],

  ['a publisher that throws still ends in the error popup', () => {
    const ev = popup(null, { throws: 'Library not authorized' });
    A.deep(ev, ['toast:Publicando...', 'publish', 'alert:No se publicó: Library not authorized']);
  }],

  ['an unknown or empty status is an error popup, never a blank one', () => {
    A.match(popup({ status: 'weird' })[2], /^alert:No se publicó: estado desconocido weird/);
    A.match(popup(undefined)[2], /^alert:No se publicó: sin respuesta/);
  }],

  ['no UI in this run (editor, workbook closed): the answer goes to a long toast and the log, nothing throws', () => {
    const ctx = load({ result: PUBLISHED, noUi: true, logs: true });
    ctx.publishNow();
    A.deep(ctx._events, ['toast:Publicando...', 'publish', 'toast:Publicado. Semana 6, commit abc1234, 13:42']);
  }],

  ['the Tribune menu offers Publicar and runs publishNow', () => {
    const ctx = load({});
    ctx.onOpen();
    A.equal(ctx._menus.length, 1);
    A.equal(ctx._menus[0].name, 'Tribune');
    A.deep(ctx._menus[0].items, [['Publicar', 'publishNow']]);
  }],

  ['setupPublishButton puts the image at K1 on Tribune and assigns publishNow', () => {
    const ctx = load({});
    ctx.setupPublishButton();
    A.ok(ctx._events.includes('widths'), 'Warnings columns narrowed');
    A.equal(ctx._images.length, 1);
    const img = ctx._images[0];
    A.equal(img.col, 11, 'column K');
    A.equal(img.row, 1);
    A.equal(img.script, 'publishNow');
    A.equal(img.alt, 'Publicar button');
    A.match(img.url, /^https:\/\/[a-z0-9-]+\.github\.io\/fourth-and-beers\/assets\/publicar\.png$/);
  }],

  ['setupPublishButton is repeatable: it replaces its own button and leaves other images alone', () => {
    const other = { script: 'otraCosa', getAltTextTitle: () => '', remove() { throw new Error('touched a foreign image'); } };
    const ctx = load({});
    ctx._images.push(other);
    ctx.setupPublishButton(); ctx.setupPublishButton();
    A.equal(ctx._images.filter(i => i.script === 'publishNow').length, 1, 'one button');
    A.ok(ctx._images.includes(other), 'foreign image kept');
  }],

  ['setupPublishButton without a Tribune tab says so', () => {
    let msg = '';
    try { load({ noTab: true }).setupPublishButton(); } catch (e) { msg = e.message; }
    A.match(msg, /No hay pestaña Tribune/);
  }],

  ['placement: K1 is right of everything Publish.js writes on the Tribune tab, and the button writes no cell', () => {
    const pub = fs.readFileSync(path.join(ROOT, 'gas', 'Publish.js'), 'utf8');
    const warnCol = Number(/var WARN_COL = (\d+)/.exec(pub)[1]);
    const warnWidth = /var WARN_HEADER = \[([^\]]*)\]/.exec(pub)[1].split(',').length;
    const lastUsed = warnCol + warnWidth - 1;           // J
    const buttonCol = Number(/var BUTTON_COL = (\d+)/.exec(CODE)[1]);
    A.equal(lastUsed, 10, 'Warnings table ends at J');
    A.ok(buttonCol > lastUsed, 'button column ' + buttonCol + ' is right of ' + lastUsed);
    A.ok(!/\.(getRange|setValue|setValues|insertRow|insertColumn|deleteRow|deleteColumn|clear|moveRows|moveColumns)/.test(CODE.replace(/\/\/.*$/gm, '')), 'no cell is read, written, moved or cleared');
  }],

  ['manifest: one project, no library, no web app, explicit scopes', () => {
    const man = JSON.parse(fs.readFileSync(path.join(BOUND, 'appsscript.json'), 'utf8'));
    A.ok(!man.dependencies, 'no libraries');
    A.deep(man.oauthScopes.slice().sort(), [
      'https://www.googleapis.com/auth/script.container.ui',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/script.scriptapp',
      'https://www.googleapis.com/auth/spreadsheets',
    ]);
    A.ok(!man.webapp, 'no web app');
  }],

  ['Code.js and Publish.js load into one project without clashing, and publishNow reaches the real publishManual', () => {
    const pub = fs.readFileSync(path.join(ROOT, 'gas', 'Publish.js'), 'utf8');
    const names = src => (src.match(/^(?:function|var)\s+([A-Za-z_$][\w$]*)/gm) || []).map(l => l.replace(/^(?:function|var)\s+/, ''));
    const mine = new Set(names(CODE));
    const clash = names(pub).filter(n => mine.has(n));
    A.deep(clash, [], 'no shared global names');
    A.match(CODE, /result = publishManual\(\);/);
    A.match(pub, /^function publishManual\(\)/m);
    A.ok(!/Leaderboard\./.test(CODE), 'no library call left');
  }],

  ['privacy: the workbook id never reaches git. .clasp.json is ignored, only the template is tracked', () => {
    const ign = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
    A.ok(ign.includes('gas/.clasp.json'), '.gitignore lists gas/.clasp.json');
    A.ok(!fs.existsSync(path.join(BOUND, '.clasp.json')) || /gas\/\.clasp\.json/.test(execFileSync('git', ['check-ignore', '-v', 'gas/.clasp.json'], { cwd: ROOT, encoding: 'utf8' })), 'git ignores it');
    const tracked = execFileSync('git', ['ls-files', 'gas'], { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/);
    A.ok(!tracked.includes('gas/.clasp.json'), 'not tracked');
    const ex = JSON.parse(fs.readFileSync(path.join(BOUND, '.clasp.json.example'), 'utf8'));
    A.match(ex.scriptId, /^SCRIPT_ID/);
    A.match(ex.parentId[0], /^PARTICIPANTS/);
    ['Code.js', 'appsscript.json', '.clasp.json.example'].forEach(f => {
      const text = fs.readFileSync(path.join(BOUND, f), 'utf8');
      A.ok(!/[A-Za-z0-9_-]{40,}/.test(text), f + ' holds no id or token');
    });
  }],

  ['workflows: tests.yml runs the suite, a publish does not start it, and nothing pushes to Apps Script from GitHub', () => {
    const dir = path.join(ROOT, '.github', 'workflows');
    A.deep(fs.readdirSync(dir), ['tests.yml'], 'tests.yml is the only workflow');
    const t = fs.readFileSync(path.join(dir, 'tests.yml'), 'utf8');
    A.match(t, /node test\/run_all\.js/);
    A.ok(!/data\.json|editions/.test(t.replace(/#.*$/gm, '')), 'a publish (data.json, editions/) does not start the tests');
    A.ok(!/secrets\.|clasp/.test(t.replace(/#.*$/gm, '')), 'no secrets and no clasp');
    A.ok(!/[A-Za-z0-9_-]{40,}/.test(t), 'no id or token');
  }],

  ['the button image is a real 200x48 PNG that Pages serves from assets/', () => {
    const png = fs.readFileSync(path.join(ROOT, 'assets', 'publicar.png'));
    A.equal(png.slice(1, 4).toString('latin1'), 'PNG');
    A.equal(png.readUInt32BE(16), 200, 'width');
    A.equal(png.readUInt32BE(20), 48, 'height');
    A.ok(png.length < 20000, 'small');
  }],
]);
