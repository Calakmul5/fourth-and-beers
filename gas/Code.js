// Fourth & Beers 2026 - Publicar button, same project as Publish.js (bound to the participants workbook)
// v1.1.1 c1.0.0
//
// A drawing or image button in Sheets can only run a function of a script bound to that workbook, which is why the
// whole project is bound. publishNow() shows a toast, calls publishManual() from Publish.js and shows its status
// in a popup.
//
// One-time setup, from this project's editor
//   1. Run setupPublishButton() and approve the permissions. It puts the button at K1 of the Tribune tab.
//   2. Click the button once and read the popup.
// The workbook also gets a "Tribune" menu with the same Publicar action (onOpen), so there is always a way to publish
// that sits outside the cells.

var BUTTON_URL = 'https://calakmul5.github.io/fourth-and-beers/assets/publicar.png';  // served by GitHub Pages
var BUTTON_TAB = 'Tribune';
var BUTTON_COL = 11;        // K, the first column right of the Warnings table (H:J)
var BUTTON_ROW = 1;
var BUTTON_FN = 'publishNow';
var BUTTON_ALT = 'Publicar button';   // an image cannot report its assigned script, so its own button is found by this alt text

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
    result = publishManual();
  } catch (e) {
    result = { status: 'error', message: String(e && e.message ? e.message : e) };
  }
  var text = publishMessage_(result, ss.getSpreadsheetTimeZone());
  Logger.log(text);
  try {
    var ui = SpreadsheetApp.getUi();
    ui.alert('Fourth and Beers', text, ui.ButtonSet.OK);
  } catch (e) {
    // No UI in this run (started from the editor, or the workbook is not open): the toast and the log still carry the answer.
    ss.toast(text, 'Fourth and Beers', 30);
  }
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
  return 'No se publicó: ' + msg;
}

/** Run once, safe to repeat. Puts the image button at K1 of the Tribune tab and assigns publishNow to it. */
function setupPublishButton() {
  var sh = SpreadsheetApp.getActive().getSheetByName(BUTTON_TAB);
  if (!sh) throw new Error('No hay pestaña ' + BUTTON_TAB + '. Corre setupTribuneTab en el proyecto del publicador primero.');
  setWarningWidths_(sh);   // narrower Warnings columns (Publish.js), so K1 is closer to the screen
  sh.getImages().forEach(function (img) { if (img.getAltTextTitle() === BUTTON_ALT) img.remove(); });
  var img = sh.insertImage(BUTTON_URL, BUTTON_COL, BUTTON_ROW, 12, 4);
  img.setAltTextTitle(BUTTON_ALT);
  img.assignScript(BUTTON_FN);
}
