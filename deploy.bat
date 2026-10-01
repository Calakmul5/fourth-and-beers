@echo off
setlocal EnableExtensions
rem ===========================================================================
rem VERSION  v1.0.0 c1.0.0
rem The only way to ship the leaderboard. Never run clasp push, git commit or
rem git push by hand. In order:
rem   0. Preflight: git and node present, no stale .git\index.lock, and every
rem      changed versioned file (index.html, gas\Publish.js, the architecture
rem      doc) has a bumped version stamp.
rem   1. Run test.bat.
rem   2. Sync: discard any local data.json change (only Publish.gs writes it),
rem      then git pull --rebase so the remote data.json wins.
rem   3. clasp push, run from gas\.
rem   4. Commit "Deploy page vX cX, publisher vY cY[: note]" and git push.
rem Nothing is pushed if 0 to 2 fail. Nothing is committed if clasp push fails.
rem
rem Usage:
rem   deploy.bat                      deploy
rem   deploy.bat "short note"         same, note appended to the commit message
rem   deploy.bat --check              run steps 0 and 1 only, change nothing
rem Keep notes free of quotes, ampersands and percent signs.
rem
rem OneDrive: this repo lives in a synced folder, and OneDrive can hold a file
rem inside .git open for a moment or leave index.lock behind. The script
rem removes a stale lock when no git process is running, and retries git
rem add and git commit up to 4 times, 5 seconds apart.
rem ===========================================================================
cd /d "%~dp0"

set "CHECKONLY="
set "NOTE="
if /i "%~1"=="--check" (set "CHECKONLY=1") else (set "NOTE=%~1")

rem ---- 0. Preflight ---------------------------------------------------------
where git >nul 2>nul
if errorlevel 1 (
  echo git is not on PATH. Install Git for Windows or fix PATH, then run deploy.bat again.
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node is not on PATH. Install Node.js, then run deploy.bat again.
  exit /b 1
)
git rev-parse --git-dir >nul 2>nul
if errorlevel 1 (
  echo This folder is not a git repository. Nothing pushed.
  exit /b 1
)
call :clear_stale_lock
if errorlevel 1 exit /b 1

set "PV="
set "PC="
set "UV="
set "UC="
for /f "tokens=1,2,3,4" %%a in ('node test\versions.js print') do (
  set "PV=%%a"
  set "PC=%%b"
  set "UV=%%c"
  set "UC=%%d"
)
if not defined UC (
  echo Could not read the version stamps from index.html and gas\Publish.js. Nothing pushed.
  exit /b 1
)
node test\versions.js check
if errorlevel 1 (
  echo.
  echo The files above changed since the last commit but their version did not.
  echo Bump v for functionality, c for content, then run deploy.bat again. Nothing pushed.
  exit /b 1
)
set "MSG=Deploy page %PV% %PC%, publisher %UV% %UC%"
if defined NOTE set "MSG=%MSG%: %NOTE%"
echo Deploying page %PV% %PC%, publisher %UV% %UC%.

rem ---- 1. Tests --------------------------------------------------------------
call "%~dp0test.bat"
if errorlevel 1 (
  echo.
  echo Tests failed. Nothing pushed. Fix the failures above first.
  exit /b 1
)

if defined CHECKONLY (
  echo.
  echo Check only. Versions bumped, tests green. A real run would deploy and commit as:
  echo   %MSG%
  exit /b 0
)

rem ---- 2. Sync with the remote ----------------------------------------------
echo.
echo Tests passed. Syncing with the remote...
call :git_retry checkout -- data.json
if errorlevel 1 goto :git_failed
rem Autostash carries the uncommitted deploy changes over the rebase.
call :git_retry pull --rebase --autostash
if errorlevel 1 (
  echo.
  echo git pull --rebase failed. Nothing pushed. Resolve it, then run deploy.bat again.
  exit /b 1
)

rem ---- 3. Apps Script ----------------------------------------------------------
echo.
echo Pushing the publisher to Apps Script...
pushd gas
call clasp push
set "CLASPERR=%ERRORLEVEL%"
popd
if not "%CLASPERR%"=="0" (
  echo.
  echo clasp push failed. Nothing committed.
  exit /b 1
)

rem ---- 4. Commit and push ------------------------------------------------------
call :git_retry add -A
if errorlevel 1 goto :commit_failed
git diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo Apps Script updated. Nothing changed since the last commit, so no new commit.
  goto :show_log
)
call :git_retry commit -q -m "%MSG%"
if errorlevel 1 goto :commit_failed
set "HASH="
for /f %%h in ('git rev-parse --short HEAD') do set "HASH=%%h"
git push
if errorlevel 1 goto :push_failed
echo.
echo Deployed and pushed %HASH%: %MSG%

:show_log
echo.
echo Last three commits:
git --no-pager log --oneline -3
exit /b 0

:git_failed
echo.
echo git failed. Nothing pushed. Pause OneDrive and run deploy.bat again.
exit /b 1

:commit_failed
echo.
echo ===========================================================================
echo APPS SCRIPT IS UPDATED BUT NOTHING IS COMMITTED. Pause OneDrive, then run:
echo   git add -A
echo   git commit -m "%MSG%"
echo   git push
echo ===========================================================================
exit /b 2

:push_failed
echo.
echo ===========================================================================
echo COMMITTED %HASH% LOCALLY BUT git push FAILED. The page is not live yet.
echo If the remote moved, run:  git pull --rebase   then   git push
echo ===========================================================================
exit /b 2

rem ---- Helpers ----------------------------------------------------------------
:clear_stale_lock
if not exist ".git\index.lock" exit /b 0
tasklist /fi "imagename eq git.exe" 2>nul | find /i "git.exe" >nul
if not errorlevel 1 (
  echo Another git process is running and holds .git\index.lock. Close it, then run deploy.bat again.
  exit /b 1
)
echo Removing a stale .git\index.lock left by an earlier git run or OneDrive.
del /f /q ".git\index.lock" >nul 2>nul
if exist ".git\index.lock" (
  echo Could not remove .git\index.lock. OneDrive may have it open. Pause OneDrive and try again.
  exit /b 1
)
exit /b 0

:git_retry
set /a TRY=0
:git_retry_loop
set /a TRY+=1
call :clear_stale_lock >nul
git %*
if not errorlevel 1 exit /b 0
if %TRY% GEQ 4 exit /b 1
echo   git %1 failed, attempt %TRY% of 4. OneDrive may be holding a file. Retrying in 5 seconds...
timeout /t 5 /nobreak >nul
goto :git_retry_loop
