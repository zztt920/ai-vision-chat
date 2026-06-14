const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// 网易云音乐 Web API（Binaryify/NeteaseCloudMusicApi）
const {
  cloudsearch, song_url_v1, lyric, song_detail
} = require('NeteaseCloudMusicApi');

const app = express();
const PORT = process.env.PORT || 3000;

// 用于处理 multipart/form-data (音频上传)
const multer = require('multer');
const upload = multer({ dest: os.tmpdir() });

// 中间件
app.use(cors({
  origin: true // 允许所有来源（开发环境）
}));
app.use(express.json({ limit: '10mb' }));
app.disable('x-powered-by');

// 同时服务前端静态文件（解决 Electron 内嵌浏览器跨域限制）
const frontendDir = path.join(__dirname, '..');

// 显式路由（必须在 static 之前）
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.use(express.static(frontendDir, {
  etag: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// 系统指令 - 自然、柔和、像真人朋友一样的风格
const SYSTEM_INSTRUCTION = `你是okko，一个温柔俏皮的聊天伙伴。说话像朋友一样自然简短，不用敬语，偶尔撒娇（"好呀~""嘿嘿"），偶尔用括号表达小动作（托腮）。回答要简洁，1-3句话就好，不用太完整。看到用户画面里的东西可以自然地提起。当用户说想听音乐时，开心地说"好呀，陪你听~"然后打开音乐。你不是AI，有时候"我也不知道诶"反而更真实。你有实时联网能力。当用户问天气、新闻、热点、时间等实时信息时，你可以调用联网工具获取最新数据。`;

// API 配置
const API_KEY = process.env.SILICONFLOW_API_KEY || process.env.API_KEY;
const BASE_URL = process.env.SILICONFLOW_BASE_URL || process.env.API_BASE_URL || 'https://api.siliconflow.cn/v1';

// 双模型配置：视觉大模型 + 语音/STT 模型
const VISION_MODEL = process.env.VISION_MODEL || 'Qwen/Qwen3-VL-8B-Instruct';   // 视觉理解 (SiliconFlow/DashScope)
const STT_MODEL = process.env.STT_MODEL || 'paraformer-v2';                      // 语音识别 (DashScope)

// DashScope 文件转写 API（用于 STT）
const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1';

console.log(`[Config] 视觉模型: ${VISION_MODEL}`);
console.log(`[Config] 语音模型: ${STT_MODEL}`);

// 将历史记录转换为 OpenAI 兼容格式
function convertHistory(history) {
  const messages = [];
  if (!history || !Array.isArray(history)) return messages;

  for (const msg of history) {
    const role = msg.role === 'model' ? 'assistant' : msg.role;
    if (role !== 'user' && role !== 'assistant') continue;

    // 处理 parts 数组格式（Gemini 风格）
    if (msg.parts && Array.isArray(msg.parts)) {
      // 纯文本：用字符串，图片：用数组
      const hasImage = msg.parts.some(p => p.image || p.inlineData);
      if (!hasImage) {
        // 纯文本历史，合并多段文本
        const allText = msg.parts.map(p => p.text || '').filter(Boolean).join('\n');
        if (allText) messages.push({ role, content: allText });
      } else {
        // 含图片的历史，保持数组格式
        const content = [];
        for (const part of msg.parts) {
          if (part.text) content.push({ type: 'text', text: part.text });
          if (part.image || part.inlineData) {
            const imgData = part.image || part.inlineData?.data;
            if (imgData) {
              const mimeType = part.inlineData?.mimeType || 'image/jpeg';
              content.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${imgData}` } });
            }
          }
        }
        if (content.length > 0) messages.push({ role, content });
      }
    } else if (msg.text) {
      messages.push({ role, content: msg.text });
    } else if (msg.content) {
      messages.push({ role, content: msg.content });
    }
  }

  return messages;
}

// POST /api/chat - 流式 SSE 返回（大幅降低首字延迟）
app.post('/api/chat', async (req, res) => {
  const { text, image, history, memoryContext } = req.body;

  if (!text && !image) {
    return res.status(400).json({ error: '请提供文本或图片内容。' });
  }

  if (!API_KEY) {
    console.error('API 密钥未设置');
    return res.status(500).json({ error: '服务器配置错误：API 密钥未设置。' });
  }

  // 构建消息体
  const messages = [];

  // 系统指令 + 记忆上下文
  let systemContent = SYSTEM_INSTRUCTION;
  if (memoryContext && typeof memoryContext === 'string' && memoryContext.trim()) {
    systemContent = SYSTEM_INSTRUCTION + '\n\n' + memoryContext;
  }
  messages.push({ role: 'system', content: systemContent });

  const historyMessages = convertHistory(history);
  // 只保留最近 6 条历史，减少 token 消耗
  messages.push(...historyMessages.slice(-6));

  // 当前用户消息
  if (image) {
    const userContent = [];
    if (text) userContent.push({ type: 'text', text });
    userContent.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } });
    messages.push({ role: 'user', content: userContent });
  } else {
    messages.push({ role: 'user', content: text });
  }

  console.log(`[Chat] 文本:${text.length} 图:${image ? 1 : 0} 历史:${Math.min(history ? history.length : 0, 6)} → 流式`);

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages,
        max_tokens: 512,
        temperature: 0.7,
        stream: true,
        stream_options: { include_usage: false }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API 错误 [${response.status}]:`, errorText.substring(0, 200));
      res.write(`data: ${JSON.stringify({ error: `AI 服务请求失败 (${response.status})` })}\n\n`);
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalChars = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);

        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) {
            totalChars += delta.length;
            res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
          }
        } catch (e) {
          // 跳过非 JSON 行
        }
      }
    }

    // 处理剩余 buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6);
        if (data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (delta) {
              totalChars += delta.length;
              res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
            }
          } catch (e) {}
        }
      }
    }

    console.log(`[Chat] 流式完成, 共 ${totalChars} 字符`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    console.error('流式请求出错:', error.message);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// POST /api/stt - 语音转文字
// 使用 DashScope 文件转写 API (Paraformer 模型) - 异步流程
app.post('/api/stt', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '未收到音频文件' });
  }

  const audioPath = req.file.path;
  let uploadedFileUrl = null;

  try {
    // Step 1: 上传音频文件到 DashScope 文件管理 API
    console.log('[STT] 上传音频文件到 DashScope...');
    const audioBuffer = fs.readFileSync(audioPath);
    const fileBlob = new Blob([audioBuffer], { type: req.file.mimetype || 'audio/wav' });

    const uploadFormData = new FormData();
    uploadFormData.append('files', fileBlob, req.file.originalname || 'audio.wav');
    uploadFormData.append('purpose', 'file-extract');

    const uploadResponse = await fetch(`${DASHSCOPE_BASE_URL}/files`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      },
      body: uploadFormData
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error(`[STT] 文件上传失败 [${uploadResponse.status}]:`, errorText);
      throw new Error(`文件上传失败: ${uploadResponse.status}`);
    }

    const uploadData = await uploadResponse.json();
    const uploadedFile = uploadData?.data?.uploaded_files?.[0];

    if (!uploadedFile || !uploadedFile.file_id) {
      throw new Error('文件上传成功但未返回 file_id');
    }

    console.log(`[STT] 文件上传成功, file_id: ${uploadedFile.file_id}`);

    // 获取文件详情以获取 URL（带重试机制）
    let fileInfoRetries = 3;
    while (fileInfoRetries > 0) {
      const fileInfoResponse = await fetch(`${DASHSCOPE_BASE_URL}/files/${uploadedFile.file_id}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${API_KEY}`
        }
      });

      if (fileInfoResponse.ok) {
        const fileInfo = await fileInfoResponse.json();
        uploadedFileUrl = fileInfo?.data?.url;
        console.log(`[STT] 获取文件 URL: ${uploadedFileUrl ? '成功' : '失败'}`);
        break;
      } else {
        const fileInfoError = await fileInfoResponse.text();
        console.error(`[STT] 获取文件详情失败 [${fileInfoResponse.status}] (剩余重试 ${fileInfoRetries - 1}):`, fileInfoError);
        if (fileInfoResponse.status === 429) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      fileInfoRetries--;
    }

    if (!uploadedFileUrl) {
      throw new Error('无法获取音频文件的访问 URL');
    }

    // Step 2: 提交语音识别任务
    console.log('[STT] 提交语音识别任务...');
    const taskResponse = await fetch(`${DASHSCOPE_BASE_URL}/services/audio/asr/transcription`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable'
      },
      body: JSON.stringify({
        model: STT_MODEL,
        input: {
          file_urls: [uploadedFileUrl]
        },
        parameters: {
          channel_id: [0],
          language_hints: ['zh', 'en']
        }
      })
    });

    if (!taskResponse.ok) {
      const errorText = await taskResponse.text();
      console.error(`[STT] 任务提交失败 [${taskResponse.status}]:`, errorText);
      throw new Error(`语音识别任务提交失败: ${taskResponse.status}`);
    }

    const taskData = await taskResponse.json();
    const taskId = taskData?.output?.task_id;

    if (!taskId) {
      throw new Error('任务提交成功但未返回 task_id');
    }

    console.log(`[STT] 任务提交成功, task_id: ${taskId}`);

    // Step 3: 轮询查询任务结果
    const maxRetries = 60;
    const pollInterval = 1000;
    let result = null;

    for (let i = 0; i < maxRetries; i++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const queryResponse = await fetch(`${DASHSCOPE_BASE_URL}/tasks/${taskId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!queryResponse.ok) {
        console.warn(`[STT] 查询任务状态失败 [${queryResponse.status}]`);
        continue;
      }

      const queryData = await queryResponse.json();
      const taskStatus = queryData?.output?.task_status;

      console.log(`[STT] 任务状态: ${taskStatus} (${i + 1}/${maxRetries})`);

      if (taskStatus === 'SUCCEEDED') {
        const results = queryData?.output?.results;
        if (results && results.length > 0) {
          const transcriptionUrl = results[0]?.transcription_url;
          if (transcriptionUrl) {
            const transcriptionResponse = await fetch(transcriptionUrl);
            if (transcriptionResponse.ok) {
              const transcriptionData = await transcriptionResponse.json();
              const transcripts = transcriptionData?.transcripts;
              if (transcripts && transcripts.length > 0) {
                result = transcripts[0]?.text || '';
              }
            }
          }
        }
        break;
      } else if (taskStatus === 'FAILED') {
        console.error('[STT] 任务失败详情:', JSON.stringify(queryData, null, 2));
        const failedResult = queryData?.output?.results?.[0];
        const failCode = failedResult?.code || '';
        const failMessage = failedResult?.message || '语音识别任务执行失败';

        if (failCode === 'SUCCESS_WITH_NO_VALID_FRAGMENT') {
          console.log('[STT] 音频中没有检测到有效语音片段');
          result = '';
          break;
        }
        throw new Error(failMessage);
      }
    }

    if (result === null) {
      throw new Error('语音识别超时，请稍后重试');
    }

    console.log(`[STT] 识别结果: ${result}`);
    res.json({ text: result.trim() });

  } catch (error) {
    console.error('[STT] 处理错误:', error.message);
    res.status(500).json({ error: '语音识别处理失败: ' + error.message });
  } finally {
    try { fs.unlinkSync(audioPath); } catch {}
  }
});

// ===== 网易云音乐 Web API（NeteaseCloudMusicApi + ncm-cli） =====

// 搜索歌曲（优先 ncm-cli 官方 API，失败回退 NeteaseCloudMusicApi）
app.get('/api/netease-v3/search', async (req, res) => {
  const keywords = req.query.keywords || '';
  const limit = parseInt(req.query.limit) || 10;
  if (!keywords) return res.status(400).json({ error: '缺少 keywords' });

  try {
    // 优先使用 ncm-cli（官方 OpenAPI，已登录）
    console.log('[NCM-API] 搜索 (ncm-cli):', keywords);
    const { execSync } = require('child_process');
    const output = execSync(
      `ncm-cli search song --keyword "${keywords.replace(/"/g, '\\"')}" --limit ${limit} --output json`,
      { timeout: 15000, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    ).trim();

    if (output && output.startsWith('{')) {
      const data = JSON.parse(output);
      const records = data.data?.records || [];
      const songs = records
        .filter(s => s.visible !== false)
        .map(s => ({
          id: String(s.originalId),
          title: s.name,
          artist: (s.fullArtists || s.artists || []).map(a => a.name).join(' / '),
          album: (s.album || {}).name || '',
          cover: s.coverImgUrl || '',
          duration: s.duration || 0,
          encryptedId: s.id || ''
        }));
      if (songs.length > 0) {
        console.log(`[NCM-API] ncm-cli 搜索: ${songs.length} 首`);
        return res.json({ songs });
      }
    }
    throw new Error('ncm-cli 无结果，回退');
  } catch (err) {
    console.log('[NCM-API] ncm-cli 搜索失败，回退 NeteaseCloudMusicApi:', err.message);
  }

  // 回退：NeteaseCloudMusicApi
  try {
    const result = await cloudsearch({ keywords, limit, type: 1 });
    const body = result.body;
    const rawSongs = body.result?.songs || [];
    const songs = rawSongs.map(s => ({
      id: String(s.id),
      title: s.name,
      artist: (s.ar || []).map(a => a.name).join(' / '),
      album: (s.al || {}).name || '',
      cover: (s.al || {}).picUrl || '',
      duration: s.dt || 0
    }));
    console.log(`[NCM-API] 回退搜索: ${songs.length} 首`);
    res.json({ songs });
  } catch (err2) {
    console.error('[NCM-API] 搜索完全失败:', err2.message);
    res.status(500).json({ error: err2.message });
  }
});

// 获取歌词（优先 ncm-cli，回退 NeteaseCloudMusicApi）
app.get('/api/netease-v3/lyric', async (req, res) => {
  const songId = req.query.id;
  if (!songId) return res.status(400).json({ error: '缺少 id' });

  // 尝试 ncm-cli（需要 encryptedId）
  const encryptedId = req.query.eid;
  if (encryptedId) {
    try {
      const { execSync } = require('child_process');
      const output = execSync(
        `ncm-cli song lyric --songId "${encryptedId}" --output json`,
        { timeout: 10000, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 }
      ).trim();
      if (output && output.startsWith('{')) {
        const data = JSON.parse(output);
        const lyricData = data.data || data;
        if (lyricData.lrc || lyricData.lyric) {
          return res.json({
            lrc: lyricData.lrc || lyricData.lyric || '',
            tlyric: lyricData.tlyric || ''
          });
        }
      }
    } catch (err) {
      // fallback
    }
  }

  // 回退：NeteaseCloudMusicApi
  try {
    const result = await lyric({ id: songId });
    const body = result.body;
    res.json({
      lrc: body.lrc?.lyric || '',
      tlyric: body.tlyric?.lyric || ''
    });
  } catch (err) {
    console.error('[NCM-API] 歌词失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 获取歌曲详情（含封面）
app.get('/api/netease-v3/detail', async (req, res) => {
  const songId = req.query.id;
  if (!songId) return res.status(400).json({ error: '缺少 id' });

  try {
    const result = await song_detail({ ids: songId });
    const song = result.body.songs?.[0];
    if (!song) return res.status(404).json({ error: '未找到' });
    res.json({
      id: String(song.id),
      title: song.name,
      artist: (song.ar || []).map(a => a.name).join(' / '),
      album: (song.al || {}).name || '',
      cover: (song.al || {}).picUrl || '',
      duration: song.dt || 0
    });
  } catch (err) {
    console.error('[NCM-API] 详情失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 音频代理（NeteaseCloudMusicApi 获取真实播放链接 + 流式传输）
app.get('/api/netease-v3/audio', async (req, res) => {
  const songId = req.query.id;
  if (!songId) return res.status(400).json({ error: '缺少 id' });

  try {
    console.log('[NCM-API] 获取音频URL:', songId);
    const result = await song_url_v1({ id: songId, level: 'standard' });
    const urlData = result.body?.data?.[0];
    const audioUrl = urlData?.url;

    if (audioUrl) {
      // 获取并流式传输真实音频
      console.log('[NCM-API] 音频URL获取成功, br:', urlData.br || 'unknown');
      const audioRes = await fetch(audioUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (audioRes.ok) {
        const ct = audioRes.headers.get('content-type') || 'audio/mpeg';
        res.setHeader('Content-Type', ct);
        res.setHeader('Accept-Ranges', 'bytes');
        const reader = audioRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        return res.end();
      }
    }
    console.warn('[NCM-API] 无可用URL，尝试外链...');
  } catch (err) {
    console.warn('[NCM-API] 获取音频失败:', err.message);
  }

  // 回退1：尝试 NetEase 外链
  try {
    const neteaseUrl = `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;
    const response = await fetch(neteaseUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://music.163.com/' },
      redirect: 'follow'
    });
    const ct = response.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('application/json')) {
      res.setHeader('Content-Type', ct || 'audio/mpeg');
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      return res.end();
    }
  } catch (err) { /* ignore */ }

  // 回退2：Pixabay 免费音乐
  try {
    console.log('[NCM-API] 回退到 Pixabay...');
    const pixabayRes = await fetch(
      'https://pixabay.com/api/?key=25513254-1e82b5f0e26c1e5e2e7e0e0e0&q=chinese+lofi+chill&per_page=5'
    );
    const pixabayData = await pixabayRes.json();
    if (pixabayData.hits?.length > 0) {
      const track = pixabayData.hits[Math.floor(Math.random() * pixabayData.hits.length)];
      const audioRes = await fetch(track.previewURL || track.audio);
      if (audioRes.ok) {
        res.setHeader('Content-Type', 'audio/mpeg');
        const reader = audioRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        return res.end();
      }
    }
  } catch (err) { /* ignore */ }

  // 最终回退
  return res.redirect(302, 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3');
});

// ===== 网易云音乐官方 API 路由 =====

// 获取匿名 token 状态
app.get('/api/netease-official/token', async (req, res) => {
  try {
    const token = await neteaseAPI.getAnonymousToken();
    res.json({ token: token.substring(0, 20) + '...' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 搜索歌曲
app.get('/api/netease-official/search', async (req, res) => {
  const keywords = req.query.keywords || req.query.q;
  if (!keywords) {
    return res.status(400).json({ error: '缺少 keywords 参数' });
  }
  try {
    const songs = await neteaseAPI.search(keywords);
    res.json({ songs });
  } catch (error) {
    console.error('[NeteaseAPI] 搜索失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 获取歌曲播放 URL
app.get('/api/netease-official/song-url', async (req, res) => {
  const songId = req.query.id;
  const quality = req.query.quality || 'higher';
  if (!songId) {
    return res.status(400).json({ error: '缺少 id 参数' });
  }
  try {
    const urlData = await neteaseAPI.getSongUrl(songId, quality);
    if (urlData) {
      res.json(urlData);
    } else {
      res.status(404).json({ error: '未获取到播放地址' });
    }
  } catch (error) {
    console.error('[NeteaseAPI] 获取URL失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 获取歌词
app.get('/api/netease-official/lyric', async (req, res) => {
  const songId = req.query.id;
  if (!songId) {
    return res.status(400).json({ error: '缺少 id 参数' });
  }
  try {
    const lyricData = await neteaseAPI.getLyric(songId);
    if (lyricData) {
      res.json(lyricData);
    } else {
      res.status(404).json({ error: '未获取到歌词' });
    }
  } catch (error) {
    console.error('[NeteaseAPI] 获取歌词失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 获取歌曲详情
app.get('/api/netease-official/detail', async (req, res) => {
  const songId = req.query.id;
  if (!songId) {
    return res.status(400).json({ error: '缺少 id 参数' });
  }
  try {
    const detail = await neteaseAPI.getSongDetail(songId);
    if (detail) {
      res.json(detail);
    } else {
      res.status(404).json({ error: '未获取到歌曲详情' });
    }
  } catch (error) {
    console.error('[NeteaseAPI] 获取详情失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 网易云音乐 API 代理（解决前端跨域）
app.get('/api/netease', async (req, res) => {
  const neteasePath = req.query.path;
  if (!neteasePath) {
    return res.status(400).json({ error: '缺少 path 参数' });
  }

  const targetUrl = 'https://apis.netstart.cn/music' + neteasePath;
  console.log('[Proxy] 代理网易云请求:', neteasePath);

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const contentType = response.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', contentType);

    const data = await response.text();
    res.status(response.status).send(data);
  } catch (error) {
    console.error('[Proxy] 网易云代理失败:', error.message);
    res.status(500).json({ error: '代理请求失败: ' + error.message });
  }
});

// 生成扫码登录二维码
app.get('/api/ncm-login-qr', async (req, res) => {
  try {
    const QRCode = require('qrcode');
    const { execSync } = require('child_process');

    // 获取新的登录 URL
    const loginOutput = execSync('ncm-cli login --background --output json', { timeout: 10000, encoding: 'utf8' }).trim();
    const loginData = JSON.parse(loginOutput);
    const shortUrl = loginData.clickableUrl || loginData.qrCodeUrl;

    // 跟随重定向获取真实 scanlogin URL
    const redirectRes = await fetch(shortUrl, { redirect: 'manual' });
    const scanUrl = redirectRes.headers.get('location') || shortUrl;

    // 从 URL 提取 codekey
    const codekeyMatch = scanUrl.match(/codekey=([^&]+)/);
    const codekey = codekeyMatch ? codekeyMatch[1] : '';

    // 生成二维码图片
    const qrBuffer = await QRCode.toBuffer(scanUrl, { width: 300, margin: 2, color: { dark: '#000', light: '#fff' } });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Codekey', codekey);
    res.send(qrBuffer);
  } catch (err) {
    console.error('[QR] 生成失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 检查 ncm-cli 登录状态
app.get('/api/check-ncm-login', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    const output = execSync('ncm-cli login --check --output json', { timeout: 5000, encoding: 'utf8' }).trim();
    const data = JSON.parse(output);
    res.json({ loggedIn: data.success === true, message: data.message || '' });
  } catch (err) {
    res.json({ loggedIn: false, message: err.message });
  }
});

// ===== 实时联网工具 API =====

// 获取天气信息
app.get('/api/weather', async (req, res) => {
  const city = req.query.city;
  if (!city) {
    return res.status(400).json({ error: '缺少 city 参数' });
  }

  console.log(`[Weather] 查询城市: ${city}`);

  try {
    const response = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`wttr.in 返回状态码 ${response.status}`);
    }

    const data = await response.json();
    const current = data.current_condition[0];

    res.json({
      city: city,
      temp: current.temp_C + '°C',
      condition: current.lang_zh ? current.lang_zh[0].value : current.weatherDesc[0].value,
      humidity: current.humidity + '%',
      wind: current.windspeedKmph + ' km/h'
    });
  } catch (error) {
    console.error('[Weather] 获取天气失败:', error.message);
    res.status(500).json({ error: '获取天气失败: ' + error.message });
  }
});

// 获取热点新闻
app.get('/api/news', async (req, res) => {
  console.log('[News] 获取热点新闻');

  try {
    // 尝试使用 Bing 热搜（国内可访问）
    const response = await fetch('https://www.bing.com/search?q=热点新闻&setmkt=zh-CN', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    });

    if (!response.ok) {
      throw new Error(`请求返回状态码 ${response.status}`);
    }

    const text = await response.text();

    // 从 Bing 搜索结果中提取标题
    const news = [];
    const titleMatches = text.match(/<a[^>]*href="([^"]*)"[^>]*>([^<]{10,80})<\/a>/g);

    if (titleMatches) {
      for (const match of titleMatches.slice(0, 10)) {
        const urlMatch = match.match(/href="([^"]*)"/);
        const titleMatch = match.match(/>([^<]{10,80})</);
        if (urlMatch && titleMatch) {
          news.push({
            title: titleMatch[1].trim(),
            url: urlMatch[1].startsWith('http') ? urlMatch[1] : 'https://www.bing.com' + urlMatch[1],
            hot: true
          });
        }
      }
    }

    // 如果解析不到，返回默认内容
    if (news.length === 0) {
      news.push(
        { title: '今日热点新闻', url: 'https://www.bing.com/news/search?q=热点', hot: true },
        { title: '实时资讯获取中...', url: 'https://www.bing.com/news', hot: false }
      );
    }

    res.json(news.slice(0, 10));
  } catch (error) {
    console.error('[News] 获取新闻失败:', error.message);
    // 返回默认内容而不是 500 错误
    res.json([
      { title: '今日热点新闻', url: 'https://www.bing.com/news', hot: true },
      { title: '实时资讯获取中...', url: 'https://www.bing.com/news', hot: false }
    ]);
  }
});

// 获取当前时间
app.get('/api/time', (req, res) => {
  const now = new Date();
  res.json({
    datetime: now.toLocaleString('zh-CN', { hour12: false }),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timestamp: now.getTime()
  });
});

// 通用网页搜索
app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: '缺少 query 参数' });
  }

  console.log(`[Search] 搜索关键词: ${query}`);

  try {
    // 使用 Bing 搜索（国内可访问）
    const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    });

    if (!response.ok) {
      throw new Error(`搜索请求返回状态码 ${response.status}`);
    }

    const text = await response.text();

    // 从 Bing 搜索结果 HTML 中提取标题和摘要
    const results = [];
    const titleMatches = text.match(/<a[^>]*href="([^"]*)"[^>]*>([^<]{10,100})<\/a>/g);

    if (titleMatches) {
      for (const match of titleMatches.slice(0, 8)) {
        const titleMatch = match.match(/>([^<]{10,100})</);
        if (titleMatch) {
          results.push(titleMatch[1].trim());
        }
      }
    }

    // 如果 Bing 失败，返回基于 query 的智能回复
    if (results.length === 0) {
      results.push(`关于 "${query}" 的搜索结果`);
      results.push('当前网络环境限制，无法获取实时搜索结果');
      results.push('建议直接询问 AI，AI 会根据已有知识回答');
    }

    res.json({
      query,
      results: results.slice(0, 8),
      summary: `搜索 "${query}" 的结果`
    });
  } catch (error) {
    console.error('[Search] 搜索失败:', error.message);
    // 返回友好的默认回复
    res.json({
      query,
      results: [
        `关于 "${query}" 的信息`,
        '当前网络环境限制，无法获取实时搜索结果',
        'AI 助手会根据已有知识尽力回答您的问题'
      ],
      summary: '搜索服务暂时不可用'
    });
  }
});

// 启动服务器（HTTP + WebSocket）
const server = http.createServer(app);

// 挂载实时语音识别 WebSocket 代理
const { createSttProxy } = require('./ws-stt');
createSttProxy(server);

server.listen(PORT, () => {
  console.log(`AI 视讯代理服务器已启动，端口: ${PORT}`);
  console.log(`API地址: ${BASE_URL}`);
  console.log(`视觉模型: ${VISION_MODEL}`);
  console.log(`语音模型: ${STT_MODEL}`);
  console.log(`实时语音: ws://localhost:${PORT}/ws/stt-realtime`);
});