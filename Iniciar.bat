@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Allgo Movie Maker

rem Vai para a pasta do proprio .bat (funciona mesmo clicado de outro lugar).
cd /d "%~dp0"

echo.
echo   ======================================
echo    Allgo Movie Maker
echo   ======================================
echo.

rem --- Node instalado? ---------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERRO] Node.js nao encontrado.
  echo  Instale o Node.js LTS em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

rem --- Dependencias instaladas? -----------------------------------------
if not exist "node_modules" (
  echo  Primeira vez: instalando dependencias. Isso demora alguns minutos...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  [ERRO] Falha ao instalar as dependencias.
    pause
    exit /b 1
  )
  echo.
)

rem --- FFmpeg baixado? ---------------------------------------------------
if not exist "resources\bin\ffmpeg.exe" (
  echo  Baixando o FFmpeg ^(~100 MB, so na primeira vez^)...
  echo.
  call npm run setup
  if errorlevel 1 (
    echo.
    echo  [AVISO] Nao foi possivel baixar o FFmpeg automaticamente.
    echo  O programa abre, mas nao vai analisar midia nem exportar ate voce
    echo  colocar ffmpeg.exe e ffprobe.exe em resources\bin\.
    echo.
    pause
  )
  echo.
)

rem --- Programa compilado? ----------------------------------------------
if not exist "out\main\main.js" (
  echo  Compilando o programa ^(so na primeira vez^)...
  echo.
  call npm run build
  if errorlevel 1 (
    echo.
    echo  [ERRO] Falha ao compilar.
    pause
    exit /b 1
  )
  echo.
)

echo  Abrindo o Allgo Movie Maker...
echo  ^(Esta janela preta fecha sozinha quando voce fechar o programa.^)
echo.

call npx electron .

endlocal
