@echo off
cd /d "%~dp0"

echo ============================================
echo   小宇宙总结助手
echo ============================================
echo.
echo 转录默认使用 Gemini 云端（无需额外配置）
echo 如需本地转录兜底，请手动启动 Whisper 服务
echo.
echo 启动 Web 服务 (端口 3000)...
call npm start
pause
