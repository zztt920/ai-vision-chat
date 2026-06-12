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

  // 默认回调（空函数）
  var onFrameCallback = function() {};
  var onStatusChangeCallback = function() {};

  // 最大帧率：每秒2帧
  var FRAME_INTERVAL = 500;

  // 内部状态更新
  function setStatus(newStatus) {
    status = newStatus;
    onStatusChangeCallback(status);
  }

  // 获取所有摄像头设备
  function getCameraDevices() {
    return navigator.mediaDevices.enumerateDevices()
      .then(function(allDevices) {
        devices = allDevices.filter(function(d) { return d.kind === 'videoinput'; });
        return devices;
      });
  }

  // 初始化摄像头
  function initCamera(deviceId) {
    setStatus('initializing');

    var constraints = {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 10 }
      },
      audio: false
    };

    if (deviceId) {
      constraints.video.deviceId = { exact: deviceId };
    }

    return navigator.mediaDevices.getUserMedia(constraints)
      .then(function(mediaStream) {
        stream = mediaStream;

        if (videoElement) {
          videoElement.srcObject = stream;
          return videoElement.play();
        }
        throw new Error('视频元素未设置');
      })
      .then(function() {
        // 获取当前设备ID
        if (stream.getVideoTracks().length > 0) {
          var track = stream.getVideoTracks()[0];
          var settings = track.getSettings();
          currentDeviceId = settings.deviceId || deviceId;
        }

        // 隐藏占位，显示视频
        if (placeholderElement) placeholderElement.style.display = 'none';
        if (videoElement) videoElement.classList.add('active');

        setStatus('active');
        return true;
      })
      .catch(function(err) {
        setStatus('error');
        if (placeholderElement) placeholderElement.style.display = 'flex';
        if (videoElement) videoElement.classList.remove('active');
        throw err;
      });
  }

  // 捕获并处理一帧
  function captureFrame() {
    if (!videoElement || !canvasElement || status !== 'active') return;

    var vw = videoElement.videoWidth;
    var vh = videoElement.videoHeight;
    if (vw === 0 || vh === 0) return;

    canvasElement.width = vw;
    canvasElement.height = vh;
    var ctx = canvasElement.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, vw, vh);

    // 场景变化检测
    var sceneChanged = Utils.detectSceneChange(canvasElement, previousImageData);
    previousImageData = ctx.getImageData(0, 0, vw, vh).data;

    if (sceneChanged) {
      var compressed = Utils.compressImage(canvasElement, 320, 0.6);
      onFrameCallback(compressed);
    }
  }

  // 帧捕获循环
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

  // 释放摄像头资源
  function releaseStream() {
    if (stream) {
      stream.getTracks().forEach(function(track) { track.stop(); });
      stream = null;
    }
    if (videoElement) {
      videoElement.srcObject = null;
    }
    previousImageData = null;
  }

  // 创建内部 canvas（用于帧捕获）
  function ensureCanvas() {
    if (!canvasElement) {
      canvasElement = document.createElement('canvas');
      canvasElement.style.display = 'none';
      document.body.appendChild(canvasElement);
    }
  }

  // --- 公开方法 ---

  // 启动摄像头
  function start(options) {
    if (status === 'active' || status === 'initializing') {
      return Promise.resolve();
    }

    options = options || {};
    
    // 使用传入的 video 元素
    if (options.video) videoElement = options.video;
    if (options.placeholder) placeholderElement = options.placeholder;
    if (options.onFrame) onFrameCallback = options.onFrame;
    if (options.onStatusChange) onStatusChangeCallback = options.onStatusChange;
    
    ensureCanvas();

    return initCamera(options.deviceId)
      .then(function() {
        startFrameLoop();
      })
      .catch(function(err) {
        console.error('摄像头启动失败:', err);
        throw err;
      });
  }

  // 停止摄像头
  function stop() {
    stopFrameLoop();
    releaseStream();
    
    if (videoElement) {
      videoElement.classList.remove('active');
    }
    if (placeholderElement) {
      placeholderElement.style.display = 'flex';
    }
    if (canvasElement && canvasElement.parentNode) {
      canvasElement.parentNode.removeChild(canvasElement);
      canvasElement = null;
    }
    
    setStatus('stopped');
  }

  // 暂停帧捕获（保持摄像头运行）
  function pause() {
    if (status === 'active') {
      stopFrameLoop();
      setStatus('paused');
    }
  }

  // 恢复帧捕获
  function resume() {
    if (status === 'paused') {
      setStatus('active');
      startFrameLoop();
    }
  }

  // 切换摄像头
  function switchCamera() {
    if (status === 'initializing') return Promise.reject(new Error('正在初始化中'));

    return getCameraDevices()
      .then(function(cameraDevices) {
        if (cameraDevices.length < 2) {
          throw new Error('没有可用的其他摄像头设备');
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

  // 导出到全局
  window.CameraModule = {
    start: start,
    stop: stop,
    pause: pause,
    resume: resume,
    switchCamera: switchCamera,
    getStatus: getStatus,
    // 暴露给 app.js 设置回调
    set onFrame(fn) { onFrameCallback = fn; },
    set onStatusChange(fn) { onStatusChangeCallback = fn; }
  };

})();