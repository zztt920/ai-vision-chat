/**
 * AI 视讯助手 - 主应用逻辑
 * 摄像头 + 麦克风 + 屏幕共享 + 语音交互
 */
(function() {
  'use strict';

  const App = {
    config: {
      frameInterval: 800,
      idleFramePause: true,
      maxHistoryBeforeCompress: 20
    },

    state: {
      isProcessing: false,
      lastFrame: null,
      lastFrameData: null,
      frameCount: 0,
      idleTimer: null,
      isIdle: true,
      videoSource: 'camera'
    },

    els: {},

    async init() {
      this.cacheElements();
      this.bindEvents();
      this.setupModules();
      this.updateStatusBar('idle', '点击「开始对话」启动摄像头和麦克风');
      console.log('[App] 初始化完成');
    },

    cacheElements() {
      this.els = {
        video: document.getElementById('camera-video'),
        placeholder: document.getElementById('camera-placeholder'),
        cameraBadge: document.getElementById('camera-badge'),
        camStatus: document.getElementById('cam-status'),
        micStatus: document.getElementById('mic-status'),
        aiStatus: document.getElementById('ai-status'),
        sourceStatus: document.getElementById('source-status'),
        sourceLabel: document.getElementById('source-label'),
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
        screenShareBtn: document.getElementById('btn-screenshare'),
        interimText: document.getElementById('interim-text')
      };
    },

    bindEvents() {
      this.els.startBtn.addEventListener('click', () => this.startSession());
      this.els.stopBtn.addEventListener('click', () => this.stopSession());
      this.els.clearBtn.addEventListener('click', () => this.clearChat());
      this.els.sendBtn.addEventListener('click', () => this.sendTextMessage());

      this.els.pauseCamBtn.addEventListener('click', () => this.togglePause());

      if (this.els.switchCamBtn) {
        this.els.switchCamBtn.addEventListener('click', () => {
          if (this.state.videoSource === 'screen') {
            this.switchToCamera();
          } else if (window.CameraModule) {
            CameraModule.switchCamera();
          }
        });
      }

      if (this.els.screenShareBtn) {
        this.els.screenShareBtn.addEventListener('click', () => this.switchToScreen());
      }

      this.els.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendTextMessage();
        }
      });

      this.els.chatInput.addEventListener('input', () => {
        this.els.chatInput.style.height = 'auto';
        this.els.chatInput.style.height = Math.min(this.els.chatInput.scrollHeight, 120) + 'px';
      });
    },

    setupModules() {
      // Camera Module
      if (window.CameraModule) {
        CameraModule.onFrame = (base64) => {
          if (this.state.videoSource !== 'camera') return;
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

      // ScreenShare Module (适配远程会议记录场景)
      if (window.ScreenShareModule) {
        ScreenShareModule.onFrame = (base64) => {
          if (this.state.videoSource !== 'screen') return;
          this.state.lastFrame = base64;
          this.state.frameCount++;
          if (this.els.cameraBadge) {
            this.els.cameraBadge.textContent = `● 共享帧: ${this.state.frameCount}`;
          }
        };

        ScreenShareModule.onStatusChange = (status) => {};

        ScreenShareModule.onStop = () => {
          this.state.videoSource = 'none';
          if (this._sessionActive) {
            this.switchToCamera();
          }
        };
      }

      // Speech Module
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
          
          const wave = this.els.voiceWave;
          if (wave) {
            wave.style.display = status === 'listening' ? 'flex' : 'none';
          }
          
          if (status === 'listening') {
            this.updateStatusBar('listening', '🎤 聆听中...');
          } else if (status === 'speaking') {
            this.updateStatusBar('speaking', '🔊 AI 说话中...');
          } else if (status === 'processing') {
            this.updateStatusBar('processing', '🧠 AI 思考中...');
          }
        };

        SpeechModule.onSpeakEnd = () => {
          if (this._sessionActive) {
            setTimeout(() => SpeechModule.startListening(), 300);
          }
        };
      }

      // Chat Module
      if (window.ChatModule) {
        ChatModule.onMessage = (msg) => {
          this.renderMessage(msg);
        };
      }

      // API Client
      if (window.APIClient) {
        const serverUrl = localStorage.getItem('ai-vision-server') || 'http://localhost:3000';
        APIClient.setServerUrl(serverUrl);
      }
    },

    async startSession() {
      this._sessionActive = true;
      this.els.startBtn.disabled = true;
      this.els.startBtn.textContent = '启动中...';

      try {
        if (window.CameraModule) {
          await CameraModule.start({
            video: this.els.video,
            placeholder: this.els.placeholder,
            width: 640,
            height: 480
          });
          this.state.videoSource = 'camera';
          this.updateSourceUI('camera');
        }

        if (window.SpeechModule) {
          SpeechModule.startListening();
          this.els.micStatus.textContent = '聆听中...';
        }

        this.els.startBtn.style.display = 'none';
        this.els.stopBtn.style.display = 'inline-flex';
        this.els.pauseCamBtn.disabled = false;
        this.els.screenShareBtn.style.display = 'inline-flex';

        this.updateStatusBar('listening', '🎤 对话已开始，请说话...');
        this.resetIdleTimer();

      } catch (err) {
        console.error('[App] 启动失败:', err);
        this.updateStatusBar('error', '❌ 启动失败: ' + err.message);
        this.els.startBtn.disabled = false;
        this.els.startBtn.textContent = '重试';
        this._sessionActive = false;
      }
    },

    stopSession() {
      this._sessionActive = false;
      
      if (window.CameraModule) CameraModule.stop();
      if (window.ScreenShareModule) ScreenShareModule.stop();
      if (window.SpeechModule) {
        SpeechModule.stopListening();
        SpeechModule.stopSpeaking();
      }

      this.clearIdleTimer();
      this.state.videoSource = 'none';

      this.els.startBtn.style.display = 'inline-flex';
      this.els.startBtn.disabled = false;
      this.els.startBtn.textContent = '开始对话';
      this.els.stopBtn.style.display = 'none';
      this.els.pauseCamBtn.disabled = true;
      this.els.screenShareBtn.style.display = 'none';
      this.els.cameraBadge.style.display = 'none';
      this.els.sourceStatus.style.display = 'none';

      this.updateStatusBar('idle', '⏸ 对话已结束');
    },

    async handleUserSpeech(text, skipAdd) {
      if (this.state.isProcessing || !this._sessionActive) return;
      
      if (window.SpeechModule) SpeechModule.stopListening();

      if (!skipAdd) {
        ChatModule.addMessage('user', text, 'voice');
      }

      this.state.isProcessing = true;
      this.updateStatusBar('processing', '🧠 AI 思考中...');
      this.updateStatusItem(this.els.aiStatus, '处理中', 'active');

      try {
        const image = this.state.lastFrame || null;
        const history = ChatModule.getHistory();

        const reply = await APIClient.sendChat(text, image, history);

        ChatModule.addMessage('assistant', reply, 'text');

        if (window.SpeechModule) {
          this.updateStatusBar('speaking', '🔊 AI 说话中...');
          SpeechModule.speak(reply);
        } else {
          this.updateStatusBar('listening', '🎤 聆听中...');
          setTimeout(() => {
            if (this._sessionActive) SpeechModule.startListening();
          }, 500);
        }

        this.updateStatusItem(this.els.aiStatus, '已回复', 'active');

      } catch (err) {
        console.error('[App] API 错误:', err);
        ChatModule.addMessage('assistant', 
          '抱歉，我遇到了一些问题：' + err.message + '\n\n请检查：\n1. 后端代理是否已启动 (node server/index.js)\n2. API 密钥是否正确配置 (.env 文件)\n3. 网络连接是否正常',
          'text'
        );
        this.updateStatusBar('error', '❌ 请求失败: ' + err.message);
        
        if (window.SpeechModule && this._sessionActive) {
          setTimeout(() => SpeechModule.startListening(), 1000);
        }
      } finally {
        this.state.isProcessing = false;
        this.resetIdleTimer();
      }
    },

    sendTextMessage() {
      const text = this.els.chatInput.value.trim();
      if (!text || this.state.isProcessing) return;

      this.els.chatInput.value = '';
      this.els.chatInput.style.height = 'auto';
      
      ChatModule.addMessage('user', text, 'text');
      this.handleUserSpeech(text, true);
    },

    togglePause() {
      const isCam = this.state.videoSource === 'camera';
      if (isCam && window.CameraModule) {
        const status = CameraModule.getStatus();
        if (status === 'active') {
          CameraModule.pause();
          this.els.pauseCamBtn.textContent = '▶ 恢复';
        } else {
          CameraModule.resume();
          this.els.pauseCamBtn.textContent = '⏸ 暂停';
        }
      } else if (!isCam && window.ScreenShareModule) {
        const status = ScreenShareModule.getStatus();
        if (status === 'active') {
          ScreenShareModule.pause();
          this.els.pauseCamBtn.textContent = '▶ 恢复';
        } else {
          ScreenShareModule.resume();
          this.els.pauseCamBtn.textContent = '⏸ 暂停';
        }
      }
    },

    async switchToCamera() {
      if (this.state.videoSource === 'camera' || !this._sessionActive) return;

      try {
        this.els.switchCamBtn.disabled = true;
        this.els.screenShareBtn.disabled = true;

        if (window.ScreenShareModule) ScreenShareModule.stop();

        if (window.CameraModule) {
          await CameraModule.start({
            video: this.els.video,
            placeholder: this.els.placeholder
          });
          this.state.videoSource = 'camera';
          this.updateSourceUI('camera');
        }
      } catch (err) {
        console.error('[App] 切换到摄像头失败:', err);
      } finally {
        this.els.switchCamBtn.disabled = false;
        this.els.screenShareBtn.disabled = false;
      }
    },

    async switchToScreen() {
      if (this.state.videoSource === 'screen' || !this._sessionActive) return;

      try {
        this.els.switchCamBtn.disabled = true;
        this.els.screenShareBtn.disabled = true;

        if (window.CameraModule) CameraModule.pause();

        if (window.ScreenShareModule) {
          await ScreenShareModule.start({
            video: this.els.video,
            placeholder: this.els.placeholder
          });
          this.state.videoSource = 'screen';
          this.updateSourceUI('screen');
          // 屏幕共享适配会议记录场景：提示用户可用会议功能
          ChatModule.addMessage('assistant', 
            '🖥 **已共享屏幕** — 远程会议记录模式已开启。\n\n' +
            '共享屏幕期间，你可以：\n' +
            '• 📝 说「记录一下」保存会议要点\n' +
            '• 📄 说「生成会议纪要」输出完整记录\n' +
            '• 💬 提问屏幕上的会议内容',
            'text'
          );
        }
      } catch (err) {
        console.log('[App] 屏幕共享取消，回到摄像头模式');
        if (this.state.videoSource === 'camera') {
          if (window.CameraModule) CameraModule.resume();
        } else {
          if (window.CameraModule) {
            await CameraModule.start({
              video: this.els.video,
              placeholder: this.els.placeholder
            });
            this.state.videoSource = 'camera';
            this.updateSourceUI('camera');
          }
        }
      } finally {
        this.els.switchCamBtn.disabled = false;
        this.els.screenShareBtn.disabled = false;
      }
    },

    updateSourceUI(source) {
      const statusEl = this.els.sourceStatus;
      const labelEl = this.els.sourceLabel;
      const badgeEl = this.els.cameraBadge;

      if (source === 'camera') {
        statusEl.style.display = 'flex';
        statusEl.className = 'status-item active';
        labelEl.textContent = '📷 摄像头';
        badgeEl.style.display = 'flex';
        badgeEl.textContent = `● REC 帧: ${this.state.frameCount}`;
      } else if (source === 'screen') {
        statusEl.style.display = 'flex';
        statusEl.className = 'status-item active';
        labelEl.textContent = '🖥 屏幕共享';
        badgeEl.style.display = 'flex';
        badgeEl.innerHTML = '<span class="rec-dot"></span> SCREEN';
      } else {
        statusEl.style.display = 'none';
      }
    },

    clearChat() {
      if (window.ChatModule) ChatModule.clear();
      this.els.chatMessages.innerHTML = '';
      this.state.frameCount = 0;
      this.renderWelcome();
    },

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
      
      const welcome = this.els.chatMessages.querySelector('.welcome-message');
      if (welcome) welcome.remove();

      this.els.chatMessages.scrollTop = this.els.chatMessages.scrollHeight;
    },

    renderWelcome() {
      const div = document.createElement('div');
      div.className = 'welcome-message';
      div.innerHTML = `
        <div class="big-icon">🎥</div>
        <h4>AI 视讯助手</h4>
        <p>点击上方「开始对话」按钮<br/>启动摄像头和麦克风，与 AI 进行视觉对话</p>
      `;
      this.els.chatMessages.appendChild(div);
    },

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

    resetIdleTimer() {
      this.clearIdleTimer();
      if (!this.config.idleFramePause) return;
      
      this.state.isIdle = false;
      this.state.idleTimer = setTimeout(() => {
        this.state.isIdle = true;
        if (window.CameraModule) {
          console.log('[App] 空闲模式：暂停帧采集');
        }
      }, 30000);
    },

    clearIdleTimer() {
      if (this.state.idleTimer) {
        clearTimeout(this.state.idleTimer);
        this.state.idleTimer = null;
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
  } else {
    App.init();
  }

  window.App = App;
})();