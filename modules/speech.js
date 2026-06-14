(function() {
  'use strict';

  var status = 'idle';
  var recognition = null;
  var synthesis = null;
  var speechRate = 1.0;
  var speechPitch = 1.0;
  var isSpeaking = false;
  var shouldRestart = false; // 标记是否需要在 onend 时重启
  var useAudioRecorder = false; // 是否使用 AudioRecorder 替代原生 SpeechRecognition
  var useRealtime = false;       // 是否使用 WebSocket 实时 ASR（最先尝试）
  var cachedVoices = [];         // 缓存语音列表，解决首次 speak 声音不一致问题

  // 回调函数
  var onResultCallback = function() {};
  var onInterimCallback = function() {};
  var onStatusChangeCallback = function() {};
  var onSpeakEndCallback = function() {};
  var onSpeakStartCallback = function() {};
  var onErrorCallback = function() {};

  // 内部状态更新
  function setStatus(newStatus) {
    status = newStatus;
    onStatusChangeCallback(status);
  }

  // 获取 SpeechRecognition 对象（处理浏览器前缀）
  function getSpeechRecognition() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      throw new Error('浏览器不支持 SpeechRecognition API');
    }
    return new SR();
  }

  // 获取 SpeechSynthesis 对象
  function getSpeechSynthesis() {
    if (!window.speechSynthesis) {
      throw new Error('浏览器不支持 SpeechSynthesis API');
    }
    return window.speechSynthesis;
  }

  // 预加载语音列表，避免首次 speak 时 voices 未加载导致声音不一致
  function preloadVoices() {
    try {
      var synth = getSpeechSynthesis();
      cachedVoices = synth.getVoices();
      if (cachedVoices.length > 0) return;
      // 如果 voices 还没加载完，监听 voiceschanged 事件
      synth.addEventListener('voiceschanged', function() {
        cachedVoices = synth.getVoices();
        console.log('[Speech] 语音列表已加载，共', cachedVoices.length, '个');
      }, { once: true });
    } catch (e) {
      // 静默失败
    }
  }
  preloadVoices();

  // --- STT: 语音识别 ---

  // 检测 STT 是否可用（优先检测 AudioRecorder，回退到 SpeechRecognition）
  var sttAvailable = null; // null = 未检测
  var sttDetectPromise = null;

  function detectSttAvailable() {
    if (sttAvailable !== null) return Promise.resolve(sttAvailable);
    if (sttDetectPromise) return sttDetectPromise;

    sttDetectPromise = new Promise(function(resolve) {
      // 优先使用 WebSocket 实时 ASR（最快、最自然的交互方式）
      if (window.AudioRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.WebSocket) {
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(function(stream) {
            stream.getTracks().forEach(function(t) { t.stop(); });
            sttAvailable = true;
            useRealtime = true;
            useAudioRecorder = false;
            console.log('[Speech] WebSocket 实时 ASR (DashScope Paraformer) 可用');
            resolve(true);
          })
          .catch(function(err) {
            console.warn('[Speech] getUserMedia 不可用:', err.message);
            detectNativeStt(resolve);
          });
      } else {
        detectNativeStt(resolve);
      }
    });
    return sttDetectPromise;
  }

  function detectNativeStt(resolve) {
    try {
      var r = getSpeechRecognition();
      r.continuous = false;
      r.interimResults = false;
      r.lang = 'zh-CN';

      var settled = false;
      var timer = setTimeout(function() {
        if (!settled) {
          settled = true;
          sttAvailable = false;
          console.warn('[Speech] SpeechRecognition 检测超时，判定为不可用');
          resolve(false);
        }
      }, 3000);

      r.onstart = function() {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          sttAvailable = true;
          useAudioRecorder = false;
          try { r.stop(); } catch(_) {}
          resolve(true);
        }
      };
      r.onerror = function(e) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          sttAvailable = false;
          console.warn('[Speech] SpeechRecognition 错误:', e.error);
          resolve(false);
        }
      };
      r.onend = function() {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          if (sttAvailable === null) {
            sttAvailable = false;
            console.warn('[Speech] SpeechRecognition onend 无 onstart，判定为不可用');
          }
          resolve(sttAvailable);
        }
      };
      r.start();
    } catch (err) {
      sttAvailable = false;
      sttDetectPromise = null;
      resolve(false);
    }
  }

  // AudioRecorder 模式：录音完成后自动重启
  function onAudioRecorderResult(text) {
    if (text && text.trim()) {
      onResultCallback(text.trim());
    }
    // 录音结束后，如果 shouldRestart 为 true，自动开始下一轮录音
    if (shouldRestart && status !== 'stopped') {
      setTimeout(function() {
        if (shouldRestart && status !== 'stopped') {
          startAudioRecording();
        }
      }, 300);
    } else {
      setStatus('idle');
    }
  }

  // 实时 ASR 模式回调
  function onRealtimeInterim(text) {
    if (text && text.trim()) {
      setStatus('listening');
      if (onInterimCallback) onInterimCallback(text.trim());
    }
  }

  function onRealtimeFinal(text) {
    if (text && text.trim()) {
      // 停止流式录音（等待 LLM 处理完再重启）
      shouldRestart = false;
      stopRealtimeRecording();
      setStatus('processing');
      onResultCallback(text.trim());
    }
  }

  function onRealtimeReady() {
    setStatus('listening');
  }

  function onRealtimeError(err) {
    console.error('[Speech] 实时 ASR 错误:', err);
    setStatus('idle');
    // 回退到 AudioRecorder 模式
    useRealtime = false;
    useAudioRecorder = true;
    if (shouldRestart) {
      setTimeout(function() { startAudioRecording(); }, 500);
    }
  }

  function startRealtimeRecording() {
    if (!window.AudioRecorder) return;
    window.AudioRecorder.startStreaming({
      onInterim: onRealtimeInterim,
      onFinal: onRealtimeFinal,
      onReady: onRealtimeReady,
      onError: onRealtimeError
    }).catch(function(err) {
      console.error('[Speech] 启动实时录音失败:', err);
      setStatus('idle');
      onRealtimeError(err);
    });
  }

  function stopRealtimeRecording() {
    if (window.AudioRecorder) {
      window.AudioRecorder.stopStreaming().catch(function() {});
    }
  }

  function onAudioRecorderStatusChange(newStatus) {
    if (newStatus === 'recording') {
      setStatus('listening');
    } else if (newStatus === 'processing') {
      setStatus('processing');
    } else if (newStatus === 'idle') {
      setStatus('idle');
    } else if (newStatus === 'error') {
      setStatus('idle');
    } else if (newStatus === 'no-audio') {
      // 麦克风没有实际音频输入，通知应用显示上传按钮
      setStatus('no-audio');
      if (onErrorCallback) {
        onErrorCallback(new Error('麦克风未检测到声音，当前环境可能不支持麦克风录音，请使用音频文件上传功能'));
      }
    }
  }

  function onAudioRecorderError(err) {
    console.error('[Speech] AudioRecorder 错误:', err);
    setStatus('idle');
    // 如果是麦克风无音频错误，触发错误回调让应用显示上传 UI
    if (err && err.message && err.message.indexOf('麦克风未检测到声音') !== -1) {
      if (onErrorCallback) onErrorCallback(err);
    }
  }

  function startAudioRecording() {
    if (!window.AudioRecorder) return;
    window.AudioRecorder.startRecording({
      onResult: onAudioRecorderResult,
      onStatusChange: onAudioRecorderStatusChange,
      onError: onAudioRecorderError
    }).catch(function(err) {
      console.error('[Speech] 启动录音失败:', err);
      setStatus('idle');
    });
  }

  function stopAudioRecording() {
    if (window.AudioRecorder) {
      window.AudioRecorder.stopRecording().catch(function() {});
    }
  }

  // 文件上传模式
  function uploadAudioFile(file, options) {
    options = options || {};
    if (options.onResult) onResultCallback = options.onResult;
    if (options.onInterim) onInterimCallback = options.onInterim;
    if (options.onStatusChange) onStatusChangeCallback = options.onStatusChange;

    if (!window.AudioRecorder) {
      onErrorCallback('AudioRecorder 模块未加载');
      return Promise.reject(new Error('AudioRecorder 模块未加载'));
    }

    return window.AudioRecorder.uploadAudioFile(file, {
      onResult: function(text) {
        if (text && text.trim()) {
          onResultCallback(text.trim());
        }
        setStatus('idle');
      },
      onStatusChange: function(newStatus) {
        if (newStatus === 'processing') {
          setStatus('processing');
        } else if (newStatus === 'idle') {
          setStatus('idle');
        } else if (newStatus === 'error') {
          setStatus('idle');
        }
      },
      onError: function(err) {
        console.error('[Speech] 文件上传错误:', err);
        setStatus('idle');
      }
    });
  }

  function startListening(options) {
    if (status === 'listening' || status === 'recording' || status === 'processing') return;

    options = options || {};
    if (options.onResult) onResultCallback = options.onResult;
    if (options.onInterim) onInterimCallback = options.onInterim;
    if (options.onStatusChange) onStatusChangeCallback = options.onStatusChange;

    // 优先使用 WebSocket 实时 ASR
    if (useRealtime && window.AudioRecorder) {
      shouldRestart = true;
      startRealtimeRecording();
      return;
    }

    // 使用 AudioRecorder 模式
    if (useAudioRecorder && window.AudioRecorder) {
      shouldRestart = true;
      startAudioRecording();
      return;
    }

    // 原生 SpeechRecognition 模式
    try {
      recognition = getSpeechRecognition();
    } catch (err) {
      console.error('语音识别初始化失败:', err);
      onStatusChangeCallback('error');
      return;
    }

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'zh-CN';
    shouldRestart = true; // 默认持续监听

    recognition.onstart = function() {
      setStatus('listening');
    };

    recognition.onresult = function(event) {
      var finalText = '';
      var interimText = '';

      for (var i = event.resultIndex; i < event.results.length; i++) {
        var result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      if (finalText) {
        onResultCallback(finalText);
        // 注意：不在这里改状态，让 handleUserSpeech 决定是否 stopListening
      }

      if (interimText) {
        onInterimCallback(interimText);
      }
    };

    recognition.onerror = function(event) {
      // no-speech 和 aborted 是正常情况，不是真正的错误
      if (event.error === 'no-speech') {
        console.warn('[Speech] 未检测到语音，继续监听...');
        shouldRestart = true;
      } else if (event.error === 'aborted') {
        console.warn('[Speech] 识别被中断');
        shouldRestart = true;
      } else if (event.error === 'not-allowed') {
        console.error('[Speech] 麦克风权限被拒绝');
        shouldRestart = false;
      } else {
        console.error('语音识别错误:', event.error);
      }
      setStatus('idle');
    };

    recognition.onend = function() {
      // shouldRestart 为 true 时自动重启（持续监听模式）
      if (shouldRestart && status !== 'stopped') {
        try {
          recognition.start();
        } catch (e) {
          console.error('[Speech] 重启识别失败:', e.message);
          setStatus('idle');
        }
      } else {
        setStatus('idle');
      }
    };

    try {
      recognition.start();
    } catch (err) {
      console.error('[Speech] recognition.start() 失败:', err.message);
      onStatusChangeCallback('error');
      shouldRestart = false;
    }
  }

  function stopListening() {
    shouldRestart = false; // 阻止自动重启
    if (useRealtime && window.AudioRecorder) {
      stopRealtimeRecording();
    }
    if (useAudioRecorder && window.AudioRecorder) {
      stopAudioRecording();
    }
    if (recognition) {
      try {
        recognition.stop();
      } catch (e) {
        // 忽略停止时的错误
      }
      recognition = null;
    }
    setStatus('idle');
  }

  // --- TTS: 语音合成 ---

  function speak(text) {
    if (isSpeaking) {
      stopSpeaking();
    }

    try {
      synthesis = getSpeechSynthesis();
    } catch (err) {
      console.error('语音合成初始化失败:', err);
      return;
    }

    // 清理文本中的括号和emoji，让语音更自然
    var cleanText = text
      .replace(/\（[^\）]*\）/g, '')
      .replace(/\([^\)]*\)/g, '')
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
      .replace(/[\u{2600}-\u{26FF}]/gu, '')
      .replace(/[\u{2700}-\u{27BF}]/gu, '')
      .trim();

    // 如果清理后为空，就不播报
    if (!cleanText) {
      onSpeakEndCallback();
      return;
    }

    var utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.05;
    utterance.pitch = 1.08;

    // 尝试选择更柔和的语音（使用缓存列表，避免首次 speak 时 voices 未加载）
    var voices = cachedVoices.length > 0 ? cachedVoices : synthesis.getVoices();
    var preferredVoice = voices.find(function(v) {
      return v.lang === 'zh-CN' && (v.name.indexOf('Xiaoxiao') !== -1 || v.name.indexOf('Xiaoyi') !== -1 || v.name.indexOf('female') !== -1);
    });
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.onstart = function() {
      isSpeaking = true;
      setStatus('speaking');
      onSpeakStartCallback();
    };

    utterance.onend = function() {
      isSpeaking = false;
      setStatus('idle');
      onSpeakEndCallback();
    };

    utterance.onerror = function(event) {
      console.error('语音合成错误:', event.error);
      isSpeaking = false;
      setStatus('idle');
      // 关键修复：TTS 出错时也必须触发 onSpeakEnd，否则 STT 监听无法重启
      onSpeakEndCallback();
    };

    // 安全兜底：如果 onend 和 onerror 都未触发，6秒后强制重启
    var safetyTimer = setTimeout(function() {
      if (isSpeaking) {
        console.warn('[Speech] TTS 超时，强制结束');
        isSpeaking = false;
        setStatus('idle');
        onSpeakEndCallback();
      }
    }, 6000);

    var origOnEnd = utterance.onend;
    utterance.onend = function(event) {
      clearTimeout(safetyTimer);
      isSpeaking = false;
      setStatus('idle');
      onSpeakEndCallback();
    };

    var origOnError = utterance.onerror;
    utterance.onerror = function(event) {
      clearTimeout(safetyTimer);
      console.error('语音合成错误:', event.error);
      isSpeaking = false;
      setStatus('idle');
      onSpeakEndCallback();
    };

    synthesis.speak(utterance);
  }

  function stopSpeaking() {
    if (synthesis) {
      synthesis.cancel();
    }
    isSpeaking = false;
    setStatus('idle');
  }

  // --- 设置方法 ---

  function setRate(rate) {
    speechRate = rate;
  }

  function setPitch(pitch) {
    speechPitch = pitch;
  }

  function getStatus() {
    return status;
  }

  // 导出到全局
  window.SpeechModule = {
    startListening: startListening,
    stopListening: stopListening,
    speak: speak,
    stopSpeaking: stopSpeaking,
    setRate: setRate,
    setPitch: setPitch,
    getStatus: getStatus,
    detectSttAvailable: detectSttAvailable,
    uploadAudioFile: uploadAudioFile,
    // 可设置的回调
    set onResult(fn) { onResultCallback = fn || function() {}; },
    set onInterim(fn) { onInterimCallback = fn || function() {}; },
    set onStatusChange(fn) { onStatusChangeCallback = fn || function() {}; },
    set onSpeakEnd(fn) { onSpeakEndCallback = fn || function() {}; },
    set onSpeakStart(fn) { onSpeakStartCallback = fn || function() {}; },
    set onError(fn) { onErrorCallback = fn || function() {}; }
  };

})();