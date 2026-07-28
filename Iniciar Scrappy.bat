@echo off
title Scrappy - Buscador de Negocios
cd /d "%~dp0"

echo.
echo  ========================================
echo    Scrappy - Buscador de Negocios
echo  ========================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Node.js no esta instalado.
    echo  Descargalo desde https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo  Primera vez: instalando dependencias...
    echo  Esto puede tardar un par de minutos.
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo  ERROR al instalar dependencias.
        pause
        exit /b 1
    )
    echo.
    echo  Instalando navegador para scraping...
    call npx playwright install chromium
    echo.
)

echo  Iniciando Scrappy...
echo  Se abrira en tu navegador automaticamente.
echo.
echo  NO cierres esta ventana mientras uses Scrappy.
echo  Para cerrar Scrappy, cierra esta ventana.
echo.

start "" "http://localhost:3847/index.html"
node server.js

pause
