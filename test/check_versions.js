'use strict';
// Static check: every versioned file carries a readable "v major.minor.bug c major.minor.bug" stamp,
// and the architecture doc and CLAUDE.md name the same versions as the files themselves.
const A = require('./assert');
const V = require('./versions');

const ST = '(v\\d+\\.\\d+\\.\\d+ c\\d+\\.\\d+\\.\\d+)';

function findIn(text, pattern, label) {
  const m = new RegExp(pattern).exec(text);
  A.ok(m, label + ' not found');
  return m[1];
}

A.run('Version stamps', [
  ['page, publisher and doc each carry a stamp', () => {
    ['page', 'publisher', 'doc'].forEach(k => A.ok(V.versionOf(k), k + ' stamp'));
  }],
  ['the doc masthead and footer agree', () => {
    const doc = V.read(V.FILES.doc.file);
    const mast = V.versionOf('doc');
    const foot = new RegExp('Document ' + ST + '\\.').exec(doc);
    A.ok(foot, 'footer stamp');
    A.equal(foot[1], mast, 'footer matches masthead');
  }],
  ['the doc names the same page and publisher versions as index.html and Publish.js', () => {
    const doc = V.read(V.FILES.doc.file);
    const page = V.versionOf('page'), pub = V.versionOf('publisher');
    A.equal(findIn(doc, '<dt>Page</dt><dd>' + ST + '</dd>', 'masthead page version'), page, 'masthead page version');
    A.equal(findIn(doc, '<dt>Publisher</dt><dd>' + ST + '</dd>', 'masthead publisher version'), pub, 'masthead publisher version');
    A.equal(findIn(doc, 'index\\.html</td><td class="m">' + ST + '</td>', 'source table page version'), page, 'source table page version');
    A.equal(findIn(doc, 'Publish\\.gs</td><td class="m">' + ST + '</td>', 'source table publisher version'), pub, 'source table publisher version');
    A.equal(findIn(doc, '<title>index\\.html ' + ST + '\\.', 'diagram node page version'), page, 'diagram node page version');
  }],
  ['CLAUDE.md "Current versions" matches the files', () => {
    const md = V.read('CLAUDE.md');
    const get = f => findIn(md, '(?:^|\\n)- ' + f.replace(/\./g, '\\.') + ' ' + ST, f + ' line in CLAUDE.md');
    A.equal(get('index.html'), V.versionOf('page'), 'CLAUDE.md index.html');
    A.equal(get('Publish.js'), V.versionOf('publisher'), 'CLAUDE.md Publish.js');
    A.equal(get('docs/LEADERBOARD_ARCHITECTURE.html'), V.versionOf('doc'), 'CLAUDE.md doc');
  }],
]);
