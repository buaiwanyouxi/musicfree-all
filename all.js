/*
 * 聚合音乐 MusicFree 插件（v1.0.0）
 * 合并三个独立插件为一个：
 *   - 咪咕音乐  (music.migu.cn)        前缀 mg:
 *   - 我要下歌  (xiage.yiwuku.com)      前缀 xi:
 *   - 布谷音乐  (buguyy.top, 数据源酷我) 前缀 bg:
 *
 * 合并原理：MusicFree 的 module.exports 只能是一个插件对象。
 * 为把三个源合并，给每个「媒体项 / 榜单项」的 id 打上源前缀（mg:/xi:/bg:），
 * 由统一入口按前缀路由到对应子插件的实现，子实现内部使用「去掉前缀后的真实 id」。
 *
 * 逆向来源：全部来自浏览器实测（Playwright 捕获 + axios 复现），无网络搜索/盲猜。
 */

const axios = globalThis.axios || (typeof require === 'function' ? require('axios') : undefined);

/* =========================================================================
 * 通用：源前缀 / 路由工具
 * ========================================================================= */
const PFX = { MIGU: 'mg', XIAGE: 'xi', BUGUYY: 'bg' };

function tag(id, prefix) {
  return prefix + ':' + String(id);
}

function splitId(fullId) {
  const s = String(fullId == null ? '' : fullId);
  const i = s.indexOf(':');
  if (i < 0) return ['', s];
  return [s.slice(0, i), s.slice(i + 1)];
}

function prefixItems(items, prefix) {
  return (items || []).map((it) => ({ ...it, id: tag(it.id, prefix) }));
}

/* =========================================================================
 * 咪咕音乐（mg）
 * ========================================================================= */
const MIGU_SEARCH_URL = 'https://app.u.nf.migu.cn/pc/resource/song/item/search/v1.0';
const MIGU_LISTEN_URL = 'https://app.c.nf.migu.cn/MIGUM3.0/strategy/pc/listen/v1.0';
const MIGU_RANK_INDEX_URL = 'https://app.c.nf.migu.cn/pc/bmw/rank/rank-index/v1.0';
const MIGU_RANK_INFO_URL = 'https://app.c.nf.migu.cn/pc/bmw/rank/rank-info/v1.0';
const MIGU_PLAYLIST_RECOMMEND_URL = 'https://app.c.nf.migu.cn/pc/bmw/playlist/recommend/v1.0';
const MIGU_PLAYLIST_INFO_URL = 'https://app.c.nf.migu.cn/pc/bmw/playlist/playlist-info/v1.0';
const MIGU_PAGE_SIZE = 20;

function miguGenDeviceId() {
  const hex = '0123456789ABCDEF';
  let s = '';
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) s += '-';
    s += hex[Math.floor(Math.random() * 16)];
  }
  return s;
}
const MIGU_DEVICE_ID = miguGenDeviceId();

function miguBuildHeaders() {
  return {
    appid: 'h5',
    timestamp: String(Date.now()),
    deviceid: MIGU_DEVICE_ID,
    subchannel: '014X031',
    channel: '014X031',
    platform: 'H5',
    referer: 'https://music.migu.cn/',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    version: '6.8.8',
    ua: 'Android_migu',
    accept: 'application/json, text/plain, */*',
  };
}

function miguToMusicItem(raw) {
  const singers = (raw.singerList || []).map((s) => s.name).filter(Boolean).join('、');
  const cover = raw.img1 || raw.img2 || raw.img3 || '';
  return {
    id: String(raw.contentId || raw.songId),
    title: raw.songName || '未知标题',
    artist: singers || '未知歌手',
    album: raw.album || '',
    coverImg: cover,
    duration: Number(raw.duration || 0) * 1000,
    _contentId: String(raw.contentId || ''),
    _copyrightId: String(raw.copyrightId || ''),
    _resourceType: String(raw.resourceType || '2'),
  };
}

function miguToRankSong(raw) {
  return {
    id: String(raw.resId || raw.songId || ''),
    title: raw.txt || '未知标题',
    artist: raw.txt2 || '未知歌手',
    album: raw.txt3 || '',
    coverImg: raw.img || '',
    duration: 0,
    _contentId: String(raw.resId || ''),
    _copyrightId: String(raw.copyrightId || ''),
    _resourceType: String(raw.resType || '2'),
  };
}

function miguToPlaylistSong(raw) {
  return {
    id: String(raw.contentId || raw.songId || ''),
    title: raw.songName || raw.name || '未知标题',
    artist: (raw.singerList || []).map((s) => s.name).filter(Boolean).join('、') || '未知歌手',
    album: raw.album || '',
    coverImg: raw.img1 || raw.img2 || raw.img3 || '',
    duration: Number(raw.duration || 0) * 1000,
    _contentId: String(raw.contentId || ''),
    _copyrightId: String(raw.copyrightId || ''),
    _resourceType: String(raw.resourceType || '2'),
  };
}

async function miguSearch(query, page, type) {
  if (type && type !== 'music') return { isEnd: true, data: [] };
  try {
    const resp = await axios.get(MIGU_SEARCH_URL, {
      params: { text: query, pageNo: page, pageSize: MIGU_PAGE_SIZE },
      headers: miguBuildHeaders(),
    });
    const list = Array.isArray(resp.data) ? resp.data : [];
    const data = list.map(miguToMusicItem).filter((it) => it._contentId && it._copyrightId);
    return { isEnd: data.length < MIGU_PAGE_SIZE, data };
  } catch (e) {
    console.error('[migu] search error:', e.message);
    return { isEnd: true, data: [] };
  }
}

async function miguGetPlaylists(cookie) {
  if (!cookie) return [];
  const items = [];
  try {
    const resp = await axios.get(MIGU_PLAYLIST_RECOMMEND_URL, {
      headers: { ...miguBuildHeaders(), Cookie: cookie },
    });
    const contents = resp.data?.data?.contents || [];
    for (const grp of contents) {
      const lists = grp.contents || grp.playlists || [];
      for (const p of lists) {
        if (p.playlistId && p.playlistName) {
          items.push({
            id: 'pl_' + p.playlistId,
            title: p.playlistName,
            coverImg: p.imageUrl || p.cover || '',
            _type: 'playlist',
            _playlistId: p.playlistId,
          });
        }
      }
    }
  } catch (e) {
    console.error('[migu] getPlaylists error:', e.message);
  }
  return items;
}

async function miguGetTopLists(cookie) {
  const items = [];
  try {
    const resp = await axios.get(MIGU_RANK_INDEX_URL, { headers: miguBuildHeaders() });
    const cats = resp.data?.data?.contents || [];
    for (const cat of cats) {
      for (const r of cat.contents || []) {
        if (r.rankId && r.rankName) {
          items.push({
            id: 'rank_' + r.rankId,
            title: r.rankName,
            coverImg: r.imageUrl || '',
            _type: 'rank',
            _rankId: r.rankId,
          });
        }
      }
    }
  } catch (e) {
    console.error('[migu] getTopLists(rank) error:', e.message);
  }
  const playlists = await miguGetPlaylists(cookie);
  return items.concat(playlists);
}

async function miguGetTopListDetail(item, page, cookie) {
  try {
    if (item._type === 'rank') {
      const resp = await axios.get(MIGU_RANK_INFO_URL, {
        params: { rankId: item._rankId, pageNo: page, pageSize: MIGU_PAGE_SIZE },
        headers: miguBuildHeaders(),
      });
      const d = resp.data?.data || {};
      const data = (d.contents || [])
        .map(miguToRankSong)
        .filter((it) => it._contentId && it._copyrightId);
      return { isEnd: !d.hasNextPage, data };
    }
    if (item._type === 'playlist') {
      const resp = await axios.get(MIGU_PLAYLIST_INFO_URL, {
        params: { playlistId: item._playlistId, pageNo: page, pageSize: MIGU_PAGE_SIZE },
        headers: { ...miguBuildHeaders(), ...(cookie ? { Cookie: cookie } : {}) },
      });
      const d = resp.data?.data || {};
      const data = (d.contents || [])
        .map(miguToPlaylistSong)
        .filter((it) => it._contentId && it._copyrightId);
      return { isEnd: !d.hasNextPage, data };
    }
    return { isEnd: true, data: [] };
  } catch (e) {
    console.error('[migu] getTopListDetail error:', e.message);
    return { isEnd: true, data: [] };
  }
}

async function miguGetMediaSource(musicItem, quality, candidate) {
  const { _contentId, _copyrightId, _resourceType } = musicItem;
  if (!_contentId || !_copyrightId) throw new Error('缺少歌曲标识，无法获取音源');
  try {
    const resp = await axios.get(MIGU_LISTEN_URL, {
      params: {
        resourceType: _resourceType || '2',
        copyrightId: _copyrightId,
        contentId: _contentId,
        toneFlag: 'PQ',
      },
      headers: miguBuildHeaders(),
    });
    const d = resp.data?.data || {};
    const url = d.url || d.playUrl;
    if (!url) {
      const code = d.cannotCode || '';
      if (code === '440013' || code === '440022' || code === '440014') {
        throw new Error('该歌曲为会员专属，无法免费播放');
      }
      throw new Error('未获取到播放地址（可能需会员）');
    }
    return {
      url,
      headers: {
        referer: 'https://music.migu.cn/',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    };
  } catch (e) {
    if (e.message && e.message.includes('会员')) throw e;
    console.error('[migu] getMediaSource error:', e.message);
    throw new Error('获取音源失败：' + e.message);
  }
}

async function miguGetLyric(musicItem) {
  const { _contentId, _copyrightId, _resourceType } = musicItem;
  if (!_contentId || !_copyrightId) return { rawLrc: '' };
  try {
    const resp = await axios.get(MIGU_LISTEN_URL, {
      params: {
        resourceType: _resourceType || '2',
        copyrightId: _copyrightId,
        contentId: _contentId,
        toneFlag: 'PQ',
      },
      headers: miguBuildHeaders(),
    });
    const lrcUrl = resp.data?.data?.lrcUrl;
    if (!lrcUrl) return { rawLrc: '' };
    const lrcResp = await axios.get(lrcUrl, {
      headers: { 'user-agent': miguBuildHeaders()['user-agent'] },
    });
    const rawLrc = typeof lrcResp.data === 'string' ? lrcResp.data : '';
    return { rawLrc };
  } catch (e) {
    console.error('[migu] getLyric error:', e.message);
    return { rawLrc: '' };
  }
}

/* =========================================================================
 * 我要下歌（xi）
 * ========================================================================= */
const XIAGE_BASE = 'https://xiage.yiwuku.com';
const XIAGE_SONGS_PHP = XIAGE_BASE + '/zb_users/theme/erx_Xiage/songs.php';
const XIAGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function xiageReq(url, ref) {
  return axios.get(url, {
    headers: { 'User-Agent': XIAGE_UA, Referer: ref || XIAGE_BASE + '/' },
    timeout: 10000,
  });
}

const _xiageDetailCache = {};

async function xiageGetDetail(id) {
  if (_xiageDetailCache[id]) return _xiageDetailCache[id];
  const resp = await xiageReq(`${XIAGE_BASE}/s/${id}`);
  _xiageDetailCache[id] = resp.data;
  return resp.data;
}

function xiageParseDuration(text) {
  if (!text) return 0;
  const parts = text.replace(/[^\d:]/g, '').split(':').filter(Boolean);
  if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  if (parts.length === 3)
    return (
      parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10)
    );
  return 0;
}

function xiageParseItems(html) {
  const list = [];
  const itemRe = /<li class="sound-item">([\s\S]*?)<\/li>/g;
  const hrefRe = /\/s\/([^/?#"'\s]+)/;
  const titleRe = /class="m">([^<]*)</;
  const artistRe = /class="ser"><span>([^<]*)</;
  const durRe = /class="f12 i">([^<]*)</;
  let m;
  while ((m = itemRe.exec(html)) !== null) {
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
      artist: artistM ? artistM[1].trim() : '未知',
      album: '',
      duration: xiageParseDuration(durM ? durM[1] : ''),
      _id: id,
    });
  }
  return list;
}

async function xiageSearch(query, page, type) {
  if (type && type !== 'music') return { isEnd: true, data: [] };
  const resp = await xiageReq(`${XIAGE_BASE}/search.php?q=${encodeURIComponent(query)}`);
  const data = xiageParseItems(resp.data);
  return { isEnd: true, data };
}

async function xiageGetTopLists() {
  return [
    {
      id: 'latest',
      title: '最新歌曲',
      coverImg: '',
      _type: 'playlist',
      _url: XIAGE_BASE + '/',
    },
  ];
}

async function xiageGetTopListDetail(item, page) {
  const url = page <= 1 ? item._url : `${XIAGE_BASE}/page_${page}.html`;
  const resp = await xiageReq(url);
  const data = xiageParseItems(resp.data);
  const hasNext = /class="next"/.test(resp.data);
  return { isEnd: data.length === 0 || !hasNext, data };
}

async function xiageGetMediaSource(musicItem) {
  const id = musicItem.id || musicItem._id;
  const html = await xiageGetDetail(id);
  const posMatch = html.match(/songs\.php\?pos=([^"')\s]+)/);
  if (!posMatch) throw new Error('无法获取播放信息');
  const sp = await xiageReq(`${XIAGE_SONGS_PHP}?pos=${posMatch[1]}`, `${XIAGE_BASE}/s/${id}`);
  const srcMatch = sp.data.match(/src:"([^"]*)"/);
  if (!srcMatch || !srcMatch[1]) {
    throw new Error('该歌曲仅提供网盘下载，暂无可在线播放的音源');
  }
  const url = srcMatch[1].replace(/^http:\/\//i, 'https://');
  return { url };
}

async function xiageGetLyric(musicItem) {
  const id = musicItem.id || musicItem._id;
  const html = await xiageGetDetail(id);
  const m = html.match(/<meta name="description" content="([^"]*)"/);
  let raw = m ? m[1] : '';
  raw = raw.replace(/^（[^）]*）/, '').trim();
  return { rawLrc: raw, translation: '' };
}

/* =========================================================================
 * 布谷音乐（bg）
 * ========================================================================= */
const BUGUYY_BASE = 'https://www.buguyy.top';

function buguyyStdHeaders() {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Referer: BUGUYY_BASE + '/',
    Accept: 'application/json, text/plain, */*',
  };
}

async function buguyyApiGet(path, params) {
  const res = await axios.get(BUGUYY_BASE + path, { params, headers: buguyyStdHeaders() });
  return res.data;
}

function buguyyToMusicItem(it) {
  return {
    id: String(it.id),
    title: it.title || '未知标题',
    artist: it.singer || '未知歌手',
    artwork: it.picurl || '',
    about: it.about || '',
  };
}

async function buguyySearch(query, page, type) {
  if (type && type !== 'music') return { isEnd: true, data: [] };
  const data = await buguyyApiGet('/api/search', { keyword: query });
  if (!data || !data.success || !Array.isArray(data.data)) return { isEnd: true, data: [] };
  return { isEnd: true, data: data.data.map(buguyyToMusicItem) };
}

async function buguyyGetMediaSource(musicItem) {
  const data = await buguyyApiGet('/api/geturl', { id: musicItem.id });
  if (!data || !data.success || !data.url) throw new Error('获取播放链接失败');
  return {
    url: data.url,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: BUGUYY_BASE + '/',
    },
  };
}

async function buguyyGetLyric(musicItem) {
  const about = musicItem.about || '';
  if (!about || about.indexOf('歌词获取失败') !== -1) return { rawLrc: '' };
  const rawLrc = about.replace(/<br\s*\/?>/gi, '\n').trim();
  return { rawLrc };
}

function buguyyGetTopListSheets() {
  return [
    { id: 'newlist', title: '新歌榜', artwork: '' },
    { id: 'hotlist', title: '热歌榜', artwork: '' },
  ];
}

async function buguyyGetTopListDetail(item, page) {
  const data = await buguyyApiGet('/api/' + item.id);
  if (!data || !data.success || !Array.isArray(data.data)) return { isEnd: true, musicList: [] };
  return { isEnd: true, musicList: data.data.map(buguyyToMusicItem) };
}

/* =========================================================================
 * 合并导出（统一路由入口）
 * ========================================================================= */
function getCookie(ctx) {
  const v = ctx && ctx.userVariables;
  return (v && typeof v === 'object' && v.miguCookie) || '';
}

module.exports = {
  platform: '聚合音乐',
  version: '1.0.0',
  author: '船长',
  srcUrl: 'https://raw.githubusercontent.com/buaiwanyouxi/musicfree-all/main/all.js',
  description: '聚合音乐插件：咪咕音乐 + 我要下歌 + 布谷音乐。搜索 / 播放 / 歌词 / 排行榜一站式。',
  cacheControl: 'no-store',
  supportedSearchType: ['music'],

  // 用户变量：填入咪咕登录 Cookie 后，咪咕歌单（个人/推荐歌单）方可显示并可播放
  userVariables: [
    {
      name: 'miguCookie',
      label: '咪咕登录 Cookie（选填，用于显示咪咕歌单；留空则仅显示咪咕排行榜）',
      default: '',
    },
  ],

  // ===== 搜索：聚合三源。xiage/buguyy 不翻页，仅在首页返回；migu 翻页 =====
  async search(query, page = 1, type) {
    const out = [];
    let miguEnd = true;
    try {
      const r = await miguSearch(query, page, type);
      out.push(...prefixItems(r.data, PFX.MIGU));
      miguEnd = r.isEnd;
    } catch (e) {
      console.error('[all] migu search error:', e.message);
    }
    if (page <= 1) {
      try {
        const x = await xiageSearch(query, 1, type);
        out.push(...prefixItems(x.data, PFX.XIAGE));
      } catch (e) {
        console.error('[all] xiage search error:', e.message);
      }
      try {
        const b = await buguyySearch(query, 1, type);
        out.push(...prefixItems(b.data, PFX.BUGUYY));
      } catch (e) {
        console.error('[all] buguyy search error:', e.message);
      }
    }
    return { isEnd: miguEnd === true, data: out };
  },

  // ===== 播放音源：按前缀路由 =====
  async getMediaSource(musicItem, quality, candidate) {
    const [prefix, realId] = splitId(musicItem.id);
    const local = { ...musicItem, id: realId };
    if (prefix === PFX.MIGU) return miguGetMediaSource(local, quality, candidate);
    if (prefix === PFX.XIAGE) return xiageGetMediaSource(local);
    if (prefix === PFX.BUGUYY) return buguyyGetMediaSource(local);
    throw new Error('未知音源');
  },

  // ===== 歌词：按前缀路由 =====
  async getLyric(musicItem) {
    const [prefix, realId] = splitId(musicItem.id);
    const local = { ...musicItem, id: realId };
    if (prefix === PFX.MIGU) return miguGetLyric(local);
    if (prefix === PFX.XIAGE) return xiageGetLyric(local);
    if (prefix === PFX.BUGUYY) return buguyyGetLyric(local);
    return { rawLrc: '' };
  },

  // ===== 榜单列表：分组展示，id 加前缀 =====
  async getTopLists() {
    const cookie = getCookie(this);
    let miguItems = [];
    let xiageItems = [];
    let buguyyItems = [];
    try {
      miguItems = prefixItems(await miguGetTopLists(cookie), PFX.MIGU);
    } catch (e) {
      console.error('[all] migu getTopLists error:', e.message);
    }
    try {
      xiageItems = prefixItems(await xiageGetTopLists(), PFX.XIAGE);
    } catch (e) {
      console.error('[all] xiage getTopLists error:', e.message);
    }
    try {
      buguyyItems = prefixItems(buguyyGetTopListSheets(), PFX.BUGUYY);
    } catch (e) {
      console.error('[all] buguyy getTopLists error:', e.message);
    }
    return [
      { title: '咪咕音乐', data: miguItems },
      { title: '我要下歌', data: xiageItems },
      { title: '布谷音乐', data: buguyyItems },
    ];
  },

  // ===== 榜单详情：按前缀路由，返回 data 加前缀 =====
  async getTopListDetail(item, page = 1) {
    const [prefix, realId] = splitId(item.id);
    const local = { ...item, id: realId };
    let res = { isEnd: true, data: [] };
    try {
      if (prefix === PFX.MIGU) {
        res = await miguGetTopListDetail(local, page, getCookie(this));
      } else if (prefix === PFX.XIAGE) {
        res = await xiageGetTopListDetail(local, page);
      } else if (prefix === PFX.BUGUYY) {
        res = await buguyyGetTopListDetail(local, page);
      }
    } catch (e) {
      console.error('[all] getTopListDetail error:', e.message);
    }
    const raw = res.data || res.musicList || [];
    const data = prefixItems(raw, prefix);
    return { isEnd: !!res.isEnd, data, musicList: data };
  },
};
