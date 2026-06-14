/**
 * netease.js
 * 网易云音乐 API 代理 (CommonJS)
 *
 * 提供端点:
 *   GET /api/netease/search?keywords=xxx    - 搜索歌曲
 *   GET /api/netease/song/url?id=xxx        - 获取歌曲播放链接
 *   GET /api/netease/lyric?id=xxx           - 获取歌词
 *
 * 基于 NeteaseCloudMusicApi npm 包
 */

'use strict';

const express = require('express');
const router = express.Router();

// 动态导入 NeteaseCloudMusicApi (该包同时支持 require 和 import)
let neteaseApi = null;
try {
  neteaseApi = require('NeteaseCloudMusicApi');
  console.log('[Netease] NeteaseCloudMusicApi 模块加载成功');
} catch (err) {
  console.warn('[Netease] NeteaseCloudMusicApi 模块未安装，API 代理将不可用');
  console.warn('[Netease] 请运行: npm install NeteaseCloudMusicApi');
}

/**
 * 辅助函数: 检查模块是否可用
 * @param {Object} res - Express response 对象
 * @returns {boolean} 是否可用
 */
function checkModuleAvailable(res) {
  if (!neteaseApi) {
    res.status(503).json({
      error: '网易云音乐 API 模块未安装',
      hint: '请运行 npm install NeteaseCloudMusicApi 安装依赖'
    });
    return false;
  }
  return true;
}

/**
 * 格式化歌曲搜索结果
 * @param {Array} songs - API 返回的歌曲列表
 * @returns {Array} 格式化后的列表
 */
function formatSearchResults(songs) {
  if (!songs || !Array.isArray(songs)) {
    return [];
  }

  return songs.map(function (song) {
    // 处理艺术家信息
    var artistName = '';
    if (song.ar && Array.isArray(song.ar)) {
      artistName = song.ar.map(function (a) { return a.name; }).join(', ');
    } else if (song.artists && Array.isArray(song.artists)) {
      artistName = song.artists.map(function (a) { return a.name; }).join(', ');
    }

    // 处理专辑信息
    var albumName = '';
    if (song.al && song.al.name) {
      albumName = song.al.name;
    } else if (song.album && song.album.name) {
      albumName = song.album.name;
    }

    return {
      id: String(song.id),
      title: song.name || '',
      artist: artistName,
      album: albumName,
      duration: song.dt || song.duration || 0
    };
  });
}

/**
 * 格式化歌词
 * @param {Object} lyricData - API 返回的歌词数据
 * @returns {Array} 格式化的歌词数组 [{time, text}, ...]
 */
function formatLyric(lyricData) {
  if (!lyricData) {
    return [];
  }

  // 获取原始歌词字符串
  var rawLyric = '';
  if (lyricData.lrc && lyricData.lrc.lyric) {
    rawLyric = lyricData.lrc.lyric;
  } else if (typeof lyricData === 'string') {
    rawLyric = lyricData;
  }

  if (!rawLyric) {
    return [];
  }

  // 解析 LRC 格式
  var lines = rawLyric.split('\n');
  var lyrics = [];

  // 匹配 [mm:ss.xx] 或 [mm:ss] 格式的时间标签
  var timeRegex = /\[(\d{1,3}):(\d{2})(?:\.(\d{2,3}))?\]/g;

  lines.forEach(function (line) {
    line = line.trim();
    if (!line) return;

    // 提取所有时间标签
    var times = [];
    var match;
    while ((match = timeRegex.exec(line)) !== null) {
      var minutes = parseInt(match[1], 10);
      var seconds = parseInt(match[2], 10);
      var milliseconds = 0;
      if (match[3]) {
        milliseconds = parseInt(match[3], 10);
        // 如果是两位数，乘以10转为毫秒
        if (match[3].length === 2) {
          milliseconds *= 10;
        }
      }
      var totalSeconds = minutes * 60 + seconds + milliseconds / 1000;
      times.push(totalSeconds);
    }

    // 提取文本（去除时间标签）
    var text = line.replace(timeRegex, '').trim();

    // 跳过纯元数据行
    if (!text) return;
    if (/^\[(ti|ar|al|by|offset):/.test(line.toLowerCase())) return;

    // 每个时间标签对应一行歌词
    times.forEach(function (t) {
      lyrics.push({ time: t, text: text });
    });
  });

  // 按时间排序
  lyrics.sort(function (a, b) {
    return a.time - b.time;
  });

  return lyrics;
}

// ==================== 路由端点 ====================

/**
 * GET /search?keywords=xxx
 * 搜索歌曲
 */
router.get('/search', async function (req, res) {
  if (!checkModuleAvailable(res)) return;

  var keywords = req.query.keywords;

  if (!keywords || !keywords.trim()) {
    console.log('[Netease] 搜索请求缺少 keywords 参数');
    return res.status(400).json({ error: '缺少 keywords 参数' });
  }

  console.log('[Netease] 搜索:', keywords);

  try {
    var result = await neteaseApi.search({
      keywords: keywords.trim(),
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 20,
      type: 1 // 1 = 单曲
    });

    if (result.body && result.body.result && result.body.result.songs) {
      var songs = formatSearchResults(result.body.result.songs);

      console.log('[Netease] 搜索完成, 结果数:', songs.length);
      res.json({
        success: true,
        keywords: keywords,
        total: result.body.result.songCount || songs.length,
        songs: songs
      });
    } else {
      console.log('[Netease] 搜索无结果');
      res.json({
        success: true,
        keywords: keywords,
        total: 0,
        songs: []
      });
    }
  } catch (err) {
    console.error('[Netease] 搜索失败:', err.message);
    res.status(500).json({
      error: '搜索失败',
      message: err.message
    });
  }
});

/**
 * GET /song/url?id=xxx
 * 获取歌曲播放链接
 */
router.get('/song/url', async function (req, res) {
  if (!checkModuleAvailable(res)) return;

  var songId = req.query.id;

  if (!songId) {
    console.log('[Netease] 获取歌曲 URL 缺少 id 参数');
    return res.status(400).json({ error: '缺少 id 参数' });
  }

  console.log('[Netease] 获取歌曲 URL, id:', songId);

  try {
    var result = await neteaseApi.song_url({
      id: songId,
      br: 320000 // 320kbps 高质量
    });

    if (result.body && result.body.data && result.body.data.length > 0) {
      var songData = result.body.data[0];
      var url = songData.url || null;

      if (url) {
        console.log('[Netease] 歌曲 URL 获取成功, id:', songId);
      } else {
        console.log('[Netease] 歌曲无可用播放链接, id:', songId);
      }

      res.json({
        success: true,
        id: songId,
        url: url,
        br: songData.br || 0,
        size: songData.size || 0,
        type: songData.type || ''
      });
    } else {
      console.log('[Netease] 未找到歌曲, id:', songId);
      res.json({
        success: true,
        id: songId,
        url: null
      });
    }
  } catch (err) {
    console.error('[Netease] 获取歌曲 URL 失败:', err.message);
    res.status(500).json({
      error: '获取播放链接失败',
      message: err.message
    });
  }
});

/**
 * GET /lyric?id=xxx
 * 获取歌词
 */
router.get('/lyric', async function (req, res) {
  if (!checkModuleAvailable(res)) return;

  var songId = req.query.id;

  if (!songId) {
    console.log('[Netease] 获取歌词缺少 id 参数');
    return res.status(400).json({ error: '缺少 id 参数' });
  }

  console.log('[Netease] 获取歌词, id:', songId);

  try {
    var result = await neteaseApi.lyric_new({
      id: songId
    });

    if (result.body) {
      var lyrics = formatLyric(result.body);

      console.log('[Netease] 歌词获取成功, id:', songId, '行数:', lyrics.length);
      res.json({
        success: true,
        id: songId,
        lyrics: lyrics,
        // 附带一些额外信息
        hasTlyric: !!(result.body.tlyric && result.body.tlyric.lyric), // 翻译歌词
        hasRlyric: !!(result.body.rlyric && result.body.rlyric.lyric)  // 罗马音歌词
      });
    } else {
      console.log('[Netease] 未找到歌词, id:', songId);
      res.json({
        success: true,
        id: songId,
        lyrics: []
      });
    }
  } catch (err) {
    console.error('[Netease] 获取歌词失败:', err.message);
    res.status(500).json({
      error: '获取歌词失败',
      message: err.message
    });
  }
});

console.log('[Netease] 网易云音乐 API 代理模块已加载');

module.exports = router;