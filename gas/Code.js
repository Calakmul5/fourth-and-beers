// Fourth & Beers 2026 - Quiniela leaderboard web app
// v1.0.0 c1.0.0
// Serves index.html publicly. Personal link: <web app URL>?yo=Cyber70

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Fourth & Beers 2026: así va la quiniela')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}
