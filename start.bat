@echo off
chcp 65001 >nul
echo ====================================
echo   启动 视频特效助手
echo ====================================
echo.

node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到Node.js
    echo 请先安装: https://nodejs.org
    pause
    exit /b 1
)
echo [OK] Node.js 已安装

if not exist "node_modules" (
    echo [1/3] 正在安装依赖...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] npm install 失败
        pause
        exit /b 1
    )
    echo [OK] 依赖安装完成
) else (
    echo [OK] 依赖已存在
)

if not exist "bin\ffmpeg.exe" (
    echo [2/3] ffmpeg未找到
    echo [错误] 请确保 bin\ffmpeg.exe 存在
    pause
    exit /b 1
) else (
    echo [OK] ffmpeg已存在
)

echo [3/3] 启动中...
call npm start
if %errorlevel% neq 0 (
    echo.
    echo [错误] 启动失败
)
pause
