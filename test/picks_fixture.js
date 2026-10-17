'use strict';
// Week 5 Yahoo Group Picks, from test/fixtures/week5-grouppicks.txt (pipe separated). The Winner row and the +/- marks
// are not part of Yahoo's paste: they are the expected answer and Yahoo's own correct/incorrect marks, for assertions only.
const fs = require('fs');
const path = require('path');

const lines = fs.readFileSync(path.join(__dirname, 'fixtures', 'week5-grouppicks.txt'), 'utf8').split(/\r?\n/).filter(Boolean).map(l => l.split('|'));
const favored = lines[0].slice(1), spread = lines[1].slice(1), underdog = lines[2].slice(1), winner = lines[3].slice(1);
const sets = lines.slice(4).map(r => ({
  name: r[0],
  points: Number(r[16]),
  cells: r.slice(1, 16).map(c => {
    if (!c) return null;
    const m = /^(\w+)\((\d+)\)([+-])$/.exec(c);
    return { team: m[1], conf: Number(m[2]), mark: m[3] };
  }),
}));

/** The paste as Yahoo gives it: header rows, "Team Name | Points", then one row per pick set. Every third cell has the confidence on a second line. */
function paste(opts) {
  opts = opts || {};
  const rows = [['Favored'].concat(favored), ['Spread'].concat(spread), ['Underdog'].concat(underdog), ['Team Name', 'Points']];
  sets.forEach((s, i) => {
    const pts = opts.points && opts.points[s.name] != null ? opts.points[s.name] : s.points;
    rows.push([s.name].concat(s.cells.map((c, g) => !c ? '' : ((g + i) % 3 === 0 ? c.team + '\n(' + c.conf + ')' : c.team + ' (' + c.conf + ')')), [String(pts)]));
  });
  return rows;
}
/** The same paste when it lands as tab-separated text in column A. */
function pasteTabbed(opts) { return paste(opts).map(r => [r.join('\t')]); }

/** PickEm_Board rows (Yahoo's weekly table) with weeks 1 to 5 of the real week 5 data. */
function board5() {
  const W5 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'week5.json'), 'utf8'));
  const head = ['Rank', 'Pick Set Name'];
  for (let w = 1; w <= 18; w++) head.push('Wk ' + w);
  head.push('Total', 'Dropped');
  const rows = [['Fourth and Beers 2026'], [], head];
  W5.pickem.forEach((p, i) => {
    const r = [String(i + 1), p.name];
    for (let w = 0; w < 18; w++) r.push(w < p.weeks.length ? String(p.weeks[w]) : '');
    r.push(String(p.total), String(p.dropped));
    rows.push(r);
  });
  return rows;
}

const WINNER_RES = winner.map((w, g) => w.toUpperCase() === favored[g].toUpperCase() ? 'F' : w.toUpperCase() === underdog[g].toUpperCase() ? 'U' : 'P');

module.exports = { favored, spread, underdog, winner, sets, paste, pasteTabbed, board5, WINNER_RES };

/** data.json "picks" for week 5, built by the publisher itself from the paste (so the page tests use the real shape). */
function picks5(pasteRows) {
  const { makeSheet, makeWorkbook, makeGithub, loadPublisher } = require('./mock_gas');
  const ws = makeWorkbook('participants', [makeSheet('PickEm_Board', board5()), makeSheet('Picks_Board', pasteRows || paste())]);
  const ctx = loadPublisher({ participants: ws, model: makeWorkbook('model', []), github: makeGithub(null) });
  const warn = [];
  const d = ctx.buildData_(ctx.SpreadsheetApp.openById('participants'), ctx.SpreadsheetApp.openById('model'), null, warn);
  return { picks: JSON.parse(JSON.stringify(d.picks)), warn };
}
module.exports.picks5 = picks5;
