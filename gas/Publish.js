// Fourth & Beers 2026 - publish the leaderboard page data to GitHub Pages
// v1.3.1 c1.0.0
//
// What it does
//   1. Reads the Yahoo Pick'em leaderboard pasted into the PickEm_Board tab of the model workbook.
//   2. Reads Survivor strikes from the model's Field tab.
//   3. Builds data.json and commits it to the GitHub repo. GitHub Pages republishes the page by itself.
//   4. Keeps the Survivor elimination order (who went out, which week) by carrying it over from the last data.json.
//   5. Reads the "Fan of" column from the participants list (call signs only, never emails).
//   6. Reads the Comentarios tab and publishes the rows checked for the current week.
//   It only commits when the numbers changed, so running it often is harmless.
//
// One-time setup (Project Settings > Script properties)
//   GITHUB_TOKEN  fine-grained token, this one repo only, permission Contents: Read and write
//   GITHUB_REPO   owner/repo, for example yourname/fourth-and-beers
//   SHEET_ID        workbook that holds the PickEm_Board tab (participants workbook)
//   MODEL_SHEET_ID  model workbook that holds the Field tab (Survivor strikes). Optional, defaults to SHEET_ID.
// Then run installTriggers() once from the editor and approve the permissions.
// Run setupComentarios() once to create the Comentarios tab with checkboxes.

var CFG = {
  boardTab: 'PickEm_Board',   // paste Yahoo's weekly performance table here, header row included
  commentsTab: 'Comentarios', // Semana | Para | Texto | Publicar (checkbox), in the participants workbook
  fieldTab: 'Field',          // model tab with Entrant / Strikes columns
  path: 'data.json',
  branch: 'main',
  season: 2026,
  weeks: 18,
  pays: [1050, 350],          // Pick'em 1st and 2nd, from the reglamento
  weeklyPrize: 50
};

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
  var cur = readCurrent_(repo, token);
  var data = buildData_(ss, model, cur ? cur.data : null);
  var result = commitIfChanged_(repo, token, data, cur);
  Logger.log(result);
  return result;
}

/** Installable onEdit: publishes after a paste into PickEm_Board or a change in Comentarios. */
function onBoardEdit(e) {
  if (!e || !e.range) return;
  var name = e.range.getSheet().getName().trim().toLowerCase();
  if (name !== CFG.boardTab.toLowerCase() && name !== CFG.commentsTab.toLowerCase()) return;
  Utilities.sleep(5000); // let a large paste or a few quick checkbox clicks land
  publishLeaderboard();
}

/** Run once. Creates the Comentarios tab in the participants workbook with a checkbox column. */
function setupComentarios() {
  var ss = SpreadsheetApp.openById(String(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).trim());
  var sh = findTab_(ss, CFG.commentsTab) || ss.insertSheet(CFG.commentsTab);
  sh.getRange(1, 1, 1, 4).setValues([['Semana', 'Para', 'Texto', 'Publicar']]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange('D2:D1000').insertCheckboxes();
  sh.setColumnWidth(1, 70); sh.setColumnWidth(2, 170); sh.setColumnWidth(3, 520); sh.setColumnWidth(4, 80);
  sh.getRange('C2:C1000').setWrap(true);
  Logger.log('Comentarios tab ready in ' + ss.getName());
}

/** Run once. Replaces any earlier triggers from this project. */
function installTriggers() {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('Set SHEET_ID in Script properties first.');
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  // 1) publish when the board tab is edited (your weekly paste)
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
    comments: readComments_(ss, board.week, board.names),
    season: CFG.season,
    week: board.week,
    weeks: CFG.weeks,
    updated: new Date().toISOString(),
    pays: CFG.pays,
    weeklyPrize: CFG.weeklyPrize,
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
  Logger.log('PickEm_Board found: ' + !!findTab_(ss, CFG.boardTab) + '   Field found: ' + !!findTab_(model, CFG.fieldTab));
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

/** Fan info keyed by Pick'em name, read from the tab that has "Call Sign PickEm" and "Fan of". */
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

/** Checked rows in Comentarios for this week. Para matches a Pick'em name, or blank / Todos for everyone. */
function readComments_(ss, week, pickemNames) {
  var sh = findTab_(ss, CFG.commentsTab);
  if (!sh) return [];
  var byNorm = {};
  pickemNames.forEach(function (n) { byNorm[norm_(n)] = n; });
  var values = sh.getDataRange().getDisplayValues();
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var v = values[r];
    var wk = toNum_(v[0]), para = String(v[1] || '').trim(), texto = String(v[2] || '').trim();
    var ok = /^(true|x|s[ií]|yes)$/i.test(String(v[3] || '').trim());
    if (!ok || !texto || wk !== week) continue;
    var who = byNorm[norm_(para)] || '';
    if (para && !who && !/^todos$/i.test(para)) Logger.log('Comentarios: "' + para + '" is not a Pick\'em name, showing it to everyone.');
    out.push({ para: who, texto: texto });
  }
  return out;
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
function norm_(s) { return String(s).replace(/[\u2018\u2019`\u00b4]/g, "'").trim().toLowerCase(); }

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

function ghUrl_(repo) { return 'https://api.github.com/repos/' + repo + '/contents/' + CFG.path; }

/** Current data.json in the repo, or null if it does not exist yet. */
function readCurrent_(repo, token) {
  var get = UrlFetchApp.fetch(ghUrl_(repo) + '?ref=' + CFG.branch, { headers: ghHeaders_(token), muteHttpExceptions: true });
  var code = get.getResponseCode();
  if (code === 404) return null;
  if (code !== 200) throw new Error('GitHub read failed (' + code + '): ' + get.getContentText());
  var cur = JSON.parse(get.getContentText());
  var text = Utilities.newBlob(Utilities.base64Decode(cur.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
  var data = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  return { sha: cur.sha, text: text, data: data };
}

function commitIfChanged_(repo, token, data, cur) {
  if (cur && sameNumbers_(cur.text, data)) return 'No changes, nothing committed (week ' + data.week + ').';
  var body = {
    message: 'Semana ' + data.week + ': tabla actualizada',
    content: Utilities.base64Encode(JSON.stringify(data, null, 1), Utilities.Charset.UTF_8),
    branch: CFG.branch
  };
  if (cur) body.sha = cur.sha;
  var put = UrlFetchApp.fetch(ghUrl_(repo), {
    method: 'put', headers: ghHeaders_(token), contentType: 'application/json',
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  var code = put.getResponseCode();
  if (code !== 200 && code !== 201) throw new Error('GitHub write failed (' + code + '): ' + put.getContentText());
  return 'Committed data.json for week ' + data.week + '.';
}

/** Ignores the timestamp so a rerun with the same numbers does not create a commit. */
function sameNumbers_(oldText, data) {
  try {
    var a = JSON.parse(oldText); delete a.updated;
    var b = JSON.parse(JSON.stringify(data)); delete b.updated;
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (e) { return false; }
}