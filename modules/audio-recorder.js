/**
 * audio-recorder.js
 * WebSocket 实时 STT 音频录制模块 (IIFE 浏览器模块)
 *
 * 功能：
 * - 使用 getUserMedia 获取麦克风音频（回声消除、降噪、自动增益）
 * - 通过 WebSocket 连接 ws://localhost:3000/ws/stt-realtime
 * - 使用 ScriptProcessorNode (4096 缓冲，单声道) 捕获音频
 * - 将 16kHz 采样率 Int16 PCM 数据通过 WebSocket 发送
 * - 处理服务端返回的 interim / final / ready / error / closed 消息
 */

(function (global) {
  'use strict';

  const SAMPLE_RATE = 16000;
  const BUFFER_SIZE = 4096;
  const WS_URL = 'ws://localhost:3000/ws/stt-realtime';

  // 模块内部状态
  let mediaStream = null;
  let audioContext = null;
  let scriptProcessor = null;
  let ws = null;
  let isStreaming = false;

  // 用户回调
  let callbacks = {
    onInterim: null,
    onFinal: null,
    onReady: null,
    onError: null
  };

  /**
   * 将 Float32 音频数据转换为 Int16 PCM
   * @param {Float32Array} float32Array - 输入浮点采样数据
   * @returns {ArrayBuffer} Int16 PCM 数据
   */
  function float32ToInt16(float32Array) {
    const length = float32Array.length;
    const int16Buffer = new Int16Array(length);
    for (let i = 0; i < length; i++) {
      // Clamp 到 [-1, 1] 范围，然后缩放到 Int16
      let sample = Math.max(-1, Math.min(1, float32Array[i]));
      int16Buffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    return int16Buffer.buffer;
  }

  /**
   * 将 AudioBuffer 重采样为目标采样率
   * @param {AudioBuffer} audioBuffer - 原始音频缓冲
   * @param {number} targetSampleRate - 目标采样率
   * @returns {Float32Array} 重采样后的数据
   */
  function resample(audioBuffer, targetSampleRate) {
    const sourceSampleRate = audioBuffer.sampleRate;
    const channels = audioBuffer.numberOfChannels;
    const numSamples = audioBuffer.length;

    // 计算重采样后的长度
    const ratio = targetSampleRate / sourceSampleRate;
    const newLength = Math.round(numSamples * ratio);
    const result = new Float32Array(newLength);

    // 简单线性插值重采样（混合所有声道为单声道）
    for (let i = 0; i < newLength; i++) {
      const srcIndex = (i / ratio);
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, numSamples - 1);
      const fraction = srcIndex - srcIndexFloor;

      let sampleSum = 0;
      for (let ch = 0; ch < channels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        const s0 = channelData[srcIndexFloor];
        const s1 = channelData[srcIndexCeil];
        sampleSum += s0 + (s1 - s0) * fraction;
      }
      result[i] = sampleSum / channels;
    }

    return result;
  }

  /**
   * 处理 WebSocket 消息
   * @param {MessageEvent} event - WebSocket 消息事件
   */
  function handleWSMessage(event) {
    try {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        const type = msg.type;

        console.log('[AudioRecorder] 收到消息:', type, msg);

        switch (type) {
          case 'ready':
            console.log('[AudioRecorder] STT 服务就绪');
            if (typeof callbacks.onReady === 'function') {
              callbacks.onReady(msg);
            }
            break;

          case 'interim':
            console.log('[AudioRecorder] 临时结果:', msg.text);
            if (typeof callbacks.onInterim === 'function') {
              callbacks.onInterim(msg.text);
            }
            break;

          case 'final':
            console.log('[AudioRecorder] 最终结果:', msg.text);
            if (typeof callbacks.onFinal === 'function') {
              callbacks.onFinal(msg.text);
            }
            break;

          case 'error':
            console.error('[AudioRecorder] 错误:', msg.message || msg);
            if (typeof callbacks.onError === 'function') {
              callbacks.onError(msg.message || msg);
            }
            break;

          case 'closed':
            console.log('[AudioRecorder] STT 连接已关闭');
            break;

          default:
            console.log('[AudioRecorder] 未知消息类型:', type);
        }
      } else {
        // 二进制消息通常不需要在客户端处理
        console.log('[AudioRecorder] 收到二进制消息, 长度:', event.data.byteLength || event.data.size);
      }
    } catch (err) {
      console.error('[AudioRecorder] 消息处理错误:', err);
      if (typeof callbacks.onError === 'function') {
        callbacks.onError('消息解析失败: ' + err.message);
      }
    }
  }

  /**
   * 处理 WebSocket 错误
   * @param {Event} event - 错误事件
   */
  function handleWSError(event) {
    console.error('[AudioRecorder] WebSocket 错误:', event);
    if (typeof callbacks.onError === 'function') {
      callbacks.onError('WebSocket 连接错误');
    }
  }

  /**
   * 处理 WebSocket 关闭
   * @param {CloseEvent} event - 关闭事件
   */
  function handleWSClose(event) {
    console.log('[AudioRecorder] WebSocket 连接关闭, code:', event.code, 'reason:', event.reason);
    if (event.code !== 1000 && typeof callbacks.onError === 'function') {
      callbacks.onError('WebSocket 异常关闭, code: ' + event.code);
    }
  }

  /**
   * 处理 WebSocket 打开
   */
  function handleWSOpen() {
    console.log('[AudioRecorder] WebSocket 连接已建立');
  }

  /**
   * 音频处理回调 - ScriptProcessorNode onaudioprocess
   * @param {AudioProcessingEvent} event - 音频处理事件
   */
  function onAudioProcess(event) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const inputBuffer = event.inputBuffer;

    // 重采样并转换为单声道 Float32
    const resampledData = resample(inputBuffer, SAMPLE_RATE);

    // 转换为 Int16 PCM
    const pcmData = float32ToInt16(resampledData);

    // 通过 WebSocket 发送
    try {
      ws.send(pcmData);
    } catch (err) {
      console.error('[AudioRecorder] 音频数据发送失败:', err);
    }
  }

  /**
   * 开始流式录音并连接 STT 服务
   * @param {Object} options - 配置选项
   * @param {Function} options.onInterim - 临时识别结果回调 (text: string)
   * @param {Function} options.onFinal - 最终识别结果回调 (text: string)
   * @param {Function} options.onReady - STT 服务就绪回调
   * @param {Function} options.onError - 错误回调 (error: string)
   * @returns {Promise<void>}
   */
  async function startStreaming(options) {
    // 防止重复启动
    if (isStreaming) {
      console.warn('[AudioRecorder] 已经在录音中，忽略重复的启动请求');
      return;
    }

    console.log('[AudioRecorder] 开始启动录音...');

    // 保存回调
    callbacks.onInterim = options.onInterim || null;
    callbacks.onFinal = options.onFinal || null;
    callbacks.onReady = options.onReady || null;
    callbacks.onError = options.onError || null;

    try {
      // 1. 获取麦克风权限
      console.log('[AudioRecorder] 请求麦克风权限...');
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: SAMPLE_RATE,
          channelCount: 1
        }
      });
      console.log('[AudioRecorder] 麦克风权限已获取');

      // 2. 创建 AudioContext
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE
      });
      console.log('[AudioRecorder] AudioContext 创建完成, sampleRate:', audioContext.sampleRate);

      // 3. 创建媒体源节点
      const sourceNode = audioContext.createMediaStreamSource(mediaStream);

      // 4. 创建 ScriptProcessorNode (4096 缓冲, 1 输入声道, 1 输出声道)
      scriptProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

      // 5. 绑定音频处理回调
      scriptProcessor.onaudioprocess = onAudioProcess;

      // 6. 连接节点链: source -> scriptProcessor -> destination
      sourceNode.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      console.log('[AudioRecorder] 音频处理链路已建立, bufferSize:', BUFFER_SIZE);

      // 7. 建立 WebSocket 连接
      console.log('[AudioRecorder] 连接 WebSocket:', WS_URL);
      ws = new WebSocket(WS_URL);
      ws.binaryType = 'arraybuffer';

      ws.onopen = handleWSOpen;
      ws.onmessage = handleWSMessage;
      ws.onerror = handleWSError;
      ws.onclose = handleWSClose;

      isStreaming = true;
      console.log('[AudioRecorder] 录音已启动');
    } catch (err) {
      console.error('[AudioRecorder] 启动录音失败:', err);

      // 清理部分初始化的资源
      await cleanupResources();

      if (typeof callbacks.onError === 'function') {
        callbacks.onError('启动录音失败: ' + err.message);
      }
      throw err;
    }
  }

  /**
   * 清理所有音频和网络资源
   */
  async function cleanupResources() {
    console.log('[AudioRecorder] 清理资源...');

    // 1. 停止并断开 ScriptProcessor
    if (scriptProcessor) {
      try {
        scriptProcessor.disconnect();
        scriptProcessor.onaudioprocess = null;
      } catch (e) {
        console.warn('[AudioRecorder] ScriptProcessor 断开失败:', e);
      }
      scriptProcessor = null;
    }

    // 2. 关闭 AudioContext
    if (audioContext) {
      try {
        if (audioContext.state !== 'closed') {
          await audioContext.close();
        }
      } catch (e) {
        console.warn('[AudioRecorder] AudioContext 关闭失败:', e);
      }
      audioContext = null;
    }

    // 3. 停止所有媒体轨道
    if (mediaStream) {
      try {
        mediaStream.getTracks().forEach(function (track) {
          track.stop();
          console.log('[AudioRecorder] 已停止媒体轨道:', track.kind);
        });
      } catch (e) {
        console.warn('[AudioRecorder] 媒体轨道停止失败:', e);
      }
      mediaStream = null;
    }

    // 4. 关闭 WebSocket
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'Client stopped');
        }
      } catch (e) {
        console.warn('[AudioRecorder] WebSocket 关闭失败:', e);
      }
      ws = null;
    }
  }

  /**
   * 停止流式录音
   * @returns {Promise<void>}
   */
  async function stopStreaming() {
    if (!isStreaming) {
      console.warn('[AudioRecorder] 当前未在录音，无需停止');
      return;
    }

    console.log('[AudioRecorder] 停止录音...');
    isStreaming = false;

    await cleanupResources();

    console.log('[AudioRecorder] 录音已停止');
  }

  // ==================== 导出模块 API ====================

  const AudioRecorder = {
    SAMPLE_RATE: SAMPLE_RATE,
    BUFFER_SIZE: BUFFER_SIZE,
    startStreaming: startStreaming,
    stopStreaming: stopStreaming,

    /**
     * 获取当前录音状态
     * @returns {boolean}
     */
    get isStreaming() {
      return isStreaming;
    }
  };

  // 挂载到全局
  global.AudioRecorder = AudioRecorder;

  // 支持 CommonJS 环境（如测试工具）
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioRecorder;
  }

  console.log('[AudioRecorder] 模块已加载');

})(typeof window !== 'undefined' ? window : global);