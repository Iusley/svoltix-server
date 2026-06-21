@echo off

echo ===================================
echo INICIANDO SVOLTIX SERVER
echo ===================================

cd /d C:\svoltix-server

echo.
echo Iniciando MQTT...
start "MQTT" cmd /k node mqtt.js

timeout /t 3 > nul

echo.
echo Iniciando API...
start "API" cmd /k node server.js

timeout /t 3 > nul

echo.
echo Iniciando Cloudflare Tunnel...
start "TUNNEL" cmd /k "C:\Cloudflared\cloudflared.exe tunnel --url http://localhost:3000"

echo.
echo SVOLTIX INICIADO COM SUCESSO
echo.