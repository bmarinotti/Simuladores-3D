@echo off
REM Sobe um servidor HTTP local na pasta do projeto e abre o hub no navegador.
REM Necessario porque os simuladores usam modulos ES (file:// e bloqueado por CORS).

cd /d "%~dp0"

set PORTA=8080

where py >nul 2>nul
if %ERRORLEVEL%==0 (
  start "" http://localhost:%PORTA%/
  py -3 -m http.server %PORTA%
  goto :eof
)

where python >nul 2>nul
if %ERRORLEVEL%==0 (
  start "" http://localhost:%PORTA%/
  python -m http.server %PORTA%
  goto :eof
)

echo Python nao encontrado no PATH.
echo Instale o Python ou sirva a pasta com qualquer outro servidor HTTP estatico.
pause
