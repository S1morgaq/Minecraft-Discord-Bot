@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"
title ZentarNetwork Bot - Kurulum

echo ==============================================
echo  ZentarNetwork Discord Botu - Kurulum
echo ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun ^(en az v20^).
  goto :fail
)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
for /f "delims=" %%v in ('node -v') do set NODE_FULL=%%v
echo Node.js surumu: %NODE_FULL%
if %NODE_MAJOR% LSS 20 (
  echo [HATA] Node.js 20 veya uzeri gerekli. Lutfen guncelleyin.
  goto :fail
)

echo.
echo Bagimliliklar yukleniyor ^(npm install^)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo [HATA] npm install basarisiz oldu. Internet baglantinizi ve yukaridaki hata mesajini kontrol edin.
  goto :fail
)

echo.
if not exist ".env" (
  echo [BILGI] .env dosyasi bulunamadi.
  echo         1^) .env.example dosyasini kopyalayip adini .env yapin
  echo         2^) DISCORD_TOKEN, CLIENT_ID, GUILD_ID, MONGODB_URI ve MC_BRIDGE_SECRET degerlerini doldurun
  echo            ^(gizli anahtar uretmek icin: node scripts\generate-secret.js^)
  echo         3^) Sonra bu dosyayi tekrar calistirin.
  goto :done
)

echo Yapilandirma ve baglanti kontrolleri calistiriliyor...
call node scripts\check-config.js
if errorlevel 1 (
  echo.
  echo [HATA] Kontrol basarisiz. .env degerlerini duzeltip tekrar deneyin.
  goto :fail
)

echo.
echo Slash komutlari Discord'a kaydediliyor...
call node scripts\deploy-commands.js
if errorlevel 1 (
  echo [HATA] Slash komutlari kaydedilemedi.
  goto :fail
)

:done
echo.
echo Kurulum tamamlandi. Botu baslatmak icin start.bat dosyasini calistirin.
pause
exit /b 0

:fail
echo.
echo Kurulum tamamlanamadi.
pause
exit /b 1
