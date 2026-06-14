(function() {
  'use strict';

  var status = 'stopped';
  var stream = null;
  var videoElement = null;
  var placeholderElement = null;
  var canvasElement = null;
  var frameTimer = null;
  var currentDeviceId = null;
  var devices = [];
  var previousImageData = null;
  var lastErrorMessage = '';

  // 默认回调
  var onFrameCallback = function() {};
  var onStatusChangeCallback = function() {};

  var FRAME_INTERVAL = 500;

  // 检测 getUserMedia 是否真正可用（Electron BrowserView 中会挂起）
  var gumAvailable = null; // null = 未检测, true = 可用, false = 不可用

  function detectGumAvailable() {
    if (gumAvailable !== null) return Promise.resolve(gumAvailable);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      gumAvailable = false;
      return Promise.resolve(false);
    }
    return new Promise(function(resolve) {
      var settled = false;
      var timer = setTimeout(function() {
        if (!settled) {
          settled = true;
          gumAvailable = false;
          console.warn('[Camera] getUserMedia 检测超时，判定为不可用（可能是 Electron 内嵌浏览器）');
          resolve(false);
        }
      }, 2000);
      navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(function(s) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            s.getTracks().forEach(function(t) { t.stop(); });
            gumAvailable = true;
            resolve(true);
          }
        })
        .catch(function() {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            gumAvailable = false;
            resolve(false);
          }
        });
    });
  }

  function setStatus(newStatus) {
    status = newStatus;
    onStatusChangeCallback(status);
  }

  function getCameraDevices() {
    return navigator.mediaDevices.enumerateDevices()
      .then(function(allDevices) {
        devices = allDevices.filter(function(d) { return d.kind === 'videoinput'; });
        return devices;
      });
  }

  // 多组 constraints 尝试，兼容不同设备和浏览器
  // ★ 第一个 preset 同时请求音频，确保麦克风权限和摄像头一起被授予 ★
  var CONSTRAINT_PRESETS = [
    // 同时请求视频+音频（让浏览器一次性授权摄像头和麦克风）
    { video: true, audio: true },
    // 如果用户拒绝音频，回退到纯视频
    { video: true, audio: false },
    // 有具体宽高
    { video: { width: 640, height: 480 }, audio: false },
    // 带 frameRate
    { video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 10 } }, audio: false },
    // 降分辨率试试
    { video: { width: { ideal: 320 }, height: { ideal: 240 } }, audio: false }
  ];

  function promiseTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function(_, reject) {
        setTimeout(function() {
          reject(new Error('超时（' + ms + 'ms）'));
        }, ms);
      })
    ]);
  }

  function tryGetUserMedia(presets, index) {
    if (index >= presets.length) {
      return Promise.reject(new Error(lastErrorMessage || '无法获取摄像头权限'));
    }

    var constraints = presets[index];

    // 如果指定了 deviceId，叠加进去
    if (currentDeviceId && index === 0) {
      constraints = JSON.parse(JSON.stringify(constraints));
      if (typeof constraints.video === 'object') {
        constraints.video.deviceId = { exact: currentDeviceId };
      } else {
        constraints.video = { deviceId: { exact: currentDeviceId } };
      }
    }

    // 每个 constraints 尝试最多 3 秒超时
    return promiseTimeout(navigator.mediaDevices.getUserMedia(constraints), 3000)
      .catch(function(err) {
        lastErrorMessage = err.message || err.name || '未知错误';
        console.warn('[Camera] constraints #' + index + ' 失败:', err.name, err.message);
        // 继续下一个
        return tryGetUserMedia(presets, index + 1);
      });
  }

  // 初始化摄像头
  function initCamera(deviceId) {
    setStatus('initializing');
    currentDeviceId = deviceId || currentDeviceId;

    return tryGetUserMedia(CONSTRAINT_PRESETS, 0)
      .then(function(mediaStream) {
        stream = mediaStream;

        if (videoElement) {
          videoElement.srcObject = stream;
          return videoElement.play();
        }
        throw new Error('视频元素未设置');
      })
      .then(function() {
        if (stream.getVideoTracks().length > 0) {
          var track = stream.getVideoTracks()[0];
          var settings = track.getSettings();
          currentDeviceId = settings.deviceId || deviceId || currentDeviceId;
        }

        if (placeholderElement) placeholderElement.style.display = 'none';
        if (videoElement) videoElement.classList.add('active');

        setStatus('active');
        return true;
      })
      .catch(function(err) {
        setStatus('error');
        if (placeholderElement) {
          placeholderElement.style.display = 'flex';
          // 把错误信息放到 overlay 里
          var msgEl = placeholderElement.querySelector('.overlay-msg');
          if (msgEl) {
            msgEl.textContent = err.name === 'NotAllowedError'
              ? '❌ 摄像头被浏览器阻止\n请在地址栏左侧点击🔒 允许摄像头权限'
              : err.name === 'NotFoundError'
              ? '❌ 未检测到摄像头设备'
              : err.name === 'NotReadableError'
              ? '❌ 摄像头被其他应用占用'
              : '❌ ' + (err.message || '摄像头启动失败');
            msgEl.style.whiteSpace = 'pre-line';
          }
        }
        if (videoElement) videoElement.classList.remove('active');
        throw err;
      });
  }

  function captureFrame() {
    if (!videoElement || !canvasElement || status !== 'active') return;

    var vw = videoElement.videoWidth;
    var vh = videoElement.videoHeight;
    if (vw === 0 || vh === 0) return;

    canvasElement.width = vw;
    canvasElement.height = vh;
    var ctx = canvasElement.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, vw, vh);

    var sceneChanged = Utils.detectSceneChange(canvasElement, previousImageData);
    previousImageData = ctx.getImageData(0, 0, vw, vh).data;

    if (sceneChanged) {
      var compressed = Utils.compressImage(canvasElement, 320, 0.6);
      onFrameCallback(compressed);
    }
  }

  function startFrameLoop() {
    stopFrameLoop();
    frameTimer = setInterval(captureFrame, FRAME_INTERVAL);
  }

  function stopFrameLoop() {
    if (frameTimer) {
      clearInterval(frameTimer);
      frameTimer = null;
    }
  }

  function releaseStream() {
    if (stream) {
      stream.getTracks().forEach(function(track) { track.stop(); });
      stream = null;
    }
    if (videoElement) {
      videoElement.srcObject = null;
    }
    previousImageData = null;
    lastErrorMessage = '';
  }

  function ensureCanvas() {
    if (!canvasElement) {
      canvasElement = document.createElement('canvas');
      canvasElement.style.display = 'none';
      document.body.appendChild(canvasElement);
    }
  }

  // --- 公开方法 ---

  function start(options) {
    // 即使状态是 error 也允许重试
    if (status === 'active' || status === 'initializing') {
      return Promise.resolve();
    }

    // 从 error 恢复时清理旧资源
    if (status === 'error') {
      releaseStream();
    }

    options = options || {};
    
    if (options.video) videoElement = options.video;
    if (options.placeholder) placeholderElement = options.placeholder;
    if (options.onFrame) onFrameCallback = options.onFrame;
    if (options.onStatusChange) onStatusChangeCallback = options.onStatusChange;
    
    ensureCanvas();

    // 先检测 getUserMedia 是否真正可用
    return detectGumAvailable().then(function(available) {
      if (!available) {
        var err = new Error('当前环境不支持摄像头（内嵌浏览器限制），请用外部浏览器打开');
        err.name = 'EnvironmentError';
        setStatus('error');
        if (placeholderElement) {
          placeholderElement.style.display = 'flex';
          var msgEl = placeholderElement.querySelector('.overlay-msg');
          if (msgEl) {
            msgEl.textContent = '⚠️ 内嵌浏览器不支持摄像头\n请复制地址到 Chrome/Edge 中打开以使用摄像头';
            msgEl.style.whiteSpace = 'pre-line';
          }
        }
        throw err;
      }
      return initCamera(options.deviceId);
    })
      .then(function() {
        startFrameLoop();
      })
      .catch(function(err) {
        console.error('摄像头启动失败:', err.name, err.message);
        throw err;
      });
  }

  function stop() {
    stopFrameLoop();
    releaseStream();
    
    if (videoElement) {
      videoElement.classList.remove('active');
    }
    if (placeholderElement) {
      placeholderElement.style.display = 'flex';
      // 清除错误信息
      var msgEl = placeholderElement.querySelector('.overlay-msg');
      if (msgEl) msgEl.textContent = '';
    }
    if (canvasElement && canvasElement.parentNode) {
      canvasElement.parentNode.removeChild(canvasElement);
      canvasElement = null;
    }
    
    setStatus('stopped');
  }

  function pause() {
    if (status === 'active') {
      stopFrameLoop();
      setStatus('paused');
    }
  }

  function resume() {
    if (status === 'paused') {
      setStatus('active');
      startFrameLoop();
    }
  }

  function switchCamera() {
    if (status === 'initializing') {
      console.warn('[Camera] 摄像头正在初始化中，请稍后再试');
      return Promise.resolve(false);
    }

    return getCameraDevices()
      .then(function(cameraDevices) {
        if (cameraDevices.length < 2) {
          throw new Error('没有可用的其他摄像头');
        }
        
        var currentIndex = -1;
        for (var i = 0; i < cameraDevices.length; i++) {
          if (cameraDevices[i].deviceId === currentDeviceId) {
            currentIndex = i;
            break;
          }
        }
        var nextIndex = (currentIndex + 1) % cameraDevices.length;
        var nextDeviceId = cameraDevices[nextIndex].deviceId;

        stopFrameLoop();
        releaseStream();

        return initCamera(nextDeviceId);
      })
      .then(function() {
        startFrameLoop();
        return true;
      })
      .catch(function(err) {
        setStatus('error');
        console.error('切换摄像头失败:', err);
        throw err;
      });
  }

  function getStatus() {
    return status;
  }

  function getLastError() {
    return lastErrorMessage;
  }

  window.CameraModule = {
    start: start,
    stop: stop,
    pause: pause,
    resume: resume,
    switchCamera: switchCamera,
    getStatus: getStatus,
    getLastError: getLastError,
    set onFrame(fn) { onFrameCallback = fn; },
    set onStatusChange(fn) { onStatusChangeCallback = fn; }
  };

})();