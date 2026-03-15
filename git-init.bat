@echo off
cd /d "e:\ProgramData\AI\Sudoku\xiaoyuzhou-assistant"
"E:\programFiles\Git\cmd\git.exe" init
"E:\programFiles\Git\cmd\git.exe" add -A
"E:\programFiles\Git\cmd\git.exe" commit -m "feat: 初始化小宇宙播客总结助手

- 实现播客链接解析
- 集成 OpenAI Whisper 音频转录
- 集成 Google Gemini AI 总结
- 实现飞书多维表格同步
- 响应式前端界面
- 支持本地代理配置"
pause
