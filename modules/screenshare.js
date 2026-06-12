/**
 * 屏幕共享模块 ScreenShareModule
 * 使用 getDisplayMedia 捕获屏幕/窗口内容
 * 与 CameraModule 接口保持一致，可互换使用
 */
(function() {
  'use strict';

  var status = 'stopped';
  var stream = null;
  var videoElement = null;
  var placeholderElement = null;
  var canvasElement = null;
  var frameTimer = null;
  var previousImageData = null;

  // 回调函数
  var onFrameCallback = function() {};
  var onStatusChangeCallback = function() {};
  var onStopCallback = function() {};  // 用户通过系统UI停止共享时的回调

  // 帧率控制：每秒2帧
  var FRAME_INTERVAL = 500;

  // 内部状态更新
  function setStatus(newStatus) {
    status = newStatus;
    onStatusChangeCallback(status);
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
      var compressed = Utils.compressImage(canvasElement, 640, 0.6);
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

  // 释放流
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

  // 创建内部 canvas
  function ensureCanvas() {
    if (!canvasElement) {
      canvasElement = document.createElement('canvas');
      canvasElement.style.display = 'none';
      document.body.appendChild(canvasElement);
    }
  }

  // --- 公开方法 ---

  // 启动屏幕共享
  function start(options) {
    if (status === 'active' || status === 'initializing') {
      return Promise.reject(new Error('屏幕共享已在运行中'));
    }

    options = options || {};
    
    if (options.video) videoElement = options.video;
    if (options.placeholder) placeholderElement = options.placeholder;
    if (options.onFrame) onFrameCallback = options.onFrame;
    if (options.onStatusChange) onStatusChangeCallback = options.onStatusChange;
    if (options.onStop) onStopCallback = options.onStop;

    ensureCanvas();
    setStatus('initializing');

    // getDisplayMedia 会弹出系统选择对话框
    var constraints = {
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 5 }
      },
      audio: false
    };

    // 如果传入 preferCurrentTab，优先捕获当前标签页
    if (options.preferCurrentTab) {
      // @ts-ignore - experimental API
      constraints.video.displaySurface = 'browser';
    }

    return navigator.mediaDevices.getDisplayMedia(constraints)
      .then(function(mediaStream) {
        stream = mediaStream;

        if (!videoElement) {
          throw new Error('视频元素未设置');
        }

        videoElement.srcObject = stream;
        return videoElement.play();
      })
      .then(function() {
        // 隐藏占位，显示视频
        if (placeholderElement) placeholderElement.style.display = 'none';
        if (videoElement) videoElement.classList.add('active');

        // 监听屏幕共享停止事件（用户点击浏览器"停止共享"按钮）
        stream.getVideoTracks()[0].addEventListener('ended', function() {
          console.log('[ScreenShare] 用户停止了屏幕共享');
          stop();
          onStopCallback();
        });

        setStatus('active');
        startFrameLoop();
        return true;
      })
      .catch(function(err) {
        releaseStream();
        setStatus('error');
        if (placeholderElement) placeholderElement.style.display = 'flex';
        if (videoElement) videoElement.classList.remove('active');
        throw err;
      });
  }

  // 停止屏幕共享
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

  // 暂停帧采集（保持共享运行）
  function pause() {
    if (status === 'active') {
      stopFrameLoop();
      setStatus('paused');
    }
  }

  // 恢复帧采集
  function resume() {
    if (status === 'paused') {
      setStatus('active');
      startFrameLoop();
    }
  }

  function getStatus() {
    return status;
  }

  // 导出到全局
  window.ScreenShareModule = {
    start: start,
    stop: stop,
    pause: pause,
    resume: resume,
    getStatus: getStatus,
    set onFrame(fn) { onFrameCallback = fn; },
    set onStatusChange(fn) { onStatusChangeCallback = fn; },
    set onStop(fn) { onStopCallback = fn; }
  };

})();