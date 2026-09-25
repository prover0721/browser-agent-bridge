@echo off
title Browser Agent Bridge Server
echo [Browser Agent] 正在启动桥接服务 (端口: 3088)...
cd /d "%~dp0bridge-server"
node dist/index.js
pause
