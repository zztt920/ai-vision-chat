/**
 * DashScope Paraformer 实时语音识别 WebSocket 代理
 * 
 * 客户端 WebSocket → 本服务 → DashScope WebSocket
 * 实现边说边出文字，延迟 < 500ms
 */
const WebSocket = require('ws');
const crypto = require('crypto');

const DASHSCOPE_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';

function getApiKey() {
  // 从 .env 或环境变量获取
  const dotenv = require('dotenv');
  const path = require('path');
  dotenv.config({ path: path.join(__dirname, '.env') });
  return process.env.SILICONFLOW_API_KEY || process.env.API_KEY || process.env.DASHSCOPE_API_KEY;
}

/**
 * 创建 WebSocket STT 代理
 * @param {http.Server} httpServer - HTTP 服务器实例
 */
function createSttProxy(httpServer) {
  const wss = new WebSocket.Server({ 
    server: httpServer,
    path: '/ws/stt-realtime'
  });

  wss.on('connection', (clientWs, req) => {
    console.log('[WS-STT] 客户端已连接');
    let dashscopeWs = null;
    let taskId = null;
    let isTaskStarted = false;
    let lastFinalText = '';

    // 连接到 DashScope
    const apiKey = getApiKey();
    if (!apiKey) {
      console.error('[WS-STT] 缺少 API Key');
      clientWs.send(JSON.stringify({ type: 'error', message: '服务器未配置 API Key' }));
      clientWs.close();
      return;
    }

    console.log('[WS-STT] 正在连接 DashScope...');
    dashscopeWs = new WebSocket(DASHSCOPE_WS_URL, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'LumiChat/1.0'
      }
    });

    // 心跳定时器
    let heartbeatTimer = null;

    function startHeartbeat() {
      heartbeatTimer = setInterval(() => {
        if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN) {
          // 发送静音帧保持连接
          const silence = Buffer.alloc(640); // 20ms of 16kHz 16-bit PCM silence
          dashscopeWs.send(silence);
        }
      }, 30000);
    }

    function stopHeartbeat() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    dashscopeWs.on('open', () => {
      console.log('[WS-STT] DashScope 连接成功');
      taskId = crypto.randomUUID();
      
      // 发送 run-task
      const runTask = {
        header: {
          action: 'run-task',
          task_id: taskId,
          streaming: 'duplex'
        },
        payload: {
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          model: 'paraformer-realtime-v2',
          input: {},
          parameters: {
            format: 'pcm',
            sample_rate: 16000,
            language_hints: ['zh', 'en'],
            disfluency_removal_enabled: false,
            punctuation_prediction_enabled: true,
            inverse_text_normalization_enabled: true,
            max_sentence_silence: 800  // 静音800ms判定断句
          }
        }
      };
      dashscopeWs.send(JSON.stringify(runTask));
    });

    dashscopeWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const header = msg.header || {};
        const payload = msg.payload || {};

        // 调试日志
        // console.log('[WS-STT] DashScope 事件:', header.event);

        if (header.event === 'task-started') {
          isTaskStarted = true;
          console.log('[WS-STT] 任务已启动, task_id:', header.task_id);
          clientWs.send(JSON.stringify({ type: 'ready' }));
          startHeartbeat();
        }

        if (header.event === 'result-generated') {
          const sentence = payload.output?.sentence || {};
          if (sentence.heartbeat) return; // 跳过心跳包

          if (sentence.sentence_end) {
            // 最终结果
            const text = sentence.text || '';
            if (text.trim()) {
              lastFinalText = text;
              console.log('[WS-STT] 最终:', text);
              clientWs.send(JSON.stringify({ type: 'final', text }));
            }
          } else {
            // 中间结果
            const text = sentence.text || '';
            if (text.trim()) {
              clientWs.send(JSON.stringify({ type: 'interim', text }));
            }
          }
        }

        if (header.event === 'task-failed') {
          console.error('[WS-STT] 任务失败:', header.error_code, header.error_message);
          clientWs.send(JSON.stringify({ 
            type: 'error', 
            message: header.error_message || '语音识别失败' 
          }));
        }

        if (header.event === 'task-finished') {
          console.log('[WS-STT] 任务已完成');
          isTaskStarted = false;
        }
      } catch (e) {
        // 二进制消息（不处理）
      }
    });

    dashscopeWs.on('error', (err) => {
      console.error('[WS-STT] DashScope 错误:', err.message);
      clientWs.send(JSON.stringify({ type: 'error', message: '语音服务连接失败' }));
    });

    dashscopeWs.on('close', (code) => {
      console.log('[WS-STT] DashScope 连接关闭, code:', code);
      stopHeartbeat();
      isTaskStarted = false;
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'closed' }));
      }
    });

    // 处理客户端消息
    clientWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'finish') {
          // 客户端通知结束
          if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN && isTaskStarted) {
            const finishTask = {
              header: {
                action: 'finish-task',
                task_id: taskId,
                streaming: 'duplex'
              },
              payload: { input: {} }
            };
            dashscopeWs.send(JSON.stringify(finishTask));
            console.log('[WS-STT] 发送 finish-task');
          }
        }

        if (msg.type === 'reset') {
          // 重置连接（开始新一轮识别）
          lastFinalText = '';
          if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN) {
            if (isTaskStarted) {
              // 发送 finish-task 结束当前任务
              const finishTask = {
                header: {
                  action: 'finish-task',
                  task_id: taskId,
                  streaming: 'duplex'
                },
                payload: { input: {} }
              };
              dashscopeWs.send(JSON.stringify(finishTask));
            }
            // 等一小段时间后启动新任务
            setTimeout(() => {
              if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN) {
                taskId = crypto.randomUUID();
                const runTask = {
                  header: {
                    action: 'run-task',
                    task_id: taskId,
                    streaming: 'duplex'
                  },
                  payload: {
                    task_group: 'audio',
                    task: 'asr',
                    function: 'recognition',
                    model: 'paraformer-realtime-v2',
                    input: {},
                    parameters: {
                      format: 'pcm',
                      sample_rate: 16000,
                      language_hints: ['zh', 'en'],
                      disfluency_removal_enabled: false,
                      punctuation_prediction_enabled: true,
                      inverse_text_normalization_enabled: true,
                      max_sentence_silence: 800
                    }
                  }
                };
                dashscopeWs.send(JSON.stringify(runTask));
              }
            }, 500);
          }
        }
      } catch (e) {
        // 二进制音频数据，直接转发
        if (Buffer.isBuffer(data)) {
          if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN && isTaskStarted) {
            dashscopeWs.send(data);
          }
        } else if (data instanceof ArrayBuffer) {
          if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN && isTaskStarted) {
            dashscopeWs.send(data);
          }
        }
      }
    });

    // 处理二进制音频数据（直接转发）
    // ws 库中 message 事件会同时处理文本和二进制，但我们需要区分
    // 实际上 ws 库的 message 事件收到的 data 可能是 Buffer、ArrayBuffer 或 string
    // 上面的 try/catch 会处理 JSON 文本，catch 处理二进制

    clientWs.on('close', () => {
      console.log('[WS-STT] 客户端断开');
      stopHeartbeat();
      if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN) {
        try {
          if (isTaskStarted) {
            const finishTask = {
              header: {
                action: 'finish-task',
                task_id: taskId,
                streaming: 'duplex'
              },
              payload: { input: {} }
            };
            dashscopeWs.send(JSON.stringify(finishTask));
          }
        } catch (e) {}
        setTimeout(() => {
          try { dashscopeWs.close(); } catch (e) {}
        }, 500);
      }
    });

    clientWs.on('error', (err) => {
      console.error('[WS-STT] 客户端错误:', err.message);
      stopHeartbeat();
    });
  });

  console.log('[WS-STT] 实时语音识别 WebSocket 代理已就绪');
  return wss;
}

module.exports = { createSttProxy };