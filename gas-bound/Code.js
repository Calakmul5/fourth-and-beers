// Fourth & Beers 2026 - Publicar button, bound to the participants workbook
// v1.0.0 c1.0.0
//
// A drawing or image button in Sheets can only run a function of a script bound to that workbook, and the publisher
// (gas/Publish.js) is a standalone project. This small project is bound to the workbook and adds the publisher as the
// library "Leaderboard" (developmentMode, so it always runs the latest pushed code). It holds no logic of its own:
// publishNow() shows a toast, calls Leaderboard.publishManual() and shows its status in a popup.
//
// One-time setup, from this project's editor
//   1. Run setupPublishButton() and approve the permissions. It puts the button at K1 of the Tribune tab.
//   2. Run publishNow() once and read the result. If it says Missing Script properties, copy GITHUB_TOKEN, GITHUB_REPO,
//      SHEET_ID and MODEL_SHEET_ID from the publisher project's Script properties into this project's.
// The workbook also gets a "Tribune" menu with the same Publicar action (onOpen), so there is always a way to publish
// that sits outside the cells.

var BUTTON_URL = 'https://calakmul5.github.io/fourth-and-beers/assets/publicar.png';  // served by GitHub Pages
var BUTTON_TAB = 'Tribune';
var BUTTON_COL = 11;        // K, the first column right of the Warnings table (H:J)
var BUTTON_ROW = 1;
var BUTTON_FN = 'publishNow';

/** Adds the menu. A simple trigger, needs no authorization. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Tribune').addItem('Publicar', BUTTON_FN).addToUi();
}

/** The Publicar button and menu item. */
function publishNow() {
  var ss = SpreadsheetApp.getActive();
  ss.toast('Publicando...', 'Fourth and Beers', 10);
  var result;
  try {
    result = Leaderboard.publishManual();
  } catch (e) {
    result = { status: 'error', message: String(e && e.message ? e.message : e) };
  }
  SpreadsheetApp.getUi().alert('Fourth and Beers', publishMessage_(result, ss.getSpreadsheetTimeZone()), SpreadsheetApp.getUi().ButtonSet.OK);
}

/** The popup text for a publish status {status, week, commitSha, updatedAt, message}. */
function publishMessage_(r, tz) {
  r = r || {};
  if (r.status === 'published') {
    var sha = String(r.commitSha || '').slice(0, 7);
    return 'Publicado. Semana ' + r.week + ', commit ' + sha + ', ' + Utilities.formatDate(new Date(r.updatedAt), tz || 'America/Chicago', 'HH:mm');
  }
  if (r.status === 'no_changes') return 'Sin cambios. data.json ya estaba al día.';
  if (r.status === 'busy') return 'Ya se está publicando. Intenta en un minuto.';
  var msg = String(r.message || (r.status ? 'estado desconocido ' + r.status : 'sin respuesta'));
  var hint = /Missing Script properties/.test(msg)
    ? ' Copia GITHUB_TOKEN, GITHUB_REPO, SHEET_ID y MODEL_SHEET_ID a las propiedades de este proyecto (Project Settings).' : '';
  return 'No se publicó: ' + msg + hint;
}

/** Run once, safe to repeat. Puts the image button at K1 of the Tribune tab and assigns publishNow to it. */
function setupPublishButton() {
  var sh = SpreadsheetApp.getActive().getSheetByName(BUTTON_TAB);
  if (!sh) throw new Error('No hay pestaña ' + BUTTON_TAB + '. Corre setupTribuneTab en el proyecto del publicador primero.');
  sh.getImages().forEach(function (img) { if (img.getScriptAssigned() === BUTTON_FN) img.remove(); });
  var img = sh.insertImage(BUTTON_URL, BUTTON_COL, BUTTON_ROW, 12, 4);
  img.assignScript(BUTTON_FN);
}
