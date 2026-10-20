// Fourth & Beers 2026 - publish the Tribune data to GitHub Pages
// v3.2.0 c1.9.0
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
//   8. Lists warnings in the Tribune tab (H:J, one per row: color, text, week, with a blank separator column G) and tints the rows involved when the last place
//      is named more than once, or in two weeks in a row, and so on. It never blocks a publish or edits your text.
//  11. Yahoo is canon for who won the week and which week was dropped. In the pasted weekly table a green font marks the
//      week's winner (Yahoo already applied its tiebreakers) and a red font the dropped week. They are read from the cell
//      font colors and published as data.json winners[] and pickem[].droppedWeek. Without colors (a plain-text paste)
//      the marks from the previous data.json are kept when that week's scores did not change, a single top score
//      wins by itself, and a tie nobody marked is listed as a warning.
//  12. Playoffs. Weeks 19 to 22 live in their own paste areas, Playoffs_Board (Yahoo's playoff table, everyone starts at
//      zero) and Playoffs_Picks (its Group Picks), laid out like the regular-season tabs. Once Playoffs_Board has
//      scores, data.json week is the playoff week (19 to 22), regularWeek stays at 18, and data.json gets a playoffs
//      block. Tribune Semana accepts 19 to 22 or a round name (Wild Card, Divisional, Conferencia, Super Bowl).
//  10. Ends every publish with a status message: a log line, a toast in the workbook and rows 7 to 10 of Picks_Board and PickEm_Board
//      (OK, OK with warnings and the first two, or the error). Rows 1 to 6 hold the instructions for pasting (Group Picks, or
//      Yahoo's weekly table in PickEm_Board) and row 11 marks the paste area, which starts at A12 in both tabs. All of it is rewritten if the tab is wiped. A table pasted
//      at A1 by habit is pushed down, never overwritten.
//   9. Reads Yahoo's Group Picks table from Picks_Board, infers its week from the Points column, infers each game's
//      result from the paste itself (Points must equal the confidence of the correct picks) and keeps the week in
//      Picks_Log. data.json "picks" is rebuilt from Picks_Log on every publish.
//   It only commits when something other than "updated" changed, so running it often is harmless.
//  13. publishLeaderboard() returns a status object {status, week, commitSha, updatedAt, message}, status being "published"
//      or "no_changes". publishManual() is the Publicar button's entry point (publishNow in Code.js, same project,
//      which is bound to the participants workbook). It never throws and adds "busy" (another publish holds the lock,
//      it waits only a few seconds) and "error" (message holds the reason).
//
// One-time setup (Project Settings > Script properties)
//   GITHUB_TOKEN  fine-grained token, this one repo only, permission Contents: Read and write
//   GITHUB_REPO   owner/repo, for example yourname/fourth-and-beers
//   SHEET_ID        workbook that holds the PickEm_Board and Tribune tabs (participants workbook)
//   MODEL_SHEET_ID  model workbook that holds the Field tab (Survivor strikes). Optional, defaults to SHEET_ID.
// Then run installTriggers() once from the editor and approve the permissions.
// Run setupTribuneTab() once to create the Tribune tab with its dropdown and checkboxes. Safe to repeat: it also
// adds the Edición option to an existing dropdown, renames Sheet1 to Participantes, and inserts the Apodo column
// between G and H of the participants list.
// Setup also creates Picks_Board (paste Yahoo's Group Picks table there) and Picks_Log (durable, never wiped).
// Tabs this script touches in the participants workbook: PickEm_Board, Tribune, Participantes, Picks_Board, Picks_Log.
// Anything else in the workbook (the commissioner's money table, say) is never read, written, renamed or deleted.

var CFG = {
  boardTab: 'PickEm_Board',   // paste Yahoo's weekly performance table here, header row included
  participantsTab: 'Participantes',  // the participants list; setup renames an old Sheet1 to this
  tribuneTab: 'Tribune',     // Semana | Sección | Para | Título | Texto | Publicar (checkbox) | (blank separator) | Color | Warnings | Warning week, in the participants workbook
  fieldTab: 'Field',          // model tab with Entrant / Strikes columns
  playoffsTab: 'Playoffs_Board',   // Yahoo's playoff table (weeks 19 to 22), same layout as PickEm_Board
  playoffsPicksTab: 'Playoffs_Picks',  // Group Picks of the playoff rounds, same layout as Picks_Board
  picksTab: 'Picks_Board',    // Yahoo Group Picks table pasted at A1, header rows included
  logTab: 'Picks_Log',        // durable: one row per pick set and game, never cleared or deleted by any routine
  path: 'data.json',
  editionsDir: 'editions',
  branch: 'main',
  season: 2026,
  nflWeek1: '2026-09-08',        // the Tuesday that opens NFL week 1. Weeks run Tuesday to Monday, America/Chicago
  weeks: 18,
  rounds: 4                    // playoff rounds, played as weeks 19 to 22
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
// Warnings: H = color legend, I = warning text, J = the week it was raised. Row 1 holds the headers.
// G is a narrow blank separator between the Tribune rows (A:F) and the Warnings table.
var WARN_HEADER = ['Color', 'Warnings', 'Warning week'];
var WARN_COL = 8;               // first column of the Warnings table (H), 1-based
var SEP_AFTER = 6;              // the separator column G is inserted after the Publicar column
var WARN_WIDTHS = [50, 300, 90];   // pixel widths of H, I, J: narrow, so the Publicar button at K1 sits closer to the screen
var WARN_KEEP_WEEKS = 3;     // warnings from the 3 weeks before the current one stay listed, older ones roll off
// One light color per warning, cycled. The warning's swatch (G) and the Tribune rows it points at (A:F) share it.
var WARN_COLORS = ['#f4cccc', '#fff2cc', '#d9ead3', '#cfe2f3', '#d9d2e9', '#fce5cd'];
var APODO_AFTER = 7;          // the Apodo column is inserted after column G of the participants list
// Themes the page knows. Add one here and in index.html (THEMES and its CSS block).
var THEMES_KNOWN = ['muertos'];

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

var MANUAL_LOCK_MS = 5000;   // the Publicar button waits this long for a running publish, then answers "busy"

/** Run by hand or by trigger. Builds data.json and commits it if anything changed. Returns a status object. */
function publishLeaderboard() {
  var lock = LockService.getScriptLock();
  lock.waitLock(60000); // a burst of checkbox clicks runs one at a time
  try { return publishLeaderboard_(); } finally { lock.releaseLock(); }
}

/** The Publicar button. Same publish and same lock, but it never throws and never waits long: busy and error are statuses. */
function publishManual() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(MANUAL_LOCK_MS)) return publishStatus_('busy', 0, '', '', 'Otra publicación está en curso.');
  try {
    return publishLeaderboard_();
  } catch (e) {
    return publishStatus_('error', 0, '', '', String(e && e.message ? e.message : e).slice(0, 220));
  } finally {
    lock.releaseLock();
  }
}

function publishStatus_(status, week, commitSha, updatedAt, message) {
  return { status: status, week: week, commitSha: commitSha, updatedAt: updatedAt, message: message };
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
  var picksWarn = [], warnTexts = [], data, result, fixPending = false;
  try {
    var modelId = props.getProperty('MODEL_SHEET_ID');
    var model = modelId ? SpreadsheetApp.openById(String(modelId).trim()) : ss;
    var cur = readFile_(repo, token, CFG.path);
    fixPending = !props.getProperty(SURVIVOR_FIX_FLAG);
    data = buildData_(ss, model, cur ? cur.data : null, picksWarn, fixPending);
    try { warnTexts = reviewTribune_(ss, data, picksWarn); } catch (e) { Logger.log('Warnings skipped: ' + e); warnTexts = picksWarn.slice(); }
    result = commitAll_(repo, token, data, cur);   // {text, sha}
    if (fixPending) props.setProperty(SURVIVOR_FIX_FLAG, '1');   // the one-time correction ran and is committed
  } catch (e) {
    reportStatus_(ss, 'ERROR ' + stamp_() + '. La publicación falló, revisa Executions en Apps Script.', [String(e && e.message ? e.message : e).slice(0, 220)]);
    throw e;
  }
  Logger.log(result.text);
  var weeks = Object.keys(data.picks || {}).map(Number).sort(function (x, y) { return x - y; });
  reportStatus_(ss, (warnTexts.length ? 'OK CON AVISOS ' : 'OK ') + stamp_() + '. Semana ' + data.week + ' ' +
    (result.sha ? 'publicada' : 'sin cambios') + '. Picks guardados: ' +
    (weeks.length ? 'semana' + (weeks.length > 1 ? 's ' : ' ') + weeks.join(', ') : 'ninguno') + '. Avisos: ' +
    (warnTexts.length ? warnTexts.length + ' (abajo y en Tribune, columna I)' : 'ninguno') + '.',
    warnTexts.slice(0, 2).map(function (t) { return '• ' + t; }));
  return publishStatus_(result.sha ? 'published' : 'no_changes', data.week, result.sha, data.updated, result.text);
}

/** The clock. One place, so tests can pin it. */
function now_() { return new Date(); }

function stamp_() { return Utilities.formatDate(now_(), 'America/Chicago', 'yyyy-MM-dd HH:mm'); }

/**
 * The end-of-process message: a log line, a toast for whoever has the workbook open, and rows 8 to 10 of Picks_Board
 * (headline, then up to two details). Rows are written only when the text changed.
 */
function reportStatus_(ss, headline, details) {
  details = details || [];
  Logger.log('Estado: ' + [headline].concat(details).join(' '));
  try { ss.toast([headline].concat(details).join('\n'), 'Fourth and Beers', 15); } catch (e) { /* no toast outside a spreadsheet session */ }
  try {
    var want = [headline, details[0] || '', details[1] || ''];
    boardTabs_().forEach(function (t) {
      var sh = findTab_(ss, t[0]);
      if (!sh) return;
      ensureNote_(sh, t[1]);
      for (var i = 0; i < 3; i++) {
        var cell = sh.getRange(NOTE_ROWS - 3 + i, 1, 1, 1);
        if (String(cell.getValue() || '') !== want[i]) cell.setValue(want[i]);
      }
    });
  } catch (e) { Logger.log('Status cell skipped: ' + e); }
}

/** Installable onEdit: publishes after a paste into PickEm_Board or Picks_Board, or a change in Tribune. */
function onBoardEdit(e) {
  if (!e || !e.range) return;
  var name = e.range.getSheet().getName().trim().toLowerCase();
  if ([CFG.boardTab, CFG.picksTab, CFG.playoffsTab, CFG.playoffsPicksTab, CFG.tribuneTab].every(function (t) { return name !== t.toLowerCase(); })) return;
  Utilities.sleep(5000); // let a large paste or a few quick checkbox clicks land
  publishLeaderboard();
}

/** Run once, safe to repeat. Creates the Tribune tab with its header, Sección dropdown and Publicar checkboxes. */
function setupTribuneTab() {
  var ss = SpreadsheetApp.openById(String(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).trim());
  setupTribune_(ss);
  setupPicks_(ss);
  [CFG.playoffsTab, CFG.playoffsPicksTab].forEach(function (n) { if (!findTab_(ss, n)) ss.insertSheet(n); });
  boardTabs_().forEach(function (t) {
    var sh = findTab_(ss, t[0]);
    if (sh) ensureNote_(sh, t[1]);
  });
  orderTabs_(ss);
  Logger.log('Tribune, ' + CFG.boardTab + ', ' + CFG.picksTab + ', ' + CFG.playoffsTab + ', ' + CFG.playoffsPicksTab + ' and ' + CFG.logTab + ' tabs ready in ' + ss.getName());
}

function setupTribune_(ss) {
  var sh = findTab_(ss, CFG.tribuneTab) || ss.insertSheet(CFG.tribuneTab);
  sh.getRange(1, 1, 1, 6).setValues([TRIBUNE_HEADER]).setFontWeight('bold');
  ensureSeparator_(sh);
  sh.getRange(1, WARN_COL, 1, 3).setValues([WARN_HEADER]).setFontWeight('bold');
  sh.setFrozenRows(1);
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(SECTIONS, true).setAllowInvalid(false).build();
  sh.getRange('B2:B1000').setDataValidation(rule);
  sh.getRange('F2:F1000').insertCheckboxes();
  sh.setColumnWidth(1, 70); sh.setColumnWidth(2, 110); sh.setColumnWidth(3, 170);
  sh.setColumnWidth(4, 190); sh.setColumnWidth(5, 520); sh.setColumnWidth(6, 80);
  sh.getRange('E2:E1000').setWrap(true);
  sh.setColumnWidth(SEP_AFTER + 1, 20); setWarningWidths_(sh);
  sh.getRange(2, WARN_COL + 1, 199, 1).setWrap(true);
  addApodoHeader_(ss);
  return sh;
}

/** Widths of the Warnings table columns. Formatting only, no cell moves. Also used by setupPublishButton in Code.js. */
function setWarningWidths_(sh) {
  WARN_WIDTHS.forEach(function (w, i) { sh.setColumnWidth(WARN_COL + i, w); });
}

/**
 * Prepares the participants list: renames a tab still called Sheet1 to Participantes, and adds the Apodo header
 * if it is missing. Apodo goes in a new column between G and H, so whatever sat in H (a table, say) shifts one
 * column right and keeps its shape. A list narrower than G gets the header in the first free column instead.
 * Idempotent. The page finds every column by its header, so the position and the tab name carry no meaning.
 */
function addApodoHeader_(ss) {
  var f = fanSheet_(ss);
  if (!f) return;
  if (f.sh.getName() === 'Sheet1' && !findTab_(ss, CFG.participantsTab)) f.sh.setName(CFG.participantsTab);
  if (f.apC >= 0) return;
  var col = f.width + 1;
  if (f.sh.getMaxColumns() >= APODO_AFTER) { f.sh.insertColumnAfter(APODO_AFTER); col = APODO_AFTER + 1; }
  f.sh.getRange(f.h + 1, col, 1, 1).setValues([['Apodo']]).setFontWeight('bold');
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

function buildData_(ss, model, prev, picksWarn, fixSurvivorWeeks) {
  picksWarn = picksWarn || [];
  var board = readBoard_(ss);
  var po = readPlayoffs_(ss, picksWarn);
  syncPicks_(ss, board, picksWarn, CFG.picksTab, 0, CFG.boardTab);
  syncPicks_(ss, po || { rows: [], week: 0 }, picksWarn, CFG.playoffsPicksTab, CFG.weeks, CFG.playoffsTab);
  var winners = settleWinners_(board, prev, picksWarn, CFG.boardTab, 0);
  var week = po ? CFG.weeks + po.week : board.week;           // the edition: a regular week, or 19 to 22 once the playoffs have scores
  var strikes = readStrikes_(model || ss, board.names);
  var out = {
    survivorOut: survivorOut_(prev, strikes, week, now_(), fixSurvivorWeeks),
    fans: readFans_(ss, board.names),
    apodos: readApodos_(ss, board.names),
    tribune: readTribune_(ss, week, board.names),
    season: CFG.season,
    week: week,
    weeks: CFG.weeks,
    updated: now_().toISOString(),
    prizes: JSON.parse(JSON.stringify(PRIZES)),
    pickem: board.rows,
    winners: winners,
    strikes: strikes,
    picks: readPicksLog_(ss)
  };
  if (po) {
    out.regularWeek = board.week;
    out.playoffs = {
      week: week,
      rounds: po.week,
      pickem: po.rows.map(function (p) { return { name: p.name, weeks: p.weeks, total: p.total != null ? p.total : p.weeks.reduce(function (x, y) { return x + y; }, 0) }; }),
      winners: settleWinners_(po, prev && prev.playoffs ? { winners: prev.playoffs.winners, pickem: prev.playoffs.pickem } : null, picksWarn, CFG.playoffsTab, CFG.weeks)
    };
  }
  return out;
}

/** Playoffs_Board as a table like PickEm_Board: weeks 19 to 22 are rounds 1 to 4. null until it has scores. Never throws. */
function readPlayoffs_(ss, warn) {
  var sh = findTab_(ss, CFG.playoffsTab);
  if (!sh) return null;
  try {
    ensureNote_(sh, PLAYOFFS_SPEC);
    var grid = gridOf_(sh);
    if (!grid.some(function (r) { return r.some(function (c) { return /^pick set name$/i.test(c); }); })) {
      if (grid.slice(NOTE_ROWS).some(function (r) { return r.some(function (c) { return c !== ''; }); })) {
        warn.push(CFG.playoffsTab + ': no pude leer la tabla. Pega la tabla completa de los playoffs de Yahoo en A12, encabezados incluidos.');
      }
      return null;
    }
    var t = readTable_(sh, CFG.playoffsTab, true);
    if (t.week > CFG.rounds) t.week = CFG.rounds;
    return t;
  } catch (e) {
    if (!/No scores yet/.test(String(e))) warn.push(CFG.playoffsTab + ': ' + e);
    return null;
  }
}

/** The tab as rows of trimmed strings. A paste that landed as tab-separated text in column A is split into columns. */
function gridOf_(sh, maxCols) {
  return sh.getDataRange().getDisplayValues().map(function (r) {
    var cells = (maxCols ? r.slice(0, maxCols) : r).map(function (c) { return String(c).trim(); });
    var filled = cells.filter(function (c) { return c !== ''; });
    return (filled.length === 1 && filled[0].indexOf('\t') >= 0) ? filled[0].split('\t').map(function (c) { return c.trim(); }) : cells;
  });
}

/** Parses Yahoo's table. Works whether the paste split into columns or landed as tab-separated text in column A. */
function readBoard_(ss) {
  var sh = findTab_(ss, CFG.boardTab);
  if (!sh) throw new Error('Tab "' + CFG.boardTab + '" not found in workbook "' + ss.getName() + '". Tabs it sees: ' +
    ss.getSheets().map(function (t) { return JSON.stringify(t.getName()); }).join(', ') +
    '. If this is the wrong workbook, fix SHEET_ID in Script properties.');
  return readTable_(sh, CFG.boardTab, false);
}

/** The weekly table of one tab. playoffs: the Wk columns are 19 to 22 (or 1 to 4) and count as rounds 1 to 4. */
function readTable_(sh, tabName, playoffs) {
  var values = gridOf_(sh);
  var colors = [];
  try { colors = sh.getDataRange().getFontColors(); } catch (e) { colors = []; }

  var h = -1;
  for (var i = 0; i < values.length; i++) {
    if (values[i].some(function (c) { return /^pick set name$/i.test(c); })) { h = i; break; }
  }
  if (h < 0) throw new Error('No header row with "Pick Set Name" in ' + tabName + '. Paste the whole Yahoo table at A12, header included.');

  var head = values[h];
  var col = function (re) { for (var j = 0; j < head.length; j++) if (re.test(head[j])) return j; return -1; };
  var nameC = col(/^pick set name$/i), totalC = col(/^total/i), dropC = col(/^dropped/i);
  var wkC = [];
  var first = 1;
  if (playoffs) {
    var ns = head.map(function (c) { var m = /^wk\s*(\d+)$/i.exec(c); return m ? Number(m[1]) : 0; }).filter(Boolean);
    first = ns.length && Math.min.apply(null, ns) >= CFG.weeks + 1 ? CFG.weeks + 1 : 1;
  }
  head.forEach(function (c, j) { var m = /^wk\s*(\d+)$/i.exec(c); if (m && Number(m[1]) - first >= 0) wkC[Number(m[1]) - first] = j; });
  if (nameC < 0 || !wkC.length) throw new Error('Could not find the name and week columns in ' + tabName + '.');

  var rows = [], marks = [];
  for (var r = h + 1; r < values.length; r++) {
    var v = values[r], name = v[nameC];
    if (!name) continue;
    var weeks = [], kinds = [];
    for (var q = 0; q < wkC.length; q++) {
      weeks.push(wkC[q] === undefined ? 0 : toNum_(v[wkC[q]]));
      kinds.push(wkC[q] === undefined ? '' : fontKind_(colors[r] && colors[r][wkC[q]]));
    }
    marks.push(kinds);
    rows.push({
      name: name,
      weeks: weeks,
      total: totalC >= 0 ? toNum_(v[totalC]) : null,
      dropped: dropC >= 0 ? toNum_(v[dropC]) : null
    });
  }
  if (rows.length < 2) throw new Error('Fewer than 2 players found in ' + tabName + '.');

  // Current week = last week where anyone scored
  var week = 0;
  for (var k = 0; k < wkC.length; k++) {
    if (rows.some(function (p) { return p.weeks[k] > 0; })) week = k + 1;
  }
  if (week === 0) throw new Error('No scores yet in ' + tabName + '.');
  rows.forEach(function (p) { p.weeks = p.weeks.slice(0, week); });

  // Yahoo's marks: green = the week's winner, red = the dropped week
  var winners = [], warn = [];
  for (var w = 0; w < week; w++) {
    winners.push(rows.filter(function (p, i) { return marks[i][w] === 'green'; }).map(function (p) { return p.name; }));
  }
  rows.forEach(function (p, i) {
    var reds = [];
    for (var w2 = 0; w2 < week; w2++) if (marks[i][w2] === 'red') reds.push(w2 + 1);
    if (reds.length === 1) p.droppedWeek = reds[0];
  });
  return { rows: rows, week: week, names: rows.map(function (p) { return p.name; }), winners: winners, warn: warn };
}

/** 'green' or 'red' for the font colors Yahoo uses to mark the week's winner and the dropped week, '' for anything else. */
function fontKind_(c) {
  var m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
  if (!m) return '';
  var r = parseInt(m[1].slice(0, 2), 16), g = parseInt(m[1].slice(2, 4), 16), b = parseInt(m[1].slice(4, 6), 16);
  if (g >= 90 && g > r * 1.4 && g > b * 1.4) return 'green';
  if (r >= 150 && r > g * 1.8 && r > b * 1.8) return 'red';
  return '';
}

/**
 * Settles the weekly winners. Yahoo's green mark wins. Without one, the mark from the previous data.json stands when that
 * week's scores are unchanged, a single top score wins by itself, and a tie nobody marked stays empty (the page splits it)
 * and is listed as a warning. Marks that contradict the scores are warned about. Returns winners[] (one list per week).
 */
function settleWinners_(board, prev, warn, label, base) {
  var out = [];
  for (var k = 0; k < board.week; k++) {
    var scores = board.rows.map(function (p) { return p.weeks[k]; }), top = Math.max.apply(null, scores);
    var tied = board.rows.filter(function (p) { return p.weeks[k] === top; }).map(function (p) { return p.name; });
    var marked = board.winners[k] || [];
    if (!marked.length && prev && prev.winners && prev.winners[k] && prev.winners[k].length && prev.pickem) {
      var same = board.rows.every(function (p) {
        var q = prev.pickem.filter(function (x) { return norm_(x.name) === norm_(p.name); })[0];
        return q && q.weeks[k] === p.weeks[k];
      });
      if (same) marked = prev.winners[k];
    }
    if (marked.length) {
      var off = marked.filter(function (n) { return tied.map(norm_).indexOf(norm_(n)) < 0; });
      if (off.length) warn.push(label + ': semana ' + (base + k + 1) + ', el verde de Yahoo (' + off.join(', ') + ') no está entre los de mayor puntaje (' + tied.join(', ') + '). Gana Yahoo, revisa el pegado.');
      out.push(marked);
    } else if (tied.length === 1) {
      out.push(tied);
    } else {
      out.push([]);
      warn.push(label + ': semana ' + (base + k + 1) + ' tiene empate en el primer lugar (' + tied.join(', ') + ') y la tabla no trae el verde de Yahoo. Pega la tabla con formato para que gane quien dice Yahoo. Mientras, la página reparte el premio.');
    }
  }
  board.rows.forEach(function (p) {
    if (p.droppedWeek == null && prev && prev.pickem) {
      var q = prev.pickem.filter(function (x) { return norm_(x.name) === norm_(p.name); })[0];
      if (q && q.droppedWeek && q.weeks && p.weeks.length >= q.weeks.length && q.weeks.every(function (x, i) { return x === p.weeks[i]; })) p.droppedWeek = q.droppedWeek;
    }
    if (p.droppedWeek != null && p.dropped != null && p.weeks[p.droppedWeek - 1] !== p.dropped) {
      warn.push(label + ': ' + p.name + ', el rojo de Yahoo está en la semana ' + p.droppedWeek + ' (' + p.weeks[p.droppedWeek - 1] + ') pero Dropped dice ' + p.dropped + '. Gana Yahoo, revisa el pegado.');
    }
  });
  return out;
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
  Logger.log('Playoffs_Board found: ' + !!findTab_(ss, CFG.playoffsTab) + '   Playoffs_Picks found: ' + !!findTab_(ss, CFG.playoffsPicksTab));
  Logger.log('PickEm_Board found: ' + !!findTab_(ss, CFG.boardTab) + '   Picks_Board found: ' + !!findTab_(ss, CFG.picksTab) +
    '   Picks_Log found: ' + !!findTab_(ss, CFG.logTab) + '   Tribune found: ' + !!findTab_(ss, CFG.tribuneTab) +
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

/**
 * The participants list: the tab called Participantes (or its old name Sheet1) with "Call Sign PickEm" and "Fan of"
 * columns. Apodo is optional. No other tab is opened, so a commissioner-only tab is never read.
 */
function fanSheet_(ss) {
  var sheets = [findTab_(ss, CFG.participantsTab), findTab_(ss, 'Sheet1')].filter(Boolean);
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
 * Checked rows in Tribune for a week, in sheet order, with their sheet row number. Used by the publisher and by the warnings check.
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
    if (!ok || semanaNum_(v[cW]) !== week) continue;
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
// Picks: Yahoo's Group Picks table -> Picks_Log -> data.json "picks"
// ---------------------------------------------------------------------------

var LOG_HEADER = ['Semana', 'Pick Set', 'Juego', 'Favorito', 'Spread', 'Underdog', 'Pick', 'Confianza', 'Resultado'];
var NOTE_ROWS = 11;             // rows 1 to 11 of Picks_Board: instructions, status, paste banner. The paste starts at A12.
var PASTE_COLS = 19;            // 16 games reach column R, the cells right of S are not read
var PICKS_NOTE = [
  'PICKS_BOARD: aquí va la tabla de Group Picks de Yahoo, una semana a la vez.',
  '1. Yahoo > Pick\'em > Group Picks (football.fantasysports.yahoo.com/pickem/27197/grouppicks?week=N).',
  '2. Copia la tabla completa: desde la celda "Favored" (arriba a la izquierda) hasta el último Points.',
  '3. PickEm_Board debe tener ya los puntos de esa semana. No escribas la semana, sale de los Points.',
  '4. Borra el área de pegado: clic en A12, Ctrl+Mayús+Fin, Supr. Luego pega en A12.',
  'No escribas nada arriba de la fila 12. Los avisos también salen en Tribune, columna I.'
];
var PICKS_LABEL = 'Estado del último publish';
var PICKS_BANNER = '▼ PEGA AQUÍ, en la celda A12. Antes borra de la fila 12 hacia abajo ▼';
var PICKS_OLD_TITLE = 'Cómo pegar la tabla de Group Picks';      // the first layout kept its note in column T
var PICKS_SPEC = { note: PICKS_NOTE, banner: PICKS_BANNER, cols: PASTE_COLS, oldTitle: PICKS_OLD_TITLE };
// PickEm_Board has the same layout: instructions, Estado, banner, paste at A12. Yahoo's table is 22 columns wide.
var BOARD_NOTE = [
  'PICKEM_BOARD: aquí va la tabla semanal de Yahoo, la de puntos por semana. Se pega completa cada semana.',
  '1. Yahoo > Pick\'em (football.fantasysports.yahoo.com/pickem/27197), la tabla con una columna por semana.',
  '2. Copia la tabla completa: desde la fila de encabezados (Pick Set Name, Wk 1, Wk 2 ... Total, Dropped) hasta el último jugador.',
  '3. Siempre con todas las semanas, no solo la nueva. La semana en curso es la última que tiene puntos.',
  '4. Borra el área de pegado: clic en A12, Ctrl+Mayús+Fin, Supr. Luego pega en A12.',
  'No escribas nada arriba de la fila 12. Si algo falla, el estado de abajo lo dice.'
];
var BOARD_BANNER = '▼ PEGA AQUÍ, en la celda A12. Antes borra de la fila 12 hacia abajo ▼';
var BOARD_SPEC = { note: BOARD_NOTE, banner: BOARD_BANNER, cols: 24, oldTitle: null };
var PLAYOFFS_NOTE = [
  'PLAYOFFS_BOARD: aquí va la tabla de los playoffs de Yahoo (semanas 19 a 22). Todos empiezan en cero. Solo paga el primer lugar.',
  '1. Yahoo > Pick\'em (football.fantasysports.yahoo.com/pickem/27197), la tabla de los playoffs, no la de la temporada regular.',
  '2. Copia la tabla completa: desde la fila de encabezados (Pick Set Name, Wk 19, Wk 20 ... Total) hasta el último jugador.',
  '3. Siempre con todas las rondas, no solo la nueva. La ronda en curso es la última que tiene puntos.',
  '4. Borra el área de pegado: clic en A12, Ctrl+Mayús+Fin, Supr. Luego pega en A12. Pega con formato para que venga el verde de Yahoo.',
  'No escribas nada arriba de la fila 12. Si algo falla, el estado de abajo lo dice.'
];
var PLAYOFFS_PICKS_NOTE = [
  'PLAYOFFS_PICKS: aquí va la tabla de Group Picks de una ronda de playoffs, una ronda a la vez.',
  '1. En Yahoo, como Comish, abre football.fantasysports.yahoo.com/pickem/27197/grouppicks?week=N (N es 19, 20, 21 o 22).',
  '2. Selecciona la tabla desde la celda "Favored" hasta el último Points y cópiala. Que incluya Favored, Spread y Underdog.',
  '3. Playoffs_Board debe tener ya los puntos de esa ronda. No escribas la semana, sale de los Points.',
  '4. Borra el área de pegado: clic en A12, Ctrl+Mayús+Fin, Supr. Luego pega en A12.',
  'No escribas nada arriba de la fila 12. Los avisos también salen en Tribune, columna I.'
];
var PLAYOFFS_SPEC = { note: PLAYOFFS_NOTE, banner: BOARD_BANNER, cols: 24, oldTitle: null };
var PLAYOFFS_PICKS_SPEC = { note: PLAYOFFS_PICKS_NOTE, banner: PICKS_BANNER, cols: PASTE_COLS, oldTitle: null };
/** [tab name, spec] of the four paste areas, in the order they are shown the status. */
function boardTabs_() {
  return [[CFG.picksTab, PICKS_SPEC], [CFG.boardTab, BOARD_SPEC], [CFG.playoffsPicksTab, PLAYOFFS_PICKS_SPEC], [CFG.playoffsTab, PLAYOFFS_SPEC]];
}
var SOLVER_NODES = 3000000;     // a week that needs more search than this is stored without results

/** Creates Picks_Board (empty, the paste goes at A1) and Picks_Log (header only) when missing. Safe to repeat. */
function setupPicks_(ss) {
  if (!findTab_(ss, CFG.picksTab)) ss.insertSheet(CFG.picksTab);
  var log = findTab_(ss, CFG.logTab) || ss.insertSheet(CFG.logTab);
  if (String(log.getRange(1, 1, 1, 1).getValue() || '').trim() !== LOG_HEADER[0]) {
    log.getRange(1, 1, 1, LOG_HEADER.length).setValues([LOG_HEADER]).setFontWeight('bold');
    log.setFrozenRows(1);
  }
  return log;
}

/**
 * Keeps rows 1 to 11 of Picks_Board or PickEm_Board (spec): instructions, the Estado label and the paste banner. Does nothing
 * while they are in place. If those rows hold anything else (a table pasted at A1 by habit, or the first layout's table)
 * the rows are pushed down first, so a paste is never overwritten. Only writes, never clears.
 */
function ensureNote_(sh, spec) {
  var note = spec.note;
  if (String(sh.getRange(1, 1, 1, 1).getValue() || '') === note[0] && String(sh.getRange(NOTE_ROWS, 1, 1, 1).getValue() || '') === spec.banner) return;
  if (spec.oldTitle && String(sh.getRange(1, 20, 1, 1).getValue() || '') === spec.oldTitle) {
    var blank = []; for (var i = 0; i < 9; i++) blank.push(['']);
    sh.getRange(1, 20, 9, 1).setValues(blank);                    // the first layout's note and status in column T
  }
  var ours = function (c) {
    c = String(c || '').trim();
    return c === '' || note.indexOf(c) >= 0 || c === PICKS_LABEL || c === spec.banner || /^(OK|ERROR) /.test(c) || /^• /.test(c);
  };
  var top = sh.getRange(1, 1, NOTE_ROWS, spec.cols).getValues();
  if (!top.every(function (r) { return r.every(ours); })) sh.insertRowsBefore(1, NOTE_ROWS);
  sh.getRange(1, 1, note.length, 1).setValues(note.map(function (t) { return [t]; }));
  sh.getRange(1, 1, 1, 1).setFontWeight('bold');
  sh.getRange(note.length + 1, 1, 1, 1).setValue(PICKS_LABEL).setFontWeight('bold');
  sh.getRange(NOTE_ROWS, 1, 1, 1).setValue(spec.banner).setFontWeight('bold');
  sh.getRange(NOTE_ROWS, 1, 1, 12).setBackground('#fff2cc');
  sh.setColumnWidth(1, 200);
}

/**
 * Tab order: Participantes first, the tabs this script owns last (Picks_Board, PickEm_Board, Tribune, Picks_Log), anything
 * else in between in its own order. Only the tabs named here are moved, so a commissioner-only tab is never activated or touched.
 * Moves nothing when the order is already right.
 */
function orderTabs_(ss) {
  var names = function () { return ss.getSheets().map(function (t) { return t.getName().trim().toLowerCase(); }); };
  var mine = [CFG.picksTab, CFG.boardTab, CFG.playoffsPicksTab, CFG.playoffsTab, CFG.tribuneTab, CFG.logTab].filter(function (n) { return findTab_(ss, n); });
  var part = findTab_(ss, CFG.participantsTab);
  var want = mine.map(function (n) { return n.toLowerCase(); }), now = names();
  var tailOk = now.slice(now.length - want.length).join('|') === want.join('|');
  if ((!part || now[0] === CFG.participantsTab.toLowerCase()) && tailOk) return;
  var move = function (sh, pos) { ss.setActiveSheet(sh); ss.moveActiveSheet(pos); };
  if (part) move(part, 1);
  mine.forEach(function (n) { move(findTab_(ss, n), ss.getSheets().length); });
}

function team_(s) { return String(s || '').replace(/[^A-Za-z]/g, '').toUpperCase(); }

/** One cell, "TB (6)" or "TB" and "(6)" on two lines. '' is a missed pick (null), anything unreadable is false. */
function parsePick_(cell) {
  var s = String(cell || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  var m = /^([A-Za-z][A-Za-z.]*)\s*\(\s*(\d+)\s*\)$/.exec(s);
  return m ? [team_(m[1]), Number(m[2])] : false;
}

/**
 * Yahoo's Group Picks table as rows of strings. Returns {games: [{fav, spread, dog}], sets: [{name, picks, points}]}
 * where picks has one [TEAM, confidence] or null per game, or null when the table cannot be read.
 */
function parsePicksGrid_(values) {
  var f = -1;
  for (var i = 0; i < values.length; i++) if (/^favored$/i.test(values[i][0] || '')) { f = i; break; }
  if (f < 0 || f + 2 >= values.length) return null;
  var sp = values[f + 1], dg = values[f + 2];
  if (!/^spread$/i.test(sp[0] || '') || !/^underdog$/i.test(dg[0] || '')) return null;
  var games = [];
  for (var j = 1; j < values[f].length && values[f][j] !== ''; j++) {
    games.push({ fav: team_(values[f][j]), spread: toNum_(sp[j]), dog: team_(dg[j]) });
  }
  if (!games.length) return null;
  var G = games.length, start = f + 3;
  if (values[start] && /^team name/i.test(values[start][0] || '')) start++;
  var sets = [];
  for (var r = start; r < values.length; r++) {
    var v = values[r], name = String(v[0] || '').trim();
    if (!name) continue;
    var picks = [];
    for (var g = 0; g < G; g++) {
      var p = parsePick_(v[g + 1]);
      if (p === false) return null;
      picks.push(p);
    }
    sets.push({ name: name, picks: picks, points: toNum_(v[G + 1]) });
  }
  return sets.length ? { games: games, sets: sets } : null;
}

/** The weeks of PickEm_Board whose scores equal the Points of every pick set that is on the board. */
function weeksMatching_(sets, board, base) {
  var by = {};
  board.rows.forEach(function (p) { by[norm_(p.name)] = p; });
  var known = sets.filter(function (s) { return by[norm_(s.name)]; });
  var out = [];
  if (!known.length || !known.some(function (s) { return s.points > 0; })) return out;
  for (var w = 1; w <= board.week; w++) {
    if (known.every(function (s) { return by[norm_(s.name)].weeks[w - 1] === s.points; })) out.push(w + (base || 0));
  }
  return out;
}

/**
 * Infers each game's result from the paste: a pick set's Points must equal the confidence of its correct picks.
 * Depth-first over the games (F = favorite covers, U = underdog covers, P = push), cutting any branch where a set is
 * already over its Points or can no longer reach them. Returns {status: 'one' | 'none' | 'many' | 'bad', res: ['F'|'U'|'P']}.
 */
function solvePicks_(games, sets) {
  var G = games.length, S = sets.length, side = [], conf = [], suf = [];
  for (var s = 0; s < S; s++) {
    side.push([]); conf.push([]); suf.push(new Array(G + 1));
    for (var g = 0; g < G; g++) {
      var p = sets[s].picks[g], sd = 0;
      if (p) {
        if (p[0] === games[g].fav) sd = 1; else if (p[0] === games[g].dog) sd = 2; else return { status: 'bad', res: [] };
      }
      side[s].push(sd); conf[s].push(p ? p[1] : 0);
    }
    suf[s][G] = 0;
    for (var k = G - 1; k >= 0; k--) suf[s][k] = suf[s][k + 1] + conf[s][k];
  }
  var tot = [], cur = [], found = [], nodes = 0, over = false;
  for (s = 0; s < S; s++) { tot.push(0); if (suf[s][0] < sets[s].points) return { status: 'none', res: [] }; }
  function dfs(gi) {
    if (found.length > 1 || over) return;
    if (++nodes > SOLVER_NODES) { over = true; return; }
    if (gi === G) {
      for (var a = 0; a < S; a++) if (tot[a] !== sets[a].points) return;
      found.push(cur.slice());
      return;
    }
    for (var o = 1; o <= 3; o++) {            // 1 favorite, 2 underdog, 3 push
      var ok = true, a2;
      for (a2 = 0; a2 < S; a2++) {
        if (o < 3 && side[a2][gi] === o) tot[a2] += conf[a2][gi];
        var t = tot[a2];
        if (t > sets[a2].points || t + suf[a2][gi + 1] < sets[a2].points) ok = false;
      }
      if (ok) { cur[gi] = o === 1 ? 'F' : o === 2 ? 'U' : 'P'; dfs(gi + 1); }
      for (a2 = 0; a2 < S; a2++) if (o < 3 && side[a2][gi] === o) tot[a2] -= conf[a2][gi];
      if (found.length > 1 || over) return;
    }
  }
  dfs(0);
  if (over) return { status: 'bad', res: [] };
  return found.length === 1 ? { status: 'one', res: found[0] } : { status: found.length ? 'many' : 'none', res: [] };
}

/** The log rows of one week: one per pick set and game. */
function logRows_(week, games, sets, res) {
  var rows = [];
  sets.forEach(function (s) {
    games.forEach(function (g, i) {
      var p = s.picks[i];
      rows.push([week, s.name, i + 1, g.fav, g.spread, g.dog, p ? p[0] : '', p ? p[1] : '', res ? res[i] : '']);
    });
  });
  return rows;
}

/**
 * Keeps one week in Picks_Log. Only that week's rows are replaced, every other row stays where it is. Nothing is
 * cleared or deleted: a shorter log is padded with blanks. Writes only when the week's rows changed. Returns true if written.
 */
function writeLogWeek_(ss, week, rows) {
  var sh = setupPicks_(ss);
  var vals = sh.getDataRange().getValues();
  var oldWeek = [], others = [];
  for (var i = 1; i < vals.length; i++) {
    var v = vals[i];
    if (String(v[0]).trim() === '') continue;
    (toNum_(v[0]) === week ? oldWeek : others).push(v.slice(0, LOG_HEADER.length));
  }
  var sig = function (list) { return JSON.stringify(list.map(function (r) { return r.map(String); })); };
  if (sig(oldWeek) === sig(rows)) return false;
  var all = others.concat(rows).map(function (r, i) { return { r: r, i: i }; });
  all.sort(function (a, b) { return toNum_(a.r[0]) - toNum_(b.r[0]) || a.i - b.i; });
  var out = all.map(function (x) { return x.r; });
  var total = Math.max(out.length, vals.length - 1);
  while (out.length < total) out.push(['', '', '', '', '', '', '', '', '']);
  if (sh.getMaxRows() < total + 1) sh.insertRowsAfter(sh.getMaxRows(), total + 1 - sh.getMaxRows());
  sh.getRange(2, 1, total, LOG_HEADER.length).setValues(out);
  return true;
}

/**
 * Reads Picks_Board and, when it holds a week Picks_Log does not have yet (or has differently), stores it.
 * The week is the one PickEm_Board week whose scores equal the pasted Points. No match or several: nothing is stored.
 * Problems go to warn as Spanish sentences for the Warnings table. Never throws.
 */
function syncPicks_(ss, board, warn, tabName, base, boardName) {
  try {
    var sh = findTab_(ss, tabName);
    if (!sh) return;
    ensureNote_(sh, tabName === CFG.playoffsPicksTab ? PLAYOFFS_PICKS_SPEC : PICKS_SPEC);
    var grid = gridOf_(sh, PASTE_COLS);
    var parsed = parsePicksGrid_(grid);
    if (!parsed && !grid.slice(NOTE_ROWS).some(function (r) { return r.some(function (c) { return c !== ''; }); })) return;   // nothing pasted yet
    if (!parsed) { warn.push(tabName + ': no pude leer la tabla. Pega la tabla completa de Group Picks de Yahoo en A12, encabezados incluidos.'); return; }
    var weeks = weeksMatching_(parsed.sets, board, base);
    if (weeks.length !== 1) {
      warn.push(tabName + (weeks.length ? ': los puntos coinciden con varias semanas de ' + boardName + ' (' + weeks.join(', ') + '). No guardé nada.'
        : ': los puntos no coinciden con ninguna semana de ' + boardName + '. Pega primero la tabla de Yahoo ahí y vuelvo a intentar.'));
      return;
    }
    storePicksWeek_(ss, board, weeks[0], parsed, warn);
  } catch (e) {
    warn.push(tabName + ': falló al guardar (' + e + '). Los demás datos se publicaron igual.');
    Logger.log('Picks skipped: ' + e);
  }
}

/** Stores one parsed week: unknown call signs are skipped with a warning, results are inferred or left blank with a warning. */
function storePicksWeek_(ss, board, week, parsed, warn) {
  var by = {};
  board.rows.forEach(function (p) { by[norm_(p.name)] = p.name; });
  var unknown = [], sets = [];
  parsed.sets.forEach(function (s) {
    if (by[norm_(s.name)]) sets.push({ name: by[norm_(s.name)], picks: s.picks, points: s.points });
    else unknown.push(s.name);
  });
  if (unknown.length) warn.push(CFG.picksTab + ': "' + unknown.join('", "') + '" no está en ' + CFG.boardTab + '. No guardé sus picks.');
  var sol = solvePicks_(parsed.games, sets);
  if (sol.status !== 'one') {
    warn.push(CFG.picksTab + ' semana ' + week + ': ' + (sol.status === 'many' ? 'varias combinaciones de resultados dan los mismos puntos de Yahoo'
      : sol.status === 'bad' ? 'hay un equipo que no es el favorito ni el underdog de su juego'
      : 'ninguna combinación de resultados da los puntos de Yahoo') + '. Guardé los picks sin resultado y los datos de picks de esa semana se saltan.');
  }
  var written = writeLogWeek_(ss, week, logRows_(week, parsed.games, sets, sol.status === 'one' ? sol.res : null));
  if (written) Logger.log('Picks_Log: week ' + week + ' stored, results ' + sol.status + '.');
}

/** data.json "picks" from Picks_Log: {week: {g: [[fav, spread, dog, res|null]], p: {callSign: [[team, conf] | null]}}}. */
function readPicksLog_(ss) {
  var out = {};
  var sh = findTab_(ss, CFG.logTab);
  if (!sh) return out;
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    var v = vals[i], wk = toNum_(v[0]), gi = toNum_(v[2]) - 1, name = String(v[1] || '').trim();
    if (!wk || !name || gi < 0) continue;
    var w = out[wk] || (out[wk] = { g: [], p: {} });
    var res = String(v[8] || '').trim().toUpperCase();
    w.g[gi] = [team_(v[3]), toNum_(v[4]), team_(v[5]), res === 'F' || res === 'U' || res === 'P' ? res : null];
    (w.p[name] = w.p[name] || [])[gi] = String(v[6] || '').trim() ? [team_(v[6]), toNum_(v[7])] : null;
  }
  Object.keys(out).forEach(function (k) {
    var w = out[k], n = w.g.length;
    for (var g = 0; g < n; g++) if (!w.g[g]) w.g[g] = ['', 0, '', null];
    Object.keys(w.p).forEach(function (name) { for (var g2 = 0; g2 < n; g2++) if (w.p[name][g2] === undefined) w.p[name][g2] = null; });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Warnings: a table in the Tribune tab, never a block
// ---------------------------------------------------------------------------

/** Every player tied for last on the Yahoo total (golf rule). */
function lastPlace_(rows) {
  var tot = function (p) { return p.total != null ? p.total : p.weeks.reduce(function (a, b) { return a + b; }, 0); };
  var low = Math.min.apply(null, rows.map(tot));
  return rows.filter(function (p) { return tot(p) === low; }).map(function (p) { return p.name; });
}

/**
 * Checks this week's checked Tribune rows and lists the warnings (Spanish) in the Warnings table, tinting the rows involved.
 * Warns when the last place is named in more than one row or Columna paragraph, was also named last week, when there is
 * Columna without a Portada, more than one Edición, or an unknown tema. Returns the list of warning texts.
 */
function reviewTribune_(ss, data, extra) {
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
  var warn = [];
  var add = function (text, list) { warn.push({ text: text, rows: list.map(function (x) { return x.row; }) }); };
  (extra || []).forEach(function (t) { add(t, []); });        // Picks_Board warnings, no Tribune row to tint
  var rn = function (list) { return list.map(function (x) { return x.row; }).join(', '); };

  var hits = rows.filter(namesLast);
  if (hits.length > 1) add(label + ' sale en ' + hits.length + ' filas (' + rn(hits) + '). Mejor una sola.', hits);
  var colHits = hits.filter(function (x) { return x.sec === 'columna'; });
  if (colHits.length > 1) add(label + ' sale en ' + colHits.length + ' párrafos de la Columna (filas ' + rn(colHits) + ').', colHits);
  if (hits.length && data.week > 1) {
    var before = tribuneRows_(sh, data.week - 1).filter(namesLast);
    if (before.length) add(label + ' ya salió en la Tribune de la semana ' + (data.week - 1) + '. Segunda semana seguida. (filas ' + rn(hits) + ')', hits);
  }
  var columna = rows.filter(function (x) { return x.sec === 'columna'; });
  if (columna.length && !rows.some(function (x) { return x.sec === 'portada'; })) {
    add('Hay Columna sin fila de Portada (filas ' + rn(columna) + ').', columna);
  }
  rows.filter(function (x) { return x.sec === 'clasificado' && !x.para; }).forEach(function (x) {
    add('Clasificado sin Para en la fila ' + x.row + '.', [x]);       // published anyway, the ad just has no addressee
  });
  var ediciones = rows.filter(function (x) { return x.sec === 'edicion'; });
  if (ediciones.length > 1) add('Hay ' + ediciones.length + ' filas de Edición. Solo cuenta la primera (fila ' + ediciones[0].row + ').', ediciones.slice(1));
  ediciones.forEach(function (x) {
    if (THEMES_KNOWN.indexOf(plain_(x.para)) < 0) add('Tema desconocido "' + x.para + '" en la fila ' + x.row + '. Temas: ' + THEMES_KNOWN.join(', ') + '.', [x]);
  });

  writeWarnings_(sh, warn, data.week);
  return warn.map(function (w) { return w.text; });
}

/**
 * Moves a Warnings table that still starts in G (the first layout) one column right, by inserting the separator column
 * after F. A no-op once G1 is not the Color header. Everything right of F shifts, nothing is rewritten.
 */
function ensureSeparator_(sh) {
  var col = SEP_AFTER + 1;
  var inserted = String(sh.getRange(1, col, 1, 1).getValue() || '').trim() === WARN_HEADER[0];
  if (inserted) sh.insertColumnAfter(SEP_AFTER);
  if (inserted || String(sh.getRange(1, WARN_COL, 1, 1).getValue() || '').trim() === WARN_HEADER[0]) cleanSeparator_(sh);
}

/**
 * Sheets copies the format of the column to the left into an inserted one, so the separator would inherit Publicar's
 * checkboxes and the row tints. Strips them: validations, backgrounds and stray TRUE/FALSE values. Writes only if dirty.
 * Typed text in G is left alone.
 */
function cleanSeparator_(sh) {
  var col = SEP_AFTER + 1, n = sh.getMaxRows();
  var rg = sh.getRange(1, col, n, 1);
  var vals = rg.getValues(), dv = rg.getDataValidations(), bg = rg.getBackgrounds();
  var hasDv = dv.some(function (r) { return r[0] != null; });
  var hasBg = bg.some(function (r) { var c = String(r[0] || '').toLowerCase(); return c && c !== '#ffffff'; });
  var hasBool = vals.some(function (r) { return typeof r[0] === 'boolean'; });
  if (hasDv) rg.clearDataValidations();
  if (hasBg) rg.setBackground(null);
  if (hasBool) rg.setValues(vals.map(function (r) { return [typeof r[0] === 'boolean' ? '' : r[0]]; }));
}

/**
 * Writes the Warnings table (H:J from row 2) and tints the Tribune rows. This week's warnings are recomputed every
 * publish, the ones from the previous WARN_KEEP_WEEKS weeks stay below as a log, older ones roll off.
 * Each current warning gets a color from WARN_COLORS, shown in G and on its rows (A:F). A row that several warnings
 * point at is striped with their colors. Only palette colors are ever cleared. Writes only when something changed.
 */
function writeWarnings_(sh, warn, week) {
  ensureSeparator_(sh);
  var vals = sh.getDataRange().getValues();
  var head = vals[0] || [];
  if (WARN_HEADER.some(function (h, i) { return String(head[WARN_COL - 1 + i] || '') !== h; })) {
    sh.getRange(1, WARN_COL, 1, 3).setValues([WARN_HEADER]).setFontWeight('bold');
  }
  var oldEnd = 1;                                                  // last row with anything in G:I
  var kept = [];
  for (var r = 1; r < vals.length; r++) {
    var text = String(vals[r][WARN_COL] || '').trim(), w = toNum_(vals[r][WARN_COL + 1]);
    if (text || String(vals[r][WARN_COL + 1] || '').trim()) oldEnd = r + 1;
    if (text && w > 0 && w !== week && w > week - 1 - WARN_KEEP_WEEKS) kept.push([w, text]);
  }
  var table = warn.map(function (x) { return [x.text, week]; }).concat(kept.map(function (k) { return [k[1], k[0]]; }));
  var total = Math.max(table.length, oldEnd - 1);
  var out = [];
  for (var i = 0; i < total; i++) out.push(i < table.length ? [table[i][0], table[i][1]] : ['', '']);
  var same = out.every(function (o, i) { return String((vals[i + 1] || [])[WARN_COL] || '') === String(o[0]) && String((vals[i + 1] || [])[WARN_COL + 1] || '') === String(o[1]); });
  if (!same && total) sh.getRange(2, WARN_COL + 1, total, 2).setValues(out);

  // swatches in G for this week's warnings
  var colorOf = function (i) { return WARN_COLORS[i % WARN_COLORS.length]; };
  if (total) {
    var gbg = sh.getRange(2, WARN_COL, total, 1).getBackgrounds();
    for (var g = 0; g < total; g++) {
      var want = g < warn.length ? colorOf(g) : null, cur = String(gbg[g][0] || '').toLowerCase();
      if (want && cur !== want) sh.getRange(g + 2, WARN_COL, 1, 1).setBackground(want);
      else if (!want && WARN_COLORS.indexOf(cur) >= 0) sh.getRange(g + 2, WARN_COL, 1, 1).setBackground(null);
    }
  }

  // the rows the warnings point at
  var byRow = {};
  warn.forEach(function (x, wi) { x.rows.forEach(function (rw) { (byRow[rw] = byRow[rw] || []).push(wi); }); });
  var n = vals.length;
  if (n < 2) return;
  var bg = sh.getRange(2, 1, n - 1, 6).getBackgrounds();
  for (var j = 0; j < bg.length; j++) {
    var row = j + 2, ws = byRow[row] || [];
    for (var k = 0; k < 6; k++) {
      var wantC = ws.length ? colorOf(ws[k % ws.length]) : null, have = String(bg[j][k] || '').toLowerCase();
      if (wantC && have !== wantC) sh.getRange(row, k + 1, 1, 1).setBackground(wantC);
      else if (!wantC && WARN_COLORS.indexOf(have) >= 0) sh.getRange(row, k + 1, 1, 1).setBackground(null);
    }
  }
}

/**
 * The week of a Tribune row. A number (a trailing "Semana 5" works too), or a playoff round by name: Wild Card 19,
 * Divisional 20, Conferencia 21, Super Bowl 22, or "Playoffs 1" to "Playoffs 4" / "Ronda 1" to "Ronda 4".
 */
function semanaNum_(x) {
  var t = plain_(x), n = toNum_(x);
  var round = /(?:playoffs?|ronda|round)\s*(\d)/.exec(t);
  if (round && Number(round[1]) >= 1 && Number(round[1]) <= CFG.rounds) return CFG.weeks + Number(round[1]);
  if (/wild\s*card|comodin/.test(t)) return CFG.weeks + 1;
  if (/divisional|divisionales/.test(t)) return CFG.weeks + 2;
  if (/conferencia|conference|campeonato/.test(t)) return CFG.weeks + 3;
  if (/super\s*bowl/.test(t)) return CFG.weeks + 4;
  return n;
}

/** Lowercase without accents, for matching headers and Sección values. */
function plain_(s) {
  return String(s || '').trim().toLowerCase().replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u');
}

/**
 * The NFL week of a date: week 1 opens on CFG.nflWeek1 (a Tuesday), every week runs Tuesday to Monday in America/Chicago.
 * Capped at the 18 regular-season weeks, and 1 before the season.
 */
function nflWeek_(date) {
  var p = Utilities.formatDate(date, 'America/Chicago', 'yyyy-MM-dd').split('-');
  var s = CFG.nflWeek1.split('-');
  var days = Math.round((Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - Date.UTC(Number(s[0]), Number(s[1]) - 1, Number(s[2]))) / 86400000);
  return Math.max(1, Math.min(CFG.weeks, Math.floor(days / 7) + 1));
}

// ONE-TIME CORRECTION (v3.2.0). Eliminations were stamped with the PickEm_Board week, which lags a week when the strikes
// update before the paste. Entries stamped 4 or 5 move forward by one, KinkyKing (week 3) was right. It runs on the first
// publish only: publishLeaderboard_ sets this Script property once the commit goes through. REMOVE this block, the flag
// and the fix argument after that publish.
var SURVIVOR_FIX_FLAG = 'SURVIVOR_WEEK_FIX_V3_2_0';

/**
 * Elimination order. Keeps earlier entries, drops anyone whose strikes were corrected below 3, adds new outs.
 * A new out is stamped with the NFL week of the calendar (nflWeek_(now), capped at 18), not with the board week.
 * In the playoffs (week above 18) the edition week is stamped, as before.
 * fix: apply the one-time correction above before anything else.
 */
function survivorOut_(prev, strikes, week, now, fix) {
  var list = (prev && prev.survivorOut) ? prev.survivorOut.slice() : [];
  if (fix) {
    list = list.map(function (o) {
      return (o.week === 4 || o.week === 5) && norm_(o.name) !== 'kinkyking' ? { name: o.name, week: o.week + 1 } : o;
    });
  }
  var stampWeek = week > CFG.weeks ? week : nflWeek_(now || now_());
  list = list.filter(function (o) { return !(o.name in strikes) || strikes[o.name] >= 3; });
  Object.keys(strikes).forEach(function (n) {
    if (strikes[n] >= 3 && !list.some(function (o) { return o.name === n; })) list.push({ name: n, week: stampWeek });
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

/** Commits one file and returns the sha of the commit the API reports ('' if the reply carries none). */
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
  try { return String(JSON.parse(put.getContentText()).commit.sha || ''); } catch (e) { return ''; }
}

function editionPath_(week) { return CFG.editionsDir + '/semana-' + (week < 10 ? '0' : '') + week + '.json'; }

/**
 * Writes the week's edition, the edition index and data.json, in that order, so the page never points at
 * an edition that is not there. Each file is committed only when something other than "updated" changed.
 * Editions of earlier weeks are never touched.
 */
function commitAll_(repo, token, data, cur) {
  var done = [], sha = '';
  var epath = editionPath_(data.week);
  var ed = readFile_(repo, token, epath);
  if (!ed || !sameNumbers_(ed.text, data)) {
    sha = writeFile_(repo, token, epath, data, 'Semana ' + data.week + ': edición archivada', ed) || sha;
    done.push(epath);
  }
  var ipath = CFG.editionsDir + '/index.json';
  var idx = readFile_(repo, token, ipath);
  var weeks = (idx && idx.data && idx.data.weeks) ? idx.data.weeks.slice() : [];
  if (weeks.indexOf(data.week) < 0) {
    weeks.push(data.week);
    weeks.sort(function (a, b) { return a - b; });
    sha = writeFile_(repo, token, ipath, { weeks: weeks }, 'Semana ' + data.week + ': índice de ediciones', idx) || sha;
    done.push(ipath);
  }
  if (!cur || !sameNumbers_(cur.text, data)) {
    sha = writeFile_(repo, token, CFG.path, data, 'Semana ' + data.week + ': tabla actualizada', cur) || sha;
    done.push(CFG.path);
  }
  // sha is the last commit made. A committed file whose reply carried no sha still counts as published.
  return {
    text: done.length ? 'Committed ' + done.join(', ') + ' (week ' + data.week + ').' : 'No changes, nothing committed (week ' + data.week + ').',
    sha: done.length ? (sha || 'unknown') : ''
  };
}

/** Ignores the timestamp so a rerun with the same numbers does not create a commit. */
function sameNumbers_(oldText, data) {
  try {
    var a = JSON.parse(oldText); delete a.updated;
    var b = JSON.parse(JSON.stringify(data)); delete b.updated;
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (e) { return false; }
}
