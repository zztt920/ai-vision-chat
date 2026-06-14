/**
 * ws-stt.js
 * WebSocket STT 代理 - DashScope Paraformer 实时语音识别
 *
 * 功能：
 * - 创建 WebSocket 服务端，监听客户端连接
 * - 客户端连接时，建立到 DashScope 实时 STT API 的 WebSocket 连接
 * - 转发客户端二进制音频数据到 DashScope
 * - 接收 DashScope 的 JSON 转录结果，解析后发回客户端
 * - 消息类型: ready / interim / final / error / closed
 *
 * DashScope API:
 *   地址: wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=paraformer-realtime-v2
 *   认证: 通过 header 中的 Authorization: Bearer <API_KEY>
 *   音频格式: PCM 16kHz, 16bit, 单声道
 */

'use strict';

const WebSocket = require('ws');
const crypto = require('crypto');

const DASHSCOPE_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=paraformer-realtime-v2';
const SAMPLE_RATE = 16000;

/**
 * 生成唯一的 task_id
 * @returns {string}
 */
function generateTaskId() {
  return 'task_' + crypto.randomBytes(16).toString('hex');
}

/**
 * 构建 DashScope 启动任务的 token
 * @param {string} taskId - 任务 ID
 * @returns {Object} token 对象
 */
function buildStartToken(taskId) {
  return {
    header: {
      task_id: taskId,
      action: 'run-task',
      streaming: 'duplex'
    },
    payload: {
      task_group: 'audio',
      task: 'asr',
      function: 'recognition',
      model: 'paraformer-realtime-v2',
      parameters: {
        format: 'pcm',
        sample_rate: SAMPLE_RATE
      }
    }
  };
}

/**
 * 建立到 DashScope 的 WebSocket 连接
 * @returns {Promise<WebSocket>}
 */
function connectToDashScope() {
  return new Promise(function (resolve, reject) {
    var apiKey = process.env.DASHSCOPE_API_KEY;

    if (!apiKey) {
      var err = new Error('未设置 DASHSCOPE_API_KEY 环境变量');
      console.error('[WS-STT]', err.message);
      reject(err);
      return;
    }

    console.log('[WS-STT] 正在连接 DashScope...');
    console.log('[WS-STT] URL:', DASHSCOPE_WS_URL);

    var dashScopeWs = new WebSocket(DASHSCOPE_WS_URL, {
      headers: {
        'Authorization': 'Bearer ' + apiKey
      }
    });

    var connectionTimeout = setTimeout(function () {
      console.error('[WS-STT] DashScope 连接超时');
      dashScopeWs.close();
      reject(new Error('DashScope 连接超时'));
    }, 15000);

    dashScopeWs.on('open', function () {
      clearTimeout(connectionTimeout);
      console.log('[WS-STT] DashScope 连接已建立');

      // 发送启动 token
      var taskId = generateTaskId();
      var startToken = buildStartToken(taskId);
      var tokenStr = JSON.stringify(startToken);

      console.log('[WS-STT] 发送启动 token, taskId:', taskId);
      dashScopeWs.send(tokenStr);
      dashScopeWs._taskId = taskId;
    });

    dashScopeWs.on('error', function (err) {
      clearTimeout(connectionTimeout);
      console.error('[WS-STT] DashScope WebSocket 错误:', err.message);
      reject(err);
    });

    // 等待 DashScope 返回 ready 确认后再 resolve
    dashScopeWs.on('message', function onFirstMessage(data) {
      try {
        var msg = JSON.parse(data.toString());
        console.log('[WS-STT] DashScope 首条消息:', JSON.stringify(msg).substring(0, 200));

        // DashScope 返回的 header 中包含 task_id 表示就绪
        if (msg.header && msg.header.task_id) {
          clearTimeout(connectionTimeout);
          dashScopeWs.removeListener('message', onFirstMessage);
          // 重新绑定后续消息处理（由 setupClientHandler 负责）

          console.log('[WS-STT] DashScope 服务就绪, task_id:', msg.header.task_id);
          resolve(dashScopeWs);
        }
      } catch (e) {
        console.error('[WS-STT] DashScope 消息解析失败:', e.message);
      }
    });
  });
}

/**
 * 发送就绪消息给客户端
 * @param {WebSocket} clientWs - 客户端 WebSocket
 */
function sendReady(clientWs) {
  var msg = JSON.stringify({ type: 'ready' });
  console.log('[WS-STT] 发送 ready 给客户端');
  safeSend(clientWs, msg);
}

/**
 * 发送临时结果给客户端
 * @param {WebSocket} clientWs - 客户端 WebSocket
 * @param {string} text - 临时识别文本
 */
function sendInterim(clientWs, text) {
  var msg = JSON.stringify({ type: 'interim', text: text });
  console.log('[WS-STT] 发送 interim:', text);
  safeSend(clientWs, msg);
}

/**
 * 发送最终结果给客户端
 * @param {WebSocket} clientWs - 客户端 WebSocket
 * @param {string} text - 最终识别文本
 */
function sendFinal(clientWs, text) {
  var msg = JSON.stringify({ type: 'final', text: text });
  console.log('[WS-STT] 发送 final:', text);
  safeSend(clientWs, msg);
}

/**
 * 发送错误消息给客户端
 * @param {WebSocket} clientWs - 客户端 WebSocket
 * @param {string} message - 错误描述
 */
function sendError(clientWs, message) {
  var msg = JSON.stringify({ type: 'error', message: message });
  console.error('[WS-STT] 发送 error 给客户端:', message);
  safeSend(clientWs, msg);
}

/**
 * 发送关闭消息给客户端
 * @param {WebSocket} clientWs - 客户端 WebSocket
 */
function sendClosed(clientWs) {
  var msg = JSON.stringify({ type: 'closed' });
  console.log('[WS-STT] 发送 closed 给客户端');
  safeSend(clientWs, msg);
}

/**
 * 安全发送消息（仅在连接打开时发送）
 * @param {WebSocket} ws - WebSocket 实例
 * @param {string} data - 要发送的字符串数据
 */
function safeSend(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(data);
    } catch (err) {
      console.error('[WS-STT] 消息发送失败:', err.message);
    }
  }
}

/**
 * 解析 DashScope 返回的转录结果
 * @param {Object} dashMsg - DashScope 返回的 JSON 对象
 * @returns {{type: string, text: string}|null} 解析后的结果
 */
function parseDashScopeMessage(dashMsg) {
  try {
    // DashScope 实时 ASR 响应格式:
    // header: { task_id, event, ... }
    // payload: { output: { sentence: { text, ... } }, ... }

    if (!dashMsg || !dashMsg.header) {
      return null;
    }

    var eventName = dashMsg.header.event || '';

    switch (eventName) {
      case 'task-started':
        return { type: 'ready', text: '' };

      case 'result-generated':
        // 可能包含临时或最终结果
        if (dashMsg.payload && dashMsg.payload.output) {
          var output = dashMsg.payload.output;
          if (output.sentence) {
            var text = output.sentence.text || '';
            var isFinal = output.sentence.end_time != null;
            // sentence 的 end_time 不为 null 表示句子已结束
            if (isFinal && text) {
              return { type: 'final', text: text };
            } else if (text) {
              return { type: 'interim', text: text };
            }
          }
        }
        break;

      case 'task-failed':
        var errorMsg = 'DashScope 任务失败';
        if (dashMsg.payload && dashMsg.payload.error) {
          errorMsg = dashMsg.payload.error.message || dashMsg.payload.error.code || errorMsg;
        }
        return { type: 'error', text: errorMsg };

      case 'task-finished':
        return { type: 'closed', text: '' };

      default:
        // 其他事件静默忽略
        break;
    }

    return null;
  } catch (err) {
    console.error('[WS-STT] 解析 DashScope 消息时出错:', err.message);
    return null;
  }
}

/**
 * 处理单个客户端的连接
 * @param {WebSocket} clientWs - 客户端 WebSocket 连接
 */
function handleClientConnection(clientWs) {
  console.log('[WS-STT] 新客户端连接');
  var dashScopeWs = null;
  var isClosed = false;

  // 连接 DashScope
  connectToDashScope()
    .then(function (dsws) {
      dashScopeWs = dsws;

      if (isClosed) {
        dashScopeWs.close();
        return;
      }

      // 通知客户端就绪
      sendReady(clientWs);

      // 处理 DashScope 消息（非首条）
      dashScopeWs.on('message', function (data) {
        if (isClosed || clientWs.readyState !== WebSocket.OPEN) {
          return;
        }

        try {
          var dashMsg = JSON.parse(data.toString());
          console.log('[WS-STT] DashScope 消息:', JSON.stringify(dashMsg).substring(0, 300));

          var parsed = parseDashScopeMessage(dashMsg);
          if (!parsed) {
            return;
          }

          switch (parsed.type) {
            case 'ready':
              sendReady(clientWs);
              break;
            case 'interim':
              sendInterim(clientWs, parsed.text);
              break;
            case 'final':
              sendFinal(clientWs, parsed.text);
              break;
            case 'error':
              sendError(clientWs, parsed.text);
              break;
            case 'closed':
              sendClosed(clientWs);
              // 优雅关闭客户端连接
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.close(1000, 'STT session complete');
              }
              break;
          }
        } catch (err) {
          console.error('[WS-STT] 处理 DashScope 消息时出错:', err.message);
        }
      });

      // DashScope 连接错误
      dashScopeWs.on('error', function (err) {
        console.error('[WS-STT] DashScope 错误:', err.message);
        if (!isClosed) {
          sendError(clientWs, 'DashScope 连接错误: ' + err.message);
        }
      });

      // DashScope 连接关闭
      dashScopeWs.on('close', function (code, reason) {
        console.log('[WS-STT] DashScope 连接关闭, code:', code);
        if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
          sendClosed(clientWs);
        }
      });
    })
    .catch(function (err) {
      console.error('[WS-STT] 连接 DashScope 失败:', err.message);
      if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
        sendError(clientWs, '无法连接到语音识别服务: ' + err.message);
        clientWs.close(1011, err.message);
      }
    });

  // 处理客户端发来的消息（二进制音频数据）
  clientWs.on('message', function (data) {
    if (isClosed) return;

    if (dashScopeWs && dashScopeWs.readyState === WebSocket.OPEN) {
      try {
        dashScopeWs.send(data);
      } catch (err) {
        console.error('[WS-STT] 转发音频数据到 DashScope 失败:', err.message);
      }
    }
  });

  // 客户端连接关闭
  clientWs.on('close', function (code, reason) {
    console.log('[WS-STT] 客户端连接关闭, code:', code);
    isClosed = true;

    if (dashScopeWs && dashScopeWs.readyState === WebSocket.OPEN) {
      try {
        dashScopeWs.close(1000, 'Client disconnected');
      } catch (err) {
        console.error('[WS-STT] 关闭 DashScope 连接失败:', err.message);
      }
    }
  });

  // 客户端 WebSocket 错误
  clientWs.on('error', function (err) {
    console.error('[WS-STT] 客户端 WebSocket 错误:', err.message);
    isClosed = true;
  });
}

/**
 * 设置 WebSocket STT 服务端，挂载到现有 HTTP 服务器
 * @param {http.Server|https.Server} server - HTTP/HTTPS 服务器实例
 * @returns {WebSocket.Server} 创建的 WebSocket 服务端实例
 */
function setupWSServer(server) {
  console.log('[WS-STT] 正在创建 WebSocket 服务端...');

  var wss = new WebSocket.Server({
    server: server,
    path: '/ws/stt-realtime'
  });

  wss.on('connection', function (clientWs, req) {
    console.log('[WS-STT] 客户端已连接, 来源:', req.socket.remoteAddress);
    handleClientConnection(clientWs);
  });

  wss.on('error', function (err) {
    console.error('[WS-STT] WebSocket 服务端错误:', err.message);
  });

  wss.on('listening', function () {
    console.log('[WS-STT] WebSocket 服务端已启动, 路径: /ws/stt-realtime');
  });

  console.log('[WS-STT] WebSocket STT 代理模块已加载');
  return wss;
}

module.exports = { setupWSServer };