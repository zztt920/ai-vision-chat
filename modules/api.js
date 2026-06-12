(function() {
  'use strict';

  var serverUrl = 'http://localhost:3000';
  var maxRetries = 2;

  // 设置服务器地址
  function setServerUrl(url) {
    serverUrl = url;
  }

  // 发送聊天请求
  function sendChat(text, imageBase64, history) {
    // 去除 data: URL 前缀，Gemini API 只需要纯 base64 数据
    var cleanImage = null;
    if (imageBase64) {
      var commaIdx = imageBase64.indexOf(',');
      cleanImage = commaIdx >= 0 ? imageBase64.substring(commaIdx + 1) : imageBase64;
    }
    var payload = {
      text: text || '',
      image: cleanImage,
      history: history || []
    };

    return doFetch(payload, 0);
  }

  // 实际的 fetch 请求（带重试逻辑）
  function doFetch(payload, attempt) {
    var url = serverUrl + '/api/chat';

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ': ' + response.statusText);
      }
      return response.json();
    })
    .then(function(data) {
      if (data.error) {
        throw new Error(data.error);
      }
      return data.reply || data.text || data.message || '';
    })
    .catch(function(err) {
      console.error('API 请求失败 (尝试 ' + (attempt + 1) + '/' + (maxRetries + 1) + '):', err);

      if (attempt < maxRetries) {
        // 延迟后重试（指数退避）
        var delay = Math.pow(2, attempt) * 500;
        return new Promise(function(resolve) {
          setTimeout(function() {
            resolve(doFetch(payload, attempt + 1));
          }, delay);
        });
      }

      throw err;
    });
  }

  // 导出到全局
  window.APIClient = {
    sendChat: sendChat,
    setServerUrl: setServerUrl
  };

})();