// 音乐搜索神器 v0.0.1 · 发布于 2026-09-23（MusicFree 音源插件发布版）
// 音乐搜索神器（music.lmb520.cn）音源插件
// 平台：音乐搜索神器  author：tianpeng  version：0.0.1
//
// 后端：music.lmb520.cn（基于 maicong/music 多平台聚合，同域 POST 根路径）
// 接口契约（实调确认）：
//   搜索  POST /  body: input=关键词&filter=name&type=<平台>&page=1
//   取链  POST /  body: input=<songid>&filter=id&type=<平台>&page=1
//   返回  { code:200, data:[ {type,link,songid,title,author,lrc,url,pic} ] }  （data 为数组；404 时 data=""）
//   平台 type 取值（与站点 music_type 选项一致）：
//     netease / qq / kugou / kuwo / baidu / 1ting / migu / lizhi / qingting / ximalaya / 5singyc / 5singfc / kg
//   说明：部分平台（qq/kugou/1ting/migu/ximalaya/kg）可能需 Cookie 或上游临时不可用返回空，插件忽略失败平台、合并可用结果。
(function () {
  var reqFn = (typeof __musicfree_require !== 'undefined') ? __musicfree_require : require;
  var axios = reqFn('axios');

  var BASE = 'https://music.lmb520.cn/';
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // 平台顺序即优先级（netease 优先，跨平台去重时保留前者）
  var PLATFORMS = ['netease', 'qq', 'kugou', 'kuwo', 'baidu', '1ting', 'migu', 'lizhi', 'qingting', 'ximalaya', '5singyc', '5singfc', 'kg'];

  function buildQuery(obj) {
    return Object.keys(obj).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]);
    }).join('&');
  }
  function toObj(d) {
    if (typeof d === 'string') { try { return JSON.parse(d); } catch (e) { return {}; } }
    return d || {};
  }

  // 表单编码：优先 URLSearchParams（axios 原生序列化并自动带 Content-Type，最稳），
  // 极端环境无 URLSearchParams 时回退手写编码串，保证桌面/移动端一致可发。
  function formData(body) {
    if (typeof URLSearchParams !== 'undefined') {
      var sp = new URLSearchParams();
      Object.keys(body).forEach(function (k) { sp.append(k, body[k]); });
      return sp;
    }
    return buildQuery(body);
  }
  function req(body) {
    return axios.post(BASE, formData(body), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
        'Referer': BASE,
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: 10000,
      validateStatus: function () { return true; },
    });
  }

  function normalize(it, plat) {
    var sid = String(it.songid != null ? it.songid : it.id);
    return {
      // 平台编入 id，供取链/歌词回查（MusicFree 会自动注入 platform 字段，插件不可自写）
      id: plat + ':' + sid,
      title: it.title || '未知',
      artist: it.author || '未知',
      album: '',
      artwork: it.pic || '',
      duration: undefined,
    };
  }

  function parseId(id) {
    var parts = String(id).split(':');
    var plat = parts.shift();
    return { plat: plat, sid: parts.join(':') };
  }

  function mediaHeaders(plat) {
    return {
      'User-Agent': UA,
      'Referer': 'https://music.lmb520.cn/',
      'Accept': '*/*',
    };
  }

  // ---------- 搜索：跨平台并发，合并去重 ----------
  async function search(query, page, type) {
    if (type && type !== 'music') return { isEnd: true, data: [] };
    var p = Math.max(1, page || 1);
    var tasks = PLATFORMS.map(function (plat) {
      return req({ input: query, filter: 'name', type: plat, page: p }).then(function (r) {
        var d = toObj(r.data);
        if (d.code !== 200 || !Array.isArray(d.data)) return [];
        return d.data.map(function (it) { return normalize(it, plat); });
      }).catch(function () { return []; });
    });
    var lists = await Promise.all(tasks);
    var merged = [];
    var seen = {};
    lists.forEach(function (arr) {
      arr.forEach(function (it) {
        var key = (it.title || '') + '|' + (it.artist || '');
        if (!seen[key]) { seen[key] = 1; merged.push(it); }
      });
    });
    var pageSize = 30;
    var start = (p - 1) * pageSize;
    var pageData = merged.slice(start, start + pageSize);
    return { isEnd: merged.length <= start + pageSize, data: pageData };
  }

  // ---------- 取链：按 id 回查 filter=id ----------
  async function getMediaSource(musicItem, quality) {
    var info = parseId(musicItem.id);
    var r = await req({ input: info.sid, filter: 'id', type: info.plat, page: 1 });
    var d = toObj(r.data);
    var it = (Array.isArray(d.data) && d.data[0]) || {};
    if (!it.url) throw new Error('无法获取播放链接：该音源可能需登录或已失效');
    return { url: it.url, headers: mediaHeaders(info.plat) };
  }

  // ---------- 歌词 ----------
  async function getLyric(musicItem) {
    var info = parseId(musicItem.id);
    try {
      var r = await req({ input: info.sid, filter: 'id', type: info.plat, page: 1 });
      var d = toObj(r.data);
      var it = (Array.isArray(d.data) && d.data[0]) || {};
      return { rawLrc: it.lrc || '[00:00.00] 暂无歌词' };
    } catch (e) {
      return { rawLrc: '[00:00.00] 暂无歌词' };
    }
  }

  // ---------- 歌曲信息（封面） ----------
  async function getMusicInfo(musicItem) {
    return { artwork: musicItem.artwork };
  }

  module.exports = {
    platform: '音乐搜索神器',
    version: '0.0.1',
    author: 'tianpeng',
    description: '音乐搜索神器（music.lmb520.cn）多平台聚合音源：网易云/QQ/酷狗/酷我/百度/一听/咪咕/荔枝/蜻蜓/喜马拉雅/5sing，免登录搜索、取链、歌词。',
    srcUrl: 'https://raw.githubusercontent.com/buaiwanyouxi/musicfree-all/main/musicfree-sq/github/sq.js',
    cacheControl: 'no-cache',
    supportedSearchType: ['music'],
    search: search,
    getMediaSource: getMediaSource,
    getLyric: getLyric,
    getMusicInfo: getMusicInfo,
  };
})();
