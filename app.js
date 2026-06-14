/**
 * LumiChat - AI 视讯助手 | lumi-OS 风格
 * 摄像头 + 麦克风 + 屏幕共享 + 语音交互 + 沉浸式音乐可视化
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
      videoSource: 'none',
      sessionActive: false,
      cursorVisible: true,
      musicMode: false,
      musicTime: 0,
      isMusicPlaying: false,
      speechUnavailable: false,
      // 音乐播放状态
      currentSongIndex: 0,
      audioPlayer: null,
      isAudioPlaying: false,
      audioDuration: 0,
      audioCurrentTime: 0,
      audioProgressInterval: null,
      // Web Audio API
      audioContext: null,
      analyser: null,
      sourceNode: null,
      frequencyData: null,
      // 沉浸式可视化
      immersiveActive: false,
      vizAnimId: null,
      vizTime: 0,
      // 歌词
      currentLyricIndex: 0
    },

    // 播放列表（支持网易云真实歌曲和本地备用）
    playlist: [],

    // ==== 网易云 API 调用（通过服务器代理，使用内部 API） ====

    // 搜索歌曲
    async searchNeteaseSongs(keywords, limit) {
      try {
        const url = '/api/netease-v3/search?keywords=' + encodeURIComponent(keywords) + '&limit=' + (limit || 10);
        const res = await fetch(url);
        const data = await res.json();
        return data.songs || [];
      } catch (err) {
        console.error('[NeteaseV3] 搜索失败:', err.message);
        return [];
      }
    },

    // 获取歌曲播放 URL（通过服务器代理，绕过浏览器限制）
    async getNeteaseSongUrl(songId) {
      return '/api/netease-v3/audio?id=' + songId;
    },

    // 获取歌词
    async getNeteaseLyrics(songId, encryptedId) {
      try {
        const eidParam = encryptedId ? '&eid=' + encodeURIComponent(encryptedId) : '';
        const url = '/api/netease-v3/lyric?id=' + songId + eidParam;
        const res = await fetch(url);
        const data = await res.json();
        return this.parseLrc(data.lrc || '');
      } catch (err) {
        console.warn('[NeteaseV3] 歌词获取失败:', err.message);
        return [{ time: 0, text: '🎵 纯音乐，请欣赏' }];
      }
    },

    // 解析 LRC 歌词
    parseLrc(lrcText) {
      if (!lrcText) return [{ time: 0, text: '🎵 暂无歌词' }];
      const lines = lrcText.split('\n');
      const lyrics = [];
      const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

      for (const line of lines) {
        const match = line.match(timeRegex);
        if (match) {
          const mins = parseInt(match[1], 10);
          const secs = parseInt(match[2], 10);
          const ms = parseInt(match[3].padEnd(3, '0'), 10);
          const text = match[4].trim();
          if (text) {
            lyrics.push({
              time: mins * 60 + secs + ms / 1000,
              text: text
            });
          }
        }
      }

      lyrics.sort((a, b) => a.time - b.time);
      return lyrics.length > 0 ? lyrics : [{ time: 0, text: '🎵 暂无歌词' }];
    },

    els: {},

    /* ==========================================
       INIT
       ========================================== */
    async init() {
      this.cacheElements();
      this.bindEvents();
      this.setupModules();
      this.initParticles();
      this.initCursorGlow();
      this.initClock();
      this.initFloatingAgent();
      this.updateFooter('💡 点击「开始对话」启动 AI 视讯助手');
      this.showFloatingAgent(true);
      console.log('[LumiChat] 初始化完成');
    },

    cacheElements() {
      this.els = {
        // Video & Camera
        video: document.getElementById('video-feed'),
        cameraOverlay: document.getElementById('camera-overlay'),

        // Chat
        chatMessages: document.getElementById('chat-messages'),
        chatInput: document.getElementById('chat-input'),
        welcomeScreen: document.getElementById('welcome-screen'),
        chatLoading: document.getElementById('chat-loading'),
        chatInputBar: document.getElementById('chat-input-bar'),

        // Buttons
        startBtn: document.getElementById('btn-start'),
        sendBtn: document.getElementById('btn-send'),
        clearBtn: document.getElementById('btn-clear-chat'),
        micBtn: document.getElementById('btn-mic'),
        toggleCamBtn: document.getElementById('btn-toggle-cam'),
        screenShareBtn: document.getElementById('btn-screenshare'),

        // Status
        statusCamera: document.getElementById('status-camera'),
        statusMic: document.getElementById('status-mic'),
        statusAi: document.getElementById('status-ai'),
        footerStatus: document.getElementById('footer-status'),
        footerFps: document.getElementById('footer-fps'),
        footerSource: document.getElementById('footer-source'),

        // Voice wave
        voiceWave: document.getElementById('voice-wave'),

        // Floating agent
        floatingAgent: document.getElementById('floating-agent'),
        agentStatusText: document.getElementById('agent-status-text'),
        agentTooltip: document.getElementById('agent-tooltip'),
        agentTooltipText: document.getElementById('agent-tooltip-text'),

        // Dock
        dockLogo: document.getElementById('dock-logo'),
        dockCursor: document.getElementById('dock-cursor'),
        dockMic: document.getElementById('dock-mic-toggle'),
        dockTime: document.getElementById('dock-time'),

        // Canvas
        bgCanvas: document.getElementById('bg-canvas'),
        aiBreathCanvas: document.getElementById('ai-breath-canvas'),

        // Cursor
        cursorGlow: document.getElementById('cursor-glow'),

        // Camera retry
        retryCamBtn: document.getElementById('btn-retry-cam'),

        // Audio upload
        uploadBtn: document.getElementById('btn-upload'),
        audioFileInput: document.getElementById('audio-file-input'),
        hintUpload: document.getElementById('hint-upload'),

        // Audio Player
        audioPlayer: document.getElementById('audio-player'),

        // Immersive Music
        musicImmersive: document.getElementById('music-immersive'),
        musicVizCanvas: document.getElementById('music-viz-canvas'),
        immersiveSongTitle: document.getElementById('immersive-song-title'),
        immersiveSongArtist: document.getElementById('immersive-song-artist'),
        lyricCurrent: document.getElementById('lyric-current'),
        lyricNext: document.getElementById('lyric-next'),
        immersiveTimeCurrent: document.getElementById('immersive-time-current'),
        immersiveTimeTotal: document.getElementById('immersive-time-total'),
        immersiveProgressFill: document.getElementById('immersive-progress-fill'),
        btnCloseImmersive: document.getElementById('btn-close-immersive')
      };

      // 初始化音频播放器
      this.initAudioPlayer();
    },

    /**
     * 初始化音频播放器
     */
    initAudioPlayer() {
      if (!this.els.audioPlayer) return;

      this.state.audioPlayer = this.els.audioPlayer;

      // 音频事件监听
      this.state.audioPlayer.addEventListener('loadedmetadata', () => {
        this.state.audioDuration = this.state.audioPlayer.duration;
        this.updateTimeDisplay();
      });

      this.state.audioPlayer.addEventListener('timeupdate', () => {
        this.state.audioCurrentTime = this.state.audioPlayer.currentTime;
        this.updateProgress();
        this.updateLyricsByTime(this.state.audioCurrentTime);
      });

      this.state.audioPlayer.addEventListener('ended', () => {
        this.playNextSong();
      });

      this.state.audioPlayer.addEventListener('play', () => {
        this.state.isAudioPlaying = true;
        this.connectAudioContext();
      });

      this.state.audioPlayer.addEventListener('pause', () => {
        this.state.isAudioPlaying = false;
      });

      this.state.audioPlayer.addEventListener('error', (e) => {
        console.error('[Music] 音频加载错误:', e);
      });
    },

    /**
     * 连接 Web Audio API
     */
    connectAudioContext() {
      if (!this.state.audioContext) {
        this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (!this.state.analyser) {
        this.state.analyser = this.state.audioContext.createAnalyser();
        this.state.analyser.fftSize = 256;
        this.state.analyser.smoothingTimeConstant = 0.85;
        this.state.frequencyData = new Uint8Array(this.state.analyser.frequencyBinCount);
      }
      if (!this.state.sourceNode) {
        try {
          this.state.sourceNode = this.state.audioContext.createMediaElementSource(this.state.audioPlayer);
          this.state.sourceNode.connect(this.state.analyser);
          this.state.analyser.connect(this.state.audioContext.destination);
        } catch (e) {
          // 可能已经连接过了
        }
      }
      if (this.state.audioContext.state === 'suspended') {
        this.state.audioContext.resume();
      }
    },

    /**
     * 加载并播放指定歌曲（支持网易云真实歌曲）
     */
    async loadSong(index) {
      if (!this.playlist || this.playlist.length === 0) {
        console.warn('[Music] 播放列表为空');
        return;
      }

      if (index < 0) index = this.playlist.length - 1;
      if (index >= this.playlist.length) index = 0;

      this.state.currentSongIndex = index;
      this.state.currentLyricIndex = 0;
      const song = this.playlist[index];

      // 更新 UI - 歌曲名和作者只在开始时显示
      if (this.els.immersiveSongTitle) {
        this.els.immersiveSongTitle.textContent = song.title || '未知歌曲';
        this.els.immersiveSongTitle.style.opacity = '1';
        this.els.immersiveSongTitle.style.transform = 'translateY(0)';
      }
      if (this.els.immersiveSongArtist) {
        this.els.immersiveSongArtist.textContent = song.artist || '未知歌手';
        this.els.immersiveSongArtist.style.opacity = '1';
        this.els.immersiveSongArtist.style.transform = 'translateY(0)';
      }

      // 5秒后淡出歌曲信息
      if (this.state.songInfoFadeTimer) clearTimeout(this.state.songInfoFadeTimer);
      this.state.songInfoFadeTimer = setTimeout(() => {
        if (this.els.immersiveSongTitle) {
          this.els.immersiveSongTitle.style.transition = 'all 1.5s cubic-bezier(0.22, 1, 0.36, 1)';
          this.els.immersiveSongTitle.style.opacity = '0';
          this.els.immersiveSongTitle.style.transform = 'translateY(-20px)';
        }
        if (this.els.immersiveSongArtist) {
          this.els.immersiveSongArtist.style.transition = 'all 1.5s cubic-bezier(0.22, 1, 0.36, 1)';
          this.els.immersiveSongArtist.style.opacity = '0';
          this.els.immersiveSongArtist.style.transform = 'translateY(-15px)';
        }
      }, 5000);

      // 如果是网易云歌曲（有 songId），先获取播放 URL
      let audioUrl = song.url;
      if (song.neteaseId && !song.url) {
        try {
          this.updateFooter('🎵 正在获取歌曲...');
          audioUrl = await this.getNeteaseSongUrl(song.neteaseId);
          song.url = audioUrl; // 缓存
        } catch (err) {
          console.error('[Music] 获取歌曲 URL 失败:', err);
          this.updateFooter('❌ 歌曲获取失败，尝试下一首');
          setTimeout(() => this.playNextSong(), 2000);
          return;
        }
      }

      // 加载音频
      if (this.state.audioPlayer && audioUrl) {
        this.state.audioPlayer.src = audioUrl;
        this.state.audioPlayer.load();
        this.state.audioPlayer.play().catch(err => {
          console.warn('[Music] 自动播放被阻止:', err);
        });
      }

      // 获取歌词（如果是网易云歌曲且没有歌词）
      if (song.neteaseId && (!song.lyrics || song.lyrics.length <= 1)) {
        try {
          song.lyrics = await this.getNeteaseLyrics(song.neteaseId, song.encryptedId);
        } catch (err) {
          song.lyrics = [{ time: 0, text: '🎵 ' + song.title }];
        }
      }

      // 重置歌词显示
      if (this.els.lyricCurrent) {
        this.els.lyricCurrent.textContent = song.lyrics?.[0]?.text || '🎵 ' + song.title;
      }
      if (this.els.lyricNext) {
        const nextText = song.lyrics?.[1]?.text || '';
        this.els.lyricNext.textContent = nextText;
      }

      this.updateFooter('🎵 ' + (song.title || '正在播放'));
      console.log(`[Music] 加载歌曲: ${song.title} - ${song.artist}`);
    },

    /**
     * 根据时间更新歌词 - 浮现效果
     */
    updateLyricsByTime(currentTime) {
      const song = this.playlist[this.state.currentSongIndex];
      if (!song || !song.lyrics) return;

      let activeIndex = 0;
      for (let i = 0; i < song.lyrics.length; i++) {
        if (currentTime >= song.lyrics[i].time) {
          activeIndex = i;
        } else {
          break;
        }
      }

      if (activeIndex !== this.state.currentLyricIndex) {
        this.state.currentLyricIndex = activeIndex;
        this.animateLyricChange(song.lyrics, activeIndex);
      }
    },

    /**
     * 歌词浮现动画切换
     */
    animateLyricChange(lyrics, activeIndex) {
      const currentEl = this.els.lyricCurrent;
      const nextEl = this.els.lyricNext;
      if (!currentEl) return;

      const newText = lyrics[activeIndex]?.text || '';
      const nextText = lyrics[activeIndex + 1]?.text || '';

      // 先淡出当前歌词
      currentEl.classList.remove('lyric-fade-in');
      currentEl.classList.add('lyric-fade-out');

      // 同时淡出下一句
      if (nextEl) {
        nextEl.style.opacity = '0';
        nextEl.style.transform = 'translateY(8px)';
      }

      // 动画结束后更新内容并淡入
      setTimeout(() => {
        currentEl.textContent = newText;
        currentEl.classList.remove('lyric-fade-out');
        currentEl.classList.add('lyric-fade-in');

        // 下一句淡入
        if (nextEl) {
          nextEl.textContent = nextText;
          nextEl.style.transition = 'all 0.5s ease 0.3s';
          nextEl.style.opacity = '1';
          nextEl.style.transform = 'translateY(0)';
        }

        // 清除动画类
        setTimeout(() => {
          currentEl.classList.remove('lyric-fade-in');
        }, 600);
      }, 400);
    },

    /**
     * 更新进度条
     */
    updateProgress() {
      if (this.state.audioDuration === 0) return;

      const percent = (this.state.audioCurrentTime / this.state.audioDuration) * 100;
      if (this.els.immersiveProgressFill) {
        this.els.immersiveProgressFill.style.width = percent + '%';
      }
    },

    /**
     * 更新时间显示
     */
    updateTimeDisplay() {
      if (this.els.immersiveTimeCurrent) {
        this.els.immersiveTimeCurrent.textContent = this.formatTime(this.state.audioCurrentTime);
      }
      if (this.els.immersiveTimeTotal) {
        this.els.immersiveTimeTotal.textContent = this.formatTime(this.state.audioDuration);
      }
    },

    /**
     * 格式化时间
     */
    formatTime(seconds) {
      if (isNaN(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    },

    /**
     * 播放上一首
     */
    playPrevSong() {
      this.loadSong(this.state.currentSongIndex - 1).catch(err => {
        console.error('[Music] 播放上一首失败:', err);
      });
    },

    /**
     * 播放下一首
     */
    playNextSong() {
      this.loadSong(this.state.currentSongIndex + 1).catch(err => {
        console.error('[Music] 播放下一首失败:', err);
      });
    },

    /**
     * 显示沉浸式音乐界面
     */
    showImmersiveMusic(show) {
      this.state.immersiveActive = show;
      if (this.els.musicImmersive) {
        this.els.musicImmersive.style.display = show ? 'flex' : 'none';
      }

      if (show) {
        // 启动可视化
        this.startImmersiveVisualization();
      } else {
        this.stopImmersiveVisualization();
        // 暂停音乐
        if (this.state.audioPlayer) {
          this.state.audioPlayer.pause();
        }
      }
    },

    /* ==========================================
       IMMERSIVE VISUALIZATION
       ========================================== */
    startImmersiveVisualization() {
      const canvas = this.els.musicVizCanvas;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      };
      resize();
      window.addEventListener('resize', resize);
      this._vizResize = resize;

      this.state.vizTime = 0;
      const particles = this.createVizParticles(80);

      const render = () => {
        if (!this.state.immersiveActive) return;

        const w = canvas.width;
        const h = canvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const t = this.state.vizTime;
        this.state.vizTime += 1 / 60;

        // 获取音频频率数据
        let freqData = null;
        let avgFreq = 0;
        if (this.state.analyser && this.state.frequencyData) {
          this.state.analyser.getByteFrequencyData(this.state.frequencyData);
          freqData = this.state.frequencyData;
          // 计算平均频率强度
          let sum = 0;
          for (let i = 0; i < freqData.length; i++) sum += freqData[i];
          avgFreq = sum / freqData.length / 255;
        }

        // 背景 - 深色渐变
        ctx.fillStyle = '#0a0a12';
        ctx.fillRect(0, 0, w, h);

        // 动态背景光晕
        const breathe = 1 + Math.sin(t * 0.5) * 0.1 + avgFreq * 0.3;
        const glowR = Math.min(w, h) * 0.35 * breathe;

        // 中心光晕
        const centerGrad = ctx.createRadialGradient(cx, cy * 0.7, 0, cx, cy * 0.7, glowR);
        centerGrad.addColorStop(0, `rgba(74, 158, 255, ${0.06 + avgFreq * 0.1})`);
        centerGrad.addColorStop(0.4, `rgba(139, 111, 232, ${0.03 + avgFreq * 0.05})`);
        centerGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = centerGrad;
        ctx.fillRect(0, 0, w, h);

        // 音浪波形 - 底部
        if (freqData) {
          this.drawWaveform(ctx, w, h, freqData, t, avgFreq);
        }

        // 圆形频谱环
        if (freqData) {
          this.drawCircularSpectrum(ctx, cx, cy * 0.7, freqData, t, avgFreq);
        }

        // 粒子系统
        this.drawParticles(ctx, w, h, particles, t, avgFreq);

        // 浮动光点
        this.drawFloatingLights(ctx, w, h, t, avgFreq);

        // 绘制中心歌词（在圆形频谱中心）
        this.drawCenterLyrics(ctx, cx, cy * 0.7, avgFreq);

        this.state.vizAnimId = requestAnimationFrame(render);
      };

      this.state.vizAnimId = requestAnimationFrame(render);
    },

    /**
     * 创建可视化粒子
     */
    createVizParticles(count) {
      const particles = [];
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random(),
          y: Math.random(),
          vx: (Math.random() - 0.5) * 0.0003,
          vy: (Math.random() - 0.5) * 0.0003,
          size: Math.random() * 2 + 0.5,
          baseAlpha: Math.random() * 0.3 + 0.1,
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.5 + 0.3
        });
      }
      return particles;
    },

    /**
     * 绘制波形
     */
    drawWaveform(ctx, w, h, freqData, t, intensity) {
      const barCount = 64;
      const barWidth = w / barCount;
      const maxBarHeight = h * 0.25;

      for (let i = 0; i < barCount; i++) {
        const freqIndex = Math.floor((i / barCount) * freqData.length * 0.6);
        const value = freqData[freqIndex] / 255;
        const barHeight = value * maxBarHeight * (1 + intensity * 0.5);

        const x = i * barWidth;
        const y = h - barHeight;

        // 渐变颜色
        const hue = 210 + (i / barCount) * 40 + Math.sin(t * 2) * 10;
        const alpha = 0.15 + value * 0.3;

        ctx.fillStyle = `hsla(${hue}, 80%, 60%, ${alpha})`;
        ctx.fillRect(x, y, barWidth - 1, barHeight);

        // 镜像波形（上方）
        ctx.fillStyle = `hsla(${hue}, 80%, 60%, ${alpha * 0.3})`;
        ctx.fillRect(x, 0, barWidth - 1, barHeight * 0.3);
      }
    },

    /**
     * 绘制圆形频谱
     */
    drawCircularSpectrum(ctx, cx, cy, freqData, t, intensity) {
      const radius = 80 + intensity * 40;
      const bars = 48;

      for (let i = 0; i < bars; i++) {
        const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
        const freqIndex = Math.floor((i / bars) * freqData.length * 0.5);
        const value = freqData[freqIndex] / 255;
        const barLen = value * 60 * (1 + intensity);

        const x1 = cx + Math.cos(angle) * radius;
        const y1 = cy + Math.sin(angle) * radius;
        const x2 = cx + Math.cos(angle) * (radius + barLen);
        const y2 = cy + Math.sin(angle) * (radius + barLen);

        const hue = 200 + (i / bars) * 60 + Math.sin(t * 1.5) * 15;
        const alpha = 0.2 + value * 0.5;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `hsla(${hue}, 80%, 65%, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // 内圈光环
      const innerR = radius - 10;
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(74, 158, 255, ${0.1 + intensity * 0.15})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // 外圈光环
      const outerR = radius + 60 * intensity;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(139, 111, 232, ${0.05 + intensity * 0.1})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
    },

    /**
     * 绘制粒子
     */
    drawParticles(ctx, w, h, particles, t, intensity) {
      for (const p of particles) {
        p.x += p.vx * (1 + intensity * 2);
        p.y += p.vy * (1 + intensity * 2);

        if (p.x < 0 || p.x > 1) p.vx *= -1;
        if (p.y < 0 || p.y > 1) p.vy *= -1;

        const px = p.x * w;
        const py = p.y * h;
        const pulse = Math.sin(t * p.speed + p.phase) * 0.5 + 0.5;
        const size = p.size * (1 + intensity * pulse);
        const alpha = p.baseAlpha * (0.5 + pulse * 0.5) * (1 + intensity);

        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(160, 180, 255, ${alpha})`;
        ctx.fill();

        // 连接线
        for (const other of particles) {
          const dx = (p.x - other.x) * w;
          const dy = (p.y - other.y) * h;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(other.x * w, other.y * h);
            ctx.strokeStyle = `rgba(100, 140, 255, ${0.03 * (1 - dist / 100) * (1 + intensity)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
    },

    /**
     * 绘制中心歌词（在圆形频谱中心浮动显示）
     */
    drawCenterLyrics(ctx, cx, cy, intensity) {
      const song = this.playlist[this.state.currentSongIndex];
      if (!song || !song.lyrics) return;

      const currentLyric = song.lyrics[this.state.currentLyricIndex];
      if (!currentLyric) return;

      const text = currentLyric.text;
      if (!text) return;

      // 歌词呼吸效果
      const breathe = 1 + Math.sin(this.state.vizTime * 2) * 0.02 + intensity * 0.05;
      const fontSize = 28 * breathe;

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // 外发光
      ctx.shadowColor = 'rgba(74, 158, 255, 0.6)';
      ctx.shadowBlur = 30 + intensity * 20;

      // 主文字
      ctx.font = `600 ${fontSize}px "Noto Sans SC", "Inter", sans-serif`;
      ctx.fillStyle = `rgba(255, 255, 255, ${0.9 + intensity * 0.1})`;
      ctx.fillText(text, cx, cy);

      // 内圈高光文字（更亮）
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + intensity * 0.3})`;
      ctx.font = `600 ${fontSize * 0.98}px "Noto Sans SC", "Inter", sans-serif`;
      ctx.fillText(text, cx, cy);

      ctx.restore();
    },

    /**
     * 绘制浮动光点
     */
    drawFloatingLights(ctx, w, h, t, intensity) {
      const count = 12;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + t * 0.2;
        const dist = 0.3 + Math.sin(i * 1.3 + t * 0.5) * 0.1;
        const px = w / 2 + Math.cos(angle) * w * dist;
        const py = h * 0.5 + Math.sin(angle) * h * dist * 0.5;
        const size = 2 + Math.sin(i * 2.1 + t * 3) * 1 + intensity * 3;
        const alpha = 0.1 + Math.sin(i * 1.7 + t) * 0.05 + intensity * 0.1;

        // 光晕
        const glow = ctx.createRadialGradient(px, py, 0, px, py, size * 4);
        glow.addColorStop(0, `rgba(74, 158, 255, ${alpha})`);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(px, py, size * 4, 0, Math.PI * 2);
        ctx.fill();

        // 核心
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200, 220, 255, ${alpha + 0.1})`;
        ctx.fill();
      }
    },

    stopImmersiveVisualization() {
      if (this.state.vizAnimId) {
        cancelAnimationFrame(this.state.vizAnimId);
        this.state.vizAnimId = null;
      }
      if (this._vizResize) {
        window.removeEventListener('resize', this._vizResize);
        this._vizResize = null;
      }
      const canvas = this.els.musicVizCanvas;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    },

    /* ==========================================
       语音呼吸效果（用户说话时展示玻璃粒子呼吸感，匹配主界面风格）
       ========================================== */
    startAiBreath() {
      const canvas = this.els.aiBreathCanvas;
      if (!canvas) return;
      if (this._aiBreathAnimId) return;

      canvas.parentElement.classList.add('breathing');
      canvas.style.display = 'block';
      canvas.classList.add('active');

      const ctx = canvas.getContext('2d');
      let isRunning = true;
      let startTime = performance.now();
      const PARTICLE_COUNT = 150;
      const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
      let particles = [];

      // 用 Fibonacci 球面均匀分布生成粒子
      const createParticles = () => {
        particles = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const y = 1 - (i / (PARTICLE_COUNT - 1)) * 2;          // -1 ~ 1
          const radiusAtY = Math.sqrt(1 - y * y);
          const theta = 2 * Math.PI * i / GOLDEN_RATIO;
          particles.push({
            x: Math.cos(theta) * radiusAtY,
            y: y,
            z: Math.sin(theta) * radiusAtY,
            size: 1.5 + Math.random() * 2.5,
            alpha: 0.3 + Math.random() * 0.5,
            phase: Math.random() * Math.PI * 2
          });
        }
      };

      const resize = () => {
        const parent = canvas.parentElement;
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
        createParticles();
      };
      resize();

      const render = (now) => {
        if (!isRunning) return;

        const w = canvas.width;
        const h = canvas.height;
        const t = (now - startTime) / 1000;
        const cx = w / 2;
        const cy = h / 2;
        const minDim = Math.min(w, h);

        // 球体基础半径
        const baseR = minDim * 0.28;
        // 呼吸缩放：AI 说话时球体放大收缩，不说不呼吸
        const breathScale = this._breathing ? 1 + Math.sin(t * 2.2) * 0.13 : 1.0;
        const sphereR = baseR * breathScale;
        // 透视距离
        const perspective = baseR * 2.5;

        ctx.clearRect(0, 0, w, h);

        // 半透明玻璃背景
        ctx.fillStyle = 'rgba(245, 240, 232, 0.5)';
        ctx.fillRect(0, 0, w, h);

        // === 球体中心光晕（随呼吸缩放） ===
        const glowR = sphereR * 0.7;
        const glowGrad = ctx.createRadialGradient(cx, cy, glowR * 0.2, cx, cy, sphereR * 1.8);
        glowGrad.addColorStop(0, 'rgba(74, 158, 255, 0.15)');
        glowGrad.addColorStop(0.3, 'rgba(139, 111, 232, 0.08)');
        glowGrad.addColorStop(0.7, 'rgba(74, 158, 255, 0.03)');
        glowGrad.addColorStop(1, 'rgba(245, 240, 232, 0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, sphereR * 1.8, 0, Math.PI * 2);
        ctx.fill();

        // === 装饰光环 ===
        // 内环
        ctx.beginPath();
        ctx.arc(cx, cy, sphereR * 1.05, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(74, 158, 255, 0.2)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // 虚线环
        ctx.beginPath();
        ctx.arc(cx, cy, sphereR * 1.25, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(139, 111, 232, 0.1)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 14]);
        ctx.stroke();
        ctx.setLineDash([]);

        // 外环
        ctx.beginPath();
        ctx.arc(cx, cy, sphereR * 1.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(74, 158, 255, 0.05)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // === 3D 球体旋转 ===
        const rotY = t * 0.4;  // Y轴旋转
        const rotX = Math.sin(t * 0.3) * 0.25;  // X轴轻微摆动

        // 预计算旋转后的3D坐标和投影
        const projected = [];
        for (const p of particles) {
          // 绕Y轴旋转
          const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
          let rx = p.x * cosY - p.z * sinY;
          let rz = p.x * sinY + p.z * cosY;
          let ry = p.y;

          // 绕X轴轻微旋转
          const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
          const ry2 = ry * cosX - rz * sinX;
          const rz2 = ry * sinX + rz * cosX;
          rx = rx;
          ry = ry2;
          rz = rz2;

          // 透视投影
          const scale = perspective / (perspective + rz * sphereR);
          const sx = cx + rx * sphereR * scale;
          const sy = cy + ry * sphereR * scale;
          const depth = (rz + 1) / 2;  // 0(背面) ~ 1(正面)

          projected.push({
            sx, sy, depth, rx, ry, rz,
            size: p.size,
            alpha: p.alpha,
            phase: p.phase
          });
        }

        // === 粒子连线（近邻连线，深度越深越淡） ===
        for (let i = 0; i < projected.length; i++) {
          for (let j = i + 1; j < projected.length; j++) {
            const pi = projected[i], pj = projected[j];
            // 3D 空间距离
            const d3 = Math.sqrt(
              (pi.rx - pj.rx) ** 2 + (pi.ry - pj.ry) ** 2 + (pi.rz - pj.rz) ** 2
            );
            if (d3 < 0.28) {
              const alpha = 0.08 * (1 - d3 / 0.28) * Math.min(pi.depth, pj.depth);
              ctx.strokeStyle = `rgba(74, 158, 255, ${alpha})`;
              ctx.lineWidth = 0.3;
              ctx.beginPath();
              ctx.moveTo(pi.sx, pi.sy);
              ctx.lineTo(pj.sx, pj.sy);
              ctx.stroke();
            }
          }
        }

        // === 粒子绘制 ===
        for (const p of projected) {
          const pulse = Math.sin(t * 1.8 + p.phase) * 0.5 + 0.5;
          const size = p.size * (1 + pulse * 0.3) * (0.4 + p.depth * 0.6);
          const alpha = p.alpha * (0.5 + pulse * 0.5) * (0.3 + p.depth * 0.7);

          if (alpha < 0.02) continue;

          // 蓝紫渐变：正面偏蓝，背面偏紫
          const t_ratio = 1 - p.depth;
          const r = Math.round(74 + t_ratio * 65);
          const g = Math.round(158 - t_ratio * 47);
          const b = Math.round(255 - t_ratio * 23);

          const pGrad = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, size * 2.5);
          pGrad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
          pGrad.addColorStop(0.5, `rgba(${r},${g},${b},${alpha * 0.5})`);
          pGrad.addColorStop(1, 'rgba(245, 240, 232, 0)');
          ctx.fillStyle = pGrad;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, size * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        this._aiBreathAnimId = requestAnimationFrame(render);
      };

      this._aiBreathAnimId = requestAnimationFrame(render);
      this._breathStartTime = performance.now();
      this._breathing = false;
      console.log('[LumiChat] AI 球形粒子效果已启动（静止模式）');
    },

    /**
     * 切换呼吸模式
     * @param {boolean} on - true=呼吸放大收缩, false=静止环绕
     */
    setBreathing(on) {
      this._breathing = on;
      console.log('[LumiChat] 呼吸模式:', on ? '开启' : '关闭');
    },

    stopAiBreath() {
      if (this._aiBreathAnimId) {
        cancelAnimationFrame(this._aiBreathAnimId);
        this._aiBreathAnimId = null;
      }
      const canvas = this.els.aiBreathCanvas;
      const parent = canvas ? canvas.parentElement : null;

      if (canvas) {
        // 呼吸后短暂微光残留
        canvas.classList.add('post-breath');
        canvas.classList.remove('active');
        parent.classList.remove('breathing');
        parent.classList.add('post-breath');

        setTimeout(() => {
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
          canvas.style.display = 'none';
          canvas.classList.remove('post-breath');
          if (parent) parent.classList.remove('post-breath');
        }, 600);
      }
      this._breathStartTime = null;
      console.log('[LumiChat] AI 呼吸效果已停止');
    },

    /* ==========================================
       EVENTS
       ========================================== */
    bindEvents() {
      // Start button
      this.els.startBtn.addEventListener('click', () => this.startSession());

      // Send button
      this.els.sendBtn.addEventListener('click', () => this.sendTextMessage());

      // Clear chat
      this.els.clearBtn.addEventListener('click', () => this.clearChat());

      // Mic button
      this.els.micBtn.addEventListener('click', () => {
        if (window.SpeechModule) {
          if (SpeechModule.getStatus() === 'listening') {
            SpeechModule.stopListening();
          } else {
            SpeechModule.startListening();
          }
        }
      });

      // Chat input
      this.els.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendTextMessage();
        }
      });

      // Toggle camera / switch camera
      this.els.toggleCamBtn.addEventListener('click', () => {
        if (this.state.videoSource === 'screen') {
          this.switchToCamera();
        } else if (window.CameraModule) {
          CameraModule.switchCamera().catch(function(err) {
            console.warn('[LumiChat] 切换摄像头:', err.message);
          });
        }
      });

      // Screenshare
      this.els.screenShareBtn.addEventListener('click', () => this.switchToScreen());

      // Floating agent click
      this.els.floatingAgent.addEventListener('click', () => {
        if (!this.state.sessionActive) {
          this.startSession();
        } else {
          document.getElementById('window-chat')?.scrollIntoView({ behavior: 'smooth' });
        }
      });

      // Close immersive music
      this.els.btnCloseImmersive.addEventListener('click', () => {
        this.showImmersiveMusic(false);
        // 恢复聊天界面
        if (this.els.chatMessages) this.els.chatMessages.style.display = 'flex';
        if (this.els.chatInputBar) this.els.chatInputBar.style.display = 'flex';
      });

      // Dock cursor toggle
      this.els.dockCursor.addEventListener('click', () => {
        this.els.dockCursor.classList.toggle('dock-btn-active');
      });

      // Dock mic toggle
      this.els.dockMic.addEventListener('click', () => {
        this.els.micBtn.click();
      });

      // Dock logo click - focus top
      this.els.dockLogo.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      // Camera retry button
      this.els.retryCamBtn.addEventListener('click', () => this.retryCamera());

      // Audio upload button
      if (this.els.uploadBtn) {
        this.els.uploadBtn.addEventListener('click', () => {
          if (this.els.audioFileInput) {
            this.els.audioFileInput.click();
          }
        });
      }

      // Audio file input change
      if (this.els.audioFileInput) {
        this.els.audioFileInput.addEventListener('change', (e) => {
          var file = e.target.files[0];
          if (file) {
            this.handleAudioUpload(file);
          }
          e.target.value = '';
        });
      }
    },

    /* ==========================================
       MODULES SETUP
       ========================================== */
    setupModules() {
      // Camera Module
      if (window.CameraModule) {
        CameraModule.onFrame = (base64) => {
          if (this.state.videoSource !== 'camera') return;
          this.state.lastFrame = base64;
          this.state.frameCount++;
        };

        CameraModule.onStatusChange = (status) => {
          const statusMap = {
            'initializing': ['连接中', 'inactive'],
            'active': ['已连接', 'active'],
            'paused': ['已暂停', 'inactive'],
            'error': ['错误', 'error'],
            'stopped': ['未连接', 'inactive']
          };
          const [text, cls] = statusMap[status] || ['未知', 'inactive'];
          this.updateDockStatus('camera', text, cls);
          if (status === 'active') {
            this.els.retryCamBtn.style.display = 'none';
            this.els.cameraOverlay.style.display = 'none';
          } else if (status === 'error') {
            this.els.retryCamBtn.style.display = 'inline-block';
            this.els.cameraOverlay.style.display = 'flex';
          } else if (status === 'stopped') {
            this.els.retryCamBtn.style.display = 'none';
            this.els.cameraOverlay.style.display = 'flex';
          }
        };
      }

      // ScreenShare Module
      if (window.ScreenShareModule) {
        ScreenShareModule.onFrame = (base64) => {
          if (this.state.videoSource !== 'screen') return;
          this.state.lastFrame = base64;
          this.state.frameCount++;
        };

        ScreenShareModule.onStatusChange = (status) => {};

        ScreenShareModule.onStop = () => {
          this.state.videoSource = 'none';
          if (this.state.sessionActive) {
            this.switchToCamera();
          }
        };
      }

      // Speech Module
      if (window.SpeechModule) {
        let speechDebounceTimer = null;
        SpeechModule.onResult = (text) => {
          if (text && text.trim()) {
            const trimmed = text.trim();
            // 防抖：500ms 内连续语音结果只处理最后一条
            if (speechDebounceTimer) clearTimeout(speechDebounceTimer);
            speechDebounceTimer = setTimeout(() => {
              speechDebounceTimer = null;
              this.handleUserSpeech(trimmed);
            }, 500);
          }
        };

        // 语音状态变化（仅 UI 更新，不触发呼吸效果）
        SpeechModule.onStatusChange = (status) => {
          const statusMap = {
            'idle': ['待命', 'inactive'],
            'listening': ['聆听中', 'active'],
            'processing': ['思考中', 'active'],
            'speaking': ['播报中', 'active']
          };
          const [text, cls] = statusMap[status] || ['', 'inactive'];
          this.updateDockStatus('mic', text, cls);

          if (this.els.voiceWave) {
            this.els.voiceWave.classList.toggle('active', status === 'listening');
          }

          if (this.els.micBtn) {
            this.els.micBtn.classList.toggle('active', status === 'listening');
          }

          if (this.els.dockMic) {
            this.els.dockMic.classList.toggle('dock-btn-active', status === 'listening');
          }

          if (status === 'listening') {
            this.updateFloatingAgent('聆听中...', 'active');
            this.updateFooter('🎤 聆听中...');
            this.setAgentGlow(null);
          } else if (status === 'speaking') {
            this.updateFloatingAgent('播报中', 'active');
            this.updateFooter('🔊 AI 播报中...');
            this.setAgentGlow('speaking');
          } else if (status === 'processing') {
            this.updateFooter('🧠 AI 思考中...');
            this.setAgentGlow('thinking');
          } else {
            this.updateFloatingAgent('就绪', 'idle');
            this.setAgentGlow(null);
          }
        };

        SpeechModule.onError = (err) => {
          console.warn('[LumiChat] 语音识别错误:', err.message);
          if (err && err.message && err.message.indexOf('麦克风未检测到声音') !== -1) {
            this.updateFooter('⚠️ 麦克风无法录音，请使用音频文件上传功能');
            this.state.speechUnavailable = true;
            this.showAudioUploadUI(true);
          }
        };

        SpeechModule.onSpeakStart = () => {
          // AI 开始说话 → 球体呼吸放大收缩
          this.setBreathing(true);
        };

        SpeechModule.onSpeakEnd = () => {
          // AI 说完话 → 球体回到静止环绕
          this.setBreathing(false);
          if (this.state.sessionActive) {
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

    /* ==========================================
       BACKGROUND PARTICLES
       ========================================== */
    initParticles() {
      const canvas = this.els.bgCanvas;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      let particles = [];
      let animId;

      const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      };
      window.addEventListener('resize', resize);
      resize();

      const count = Math.min(60, Math.floor(window.innerWidth * 0.03));
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          r: Math.random() * 1.5 + 0.5,
          alpha: Math.random() * 0.3 + 0.05
        });
      }

      const draw = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].x - particles[j].x;
            const dy = particles[i].y - particles[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 150) {
              ctx.beginPath();
              ctx.moveTo(particles[i].x, particles[i].y);
              ctx.lineTo(particles[j].x, particles[j].y);
              ctx.strokeStyle = `rgba(74, 158, 255, ${0.06 * (1 - dist / 150)})`;
              ctx.lineWidth = 0.5;
              ctx.stroke();
            }
          }
        }

        for (const p of particles) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(74, 158, 255, ${p.alpha})`;
          ctx.fill();
        }

        for (const p of particles) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
          if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
        }

        animId = requestAnimationFrame(draw);
      };

      draw();

      this._particleCleanup = () => {
        cancelAnimationFrame(animId);
        window.removeEventListener('resize', resize);
      };
    },

    /* ==========================================
       AGENT SPEAKING GLOW
       ========================================== */
    initCursorGlow() {
      const glow = this.els.cursorGlow;
      if (!glow) return;

      const agent = this.els.floatingAgent;
      if (!agent) return;

      let animId;

      const positionGlow = () => {
        const rect = agent.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        glow.style.transform = `translate(${cx - 60}px, ${cy - 60}px)`;
        animId = requestAnimationFrame(positionGlow);
      };
      positionGlow();

      this._cursorCleanup = () => {
        if (animId) cancelAnimationFrame(animId);
      };
    },

    setAgentGlow(state) {
      const glow = this.els.cursorGlow;
      if (!glow) return;
      glow.className = 'cursor-glow';
      if (state === 'speaking') {
        glow.classList.add('speaking');
      } else if (state === 'thinking') {
        glow.classList.add('thinking');
      }
    },

    /* ==========================================
       CLOCK
       ========================================== */
    initClock() {
      const update = () => {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        this.els.dockTime.textContent = `${h}:${m}`;
      };
      update();
      setInterval(update, 10000);
    },

    /* ==========================================
       FLOATING AGENT
       ========================================== */
    initFloatingAgent() {
      this.updateFloatingAgent('就绪', 'idle');
    },

    showFloatingAgent(show) {
      if (this.els.floatingAgent) {
        this.els.floatingAgent.style.display = show ? 'flex' : 'none';
      }
    },

    updateFloatingAgent(text, state) {
      if (this.els.agentStatusText) {
        this.els.agentStatusText.textContent = text || '就绪';
      }
      if (this.els.agentTooltipText) {
        if (state === 'active') {
          this.els.agentTooltipText.textContent = text || 'AI 工作中';
        } else {
          this.els.agentTooltipText.textContent = this.state.sessionActive ? '点击聚焦对话' : '点击开始对话';
        }
      }
    },

    /* ==========================================
       SESSION MANAGEMENT
       ========================================== */
    async startSession() {
      this.state.sessionActive = true;

      // 启动记忆模块
      if (window.MemoryModule) {
        MemoryModule.startSession();
      }

      this.els.startBtn.disabled = true;
      this.els.startBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg> 启动中...';

      const cameraPromise = (async () => {
        if (window.CameraModule) {
          try {
            await CameraModule.start({
              video: this.els.video,
              placeholder: null,
              width: 640,
              height: 480
            });
            this.state.videoSource = 'camera';
            this.updateSourceUI('camera');
          } catch (camErr) {
            console.warn('[LumiChat] 摄像头启动失败，纯语音模式:', camErr.message);
            if (camErr.name === 'EnvironmentError') {
              this.updateFooter('⚠️ 内嵌浏览器不支持摄像头，语音模式正常运行');
            } else {
              this.updateFooter('⚠️ 摄像头不可用，仅语音模式');
            }
            this.updateDockStatus('camera', '不可用', 'error');
            if (camErr.name === 'EnvironmentError' && this.els.retryCamBtn) {
              this.els.retryCamBtn.style.display = 'none';
            }
          }
        }
      })();

      this.els.welcomeScreen.style.display = 'none';
      this.els.chatInputBar.style.display = 'flex';
      this.els.startBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg> 对话中...';
      this.els.startBtn.disabled = true;

      // 启动球形粒子效果（静止环绕模式），替换对话栏
      this.startAiBreath();

      if (window.SpeechModule) {
        SpeechModule.detectSttAvailable().then(function(available) {
          if (available) {
            SpeechModule.startListening();
            this.updateFooter('🎤 对话已开始，请说话...');
            this.updateFloatingAgent('聆听中', 'active');
          } else {
            console.warn('[LumiChat] 语音识别不可用，切换到纯文本模式');
            this.updateFooter('⚠️ 麦克风不可用，请使用输入框或上传音频文件');
            this.updateDockStatus('mic', '不可用', 'error');
            this.updateFloatingAgent('文本模式', 'idle');
            this.state.speechUnavailable = true;
            this.showAudioUploadUI(true);
          }
        }.bind(this));
      } else {
        this.updateFooter('⚠️ 浏览器不支持语音识别，请使用输入框发送消息');
        this.state.speechUnavailable = true;
        this.updateFloatingAgent('文本模式', 'idle');
      }
      this.updateDockStatus('ai', '运行中', 'active');
      this.resetIdleTimer();

      try {
        await cameraPromise;
      } catch (_) {}
    },

    stopSession() {
      this.state.sessionActive = false;

      // 结束记忆模块（保存会话摘要 + 自我迭代）
      if (window.MemoryModule) {
        MemoryModule.endSession();
      }

      if (window.CameraModule) CameraModule.stop();
      if (window.ScreenShareModule) ScreenShareModule.stop();
      if (window.SpeechModule) {
        SpeechModule.stopListening();
        SpeechModule.stopSpeaking();
      }

      this.clearIdleTimer();
      this.state.videoSource = 'none';

      this.els.welcomeScreen.style.display = 'flex';
      this.els.chatMessages.style.display = 'none';
      this.els.chatInputBar.style.display = 'none';
      this.els.startBtn.disabled = false;
      this.els.startBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg> 开始对话';

      this.updateFooter('⏸ 对话已结束');
      this.updateFloatingAgent('就绪', 'idle');
      this.updateDockStatus('ai', '待命', 'inactive');
      this.updateDockStatus('camera', '未连接', 'inactive');
      this.updateDockStatus('mic', '待命', 'inactive');
      this.els.cameraOverlay.style.display = 'flex';
      this.els.footerSource.textContent = '📷 未连接';
    },

    /* ==========================================
       CHAT
       ========================================== */
    async handleUserSpeech(text, skipAdd) {
      console.log('[LumiChat] handleUserSpeech called:', text, 'isProcessing:', this.state.isProcessing, 'sessionActive:', this.state.sessionActive);
      if (this.state.isProcessing || !this.state.sessionActive) return;

      // 音乐播放中：优先检查音乐控制指令（下一首/上一首/暂停/退出等）
      // 注意：指令内会调用 SpeechModule.speak()，onSpeakEnd 回调会自动重启监听
      if (this.checkMusicControls(text)) {
        // 兜底：如果语音播报不可用，直接重启监听
        if (!window.SpeechModule || this.state.speechUnavailable) {
          setTimeout(() => { if (window.SpeechModule) SpeechModule.startListening(); }, 300);
        }
        return;
      }

      // 检查特殊指令（打开音乐等）
      // 注意：openMusicPlayer 内会调用 SpeechModule.speak()，onSpeakEnd 回调会自动重启监听
      if (this.checkSpecialCommands(text)) {
        // 兜底：如果语音播报不可用，直接重启监听
        if (!window.SpeechModule || this.state.speechUnavailable) {
          setTimeout(() => { if (window.SpeechModule) SpeechModule.startListening(); }, 300);
        }
        return;
      }

      // 设置处理锁，防止语音识别连续触发
      this.state.isProcessing = true;
      console.log('[LumiChat] isProcessing 设置为 true');

      if (window.SpeechModule && !this.state.speechUnavailable) SpeechModule.stopListening();

      if (!skipAdd) {
        ChatModule.addMessage('user', text, 'voice');
      }

      // === 启动 AI 球形粒子效果（静止模式） ===
      this.startAiBreath();

      this.updateFooter('✨ AI 回复中...');
      this.updateDockStatus('ai', '回复中', 'active');

      try {
        const image = this.state.lastFrame || null;
        const history = ChatModule.getHistory();
        const memoryCtx = window.MemoryModule ? MemoryModule.buildContextSummary() : '';

        // 流式接收
        let fullReply = '';
        await APIClient.sendChatStream(text, image, history, {
          onToken: (token) => {
            fullReply += token;
          },
          onDone: () => {},
          onError: (err) => {
            fullReply = '抱歉，出错了：' + err.message;
          }
        }, memoryCtx);

        const reply = fullReply || '（思考中...）';

        // 后台保存消息（不显示文字，纯视觉）
        ChatModule.addMessage('assistant', reply, 'text');

        // 存入记忆模块
        if (window.MemoryModule) {
          MemoryModule.saveExchange(text, reply);
        }

        // === 最短等待时间 3.5s（确保球体有一定展示时间） ===
        const elapsed = performance.now() - (this._breathStartTime || 0);
        const minDuration = 3500;
        if (elapsed < minDuration) {
          await new Promise(resolve => setTimeout(resolve, minDuration - elapsed));
        }

        // 智能体开始说话（SpeechModule.speak 内部触发 onSpeakStart → 开启呼吸）
        if (window.SpeechModule && !this.state.speechUnavailable) {
          this.updateFooter('🔊 AI 播报中...');
          this.updateFloatingAgent('播报中', 'active');
          SpeechModule.speak(reply);
        } else {
          this.updateFooter('✅ 已回复，请继续输入');
          this.updateFloatingAgent('就绪', 'idle');
        }

        this.updateDockStatus('ai', '已回复', 'active');

      } catch (err) {
        console.error('[LumiChat] API 错误:', err);
        this.stopAiBreath();
        ChatModule.addMessage('assistant',
          '抱歉，我遇到了一些问题：' + err.message + '\n\n请检查：\n1. 后端代理是否已启动 (node server/index.js)\n2. API 密钥是否正确配置 (.env 文件)\n3. 网络连接是否正常',
          'text'
        );
        this.updateFooter('❌ 请求失败: ' + err.message);
        if (window.SpeechModule && !this.state.speechUnavailable && this.state.sessionActive) {
          setTimeout(() => SpeechModule.startListening(), 1000);
        }
      } finally {
        this.state.isProcessing = false;
        this.resetIdleTimer();
        // 音乐模式下继续监听，实现边听边聊
        if (this.state.immersiveActive && window.SpeechModule && !this.state.speechUnavailable) {
          setTimeout(() => SpeechModule.startListening(), 500);
        }
      }
    },

    /**
     * 检查特殊指令
     */
    checkSpecialCommands(text) {
      const lowerText = text.toLowerCase();

      // "陪我听音乐" / "播放音乐" / "听音乐" / "来首xx的歌" 指令
      const musicTriggers = ['陪我听音乐', '播放音乐', '听音乐', '听歌', '打开音乐', '来首音乐', '来首歌', '放首歌', '放音乐', '听首歌'];
      const isMusicCommand = musicTriggers.some(t => lowerText.includes(t)) ||
        /(?:来首|放首|听首|播放|想听|要听).+歌/.test(text);

      if (isMusicCommand) {
        // 尝试提取搜索关键词
        let keywords = null;
        const searchPatterns = [
          /(?:播放|听|来首|放|想听|要听)(?:一首|个|首)?(.+?)(?:吧|吗|嘛|呢|呀|~|！|!|的)?$/,
          /(?:来首|放首|听首)(.+?)(?:吧|吗|嘛|呢|呀|~|！|!|的)?$/,
        ];
        for (const pattern of searchPatterns) {
          const match = text.match(pattern);
          if (match && match[1] && match[1].trim().length > 0) {
            keywords = match[1].trim();
            // 去掉末尾的"歌"字
            keywords = keywords.replace(/的歌?$/, '');
            break;
          }
        }
        this.openMusicPlayer(keywords);
        return true;
      }

      return false;
    },

    /**
     * 音乐播放中的语音控制指令（仅当音乐激活时生效）
     * 支持：下一首/上一首、暂停/继续、退出播放、播放指定歌曲
     */
    checkMusicControls(text) {
      if (!this.state.immersiveActive) return false;

      const lowerText = text.toLowerCase();

      // ── 下一首 ──
      if (/下一首|下一曲|切歌|换一首|换个歌|跳过$/.test(text)) {
        const nextIndex = this.state.currentSongIndex + 1 >= this.playlist.length ? 0 : this.state.currentSongIndex + 1;
        const nextSong = this.playlist[nextIndex];
        this.playNextSong();
        this.updateFooter('⏭ 下一首');
        if (window.SpeechModule) {
          SpeechModule.speak(nextSong ? '下一首，' + nextSong.title : '好的');
        }
        return true;
      }

      // ── 上一首 ──
      if (/上一首|上一曲|前一首|返回上一首/.test(text)) {
        const prevIndex = this.state.currentSongIndex - 1 < 0 ? this.playlist.length - 1 : this.state.currentSongIndex - 1;
        const prevSong = this.playlist[prevIndex];
        this.playPrevSong();
        this.updateFooter('⏮ 上一首');
        if (window.SpeechModule) {
          SpeechModule.speak(prevSong ? '上一首，' + prevSong.title : '好的');
        }
        return true;
      }

      // ── 暂停 ──
      if (/暂停播放|暂停$|暂停一下/.test(text)) {
        if (this.state.audioPlayer && !this.state.audioPlayer.paused) {
          this.state.audioPlayer.pause();
          this.updateFooter('⏸ 已暂停');
          if (window.SpeechModule) SpeechModule.speak('已暂停');
        }
        return true;
      }

      // ── 继续播放 / 播放（单独） ──
      if (/继续播放|继续$|^播放$|^播放吧$/.test(text)) {
        if (this.state.audioPlayer && this.state.audioPlayer.paused) {
          this.state.audioPlayer.play();
          this.updateFooter('▶ 继续播放');
          if (window.SpeechModule) SpeechModule.speak('好的');
        }
        return true;
      }

      // ── 退出播放 / 关闭音乐 ──
      if (/退出播放|关闭音乐|退出音乐|停止播放|不听了|关掉音乐|结束播放|关闭播放/.test(text)) {
        this.showImmersiveMusic(false);
        this.updateFooter('👋 音乐已关闭');
        ChatModule.addMessage('assistant', '好的，已经退出音乐播放~', 'text');
        if (window.SpeechModule) SpeechModule.speak('好的，音乐已关闭');
        return true;
      }

      // ── 播放指定歌曲（播放xxx / 来首xxx / 放一首xxx）──
      const playSongMatch = text.match(/(?:播放|来首|放首|放一首|放个|来一首|播一首)(?:一[首曲]|个)?(.+?)(?:吧|吗|嘛|呢|呀|~|！|!|的)?$/);
      if (playSongMatch && playSongMatch[1] && playSongMatch[1].trim().length >= 1) {
        let keywords = playSongMatch[1].trim();
        keywords = keywords.replace(/的歌?$/g, '');
        // 过滤掉太短的噪音词
        if (keywords.length >= 1 && !/^(歌|音乐|歌曲|曲|首)$/.test(keywords)) {
          console.log('[Music] 语音点歌:', keywords);
          this.updateFooter('🎵 正在搜索: ' + keywords);
          if (window.SpeechModule) SpeechModule.speak('好的，帮你找' + keywords);
          this.openMusicPlayer(keywords);
          return true;
        }
      }

      return false;
    },

    /**
     * 打开音乐播放器 - 从网易云获取真实歌曲
     */
    async openMusicPlayer(keywords) {
      console.log('[LumiChat] 打开沉浸式音乐可视化');

      // 添加AI消息 - 更自然的语气
      ChatModule.addMessage('assistant', '好呀，陪你听~ 已经打开啦', 'text');

      // 不隐藏聊天界面，保持语音对话可用（边听边聊）
      // 只隐藏欢迎界面，确保消息列表可见
      if (this.els.welcomeScreen) this.els.welcomeScreen.style.display = 'none';
      if (this.els.chatMessages) this.els.chatMessages.style.display = 'flex';
      if (this.els.chatInputBar) this.els.chatInputBar.style.display = 'flex';

      // 显示沉浸式音乐界面
      this.showImmersiveMusic(true);

      // 播报语音 - 简短自然
      if (window.SpeechModule) {
        SpeechModule.speak('好呀，陪你听');
      }

      this.updateFooter('🎵 正在搜索歌曲...');
      this.updateFloatingAgent('搜歌中', 'active');

      // 从网易云搜索歌曲
      try {
        const searchKeywords = keywords || '热门歌曲';
        const songs = await this.searchNeteaseSongs(searchKeywords, 10);

        if (songs && songs.length > 0) {
          // 构建播放列表（兼容官方API和第三方API两种格式）
          this.playlist = songs.map(song => ({
            title: song.title || song.name || '未知歌曲',
            artist: song.artist || (song.artists || song.ar)?.map(a => a.name).join(' / ') || '未知歌手',
            neteaseId: song.id,
            cover: song.cover || '',
            url: null, // 播放时再获取
            lyrics: null // 播放时再获取
          }));

          this.updateFooter('🎵 找到 ' + songs.length + ' 首歌，开始播放~');

          // 播放第一首
          setTimeout(() => {
            this.loadSong(0);
          }, 500);
        } else {
          // 备用：使用默认歌曲
          this.useFallbackPlaylist();
        }
      } catch (err) {
        console.error('[Music] 搜索歌曲失败:', err);
        this.useFallbackPlaylist();
      }

      return true;
    },

    /**
     * 使用备用播放列表（当网易云 API 不可用时）
     */
    useFallbackPlaylist() {
      this.playlist = [
        {
          title: '夏日微风',
          artist: '轻音乐',
          url: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112778.mp3',
          lyrics: [
            { time: 0, text: '🎵 夏日微风' },
            { time: 10, text: '微风轻轻吹过脸庞' },
            { time: 20, text: '阳光洒落在肩上' },
            { time: 30, text: '这一刻如此宁静' },
            { time: 40, text: '让心灵自由飞翔' },
            { time: 50, text: '音乐是最好的陪伴' }
          ]
        }
      ];
      this.updateFooter('🎵 使用备用歌曲');
      setTimeout(() => this.loadSong(0), 500);
    },

    sendTextMessage() {
      const text = this.els.chatInput.value.trim();
      if (!text || this.state.isProcessing) return;

      this.els.chatInput.value = '';
      ChatModule.addMessage('user', text, 'text');
      this.handleUserSpeech(text, true);
    },

    /* ==========================================
       AUDIO FILE UPLOAD
       ========================================== */
    showAudioUploadUI(show) {
      if (this.els.uploadBtn) {
        this.els.uploadBtn.style.display = show ? 'flex' : 'none';
      }
      if (this.els.hintUpload) {
        this.els.hintUpload.style.display = show ? 'block' : 'none';
      }
    },

    async handleAudioUpload(file) {
      if (this.state.isProcessing) return;

      this.state.isProcessing = true;
      this.showLoading(true);
      this.updateFooter('📁 正在识别音频文件...');
      this.updateFloatingAgent('识别中', 'active');

      try {
        var result = await SpeechModule.uploadAudioFile(file);
        if (result && result.trim()) {
          ChatModule.addMessage('user', result.trim(), 'voice');
          await this.handleUserSpeech(result.trim(), true);
        } else {
          this.updateFooter('⚠️ 未能识别音频内容');
        }
      } catch (err) {
        console.error('[LumiChat] 音频上传识别失败:', err);
        this.updateFooter('❌ 音频识别失败: ' + err.message);
        ChatModule.addMessage('assistant',
          '音频文件识别失败: ' + err.message + '\n\n请检查：\n1. 文件格式是否为 WAV、MP3、WEBM、OGG 或 M4A\n2. 文件大小是否小于 10MB\n3. 后端服务器是否正常运行',
          'text'
        );
      } finally {
        this.state.isProcessing = false;
        this.showLoading(false);
        this.resetIdleTimer();
      }
    },

    /* ==========================================
       CAMERA / SCREEN
       ========================================== */
    async switchToCamera() {
      if (this.state.videoSource === 'camera' || !this.state.sessionActive) return;

      try {
        this.els.toggleCamBtn.disabled = true;
        this.els.screenShareBtn.disabled = true;

        if (window.ScreenShareModule) ScreenShareModule.stop();

        if (window.CameraModule) {
          await CameraModule.start({
            video: this.els.video,
            placeholder: null
          });
          this.state.videoSource = 'camera';
          this.updateSourceUI('camera');
          this.els.cameraOverlay.style.display = 'none';
        }
      } catch (err) {
        console.error('[LumiChat] 切换到摄像头失败:', err);
      } finally {
        this.els.toggleCamBtn.disabled = false;
        this.els.screenShareBtn.disabled = false;
      }
    },

    async retryCamera() {
      if (!window.CameraModule || !this.state.sessionActive) return;

      this.els.retryCamBtn.disabled = true;
      this.els.retryCamBtn.textContent = '⏳ 重试中...';

      if (this.state.videoSource === 'screen' && window.ScreenShareModule) {
        ScreenShareModule.stop();
      }

      try {
        await CameraModule.start({
          video: this.els.video,
          placeholder: null
        });
        this.state.videoSource = 'camera';
        this.updateSourceUI('camera');
        this.els.retryCamBtn.style.display = 'none';
        this.updateFooter('📷 摄像头已重新连接');
      } catch (err) {
        this.updateFooter('❌ 摄像头重试失败: ' + (err.message || err.name || '未知错误'));
      } finally {
        this.els.retryCamBtn.disabled = false;
        this.els.retryCamBtn.textContent = '🔄 重试摄像头';
      }
    },

    async switchToScreen() {
      if (this.state.videoSource === 'screen' || !this.state.sessionActive) return;

      try {
        this.els.toggleCamBtn.disabled = true;
        this.els.screenShareBtn.disabled = true;

        if (window.CameraModule) CameraModule.pause();

        if (window.ScreenShareModule) {
          await ScreenShareModule.start({
            video: this.els.video,
            placeholder: null
          });
          this.state.videoSource = 'screen';
          this.updateSourceUI('screen');
          this.els.cameraOverlay.style.display = 'none';

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
        console.log('[LumiChat] 屏幕共享取消，回到摄像头模式');
        if (this.state.videoSource === 'camera') {
          if (window.CameraModule) CameraModule.resume();
        } else {
          if (window.CameraModule) {
            await CameraModule.start({
              video: this.els.video,
              placeholder: null
            });
            this.state.videoSource = 'camera';
            this.updateSourceUI('camera');
            this.els.cameraOverlay.style.display = 'none';
          }
        }
      } finally {
        this.els.toggleCamBtn.disabled = false;
        this.els.screenShareBtn.disabled = false;
      }
    },

    /* ==========================================
       UI UPDATES
       ========================================== */
    updateSourceUI(source) {
      if (source === 'camera') {
        this.els.footerSource.textContent = '📷 摄像头';
      } else if (source === 'screen') {
        this.els.footerSource.textContent = '🖥 屏幕共享';
      } else {
        this.els.footerSource.textContent = '📷 未连接';
      }
    },

    updateDockStatus(type, text, cls) {
      const el = type === 'camera' ? this.els.statusCamera :
                 type === 'mic' ? this.els.statusMic :
                 type === 'ai' ? this.els.statusAi : null;
      if (!el) return;

      const dot = el.querySelector('.status-dot');
      const label = el.querySelector('span:last-child');
      if (label) label.textContent = text;

      if (dot) {
        dot.className = 'status-dot';
        if (cls === 'active') dot.classList.add('active');
        else if (cls === 'error') dot.classList.add('error');
      }
    },

    clearChat() {
      if (window.ChatModule) ChatModule.clear();
      this.els.chatMessages.innerHTML = '';
      this.state.frameCount = 0;
      this.els.chatMessages.style.display = 'none';
      this.els.welcomeScreen.style.display = 'flex';
    },

    renderMessage(msg) {
      // 如果消息已存在，更新内容（流式渲染）
      var existing = this.els.chatMessages.querySelector('[data-id="' + msg.id + '"]');
      if (existing) {
        var existingBubble = existing.querySelector('.message-content');
        if (existingBubble) existingBubble.textContent = msg.content;
        this.els.chatMessages.scrollTop = this.els.chatMessages.scrollHeight;
        return;
      }

      const div = document.createElement('div');
      div.className = `message ${msg.role}`;
      div.dataset.id = msg.id;

      const bubble = document.createElement('div');
      bubble.className = 'message-content';
      bubble.textContent = msg.content;

      const time = document.createElement('div');
      time.className = 'message-time';
      if (window.Utils) {
        time.textContent = Utils.formatTime(msg.timestamp);
      } else {
        time.textContent = new Date(msg.timestamp).toLocaleTimeString();
      }
      if (msg.type === 'voice') {
        time.textContent += ' • 🎤';
      }

      div.appendChild(bubble);
      div.appendChild(time);

      this.els.chatMessages.appendChild(div);

      const welcome = this.els.welcomeScreen;
      if (welcome && welcome.style.display !== 'none') {
        welcome.style.display = 'none';
        this.els.chatMessages.style.display = 'flex';
      }

      this.els.chatMessages.scrollTop = this.els.chatMessages.scrollHeight;
    },

    showLoading(show) {
      if (this.els.chatLoading) {
        this.els.chatLoading.style.display = show ? 'flex' : 'none';
      }
    },

    updateFooter(text) {
      if (this.els.footerStatus) {
        this.els.footerStatus.textContent = text || '';
      }
    },

    resetIdleTimer() {
      this.clearIdleTimer();
      if (!this.config.idleFramePause) return;
      this.state.isIdle = false;
      this.state.idleTimer = setTimeout(() => {
        this.state.isIdle = true;
      }, 30000);
    },

    clearIdleTimer() {
      if (this.state.idleTimer) {
        clearTimeout(this.state.idleTimer);
        this.state.idleTimer = null;
      }
    }
  };

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
  } else {
    App.init();
  }

  window.App = App;
})();
