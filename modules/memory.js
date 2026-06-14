/**
 * LumiChat 记忆模块
 * 持久化存储所有对话，支持自我迭代学习
 * 存储方式：localStorage
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'lumi_memory';
  const PROFILE_KEY = 'lumi_user_profile';
  const MAX_SESSIONS = 50;
  const MAX_EXCHANGES_PER_SESSION = 500;

  // ========== 数据结构 ==========
  // sessions: [{ id, createdAt, lastActive, exchanges: [{ role, content, timestamp }], summary }]
  // userProfile: { preferences, topics, tone, frequentPhrases, learningPoints }

  let sessions = [];
  let userProfile = null;
  let currentSessionId = null;

  // ========== 初始化 ==========
  function init() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        sessions = JSON.parse(raw);
      }
    } catch (e) {
      console.warn('[Memory] 数据读取失败，重置', e);
      sessions = [];
    }

    try {
      const rawProfile = localStorage.getItem(PROFILE_KEY);
      if (rawProfile) {
        userProfile = JSON.parse(rawProfile);
      }
    } catch (e) {
      userProfile = null;
    }

    if (!userProfile) {
      userProfile = {
        preferences: {},
        topics: [],
        tone: 'friendly',
        frequentPhrases: [],
        learningPoints: [],
        totalExchanges: 0,
        createdAt: Date.now()
      };
    }

    console.log('[Memory] 初始化完成，共', sessions.length, '个会话，', userProfile.totalExchanges, '次对话');
  }

  // ========== 持久化 ==========
  function save() {
    try {
      // 限制会话数量
      if (sessions.length > MAX_SESSIONS) {
        sessions = sessions.slice(-MAX_SESSIONS);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
      localStorage.setItem(PROFILE_KEY, JSON.stringify(userProfile));
    } catch (e) {
      console.warn('[Memory] 存储失败（可能空间不足）', e);
      // 空间不足时清理旧数据
      sessions = sessions.slice(-20);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
      } catch (e2) {
        console.error('[Memory] 存储完全失败');
      }
    }
  }

  // ========== 会话管理 ==========
  function startSession() {
    currentSessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    sessions.push({
      id: currentSessionId,
      createdAt: Date.now(),
      lastActive: Date.now(),
      exchanges: [],
      summary: ''
    });
    save();
    console.log('[Memory] 新会话:', currentSessionId);
    return currentSessionId;
  }

  function endSession() {
    if (!currentSessionId) return;
    const session = getCurrentSession();
    if (session && session.exchanges.length > 0) {
      generateSessionSummary(session);
      selfIterate(session);
    }
    save();
    console.log('[Memory] 会话结束:', currentSessionId);
    currentSessionId = null;
  }

  // ========== 对话存取 ==========
  function saveExchange(userMessage, aiResponse) {
    if (!currentSessionId) startSession();

    const session = getCurrentSession();
    if (!session) return;

    session.exchanges.push({
      role: 'user',
      content: userMessage,
      timestamp: Date.now()
    });
    session.exchanges.push({
      role: 'assistant',
      content: aiResponse,
      timestamp: Date.now()
    });
    session.lastActive = Date.now();

    // 限制会话长度
    if (session.exchanges.length > MAX_EXCHANGES_PER_SESSION) {
      session.exchanges = session.exchanges.slice(-MAX_EXCHANGES_PER_SESSION);
    }

    userProfile.totalExchanges++;
    save();
  }

  function getCurrentSession() {
    if (!currentSessionId) return null;
    return sessions.find(s => s.id === currentSessionId) || null;
  }

  function getRecentExchanges(count) {
    count = count || 20;
    const allExchanges = [];
    for (const session of sessions) {
      allExchanges.push(...session.exchanges);
    }
    return allExchanges.slice(-count);
  }

  // ========== 会话摘要生成 ==========
  function generateSessionSummary(session) {
    if (!session || session.exchanges.length === 0) return;

    const userMessages = session.exchanges
      .filter(e => e.role === 'user')
      .map(e => e.content);

    const topics = extractTopics(userMessages);
    const keyPhrases = extractKeyPhrases(userMessages);
    const tone = detectTone(session.exchanges);

    session.summary = JSON.stringify({
      topicCount: topics.length,
      mainTopics: topics.slice(0, 5),
      exchangeCount: session.exchanges.length / 2,
      keyPhrases: keyPhrases.slice(0, 5),
      tone: tone
    });
  }

  // ========== 自我迭代 ==========
  function selfIterate(session) {
    if (!session || session.exchanges.length < 4) return;

    const userMessages = session.exchanges
      .filter(e => e.role === 'user')
      .map(e => e.content);

    const aiMessages = session.exchanges
      .filter(e => e.role === 'assistant')
      .map(e => e.content);

    // 1. 学习话题偏好
    const topics = extractTopics(userMessages);
    for (const topic of topics) {
      const existing = userProfile.topics.find(t => t.name === topic);
      if (existing) {
        existing.count++;
        existing.lastSeen = Date.now();
      } else {
        userProfile.topics.push({ name: topic, count: 1, firstSeen: Date.now(), lastSeen: Date.now() });
      }
    }
    // 按热度排序，保留前 20
    userProfile.topics.sort((a, b) => b.count - a.count);
    userProfile.topics = userProfile.topics.slice(0, 20);

    // 2. 学习用户常用短语
    const phrases = extractKeyPhrases(userMessages);
    for (const phrase of phrases) {
      const existing = userProfile.frequentPhrases.find(p => p.phrase === phrase);
      if (existing) {
        existing.count++;
      } else {
        userProfile.frequentPhrases.push({ phrase, count: 1 });
      }
    }
    userProfile.frequentPhrases.sort((a, b) => b.count - a.count);
    userProfile.frequentPhrases = userProfile.frequentPhrases.slice(0, 30);

    // 3. 学习用户语气偏好
    const sessionTone = detectTone(session.exchanges);
    // 平滑更新语气偏好
    const toneWeights = { friendly: 1, professional: 1, casual: 1, enthusiastic: 1, concise: 1 };
    toneWeights[sessionTone] = (toneWeights[sessionTone] || 1) + 0.3;
    // 归一化
    const total = Object.values(toneWeights).reduce((s, v) => s + v, 0);
    for (const key in toneWeights) {
      toneWeights[key] = toneWeights[key] / total;
    }
    userProfile.preferredTone = toneWeights;

    // 4. 学习要点
    const learningPoints = extractLearningPoints(userMessages, aiMessages);
    for (const point of learningPoints) {
      if (!userProfile.learningPoints.includes(point)) {
        userProfile.learningPoints.push(point);
      }
    }
    userProfile.learningPoints = userProfile.learningPoints.slice(-50);

    userProfile.lastIterated = Date.now();
  }

  // ========== 分析工具函数 ==========
  function extractTopics(messages) {
    const topics = [];
    const topicPatterns = [
      /关于(.{1,15})/g,
      /想?了解(.{1,15})/g,
      /(.{1,10})怎么(?:样|办|弄)/g,
      /什么是(.{1,15})/g,
      /(.{1,10})是什么/g,
      /介绍(.{1,10})/g,
      /(.{1,10})的(?:问题|方法|技巧|知识)/g
    ];

    for (const msg of messages) {
      for (const pattern of topicPatterns) {
        let match;
        while ((match = pattern.exec(msg)) !== null) {
          const topic = match[1].trim();
          if (topic.length >= 2 && topic.length <= 15) {
            topics.push(topic);
          }
        }
      }
    }

    // 如果没有匹配到模式，用整个消息作为话题
    if (topics.length === 0 && messages.length > 0) {
      const short = messages.map(m => m.length > 20 ? m.slice(0, 20) + '...' : m);
      topics.push(...short.slice(0, 3));
    }

    return deduplicate(topics);
  }

  function extractKeyPhrases(messages) {
    const phrases = [];
    for (const msg of messages) {
      // 提取 2-6 字的有意义短语
      const words = msg.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').match(/.{2,6}/g);
      if (words) {
        phrases.push(...words);
      }
    }
    return deduplicate(phrases).slice(0, 20);
  }

  function detectTone(exchanges) {
    const userContent = exchanges
      .filter(e => e.role === 'user')
      .map(e => e.content)
      .join(' ');

    const enthusiastic = (userContent.match(/[!！]/g) || []).length;
    const casual = (userContent.match(/[哈哈嘿嘿嘻嘻]/g) || []).length;
    const professional = (userContent.match(/[请问如何怎样分析数据研究]/g) || []).length;
    const concise = userContent.length / exchanges.filter(e => e.role === 'user').length;

    if (enthusiastic > 3) return 'enthusiastic';
    if (casual > 2) return 'casual';
    if (professional > 3) return 'professional';
    if (concise < 15) return 'concise';
    return 'friendly';
  }

  function extractLearningPoints(userMessages, aiMessages) {
    const points = [];

    // 检测用户是否纠正了 AI
    for (let i = 0; i < userMessages.length; i++) {
      const msg = userMessages[i];
      if (/不是|不对|错了|纠正|应该是/.test(msg)) {
        points.push('用户纠正: ' + msg.slice(0, 50));
      }
    }

    // 检测用户偏好
    for (const msg of userMessages) {
      if (/更喜欢|偏好|希望|能.*一点/.test(msg)) {
        points.push('用户偏好: ' + msg.slice(0, 50));
      }
    }

    return points;
  }

  function deduplicate(arr) {
    return [...new Set(arr)];
  }

  // ========== 上下文构建（注入系统提示词） ==========
  function buildContextSummary() {
    const parts = [];

    // 用户偏好话题
    const topTopics = userProfile.topics.slice(0, 5);
    if (topTopics.length > 0) {
      parts.push('用户常聊话题: ' + topTopics.map(t => t.name).join('、'));
    }

    // 用户语气偏好
    if (userProfile.preferredTone) {
      const tone = Object.entries(userProfile.preferredTone)
        .sort((a, b) => b[1] - a[1])[0][0];
      const toneMap = {
        friendly: '友好亲切',
        professional: '专业严谨',
        casual: '轻松随意',
        enthusiastic: '热情活泼',
        concise: '简洁明了'
      };
      parts.push('用户偏好语气: ' + (toneMap[tone] || tone));
    }

    // 近期对话摘要
    const recentSession = sessions[sessions.length - 1];
    if (recentSession && recentSession.summary) {
      try {
        const summary = JSON.parse(recentSession.summary);
        if (summary.mainTopics && summary.mainTopics.length > 0) {
          parts.push('最近讨论: ' + summary.mainTopics.join('、'));
        }
      } catch (e) {}
    }

    // 用户纠正记录
    if (userProfile.learningPoints.length > 0) {
      const recent = userProfile.learningPoints.slice(-5);
      parts.push('用户曾指出: ' + recent.join('; '));
    }

    return parts.length > 0 ? '【用户记忆】\n' + parts.map(p => '- ' + p).join('\n') : '';
  }

  // ========== 获取历史记录（API 格式） ==========
  function getMemoryHistory(count) {
    count = count || 10;
    const exchanges = getRecentExchanges(count * 2); // 每轮对话有 user + assistant
    return exchanges.map(e => ({
      role: e.role,
      content: e.content
    }));
  }

  // ========== 获取所有会话 ==========
  function getAllSessions() {
    return sessions.map(s => ({
      id: s.id,
      createdAt: s.createdAt,
      lastActive: s.lastActive,
      exchangeCount: s.exchanges.length / 2,
      summary: s.summary
    }));
  }

  // ========== 清除 ==========
  function clearAll() {
    sessions = [];
    userProfile = {
      preferences: {},
      topics: [],
      tone: 'friendly',
      frequentPhrases: [],
      learningPoints: [],
      totalExchanges: 0,
      createdAt: Date.now()
    };
    currentSessionId = null;
    save();
    console.log('[Memory] 已清除所有记忆');
  }

  // ========== 导出 ==========
  init();

  window.MemoryModule = {
    startSession,
    endSession,
    saveExchange,
    getCurrentSession,
    getRecentExchanges,
    getMemoryHistory,
    getAllSessions,
    buildContextSummary,
    clearAll,
    getProfile: () => userProfile,
    getCurrentSessionId: () => currentSessionId
  };

})();