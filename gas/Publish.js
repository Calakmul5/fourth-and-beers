// Fourth & Beers 2026 - publish the Tribune data to GitHub Pages
// v2.0.0 c1.2.0
//
// What it does
//   1. Reads the Yahoo Pick'em leaderboard pasted into the PickEm_Board tab of the participants workbook.
//   2. Reads Survivor strikes from the model's Field tab.
//   3. Reads the "Fan of" column from the participants list (call signs only, never emails).
//   4. Reads the Tribune tab and publishes the rows checked for the current week:
//      Portada, Columna, Clasificado and Dato.
//   5. Keeps the Survivor elimination order (who went out, which week) by carrying it over from the last data.json.
//   6. Builds data.json and commits it to the GitHub repo. GitHub Pages republishes the page by itself.
//   7. Archives the week: editions/semana-NN.json is a full copy of that week's data.json and
//      editions/index.json lists the weeks. A week that has moved on is never touched again.
//   It only commits when something other than "updated" changed, so running it often is harmless.
//
// One-time setup (Project Settings > Script properties)
//   GITHUB_TOKEN  fine-grained token, this one repo only, permission Contents: Read and write
//   GITHUB_REPO   owner/repo, for example yourname/fourth-and-beers
//   SHEET_ID        workbook that holds the PickEm_Board and Tribune tabs (participants workbook)
//   MODEL_SHEET_ID  model workbook that holds the Field tab (Survivor strikes). Optional, defaults to SHEET_ID.
// Then run installTriggers() once from the editor and approve the permissions.
// Run setupTribuneTab() once to create the Tribune tab with its dropdown and checkboxes.
// Moving from the old tabs: run migrateToTribune(true) to see what would move, then migrateToTribune(false).
// Once the migration has run, migrateToTribune and LEGACY_TABS can be deleted.

var CFG = {
  boardTab: 'PickEm_Board',   // paste Yahoo's weekly performance table here, header row included
  tribuneTab: 'Tribune',      // Semana | Sección | Para | Título | Texto | Publicar (checkbox), in the participants workbook
  fieldTab: 'Field',          // model tab with Entrant / Strikes columns
  path: 'data.json',
  editionsDir: 'editions',
  branch: 'main',
  season: 2026,
  weeks: 18
};

// Prize money from the reglamento, published as data.json "prizes". After the weekly $50s the pot splits
// 30/10 regular, 30/10 Survivor and 20 playoffs. This is the only place the amounts are written.
var PRIZES = {
  regular: [1050, 350],
  survivor: [1050, 350],
  playoffs: [700],
  weekly: 50,
  weeks: 18
};

// Values of the Sección dropdown in the Tribune tab.
var SECTIONS = ['Portada', 'Columna', 'Clasificado', 'Dato'];
var TRIBUNE_HEADER = ['Semana', 'Sección', 'Para', 'Título', 'Texto', 'Publicar'];

// Old tabs, read only by migrateToTribune.
var LEGACY_TABS = { comments: 'Comentarios', awards: 'Premios' };

// Survivor call sign -> Pick'em call sign. Only the names that differ. Update if Yahoo names change.
var SURVIVOR_TO_PICKEM = {
  "Beeeeeerman": "This is our year",
  "My First-Rate Pick Set": "Steel Man",
  "Nem's Pick Set": "Chitown'DemBoyz",
  "My Dandy Pick Set": "Puto el que lo lea",
  "Manuel's marvelous picks": "Manolito's winning picks",
  "My Great Pick Set": "Jorge_B",
  "JuanGana": "Juan1768",
  "My Amazing Pick Set": "SinCasco",
  "XMen": "X-Men Let's go Boys"
};

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Run by hand or by trigger. Builds data.json and commits it if anything changed. */
function publishLeaderboard() {
  var lock = LockService.getScriptLock();
  lock.waitLock(60000); // a burst of checkbox clicks runs one at a time
  try { return publishLeaderboard_(); } finally { lock.releaseLock(); }
}

function publishLeaderboard_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('GITHUB_TOKEN');
  var repo = props.getProperty('GITHUB_REPO');
  var sheetId = props.getProperty('SHEET_ID');
  if (!token || !repo || !sheetId) {
    throw new Error('Missing Script properties. Set GITHUB_TOKEN, GITHUB_REPO and SHEET_ID in Project Settings.');
  }
  var ss = SpreadsheetApp.openById(String(sheetId).trim());
  var modelId = props.getProperty('MODEL_SHEET_ID');
  var model = modelId ? SpreadsheetApp.openById(String(modelId).trim()) : ss;
  var cur = readFile_(repo, token, CFG.path);
  var data = buildData_(ss, model, cur ? cur.data : null);
  var result = commitAll_(repo, token, data, cur);
  Logger.log(result);
  return result;
}

/** Installable onEdit: publishes after a paste into PickEm_Board or a change in Tribune. */
function onBoardEdit(e) {
  if (!e || !e.range) return;
  var name = e.range.getSheet().getName().trim().toLowerCase();
  if (name !== CFG.boardTab.toLowerCase() && name !== CFG.tribuneTab.toLowerCase()) return;
  Utilities.sleep(5000); // let a large paste or a few quick checkbox clicks land
  publishLeaderboard();
}

/** Run once, safe to repeat. Creates the Tribune tab with its header, Sección dropdown and Publicar checkboxes. */
function setupTribuneTab() {
  var ss = SpreadsheetApp.openById(String(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).trim());
  setupTribune_(ss);
  Logger.log('Tribune tab ready in ' + ss.getName());
}

function setupTribune_(ss) {
  var sh = findTab_(ss, CFG.tribuneTab) || ss.insertSheet(CFG.tribuneTab);
  sh.getRange(1, 1, 1, 6).setValues([TRIBUNE_HEADER]).setFontWeight('bold');
  sh.setFrozenRows(1);
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(SECTIONS, true).setAllowInvalid(false).build();
  sh.getRange('B2:B1000').setDataValidation(rule);
  sh.getRange('F2:F1000').insertCheckboxes();
  sh.setColumnWidth(1, 70); sh.setColumnWidth(2, 110); sh.setColumnWidth(3, 170);
  sh.setColumnWidth(4, 190); sh.setColumnWidth(5, 520); sh.setColumnWidth(6, 80);
  sh.getRange('E2:E1000').setWrap(true);
  return sh;
}

/**
 * One-off. Moves the old tabs into Tribune: Comentarios rows become Columna, Premios rows become Clasificado.
 * dryRun true (the default): logs row counts per source and per week, writes nothing.
 * dryRun false: appends to Tribune, checks the counts, and only on a match deletes Comentarios and Premios.
 * On a mismatch the appended rows are cleared again and nothing is deleted.
 * Sheets version history is the backup. Returns a report object.
 */
function migrateToTribune(dryRun) {
  var ss = SpreadsheetApp.openById(String(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).trim());
  return migrate_(ss, dryRun !== false);
}

function migrate_(ss, dryRun) {
  var src = [
    { key: 'comments', tab: LEGACY_TABS.comments, sh: findTab_(ss, LEGACY_TABS.comments) },
    { key: 'awards', tab: LEGACY_TABS.awards, sh: findTab_(ss, LEGACY_TABS.awards) }
  ];
  var rows = [], report = { dryRun: dryRun, ok: true, counts: {}, byWeek: {}, deleted: [] };
  src.forEach(function (s) {
    var out = [];
    if (s.sh) {
      var values = s.sh.getDataRange().getValues();
      for (var r = 1; r < values.length; r++) {
        var v = values[r];
        if (!v.some(function (c) { return String(c).trim() !== ''; })) continue;
        // Comentarios: Semana, Para, Texto, Publicar.  Premios: Semana, Titulo, Para, Texto, Publicar.
        out.push(s.key === 'comments'
          ? [v[0], 'Columna', v[1], '', v[2], v[3]]
          : [v[0], 'Clasificado', v[2], v[1], v[3], v[4]]);
      }
    }
    report.counts[s.tab] = out.length;
    var wk = {};
    out.forEach(function (o) { var k = String(o[0]).trim() || '(sin semana)'; wk[k] = (wk[k] || 0) + 1; });
    report.byWeek[s.tab] = wk;
    Logger.log(s.tab + ': ' + (s.sh ? out.length + ' rows' : 'tab not found') + ' ' + JSON.stringify(wk));
    rows = rows.concat(out);
  });
  if (dryRun) { Logger.log('Dry run, nothing written. ' + rows.length + ' rows would move to ' + CFG.tribuneTab + '.'); return report; }
  if (!rows.length) { Logger.log('Nothing to move.'); return report; }

  var tr = setupTribune_(ss);
  var start = lastRow_(tr) + 1;
  tr.getRange(start, 1, rows.length, 6).setValues(rows);

  // Read back what landed and compare it with the sources, per Sección and week, text included.
  var landed = tr.getDataRange().getValues().slice(start - 1).filter(function (o) {
    return o.some(function (c) { return String(c).trim() !== ''; });
  });
  var sig = function (list) {
    return list.map(function (o) { return [o[0], o[1], o[2], o[3], o[4]].map(function (c) { return String(c).trim(); }).join('|'); }).sort();
  };
  if (JSON.stringify(sig(rows)) !== JSON.stringify(sig(landed))) {
    tr.getRange(start, 1, rows.length, 6).clearContent();
    report.ok = false;
    Logger.log('Counts do not match (expected ' + rows.length + ' rows, found ' + landed.length + '). Rows cleared from ' + CFG.tribuneTab + ', nothing deleted.');
    return report;
  }
  src.forEach(function (s) {
    if (s.sh) { ss.deleteSheet(s.sh); report.deleted.push(s.tab); }
  });
  Logger.log('Moved ' + rows.length + ' rows to ' + CFG.tribuneTab + ' and deleted ' + (report.deleted.join(', ') || 'no tabs') + '.');
  return report;
}

/** Last row with anything in it (the header is row 1). */
function lastRow_(sh) {
  var v = sh.getDataRange().getValues(), last = 1;
  for (var i = 0; i < v.length; i++) if (v[i].some(function (c) { return String(c).trim() !== ''; })) last = i + 1;
  return last;
}

/** Run once. Replaces any earlier triggers from this project. */
function installTriggers() {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('Set SHEET_ID in Script properties first.');
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  // 1) publish when the board or the Tribune tab is edited (your weekly paste, the checkbox clicks)
  ScriptApp.newTrigger('onBoardEdit').forSpreadsheet(sheetId).onEdit().create();
  // 2) daily sweep, catches Survivor strike changes the model writes by script
  ScriptApp.newTrigger('publishLeaderboard').timeBased().everyDays(1).atHour(7).create();
  Logger.log('Triggers installed: onBoardEdit + daily 7am publishLeaderboard');
}

// ---------------------------------------------------------------------------
// Build data.json
// ---------------------------------------------------------------------------

function buildData_(ss, model, prev) {
  var board = readBoard_(ss);
  var strikes = readStrikes_(model || ss, board.names);
  return {
    survivorOut: survivorOut_(prev, strikes, board.week),
    fans: readFans_(ss, board.names),
    tribune: readTribune_(ss, board.week, board.names),
    season: CFG.season,
    week: board.week,
    weeks: CFG.weeks,
    updated: new Date().toISOString(),
    prizes: JSON.parse(JSON.stringify(PRIZES)),
    pickem: board.rows,
    strikes: strikes
  };
}

/** Parses Yahoo's table. Works whether the paste split into columns or landed as tab-separated text in column A. */
function readBoard_(ss) {
  var sh = findTab_(ss, CFG.boardTab);
  if (!sh) throw new Error('Tab "' + CFG.boardTab + '" not found in workbook "' + ss.getName() + '". Tabs it sees: ' +
    ss.getSheets().map(function (t) { return JSON.stringify(t.getName()); }).join(', ') +
    '. If this is the wrong workbook, fix SHEET_ID in Script properties.');
  var values = sh.getDataRange().getDisplayValues().map(function (r) {
    var cells = r.map(function (c) { return String(c).trim(); });
    var filled = cells.filter(function (c) { return c !== ''; });
    return (filled.length === 1 && filled[0].indexOf('\t') >= 0) ? filled[0].split('\t').map(function (c) { return c.trim(); }) : cells;
  });

  var h = -1;
  for (var i = 0; i < values.length; i++) {
    if (values[i].some(function (c) { return /^pick set name$/i.test(c); })) { h = i; break; }
  }
  if (h < 0) throw new Error('No header row with "Pick Set Name" in ' + CFG.boardTab + '. Paste the whole Yahoo table, header included.');

  var head = values[h];
  var col = function (re) { for (var j = 0; j < head.length; j++) if (re.test(head[j])) return j; return -1; };
  var nameC = col(/^pick set name$/i), totalC = col(/^total/i), dropC = col(/^dropped/i);
  var wkC = [];
  head.forEach(function (c, j) { var m = /^wk\s*(\d+)$/i.exec(c); if (m) wkC[Number(m[1]) - 1] = j; });
  if (nameC < 0 || !wkC.length) throw new Error('Could not find the name and week columns in ' + CFG.boardTab + '.');

  var rows = [];
  for (var r = h + 1; r < values.length; r++) {
    var v = values[r], name = v[nameC];
    if (!name) continue;
    var weeks = wkC.map(function (j) { return toNum_(v[j]); });
    rows.push({
      name: name,
      weeks: weeks,
      total: totalC >= 0 ? toNum_(v[totalC]) : null,
      dropped: dropC >= 0 ? toNum_(v[dropC]) : null
    });
  }
  if (rows.length < 2) throw new Error('Fewer than 2 players found in ' + CFG.boardTab + '.');

  // Current week = last week where anyone scored
  var week = 0;
  for (var k = 0; k < wkC.length; k++) {
    if (rows.some(function (p) { return p.weeks[k] > 0; })) week = k + 1;
  }
  if (week === 0) throw new Error('No scores yet in ' + CFG.boardTab + '.');
  rows.forEach(function (p) { p.weeks = p.weeks.slice(0, week); });

  return { rows: rows, week: week, names: rows.map(function (p) { return p.name; }) };
}

/** Strikes keyed by Pick'em name, so the page shows one name per person. */
function readStrikes_(ss, pickemNames) {
  var out = {};
  var sh = findTab_(ss, CFG.fieldTab);
  if (!sh) { Logger.log('No ' + CFG.fieldTab + ' tab in "' + ss.getName() + '", skipping Survivor. Set MODEL_SHEET_ID to the model workbook.'); return out; }
  var values = sh.getDataRange().getDisplayValues();
  var h = -1;
  for (var i = 0; i < values.length; i++) {
    if (values[i].indexOf('Entrant') >= 0 && values[i].indexOf('Strikes') >= 0) { h = i; break; }
  }
  if (h < 0) { Logger.log('No Entrant/Strikes header in ' + CFG.fieldTab + ', skipping Survivor.'); return out; }
  var eC = values[h].indexOf('Entrant'), sC = values[h].indexOf('Strikes');

  var byNorm = {};
  pickemNames.forEach(function (n) { byNorm[norm_(n)] = n; });
  var alias = {};
  Object.keys(SURVIVOR_TO_PICKEM).forEach(function (k) { alias[norm_(k)] = SURVIVOR_TO_PICKEM[k]; });

  var missing = [];
  for (var r = h + 1; r < values.length; r++) {
    var raw = String(values[r][eC] || '').replace(/\(you\)/i, '').trim();
    if (!raw) continue;
    var target = alias[norm_(raw)] || raw;
    var pick = byNorm[norm_(target)];
    if (!pick) { missing.push(raw); continue; }
    out[pick] = toNum_(values[r][sC]);
  }
  if (missing.length) Logger.log('Survivor names with no Pick\'em match (add to SURVIVOR_TO_PICKEM): ' + missing.join(', '));
  return out;
}

/** Finds a tab by name, ignoring case and stray spaces around the name. */
function findTab_(ss, name) {
  var want = String(name).trim().toLowerCase();
  var hit = ss.getSheets().filter(function (t) { return t.getName().trim().toLowerCase() === want; });
  return hit.length ? hit[0] : null;
}

/** Run from the editor if the tab still is not found. Logs which workbook SHEET_ID opens and its tabs. */
function checkSetup() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  Logger.log('SHEET_ID: ' + JSON.stringify(id));
  var ss = SpreadsheetApp.openById(String(id).trim());
  Logger.log('Workbook: ' + ss.getName() + '  ' + ss.getUrl());
  Logger.log('Tabs: ' + ss.getSheets().map(function (t) { return JSON.stringify(t.getName()); }).join(', '));
  var mid = PropertiesService.getScriptProperties().getProperty('MODEL_SHEET_ID');
  var model = mid ? SpreadsheetApp.openById(String(mid).trim()) : ss;
  Logger.log('Model workbook: ' + model.getName());
  Logger.log('PickEm_Board found: ' + !!findTab_(ss, CFG.boardTab) + '   Tribune found: ' + !!findTab_(ss, CFG.tribuneTab) +
    '   Field found: ' + !!findTab_(model, CFG.fieldTab));
}

// NFL teams by abbreviation, plus city and nickname lookups for free-text "Fan of" values.
var NFL_TEAMS = {
  ARI: ['Arizona', 'Cardinals'], ATL: ['Atlanta', 'Falcons'], BAL: ['Baltimore', 'Ravens'], BUF: ['Buffalo', 'Bills'],
  CAR: ['Carolina', 'Panthers'], CHI: ['Chicago', 'Bears'], CIN: ['Cincinnati', 'Bengals'], CLE: ['Cleveland', 'Browns'],
  DAL: ['Dallas', 'Cowboys'], DEN: ['Denver', 'Broncos'], DET: ['Detroit', 'Lions'], GB: ['Green Bay', 'Packers'],
  HOU: ['Houston', 'Texans'], IND: ['Indianapolis', 'Colts'], JAX: ['Jacksonville', 'Jaguars'], KC: ['Kansas City', 'Chiefs'],
  LV: ['Las Vegas', 'Raiders'], LAC: ['', 'Chargers'], LAR: ['', 'Rams'], MIA: ['Miami', 'Dolphins'],
  MIN: ['Minnesota', 'Vikings'], NE: ['New England', 'Patriots'], NO: ['New Orleans', 'Saints'], NYG: ['', 'Giants'],
  NYJ: ['', 'Jets'], PHI: ['Philadelphia', 'Eagles'], PIT: ['Pittsburgh', 'Steelers'], SF: ['San Francisco', '49ers'],
  SEA: ['Seattle', 'Seahawks'], TB: ['Tampa Bay', 'Buccaneers'], TEN: ['Tennessee', 'Titans'], WAS: ['Washington', 'Commanders']
};

/** One NFL team per person (first one listed), a college team if any, or random for the non-fan. */
function parseFan_(text) {
  var raw = String(text || '').trim();
  if (!raw) return null;
  if (/league of legends|random|al azar/i.test(raw)) {
    return { random: true, other: /league of legends/i.test(raw) ? 'League of Legends' : '' };
  }
  var out = {};
  raw.split(/\s+(?:and|y)\s+|\s*[,&\/]\s*/i).forEach(function (tok) {
    var t = tok.trim();
    if (!t) return;
    var up = t.toUpperCase(), abbr = null;
    if (NFL_TEAMS[up]) abbr = up;
    else Object.keys(NFL_TEAMS).forEach(function (k) {
      var city = NFL_TEAMS[k][0].toLowerCase(), nick = NFL_TEAMS[k][1].toLowerCase(), low = t.toLowerCase();
      if ((city && low === city) || low === nick || low.indexOf(nick) >= 0) abbr = abbr || k;
    });
    if (abbr) { if (!out.nfl) out.nfl = abbr; }
    else if (!out.ncaa) out.ncaa = t;
  });
  return out;
}

/** Fan info keyed by Pick'em name, read from the tab that has "Call Sign PickEm" and "Fan of" columns. */
function readFans_(ss, pickemNames) {
  var out = {};
  var byNorm = {};
  pickemNames.forEach(function (n) { byNorm[norm_(n)] = n; });
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var values = sheets[i].getDataRange().getDisplayValues();
    for (var h = 0; h < Math.min(values.length, 10); h++) {
      var row = values[h].map(function (c) { return String(c).trim().toLowerCase(); });
      var nC = row.indexOf('call sign pickem'), fC = row.indexOf('fan of');
      if (nC < 0 || fC < 0) continue;
      for (var r = h + 1; r < values.length; r++) {
        var pick = byNorm[norm_(values[r][nC])];
        var fan = parseFan_(values[r][fC]);
        if (pick && fan) out[pick] = fan;
      }
      return out;
    }
  }
  Logger.log('No tab with "Call Sign PickEm" and "Fan of" columns, skipping fans.');
  return out;
}

/**
 * Checked rows in Tribune for this week, grouped by Sección, in sheet order.
 * Para is one or several Pick'em call signs separated by commas, or blank / Todos for everyone (published as '').
 * An unknown name is logged and published as typed. A missing tab gives an empty Tribune and the page uses its fallbacks.
 */
function readTribune_(ss, week, pickemNames) {
  var out = { portada: null, columna: [], clasificados: [], datos: [] };
  var sh = findTab_(ss, CFG.tribuneTab);
  if (!sh) return out;
  var values = sh.getDataRange().getDisplayValues();
  if (!values.length) return out;
  var head = values[0].map(plain_);
  var at = function (name, fallback) { var i = head.indexOf(name); return i >= 0 ? i : fallback; };
  var cW = at('semana', 0), cS = at('seccion', 1), cP = at('para', 2), cT = at('titulo', 3), cX = at('texto', 4), cK = at('publicar', 5);
  var byNorm = {};
  pickemNames.forEach(function (n) { byNorm[norm_(n)] = n; });

  for (var r = 1; r < values.length; r++) {
    var v = values[r], row = r + 1;
    var ok = /^(true|x|s[ií]|yes)$/i.test(String(v[cK] || '').trim());
    if (!ok || toNum_(v[cW]) !== week) continue;
    var sec = plain_(v[cS]);
    var titulo = String(v[cT] || '').trim(), texto = String(v[cX] || '').trim();
    var para = resolvePara_(v[cP], byNorm, row);
    if (sec === 'portada') {
      if (!titulo) { Logger.log('Tribune row ' + row + ' is a checked Portada without a Título, skipping it.'); continue; }
      if (out.portada) { Logger.log('Tribune row ' + row + ': only one Portada per week, skipping this one.'); continue; }
      out.portada = { titulo: titulo, texto: texto, para: para };
    } else if (sec === 'columna') {
      if (!texto) { Logger.log('Tribune row ' + row + ' is a checked Columna without Texto, skipping it.'); continue; }
      out.columna.push({ para: para, texto: texto });
    } else if (sec === 'clasificado' || sec === 'dato') {
      if (!titulo || !texto) { Logger.log('Tribune row ' + row + ' is checked but has no Título or no Texto, skipping it.'); continue; }
      (sec === 'dato' ? out.datos : out.clasificados).push({ titulo: titulo, para: para, texto: texto });
    } else {
      Logger.log('Tribune row ' + row + ' is checked but its Sección "' + String(v[cS]).trim() + '" is not one of ' + SECTIONS.join(', ') + ', skipping it.');
    }
  }
  return out;
}

/** Pick'em call signs from a Para cell. Todos and blank mean everyone and come back as ''. */
function resolvePara_(cell, byNorm, row) {
  var who = String(cell || '').split(',').map(function (t) { return t.trim(); }).filter(function (t) { return t && !/^todos$/i.test(t); });
  return who.map(function (t) {
    var hit = byNorm[norm_(t)];
    if (!hit) Logger.log('Tribune row ' + row + ': "' + t + "\" is not a Pick'em name, publishing it as typed.");
    return hit || t;
  }).join(', ');
}

/** Lowercase without accents, for matching headers and Sección values. */
function plain_(s) {
  return String(s || '').trim().toLowerCase().replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u');
}

/** Elimination order. Keeps earlier entries, drops anyone whose strikes were corrected below 3, adds new outs with this week. */
function survivorOut_(prev, strikes, week) {
  var list = (prev && prev.survivorOut) ? prev.survivorOut.slice() : [];
  list = list.filter(function (o) { return !(o.name in strikes) || strikes[o.name] >= 3; });
  Object.keys(strikes).forEach(function (n) {
    if (strikes[n] >= 3 && !list.some(function (o) { return o.name === n; })) list.push({ name: n, week: week });
  });
  return list;
}

function toNum_(s) { var n = Number(String(s).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
function norm_(s) { return String(s).replace(/[‘’`´]/g, "'").trim().toLowerCase(); }

// ---------------------------------------------------------------------------
// GitHub commit
// ---------------------------------------------------------------------------

function ghHeaders_(token) {
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function ghUrl_(repo, path) { return 'https://api.github.com/repos/' + repo + '/contents/' + path; }

/** A file in the repo, or null if it does not exist yet. */
function readFile_(repo, token, path) {
  var get = UrlFetchApp.fetch(ghUrl_(repo, path) + '?ref=' + CFG.branch, { headers: ghHeaders_(token), muteHttpExceptions: true });
  var code = get.getResponseCode();
  if (code === 404) return null;
  if (code !== 200) throw new Error('GitHub read failed (' + code + ') for ' + path + ': ' + get.getContentText());
  var cur = JSON.parse(get.getContentText());
  var text = Utilities.newBlob(Utilities.base64Decode(cur.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
  var data = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  return { sha: cur.sha, text: text, data: data };
}

function writeFile_(repo, token, path, obj, message, cur) {
  var body = {
    message: message,
    content: Utilities.base64Encode(JSON.stringify(obj, null, 1), Utilities.Charset.UTF_8),
    branch: CFG.branch
  };
  if (cur) body.sha = cur.sha;
  var put = UrlFetchApp.fetch(ghUrl_(repo, path), {
    method: 'put', headers: ghHeaders_(token), contentType: 'application/json',
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  var code = put.getResponseCode();
  if (code !== 200 && code !== 201) throw new Error('GitHub write failed (' + code + ') for ' + path + ': ' + put.getContentText());
}

function editionPath_(week) { return CFG.editionsDir + '/semana-' + (week < 10 ? '0' : '') + week + '.json'; }

/**
 * Writes the week's edition, the edition index and data.json, in that order, so the page never points at
 * an edition that is not there. Each file is committed only when something other than "updated" changed.
 * Editions of earlier weeks are never touched.
 */
function commitAll_(repo, token, data, cur) {
  var done = [];
  var epath = editionPath_(data.week);
  var ed = readFile_(repo, token, epath);
  if (!ed || !sameNumbers_(ed.text, data)) {
    writeFile_(repo, token, epath, data, 'Semana ' + data.week + ': edición archivada', ed);
    done.push(epath);
  }
  var ipath = CFG.editionsDir + '/index.json';
  var idx = readFile_(repo, token, ipath);
  var weeks = (idx && idx.data && idx.data.weeks) ? idx.data.weeks.slice() : [];
  if (weeks.indexOf(data.week) < 0) {
    weeks.push(data.week);
    weeks.sort(function (a, b) { return a - b; });
    writeFile_(repo, token, ipath, { weeks: weeks }, 'Semana ' + data.week + ': índice de ediciones', idx);
    done.push(ipath);
  }
  if (!cur || !sameNumbers_(cur.text, data)) {
    writeFile_(repo, token, CFG.path, data, 'Semana ' + data.week + ': tabla actualizada', cur);
    done.push(CFG.path);
  }
  return done.length ? 'Committed ' + done.join(', ') + ' (week ' + data.week + ').' : 'No changes, nothing committed (week ' + data.week + ').';
}

/** Ignores the timestamp so a rerun with the same numbers does not create a commit. */
function sameNumbers_(oldText, data) {
  try {
    var a = JSON.parse(oldText); delete a.updated;
    var b = JSON.parse(JSON.stringify(data)); delete b.updated;
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (e) { return false; }
}
