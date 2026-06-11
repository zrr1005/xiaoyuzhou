@echo off
cd /d "%~dp0"

echo ============================================
echo   小宇宙播客 AI 总结助手
echo ============================================
echo.
echo 转录引擎: whisper.cpp (CPU, 首次启动自动下载模型)
echo Web 服务: http://localhost:3000
echo.
call npm start
pause
