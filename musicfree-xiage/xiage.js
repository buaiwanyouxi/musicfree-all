// 我要下歌 (xiage) MusicFree 插件 · 后端：铜钟 Tonzhon (https://tonzhon.com)
// 全链路统一走 Tonzhon 音源 (https://tonzhon.com/api.php)：
//   - 歌单/排行榜  : Tonzhon types=playlist（网易云/酷狗/QQ 三源）
//   - 搜索          : Tonzhon types=search  (source=netease)
//   - 歌词 / 封面   : Tonzhon types=lyric / types=pic
//   - 播放直链      : ① 先调 Tonzhon types=url（Tonzhon 自有音源）
//                     ② Tonzhon 官方同款回退：网易云外链
//                        music.163.com/song/media/outer/url?id=<id>.mp3 (302 -> 真实 CDN)
//                        —— 此为 Tonzhon 前端 ajax.js 在 types=url 失效时的标准处理
// 非网易源歌曲（酷狗/QQ）：Tonzhon types=url 失效，播放/歌词统一 best-effort 匹配网易云外链回退。
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

// ===== 铜钟 Tonzhon 音源后端（全链路唯一后端）=====
const TZ = 'https://tonzhon.com/api.php';
// 网易云官方外链（Tonzhon types=url 失效时的官方同款回退，302 跳真实 CDN）
const NETEASE_OUTER = 'https://music.163.com/song/media/outer/url?id=';

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

// 跟随网易云外链 302，解析最终 https CDN 直链（规避播放器不跟随跨域跳转）
// 仅接受真实音频 CDN；遇到 404/错误页则返回 null（交由上层明确报错，不把死链交给播放器）
async function resolveNeteaseAudio(nid) {
  const outer = `${NETEASE_OUTER}${nid}.mp3`;
  const isAudioCdn = (u) =>
    /^https:\/\/(m\d*\.)?music\.126\.net/.test(u) || /\.mp3(\?.*)?$/i.test(u);
  try {
    const r = await axios.get(outer, {
      headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' },
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: (s) => s === 200 || s === 302,
    });
    if (r.status === 302 && r.headers.location) {
      const loc = r.headers.location.replace(/^http:\/\//i, 'https://');
      return isAudioCdn(loc) ? loc : null;
    }
    if (r.status === 200) {
      const final = (r.request && r.request.res && r.request.res.responseUrl) || outer;
      const f = final.replace(/^http:\/\//i, 'https://');
      return isAudioCdn(f) ? f : null;
    }
  } catch (e) {
    // 解析失败（含 404 等非 200/302）
  }
  return null;
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
async function matchNeteaseByQuery(name) {
  if (!name) return null;
  try {
    const arr = await tzPost('search', { source: 'netease', name, pages: 1, count: 1 });
    const it = Array.isArray(arr) ? arr[0] : null;
    return it && it.id ? String(it.id) : null;
  } catch (e) {
    return null;
  }
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
  version: '0.0.8',
  author: 'tianpeng',
  srcUrl: 'https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js',
  description:
    '我要下歌(xiage) 音乐插件 · 全链路铜钟Tonzhon音源：网易云/酷狗/QQ 排行榜与热门歌单，搜索/歌词走 tonzhon.com，播放先调 Tonzhon types=url 再走官方网易云回退',
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

  // ===== 播放直链（Tonzhon 音源：先 types=url，再官方网易云回退）=====
  async getMediaSource(musicItem) {
    let nid = musicItem._nzId;
    let source = musicItem._source || 'netease';

    // 非网易源（酷狗/QQ）：先试 Tonzhon types=url，失效则 best-effort 匹配网易云播放
    if (!nid && (musicItem._qqMid || musicItem._kgHash)) {
      const id = musicItem._qqMid || musicItem._kgHash;
      const src = musicItem._src || 'tencent';
      const tz = await tzAudioUrl(id, src);
      if (tz) return { url: tz };
      nid = await matchNeteaseByQuery(musicItem._name || musicItem.title);
      source = 'netease';
    }
    if (!nid) throw new Error('该歌曲暂无可用的播放音源（Tonzhon 当前仅网易云可稳定播放）');

    // ① 优先尝试 Tonzhon 自有音源
    const tz = await tzAudioUrl(nid, source);
    if (tz) return { url: tz };

    // ② Tonzhon 官方同款回退：网易云外链（types=url 失效时）
    const url = await resolveNeteaseAudio(nid);
    if (!url) throw new Error('该歌曲暂无可用的播放音源（Tonzhon 当前仅网易云可稳定播放）');
    return { url };
  },

  // ===== 歌词（Tonzhon lyric 接口，netease）=====
  async getLyric(musicItem) {
    let lyricId = musicItem._lyricId || musicItem._nzId;
    // 非网易源：best-effort 匹配网易云 id 取歌词
    if (!lyricId && (musicItem._qqMid || musicItem._kgHash || musicItem._name)) {
      const nid = await matchNeteaseByQuery(musicItem._name || musicItem.title);
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
