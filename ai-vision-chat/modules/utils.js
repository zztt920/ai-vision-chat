(function() {
  'use strict';

  // 工具函数模块
  const Utils = {
    // 生成唯一ID
    generateId() {
      return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    },
    
    // 格式化时间戳
    formatTime(timestamp) {
      const d = new Date(timestamp);
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    },
    
    // 简单的场景变化检测（通过像素比较）
    detectSceneChange(currentCanvas, previousImageData, threshold = 0.05) {
      if (!previousImageData) return true;
      const ctx = currentCanvas.getContext('2d');
      const data = ctx.getImageData(0, 0, currentCanvas.width, currentCanvas.height).data;
      let diff = 0; const total = data.length / 4;
      for (let i = 0; i < data.length; i += 16) {
        const idx = i / 4;
        const dr = Math.abs(data[i] - previousImageData[idx * 4]);
        const dg = Math.abs(data[i + 1] - previousImageData[idx * 4 + 1]);
        const db = Math.abs(data[i + 2] - previousImageData[idx * 4 + 2]);
        if (dr > 30 || dg > 30 || db > 30) diff++;
      }
      return diff / total > threshold;
    },

    // 压缩图片
    compressImage(canvas, maxWidth = 640, quality = 0.6) {
      const c = document.createElement('canvas');
      const scale = Math.min(maxWidth / canvas.width, 1);
      c.width = canvas.width * scale;
      c.height = canvas.height * scale;
      const ctx = c.getContext('2d');
      ctx.drawImage(canvas, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', quality);
    },

    // 深拷贝
    deepClone(obj) {
      return JSON.parse(JSON.stringify(obj));
    }
  };

  // 导出到全局
  window.Utils = Utils;

})();