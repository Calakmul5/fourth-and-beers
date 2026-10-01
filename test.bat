@echo off
rem Run the full test suite from the repo root. Exit code 0 = safe to deploy.
rem Non-zero = read the FAIL line(s) above and fix before deploying.
rem Needs Node. Installs jsdom on the first run (npm install).
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node is not on PATH. Install Node.js, then run test.bat again.
  popd
  exit /b 1
)
if not exist node_modules\jsdom (
  echo Installing test dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo npm install failed.
    popd
    exit /b 1
  )
)
call node test\run_all.js
set EXITCODE=%ERRORLEVEL%
popd
exit /b %EXITCODE%
