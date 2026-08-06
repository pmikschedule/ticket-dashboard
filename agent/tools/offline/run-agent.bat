@echo off
rem ===========================================================================
rem  Email-to-Ticket agent - offline launcher (no install required)
rem
rem  Messages are ASCII on purpose: Korean text in a .bat renders as mojibake
rem  on a CP949 console. See READ-ME-FIRST.txt for the Korean guide.
rem
rem  Outlook COM needs a logged-on desktop session. Keep this window open.
rem
rem  Usage:  run-agent.bat            check, then run continuously
rem          run-agent.bat collect    scan once
rem          run-agent.bat doctor     check only
rem ===========================================================================
setlocal
cd /d "%~dp0"

set "MODE=%~1"
if "%MODE%"=="" set "MODE=run"

echo.
echo   Email-to-Ticket agent  (offline bundle)
echo   ----------------------------------------------------------------
echo   Folder: %CD%
echo   Mode  : %MODE%
echo.

rem --- find a python ------------------------------------------------------
set "PY="
where py >nul 2>&1 && set "PY=py"
if not defined PY (
  where python >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo   [X] Python not found on PATH.
  echo.
  echo       Try the full path instead, for example:
  echo         "C:\Program Files\Python312\python.exe" run.py %MODE%
  echo.
  echo       See READ-ME-FIRST.txt.
  echo.
  pause
  exit /b 1
)

%PY% --version
echo.

rem --- .env ---------------------------------------------------------------
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
  echo       Supabase - Project Settings - API keys - Secret key
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
  %PY% run.py doctor
  echo.
  pause
  exit /b %ERRORLEVEL%
)

echo   Checking configuration and connections ...
echo.
%PY% run.py doctor
if errorlevel 1 (
  echo.
  echo   [X] Check failed. See the messages above.
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
%PY% run.py %MODE%
set "RC=%ERRORLEVEL%"
echo.
echo   Agent exited (code %RC%).
pause
exit /b %RC%
