/**
 * memory.js
 * localStorage 会话记忆模块 (IIFE 浏览器模块)
 *
 * 功能：
 * - 存储对话会话及其摘要
 * - 每个会话包含: id, timestamp, summary, messages[]
 * - 每次添加消息时自动保存到 localStorage
 * - 支持会话的增删查操作
 * - 最多 50 个会话，超出时自动删除最旧会话
 */

(function (global) {
  'use strict';

  var STORAGE_KEY = 'ai_vision_chat_sessions';
  var MAX_SESSIONS = 50;

  /**
   * 从 localStorage 加载所有会话
   * @returns {Array} 会话数组
   */
  function loadSessions() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      var sessions = JSON.parse(raw);
      if (!Array.isArray(sessions)) {
        console.warn('[Memory] localStorage 数据格式异常，重置为空数组');
        return [];
      }
      return sessions;
    } catch (err) {
      console.error('[Memory] 加载会话失败:', err);
      return [];
    }
  }

  /**
   * 保存所有会话到 localStorage
   * @param {Array} sessions - 会话数组
   */
  function saveSessions(sessions) {
    try {
      var json = JSON.stringify(sessions);
      localStorage.setItem(STORAGE_KEY, json);
      console.log('[Memory] 会话已保存, 总数:', sessions.length);
    } catch (err) {
      console.error('[Memory] 保存会话失败:', err);
      // 如果因为超出配额导致失败，尝试清理最旧会话
      if (err.name === 'QuotaExceededError' || err.code === 22) {
        console.warn('[Memory] localStorage 配额不足，尝试清理旧会话...');
        if (sessions.length > 1) {
          sessions.shift(); // 删除最旧的
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
            console.log('[Memory] 清理后保存成功, 剩余:', sessions.length);
          } catch (e2) {
            console.error('[Memory] 清理后仍然保存失败:', e2);
          }
        }
      }
    }
  }

  /**
   * 生成唯一会话 ID
   * @returns {string} UUID v4 格式 ID
   */
  function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * 强制限制会话数量
   * @param {Array} sessions - 会话数组
   * @returns {Array} 裁剪后的会话数组
   */
  function enforceLimit(sessions) {
    if (sessions.length > MAX_SESSIONS) {
      var removed = sessions.splice(0, sessions.length - MAX_SESSIONS);
      console.log('[Memory] 超出最大会话数, 已移除最旧的 ' + removed.length + ' 个会话');
    }
    return sessions;
  }

  /**
   * 添加消息到指定会话
   * 如果会话不存在则自动创建
   * @param {string} sessionId - 会话 ID
   * @param {Object} msg - 消息对象
   * @param {string} msg.role - 角色: 'user' | 'assistant' | 'system'
   * @param {string} msg.content - 消息内容
   * @returns {Object} 更新后的会话对象
   */
  function addMessage(sessionId, msg) {
    if (!sessionId || typeof sessionId !== 'string') {
      console.error('[Memory] addMessage: sessionId 不能为空');
      return null;
    }

    console.log('[Memory] 添加消息到会话:', sessionId, 'role:', msg.role);

    var sessions = loadSessions();

    // 查找或创建会话
    var session = null;
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].id === sessionId) {
        session = sessions[i];
        break;
      }
    }

    if (!session) {
      // 创建新会话
      session = {
        id: sessionId,
        timestamp: Date.now(),
        summary: '',
        messages: []
      };
      sessions.push(session);
      console.log('[Memory] 创建新会话:', sessionId);
    }

    // 添加消息
    var messageObj = {
      role: msg.role || 'user',
      content: msg.content || '',
      timestamp: msg.timestamp || Date.now()
    };
    session.messages.push(messageObj);

    // 更新会话时间戳
    session.timestamp = Date.now();

    // 强制数量限制
    sessions = enforceLimit(sessions);

    // 保存到 localStorage
    saveSessions(sessions);

    console.log('[Memory] 消息已添加, 当前会话消息数:', session.messages.length);
    return session;
  }

  /**
   * 获取指定会话
   * @param {string} sessionId - 会话 ID
   * @returns {Object|null} 会话对象，不存在时返回 null
   */
  function getSession(sessionId) {
    if (!sessionId) {
      console.warn('[Memory] getSession: sessionId 不能为空');
      return null;
    }

    var sessions = loadSessions();
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].id === sessionId) {
        console.log('[Memory] 获取会话:', sessionId, '消息数:', sessions[i].messages.length);
        return sessions[i];
      }
    }

    console.log('[Memory] 会话不存在:', sessionId);
    return null;
  }

  /**
   * 获取所有会话（按时间倒序）
   * @returns {Array} 会话数组
   */
  function getAllSessions() {
    var sessions = loadSessions();
    // 按时间戳降序排列
    sessions.sort(function (a, b) {
      return b.timestamp - a.timestamp;
    });
    console.log('[Memory] 获取所有会话, 总数:', sessions.length);
    return sessions;
  }

  /**
   * 清除指定会话
   * @param {string} sessionId - 会话 ID
   * @returns {boolean} 是否成功清除
   */
  function clearSession(sessionId) {
    if (!sessionId) {
      console.warn('[Memory] clearSession: sessionId 不能为空');
      return false;
    }

    var sessions = loadSessions();
    var initialLength = sessions.length;

    sessions = sessions.filter(function (s) {
      return s.id !== sessionId;
    });

    if (sessions.length < initialLength) {
      saveSessions(sessions);
      console.log('[Memory] 已清除会话:', sessionId);
      return true;
    }

    console.log('[Memory] 未找到要清除的会话:', sessionId);
    return false;
  }

  /**
   * 更新会话摘要
   * @param {string} sessionId - 会话 ID
   * @param {string} summary - 新的摘要内容
   * @returns {Object|null} 更新后的会话对象
   */
  function updateSummary(sessionId, summary) {
    if (!sessionId) {
      console.warn('[Memory] updateSummary: sessionId 不能为空');
      return null;
    }

    var sessions = loadSessions();
    var session = null;
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].id === sessionId) {
        session = sessions[i];
        break;
      }
    }

    if (!session) {
      console.warn('[Memory] updateSummary: 会话不存在:', sessionId);
      return null;
    }

    session.summary = summary || '';
    session.timestamp = Date.now();
    saveSessions(sessions);

    console.log('[Memory] 已更新会话摘要:', sessionId);
    return session;
  }

  /**
   * 清除所有会话
   */
  function clearAllSessions() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      console.log('[Memory] 所有会话已清除');
      return true;
    } catch (err) {
      console.error('[Memory] 清除所有会话失败:', err);
      return false;
    }
  }

  // ==================== 导出模块 API ====================

  var Memory = {
    MAX_SESSIONS: MAX_SESSIONS,

    addMessage: addMessage,
    getSession: getSession,
    getAllSessions: getAllSessions,
    clearSession: clearSession,
    clearAllSessions: clearAllSessions,
    updateSummary: updateSummary,

    /**
     * 创建新会话
     * @param {string} [summary] - 初始摘要
     * @returns {Object} 新会话对象
     */
    createSession: function (summary) {
      var sessionId = generateId();
      var session = {
        id: sessionId,
        timestamp: Date.now(),
        summary: summary || '',
        messages: []
      };

      var sessions = loadSessions();
      sessions.push(session);
      sessions = enforceLimit(sessions);
      saveSessions(sessions);

      console.log('[Memory] 新会话已创建:', sessionId);
      return session;
    }
  };

  // 挂载到全局
  global.Memory = Memory;

  // 支持 CommonJS 环境
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Memory;
  }

  console.log('[Memory] 模块已加载, MAX_SESSIONS:', MAX_SESSIONS);

})(typeof window !== 'undefined' ? window : global);