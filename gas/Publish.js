// Fourth & Beers 2026 - publish the Tribune data to GitHub Pages
// v2.1.0 c1.3.0
//
// What it does
//   1. Reads the Yahoo Pick'em leaderboard pasted into the PickEm_Board tab of the participants workbook.
//   2. Reads Survivor strikes from the model's Field tab.
//   3. Reads the "Fan of" column from the participants list (call signs only, never emails).
//   4. Reads the Tribune tab and publishes the rows checked for the current week:
//      Portada, Columna (the paragraphs of the Portada story), Clasificado, Dato and Edición (special edition theme).
//      Also reads the optional Apodo column of the participants list (nicknames, so the page can bold them).
//   5. Keeps the Survivor elimination order (who went out, which week) by carrying it over from the last data.json.
//   6. Builds data.json and commits it to the GitHub repo. GitHub Pages republishes the page by itself.
//   7. Archives the week: editions/semana-NN.json is a full copy of that week's data.json and
//      editions/index.json lists the weeks. A week that has moved on is never touched again.
//   8. Writes a Revisión note to cell H1 of the Tribune tab (and tints the rows involved) when the last place
//      is named more than once, or in two weeks in a row, and so on. It never blocks a publish or edits your text.
//   It only commits when something other than "updated" changed, so running it often is harmless.
//
// One-time setup (Project Settings > Script properties)
//   GITHUB_TOKEN  fine-grained token, this one repo only, permission Contents: Read and write
//   GITHUB_REPO   owner/repo, for example yourname/fourth-and-beers
//   SHEET_ID        workbook that holds the PickEm_Board and Tribune tabs (participants workbook)
//   MODEL_SHEET_ID  model workbook that holds the Field tab (Survivor strikes). Optional, defaults to SHEET_ID.
// Then run installTriggers() once from the editor and approve the permissions.
// Run setupTribuneTab() once to create the Tribune tab with its dropdown and checkboxes. Safe to repeat: it also
// adds the Edición option to an existing dropdown and the Apodo header to the participants list.
// Moving from the old tabs: run migrateToTribune(true) to see what would move, then migrateToTribune(false).
// Once the migration has run, migrateToTribune and LEGACY_TABS can be deleted.

var CFG = {
  boardTab: 'PickEm_Board',   // paste Yahoo's weekly performance table here, header row included
  tribuneTab: 'Tribune',      // Semana | Sección | Para | Título | Texto | Publicar (checkbox) | Revisión, in the participants workbook
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
var SECTIONS = ['Portada', 'Columna', 'Clasificado', 'Dato', 'Edición'];
var TRIBUNE_HEADER = ['Semana', 'Sección', 'Para', 'Título', 'Texto', 'Publicar'];
// Revisión: the label sits in G1, the warnings in H1.
var REVISION_LABEL = 'Revisión';
var REVISION_CELL = 'H1';
var REVISION_RED = '#f4cccc';
// Themes the page knows. Add one here and in index.html (THEMES and its CSS block).
var THEMES_KNOWN = ['muertos'];

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
  try { reviewTribune_(ss, data); } catch (e) { Logger.log('Revisión skipped: ' + e); }
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
  sh.getRange(1, 7, 1, 1).setValues([[REVISION_LABEL]]).setFontWeight('bold');
  sh.setFrozenRows(1);
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(SECTIONS, true).setAllowInvalid(false).build();
  sh.getRange('B2:B1000').setDataValidation(rule);
  sh.getRange('F2:F1000').insertCheckboxes();
  sh.setColumnWidth(1, 70); sh.setColumnWidth(2, 110); sh.setColumnWidth(3, 170);
  sh.setColumnWidth(4, 190); sh.setColumnWidth(5, 520); sh.setColumnWidth(6, 80);
  sh.getRange('E2:E1000').setWrap(true);
  sh.setColumnWidth(7, 80); sh.setColumnWidth(8, 420);
  sh.getRange(REVISION_CELL).setWrap(true);
  addApodoHeader_(ss);
  return sh;
}

/** Adds the Apodo header to the participants list if it is missing. Touches no other cell. */
function addApodoHeader_(ss) {
  var f = fanSheet_(ss);
  if (!f || f.apC >= 0) return;
  f.sh.getRange(f.h + 1, f.width + 1, 1, 1).setValues([['Apodo']]).setFontWeight('bold');
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
    apodos: readApodos_(ss, board.names),
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

/** The participants list: the tab that has "Call Sign PickEm" and "Fan of" columns. Apodo is optional. */
function fanSheet_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var values = sheets[i].getDataRange().getDisplayValues();
    for (var h = 0; h < Math.min(values.length, 10); h++) {
      var row = values[h].map(function (c) { return String(c).trim().toLowerCase(); });
      var nC = row.indexOf('call sign pickem'), fC = row.indexOf('fan of');
      if (nC < 0 || fC < 0) continue;
      return { sh: sheets[i], values: values, h: h, nC: nC, fC: fC, apC: row.indexOf('apodo'), width: row.length };
    }
  }
  return null;
}

/** Fan info keyed by Pick'em name, read from the participants list. */
function readFans_(ss, pickemNames) {
  var out = {};
  var byNorm = {};
  pickemNames.forEach(function (n) { byNorm[norm_(n)] = n; });
  var f = fanSheet_(ss);
  if (!f) { Logger.log('No tab with "Call Sign PickEm" and "Fan of" columns, skipping fans.'); return out; }
  for (var r = f.h + 1; r < f.values.length; r++) {
    var pick = byNorm[norm_(f.values[r][f.nC])];
    var fan = parseFan_(f.values[r][f.fC]);
    if (pick && fan) out[pick] = fan;
  }
  return out;
}

/**
 * Nicknames keyed by Pick'em name, from the optional Apodo column (comma separated). The page bolds them in the copy.
 * An alias that equals someone's call sign, or that two players claim, is dropped and logged. Emails are never read.
 */
function readApodos_(ss, pickemNames) {
  var out = {};
  var f = fanSheet_(ss);
  if (!f || f.apC < 0) return out;
  var byNorm = {};
  pickemNames.forEach(function (n) { byNorm[norm_(n)] = n; });
  var claimed = {};
  for (var r = f.h + 1; r < f.values.length; r++) {
    var pick = byNorm[norm_(f.values[r][f.nC])];
    if (!pick) continue;
    String(f.values[r][f.apC] || '').split(',').forEach(function (a) {
      a = a.trim();
      var k = norm_(a);
      if (!k) return;
      if (byNorm[k]) { Logger.log('Apodo "' + a + '" is a call sign, skipping it.'); return; }
      if (claimed[k] && claimed[k] !== pick) { Logger.log('Apodo "' + a + '" belongs to two players, skipping it for ' + pick + '.'); return; }
      claimed[k] = pick;
      out[pick] = out[pick] || [];
      if (out[pick].indexOf(a) < 0) out[pick].push(a);
    });
  }
  return out;
}

/**
 * Checked rows in Tribune for a week, in sheet order, with their sheet row number. Used by the publisher and by Revisión.
 * Each row is {row, sec, secRaw, para, titulo, texto}, sec lowercased and without accents.
 */
function tribuneRows_(sh, week) {
  var out = [];
  if (!sh) return out;
  var values = sh.getDataRange().getDisplayValues();
  if (!values.length) return out;
  var head = values[0].map(plain_);
  var at = function (name, fallback) { var i = head.indexOf(name); return i >= 0 ? i : fallback; };
  var cW = at('semana', 0), cS = at('seccion', 1), cP = at('para', 2), cT = at('titulo', 3), cX = at('texto', 4), cK = at('publicar', 5);
  for (var r = 1; r < values.length; r++) {
    var v = values[r];
    var ok = /^(true|x|s[ií]|yes)$/i.test(String(v[cK] || '').trim());
    if (!ok || toNum_(v[cW]) !== week) continue;
    out.push({ row: r + 1, sec: plain_(v[cS]), secRaw: String(v[cS] || '').trim(), para: String(v[cP] || '').trim(),
      titulo: String(v[cT] || '').trim(), texto: String(v[cX] || '').trim() });
  }
  return out;
}

/**
 * Checked rows in Tribune for this week, grouped by Sección, in sheet order.
 * Para is one or several Pick'em call signs separated by commas, or blank / Todos for everyone (published as '').
 * An unknown name is logged and published as typed. A missing tab gives an empty Tribune and the page uses its fallbacks.
 * Line breaks inside a cell are kept, the ends are trimmed. Edición: at most one per week, Para is the theme key.
 */
function readTribune_(ss, week, pickemNames) {
  var out = { portada: null, columna: [], clasificados: [], datos: [], edicion: null };
  var rows = tribuneRows_(findTab_(ss, CFG.tribuneTab), week);
  var byNorm = {};
  pickemNames.forEach(function (n) { byNorm[norm_(n)] = n; });

  rows.forEach(function (x) {
    var sec = x.sec, titulo = x.titulo, texto = x.texto, row = x.row;
    if (sec === 'edicion') {
      if (!titulo) { Logger.log('Tribune row ' + row + ' is a checked Edición without a Título, skipping it.'); return; }
      if (out.edicion) { Logger.log('Tribune row ' + row + ': only one Edición per week, skipping this one.'); return; }
      out.edicion = { titulo: titulo, texto: texto, tema: plain_(x.para) };
      return;
    }
    var para = resolvePara_(x.para, byNorm, row);
    if (sec === 'portada') {
      if (!titulo) { Logger.log('Tribune row ' + row + ' is a checked Portada without a Título, skipping it.'); return; }
      if (out.portada) { Logger.log('Tribune row ' + row + ': only one Portada per week, skipping this one.'); return; }
      out.portada = { titulo: titulo, texto: texto, para: para };
    } else if (sec === 'columna') {
      if (!texto) { Logger.log('Tribune row ' + row + ' is a checked Columna without Texto, skipping it.'); return; }
      out.columna.push({ titulo: titulo, para: para, texto: texto });
    } else if (sec === 'clasificado' || sec === 'dato') {
      if (!titulo || !texto) { Logger.log('Tribune row ' + row + ' is checked but has no Título or no Texto, skipping it.'); return; }
      (sec === 'dato' ? out.datos : out.clasificados).push({ titulo: titulo, para: para, texto: texto });
    } else {
      Logger.log('Tribune row ' + row + ' is checked but its Sección "' + x.secRaw + '" is not one of ' + SECTIONS.join(', ') + ', skipping it.');
    }
  });
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

// BEGIN NAMES
// Shared with index.html. Both files carry this exact block and a test fails if they differ.
// Call signs plus apodos, case-insensitive, curly and straight apostrophes equal, whole words only, longest match first.
function nameKey(s) { return String(s).replace(/[‘’`´]/g, "'").trim().toLowerCase(); }
function nameIndex(names, apodos) {
  var owner = {}, terms = [];
  function add(t, who) { var k = nameKey(t); if (!k || owner[k]) return; owner[k] = who; terms.push(k); }
  names.forEach(function (n) { add(n, n); });
  Object.keys(apodos || {}).forEach(function (n) { (apodos[n] || []).forEach(function (a) { add(a, n); }); });
  terms.sort(function (a, b) { return b.length - a.length || (a < b ? -1 : 1); });
  var re = terms.length ? new RegExp("(^|[^\\p{L}\\p{N}_])(" + terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|") + ")(?![\\p{L}\\p{N}_])", "giu") : null;
  return { owner: owner, re: re };
}
function mentions(idx, text) {
  var out = [], s = String(text).replace(/[‘’`´]/g, "'");
  if (!idx.re) return out;
  idx.re.lastIndex = 0;
  var m;
  while ((m = idx.re.exec(s))) {
    var st = m.index + m[1].length, en = st + m[2].length;
    out.push({ start: st, end: en, name: idx.owner[m[2].toLowerCase()] });
    idx.re.lastIndex = en;
  }
  return out;
}
// END NAMES

// ---------------------------------------------------------------------------
// Revisión: a note in the Tribune tab, never a block
// ---------------------------------------------------------------------------

/** Every player tied for last on the Yahoo total (golf rule). */
function lastPlace_(rows) {
  var tot = function (p) { return p.total != null ? p.total : p.weeks.reduce(function (a, b) { return a + b; }, 0); };
  var low = Math.min.apply(null, rows.map(tot));
  return rows.filter(function (p) { return tot(p) === low; }).map(function (p) { return p.name; });
}

/**
 * Checks this week's checked Tribune rows and writes the warnings (Spanish) to H1, tinting the rows involved.
 * Warns when the last place is named in more than one row or Columna paragraph, was also named last week, when there is
 * Columna without a Portada, more than one Edición, or an unknown tema. Returns the list of warnings.
 */
function reviewTribune_(ss, data) {
  var sh = findTab_(ss, CFG.tribuneTab);
  if (!sh) return [];
  var names = data.pickem.map(function (p) { return p.name; });
  var idx = nameIndex(names, data.apodos);
  var last = lastPlace_(data.pickem);
  var lastSet = {}; last.forEach(function (n) { lastSet[n] = true; });
  var label = last.join(' y ');
  var namesLast = function (x) {
    var text = [x.titulo, x.texto, x.sec === 'edicion' ? '' : x.para].join('\n');
    return mentions(idx, text).some(function (m) { return lastSet[m.name]; });
  };
  var rows = tribuneRows_(sh, data.week);
  var warn = [], bad = {};
  var flag = function (list) { list.forEach(function (x) { bad[x.row] = true; }); };
  var rn = function (list) { return list.map(function (x) { return x.row; }).join(', '); };

  var hits = rows.filter(namesLast);
  if (hits.length > 1) { warn.push(label + ' sale en ' + hits.length + ' filas (' + rn(hits) + '). Mejor una sola.'); flag(hits); }
  var colHits = hits.filter(function (x) { return x.sec === 'columna'; });
  if (colHits.length > 1) { warn.push(label + ' sale en ' + colHits.length + ' párrafos de la Columna (filas ' + rn(colHits) + ').'); flag(colHits); }
  if (hits.length && data.week > 1) {
    var before = tribuneRows_(sh, data.week - 1).filter(namesLast);
    if (before.length) { warn.push(label + ' ya salió en la Tribune de la semana ' + (data.week - 1) + '. Segunda semana seguida.'); flag(hits); }
  }
  var columna = rows.filter(function (x) { return x.sec === 'columna'; });
  if (columna.length && !rows.some(function (x) { return x.sec === 'portada'; })) {
    warn.push('Hay Columna sin fila de Portada (filas ' + rn(columna) + ').'); flag(columna);
  }
  var ediciones = rows.filter(function (x) { return x.sec === 'edicion'; });
  if (ediciones.length > 1) { warn.push('Hay ' + ediciones.length + ' filas de Edición. Solo cuenta la primera (fila ' + ediciones[0].row + ').'); flag(ediciones.slice(1)); }
  ediciones.forEach(function (x) {
    if (THEMES_KNOWN.indexOf(plain_(x.para)) < 0) { warn.push('Tema desconocido "' + x.para + '" en la fila ' + x.row + '. Temas: ' + THEMES_KNOWN.join(', ') + '.'); flag([x]); }
  });

  writeRevision_(sh, warn, bad);
  return warn;
}

/** Writes H1 and tints the flagged rows. Clears only the tint this function sets. */
function writeRevision_(sh, warn, bad) {
  var cell = sh.getRange(REVISION_CELL);
  var text = warn.join('\n');
  if (String(cell.getValue() || '') !== text) cell.setValue(text);
  var n = sh.getDataRange().getDisplayValues().length;
  if (n < 2) return;
  var bg = sh.getRange(2, 1, n - 1, 6).getBackgrounds();
  for (var i = 0; i < bg.length; i++) {
    var row = i + 2, tinted = String(bg[i][0] || '').toLowerCase() === REVISION_RED;
    if (bad[row] && !tinted) sh.getRange(row, 1, 1, 6).setBackground(REVISION_RED);
    else if (!bad[row] && tinted) sh.getRange(row, 1, 1, 6).setBackground(null);
  }
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
