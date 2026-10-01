'use strict';
// Minimal assert helper shared by every test script, same shape as the model's.
// Every assertion throws with a clear message, so a script's exit code is meaningful.
let count = 0;

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every(k => deepEqual(a[k], b[k]));
}

function equal(actual, expected, label) {
  count++;
  if (actual !== expected) {
    throw new Error((label ? label + ': ' : '') + 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

function deep(actual, expected, label) {
  count++;
  if (!deepEqual(actual, expected)) {
    throw new Error((label ? label + ': ' : '') + 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

function ok(value, label) {
  count++;
  if (!value) throw new Error((label ? label + ': ' : '') + 'expected truthy, got ' + JSON.stringify(value));
}

function match(text, re, label) {
  count++;
  if (!re.test(text)) throw new Error((label ? label + ': ' : '') + 'expected ' + re + ' to match ' + JSON.stringify(String(text).slice(0, 200)));
}

function noMatch(text, re, label) {
  count++;
  if (re.test(text)) throw new Error((label ? label + ': ' : '') + 'expected ' + re + ' NOT to match ' + JSON.stringify(String(text).slice(0, 200)));
}

// Runs named cases one after another, reports every failure, exits non-zero if any failed.
async function run(title, cases) {
  const failed = [];
  for (const [name, fn] of cases) {
    try { await fn(); } catch (e) { failed.push(name + ': ' + (e && e.message ? e.message : e)); }
  }
  if (failed.length) {
    console.log(title + ': ' + failed.length + ' of ' + cases.length + ' case(s) FAILED');
    failed.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log(title + ': ' + cases.length + ' case(s), ' + count + ' assertion(s) passed');
  process.exit(0);
}

module.exports = { equal, deep, ok, match, noMatch, run };
