@echo off
REM ================================================================
REM Meezingvideo — lokale ontwikkelserver starten
REM Probeert achtereenvolgens Python, Node (npx), en valt anders terug
REM op een melding met installatie-instructies.
REM ================================================================
setlocal
cd /d "%~dp0"

set "PORT=8000"
set "URL=http://localhost:%PORT%/index.html"

echo.
echo  ==============================================
echo   Meezingvideo lokaal starten op poort %PORT%
echo  ==============================================
echo.

REM --- Probeer Python (py launcher) ---
where py >nul 2>&1
if %ERRORLEVEL%==0 (
    echo  [Python gevonden] start server...
    start "" "%URL%"
    py -m http.server %PORT%
    goto :eof
)

REM --- Probeer python ---
where python >nul 2>&1
if %ERRORLEVEL%==0 (
    echo  [Python gevonden] start server...
    start "" "%URL%"
    python -m http.server %PORT%
    goto :eof
)

REM --- Probeer Node (npx serve) ---
where npx >nul 2>&1
if %ERRORLEVEL%==0 (
    echo  [Node gevonden] gebruik npx serve...
    start "" "%URL%"
    npx --yes serve -l %PORT% .
    goto :eof
)

echo.
echo  Geen Python of Node gevonden.
echo.
echo  Installeer een van de volgende, dan dubbelklik je opnieuw op start.bat:
echo    - Python:  https://www.python.org/downloads/   (vink "Add to PATH" aan)
echo    - Node.js: https://nodejs.org/
echo.
echo  Of open `index.html` direct in de browser (sommige onderdelen
echo  kunnen dan minder goed werken vanwege browser-restricties op file://).
echo.
pause
