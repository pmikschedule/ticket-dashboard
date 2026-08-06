@echo off
rem ===========================================================================
rem  Email-to-Ticket agent launcher (Windows + Outlook)
rem
rem  Messages are ASCII on purpose. A .bat with Korean text renders as mojibake
rem  on a CP949 console, so the Korean explanation lives in docs\SETUP.md ch.8.
rem
rem  Outlook COM needs a logged-on desktop session. Keep this window open.
rem  Running it as a service silently collects nothing.
rem
rem  Usage:  start-agent.bat           check, then run continuously
rem          start-agent.bat collect   scan once
rem          start-agent.bat doctor    check only
rem ===========================================================================
setlocal
cd /d "%~dp0"

set "MODE=%~1"
if "%MODE%"=="" set "MODE=run"

echo.
echo   Email-to-Ticket agent
echo   ----------------------------------------------------------------
echo   Folder: %CD%
echo   Mode  : %MODE%
echo.

if not exist ".venv\Scripts\ticket-agent.exe" (
  echo   [X] Not installed yet. Run these first:
  echo.
  echo         python -m venv .venv
  echo         .venv\Scripts\activate
  echo         pip install -e .
  echo.
  echo       See docs\SETUP.md section 8-3.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo   [!] No .env found. Copying .env.example ...
  copy /y ".env.example" ".env" >nul
  echo       Notepad will open. Fill SUPABASE_URL and SUPABASE_SERVICE_KEY,
  echo       save, then come back here and press a key.
  echo.
  notepad ".env"
  pause
)

findstr /c:"sb_secret_xxxxxxxxxxxxxxxxxxxx" ".env" >nul 2>&1
if not errorlevel 1 (
  echo   [X] SUPABASE_SERVICE_KEY is still the example value.
  echo       Supabase dashboard - Project Settings - API keys - Secret key
  echo.
  notepad ".env"
  pause
  exit /b 1
)

findstr /c:"SUPABASE_SERVICE_KEY=sb_publishable_" ".env" >nul 2>&1
if not errorlevel 1 (
  echo   [X] SUPABASE_SERVICE_KEY holds a Publishable key.
  echo       That key cannot write. Use the Secret key ^(sb_secret_...^).
  echo.
  pause
  exit /b 1
)

if /i "%MODE%"=="doctor" (
  ".venv\Scripts\ticket-agent.exe" doctor
  echo.
  pause
  exit /b %ERRORLEVEL%
)

echo   Checking configuration and connections ...
echo.
".venv\Scripts\ticket-agent.exe" doctor
if errorlevel 1 (
  echo.
  echo   [X] Check failed. See docs\SETUP.md section 8-6 for causes.
  echo.
  pause
  exit /b 1
)

echo.
echo   ----------------------------------------------------------------
echo   Check passed. Starting '%MODE%'.   Stop with Ctrl+C.
echo   Closing this window stops the agent.
echo   ----------------------------------------------------------------
echo.
".venv\Scripts\ticket-agent.exe" %MODE%
set "RC=%ERRORLEVEL%"
echo.
echo   Agent exited (code %RC%).
pause
exit /b %RC%
