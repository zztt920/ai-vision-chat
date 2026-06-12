# AI 视讯助手 🎥🤖

基于浏览器的 AI 视觉对话应用，通过摄像头与麦克风实现多模态交互——AI 能"看到"你摄像头画面中的内容，"听到"你的语音提问，并给予语音+文字回复。

## 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| 前端 | HTML5 + CSS3 + Vanilla JS | 单页应用，无需框架 |
| 摄像头 | WebRTC (getUserMedia) | 浏览器原生 API |
| 语音识别 | Web Speech API | 浏览器原生 STT，免费 |
| 语音合成 | Web Speech API | 浏览器原生 TTS，免费 |
| 视觉理解 | Google Gemini 1.5 Flash | 免费层 60 RPM |
| 后端代理 | Node.js (Express) | API 密钥保护 |

## 快速开始

### 1. 启动后端代理

```bash
cd server
npm install
cp .env.example .env    # 编辑 .env 填入你的 Gemini API Key
npm start               # 启动在 http://localhost:3000
```

> 获取 Gemini API Key: https://aistudio.google.com/apikey

### 2. 打开前端

直接用浏览器打开 `index.html`（或通过任意 HTTP 服务器托管）。

### 3. 开始对话

点击 **「开始对话」** 按钮，授权摄像头和麦克风权限，然后对着摄像头说话即可。

## 功能

- 🎬 摄像头实时画面预览 + AI 视觉理解
- 🎤 语音自动识别（Web Speech API）
- 🔊 AI 语音回复（Speech Synthesis）
- 💬 对话历史文字记录
- ⏸ 暂停/恢复摄像头
- 🔄 切换摄像头设备
- 📝 支持文字输入补充

## 成本控制

7 项策略全部实现，运营成本 **≈ $0/月**：

- 浏览器原生 STT/TTS（零费用）
- Gemini 1.5 Flash 免费层
- 智能帧率控制（2fps，场景变化检测）
- 图片压缩（320px × JPEG 60%）
- 空闲 15 秒自动暂停帧采集
- 对话超 20 条自动摘要压缩

## 项目结构

```
ai-vision-chat/
├── index.html          # 主页面
├── style.css           # 样式
├── app.js              # 主应用逻辑
├── modules/            # 前端模块
│   ├── utils.js        # 工具函数
│   ├── camera.js       # 摄像头管理
│   ├── speech.js       # 语音识别/合成
│   ├── api.js          # API 通信
│   └── chat.js         # 对话管理
└── server/             # 后端代理
    ├── index.js
    ├── package.json
    └── .env.example
```