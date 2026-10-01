'use strict';
// Reads the version stamps (v functionality, c content) and checks they were bumped.
//   node versions.js print   one line: page v, page c, publisher v, publisher c
//   node versions.js check   exits 1 if a file changed since HEAD but its stamp did not
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const V = '(v\\d+\\.\\d+\\.\\d+) (c\\d+\\.\\d+\\.\\d+)';

const FILES = {
  page: { file: 'index.html', re: new RegExp('^\\s*' + V + '\\s*$', 'm') },
  publisher: { file: 'gas/Publish.js', re: new RegExp('^// ' + V, 'm') },
  doc: { file: 'docs/LEADERBOARD_ARCHITECTURE.html', re: new RegExp('<dt>This document</dt><dd>' + V + '</dd>') },
};

function parse(text, re) { const m = re.exec(text); return m ? m[1] + ' ' + m[2] : null; }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function versionOf(kind) { return parse(read(FILES[kind].file), FILES[kind].re); }

function git(args) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
function inHead(rel) { try { git(['cat-file', '-e', 'HEAD:' + rel]); return true; } catch (e) { return false; } }
function changed(rel) { try { git(['diff', '--quiet', 'HEAD', '--', rel]); return false; } catch (e) { return true; } }
function headVersion(kind) { try { return parse(git(['show', 'HEAD:' + FILES[kind].file]), FILES[kind].re); } catch (e) { return null; } }

function check() {
  const problems = [];
  Object.keys(FILES).forEach(kind => {
    const f = FILES[kind];
    const now = versionOf(kind);
    if (!now) { problems.push(f.file + ': no version stamp found'); return; }
    if (!inHead(f.file)) return; // new file, nothing to compare with
    if (changed(f.file) && now === headVersion(kind)) problems.push(f.file + ' changed since the last commit but is still ' + now);
  });
  return problems;
}

module.exports = { FILES, parse, read, versionOf };

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'print') {
    const p = versionOf('page'), u = versionOf('publisher');
    if (!p || !u) { console.error('Could not read the page or publisher version.'); process.exit(1); }
    console.log(p + ' ' + u);
  } else if (cmd === 'check') {
    const problems = check();
    if (problems.length) { problems.forEach(x => console.log(x)); process.exit(1); }
  } else { console.error('usage: node versions.js print|check'); process.exit(2); }
}
