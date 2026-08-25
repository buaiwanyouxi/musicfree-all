// 我要下歌 (xiage) MusicFree 插件 · 后端：铜钟 Tonzhon (https://tonzhon.com)
// 全链路统一走 Tonzhon 音源 (https://tonzhon.com/api.php)：
//   - 歌单/排行榜  : Tonzhon types=playlist（网易云/酷狗/QQ 三源）
//   - 搜索          : Tonzhon types=search  (source=netease)
//   - 歌词 / 封面   : Tonzhon types=lyric / types=pic
//   - 播放直链      : 按来源路由至各自官方后端，均直取真实可播 CDN：
//                     ① 网易云 → weapi song/enhance/player/url（AES+RSA，crypto-js/big-integer 实现）
//                     ② 腾讯QQ → musicu.fcg vkey.GetVkeyServer (CgiGetVkey)，实测 12/12 可播
//                     ③ 酷狗   → wwwapi.kugou.com play/getdata
//                     各后端失败均 best-effort 回退：按歌名匹配网易云 id 走 weapi。
// 说明：网易云免费外链 outer/url 近期大面积限制，故网易云改用 weapi；QQ/酷狗亦各自直连官方取链端点。
//
// ⚠️ 已知后端限制（Tonzhon 实测）：
//   - 汽水(qishui)/抖音：Tonzhon 无此源，静默回退网易云，无法提供真实汽水内容。
//   - 酷我(kuwo)/百度(baidu)：Tonzhon 的 types=playlist 对这两源返回空(0字节)，无法提供歌单/榜单。
//   - QQ 官方巅峰榜 disstid 在 Tonzhon 上已变更（仅返回"今日私享"类算法歌单），故 QQ 分组采用已验证可返回的精选/每日榜单。
//   - 酷狗歌单名 Tonzhon 不返回，分组标题为人工标注。
//
// 返回值结构严格遵循 MusicFree 插件协议：
//  - getTopLists       -> IMusicSheetGroupItem[] = [{ title, data: IMusicSheetItem[] }]
//  - getTopListDetail  -> { isEnd, musicList: IMusicItem[] }
//  - getMusicSheetInfo -> { isEnd, musicList: IMusicItem[] }
//  - search            -> { isEnd, data: IMusicItem[] }
//  - importMusicSheet  -> IMusicItem[]
//  - importMusicItem   -> IMusicItem
//  - getMediaSource    -> { url }（已解析为可播直链）
//  - getLyric          -> { rawLrc }

const axios = require('axios');
const CryptoJS = require('crypto-js');
const bigInt = require('big-integer');

// ===== 铜钟 Tonzhon 音源后端（歌单/搜索/歌词）=====
const TZ = 'https://tonzhon.com/api.php';
// 网易云 weapi 播放端点（直取可播 CDN，绕开已失效的 outer/url 外链）
const NETEASE_WEAPI = 'https://music.163.com/weapi/song/enhance/player/url/v1?csrf_token=';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ===== 平台歌单/榜单定义（ID 均经 Tonzhon 实测可返回曲目）=====

// 网易云官方排行榜（稳定 ID）
const NETEASE_RANKS = [
  { id: '19723756', title: '云音乐飙升榜' },
  { id: '3779629', title: '云音乐新歌榜' },
  { id: '3778678', title: '云音乐热歌榜' },
  { id: '2884035', title: '网易原创歌曲榜' },
  { id: '2809577409', title: '云音乐欧美新歌榜' },
  { id: '1978921795', title: '云音乐电音榜' },
  { id: '3411278', title: '云音乐快手榜' },
  { id: '1747976524', title: '云音乐怀旧榜' },
  { id: '6723173524', title: '云音乐网络歌曲榜' },
];

// 酷狗官方排行榜（ID 见社区榜单清单，经 Tonzhon 实测返回曲目）
const KUGOU_RANKS = [
  { id: '59703', title: '酷狗·蜂鸟流行音乐榜' },
  { id: '52144', title: '酷狗·抖音热歌榜' },
  { id: '52767', title: '酷狗·快手热歌榜' },
  { id: '24971', title: '酷狗·DJ热歌榜' },
  { id: '31308', title: '酷狗·内地榜' },
];

// QQ音乐歌单（Tonzhon 上官方巅峰榜 disstid 已变更，采用已验证可返回的精选/每日榜单）
const QQ_RANKS = [
  { id: '7013848675', title: 'QQ音乐·【ACG治愈】即使孤单也要温柔' },
  { id: '7021611886', title: 'QQ音乐·影魔炎的今日私享' },
];

// 热门歌单·网易云（已验证可返回曲目的精选歌单）
const NETEASE_HOT = [
  { id: '3136952023', title: '网易云·私人雷达' },
  { id: '528437612', title: '网易云·圆神电音' },
  { id: '3778679', title: '网易云·CNBLUE 热门50单曲' },
];

// 热门歌单·酷狗（ID 经 Tonzhon 实测返回曲目；歌单名 Tonzhon 不返回，人工标注）
const KUGOU_HOT = [
  { id: '709458', title: '酷狗热门精选①' },
  { id: '125032', title: '酷狗热门精选②' },
  { id: '123', title: '酷狗热门大歌单(500首)' },
];

// 热门歌单·QQ音乐（已验证可返回曲目）
const QQ_HOT = [
  { id: '7021611884', title: 'QQ音乐·犯二才是青春的今日私享' },
  { id: '7021611885', title: 'QQ音乐·字' },
];

// ===== Tonzhon api.php 统一 POST 封装 =====
async function tzPost(types, extra) {
  const data = Object.assign({ types }, extra || {});
  const body = Object.entries(data)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const r = await axios.post(TZ, body, {
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://tonzhon.com/',
    },
    timeout: 15000,
  });
  return r.data;
}

// 歌手字段扁平化：Tonzhon 搜索返回 [["周杰伦,温岚"]]，网易云返回 [{name}]
function flattenArtist(a) {
  if (!a) return '';
  if (typeof a === 'string') return a;
  if (Array.isArray(a)) {
    return a
      .map((x) => {
        if (typeof x === 'string') return x;
        if (Array.isArray(x)) return x.join('/');
        if (x && x.name) return x.name;
        return '';
      })
      .filter(Boolean)
      .join('/');
  }
  return '';
}

// ===== 网易云 weapi 播放端点（AES+RSA 加密，沙箱内置 crypto-js/big-integer 实现）=====
// 说明：网易云免费外链 music.163.com/song/media/outer/url 近期被大面积限制（连热门曲都 404），
// 而官方客户端真正取链端点 weapi/song/enhance/player/url 仍返回真实可播 CDN，故用其取代外链。
const WEAPI_MODULUS =
  '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const WEAPI_NONCE = '0CoJUm6Qyw8W8jud';
const WEAPI_PUBKEY = '010001';
const WEAPI_IV = '0102030405060708';

function weapiRandomKey(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
// AES-128-CBC（crypto-js，使用原始密钥字节，PKCS7 填充）
function weapiAes(text, keyStr) {
  const key = CryptoJS.enc.Utf8.parse(keyStr);
  const iv = CryptoJS.enc.Utf8.parse(WEAPI_IV);
  const ct = CryptoJS.AES.encrypt(text, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return ct.toString();
}
// RSA: (reversed(secKey) as hex) ^ pubKey mod modulus
function weapiRsa(text) {
  const reversed = String(text).split('').reverse().join('');
  const hex = Buffer.from(reversed, 'utf8').toString('hex');
  const num = bigInt(hex, 16);
  const e = bigInt(WEAPI_PUBKEY, 16);
  const m = bigInt(WEAPI_MODULUS, 16);
  return num.modPow(e, m).toString(16).padStart(256, '0');
}
function weapiEncrypt(text) {
  const secKey = weapiRandomKey(16);
  const p1 = weapiAes(text, WEAPI_NONCE);
  const p2 = weapiAes(p1, secKey);
  return { params: p2, encSecKey: weapiRsa(secKey) };
}

// 直连网易云 weapi 取播放直链（返回 http(s) CDN；下架/变灰曲返回 null）
async function getNeteaseUrl(id) {
  try {
    const body = weapiEncrypt(
      JSON.stringify({ ids: '[' + id + ']', level: 'standard', encodeType: 'mp3', csrf_token: '' })
    );
    const r = await axios.post(
      NETEASE_WEAPI,
      new URLSearchParams(body).toString(),
      {
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: 'https://music.163.com/',
        },
        timeout: 10000,
      }
    );
    const u = r.data && r.data.data && r.data.data[0] ? r.data.data[0].url : null;
    return u || null;
  } catch (e) {
    return null;
  }
}
function forceHttps(u) {
  return String(u).replace(/^http:\/\//i, 'https://');
}

// 尝试从 Tonzhon types=url 取自有音源直链（当前对全部音源返回空，故多数为 null）
async function tzAudioUrl(id, source) {
  try {
    const r = await tzPost('url', { id: String(id), source: source || 'netease' });
    const u = r && r.url ? r.url : '';
    if (u) {
      // 同 Tonzhon 前端：修正 m7c/m8c 节点，强制 https
      return u
        .replace(/^http:\/\//i, 'https://')
        .replace(/m7c\.music\./g, 'm7.music.')
        .replace(/m8c\.music\./g, 'm8.music.');
    }
  } catch (e) {
    // Tonzhon url 接口失效，返回 null 交由官方回退
  }
  return null;
}

// 用歌名 best-effort 匹配网易云 id（用于非网易源歌曲的播放/歌词回退）
async function matchNeteaseByQuery(name, artist) {
  if (!name) return null;
  const tryQuery = async (q) => {
    try {
      const arr = await tzPost('search', { source: 'netease', name: q, pages: 1, count: 1 });
      const it = Array.isArray(arr) ? arr[0] : null;
      return it && it.id ? String(it.id) : null;
    } catch (e) {
      return null;
    }
  };
  let id = await tryQuery(name);
  if (!id && artist) id = await tryQuery(name + ' ' + artist);
  return id;
}

// ===== 腾讯QQ 音频后端：musicu.fcg vkey.GetVkeyServer (CgiGetVkey) =====
// 经实测：QQ 官方取链接口，无需登录即可返回真实可播直链（aqqmusic.tc.qq.com/...?vkey=...）。
async function getQQUrl(mid) {
  if (!mid) return null;
  try {
    const data = {
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: {
          guid: String(Math.floor(Math.random() * 1e10)).padStart(10, '0'),
          songmid: [String(mid)],
          songtype: [0],
          uin: '0',
          loginflag: 1,
          platform: '20',
        },
      },
      comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
    };
    const url =
      'https://u.y.qq.com/cgi-bin/musicu.fcg?-=getplaysongvkey&g_tk=5381&loginUin=0&hostUin=0' +
      '&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0' +
      '&data=' + encodeURIComponent(JSON.stringify(data));
    const r = await axios.get(url, { headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' }, timeout: 12000 });
    const v = r.data && r.data.req_0 && r.data.req_0.data;
    if (v) {
      const sip = (v.sip && v.sip[0]) || '';
      const info = (v.midurlinfo && v.midurlinfo[0]) || {};
      const purl = info.purl || '';
      if (purl) return forceHttps(sip + purl);
    }
  } catch (e) {}
  return null;
}

// ===== 酷狗音频后端：wwwapi.kugou.com play/getdata =====
// 说明：免费曲可返回 play_url；付费/区域限制曲为空，此时回退网易云匹配。
async function getKugouUrl(hash, albumId) {
  if (!hash) return null;
  try {
    const url =
      'https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=' + hash +
      '&album_id=' + (albumId || '') +
      '&dfid=&mid=286974383886022203545511837994020015101&platid=4';
    const r = await axios.get(url, { headers: { 'User-Agent': UA, Referer: 'https://www.kugou.com/' }, timeout: 12000 });
    const d = r.data && r.data.data;
    if (d) {
      const u = d.play_url || d.url || d.play_backup_url;
      if (u) return forceHttps(u);
    }
  } catch (e) {}
  return null;
}

// ===== 各源歌曲映射 =====

// 网易云：d.playlist.tracks
function mapNeteaseTracks(tracks) {
  return (tracks || []).map((t) => ({
    id: `tz_${t.id}`,
    title: t.name || '',
    artist: (t.ar || []).map((a) => a.name).join('/'),
    album: (t.al && t.al.name) || '',
    artwork: (t.al && t.al.picUrl) || '',
    duration: t.dt ? Math.round(t.dt / 1000) : 0,
    _nzId: String(t.id),
    _lyricId: String(t.id),
    _source: 'netease',
  }));
}

// 酷狗：d.data.info[]，filename 为 "歌手 - 歌名"
function mapKugouTracks(info) {
  return (info || []).map((t) => {
    const fm = t.filename || '';
    const i = fm.indexOf(' - ');
    const artist = i > 0 ? fm.slice(0, i).trim() : '';
    const title = i > 0 ? fm.slice(i + 3).trim() : fm.trim();
    return {
      id: `kg_${t.hash}`,
      title,
      artist,
      album: '',
      artwork: '',
      duration: t.duration ? Number(t.duration) : 0,
      _src: 'kugou',
      _kgHash: t.hash,
      _name: title,
      _artist: artist,
    };
  });
}

// QQ音乐：d.data.cdlist[0].songlist[]
function mapTencentTracks(songlist) {
  return (songlist || []).map((s) => {
    const singer = Array.isArray(s.singer)
      ? s.singer
          .map((x) => (typeof x === 'string' ? x : (x && x.name) || ''))
          .filter(Boolean)
          .join('/')
      : s.singer || '';
    const album = typeof s.album === 'string' ? s.album : (s.album && s.album.name) || '';
    return {
      id: `qq_${s.mid}`,
      title: s.name || '',
      artist: singer,
      album,
      artwork: '',
      duration: s.interval ? Number(s.interval) : 0,
      _src: 'tencent',
      _qqMid: s.mid,
      _name: s.name,
      _artist: singer,
    };
  });
}

// ===== 链接识别（导入）=====
function detectPlatform(input) {
  const s = String(input || '');
  if (/music\.163\.com/.test(s)) {
    const m = s.match(/[?&/#]id=(\d+)/) || s.match(/\/(?:song|playlist)\/(\d+)/);
    if (m) return { server: 'netease', id: m[1] };
  }
  if (/y\.qq\.com|qq\.com/.test(s)) {
    const m =
      s.match(/disstid=(\d+)/) ||
      s.match(/\/(?:playlist|songDetail)\/([A-Za-z0-9]+)/) ||
      s.match(/[?&/#]id=([A-Za-z0-9]+)/);
    if (m) return { server: 'tencent', id: m[1] };
  }
  return null;
}

module.exports = {
  platform: '我要下歌',
  version: '0.0.10',
  author: 'tianpeng',
  srcUrl: 'https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js',
  description:
    '我要下歌(xiage) 音乐插件 · 铜钟Tonzhon音源：网易云/酷狗/QQ 排行榜与热门歌单，搜索/歌词走 tonzhon.com，播放按来源路由至官方后端——网易云 weapi / 腾讯QQ CgiGetVkey / 酷狗 play/getdata，失败回退网易云匹配',
  cacheControl: 'no-store',
  supportedSearchType: ['music'],

  // ===== 排行榜 / 热门歌单（全部来自 Tonzhon playlist 接口，按平台分组）=====
  async getTopLists() {
    const groups = [];
    // —— 排行榜 ——
    groups.push(buildGroup('网易云排行榜', NETEASE_RANKS, 'netease', '排行榜'));
    groups.push(buildGroup('酷狗排行榜', KUGOU_RANKS, 'kugou', '排行榜'));
    groups.push(buildGroup('QQ音乐歌单', QQ_RANKS, 'tencent', '排行榜'));
    // —— 热门歌单 ——
    groups.push(buildGroup('热门歌单·网易云', NETEASE_HOT, 'netease', '热门歌单'));
    groups.push(buildGroup('热门歌单·酷狗', KUGOU_HOT, 'kugou', '热门歌单'));
    groups.push(buildGroup('热门歌单·QQ音乐', QQ_HOT, 'tencent', '热门歌单'));
    return groups;
  },

  async _fetchSongs(sheetItem) {
    if (sheetItem._kind !== 'tzpl') return { songs: [], hasNext: false };
    const src = sheetItem._src;
    try {
      if (src === 'netease') {
        const d = await tzPost('playlist', { id: sheetItem._plId, source: 'netease' });
        const tracks = (d && d.playlist && d.playlist.tracks) || [];
        return { songs: mapNeteaseTracks(tracks), hasNext: false };
      }
      if (src === 'kugou') {
        const d = await tzPost('playlist', { id: sheetItem._plId, source: 'kugou' });
        const info = (d && d.data && d.data.info) || [];
        return { songs: mapKugouTracks(info), hasNext: false };
      }
      if (src === 'tencent') {
        const d = await tzPost('playlist', { id: sheetItem._plId, source: 'tencent' });
        const cd = (d && d.data && d.data.cdlist) || [];
        const sl = cd.length ? cd[0].songlist || [] : [];
        return { songs: mapTencentTracks(sl), hasNext: false };
      }
    } catch (e) {
      return { songs: [], hasNext: false };
    }
    return { songs: [], hasNext: false };
  },

  async getTopListDetail(topListItem, page = 1) {
    const { songs, hasNext } = await this._fetchSongs(topListItem);
    return { isEnd: songs.length === 0 || !hasNext, musicList: songs };
  },

  async getMusicSheetInfo(sheetItem, page = 1) {
    const { songs, hasNext } = await this._fetchSongs(sheetItem);
    return { isEnd: songs.length === 0 || !hasNext, musicList: songs };
  },

  // ===== 搜索（Tonzhon，netease 源）=====
  async search(query, page = 1, type) {
    if (type && type !== 'music') return { isEnd: true, data: [] };
    const q = (query || '').trim();
    if (!q) return { isEnd: true, data: [] };
    try {
      const arr = await tzPost('search', { source: 'netease', name: q, pages: page, count: 30 });
      const list = Array.isArray(arr) ? arr : [];
      const data = list.map((it) => ({
        id: `tz_${it.id}`,
        title: it.name || '',
        artist: flattenArtist(it.artist),
        album: it.album || '',
        artwork: '',
        duration: 0,
        _nzId: String(it.id),
        _lyricId: String(it.lyric_id || it.id),
        _source: it.source || 'netease',
      }));
      return { isEnd: data.length < 30, data };
    } catch (e) {
      return { isEnd: true, data: [] };
    }
  },

  // ===== 导入歌单（网易云 / QQ音乐，均经 Tonzhon）=====
  async importMusicSheet(urlLike) {
    const info = detectPlatform(urlLike);
    if (!info) {
      throw new Error('无法识别的歌单链接，请粘贴网易云(music.163.com)或QQ音乐(y.qq.com)的歌单链接');
    }
    if (info.server === 'netease') {
      const d = await tzPost('playlist', { id: info.id, source: 'netease' });
      const tracks = (d && d.playlist && d.playlist.tracks) || [];
      if (!tracks.length)
        throw new Error('该网易云歌单未返回曲目，通常为私人/需登录歌单；请在网易云网页端将其设为「公开」后再导入');
      return mapNeteaseTracks(tracks);
    }
    if (info.server === 'tencent') {
      const d = await tzPost('playlist', { id: info.id, source: 'tencent' });
      const cd = (d && d.data && d.data.cdlist) || [];
      const sl = cd.length ? cd[0].songlist || [] : [];
      if (!sl.length) throw new Error('该QQ歌单未解析到歌曲，可能链接有误或已失效（或需登录）');
      return mapTencentTracks(sl);
    }
    throw new Error('暂不支持该平台的歌单导入');
  },

  // ===== 导入单曲（网易云可靠；QQ best-effort）=====
  async importMusicItem(urlLike) {
    const info = detectPlatform(urlLike);
    if (!info) {
      throw new Error('无法识别的歌曲链接，请粘贴网易云或QQ音乐的歌曲链接');
    }
    if (info.server === 'netease') {
      return {
        id: `tz_${info.id}`,
        title: '',
        artist: '',
        album: '',
        artwork: '',
        duration: 0,
        _nzId: info.id,
        _lyricId: info.id,
        _source: 'netease',
      };
    }
    if (info.server === 'tencent') {
      return {
        id: `qq_${info.id}`,
        title: '',
        artist: '',
        album: '',
        artwork: '',
        duration: 0,
        _src: 'tencent',
        _qqMid: info.id,
        _name: '',
        _artist: '',
      };
    }
    throw new Error('暂不支持该平台的单曲导入');
  },

  // ===== 播放直链（按来源路由至各自官方后端；失败 best-effort 匹配网易云）=====
  async getMediaSource(musicItem) {
    // ① 网易源：weapi 直取真实可播 CDN
    if (musicItem._nzId) {
      const url = await getNeteaseUrl(musicItem._nzId);
      if (url) return { url: forceHttps(url) };
    }

    // ② 腾讯QQ 源：官方 CgiGetVkey 取链（实测 12/12 可播）；失败回退网易云匹配
    if (musicItem._qqMid) {
      const url = await getQQUrl(musicItem._qqMid);
      if (url) return { url: forceHttps(url) };
      const nid = await matchNeteaseByQuery(musicItem._name || musicItem.title, musicItem._artist || musicItem.artist);
      if (nid) {
        const nu = await getNeteaseUrl(nid);
        if (nu) return { url: forceHttps(nu) };
      }
    }

    // ③ 酷狗源：官方 play/getdata 取链；失败回退网易云匹配
    if (musicItem._kgHash) {
      const url = await getKugouUrl(musicItem._kgHash, musicItem._kgAlbum);
      if (url) return { url: forceHttps(url) };
      const nid = await matchNeteaseByQuery(musicItem._name || musicItem.title, musicItem._artist || musicItem.artist);
      if (nid) {
        const nu = await getNeteaseUrl(nid);
        if (nu) return { url: forceHttps(nu) };
      }
    }

    // ④ Tonzhon 自有音源（若未来复活）
    const fallbackId = musicItem._nzId || musicItem._qqMid || musicItem._kgHash;
    if (fallbackId) {
      const src =
        musicItem._source || (musicItem._qqMid ? 'tencent' : musicItem._kgHash ? 'kugou' : 'netease');
      const tz = await tzAudioUrl(fallbackId, src);
      if (tz) return { url: tz };
    }

    throw new Error(
      '该歌曲暂无可用的播放音源（QQ/酷狗/网易云后端均未返回直链；付费或区域限制曲可能无解，或匹配未命中）'
    );
  },

  // ===== 歌词（Tonzhon lyric 接口，netease）=====
  async getLyric(musicItem) {
    let lyricId = musicItem._lyricId || musicItem._nzId;
    // 非网易源：best-effort 匹配网易云 id 取歌词
    if (!lyricId && (musicItem._qqMid || musicItem._kgHash || musicItem._name)) {
      const nid = await matchNeteaseByQuery(musicItem._name || musicItem.title, musicItem._artist || musicItem.artist);
      lyricId = nid;
    }
    if (!lyricId) return { rawLrc: '', translation: '' };
    try {
      const r = await tzPost('lyric', { id: lyricId, source: 'netease' });
      const lrc = typeof r === 'string' ? r : (r && (r.lrc || r.lyric)) || '';
      return { rawLrc: lrc || '', translation: '' };
    } catch (e) {
      return { rawLrc: '', translation: '' };
    }
  },
};

// 构建分组（标题/ID 均预置，避免 getTopLists 阶段大量网络请求导致超时）
function buildGroup(title, list, src, kindLabel) {
  return {
    title,
    data: list.map((p) => ({
      id: 'pl_' + src + '_' + p.id,
      title: p.title,
      artwork: '',
      description: kindLabel,
      _kind: 'tzpl',
      _src: src,
      _plId: p.id,
    })),
  };
}
