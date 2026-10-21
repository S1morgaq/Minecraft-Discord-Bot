@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ZentarNetwork Bot

where node >nul 2>nul
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi. Once install.bat dosyasini calistirin.
  goto :end
)
if not exist "node_modules" (
  echo [HATA] Bagimliliklar yuklenmemis. Once install.bat dosyasini calistirin.
  goto :end
)
if not exist ".env" (
  echo [HATA] .env dosyasi yok. .env.example dosyasini .env olarak kopyalayip doldurun.
  goto :end
)

echo Yapilandirma kontrol ediliyor...
call node -e "const p=require('./src/config/env').validate();if(p.length){console.error('Yapilandirma hatasi:\n - '+p.join('\n - '));process.exit(1)}"
if errorlevel 1 goto :end

echo Bot baslatiliyor... ^(Durdurmak icin Ctrl+C^)
echo.
node src\index.js
set EXITCODE=%errorlevel%
echo.
if not "%EXITCODE%"=="0" (
  echo [HATA] Bot beklenmedik sekilde kapandi ^(cikis kodu: %EXITCODE%^). Yukaridaki mesajlari inceleyin.
  echo        Sik nedenler: gecersiz token, MongoDB'ye baglanilamamasi, Discord'da ayricalikli intent'lerin kapali olmasi.
) else (
  echo Bot kapatildi.
)

:end
echo.
pause
