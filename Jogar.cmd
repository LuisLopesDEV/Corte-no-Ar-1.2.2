@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js para abrir o jogo.
  pause
  exit /b 1
)
node scripts\jogar.mjs --open
if errorlevel 1 pause
