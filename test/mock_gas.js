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

function makeSheet(name, rows) {
  return {
    getName: () => name,
    getDataRange: () => ({ getDisplayValues: () => pad(rows).map(r => r.map(String)) }),
  };
}

function makeWorkbook(name, sheets) {
  return {
    getName: () => name,
    getUrl: () => 'https://example.test/' + name,
    getSheets: () => sheets,
  };
}

/** A fake repo holding one file. state.file is {text, sha} or null. state.puts records every commit. */
function makeGithub(initialText) {
  const state = { file: initialText == null ? null : { text: initialText, sha: 'sha0' }, puts: [], gets: 0, n: 0 };
  function reply(code, obj) { return { getResponseCode: () => code, getContentText: () => JSON.stringify(obj) }; }
  function fetch(url, opts) {
    opts = opts || {};
    if (String(opts.method || 'get').toLowerCase() === 'put') {
      const body = JSON.parse(opts.payload);
      if (state.file && body.sha !== state.file.sha) return reply(409, { message: 'sha mismatch' });
      if (!state.file && body.sha) return reply(422, { message: 'unexpected sha' });
      const created = !state.file;
      state.file = { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: 'sha' + (++state.n) };
      state.puts.push({ message: body.message, branch: body.branch, hadSha: !!body.sha, text: state.file.text, auth: opts.headers && opts.headers.Authorization });
      return reply(created ? 201 : 200, {});
    }
    state.gets++;
    if (!state.file) return reply(404, { message: 'Not Found' });
    // The real API wraps base64 every 60 characters with newlines.
    const b64 = Buffer.from(state.file.text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');
    return reply(200, { sha: state.file.sha, content: b64 });
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
    SpreadsheetApp: { openById: id => { if (!books[id]) throw new Error('unknown workbook ' + id); return books[id]; } },
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
