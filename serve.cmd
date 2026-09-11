@echo off
REM ─────────────────────────────────────────────────────────────
REM  Kent Axell site - local preview
REM  Double-click this file, or run  serve  from a terminal here.
REM ─────────────────────────────────────────────────────────────

cd /d "%~dp0"

where netlify >nul 2>&1
if %errorlevel% equ 0 goto netlify

echo.
echo   Netlify CLI not found - serving STATIC FILES ONLY.
echo   The page renders fine, but the booking form will 404 on submit,
echo   because it posts to /.netlify/functions/lead
echo.
echo   For the full thing:   npm i -g netlify-cli
echo.
echo   http://localhost:8181      [Ctrl+C to stop]
echo.
start "" "http://localhost:8181"
python -m http.server 8181
goto end

:netlify
echo.
echo   Serving static files + the lead function.
echo.
echo   http://localhost:8181      [Ctrl+C to stop]
echo.
netlify dev --port 8181

:end
