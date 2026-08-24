// 我要下歌 (xiage.yiwuku.com) MusicFree 插件
// 站点本质：Z-Blog 静态音乐站，歌曲播放后端为 meting API（api.qijieya.cn/meting，网易云/QQ音乐源）。
//   - 站点歌曲详情页通过 songs.php?pos=XXX 返回 meting 播放地址：https://api.qijieya.cn/meting/?type=url&id=YYY
//   - meting 接口再 302 跳转到网易云 CDN（m*.music.126.net/...）的真实音频
// 逆向来源：全部来自真实站点 + meting 接口实测（axios 复现），无网络搜索/盲猜。
//
// 修复记录（v0.0.3~v0.0.5）：
//  - v0.0.5 重大重构：以 meting 为统一音源后端
//      * 播放：getMediaSource 在插件内跟随 meting 302，解析最终 CDN 直链返回，
//        规避 MusicFree 播放器不跟随跨域 302 导致的“全部无法播放”问题（实测根因）
//      * 搜索：改用 meting ?type=search（真实可播放结果），替换原站内小池子匹配（命中率极低→空白）
//      * 导入：支持网易云/QQ音乐歌单链接，meting ?type=playlist 拉取（实测网易539首/QQ30首正常）
//      * 歌词：改用 meting ?type=lrc（真实逐行 LRC），替换原 meta description 纯文本
//
// 返回值结构严格遵循 MusicFree 插件协议：
//  - getTopLists       -> IMusicSheetGroupItem[] = [{ title, data: IMusicSheetItem[] }]
//  - getTopListDetail  -> { isEnd, musicList: IMusicItem[] }
//  - getMusicSheetInfo -> { isEnd, musicList: IMusicItem[] }
//  - search            -> { isEnd, data: IMusicItem[] }
//  - importMusicSheet  -> IMusicItem[]
//  - importMusicItem   -> IMusicItem
//  - getMediaSource    -> { url }（已解析为 CDN 直链）
//  - getLyric          -> { rawLrc }

const axios = require('axios');

const BASE = 'https://xiage.yiwuku.com';
const SONGS_PHP = BASE + '/zb_users/theme/erx_Xiage/songs.php';
const METING = 'https://api.qijieya.cn/meting/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function req(url, ref) {
  return axios.get(url, {
    headers: { 'User-Agent': UA, Referer: ref || BASE + '/' },
    timeout: 15000,
  });
}

// 详情页 HTML 缓存（getMediaSource / getLyric 共用，避免重复请求）
const _detailCache = {};

async function getDetail(id) {
  if (_detailCache[id]) return _detailCache[id];
  const resp = await req(`${BASE}/s/${id}`);
  _detailCache[id] = resp.data;
  return resp.data;
}

// 时长文本 "03:44" -> 秒
function parseDuration(text) {
  if (!text) return 0;
  const parts = text.replace(/[^\d:]/g, '').split(':').filter(Boolean);
  if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  if (parts.length === 3)
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
  return 0;
}

// 解析“歌曲列表”：站点真实结构为 <ul class="...erx-m-list..."> 下的裸 <li>（无 class）
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
    // 歌手缺省留空，绝不填占位符，避免污染跨源自动换源匹配键
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

// 解析“歌单合集”卡片
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

// 抓取首页某页“最新歌曲”。page<=1 取首页，否则 /page_N.html
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

// 从 meting 播放/歌曲 URL 中提取音源 id 与 server
function parseMetingUrl(url) {
  const idM = String(url).match(/[?&]id=([^&]+)/);
  const srvM = String(url).match(/[?&]server=([^&]+)/);
  return {
    id: idM ? decodeURIComponent(idM[1]) : '',
    server: srvM ? srvM[1] : 'netease',
  };
}

// 将 meting 播放地址（type=url）解析为最终 CDN 直链
// 关键修复：MusicFree 播放器不跟随 meting 的 302 跨域跳转，故插件内自行解析后返回 CDN 直链
async function resolveMetingAudio(murl) {
  const url = String(murl).replace(/^http:\/\//i, 'https://');
  try {
    // 仅取重定向 Location，不下载音频体，最快
    const r = await axios.get(url, {
      headers: { 'User-Agent': UA, Referer: BASE + '/' },
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: (s) => s === 200 || s === 302,
    });
    if (r.status === 302 && r.headers.location) return r.headers.location.replace(/^http:\/\//i, 'https://');
    if (r.status === 200) {
      const final = r.request && r.request.res ? r.request.res.responseUrl || url : url;
      return final.replace(/^http:\/\//i, 'https://');
    }
  } catch (e) {
    // 解析失败则退回原 meting 地址（部分环境可直连）
  }
  return url.replace(/^http:\/\//i, 'https://');
}

// 由 meting 播放 URL 派生歌词 URL（type=url -> type=lrc）
function lrcUrlFromMurl(murl) {
  return String(murl).replace(/type=url/, 'type=lrc');
}

// 识别网易云/QQ音乐歌单/单曲链接，返回 { server, id }
function detectPlatform(input) {
  const s = String(input || '');
  // 网易云：playlist?id= / #/playlist?id= / /playlist/123 / /song/123
  if (/music\.163\.com/.test(s)) {
    const m = s.match(/[?&/#]id=(\d+)/) || s.match(/\/(?:song|playlist)\/(\d+)/);
    if (m) return { server: 'netease', id: m[1] };
  }
  // QQ音乐：路径式 /playlist/123（数字）或 /songDetail/003xxx（字母数字），兼容 ?disstid= / ?id=
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
  version: '0.0.5',
  author: 'tianpeng',
  srcUrl: 'https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js',
  description: '我要下歌(xiage.yiwuku.com) 音乐插件：歌单浏览、meting 真实搜索/播放/歌词、网易云与QQ歌单导入',
  cacheControl: 'no-store',
  supportedSearchType: ['music'],

  // ===== 排行榜 / 歌单列表（分组结构）=====
  async getTopLists() {
    const resp = await req(BASE + '/');
    const playlists = parsePlaylists(resp.data).map((p) => ({
      id: 'pl_' + p.id,
      title: p.title,
      artwork: '',
      description: `共${p.count}首`,
      _kind: 'playlist',
      _url: `${BASE}/s/${p.id}`,
    }));
    const latest = {
      id: 'latest',
      title: '最新歌曲',
      artwork: '',
      _kind: 'home',
      _url: BASE + '/',
    };
    return [
      {
        title: '我要下歌',
        data: [latest, ...playlists],
      },
    ];
  },

  async _fetchSongs(sheetItem, page) {
    if (sheetItem._kind === 'home') {
      return getHomeSongs(page);
    }
    try {
      const resp = await req(sheetItem._url);
      const songs = parseItems(resp.data);
      return { songs, hasNext: false }; // 歌单合集单页，站点无分页接口
    } catch (e) {
      return { songs: [], hasNext: false };
    }
  },

  // ===== 排行榜详情 =====
  async getTopListDetail(topListItem, page = 1) {
    const { songs, hasNext } = await this._fetchSongs(topListItem, page);
    return {
      isEnd: songs.length === 0 || !hasNext,
      musicList: songs,
    };
  },

  // ===== 歌单详情（导入/收藏进入时调用）=====
  async getMusicSheetInfo(sheetItem, page = 1) {
    const { songs, hasNext } = await this._fetchSongs(sheetItem, page);
    return {
      isEnd: songs.length === 0 || !hasNext,
      musicList: songs,
    };
  },

  // ===== 搜索（meting 真实搜索）=====
  async search(query, page = 1, type) {
    if (type && type !== 'music') return { isEnd: true, data: [] };
    const q = (query || '').trim();
    if (!q) return { isEnd: true, data: [] };
    try {
      const r = await axios.get(
        `${METING}?type=search&id=${encodeURIComponent(q)}&limit=30&page=${page}`,
        { headers: { 'User-Agent': UA, Referer: BASE + '/' }, timeout: 15000 }
      );
      const list = Array.isArray(r.data) ? r.data : [];
      const data = list.map((it) => {
        const { id, server } = parseMetingUrl(it.url);
        return {
          id: `meting_${server}_${id}`,
          title: it.name || '',
          artist: it.artist || '',
          album: '',
          artwork: it.pic || '',
          duration: 0,
          _murl: it.url,
        };
      });
      return { isEnd: data.length < 30, data };
    } catch (e) {
      // meting 不可用时降级为空，避免整体崩溃
      return { isEnd: true, data: [] };
    }
  },

  // ===== 导入歌单（网易云 / QQ音乐）=====
  async importMusicSheet(urlLike) {
    const info = detectPlatform(urlLike);
    if (!info) {
      throw new Error('无法识别的歌单链接，请粘贴网易云(music.163.com)或QQ音乐(y.qq.com)的歌单链接');
    }
    const r = await axios.get(
      `${METING}?type=playlist&id=${info.id}&server=${info.server}`,
      { headers: { 'User-Agent': UA, Referer: BASE + '/' }, timeout: 20000 }
    );
    const list = Array.isArray(r.data) ? r.data : [];
    if (!list.length) throw new Error('该歌单未解析到歌曲，可能链接有误或已失效');
    return list.map((it) => {
      const { id, server } = parseMetingUrl(it.url);
      return {
        id: `meting_${server}_${id}`,
        title: it.name || '',
        artist: it.artist || '',
        album: '',
        artwork: it.pic || '',
        duration: 0,
        _murl: it.url,
      };
    });
  },

  // ===== 导入单曲（网易云 / QQ音乐）=====
  async importMusicItem(urlLike) {
    const info = detectPlatform(urlLike);
    if (!info) {
      throw new Error('无法识别的歌曲链接，请粘贴网易云或QQ音乐的歌曲链接');
    }
    const r = await axios.get(
      `${METING}?type=song&id=${info.id}&server=${info.server}`,
      { headers: { 'User-Agent': UA, Referer: BASE + '/' }, timeout: 15000 }
    );
    const it = Array.isArray(r.data) ? r.data[0] : r.data;
    if (!it || !it.url) throw new Error('未解析到歌曲信息，可能链接有误或已失效');
    const { id, server } = parseMetingUrl(it.url);
    return {
      id: `meting_${server}_${id}`,
      title: it.name || '',
      artist: it.artist || '',
      album: '',
      artwork: it.pic || '',
      duration: 0,
      _murl: it.url,
    };
  },

  // ===== 获取播放直链 =====
  async getMediaSource(musicItem) {
    let murl = musicItem._murl;
    if (!murl) {
      // xiage 站内歌曲：经 songs.php 取 meting 播放地址
      const html = await getDetail(musicItem.id);
      const posM = html.match(/songs\.php\?pos=([^"')\s]+)/);
      if (!posM) throw new Error('无法获取播放信息');
      const sp = await req(`${SONGS_PHP}?pos=${posM[1]}`, `${BASE}/s/${musicItem.id}`);
      const sm = sp.data.match(/src:"([^"]*)"/);
      if (!sm || !sm[1]) throw new Error('该歌曲仅提供网盘下载，暂无可在线播放的音源');
      murl = sm[1];
    }
    const url = await resolveMetingAudio(murl);
    return { url };
  },

  // ===== 歌词（meting 真实 LRC）=====
  async getLyric(musicItem) {
    let murl = musicItem._murl;
    if (!murl) {
      try {
        const html = await getDetail(musicItem.id);
        const posM = html.match(/songs\.php\?pos=([^"')\s]+)/);
        if (posM) {
          const sp = await req(`${SONGS_PHP}?pos=${posM[1]}`, `${BASE}/s/${musicItem.id}`);
          const sm = sp.data.match(/src:"([^"]*)"/);
          if (sm && sm[1]) murl = sm[1];
        }
      } catch (e) {
        /* 忽略，返回空歌词 */
      }
    }
    if (!murl) return { rawLrc: '', translation: '' };
    try {
      const r = await axios.get(lrcUrlFromMurl(murl), {
        headers: { 'User-Agent': UA, Referer: BASE + '/' },
        timeout: 15000,
      });
      return { rawLrc: typeof r.data === 'string' ? r.data : '', translation: '' };
    } catch (e) {
      return { rawLrc: '', translation: '' };
    }
  },
};
