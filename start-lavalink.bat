@echo off
title Reso - Local Lavalink Node (Chennai)
echo ========================================================
echo   Starting Reso Local Lavalink Server (Chennai, India)
echo ========================================================
cd /d "%~dp0\lavalink"
java -Xms128m -Xmx768m -XX:+UseG1GC -XX:+ParallelRefProcEnabled -jar Lavalink.jar
pause
