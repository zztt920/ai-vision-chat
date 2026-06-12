# AI 会议助手 📋🤖

基于浏览器的 AI 远程会议记录助手，支持摄像头 + 屏幕共享双源输入，通过语音交互自动记录会议内容并生成结构化会议纪要。

## 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| 前端 | HTML5 + CSS3 + Vanilla JS | 单页应用，无需框架 |
| 摄像头 | WebRTC (getUserMedia) | 浏览器原生 API |
| 屏幕共享 | WebRTC (getDisplayMedia) | 远程会议画面共享 |
| 语音识别 | Web Speech API | 浏览器原生 STT，免费 |
| 语音合成 | Web Speech API | 浏览器原生 TTS，免费 |
| 视觉理解 | 阿里云百炼 DashScope qwen3-vl-plus | 国内直连，支持图像理解 |
| 后端代理 | Node.js (Express) | API 密钥保护，支持多平台 |

## 快速开始

### 1. 获取 API 密钥

注册 [阿里云百炼](https://dashscope.aliyun.com/) → 模型广场 → API-KEY 管理 → 创建密钥

### 2. 启动后端代理

```bash
cd server
npm install
cp .env.example .env    # 编辑 .env 填入 API Key
npm start               # 启动在 http://localhost:3000
```

### 3. 打开前端

直接用浏览器打开 `index.html`（或通过任意 HTTP 服务器托管）。

### 4. 开始会议

点击 **「开始会议」** 按钮，授权摄像头和麦克风权限，即可开始记录。

## 功能

- 🎬 摄像头实时画面预览 + AI 视觉理解
- 🖥 屏幕共享（远程会议场景：PPT/文档/表格）
- 🎤 语音自动识别记录会议内容
- 🔊 AI 语音回复
- ⏱ 实时会议计时
- 📄 一键生成结构化会议纪要
- 💬 对话历史文字记录
- 🔄 摄像头/屏幕切换

## 快捷指令

- 说 **「记录一下」** — 保存重要会议决定
- 说 **「生成会议纪要」** — 自动输出完整纪要

## 项目结构

```
ai-vision-chat/
├── index.html          # 主页面
├── style.css           # 样式
├── app.js              # 主应用逻辑
├── modules/            # 前端模块
│   ├── utils.js        # 工具函数
│   ├── camera.js       # 摄像头管理
│   ├── screenshare.js  # 屏幕共享
│   ├── speech.js       # 语音识别/合成
│   ├── api.js          # API 通信
│   └── chat.js         # 对话管理
└── server/             # 后端代理
    ├── index.js
    ├── package.json
    └── .env.example
```