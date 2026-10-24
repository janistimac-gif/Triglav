@echo off
chcp 65001 >nul
title Triglav - Namestitev / Gradnja
echo ========================================
echo   TRIGLAV - namestitveni paket
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [NAPAKA] Node.js ni nameščen.
  echo Prenesi: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo Node.js: 
node -v
echo.

echo [1/3] Namestitev odvisnosti...
call npm install
if errorlevel 1 (
  echo [NAPAKA] npm install ni uspel.
  pause
  exit /b 1
)

echo.
echo [2/3] Gradnja namestitvenega programa (.exe)...
echo     To lahko traja 5–15 minut (prenos Electron ~150 MB).
echo.
call npm run build:installer
if errorlevel 1 (
  echo.
  echo [OPOZORILO] NSIS installer ni uspel, poskušam portable...
  call npm run build:portable
  if errorlevel 1 (
    echo [NAPAKA] Gradnja ni uspela.
    pause
    exit /b 1
  )
)

echo.
echo [3/3] Končano!
echo.
echo Datoteke v mapi dist\:
dir /b dist\*.exe 2>nul
echo.
echo  - Triglav-Setup-*.exe  = namestitveni program (priporočeno)
echo  - Triglav-*-portable.exe = brez namestitve
echo.
echo Zaženi Setup .exe in sledi čarovniku.
echo ========================================
pause
