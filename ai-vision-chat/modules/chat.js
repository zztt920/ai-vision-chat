(function() {
  'use strict';

  var messages = [];
  var onMessageCallback = function() {};
  var MAX_HISTORY = 20;
  var SUMMARY_COUNT = 10;

  // 添加消息
  function addMessage(role, content, type) {
    type = type || 'text';

    var message = {
      id: Utils.generateId(),
      role: role,
      content: content,
      timestamp: Date.now(),
      type: type
    };

    messages.push(message);
    onMessageCallback(message);

    // 上下文压缩：当历史超过 20 条时压缩前 10 条
    if (messages.length > MAX_HISTORY) {
      compressHistory();
    }

    return message;
  }

  // 获取历史记录（API 格式）
  function getHistory() {
    return messages.map(function(msg) {
      return {
        role: msg.role,
        parts: [{ text: msg.content }]
      };
    });
  }

  // 清空对话
  function clear() {
    messages = [];
  }

  // 获取所有消息
  function getMessages() {
    return Utils.deepClone(messages);
  }

  // 设置消息回调
  function onMessage(callback) {
    onMessageCallback = callback;
  }

  // 上下文压缩：将前 10 条合并为一个摘要
  function compressHistory() {
    var toSummarize = messages.splice(0, SUMMARY_COUNT);

    var summaryText = toSummarize.map(function(msg) {
      return (msg.role === 'user' ? '用户' : '助手') + ': ' + msg.content;
    }).join('\n');

    // 生成简短摘要前缀
    var briefSummary = '[对话摘要] 以下是之前 ' + SUMMARY_COUNT + ' 条对话的概要：\n' + summaryText;

    // 将摘要作为一条 assistant 消息插入到最前面
    var summaryMessage = {
      id: Utils.generateId(),
      role: 'assistant',
      content: briefSummary,
      timestamp: Date.now(),
      type: 'text'
    };

    messages.unshift(summaryMessage);
    onMessageCallback(summaryMessage);
  }

  // 导出到全局
  window.ChatModule = {
    addMessage: addMessage,
    getHistory: getHistory,
    clear: clear,
    getMessages: getMessages,
    onMessage: onMessage
  };

})();