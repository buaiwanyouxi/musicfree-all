// 我要下歌 (xiage.yiwuku.com) MusicFree 插件
// 站点类型：Z-Blog 静态 HTML 音乐下载站，歌曲详情页内联播放源接口 songs.php?pos=XXX
// 逆向来源：全部来自浏览器实测（Playwright 捕获 + axios 复现），无网络搜索/盲猜
//
// 已知限制：
//  - 搜索为单页结果（站点搜索接口无分页），isEnd 恒为 true
//  - 部分歌曲仅提供网盘（迅雷）下载、无在线播放源，此类在 getMediaSource 抛友好错误
//  - 歌词取自详情页 meta description（纯文本，无逐行时间戳）
//  - 播放直链为 kuwo CDN，可能带时效，故 cacheControl 设为 no-store

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

// 解析搜索结果 / 首页列表里的 .sound-item（正则解析，避免 cheerio 依赖）
function parseItems(html) {
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
      duration: parseDuration(durM ? durM[1] : ''),
      _id: id,
    });
  }
  return list;
}

module.exports = {
  platform: '我要下歌',
  version: '0.0.2',
  author: 'tianpeng',
  srcUrl: 'https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js',
  description: '我要下歌(xiage.yiwuku.com) 音乐插件：搜索、在线播放、歌词、歌单/排行榜',
  cacheControl: 'no-store',
  supportedSearchType: ['music'],

  // ===== 歌单 / 排行榜（首页"最新歌曲"目录，支持分页）=====
  // 说明：该站为 Z-Blog 静态下载站，无独立榜单接口；以首页"最新歌曲"目录作为
  // 可浏览的歌单/排行榜集合，分页地址为 /page_N.html。
  async getTopLists() {
    return [
      {
        id: 'latest',
        title: '最新歌曲',
        coverImg: '',
        _type: 'playlist',
        _url: BASE + '/',
      },
    ];
  },

  async getTopListDetail(topListItem, page = 1) {
    const url = page <= 1 ? topListItem._url : `${BASE}/page_${page}.html`;
    const resp = await req(url);
    const data = parseItems(resp.data);
    const hasNext = /class="next"/.test(resp.data);
    return {
      isEnd: data.length === 0 || !hasNext,
      data,
    };
  },

  // ===== 搜索（单页，无分页）=====
  async search(query, page, type) {
    if (type && type !== 'music') return { isEnd: true, data: [] };
    const resp = await req(`${BASE}/search.php?q=${encodeURIComponent(query)}`);
    const data = parseItems(resp.data);
    return { isEnd: true, data };
  },

  // ===== 获取播放直链 =====
  async getMediaSource(musicItem) {
    const id = musicItem.id || musicItem._id;
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
    const id = musicItem.id || musicItem._id;
    const html = await getDetail(id);
    const m = html.match(/<meta name="description" content="([^"]*)"/);
    let raw = m ? m[1] : '';
    // 去掉开头的"（网友热搜xxx）"提示语
    raw = raw.replace(/^（[^）]*）/, '').trim();
    return { rawLrc: raw, translation: '' };
  },

  // 歌单/排行榜已通过 getTopLists / getTopListDetail 实现（首页最新歌曲目录），
  // 与搜索、播放、歌词共同构成插件能力。
};
