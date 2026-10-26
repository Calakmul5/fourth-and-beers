@echo off
rem make_og_card.bat v1.0.0 c1.0.0
rem Redraws assets\og-card.png, apple-touch-icon.png and favicon-32.png from tools\og-card.html.
rem Optional: make_og_card.bat some\folder writes there instead of assets. Not run by test.bat or deploy.bat.
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node is not on PATH. Install Node.js first.
  popd
  exit /b 1
)
if not exist node_modules\playwright (
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo npm install failed.
    popd
    exit /b 1
  )
)
call node tools\make_og_card.js %*
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" echo If the browser is missing, run: npx playwright install chromium
popd
exit /b %EXITCODE%
