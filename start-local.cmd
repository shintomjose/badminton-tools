@echo off
rem One-click local start: serves the app at http://localhost:8010 and opens the browser.
rem Port 8010, not 8000: the tsg-heilbronn app uses 8000, and two apps on one port
rem share an origin - its service worker would keep serving its own cached shell here.
rem The server runs in its own window - close that window (or Ctrl+C) to stop.
rem localhost is an authorized Firebase Auth domain, so Google sign-in works here;
rem opening index.html via file:// does not.
cd /d "%~dp0"

set "PY=python"
where python >nul 2>nul || set "PY=py"
where %PY% >nul 2>nul || (
  echo Python not found. Install Python or use: npx serve -l 8010
  pause
  exit /b 1
)

start "Badminton Tools - local server (close to stop)" cmd /k %PY% -m http.server 8010
timeout /t 1 /nobreak >nul
start "" http://localhost:8010
