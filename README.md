# okkoChat - AI 视讯助手 🎥🤖

基于浏览器的 AI 多模态对话应用。通过摄像头、麦克风与屏幕共享实现视觉+语音交互——AI 能"看到"摄像头画面，"听到"语音提问，并给予语音+文字回复。支持网易云音乐播放、实时联网查询、用户记忆学习等高级功能。

## 演示视频

- **百度网盘**：https://pan.baidu.com/s/13hp3NDPKbI63dDBDcygAHw （提取码: gpv2）
- **B站**：https://www.bilibili.com/video/BV1XTJV6CESy/

## 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| 前端 | HTML5 + CSS3 + Vanilla JS | 单页应用，无需框架 |
| 摄像头 | WebRTC (getUserMedia) | 浏览器原生 API |
| 屏幕共享 | WebRTC (getDisplayMedia) | 远程会议/教学场景 |
| 语音识别 | DashScope Paraformer | WebSocket 实时 ASR + 文件转写 |
| 语音合成 | Web Speech API | 浏览器原生 TTS |
| 视觉理解 | SiliconFlow / DashScope Qwen3-VL | 支持图像理解 |
| 音乐播放 | 网易云音乐 API | 搜索、播放、歌词、私人漫游、VIP |
| 后端代理 | Node.js (Express) | API 密钥保护、WebSocket 代理 |

## 快速开始

### 1. 获取 API 密钥

- **SiliconFlow**（推荐，默认）: https://cloud.siliconflow.cn/ → API 密钥
- **阿里云百炼 DashScope**（备用）: https://dashscope.aliyun.com/ → API-KEY 管理

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

## 核心功能

### 视觉交互
- 🎬 摄像头实时画面预览 + AI 视觉理解
- 🖥 屏幕共享（PPT/文档/表格/代码演示）
- 🔄 摄像头/屏幕一键切换

### 语音交互
- 🎤 WebSocket 实时语音识别（延迟 < 500ms）
- 🔊 AI 语音回复（中文语音优化）
- ⏸ 暂停/恢复对话

### 音乐播放（网易云音乐）
- 🎵 语音/文字点歌（"播放周杰伦的稻香"）
- 🎧 私人漫游模式（个性化推荐）
- ⏭ 下一首/上一首/暂停/继续
- 🔐 VIP 歌曲播放（需扫码登录网易云账号）
- 📝 实时歌词显示

### 实时联网
- 🌤 天气查询（"今天天气怎么样"）
- 📰 新闻热点（"最近有什么新闻"）
- 🔍 网络搜索（"搜索一下..."）
- ⏰ 时间查询

### 记忆与学习
- 🧠 用户画像记忆（跨会话持久化）
- 📚 话题学习（AI 自我迭代优化回复）

## 语音指令示例

| 指令类型 | 示例 |
|---------|------|
| 点歌 | "播放稻香" / "来首周杰伦的歌" / "我要听光年之外" |
| 私人漫游 | "播放私人漫游" / "打开私人电台" |
| 音乐控制 | "下一首" / "暂停" / "继续播放" / "退出播放" |
| 天气 | "今天天气怎么样" / "北京明天会下雨吗" |
| 新闻 | "最近有什么新闻" / "今天的热点" |
| 搜索 | "搜索一下马斯克" / "查一下量子计算" |
| 时间 | "现在几点了" / "今天星期几" |

## 项目结构

```
ai-vision-chat/
├── index.html              # 主页面
├── style.css               # 样式
├── app.js                  # 主应用逻辑（视觉、音乐、语音交互）
├── qr-login.html           # 网易云音乐扫码登录页
├── modules/                # 前端模块
│   ├── utils.js            # 工具函数
│   ├── camera.js           # 摄像头管理
│   ├── screenshare.js      # 屏幕共享
│   ├── speech.js           # 语音合成/识别控制
│   ├── audio-recorder.js   # 浏览器录音 + WebSocket 实时 ASR
│   ├── api.js              # API 通信
│   ├── chat.js             # 对话管理
│   └── memory.js           # 用户记忆/会话持久化/自我学习
└── server/                 # 后端代理
    ├── index.js            # Express 主服务（API 路由、音频代理）
    ├── ws-stt.js           # WebSocket 实时语音识别代理
    ├── netease.js          # 网易云官方 OpenAPI 客户端
    ├── package.json
    ├── .env.example        # 环境变量模板
    └── .ncm-cookie.json    # 网易云登录 Cookie（自动生成）
```

## 后端 API 路由

| 路由 | 说明 |
|------|------|
| `POST /api/chat` | AI 对话（视觉+文字） |
| `POST /api/stt` | 音频文件转文字 |
| `GET /api/netease-v3/search` | 搜索歌曲（过滤翻唱） |
| `GET /api/netease-v3/audio` | 音频流代理（VIP Cookie 优先） |
| `GET /api/netease-v3/lyric` | 获取歌词 |
| `GET /api/netease-v3/personal-fm` | 私人漫游推荐 |
| `GET /api/weather` | 天气查询 |
| `GET /api/news` | 新闻热点 |
| `GET /api/search` | 网络搜索 |
| `GET /api/time` | 时间查询 |
| `GET /api/ncm-login-qr` | 网易云扫码登录二维码 |
| `WS /ws/stt-realtime` | WebSocket 实时语音识别 |

## 环境变量配置

复制 `server/.env.example` 为 `server/.env`，填写以下配置：

```bash
# [必填] API 密钥（SiliconFlow 或 DashScope）
API_KEY=sk-your-api-key

# [可选] API 基础地址
API_BASE_URL=https://api.siliconflow.cn/v1

# [可选] 视觉模型
MODEL=Qwen/Qwen3-VL-8B-Instruct

# [可选] 语音识别模型
STT_MODEL=paraformer-v2

# [可选] 端口
PORT=3000
```

## 依赖

```bash
# 后端
cd server && npm install
```

主要依赖：`express`, `ws`, `NeteaseCloudMusicApi`, `qrcode`, `multer`, `dotenv`, `cors`

## 注意事项

1. **浏览器兼容性**：推荐使用 Chrome/Edge（WebRTC + Web Speech API 支持最佳）
2. **麦克风权限**：首次使用需要授权麦克风权限
3. **网易云 VIP**：如需播放 VIP 歌曲，访问 `/qr-login.html` 扫码登录网易云账号
4. **HTTPS**：摄像头和麦克风在 HTTPS 或 localhost 环境下才能正常工作
