// 布谷音乐 MusicFree 插件
// 站点: https://www.buguyy.top (在线音乐试听与无损音乐下载平台)
// 数据源: 酷我音乐 (KuWo)。搜索/播放接口均为站点代理，音频为酷我 CDN 直链。
// 作者: 船长
const axios = require('axios');

const BASE = 'https://www.buguyy.top';

function stdHeaders() {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Referer: BASE + '/',
    Accept: 'application/json, text/plain, */*',
  };
}

async function apiGet(path, params) {
  const res = await axios.get(BASE + path, { params, headers: stdHeaders() });
  return res.data;
}

// 将搜索结果项映射为 MusicFree 媒体项; 顺带保留 about(歌词原数据) 供 getLyric 使用
function toMusicItem(it) {
  return {
    id: String(it.id),
    title: it.title || '未知标题',
    artist: it.singer || '未知歌手',
    artwork: it.picurl || '',
    about: it.about || '',
  };
}

module.exports = {
  platform: '布谷音乐',
  version: '0.0.1',
  author: 'tianpeng',
  description:
    '布谷音乐 (buguyy.top) 插件，数据源为酷我音乐。支持搜索、播放、歌词与热门/新歌榜单。',
  srcUrl: 'https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-buguyy/buguyy.js',
  cacheControl: 'no-cache',
  supportedSearchType: ['music'],

  // ===== 搜索 (接口不翻页，固定返回最多 50 条) =====
  async search(query, page, type) {
    if (type !== 'music') return { isEnd: true, data: [] };
    const data = await apiGet('/api/search', { keyword: query });
    if (!data || !data.success || !Array.isArray(data.data)) {
      return { isEnd: true, data: [] };
    }
    return {
      isEnd: true,
      data: data.data.map(toMusicItem),
    };
  },

  // ===== 获取播放链接 (酷我 CDN 直链) =====
  async getMediaSource(musicItem, quality) {
    const data = await apiGet('/api/geturl', { id: musicItem.id });
    if (!data || !data.success || !data.url) {
      throw new Error('获取播放链接失败');
    }
    return {
      url: data.url,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: BASE + '/',
      },
    };
  },

  // ===== 歌词 (使用搜索结果中的 about 字段，LRC 格式) =====
  async getLyric(musicItem) {
    const about = musicItem.about || '';
    if (!about || about.indexOf('歌词获取失败') !== -1) {
      return { rawLrc: '' };
    }
    const rawLrc = about.replace(/<br\s*\/?>/gi, '\n').trim();
    return { rawLrc };
  },

  // ===== 榜单列表 (新歌榜 / 热歌榜) =====
  async getTopLists() {
    return [
      {
        title: '榜单',
        data: [
          { id: 'newlist', title: '新歌榜', artwork: '' },
          { id: 'hotlist', title: '热歌榜', artwork: '' },
        ],
      },
    ];
  },

  // ===== 榜单详情 (接口不翻页) =====
  async getTopListDetail(topListItem, page) {
    const data = await apiGet('/api/' + topListItem.id);
    if (!data || !data.success || !Array.isArray(data.data)) {
      return { isEnd: true, musicList: [] };
    }
    return {
      isEnd: true,
      musicList: data.data.map(toMusicItem),
    };
  },
};
