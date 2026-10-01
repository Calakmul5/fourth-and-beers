'use strict';
// Static check: every versioned file carries a readable "v major.minor.bug c major.minor.bug" stamp,
// and the architecture doc says the same thing in its masthead and its footer.
const A = require('./assert');
const V = require('./versions');

A.run('Version stamps', [
  ['page, publisher and doc each carry a stamp', () => {
    ['page', 'publisher', 'doc'].forEach(k => A.ok(V.versionOf(k), k + ' stamp'));
  }],
  ['the doc masthead and footer agree', () => {
    const doc = V.read(V.FILES.doc.file);
    const mast = V.versionOf('doc');
    const foot = /Document (v\d+\.\d+\.\d+ c\d+\.\d+\.\d+)\./.exec(doc);
    A.ok(foot, 'footer stamp');
    A.equal(foot[1], mast, 'footer matches masthead');
  }],
]);
