#!/usr/bin/env node
'use strict';
// Single entry point for the whole suite. Static checks first, then the publisher and page tests.
// Runs everything, prints PASS/FAIL per script, exits non-zero if anything failed so deploy.bat can gate on it.
const { execFileSync } = require('child_process');
const path = require('path');

const STATIC_CHECKS = [
  ['Version stamps', 'check_versions.js'],
];

const TEST_SCRIPTS = [
  ['Publish.js (mock Apps Script)', 'publish.test.js'],
  ['index.html (jsdom)', 'page.test.js'],
];

let failures = 0;
const results = [];

function runOne(label, file) {
  try {
    const out = execFileSync('node', [path.join(__dirname, file)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    results.push({ label, pass: true, out: out.trim() });
  } catch (e) {
    failures++;
    results.push({ label, pass: false, out: ((e.stdout || '') + (e.stderr || '')).trim() });
  }
}

STATIC_CHECKS.forEach(([label, f]) => runOne(label, f));
TEST_SCRIPTS.forEach(([label, f]) => runOne(label, f));

results.forEach(r => {
  console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.label);
  if (r.out) r.out.split('\n').forEach(l => console.log('       ' + l));
});
console.log('');
console.log(failures === 0 ? 'All ' + results.length + ' test scripts passed.' : failures + ' of ' + results.length + ' test scripts FAILED.');
process.exit(failures === 0 ? 0 : 1);
