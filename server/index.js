const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:8000', 'http://127.0.0.1:5500', 'http://localhost:63342']
}));
app.use(express.json({ limit: '10mb' }));
app.disable('x-powered-by');

// 系统指令
const SYSTEM_INSTRUCTION = '你是一个AI会议助手，专为远程会议场景设计。你能够看到用户共享的屏幕画面（PPT/文档/会议内容），并听到用户的语音提问。\n\n你的核心职责：\n1. 当用户共享屏幕时，仔细观察屏幕上的会议内容（PPT幻灯片、文档、表格、图表等）\n2. 根据屏幕内容和用户语音提问，给出准确、有条理的回答\n3. 如果用户说"记录一下"或"记下来"，说明这是需要记录的重要会议要点\n4. 回答要结构清晰，重点突出，适合作为会议记录参考\n5. 保持专业、简洁的风格\n\n当用户说"生成会议纪要"时，你需要根据本次对话中记录的所有要点，生成一份完整的会议纪要。';

// SiliconFlow API 配置
const API_KEY = process.env.SILICONFLOW_API_KEY || process.env.API_KEY;
const BASE_URL = process.env.SILICONFLOW_BASE_URL || process.env.API_BASE_URL || 'https://api.siliconflow.cn/v1';
const MODEL = process.env.MODEL || 'Qwen/Qwen3-VL-8B-Instruct';

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

// POST /api/chat - 转发请求到 SiliconFlow API
app.post('/api/chat', async (req, res) => {
  const { text, image, history } = req.body;

  if (!text && !image) {
    return res.status(400).json({ error: '请提供文本或图片内容。' });
  }

  if (!API_KEY) {
    console.error('API 密钥未设置，请检查 .env 文件中的 SILICONFLOW_API_KEY');
    return res.status(500).json({ error: '服务器配置错误：API 密钥未设置。' });
  }

  // 构建 OpenAI 兼容的消息体
  const messages = [];

  // 系统指令
  messages.push({
    role: 'system',
    content: SYSTEM_INSTRUCTION
  });

  // 对话历史
  const historyMessages = convertHistory(history);
  messages.push(...historyMessages);

  // 当前用户消息（文本 + 图片）
  if (image) {
    // 含图片：使用数组格式（多模态）
    const userContent = [];
    if (text) userContent.push({ type: 'text', text });
    userContent.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } });
    messages.push({ role: 'user', content: userContent });
  } else {
    // 纯文本：使用字符串格式
    messages.push({ role: 'user', content: text });
  }

  console.log(`[Chat Request] 文本长度: ${text.length}, 图片: ${image ? '是' : '否'}, 历史消息: ${history ? history.length : 0}`);

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 1024,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`SiliconFlow API 错误 [${response.status}]:`, errorText);
      return res.status(response.status).json({
        error: `AI 服务请求失败 (${response.status})`,
        detail: process.env.NODE_ENV === 'development' ? errorText : undefined
      });
    }

    const data = await response.json();
    const replyText = data?.choices?.[0]?.message?.content || '';
    console.log(`[Chat Response] 回复长度: ${replyText.length}`);

    res.json({ reply: replyText });
  } catch (error) {
    console.error('请求 AI 服务时出错:', error.message);
    res.status(500).json({ error: '与 AI 服务通信时出错，请稍后重试。' });
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`AI 视讯代理服务器已启动，端口: ${PORT}`);
  console.log(`模型: ${MODEL}, API地址: ${BASE_URL}`);
});