@echo off
setlocal EnableExtensions
title VHDL Laboratory - Offline VHDL Simulator

rem =====================================================================
rem  VHDL Laboratory - one-click launcher
rem  Starts the Flask backend with GHDL from %APP_DIR%\ghdl-mcode-6.0.0-ucrt64
rem  and opens the default browser automatically.
rem =====================================================================

rem ---- locate this script's folder (works from any drive/path) -------
set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"

rem ---- GHDL: project-local bundle first, else PATH -------------------
set "GHDL_DIR=%APP_DIR%\ghdl-mcode-6.0.0-ucrt64\bin"
if exist "%GHDL_DIR%\ghdl.exe" goto :ghdl_ok

where ghdl >nul 2>nul
if errorlevel 1 goto :no_ghdl
echo [1/4] GHDL found on PATH.
goto :check_python

:ghdl_ok
set "GHDL_BIN=%GHDL_DIR%\ghdl.exe"
set "PATH=%GHDL_DIR%;%PATH%"
echo [1/4] GHDL found: %GHDL_BIN%
goto :check_python

:no_ghdl
echo.
echo [ERROR] GHDL not found.
echo         Expected: %GHDL_DIR%\ghdl.exe
echo         or ghdl.exe on PATH.
echo         Download from https://github.com/ghdl/ghdl/releases
goto :fail

:check_python
where python >nul 2>nul
if errorlevel 1 goto :no_python
echo [2/4] Python OK.
goto :check_deps

:no_python
echo.
echo [ERROR] Python not found on PATH. Install it from python.org
echo         with "Add Python to PATH" enabled, then run this again.
goto :fail

:check_deps
python -c "import flask, vcdvcd" >nul 2>nul
if errorlevel 1 goto :install_deps
echo [3/4] Dependencies OK.
goto :pick_port

:install_deps
echo [3/4] Installing required packages (first run only)...
python -m pip install --quiet flask vcdvcd
if errorlevel 1 goto :pip_fail
goto :pick_port

:pip_fail
echo.
echo [ERROR] pip install failed - check your internet connection.
goto :fail

:pick_port
set "PORT=5000"
python -c "import socket; s = socket.socket(); s.bind(('127.0.0.1', 5000)); s.close()" >nul 2>nul
if not errorlevel 1 goto :launch

set "PORT=5050"
python -c "import socket; s = socket.socket(); s.bind(('127.0.0.1', 5050)); s.close()" >nul 2>nul
if not errorlevel 1 (
    echo       Port 5000 unavailable on Windows - using port 5050.
    goto :launch
)

set "PORT=8000"
python -c "import socket; s = socket.socket(); s.bind(('127.0.0.1', 8000)); s.close()" >nul 2>nul
if not errorlevel 1 (
    echo       Port 5000/5050 unavailable - using port 8000.
    goto :launch
)

set "PORT=3000"
echo       Port 5000/5050/8000 unavailable - using port 3000.

:launch
echo [4/4] Starting server on http://127.0.0.1:%PORT% ...
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://127.0.0.1:%PORT%"

cd /d "%APP_DIR%"
python app.py
echo.
echo The server has stopped.
goto :end

:fail
echo.

:end
echo ================================================================
echo  Server closed. Press any key to exit this window.
echo ================================================================
pause >nul
endlocal
