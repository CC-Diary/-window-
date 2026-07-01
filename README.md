# 口播特效 Window 版本

> 基于 AI 的口播视频自动特效生成工具 —— 导入视频，自动识别关键词，一键生成柱子哥风格的可视化特效。

## 功能概览

### 两种工作模式

| 模式 | 说明 |
|------|------|
| **口播加特效** | 人在右边，关键词特效在左边，深色遮罩跟随特效，不需要字幕 |
| **配字幕特效** | 云端语音识别转文字，字幕+特效同步时间点，适合讲解类视频 |

### 四步工作流

```
选择模式 → 导入视频 → AI分析 → 预览确认 → 导出视频
```

### AI 能力

- **语音识别**：通义千问 Paraformer-v2 / OpenAI Whisper，自动提取口播文案
- **特效设计**：AI 自动分析文案，提取关键词，生成特效时间轴方案
- **可修改**：支持手动调整关键词后重新生成特效

### 特效类型

| 特效 | 样式 | 用途 |
|------|------|------|
| 标签 | 蓝色竖线 + 英文 + 中文 | 概念标注 |
| 大数字 | 金色 180px + 发光阴影 | 数据强调 |
| 对比卡片 | BEFORE(红) vs NOW(绿) | 数据对比 |
| 柱子图 | 渐变填充 + GSAP 动画 | 效率/增长可视化 |
| 进度条 | 动画进度 | 变化趋势 |
| 金句 | 金色边框 + 大字 | 重点强调 |
| 行动号召 | 大字 + 副标题 | 结尾 CTA |

## 技术栈

- **Electron** — 桌面应用框架
- **HyperFrames** — 视频渲染引擎
- **GSAP** — 动画库
- **FFmpeg** — 视频转码与处理
- **NotoSansSC** — 中文字体

## 环境要求

- Windows 10+（已打包为 portable 版本）
- Node.js 18+（开发环境）
- 联网（用于 AI 分析和语音识别）

## 安装与使用

### 直接使用

下载 `dist/` 目录下的 `.exe` 文件，双击运行即可。

### 开发模式

```bash
# 安装依赖
npm install

# 启动开发模式
npm start

# 打包 Windows 版本
npm run build:win
```

## API Key 配置

| 服务 | 用途 | 获取地址 |
|------|------|----------|
| 通义千问 | 语音识别 + AI 分析 | dashscope.console.aliyun.com |
| DeepSeek | AI 分析（推荐） | platform.deepseek.com |
| OpenAI | 语音识别（可选） | platform.openai.com |

## 项目结构

```
├── main.js              # Electron 主进程
├── package.json
├── bin/                 # FFmpeg 可执行文件
├── fonts/               # NotoSansSC 中文字体
├── src/
│   ├── index.html       # 主界面
│   ├── renderer.js      # 渲染进程逻辑
│   ├── template.html    # 特效模板
│   └── gsap.min.js      # GSAP 动画库
├── setup.bat            # Windows 安装脚本
└── start.bat            # Windows 启动脚本
```

## 许可证

本项目采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans) 许可证。

**这意味着：**
- ✅ 可以自由分享和修改
- ✅ 需要署名原作者
- ❌ 禁止商业用途
- ✅ 衍生作品必须采用相同许可证

## 免责声明

本软件仅供学习和研究使用，不得用于商业目的。作者不对使用本软件产生的任何损失负责。