// 我要下歌 (xiage.yiwuku.com) MusicFree 插件
// 站点类型：Z-Blog 静态 HTML 音乐下载站，歌曲详情页内联播放源接口 songs.php?pos=XXX
// 逆向来源：全部来自真实站点 HTML 实测（axios 复现 + DOM 结构逐字段核对），无网络搜索/盲猜
//
// 已知限制（站点侧，非插件 bug）：
//  - 服务端搜索接口（cmd.php?act=search / search.php?q=）对任意关键词均返回固定的一套
//    “歌单合集”卡片，搜索词被完全忽略。此为站点反爬/配置问题，纯 HTTP 抓取无法触发真实搜索。
//    因此本插件 search 实现为“可浏览目录最佳匹配”：在最新歌曲池 + 歌单合集名中做子串匹配，
//    命中歌单时展开该歌单内歌曲。覆盖最新/热门内容，无法检索全站历史歌曲。
//  - 歌单详情页（/s/ID）单页最多展示 12 首，站点无分页接口，大歌单会被截断（站点限制）。
//  - 部分歌曲仅提供网盘（迅雷）下载、无在线播放源，此类在 getMediaSource 抛友好错误。
//  - 歌词取自详情页 meta description（纯文本，无逐行时间戳）。
//  - 播放直链为 kuwo CDN，可能带时效，故 cacheControl 设为 no-store。
//
// 返回值结构严格遵循 MusicFree 插件协议：
//  - getTopLists  -> IMusicSheetGroupItem[] = [{ title, data: IMusicSheetItem[] }]
//  - getTopListDetail / getMusicSheetInfo -> { isEnd, musicList: IMusicItem[] }
//  - search -> { isEnd, data: IMusicItem[] }
//  - importMusicSheet / importMusicItem -> IMusicItem[]

const axios = require('axios');

const BASE = 'https://xiage.yiwuku.com';
const SONGS_PHP = BASE + '/zb_users/theme/erx_Xiage/songs.php';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function req(url, ref) {
  return axios.get(url, {
    headers: { 'User-Agent': UA, Referer: ref || BASE + '/' },
    timeout: 10000,
  });
}

// 详情页 HTML 缓存（getMediaSource 与 getLyric 共用，避免重复请求）
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
// 每个 <li> -> <a href="/s/SONGID"> -> <div class="tit"><span class="m">标题</span><span class="f12 i">时长</span></div>
//                                  -> <div class="ser"><span>歌手</span></div>
// 注意：歌单合集卡片在独立的 erx-list-special 区块，不会被本函数误抓。
function parseItems(html) {
  const list = [];
  // 仅截取 erx-m-list 列表区块，避免抓到页面其它 <li>
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
    // Bug3 修复：歌手缺省留空，绝不填“未知”等占位符，否则会污染跨源自动换源的匹配键
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

// 解析“歌单合集”卡片：<ul class="...list-special-box..."> 下 <li><a class="erx-m-box" href="/s/ID">
//   -> <div class="a">歌单名</div><div class="p-count"><span>共<em>N</em>首</span>
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

// 抓取首页某页的“最新歌曲”列表。page<=1 取首页，否则取 /page_N.html
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

module.exports = {
  platform: '我要下歌',
  version: '0.0.4',
  author: 'tianpeng',
  srcUrl: 'https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js',
  description: '我要下歌(xiage.yiwuku.com) 音乐插件：歌单/排行榜浏览、最佳匹配搜索、在线播放、歌词、导入歌单',
  cacheControl: 'no-store',
  supportedSearchType: ['music'],

  // ===== 排行榜 / 歌单列表（分组结构）=====
  // 协议：返回 IMusicSheetGroupItem[] = [{ title, data: IMusicSheetItem[] }]
  // ⚠️ 必须包一层分组，MusicFree 按 group.data 渲染，扁平数组会报 length of undefined
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

  // 内部：根据 sheetItem 抓取歌曲（home 翻页 / playlist 单页）
  async _fetchSongs(sheetItem, page) {
    if (sheetItem._kind === 'home') {
      return getHomeSongs(page);
    }
    try {
      const resp = await req(sheetItem._url);
      const songs = parseItems(resp.data);
      // 歌单合集单页，站点无分页接口
      return { songs, hasNext: false };
    } catch (e) {
      return { songs: [], hasNext: false };
    }
  },

  // ===== 排行榜详情 =====
  // 协议：返回 { isEnd, musicList: IMusicItem[] }（注意是 musicList，不是 data）
  async getTopListDetail(topListItem, page = 1) {
    const { songs, hasNext } = await this._fetchSongs(topListItem, page);
    return {
      isEnd: songs.length === 0 || !hasNext,
      musicList: songs,
    };
  },

  // ===== 歌单详情（从导入/收藏进入时调用）=====
  // 协议同 getTopListDetail
  async getMusicSheetInfo(sheetItem, page = 1) {
    const { songs, hasNext } = await this._fetchSongs(sheetItem, page);
    return {
      isEnd: songs.length === 0 || !hasNext,
      musicList: songs,
    };
  },

  // ===== 搜索（可浏览目录最佳匹配）=====
  // 协议：返回 { isEnd, data: IMusicItem[] }
  // 站点服务端搜索对 HTTP 不生效（见文件头说明），故改为：
  //   1) 抓取首页前 3 页最新歌曲（≈39 首）构成搜索池；
  //   2) 抓取歌单合集，关键词（大小写不敏感）匹配 歌曲标题/歌手 与 歌单名；
  //   3) 命中歌单时展开其内歌曲一并返回。
  // 局限性：仅覆盖最新/热门内容，无法检索全站历史歌曲（站点搜索接口失效所致）。
  async search(query, page, type) {
    if (type && type !== 'music') return { isEnd: true, data: [] };
    const q = (query || '').trim().toLowerCase();
    if (!q) return { isEnd: true, data: [] };

    // 扩大搜索池：首页前 3 页
    const homePages = await Promise.all([
      getHomeSongs(1),
      getHomeSongs(2),
      getHomeSongs(3),
    ]);
    let songs = [];
    homePages.forEach((h) => {
      songs = songs.concat(h.songs);
    });

    const resp = await req(BASE + '/');
    const playlists = parsePlaylists(resp.data);

    const matchedSongs = songs.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.artist && s.artist.toLowerCase().includes(q))
    );

    // 命中歌单名 -> 展开歌单内歌曲
    const matchedPlaylists = playlists.filter((p) => p.title.toLowerCase().includes(q));
    let playlistSongs = [];
    if (matchedPlaylists.length > 0) {
      const fetched = await Promise.all(
        matchedPlaylists.map((p) =>
          req(`${BASE}/s/${p.id}`)
            .then((r) => parseItems(r.data))
            .catch(() => [])
        )
      );
      playlistSongs = fetched.flat();
    }

    // 去重（同一歌曲可能既在最新歌曲又在歌单中）
    const seen = new Set();
    const data = [];
    for (const s of [...matchedSongs, ...playlistSongs]) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      data.push(s);
    }
    return { isEnd: true, data };
  },

  // ===== 导入歌单 =====
  // 协议：importMusicSheet(urlLike) -> IMusicItem[]
  // 用户输入 xiage.yiwuku.com/s/ID 形式的歌单链接，解析后返回歌曲列表
  async importMusicSheet(urlLike) {
    const m = String(urlLike || '').match(/\/s\/([^/?#"'\s]+)/);
    if (!m) {
      throw new Error('无法识别的歌单链接，请粘贴 xiage.yiwuku.com/s/xxx 形式的链接');
    }
    const resp = await req(`${BASE}/s/${m[1]}`);
    const data = parseItems(resp.data);
    if (data.length === 0) {
      throw new Error('该歌单未解析到歌曲，可能链接有误或已失效');
    }
    return data;
  },

  // ===== 导入单曲 =====
  // 协议：importMusicItem(urlLike) -> IMusicItem
  async importMusicItem(urlLike) {
    const m = String(urlLike || '').match(/\/s\/([^/?#"'\s]+)/);
    if (!m) {
      throw new Error('无法识别的歌曲链接，请粘贴 xiage.yiwuku.com/s/xxx 形式的链接');
    }
    const html = await getDetail(m[1]);
    const items = parseItems(html);
    // 详情页 erx-m-list 第一首即该歌曲本身
    if (items.length === 0) {
      throw new Error('未解析到歌曲信息，可能链接有误或已失效');
    }
    return items[0];
  },

  // ===== 获取播放直链 =====
  async getMediaSource(musicItem) {
    const id = musicItem.id;
    const html = await getDetail(id);
    const posMatch = html.match(/songs\.php\?pos=([^"')\s]+)/);
    if (!posMatch) throw new Error('无法获取播放信息');
    const sp = await req(`${SONGS_PHP}?pos=${posMatch[1]}`, `${BASE}/s/${id}`);
    const srcMatch = sp.data.match(/src:"([^"]*)"/);
    if (!srcMatch || !srcMatch[1]) {
      throw new Error('该歌曲仅提供网盘下载，暂无可在线播放的音源');
    }
    // kuwo CDN 同时支持 http/https，统一升级为 https 以兼容更多播放环境
    const url = srcMatch[1].replace(/^http:\/\//i, 'https://');
    return { url };
  },

  // ===== 歌词（取详情页 meta description）=====
  async getLyric(musicItem) {
    const id = musicItem.id;
    const html = await getDetail(id);
    const m = html.match(/<meta name="description" content="([^"]*)"/);
    let raw = m ? m[1] : '';
    // 去掉开头的"（网友热搜xxx）"提示语
    raw = raw.replace(/^（[^）]*）/, '').trim();
    return { rawLrc: raw, translation: '' };
  },
};
