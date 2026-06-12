const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 系统指令
const SYSTEM_INSTRUCTION = '你是一个AI视讯助手，通过摄像头看到用户的画面并听到用户的语音提问。请根据你看到的画面内容和用户的问题给出有帮助、自然友好的回答。回答要简洁直接。';

// 构建发送给 Gemini 的请求体
function buildGeminiRequestBody(text, image, history) {
  const contents = [];

  // 添加对话历史
  if (history && Array.isArray(history)) {
    for (const msg of history) {
      if (msg.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: msg.text || '' }]
        });
      } else if (msg.role === 'model') {
        contents.push({
          role: 'model',
          parts: [{ text: msg.text || '' }]
        });
      }
    }
  }

  // 构建当前用户消息
  const userParts = [];

  if (text) {
    userParts.push({ text });
  }

  if (image) {
    userParts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: image
      }
    });
  }

  contents.push({
    role: 'user',
    parts: userParts
  });

  return {
    system_instruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    contents
  };
}

// POST /api/chat - 转发请求到 Gemini API
app.post('/api/chat', async (req, res) => {
  const { text, image, history } = req.body;

  if (!text && !image) {
    return res.status(400).json({ error: '请提供文本或图片内容。' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY 未设置');
    return res.status(500).json({ error: '服务器配置错误：API 密钥未设置。' });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const requestBody = buildGeminiRequestBody(text, image, history);

  console.log(`[Chat Request] 文本长度: ${text ? text.length : 0}, 图片: ${image ? '是' : '否'}, 历史消息数: ${history ? history.length : 0}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Gemini API 错误 [${response.status}]:`, errorText);
      return res.status(response.status).json({ error: `Gemini API 请求失败: ${response.statusText}` });
    }

    const data = await response.json();

    // 提取回复文本
    const replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log(`[Chat Response] 回复长度: ${replyText.length}`);

    res.json({ reply: replyText });
  } catch (error) {
    console.error('请求 Gemini API 时出错:', error.message);
    res.status(500).json({ error: '与 AI 服务通信时出错，请稍后重试。' });
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`AI 视讯代理服务器已启动，端口: ${PORT}`);
});