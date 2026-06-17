/**
 * 网易云音乐开放平台官方 API 客户端
 * 使用 RSA SHA256 签名认证
 */
const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');

// 配置
const CONFIG = {
  appId: 'b3010d00000000007226c259bc4d150e',
  appSecret: 'de27e5007562eb7dcb5c1824d746ff03',
  privateKey: `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCdfzD0/Bu0c4Z5
pe6XL7dTd/6ufrkxoIIhkqaSldzoOg+sFIFYHhSOUW/9AJzBjkfNTefLVeZHW+P4
b1rBTgqr9PBsRxhN+ieewx12LT2h1FNwvygY3dfPz9FRm3wWXnBiQafx1WbpcDPg
f2bR/x8WqCWiTOrp61BTTpgUD6dlxWSXIYBEu2HTzv77o8dS8urLOfp0WyM9QWW3
nckrmNjxusFAyfA4M4TxwaNrYD8eqKCfr8ISkzDo/+09EwlA0jAVE+NR73pboJWp
hdW5aHJQVg7gdj2V/YCrXsF9jBJB/kyMocewHNudUAgQ9yaqv281ap0embRYxFga
46T8tUenAgMBAAECggEASA91dWnSPUasTQV0PF1bKkgZUXpuvnubfsPsDd6es+w4
1nmNUqV0r0coj6BTmKXCSXevKhQz6Attq3I7mn1cGaBYzpnaz3a44QWR+cuqStxs
jwYPUQ1TnGQP+CBFbrCoB/TVZCtJSl6JhdqUz1lEvqeRjIhX5U5CstMfdvJQm5m0
8Nl8bZUDt9rT5U3tKYfbxPIYhZA8ERcfDM6OwrUWKRFewK8dE9SrJml+Sjxn77aD
rGjv/WZonhj0Do40kkXOnQH9Ubm3yz0yw2KH1wsE7umJSlrVVgEVPhIL4swfEFDW
8JqvRWcnCGkXzO7nU+vRrEc+my8hatPlTVfeaCF0iQKBgQDLhTVK7nSW6GKc8vOx
bAh1XRbku2IDcXaHNz0cKtPK09XKTgO3Py/fhJSCQkKpo3pxbYoBSUcQ4z59+oKB
RvM5YulN2i6XWhUn9Xw8PUR7E2BuSLe8MW+ZgjeY3FNEcwXVShx6196BDxquYPtl
3+HfRzEjVjWpA3Iofh7VfTisaQKBgQDGG+DECkJtbVDv6Idbnoj75ZpWHFe8N3Tu
DH5Wr+DtQ2hhB7NlLQbQUn7ZLwAeomtDJyEB0UoPEkD7ogLZ1nIf9G7oBwdfMTn2
zSXekt04Zp9fIxDfi5ewZnH39Gxz1kVbNvs0HGYVVmb335/9gPoOIWYUpg0Vyaq3
5NCg5ooRjwKBgHo1NegVweqwBi8KcCy0m2umB043+sXohuzwzYAxc1XS2AiPyglq
JtwH54lEMnVc1fRwezMEhmjsm6TYHS91pC1saH24Ksv1asjAzuX5QDrLStdOUQ3v
fXznRW1Dt7hdfT4zL2DQaSqEIFhfofXtdts1C5uVc8lWaWFJQkid1b8pAoGAKrmc
ceschGkNCZCGkLXSKTFNZcDbExaKu0QqgxuPUNw2yKZWhD1/uLHx9Xjzd6fjpins
Lm4qoLF5HkvEfaKIHmgi+xt49YiyTY3U2vmliCJpwKTZYLzETCDr92PZd+oALzne
V1DAm110+4RZBt0oEKAXWeCt9cL2dI5+iBTwNfUCgYEAkE/MsR2x32sSRsQz+Xw+
9X2X43bLXy1elg9HKVQNCmW1NZD0OejI5DBilE80kEO8xB4//ZKy59l6B7888YK5
9SC7mpjvb9tNibggcR70+jQF5EzMCz0ccFUCoLjDhTrgJefp63M9V4DVSY/Kxvt7
6j2VDyZpnl1wZ1DEszCTqwY=
-----END PRIVATE KEY-----`,
  publicKey: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnX8w9PwbtHOGeaXuly+3
U3f+rn65MaCCIZKmkpXczoOg+sFIFYHhSOUW/9AJzBjkfNTefLVeZHW+P4b1rBTg
qr9PBsRxhN+ieewx12LT2h1FNwvygY3dfzP9FRm3wWXnBiQafx1WbpcDPgf2bR/x
8WqCWiTOrp61BTTpgUD6dlxWSXIYBEu2HTzv77o8dS8urLOfp0WyM9QWW3nckrmN
jrxBsUDJ8DgzhPHBo2tgPx6ooJ+vwhKTMOj/7T0TCUDSMBUT41HveluglamF1blo
clBWDuB2PZX9gKtewX2MEkH+TIyhx7Ac251QCHD3Jqq/bzVqnR6ZtFjEWBrjpPy1
R6cCAwEAAQ==
-----END PUBLIC KEY-----`,
  baseUrl: 'https://openapi.music.163.com',
  device: JSON.stringify({
    deviceType: 'andrcar',
    os: 'andrcar',
    appVer: '6.0.0',
    channel: 'netease',
    model: 'GDI-W09',
    deviceId: 'bnVsbAkwMjowMDowMDowMDowMDowMAk5NTQ5NzA3YTg1NmE1MDY2CW51bGw=',
    brand: 'netease',
    osVer: '14',
    clientIp: '127.0.0.1',
    netStatus: '4g',
    flowFlag: 'init'
  })
};

// 匿名 token 缓存
let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * RSA SHA256 签名
 */
function rsaSign(content, privateKeyPem) {
  const sign = crypto.createSign('SHA256');
  sign.update(content);
  sign.end();
  return sign.sign(privateKeyPem, 'base64');
}

/**
 * 格式化参数为待签名字符串
 * 按 key ASCII 排序，剔除 sign 和空值，用 & 连接
 */
function formatParameters(params) {
  const filtered = {};
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'sign' && value !== '' && value !== null && value !== undefined) {
      filtered[key] = value;
    }
  }
  const sorted = Object.keys(filtered).sort();
  return sorted.map(k => {
    let val = filtered[k];
    if (typeof val === 'boolean') val = val.toString().toLowerCase();
    else val = String(val);
    return `${k}=${val}`;
  }).join('&');
}

/**
 * 发送签名请求
 */
async function signedRequest(endpoint, bizParams = {}) {
  const timestamp = Date.now();

  const params = {
    appId: CONFIG.appId,
    timestamp: timestamp,
    device: CONFIG.device,
    signType: 'RSA_SHA256',
    ...bizParams
  };

  // 如果有 token，加上 accessToken
  if (cachedToken && timestamp < tokenExpiresAt) {
    params.accessToken = cachedToken;
  }

  // 生成签名
  const content = formatParameters(params);
  const sign = rsaSign(content, CONFIG.privateKey);

  // 只有 sign 需要 URL 编码（匹配官方 Python 示例）
  params.sign = encodeURIComponent(sign);

  // 手动拼接 URL（device 等 JSON 参数不编码，匹配官方示例）
  const urlPairs = [];
  for (const [k, v] of Object.entries(params)) {
    urlPairs.push(`${k}=${v}`);
  }
  const url = `${CONFIG.baseUrl}${endpoint}?${urlPairs.join('&')}`;

  // 调试：打印请求 URL（隐藏敏感信息）
  console.log(`[NeteaseAPI] 请求: ${endpoint} (${urlPairs.length} params)`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  console.log(`[NeteaseAPI] 响应 (${response.status}):`, JSON.stringify(data).substring(0, 300));
  return data;
}

/**
 * 匿名登录获取 accessToken
 */
async function getAnonymousToken() {
  // 检查缓存
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  console.log('[NeteaseAPI] 获取匿名 token...');
  const data = await signedRequest('/openapi/music/basic/oauth2/login/anonymous', {
    bizContent: JSON.stringify({ clientId: CONFIG.appId })
  });

  if (data.code === 200 && data.data && data.data.accessToken) {
    cachedToken = data.data.accessToken;
    tokenExpiresAt = Date.now() + (data.data.expiresIn || 7200) * 1000;
    console.log('[NeteaseAPI] token 获取成功，有效期:', data.data.expiresIn, '秒');
    return cachedToken;
  }

  console.error('[NeteaseAPI] token 获取失败:', data);
  throw new Error('获取匿名 token 失败: ' + (data.msg || data.message || '未知错误'));
}

/**
 * 综合搜索
 */
async function search(keywords, limit = 10, offset = 0) {
  const data = await signedRequest('/openapi/music/basic/search/get', {
    bizContent: JSON.stringify({
      clientId: CONFIG.appId,
      keywords: keywords,
      limit: limit,
      offset: offset,
      type: 1  // 1=单曲
    })
  });

  if (data.code === 200 && data.data) {
    // 解析搜索结果
    const songs = [];
    const result = data.data;

    // 搜索返回结构: data.data.songList 或 data.data.songs
    const songList = result.songList || result.songs || [];
    for (const item of songList) {
      songs.push({
        id: String(item.id || item.songId || ''),
        title: item.name || item.songName || '未知歌曲',
        artist: item.artists
          ? item.artists.map(a => a.name).join('/')
          : (item.artistName || item.singer || '未知歌手'),
        album: item.album ? item.album.name : (item.albumName || ''),
        duration: item.duration || 0,
        cover: item.album ? (item.album.picUrl || item.album.cover) : (item.coverUrl || '')
      });
    }
    return songs;
  }

  console.error('[NeteaseAPI] 搜索失败:', data);
  return [];
}

/**
 * 获取歌曲播放 URL
 */
async function getSongUrl(songId, quality = 'standard') {
  // 质量等级映射: standard=标准, higher=较高, exhigh=极高, lossless=无损
  const brMap = {
    'standard': '128000',
    'higher': '192000',
    'exhigh': '320000',
    'lossless': '999000'
  };
  const br = brMap[quality] || '320000';

  const data = await signedRequest('/openapi/music/basic/song/url/get', {
    bizContent: JSON.stringify({
      clientId: CONFIG.appId,
      songIds: [String(songId)],
      br: br,
      level: quality
    })
  });

  if (data.code === 200 && data.data && data.data.length > 0) {
    const songData = data.data[0];
    return {
      url: songData.url || songData.src || '',
      br: songData.br || 0,
      size: songData.size || 0,
      type: songData.type || '',
      md5: songData.md5 || ''
    };
  }

  console.error('[NeteaseAPI] 获取歌曲URL失败:', data);
  return null;
}

/**
 * 获取歌词
 */
async function getLyric(songId) {
  const data = await signedRequest('/openapi/music/basic/lyric/get', {
    bizContent: JSON.stringify({
      clientId: CONFIG.appId,
      songId: String(songId)
    })
  });

  if (data.code === 200 && data.data) {
    return {
      lrc: data.data.lrc ? data.data.lrc.lyric : null,
      tlyric: data.data.tlyric ? data.data.tlyric.lyric : null,  // 翻译歌词
      klyric: data.data.klyric ? data.data.klyric.lyric : null   // 逐字歌词
    };
  }

  console.error('[NeteaseAPI] 获取歌词失败:', data);
  return null;
}

/**
 * 获取歌曲详情
 */
async function getSongDetail(songId) {
  const data = await signedRequest('/openapi/music/basic/song/detail/get/v2', {
    bizContent: JSON.stringify({
      clientId: CONFIG.appId,
      songIds: [String(songId)]
    })
  });

  if (data.code === 200 && data.data && data.data.songs && data.data.songs.length > 0) {
    const song = data.data.songs[0];
    return {
      id: String(song.id),
      title: song.name || '未知歌曲',
      artist: song.ar ? song.ar.map(a => a.name).join('/') : '未知歌手',
      album: song.al ? song.al.name : '',
      albumId: song.al ? String(song.al.id) : '',
      cover: song.al ? song.al.picUrl : '',
      duration: song.dt || 0  // 毫秒
    };
  }

  console.error('[NeteaseAPI] 获取歌曲详情失败:', data);
  return null;
}

/**
 * 使用 Web API + Cookie 获取歌曲 URL（支持 VIP 歌曲）
 */
async function getSongUrlWithCookie(songId, cookie) {
  if (!cookie) return null;

  try {
    console.log('[NeteaseAPI] 使用 Cookie 获取歌曲 URL:', songId);

    // 加密参数（weapi 格式）
    const text = JSON.stringify({
      ids: [String(songId)],
      br: 320000,
      encodeType: 'aac'
    });
    const secretKey = crypto.randomBytes(16).toString('hex');
    const aesKey = Buffer.from(secretKey, 'hex');
    const iv = Buffer.from('0102030405060708', 'hex');
    const aesCipher = crypto.createCipheriv('aes-128-cbc', aesKey, iv);
    aesCipher.setAutoPadding(false);
    let encrypted = aesCipher.update(Buffer.from(text));
    encrypted = Buffer.concat([encrypted, aesCipher.final()]);
    const encryptedText = encrypted.toString('base64');

    const foreKey = Buffer.from('0CoJUm6Qyw8WRRjud', 'utf8');
    const foreIv = Buffer.from('0102030405060708', 'hex');
    const foreCipher = crypto.createCipheriv('aes-128-cbc', foreKey, foreIv);
    foreCipher.setAutoPadding(false);
    let foreEncrypted = foreCipher.update(Buffer.from(encryptedText));
    foreEncrypted = Buffer.concat([foreEncrypted, foreCipher.final()]);
    const params = foreEncrypted.toString('base64');

    const rsaPlain = `ts${Date.now()}u${secretKey}e0`;
    const rsaKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2LZ3nWWtqTga1bTRvI4Ea
Kgta2dxPJDcByH/mPp8km6mXTEB0E/3lE8n0iNtDnvdM/YQpJf3VQH6gJjhRqNxD9
l5J3p5vSn2v0eGKgUqB0e6hMz5J7XzJ+gMh6vJ3J3vJ3J3vJ3J3vJ3J3vJ3J3vJ3J3
vQIDAQAB
-----END PUBLIC KEY-----`;
    const encSecKey = crypto.publicEncrypt({ key: rsaKey, padding: crypto.constants.RSA_NO_PADDING }, Buffer.from(rsaPlain)).toString('hex');

    const response = await fetch('https://music.163.com/weapi/song/enhance/player/url/v1', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookie,
        'Referer': 'https://music.163.com/'
      },
      body: new URLSearchParams({
        params: params,
        encSecKey: encSecKey
      }).toString()
    });

    const data = await response.json();
    if (data.code === 200 && data.data?.[0]?.url) {
      const songData = data.data[0];
      console.log('[NeteaseAPI] Cookie 获取成功, br:', songData.br, 'type:', songData.type);
      return {
        url: songData.url,
        br: songData.br || 0,
        size: songData.size || 0,
        type: songData.type || '',
        md5: songData.md5 || ''
      };
    }
    console.log('[NeteaseAPI] Cookie 获取失败, code:', data.code, 'msg:', data.message || '');
  } catch (e) {
    console.error('[NeteaseAPI] Cookie 获取异常:', e.message);
  }
  return null;
}

// 初始化时自动获取 token
getAnonymousToken().catch(err => console.warn('[NeteaseAPI] 初始化 token 失败:', err.message));

module.exports = {
  getAnonymousToken,
  search,
  getSongUrl,
  getSongUrlWithCookie,
  getLyric,
  getSongDetail,
  CONFIG
};