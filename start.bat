@echo off
cd /d "%~dp0"
echo 正在安装依赖...
call npm install
echo.
echo 正在启动服务...
call npm start
pause
