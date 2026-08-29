/*
 * 咪咕音乐 MusicFree 插件
 * 站点：https://music.migu.cn/
 * 逆向来源：浏览器实测（Playwright 捕获真实请求，非猜测）
 *
 * 接口说明（均免 cookie，插件沙箱内可直接调用）：
 *  - 搜索：GET https://app.u.nf.migu.cn/pc/resource/song/item/search/v1.0?text=关键词&pageNo=N&pageSize=20
 *          返回 JSON 数组（直接是歌曲列表），支持翻页（每页 20 条，不同页返回不同歌曲）。
 *  - 音源：GET https://app.c.nf.migu.cn/MIGUM3.0/strategy/pc/listen/v1.0?resourceType=2&copyrightId=版权ID&contentId=内容ID&toneFlag=PQ
 *          返回 data.url（freetyst.nf.migu.cn 直链，免费试听/标准音质）。
 *          data.lrcUrl 为歌词文件直链。
 *  - 排行榜列表：GET https://app.c.nf.migu.cn/pc/bmw/rank/rank-index/v1.0
 *          返回 data.contents[]（按分类分组），每组 contents[] 为榜单 {rankId, rankName, imageUrl}。
 *  - 排行榜详情：GET https://app.c.nf.migu.cn/pc/bmw/rank/rank-info/v1.0?rankId=榜单ID&pageNo=N&pageSize=20
 *          返回 data.contents[]（歌曲，含 resId/contentId/copyrightId/resType）+ data.hasNextPage（可翻页）。
 *  - 排行榜列表：GET https://app.c.nf.migu.cn/pc/bmw/rank/rank-index/v1.0
 *          返回 data.contents[]（按分类分组），每组 contents[] 为榜单 {rankId, rankName, imageUrl}。
 *  - 排行榜详情：GET https://app.c.nf.migu.cn/pc/bmw/rank/rank-info/v1.0?rankId=榜单ID&pageNo=N&pageSize=20
 *          返回 data.contents[]（歌曲，含 resId/contentId/copyrightId/resType）+ data.hasNextPage（可翻页）。
 *
 * 关于「歌单」：咪咕公开歌单无免 cookie 的可播放数据源（实测 album/singer/playlist/radio
 *   等 bmw 接口均返回 299997 请求不支持）。故排行榜始终可用；歌单需用户在插件变量中
 *   填入咪咕登录 cookie 后显示（recommend-playlist + playlist-info），歌曲同样经 listen 播放。
 *   未填 cookie 时，歌单/排行榜页仅展示排行榜，不影响搜索/播放/歌词。
 *
 * 已知限制：
 *  - 标清 PQ 为免费档；HQ/SQ 为会员专属（返回 cannotCode 440013/440022）。
 *  - 原唱热门曲目部分需白金会员，插件对会员限定曲目抛出友好提示。
 */

const PLATFORM = '咪咕音乐';
const SEARCH_URL = 'https://app.u.nf.migu.cn/pc/resource/song/item/search/v1.0';
const LISTEN_URL = 'https://app.c.nf.migu.cn/MIGUM3.0/strategy/pc/listen/v1.0';
const RANK_INDEX_URL = 'https://app.c.nf.migu.cn/pc/bmw/rank/rank-index/v1.0';
const RANK_INFO_URL = 'https://app.c.nf.migu.cn/pc/bmw/rank/rank-info/v1.0';
// 歌单（需登录态）：公开歌单无免 cookie 接口，以下接口需携带 migu 登录 cookie
const PLAYLIST_RECOMMEND_URL = 'https://app.c.nf.migu.cn/pc/bmw/playlist/recommend/v1.0';
const PLAYLIST_INFO_URL = 'https://app.c.nf.migu.cn/pc/bmw/playlist/playlist-info/v1.0';

// 设备标识：保持稳定，避免被识别为大量设备。
function genDeviceId() {
  const hex = '0123456789ABCDEF';
  let s = '';
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) s += '-';
    s += hex[Math.floor(Math.random() * 16)];
  }
  return s;
}
const DEVICE_ID = genDeviceId();

function buildHeaders() {
  return {
    appid: 'h5',
    timestamp: String(Date.now()),
    deviceid: DEVICE_ID,
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

const PAGE_SIZE = 20;

// 搜索结果 -> MusicFree 音乐项
function toMusicItem(raw) {
  const singers = (raw.singerList || [])
    .map((s) => s.name)
    .filter(Boolean)
    .join('、');
  const cover = raw.img1 || raw.img2 || raw.img3 || '';
  return {
    id: String(raw.contentId || raw.songId),
    title: raw.songName || '未知标题',
    artist: singers || '未知歌手',
    album: raw.album || '',
    coverImg: cover,
    duration: Number(raw.duration || 0) * 1000, // 秒 -> 毫秒
    // 透传字段，供 getMediaSource / getLyric 使用
    _contentId: String(raw.contentId || ''),
    _copyrightId: String(raw.copyrightId || ''),
    _resourceType: String(raw.resourceType || '2'),
  };
}

// 排行榜歌曲（rank-info 的 contents 项）-> MusicFree 音乐项
function toRankSong(raw) {
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

// 栏目歌曲（保留占位：公开栏目歌曲 ID 无法经 listen 解析为可播放地址，暂不启用）

// 歌单歌曲（playlist-info 的 contents 项）-> MusicFree 音乐项
function toPlaylistSong(raw) {
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

module.exports = {
  platform: PLATFORM,
  version: '0.0.3',
  author: 'tianpeng',
  // 安装/更新地址：jsDelivr 直链（gitee.com/raw 会 302，直链零跳转更稳）
  srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@main/musicfree-migu/migu.js',

  // 用户变量：填入咪咕登录 cookie 后，歌单（个人/推荐歌单）方可显示并可播放
  userVariables: [
    {
      name: 'miguCookie',
      label: '咪咕登录 Cookie（选填，用于显示歌单；留空则仅显示排行榜）',
      default: '',
    },
  ],

  // 读取用户传入的 cookie（MusicFree 将 userVariables 注入 this.userVariables）
  _cookie() {
    const v = this.userVariables;
    return (v && typeof v === 'object' && v.miguCookie) || '';
  },

  // 搜索（支持翻页）
  async search(query, page = 1, type) {
    try {
      const resp = await axios.get(SEARCH_URL, {
        params: {
          text: query,
          pageNo: page,
          pageSize: PAGE_SIZE,
        },
        headers: buildHeaders(),
      });
      const list = Array.isArray(resp.data) ? resp.data : [];
      const data = list
        .map(toMusicItem)
        .filter((it) => it._contentId && it._copyrightId);
      // 返回数量少于每页大小即视为末页
      return {
        isEnd: data.length < PAGE_SIZE,
        data,
      };
    } catch (e) {
      console.error('[migu] search error:', e.message);
      return { isEnd: true, data: [] };
    }
  },

  // 歌单列表（需登录态）：返回推荐/个人歌单
  async _getPlaylists() {
    const cookie = this._cookie();
    if (!cookie) return [];
    const items = [];
    try {
      const resp = await axios.get(PLAYLIST_RECOMMEND_URL, {
        headers: { ...buildHeaders(), Cookie: cookie },
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
      console.error('[migu] getTopLists(playlist) error:', e.message);
    }
    return items;
  },

  // 歌单/排行榜 列表：排行榜始终显示；歌单需填入 cookie 后显示
  async getTopLists() {
    const items = [];
    try {
      const resp = await axios.get(RANK_INDEX_URL, { headers: buildHeaders() });
      const cats = resp.data?.data?.contents || [];
      for (const cat of cats) {
        const ranks = cat.contents || [];
        for (const r of ranks) {
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
    // 歌单（需 cookie）
    const playlists = await this._getPlaylists();
    return items.concat(playlists);
  },

  // 榜单/歌单详情（支持翻页）
  async getTopListDetail(topListItem, page = 1) {
    try {
      if (topListItem._type === 'rank') {
        const resp = await axios.get(RANK_INFO_URL, {
          params: {
            rankId: topListItem._rankId,
            pageNo: page,
            pageSize: PAGE_SIZE,
          },
          headers: buildHeaders(),
        });
        const d = resp.data?.data || {};
        const data = (d.contents || [])
          .map(toRankSong)
          .filter((it) => it._contentId && it._copyrightId);
        return { isEnd: !d.hasNextPage, data };
      }
      if (topListItem._type === 'playlist') {
        const cookie = this._cookie();
        const resp = await axios.get(PLAYLIST_INFO_URL, {
          params: {
            playlistId: topListItem._playlistId,
            pageNo: page,
            pageSize: PAGE_SIZE,
          },
          headers: { ...buildHeaders(), ...(cookie ? { Cookie: cookie } : {}) },
        });
        const d = resp.data?.data || {};
        const data = (d.contents || [])
          .map(toPlaylistSong)
          .filter((it) => it._contentId && it._copyrightId);
        return { isEnd: !d.hasNextPage, data };
      }
      return { isEnd: true, data: [] };
    } catch (e) {
      console.error('[migu] getTopListDetail error:', e.message);
      return { isEnd: true, data: [] };
    }
  },

  // 获取播放音源
  async getMediaSource(musicItem, quality, candidate) {
    const { _contentId, _copyrightId, _resourceType } = musicItem;
    if (!_contentId || !_copyrightId) {
      throw new Error('缺少歌曲标识，无法获取音源');
    }
    try {
      const resp = await axios.get(LISTEN_URL, {
        params: {
          resourceType: _resourceType || '2',
          copyrightId: _copyrightId,
          contentId: _contentId,
          toneFlag: 'PQ', // 免费标准音质
        },
        headers: buildHeaders(),
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
  },

  // 获取歌词
  async getLyric(musicItem) {
    const { _contentId, _copyrightId, _resourceType } = musicItem;
    if (!_contentId || !_copyrightId) return { rawLrc: '' };
    try {
      const resp = await axios.get(LISTEN_URL, {
        params: {
          resourceType: _resourceType || '2',
          copyrightId: _copyrightId,
          contentId: _contentId,
          toneFlag: 'PQ',
        },
        headers: buildHeaders(),
      });
      const lrcUrl = resp.data?.data?.lrcUrl;
      if (!lrcUrl) return { rawLrc: '' };
      const lrcResp = await axios.get(lrcUrl, {
        headers: { 'user-agent': buildHeaders()['user-agent'] },
      });
      const rawLrc = typeof lrcResp.data === 'string' ? lrcResp.data : '';
      return { rawLrc };
    } catch (e) {
      console.error('[migu] getLyric error:', e.message);
      return { rawLrc: '' };
    }
  },
};
