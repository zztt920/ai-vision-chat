/**
 * AI 视讯助手 - 主应用逻辑
 * 协调摄像头、语音、API、对话各模块
 */
(function() {
  'use strict';

  const App = {
    // 配置
    config: {
      frameInterval: 800,     // 毫秒，约 1.25 fps
      idleFramePause: true,    // 空闲时暂停帧采集
      maxHistoryBeforeCompress: 20
    },

    // 状态
    state: {
      isProcessing: false,
      lastFrame: null,
      lastFrameData: null,
      frameCount: 0,
      idleTimer: null,
      isIdle: true
    },

    // DOM 缓存
    els: {},

    // 初始化
    async init() {
      this.cacheElements();
      this.bindEvents();
      this.setupModules();
      this.updateStatusBar('idle', '点击「开始对话」启动摄像头和麦克风');
      console.log('[App] 初始化完成');
    },

    // 缓存 DOM
    cacheElements() {
      this.els = {
        video: document.getElementById('camera-video'),
        placeholder: document.getElementById('camera-placeholder'),
        cameraBadge: document.getElementById('camera-badge'),
        camStatus: document.getElementById('cam-status'),
        micStatus: document.getElementById('mic-status'),
        aiStatus: document.getElementById('ai-status'),
        chatMessages: document.getElementById('chat-messages'),
        chatInput: document.getElementById('chat-input'),
        sendBtn: document.getElementById('btn-send'),
        startBtn: document.getElementById('btn-start'),
        stopBtn: document.getElementById('btn-stop'),
        clearBtn: document.getElementById('btn-clear'),
        statusDot: document.getElementById('status-dot'),
        statusText: document.getElementById('status-text'),
        voiceWave: document.getElementById('voice-wave'),
        pauseCamBtn: document.getElementById('btn-pause-cam'),
        switchCamBtn: document.getElementById('btn-switch-cam'),
        interimText: document.getElementById('interim-text')
      };
    },

    // 绑定事件
    bindEvents() {
      this.els.startBtn.addEventListener('click', () => this.startSession());
      this.els.stopBtn.addEventListener('click', () => this.stopSession());
      this.els.clearBtn.addEventListener('click', () => this.clearChat());
      this.els.sendBtn.addEventListener('click', () => this.sendTextMessage());
      this.els.pauseCamBtn.addEventListener('click', () => this.toggleCameraPause());

      if (this.els.switchCamBtn) {
        this.els.switchCamBtn.addEventListener('click', () => {
          if (window.CameraModule) CameraModule.switchCamera();
        });
      }

      // 回车发送（Shift+Enter 换行）
      this.els.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendTextMessage();
        }
      });

      // 自动调整输入框高度
      this.els.chatInput.addEventListener('input', () => {
        this.els.chatInput.style.height = 'auto';
        this.els.chatInput.style.height = Math.min(this.els.chatInput.scrollHeight, 120) + 'px';
      });
    },

    // 配置模块回调
    setupModules() {
      // === Camera Module ===
      if (window.CameraModule) {
        CameraModule.onFrame = (base64) => {
          this.state.lastFrame = base64;
          this.state.frameCount++;
          if (this.els.cameraBadge) {
            this.els.cameraBadge.textContent = `● REC 帧: ${this.state.frameCount}`;
          }
        };

        CameraModule.onStatusChange = (status) => {
          const statusMap = {
            'initializing': ['正在初始化摄像头...', 'inactive'],
            'active': ['摄像头已开启', 'active'],
            'paused': ['摄像头已暂停', 'inactive'],
            'error': ['摄像头出错', 'error'],
            'stopped': ['摄像头已关闭', 'inactive']
          };
          const [text, cls] = statusMap[status] || ['未知状态', 'inactive'];
          this.updateStatusItem(this.els.camStatus, text, cls);
        };
      }

      // === Speech Module ===
      if (window.SpeechModule) {
        SpeechModule.onResult = (text) => {
          if (text.trim()) {
            this.handleUserSpeech(text.trim());
          }
        };

        SpeechModule.onInterim = (text) => {
          if (this.els.interimText) {
            this.els.interimText.textContent = text || '';
          }
          // 有语音输入时停止空闲
          if (text) {
            this.state.isIdle = false;
            this.resetIdleTimer();
          }
        };

        SpeechModule.onStatusChange = (status) => {
          const statusMap = {
            'idle': ['语音待命', 'inactive'],
            'listening': ['聆听中...', 'active'],
            'processing': ['处理中...', 'active'],
            'speaking': ['AI 说话中', 'active']
          };
          const [text, cls] = statusMap[status] || ['', 'inactive'];
          this.updateStatusItem(this.els.micStatus, text, cls);
          
          // 语音波形动画
          const wave = this.els.voiceWave;
          if (wave) {
            wave.style.display = status === 'listening' ? 'flex' : 'none';
          }
          
          // 更新状态栏
          if (status === 'listening') {
            this.updateStatusBar('listening', '🎤 正在聆听...');
          } else if (status === 'speaking') {
            this.updateStatusBar('speaking', '🔊 AI 正在回复...');
          } else if (status === 'processing') {
            this.updateStatusBar('processing', '🧠 AI 思考中...');
          }
        };

        SpeechModule.onSpeakEnd = () => {
          // TTS 结束后，如果仍在运行则恢复聆听
          if (this._sessionActive) {
            setTimeout(() => {
              SpeechModule.startListening();
            }, 300);
          }
        };
      }

      // === Chat Module ===
      if (window.ChatModule) {
        ChatModule.onMessage = (msg) => {
          this.renderMessage(msg);
        };
      }

      // === API Client ===
      if (window.APIClient) {
        // 使用当前页面 host（或默认 localhost:3000）
        const serverUrl = localStorage.getItem('ai-vision-server') || 'http://localhost:3000';
        APIClient.setServerUrl(serverUrl);
      }
    },

    // 开始会话
    async startSession() {
      this._sessionActive = true;
      this.els.startBtn.disabled = true;
      this.els.startBtn.textContent = '启动中...';

      try {
        // 启动摄像头
        if (window.CameraModule) {
          await CameraModule.start({
            video: this.els.video,
            placeholder: this.els.placeholder,
            width: 640,
            height: 480
          });
        }

        // 启动语音识别
        if (window.SpeechModule) {
          SpeechModule.startListening();
          this.els.micStatus.textContent = '聆听中...';
        }

        // 更新UI
        this.els.startBtn.style.display = 'none';
        this.els.stopBtn.style.display = 'inline-flex';
        this.els.pauseCamBtn.disabled = false;

        this.updateStatusBar('listening', '🎤 已就绪，请说话...');
        
        // 添加欢迎消息
        ChatModule.addMessage('assistant', 
          '你好！我是 AI 视讯助手 👋\n\n我已经打开了摄像头和麦克风。你现在可以看着摄像头说话，我会看到你周围的画面并回复你。试试说「看我桌上有什么」或问一个关于你面前物品的问题！',
          'text'
        );

        // 启动空闲计时器
        this.resetIdleTimer();

      } catch (err) {
        console.error('[App] 启动失败:', err);
        this.updateStatusBar('error', '❌ 启动失败: ' + err.message);
        this.els.startBtn.disabled = false;
        this.els.startBtn.textContent = '重试启动';
        this._sessionActive = false;
      }
    },

    // 停止会话
    stopSession() {
      this._sessionActive = false;
      
      if (window.CameraModule) CameraModule.stop();
      if (window.SpeechModule) {
        SpeechModule.stopListening();
        SpeechModule.stopSpeaking();
      }

      this.clearIdleTimer();

      this.els.startBtn.style.display = 'inline-flex';
      this.els.startBtn.disabled = false;
      this.els.startBtn.textContent = '开始对话';
      this.els.stopBtn.style.display = 'none';
      this.els.pauseCamBtn.disabled = true;

      this.updateStatusBar('idle', '⏸ 已暂停');
    },

    // 处理用户语音输入
    async handleUserSpeech(text) {
      if (this.state.isProcessing || !this._sessionActive) return;
      
      // 停止聆听（避免回声）
      if (window.SpeechModule) SpeechModule.stopListening();

      // 添加用户消息
      ChatModule.addMessage('user', text, 'voice');

      // 开始处理
      this.state.isProcessing = true;
      this.updateStatusBar('processing', '🧠 AI 思考中...');
      this.updateStatusItem(this.els.aiStatus, '处理中', 'active');

      try {
        // 获取当前帧和对话历史
        const image = this.state.lastFrame || null;
        const history = ChatModule.getHistory();

        // 调用 API
        const reply = await APIClient.sendChat(text, image, history);

        // 添加 AI 回复
        ChatModule.addMessage('assistant', reply, 'text');

        // TTS 朗读
        if (window.SpeechModule) {
          this.updateStatusBar('speaking', '🔊 AI 正在回复...');
          SpeechModule.speak(reply);
        } else {
          // 无 TTS 则恢复聆听
          this.updateStatusBar('listening', '🎤 继续聆听...');
          setTimeout(() => {
            if (this._sessionActive) SpeechModule.startListening();
          }, 500);
        }

        this.updateStatusItem(this.els.aiStatus, '已回复', 'active');

      } catch (err) {
        console.error('[App] API 错误:', err);
        ChatModule.addMessage('assistant', 
          '抱歉，我遇到了一些问题：' + err.message + '\n\n请检查：\n1. 后端代理是否已启动\n2. GEMINI_API_KEY 是否正确配置\n3. 网络连接是否正常',
          'text'
        );
        this.updateStatusBar('error', '❌ 请求失败: ' + err.message);
        
        // 恢复聆听
        if (window.SpeechModule && this._sessionActive) {
          setTimeout(() => SpeechModule.startListening(), 1000);
        }
      } finally {
        this.state.isProcessing = false;
        this.resetIdleTimer();
      }
    },

    // 发送文字消息
    sendTextMessage() {
      const text = this.els.chatInput.value.trim();
      if (!text || this.state.isProcessing) return;

      this.els.chatInput.value = '';
      this.els.chatInput.style.height = 'auto';
      
      ChatModule.addMessage('user', text, 'text');
      this.handleUserSpeech(text);
    },

    // 切换摄像头暂停
    toggleCameraPause() {
      if (!window.CameraModule) return;
      const status = CameraModule.getStatus();
      if (status === 'active') {
        CameraModule.pause();
        this.els.pauseCamBtn.textContent = '▶ 恢复摄像头';
      } else {
        CameraModule.resume();
        this.els.pauseCamBtn.textContent = '⏸ 暂停摄像头';
      }
    },

    // 清空对话
    clearChat() {
      if (window.ChatModule) ChatModule.clear();
      this.els.chatMessages.innerHTML = '';
      this.state.frameCount = 0;
      this.renderWelcome();
    },

    // === 渲染 ===
    renderMessage(msg) {
      const div = document.createElement('div');
      div.className = `message ${msg.role}`;
      div.dataset.id = msg.id;

      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.textContent = msg.role === 'user' ? '👤' : '🤖';

      const bubbleWrap = document.createElement('div');
      bubbleWrap.style.maxWidth = '85%';

      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      bubble.textContent = msg.content;

      const info = document.createElement('div');
      info.className = 'message-info';
      info.textContent = Utils.formatTime(msg.timestamp);
      if (msg.type === 'voice') {
        info.textContent += ' • 🎤 语音';
      }
      if (msg.role === 'assistant' && msg._isSpeaking) {
        const spkr = document.createElement('span');
        spkr.className = 'speaking-indicator';
        info.appendChild(spkr);
      }

      bubbleWrap.appendChild(bubble);
      bubbleWrap.appendChild(info);

      if (msg.role === 'user') {
        div.appendChild(bubbleWrap);
        div.appendChild(avatar);
      } else {
        div.appendChild(avatar);
        div.appendChild(bubbleWrap);
      }

      this.els.chatMessages.appendChild(div);
      
      // 移除欢迎消息
      const welcome = this.els.chatMessages.querySelector('.welcome-message');
      if (welcome) welcome.remove();

      // 滚动到底部
      this.els.chatMessages.scrollTop = this.els.chatMessages.scrollHeight;
    },

    renderWelcome() {
      const div = document.createElement('div');
      div.className = 'welcome-message';
      div.innerHTML = `
        <div class="big-icon">🎥</div>
        <h4>欢迎使用 AI 视讯助手</h4>
        <p>点击上方「开始对话」按钮<br/>启动摄像头和麦克风，与 AI 进行视觉对话</p>
      `;
      this.els.chatMessages.appendChild(div);
    },

    // === UI 更新辅助 ===
    updateStatusBar(state, text) {
      const dot = this.els.statusDot;
      const txt = this.els.statusText;
      
      dot.className = 'pulse-dot';
      if (state === 'listening') dot.classList.add('active-listening');
      else if (state === 'processing') dot.classList.add('active-processing');
      else if (state === 'speaking') dot.classList.add('active-speaking');
      
      txt.textContent = text || '';
    },

    updateStatusItem(el, text, cls) {
      if (!el) return;
      el.textContent = text;
      el.className = 'status-item';
      if (cls) el.classList.add(cls);
    },

    // === 空闲管理 ===
    resetIdleTimer() {
      this.clearIdleTimer();
      if (!this.config.idleFramePause) return;
      
      this.state.isIdle = false;
      this.state.idleTimer = setTimeout(() => {
        this.state.isIdle = true;
        if (window.CameraModule) {
          console.log('[App] 空闲模式：暂停帧采集');
        }
      }, 15000); // 15 秒无活动进入空闲
    },

    clearIdleTimer() {
      if (this.state.idleTimer) {
        clearTimeout(this.state.idleTimer);
        this.state.idleTimer = null;
      }
    }
  };

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
  } else {
    App.init();
  }

  // 暴露到全局以便调试
  window.App = App;
})();