(function() {
  'use strict';

  var status = 'idle';
  var recognition = null;
  var synthesis = null;
  var speechRate = 1.0;
  var speechPitch = 1.0;
  var isSpeaking = false;

  // 回调函数
  var onResultCallback = function() {};
  var onInterimCallback = function() {};
  var onStatusChangeCallback = function() {};
  var onSpeakEndCallback = function() {};

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

  // --- STT: 语音识别 ---

  function startListening(options) {
    if (status === 'listening') return;

    options = options || {};
    if (options.onResult) onResultCallback = options.onResult;
    if (options.onInterim) onInterimCallback = options.onInterim;
    if (options.onStatusChange) onStatusChangeCallback = options.onStatusChange;

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
        setStatus('processing');
        onResultCallback(finalText);
        // 处理完成后恢复监听状态
        setStatus('listening');
      }

      if (interimText) {
        onInterimCallback(interimText);
      }
    };

    recognition.onerror = function(event) {
      console.error('语音识别错误:', event.error);
      setStatus('idle');
    };

    recognition.onend = function() {
      // 如果状态仍然是 listening，尝试重启
      if (status === 'listening') {
        try {
          recognition.start();
        } catch (e) {
          setStatus('idle');
        }
      } else {
        setStatus('idle');
      }
    };

    recognition.start();
  }

  function stopListening() {
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

    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = speechRate;
    utterance.pitch = speechPitch;

    utterance.onstart = function() {
      isSpeaking = true;
      setStatus('speaking');
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
    getStatus: getStatus
  };

})();