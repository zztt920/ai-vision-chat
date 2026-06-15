# AI 视讯助手 🎥🤖

基于浏览器的 AI 视觉对话应用，通过摄像头与麦克风实现多模态交互——AI 能"看到"你摄像头画面中的内容，"听到"你的语音提问，并给予语音+文字回复。支持屏幕共享，可用于远程会议记录场景。
演示文档链接：通过网盘分享的文件：okkoChat - AI 视讯助手 和另外 3 个页面 - 个人 - Microsoft​ Edge 2026-06-15 16-47-39.mp4
链接: https://pan.baidu.com/s/13hp3NDPKbI63dDBDcygAHw 提取码: gpv2 
--来自百度网盘超级会员v4的分享
B站源：【okkoChat - AI 视讯助手】 https://www.bilibili.com/video/BV1XTJV6CESy/?share_source=copy_web&vd_source=6061eecb56419643b3d016a0fba580f4
## 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| 前端 | HTML5 + CSS3 + Vanilla JS | 单页应用，无需框架 |
| 摄像头 | WebRTC (getUserMedia) | 浏览器原生 API |
| 屏幕共享 | WebRTC (getDisplayMedia) | 远程会议画面共享 |
| 语音识别 | Web Speech API | 浏览器原生 STT，免费 |
| 语音合成 | Web Speech API | 浏览器原生 TTS，免费 |
| 视觉理解 | 阿里云百炼 DashScope qwen3-vl-plus | 国内直连，支持图像理解 |
| 后端代理 | Node.js (Express) | API 密钥保护 |

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

### 4. 开始对话

点击 **「开始对话」** 按钮，授权摄像头和麦克风权限，即可开始与 AI 进行视觉对话。

## 功能

- 🎬 摄像头实时画面预览 + AI 视觉理解
- 🖥 屏幕共享（远程会议记录场景：PPT/文档/表格）
- 🎤 语音自动识别
- 🔊 AI 语音回复
- 💬 对话历史文字记录
- ⏸ 暂停/恢复
- 🔄 摄像头/屏幕切换
- 📝 支持文字输入补充

## 项目结构

```
ai-vision-chat/
├── index.html          # 主页面
├── style.css           # 样式
├── app.js              # 主应用逻辑
├── modules/            # 前端模块
│   ├── utils.js        # 工具函数
│   ├── camera.js       # 摄像头管理
│   ├── screenshare.js  # 屏幕共享（远程会议记录）
│   ├── speech.js       # 语音识别/合成
│   ├── api.js          # API 通信
│   └── chat.js         # 对话管理
└── server/             # 后端代理
    ├── index.js
    ├── package.json
    └── .env.example
```
