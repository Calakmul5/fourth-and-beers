'use strict';
// Minimal mock of the Apps Script services that gas/Publish.js touches, plus a fake
// GitHub Contents API. No live Google or GitHub access.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function pad(rows) {
  const w = Math.max.apply(null, rows.map(r => r.length).concat([1]));
  return rows.map(r => { const o = r.slice(); while (o.length < w) o.push(''); return o; });
}

/** A sheet backed by a plain array of rows. Writes are kept, formatting calls are recorded on sheet.log. */
function makeSheet(name, rows) {
  const data = rows.map(r => r.slice());
  const log = { bold: [], checkboxes: [], frozen: 0, widths: {}, wrap: [], validations: [], cleared: [], writes: 0, inserted: [] };
  let maxCols = 0, maxRows = 0;
  const bgs = {};
  const vmap = {};                 // 'row,col' -> data validation (a checkbox is 'checkbox')
  const each = (row, col, nr, nc, fn) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) fn((row + i) + ',' + (col + j), row + i, col + j); };
  function range(row, col, nr, nc) {
    const self = {
      setValues(vals) {
        log.writes++;
        for (let i = 0; i < vals.length; i++) {
          while (data.length < row + i) data.push([]);
          const line = data[row + i - 1];
          for (let j = 0; j < vals[i].length; j++) { while (line.length < col + j) line.push(''); line[col + j - 1] = vals[i][j]; }
        }
        return self;
      },
      getValue() { const line = data[row - 1]; return line && line[col - 1] != null ? line[col - 1] : ''; },
      setValue(v) { return self.setValues([[v]]); },
      setBackground(c) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { const k = (row + i) + ',' + (col + j); if (c == null) delete bgs[k]; else bgs[k] = c; } return self; },
      getBackgrounds() { const out = []; for (let i = 0; i < nr; i++) { const l = []; for (let j = 0; j < nc; j++) l.push(bgs[(row + i) + ',' + (col + j)] || '#ffffff'); out.push(l); } return out; },
      setFontWeight(w) { log.bold.push([row, col, nr, nc, w]); return self; },
      insertCheckboxes() { log.checkboxes.push('r' + row + 'c' + col); each(row, col, nr, nc, k => { vmap[k] = 'checkbox'; }); return self; },
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const l = []; for (let j = 0; j < nc; j++) { const line = data[row + i - 1]; l.push(line && line[col + j - 1] != null ? line[col + j - 1] : ''); } out.push(l); } return out; },
      getDataValidations() { const out = []; for (let i = 0; i < nr; i++) { const l = []; for (let j = 0; j < nc; j++) l.push(vmap[(row + i) + ',' + (col + j)] || null); out.push(l); } return out; },
      clearDataValidations() { each(row, col, nr, nc, k => { delete vmap[k]; }); return self; },
      setWrap() { log.wrap.push('r' + row + 'c' + col); return self; },
      setDataValidation(rule) { log.validations.push({ at: 'r' + row + 'c' + col, rule }); each(row, col, nr, nc, k => { vmap[k] = rule; }); return self; },
      clearContent() {
        log.cleared.push([row, col, nr, nc]);
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { const line = data[row + i - 1]; if (line && col + j - 1 < line.length) line[col + j - 1] = ''; }
        return self;
      },
    };
    return self;
  }
  const sheet = {
    log,
    getName: () => name,
    setName(n) { name = n; },
    getMaxColumns: () => Math.max(maxCols || 0, ...data.map(r => r.length), 1),
    getMaxRows: () => Math.max(data.length, 1000, maxRows),
    vmap: (r, c) => vmap[r + ',' + c] || null,
    insertRowsAfter(r, n) { for (let i = 0; i < n; i++) data.splice(r, 0, []); maxRows = Math.max(maxRows, r + n); },
    insertColumnAfter(c) {
      log.inserted.push(c);
      // Like Sheets: columns right of c shift, and the new column copies the format (background, validation) of column c.
      [bgs, vmap].forEach(m => {
        Object.keys(m).map(k => k.split(',').map(Number)).filter(p => p[1] > c).sort((a, b) => b[1] - a[1]).forEach(p => { m[p[0] + ',' + (p[1] + 1)] = m[p[0] + ',' + p[1]]; delete m[p[0] + ',' + p[1]]; });
        Object.keys(m).map(k => k.split(',').map(Number)).filter(p => p[1] === c).forEach(p => { m[p[0] + ',' + (c + 1)] = m[p[0] + ',' + c]; });
      }); data.forEach(r => { while (r.length < c) r.push(''); r.splice(c, 0, ''); }); maxCols = Math.max(maxCols || 0, ...data.map(r => r.length)); },
    getDataRange: () => ({
      getDisplayValues: () => pad(data).map(r => r.map(String)),
      getValues: () => pad(data),
    }),
    getRange(a, b, c, d) {
      if (typeof a === 'string') { const m = /^([A-Z])(\d+)/.exec(a); return range(Number(m[2]), m[1].charCodeAt(0) - 64, 1, 1); }
      return range(a, b, c || 1, d || 1);
    },
    setFrozenRows(n) { log.frozen = n; },
    setColumnWidth(c, w) { log.widths[c] = w; },
    bg: (r, c) => bgs[r + ',' + (c || 1)] || null,
    rows: () => data,
  };
  return sheet;
}

function makeWorkbook(name, sheets) {
  return {
    getName: () => name,
    getUrl: () => 'https://example.test/' + name,
    getSheets: () => sheets,
    insertSheet(n) { const sh = makeSheet(n, []); sheets.push(sh); return sh; },
    deleteSheet(sh) { const i = sheets.indexOf(sh); if (i >= 0) sheets.splice(i, 1); },
  };
}

/**
 * A fake repo. state.files maps a repo path to {text, sha}. state.file is data.json, kept for short tests.
 * state.puts records every commit, in order, with its path.
 */
function makeGithub(initialText, extra) {
  const state = { files: {}, puts: [], gets: 0, n: 0 };
  if (initialText != null) state.files['data.json'] = { text: initialText, sha: 'sha0' };
  Object.keys(extra || {}).forEach(p => { state.files[p] = { text: extra[p], sha: 'sha-' + p }; });
  Object.defineProperty(state, 'file', { get: () => state.files['data.json'] || null });
  function reply(code, obj) { return { getResponseCode: () => code, getContentText: () => JSON.stringify(obj) }; }
  function fetch(url, opts) {
    opts = opts || {};
    const path = /\/contents\/([^?]+)/.exec(url)[1];
    const cur = state.files[path] || null;
    if (String(opts.method || 'get').toLowerCase() === 'put') {
      const body = JSON.parse(opts.payload);
      if (cur && body.sha !== cur.sha) return reply(409, { message: 'sha mismatch' });
      if (!cur && body.sha) return reply(422, { message: 'unexpected sha' });
      state.files[path] = { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: 'sha' + (++state.n) };
      state.puts.push({ path, message: body.message, branch: body.branch, hadSha: !!body.sha, text: state.files[path].text, auth: opts.headers && opts.headers.Authorization });
      return reply(cur ? 200 : 201, {});
    }
    state.gets++;
    if (!cur) return reply(404, { message: 'Not Found' });
    // The real API wraps base64 every 60 characters with newlines.
    const b64 = Buffer.from(cur.text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');
    return reply(200, { sha: cur.sha, content: b64 });
  }
  return { state, fetch };
}

/**
 * Builds a vm context with Publish.js loaded.
 * opts: participants and model (workbooks), github (makeGithub result), props (extra script properties)
 */
function loadPublisher(opts) {
  const logs = [];
  const props = Object.assign({ GITHUB_TOKEN: 'test-token', GITHUB_REPO: 'owner/repo', SHEET_ID: 'participants', MODEL_SHEET_ID: 'model' }, opts.props || {});
  const books = { participants: opts.participants, model: opts.model };
  const context = {
    Logger: { log: m => logs.push(String(m)) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: {
      openById: id => { if (!books[id]) throw new Error('unknown workbook ' + id); return books[id]; },
      newDataValidation: () => {
        const rule = {};
        const b = { requireValueInList(list, dropdown) { rule.list = list; rule.dropdown = dropdown; return b; }, setAllowInvalid(v) { rule.allowInvalid = v; return b; }, build: () => rule };
        return b;
      },
    },
    UrlFetchApp: { fetch: opts.github.fetch },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      base64Encode: s => Buffer.from(String(s), 'utf8').toString('base64'),
      base64Decode: s => Buffer.from(s, 'base64'),
      newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
      sleep() {},
    },
    ScriptApp: {},
  };
  vm.createContext(context);
  const file = path.join(__dirname, '..', 'gas', 'Publish.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: 'Publish.js' });
  context._logs = logs;
  return context;
}

module.exports = { makeSheet, makeWorkbook, makeGithub, loadPublisher };
