/**
 * Audio Recorder Module
 * 参考 LumiOS 架构，使用 getUserMedia + AudioContext 录制音频
 * 输出 WAV 格式，通过 HTTP 发送到后端 STT 接口
 */
(function() {
  'use strict';

  var audioContext = null;
  var mediaStream = null;
  var scriptProcessor = null;
  var audioChunks = [];
  var isRecording = false;
  var recordingStartTime = 0;
  var silenceTimer = null;
  var analyser = null;

  // 录音配置
  var SAMPLE_RATE = 16000;  // 16kHz，匹配 Whisper 要求
  var SILENCE_THRESHOLD = 0.02;  // 静音阈值
  var SILENCE_TIMEOUT = 2000;    // 静音 2 秒后自动停止
  var MAX_RECORDING_TIME = 30000; // 最大录音 30 秒

  // 回调
  var onResultCallback = function() {};
  var onStatusChangeCallback = function() {};
  var onErrorCallback = function() {};

  /**
   * 将 Float32 音频数据转换为 Int16
   */
  function floatTo16BitPCM(input) {
    var output = new Int16Array(input.length);
    for (var i = 0; i < input.length; i++) {
      var s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output;
  }

  /**
   * 写入 WAV 文件头
   */
  function writeWAVHeader(dataLength, sampleRate, numChannels) {
    var buffer = new ArrayBuffer(44);
    var view = new DataView(buffer);

    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);           // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true);            // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true);  // NumChannels
    view.setUint32(24, sampleRate, true);   // SampleRate
    view.setUint32(28, sampleRate * numChannels * 2, true); // ByteRate
    view.setUint16(32, numChannels * 2, true); // BlockAlign
    view.setUint16(34, 16, true);           // BitsPerSample

    // data sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    return buffer;
  }

  function writeString(view, offset, string) {
    for (var i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  /**
   * 合并所有音频块为 WAV Blob
   */
  function createWAVBlob(audioData, sampleRate) {
    var pcmData = floatTo16BitPCM(audioData);
    var header = writeWAVHeader(pcmData.length * 2, sampleRate, 1);

    var blob = new Blob([header, pcmData], { type: 'audio/wav' });
    return blob;
  }

  /**
   * 检测音频电平
   */
  function getAudioLevel(dataArray) {
    var sum = 0;
    for (var i = 0; i < dataArray.length; i++) {
      var v = (dataArray[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / dataArray.length);
  }

  /**
   * 开始录音
   */
  function startRecording(options) {
    if (isRecording) return Promise.resolve();

    options = options || {};
    if (options.onResult) onResultCallback = options.onResult;
    if (options.onStatusChange) onStatusChangeCallback = options.onStatusChange;
    if (options.onError) onErrorCallback = options.onError;

    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: SAMPLE_RATE
      }
    }).then(function(stream) {
      mediaStream = stream;
      audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

      var source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      // ScriptProcessor 用于采集音频数据
      scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      audioChunks = [];
      isRecording = true;
      recordingStartTime = Date.now();

      scriptProcessor.onaudioprocess = function(e) {
        if (!isRecording) return;
        var inputData = e.inputBuffer.getChannelData(0);
        audioChunks.push(new Float32Array(inputData));

        // 检测静音
        var dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(dataArray);
        var level = getAudioLevel(dataArray);

        if (level < SILENCE_THRESHOLD) {
          if (!silenceTimer) {
            silenceTimer = setTimeout(function() {
              if (isRecording) {
                console.log('[AudioRecorder] 检测到静音，自动停止录音');
                stopRecording();
              }
            }, SILENCE_TIMEOUT);
          }
        } else {
          if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
          }
        }
      };

      analyser.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      // 最大录音时间限制
      setTimeout(function() {
        if (isRecording) {
          console.log('[AudioRecorder] 达到最大录音时间');
          stopRecording();
        }
      }, MAX_RECORDING_TIME);

      onStatusChangeCallback('recording');
      console.log('[AudioRecorder] 开始录音');

    }).catch(function(err) {
      console.error('[AudioRecorder] 获取麦克风失败:', err.message);
      onErrorCallback(err.message);
      throw err;
    });
  }

  /**
   * 停止录音并发送 STT 请求
   */
  function stopRecording() {
    if (!isRecording) return Promise.resolve();
    isRecording = false;

    // 清理资源
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }

    if (scriptProcessor) {
      scriptProcessor.disconnect();
      scriptProcessor = null;
    }

    if (analyser) {
      analyser.disconnect();
      analyser = null;
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach(function(track) { track.stop(); });
      mediaStream = null;
    }

    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }

    onStatusChangeCallback('processing');

    // 合并音频数据
    var totalLength = 0;
    for (var i = 0; i < audioChunks.length; i++) {
      totalLength += audioChunks[i].length;
    }

    var mergedData = new Float32Array(totalLength);
    var offset = 0;
    for (var i = 0; i < audioChunks.length; i++) {
      mergedData.set(audioChunks[i], offset);
      offset += audioChunks[i].length;
    }

    audioChunks = [];

    // 创建 WAV Blob
    var wavBlob = createWAVBlob(mergedData, SAMPLE_RATE);

    // 检查音频是否为空（所有采样值为0或接近0）
    // 计算音频能量（RMS）
    var sum = 0;
    for (var i = 0; i < mergedData.length; i++) {
      sum += mergedData[i] * mergedData[i];
    }
    var rms = Math.sqrt(sum / mergedData.length);
    console.log('[AudioRecorder] 音频 RMS 能量:', rms.toFixed(6));

    if (rms < 0.01) {
      console.warn('[AudioRecorder] 录制的音频能量过低，麦克风可能没有实际音频输入');
      onStatusChangeCallback('no-audio');
      return Promise.reject(new Error('麦克风未检测到声音，请检查麦克风权限或尝试上传音频文件'));
    }

    // 发送到后端 STT
    return sendSTTRequest(wavBlob);
  }

  /**
   * 发送 STT 请求到后端
   */
  function sendSTTRequest(audioBlob) {
    var formData = new FormData();
    formData.append('audio', audioBlob, 'recording.wav');

    // 自动适配 host
    var serverUrl = (location.port === '3000' || location.port === '')
      ? ''
      : 'http://' + (location.hostname || 'localhost') + ':3000';

    return fetch(serverUrl + '/api/stt', {
      method: 'POST',
      body: formData
    }).then(function(response) {
      if (!response.ok) {
        throw new Error('STT 请求失败: ' + response.status);
      }
      return response.json();
    }).then(function(data) {
      if (data.text) {
        onResultCallback(data.text);
        onStatusChangeCallback('idle');
        return data.text;
      } else {
        throw new Error(data.error || '识别结果为空');
      }
    }).catch(function(err) {
      console.error('[AudioRecorder] STT 错误:', err.message);
      onErrorCallback(err.message);
      onStatusChangeCallback('error');
      throw err;
    });
  }

  /**
   * 实时流式录音（WebSocket 连接 DashScope 实时 ASR）
   * 音频流持续发送，识别结果通过回调实时返回
   */
  var wsStt = null;        // WebSocket 连接
  var isStreaming = false;
  var hasSpoken = false;     // 是否检测到过语音
  var streamOnInterim = function() {};
  var streamOnFinal = function() {};
  var streamOnReady = function() {};
  var streamOnError = function() {};

  function startStreaming(options) {
    if (isStreaming || isRecording) return Promise.resolve();

    options = options || {};
    if (options.onInterim) streamOnInterim = options.onInterim;
    if (options.onFinal) streamOnFinal = options.onFinal;
    if (options.onReady) streamOnReady = options.onReady;
    if (options.onError) streamOnError = options.onError;

    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: { ideal: SAMPLE_RATE }
      }
    }).then(function(stream) {
      mediaStream = stream;
      audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

      var source = audioContext.createMediaStreamSource(stream);

      // ScriptProcessor 用于采集音频数据
      scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      audioChunks = [];
      isStreaming = true;
      hasSpoken = false;
      recordingStartTime = Date.now();

      // 连接 WebSocket
      var wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + (location.hostname || 'localhost') + ':3000/ws/stt-realtime';
      console.log('[AudioRecorder] 连接实时 STT:', wsUrl);
      wsStt = new WebSocket(wsUrl);
      wsStt.binaryType = 'arraybuffer';

      wsStt.onopen = function() {
        console.log('[AudioRecorder] WebSocket 已连接');
        onStatusChangeCallback('recording');
        if (streamOnReady) streamOnReady();
      };

      wsStt.onmessage = function(event) {
        try {
          var msg = JSON.parse(event.data);
          if (msg.type === 'ready') {
            console.log('[AudioRecorder] STT 服务就绪，开始流式传输');
          } else if (msg.type === 'interim') {
            if (streamOnInterim) streamOnInterim(msg.text);
          } else if (msg.type === 'final') {
            console.log('[AudioRecorder] 最终识别:', msg.text);
            if (streamOnFinal) streamOnFinal(msg.text);
          } else if (msg.type === 'error') {
            console.error('[AudioRecorder] STT 错误:', msg.message);
            if (streamOnError) streamOnError(new Error(msg.message));
          } else if (msg.type === 'closed') {
            console.log('[AudioRecorder] STT 连接关闭');
          }
        } catch (e) {
          console.error('[AudioRecorder] 解析消息失败:', e);
        }
      };

      wsStt.onerror = function(err) {
        console.error('[AudioRecorder] WebSocket 错误:', err);
        if (streamOnError) streamOnError(new Error('WebSocket 连接失败'));
      };

      wsStt.onclose = function() {
        console.log('[AudioRecorder] WebSocket 断开');
        isStreaming = false;
      };

      scriptProcessor.onaudioprocess = function(e) {
        if (!isStreaming) return;
        var inputData = e.inputBuffer.getChannelData(0);

        // 转为 Int16 PCM 并通过 WebSocket 发送
        var pcmData = floatTo16BitPCM(inputData);
        if (wsStt && wsStt.readyState === WebSocket.OPEN) {
          wsStt.send(pcmData.buffer);
        }

        // 检测静音（用于自动停止）
        var dataArray = new Uint8Array(analyser ? analyser.frequencyBinCount : 256);
        if (analyser) {
          analyser.getByteTimeDomainData(dataArray);
          var level = getAudioLevel(dataArray);
          if (level < SILENCE_THRESHOLD) {
            if (!silenceTimer && hasSpoken) {
              silenceTimer = setTimeout(function() {
                if (isStreaming) {
                  console.log('[AudioRecorder] 检测到静音，结束当前句子');
                  if (wsStt && wsStt.readyState === WebSocket.OPEN) {
                    wsStt.send(JSON.stringify({ type: 'finish' }));
                  }
                }
              }, SILENCE_TIMEOUT);
            }
          } else {
            hasSpoken = true; // 检测到语音
            if (silenceTimer) {
              clearTimeout(silenceTimer);
              silenceTimer = null;
            }
          }
        }
      };

      // 创建 analyser 用于静音检测
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      onStatusChangeCallback('recording');
      console.log('[AudioRecorder] 开始实时流式录音');

    }).catch(function(err) {
      console.error('[AudioRecorder] 启动流式录音失败:', err.message);
      onStatusChangeCallback('error');
      if (streamOnError) streamOnError(err);
      throw err;
    });
  }

  function stopStreaming() {
    if (!isStreaming) return Promise.resolve();
    isStreaming = false;

    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }

    if (scriptProcessor) {
      scriptProcessor.disconnect();
      scriptProcessor = null;
    }

    if (analyser) {
      analyser.disconnect();
      analyser = null;
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach(function(track) { track.stop(); });
      mediaStream = null;
    }

    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }

    if (wsStt) {
      try {
        if (wsStt.readyState === WebSocket.OPEN) {
          wsStt.send(JSON.stringify({ type: 'finish' }));
        }
      } catch (e) {}
      setTimeout(function() {
        try { wsStt.close(); } catch (e) {}
        wsStt = null;
      }, 300);
    }

    onStatusChangeCallback('idle');
    console.log('[AudioRecorder] 停止流式录音');
    return Promise.resolve();
  }

  /**
   * 取消录音
   */
  function cancelRecording() {
    if (!isRecording) return;
    isRecording = false;

    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }

    if (scriptProcessor) {
      scriptProcessor.disconnect();
      scriptProcessor = null;
    }

    if (analyser) {
      analyser.disconnect();
      analyser = null;
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach(function(track) { track.stop(); });
      mediaStream = null;
    }

    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }

    audioChunks = [];
    onStatusChangeCallback('idle');
  }

  /**
   * 获取录音状态
   */
  function getStatus() {
    return isRecording ? 'recording' : 'idle';
  }

  /**
   * 上传音频文件并进行 STT 识别
   */
  function uploadAudioFile(file, options) {
    options = options || {};
    if (options.onResult) onResultCallback = options.onResult;
    if (options.onStatusChange) onStatusChangeCallback = options.onStatusChange;
    if (options.onError) onErrorCallback = options.onError;

    if (!file) {
      return Promise.reject(new Error('未选择文件'));
    }

    // 检查文件类型
    var validTypes = ['audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/x-m4a'];
    var isValidType = validTypes.some(function(t) { return file.type.indexOf(t) !== -1; }) ||
                      file.name.match(/\.(wav|mp3|webm|ogg|m4a|mp4)$/i);

    if (!isValidType) {
      return Promise.reject(new Error('不支持的音频格式，请上传 WAV、MP3、WEBM、OGG 或 M4A 文件'));
    }

    // 检查文件大小 (最大 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return Promise.reject(new Error('音频文件过大，请上传小于 10MB 的文件'));
    }

    onStatusChangeCallback('processing');

    var formData = new FormData();
    formData.append('audio', file, file.name);

    // 自动适配 host
    var serverUrl = (location.port === '3000' || location.port === '')
      ? ''
      : 'http://' + (location.hostname || 'localhost') + ':3000';

    return fetch(serverUrl + '/api/stt', {
      method: 'POST',
      body: formData
    }).then(function(response) {
      if (!response.ok) {
        throw new Error('STT 请求失败: ' + response.status);
      }
      return response.json();
    }).then(function(data) {
      if (data.text) {
        onResultCallback(data.text);
        onStatusChangeCallback('idle');
        return data.text;
      } else {
        throw new Error(data.error || '识别结果为空');
      }
    }).catch(function(err) {
      console.error('[AudioRecorder] 文件上传 STT 错误:', err.message);
      onErrorCallback(err.message);
      onStatusChangeCallback('error');
      throw err;
    });
  }

  // 暴露 API
  window.AudioRecorder = {
    startRecording: startRecording,
    stopRecording: stopRecording,
    cancelRecording: cancelRecording,
    uploadAudioFile: uploadAudioFile,
    getStatus: getStatus,
    startStreaming: startStreaming,
    stopStreaming: stopStreaming
  };

})();
