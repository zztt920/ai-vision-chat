(function() {
  'use strict';

  // 优先使用同源相对路径
  var serverUrl = (location.port === '3000' || location.port === '')
    ? ''
    : 'http://' + (location.hostname || 'localhost') + ':3000';

  function setServerUrl(url) {
    serverUrl = url;
  }

  // 流式发送聊天请求（SSE）
  // onToken: 每收到一个 token 调用
  // onDone: 流式完成时调用（参数为完整文本）
  // onError: 出错时调用
  function sendChatStream(text, imageBase64, history, callbacks, memoryContext) {
    var cleanImage = null;
    if (imageBase64) {
      var commaIdx = imageBase64.indexOf(',');
      cleanImage = commaIdx >= 0 ? imageBase64.substring(commaIdx + 1) : imageBase64;
    }
    var payload = {
      text: text || '',
      image: cleanImage,
      history: history || [],
      memoryContext: memoryContext || ''
    };

    var onToken = callbacks.onToken || function() {};
    var onDone = callbacks.onDone || function() {};
    var onError = callbacks.onError || function() {};

    var url = serverUrl + '/api/chat';

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ': ' + response.statusText);
      }

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var fullText = '';
      var buffer = '';

      function pump() {
        return reader.read().then(function(result) {
          if (result.done) {
            if (fullText) onDone(fullText);
            return;
          }

          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line.startsWith('data: ')) continue;
            var data = line.slice(6);

            try {
              var parsed = JSON.parse(data);
              if (parsed.text) {
                fullText += parsed.text;
                onToken(parsed.text, fullText);
              }
              if (parsed.done) {
                onDone(fullText);
                return;
              }
              if (parsed.error) {
                onError(new Error(parsed.error));
                return;
              }
            } catch (e) {
              // 跳过非 JSON 行
            }
          }

          return pump();
        });
      }

      return pump();
    })
    .catch(function(err) {
      console.error('流式请求失败:', err);
      onError(err);
      throw err;
    });
  }

  // 同步发送（兼容旧接口，内部使用流式）
  function sendChat(text, imageBase64, history) {
    return new Promise(function(resolve, reject) {
      sendChatStream(text, imageBase64, history, {
        onDone: function(fullText) {
          resolve(fullText);
        },
        onError: function(err) {
          reject(err);
        }
      });
    });
  }

  window.APIClient = {
    sendChat: sendChat,
    sendChatStream: sendChatStream,
    setServerUrl: setServerUrl
  };

})();