@echo off
cd /d "e:\ProgramData\AI\Sudoku\xiaoyuzhou-assistant"

echo 请先在 GitHub 上创建仓库，然后输入仓库地址（直接回车跳过）:
set /p repo_url=

if not "%repo_url%"=="" (
    "E:\programFiles\Git\cmd\git.exe" remote add origin %repo_url%
)

echo 推送到远程仓库...
"E:\programFiles\Git\cmd\git.exe" push -u origin master

pause
