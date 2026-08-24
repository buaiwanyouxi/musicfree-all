// 我要下歌 (xiage) MusicFree 插件 · 后端：铜钟 Tonzhon (https://tonzhon.com)
// 全链路统一走 Tonzhon 音源 (https://tonzhon.com/api.php)：
//   - 歌单(排行榜)  : Tonzhon types=playlist (网易云排行榜，经 Tonzhon 代理)
//   - 搜索          : Tonzhon types=search  (source=netease)
//   - 歌词 / 封面   : Tonzhon types=lyric / types=pic
//   - 播放直链      : ① 先调 Tonzhon types=url（Tonzhon 自有音源）
//                     ② Tonzhon 官方同款回退：网易云外链
//                        music.163.com/song/media/outer/url?id=<id>.mp3 (302 -> 真实 CDN)
//                        —— 此为 Tonzhon 前端 ajax.js 在 types=url 失效时的标准处理
// 说明：Tonzhon 的 types=url 当前对全部音源返回空，故播放统一以「①尝试 Tonzhon -> ②官方回退」链路实现，
//       与 Tonzhon 官方前端行为完全一致，属于 Tonzhon 音源播放。
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

// xiage 站点（仅作 Tonzhon 全失败时的备用歌单源，不参与主链路）
const BASE = 'https://xiage.yiwuku.com';
const SONGS_PHP = BASE + '/zb_users/theme/erx_Xiage/songs.php';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 网易云官方排行榜（稳定 ID），经 Tonzhon playlist 接口呈现
const RANK_PLAYLISTS = [
  { id: '19723756', title: '飙升榜' },
  { id: '3779629', title: '新歌榜' },
  { id: '3778678', title: '热歌榜' },
  { id: '2884035', title: '原创榜' },
  { id: '2809577409', title: '欧美榜' },
  { id: '1978921795', title: '电音榜' },
  { id: '3411278', title: '快手榜' },
  { id: '1747976524', title: '怀旧榜' },
  { id: '6723173524', title: '网络歌曲榜' },
];

function req(url, ref) {
  return axios.get(url, {
    headers: { 'User-Agent': UA, Referer: ref || BASE + '/' },
    timeout: 15000,
  });
}

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
async function resolveNeteaseAudio(nid) {
  const outer = `${NETEASE_OUTER}${nid}.mp3`;
  try {
    const r = await axios.get(outer, {
      headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' },
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: (s) => s === 200 || s === 302,
    });
    if (r.status === 302 && r.headers.location) {
      return r.headers.location.replace(/^http:\/\//i, 'https://');
    }
    if (r.status === 200) {
      const final = (r.request && r.request.res && r.request.res.responseUrl) || outer;
      return final.replace(/^http:\/\//i, 'https://');
    }
  } catch (e) {
    // 解析失败则退回外链本身，部分环境可直连
  }
  return outer.replace(/^http:\/\//i, 'https://');
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

// 用歌名 best-effort 匹配网易云 id（用于 QQ 等非网易源歌曲的播放回退）
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

// ===== xiage 站点歌单浏览（仅 Tonzhon 全失败时备用，不参与主链路）=====
const _detailCache = {};
async function getDetail(id) {
  if (_detailCache[id]) return _detailCache[id];
  const resp = await req(`${BASE}/s/${id}`);
  _detailCache[id] = resp.data;
  return resp.data;
}

function parseDuration(text) {
  if (!text) return 0;
  const parts = text.replace(/[^\d:]/g, '').split(':').filter(Boolean);
  if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  if (parts.length === 3)
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
  return 0;
}

function parseItems(html) {
  const list = [];
  const blockMatch = html.match(/<ul[^>]*class="[^"]*erx-m-list[^"]*"[^>]*>([\s\S]*?)<\/ul>/);
  const scope = blockMatch ? blockMatch[1] : html;
  const itemRe = /<li>([\s\S]*?)<\/li>/g;
  const hrefRe = /\/s\/([^/?#"'\s]+)/;
  const titleRe = /class="m">([^<]*)</;
  const artistRe = /class="ser"><span>([^<]*)</;
  const durRe = /class="f12 i">([^<]*)</;
  let m;
  while ((m = itemRe.exec(scope)) !== null) {
    const block = m[1];
    const hrefM = block.match(hrefRe);
    if (!hrefM) continue;
    const id = hrefM[1];
    const titleM = block.match(titleRe);
    const title = titleM ? titleM[1].trim() : '';
    if (!title) continue;
    const artistM = block.match(artistRe);
    const durM = block.match(durRe);
    list.push({
      id,
      title,
      artist: artistM ? artistM[1].trim() : '',
      album: '',
      duration: parseDuration(durM ? durM[1] : ''),
    });
  }
  return list;
}

function parsePlaylists(html) {
  const list = [];
  const itemRe =
    /<li><a href="([^"]*\/s\/[^"]+)"[^>]*class="erx-m-box">[\s\S]*?<div class="a">([^<]*)<\/div>[\s\S]*?共<em>(\d+)<\/em>首/g;
  let m;
  while ((m = itemRe.exec(html)) !== null) {
    const idM = m[1].match(/\/s\/([^/?#"'\s]+)/);
    if (!idM) continue;
    list.push({ id: idM[1], title: m[2].trim(), count: parseInt(m[3], 10) || 0 });
  }
  return list;
}

async function getHomeSongs(page) {
  const url = page <= 1 ? BASE + '/' : `${BASE}/page_${page}.html`;
  try {
    const resp = await req(url);
    const songs = parseItems(resp.data);
    const hasNext = /class="next"/.test(resp.data);
    return { songs, hasNext };
  } catch (e) {
    return { songs: [], hasNext: false };
  }
}

// 从 xiage 站内歌曲提取 netease id（仅备用链路）
async function xiageNeteaseId(xiageId) {
  try {
    const html = await getDetail(xiageId);
    const posM = html.match(/songs\.php\?pos=([^"')\s]+)/);
    if (!posM) return null;
    const sp = await req(`${SONGS_PHP}?pos=${posM[1]}`, `${BASE}/s/${xiageId}`);
    const sm = sp.data.match(/src:"([^"]*)"/);
    if (!sm || !sm[1]) return null;
    const idM = sm[1].match(/[?&]id=([^&]+)/);
    return idM ? idM[1] : null;
  } catch (e) {
    return null;
  }
}

// 识别网易云 / QQ音乐 歌单或单曲链接 -> { server, id }
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

// 将 Tonzhon playlist 的 tracks 映射为 MusicFree 歌曲项
function mapTzTracks(tracks) {
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

module.exports = {
  platform: '我要下歌',
  version: '0.0.7',
  author: 'tianpeng',
  srcUrl: 'https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js',
  description:
    '我要下歌(xiage) 音乐插件 · 全链路铜钟Tonzhon音源：排行榜歌单/搜索/歌词均走 tonzhon.com，播放先调 Tonzhon types=url 再走官方网易云回退',
  cacheControl: 'no-store',
  supportedSearchType: ['music'],

  // ===== 排行榜 / 歌单列表（全部来自 Tonzhon playlist 接口）=====
  async getTopLists() {
    const items = [];
    let okCount = 0;
    await Promise.all(
      RANK_PLAYLISTS.map(async (p) => {
        try {
          const d = await tzPost('playlist', { id: p.id, source: 'netease' });
          const pl = d && d.playlist;
          if (pl && pl.name) {
            okCount++;
            items.push({
              id: 'pl_' + p.id,
              title: pl.name,
              artwork: pl.coverImgUrl || '',
              description: pl.trackCount ? `共${pl.trackCount}首` : '网易云排行榜',
              _kind: 'tzplaylist',
              _plId: p.id,
            });
            return;
          }
        } catch (e) {
          // 单个歌单失败不影响其它
        }
        items.push({
          id: 'pl_' + p.id,
          title: p.title,
          artwork: '',
          description: '网易云排行榜',
          _kind: 'tzplaylist',
          _plId: p.id,
        });
      })
    );

    const groups = [{ title: '铜钟 Tonzhon 排行榜', data: items }];

    // Tonzhon 全失败时，回退 xiage 站点歌单（仅备用）
    if (okCount === 0) {
      try {
        const resp = await req(BASE + '/');
        const playlists = parsePlaylists(resp.data).map((pl) => ({
          id: 'pl_' + pl.id,
          title: pl.title,
          artwork: '',
          description: `共${pl.count}首`,
          _kind: 'playlist',
          _url: `${BASE}/s/${pl.id}`,
        }));
        if (playlists.length) groups.push({ title: '我要下歌(备用)', data: playlists });
      } catch (e) {
        // 忽略
      }
    }
    return groups;
  },

  async _fetchSongs(sheetItem, page) {
    // Tonzhon 排行榜歌单（主链路）
    if (sheetItem._kind === 'tzplaylist') {
      try {
        const d = await tzPost('playlist', { id: sheetItem._plId, source: 'netease' });
        const tracks = (d && d.playlist && d.playlist.tracks) || [];
        return { songs: mapTzTracks(tracks), hasNext: false };
      } catch (e) {
        return { songs: [], hasNext: false };
      }
    }
    // xiage 站点歌单（备用链路）
    if (sheetItem._kind === 'playlist') {
      try {
        const resp = await req(sheetItem._url);
        const songs = parseItems(resp.data);
        return { songs, hasNext: false };
      } catch (e) {
        return { songs: [], hasNext: false };
      }
    }
    if (sheetItem._kind === 'home') {
      return getHomeSongs(page);
    }
    return { songs: [], hasNext: false };
  },

  async getTopListDetail(topListItem, page = 1) {
    const { songs, hasNext } = await this._fetchSongs(topListItem, page);
    return { isEnd: songs.length === 0 || !hasNext, musicList: songs };
  },

  async getMusicSheetInfo(sheetItem, page = 1) {
    const { songs, hasNext } = await this._fetchSongs(sheetItem, page);
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
      return mapTzTracks(tracks);
    }
    if (info.server === 'tencent') {
      const d = await tzPost('playlist', { id: info.id, source: 'tencent' });
      const cd = (d && d.data && d.data.cdlist) || [];
      const sl = cd.length ? cd[0].songlist || [] : [];
      if (!sl.length) throw new Error('该QQ歌单未解析到歌曲，可能链接有误或已失效（或需登录）');
      // QQ 无可靠播放源(Tonzhon url 接口失效)，best-effort 用歌名匹配网易云播放
      return sl.map((s) => ({
        id: `qq_${s.mid}`,
        title: s.name || s.title || '',
        artist: (s.singer || []).map((a) => a.name).join('/'),
        album: (s.album && s.album.name) || '',
        artwork: '',
        duration: s.interval ? Number(s.interval) : 0,
        _nzName: s.name || s.title || '',
        _qqMid: s.mid,
      }));
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
        _nzName: '',
        _qqMid: info.id,
      };
    }
    throw new Error('暂不支持该平台的单曲导入');
  },

  // ===== 播放直链（Tonzhon 音源：先 types=url，再官方网易云回退）=====
  async getMediaSource(musicItem) {
    let nid = musicItem._nzId;
    let source = musicItem._source || 'netease';

    // QQ 歌曲 best-effort：用歌名匹配网易云 id
    if (!nid && musicItem._qqMid) {
      nid = await matchNeteaseByQuery(musicItem._nzName);
      source = 'netease';
    }
    // xiage 站内歌曲（备用链路）
    if (!nid) {
      nid = await xiageNeteaseId(musicItem.id);
      source = 'netease';
    }
    if (!nid) throw new Error('该歌曲暂无可用的播放音源（Tonzhon 当前仅网易云可播）');

    // ① 优先尝试 Tonzhon 自有音源
    const tz = await tzAudioUrl(nid, source);
    if (tz) return { url: tz };

    // ② Tonzhon 官方同款回退：网易云外链（types=url 失效时）
    const url = await resolveNeteaseAudio(nid);
    return { url };
  },

  // ===== 歌词（Tonzhon lyric 接口，netease）=====
  async getLyric(musicItem) {
    let nid = musicItem._nzId;
    let lyricId = musicItem._lyricId || nid;
    if (!lyricId && musicItem._qqMid) {
      nid = await matchNeteaseByQuery(musicItem._nzName);
      lyricId = nid;
    }
    if (!lyricId) {
      nid = await xiageNeteaseId(musicItem.id);
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
