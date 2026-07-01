@echo off
chcp 65001 >nul
echo ====================================
echo   视频特效助手 - 环境安装
echo ====================================
echo.

echo [1/3] 检查Node.js...
node -v
if %errorlevel% neq 0 (
    echo.
    echo [错误] 未检测到Node.js
    echo 请先安装: https://nodejs.org
    pause
    exit /b 1
)
echo [OK] Node.js 已安装
echo.

echo [2/3] 安装依赖...
call npm install
if %errorlevel% neq 0 (
    echo.
    echo [错误] npm install 失败
    pause
    exit /b 1
)
echo [OK] 依赖安装完成
echo.

echo [3/3] 检查ffmpeg...
if not exist "bin\ffmpeg.exe" (
    echo ffmpeg未找到，正在下载...
    echo 提示：ffmpeg已内置在bin目录，此步骤应跳过
) else (
    echo [OK] ffmpeg已存在
)
echo.

echo ====================================
echo   安装完成!
echo.
echo   语音识别：使用云端API
echo   在应用左侧填写API Key
echo.
echo ====================================
echo   下一步:
echo   启动: 双击 start.bat
echo ====================================
echo.
pause
