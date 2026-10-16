// 百度网盘音乐 音源插件（baidu.js）
// 核心思路：
//   1) 通过百度网盘开放平台 / 个人 API（pan.baidu.com/rest/2.0/xpan/file）列出目标文件夹下的文件；
//   2) 将该目录下的【每个子文件夹】映射为一个“歌单”，【每个音频文件】映射为一首“歌曲”；
//   3) 播放时通过 method=download（携带 fsid + path）获取下载直链，服务端 302 跳转到
//      *.baidupcs.com 的自签名直链，该直链自带 sign/pkey/expires，无需 Cookie/Referer 即可取流。
//
// 鉴权（三选一，按优先级）：
//   - cookie   ：浏览器复制的【完整 Cookie】（含 BDUSS 即可，建议含 STOKEN），最稳妥，推荐；
//   - bduss    ：仅填 BDUSS 值（部分账号取直链还需 STOKEN，建议直接填完整 Cookie）；
//   - access_token ：百度网盘开放平台 OAuth 令牌（个人网盘一般用 Cookie/BDUSS 即可）。
//
// 配置项 userVariables（在 MusicFree 安装插件后填写）：
//   cookie / bduss / stoken / access_token / root（要扫描的根目录，默认 /）。
//
// 注意：method=download 返回的 302 直链自带 sign/pkey，约 8 小时有效；插件默认缓存 1 小时。
//       该直链为自签名 URL，播放器可直接直连取流，无需额外携带 Cookie/Referer。
(function () {
  var axios = (typeof __musicfree_require !== 'undefined' && __musicfree_require)
    ? __musicfree_require('axios')
    : (typeof require !== 'undefined' ? require('axios') : null);

  var PLATFORM = 'TP百度网盘';
  var VERSION = '0.1.11';

  var BASE = 'https://pan.baidu.com/rest/2.0/xpan/file';
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

  // 支持的音频扩展名（映射为“歌曲”）
  var AUDIO_EXT = ['mp3', 'flac', 'wav', 'm4a', 'ape', 'ogg', 'aac', 'wma', 'opus', 'dsf', 'dff', 'tta', 'ac3', 'mp2', 'mid', 'midi', 'wv', 'tak', 'aiff', 'caf'];

  var SONG_PAGE = 100;   // 单个歌单内曲目每页
  var SHEET_PAGE = 30;   // 歌单（子文件夹）列表每页

  // 缓存：目录列表（5 分钟）+ 下载直链（1 小时，dlink sign 约 8h 有效）
  var _dirCache = {};
  var _dirCacheTTL = 5 * 60 * 1000;
  var _dlinkCache = {};
  var _dlinkCacheTTL = 60 * 60 * 1000;
  var _musicById = {};   // id -> { fs_id, path } 兜底，防止 MusicFree 透传对象时被裁剪

  // ---------- 用户变量 ----------
  function getVars() {
    try {
      if (typeof env !== 'undefined' && env && typeof env.getUserVariables === 'function') {
        return env.getUserVariables() || {};
      }
    } catch (e) {}
    return {};
  }
  function getRoot() {
    var v = getVars();
    return (v.root && String(v.root).trim()) || '/';
  }
  function buildCookie(v) {
    if (v.cookie) return v.cookie;
    if (v.bduss) return 'BDUSS=' + v.bduss + (v.stoken ? '; STOKEN=' + v.stoken : '');
    return '';
  }

  // ---------- 工具 ----------
  function toObj(d) {
    if (typeof d === 'string') { try { return JSON.parse(d); } catch (e) { return {}; } }
    return d || {};
  }
  function isAudio(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    if (!m) return false;
    return AUDIO_EXT.indexOf(m[1].toLowerCase()) >= 0;
  }
  function stripExt(name) {
    return (name || '').replace(/\.[a-z0-9]+$/i, '');
  }
  function errnoMsg(e) {
    var map = {
      '-6': 'Referer 缺失或请求被拒绝（xpan 接口必须带 Referer，请使用最新版插件）',
      '-9': '登录失效（BDUSS/STOKEN 无效，请重新获取 Cookie）',
      '-10': '未登录',
      '-20': '登录失效（请重新获取 Cookie）',
      '2': '参数错误',
      '101': '未授权（需开放平台 access_token 或有效 Cookie）',
      '112': '签名错误（Cookie/令牌可能失效）',
      '-1': '未知错误',
    };
    return map[String(e)] || ('错误码 ' + e);
  }

  // ---------- 百度网盘请求 ----------
  // 手工拼接查询串（不依赖 URLSearchParams，兼容移动端 JS 引擎；
  // 且避免移动端 axios 不序列化 config.params 导致请求丢失 method/参数而整列失败）
  function buildBaiduUrl(method, params) {
    var q = Object.assign({ method: method }, params || {});
    var parts = [];
    for (var k in q) {
      if (Object.prototype.hasOwnProperty.call(q, k)) {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(q[k]));
      }
    }
    return BASE + '?' + parts.join('&');
  }

  async function baiduReq(method, params) {
    var v = getVars();
    if (!v || (!v.cookie && !v.bduss && !v.access_token)) {
      throw new Error('未配置百度网盘鉴权：请在插件用户变量中填写 cookie（完整 Cookie，含 BDUSS）或 bduss；' +
        '插件用户变量不跨设备同步，桌面端与移动端需分别填写。');
    }
    var p = Object.assign({}, params || {});
    if (v.access_token) p.access_token = v.access_token;
    var cookie = buildCookie(v);
    // 必须携带 Referer：百度网盘 xpan/file 接口（list / download）要求 Referer=https://pan.baidu.com/，
    // 缺失会直接返回 errno=-6（这是上一轮误删 Referer 导致桌面/移动端同时报 -6 的根因）。
    var headers = { 'User-Agent': UA, Referer: 'https://pan.baidu.com/' };
    if (cookie) headers['Cookie'] = cookie;
    var url = buildBaiduUrl(method, p);
    var r;
    try {
      r = await axios.get(url, {
        headers: headers,
        timeout: 15000,
        validateStatus: function () { return true; },
      });
    } catch (netErr) {
      throw new Error('百度网盘网络请求失败：' + (netErr && netErr.message ? netErr.message : String(netErr)) +
        '（请确认移动端网络可访问 pan.baidu.com，且已将本插件更新到最新版）');
    }
    var body = toObj(r.data);
    var errno = Number(body.errno);
    if (errno !== 0) {
      throw new Error('百度网盘接口错误 errno=' + errno + '（' + errnoMsg(errno) + '）；' +
        '若为 -6 多为 Referer 缺失（请使用最新版插件）；若为 -9/-10/-20 多为 Cookie 未配置或已失效，请在移动端插件用户变量中重新填写 Cookie/BDUSS。');
    }
    return body;
  }

  // 列出某目录下的全部文件（自动翻页；缓存 5 分钟）
  async function listDir(dir) {
    var cached = _dirCache[dir];
    if (cached && (Date.now() - cached.at) < _dirCacheTTL) return cached.items;
    var items = [];
    var page = 1;
    while (page <= 20) {
      var res = await baiduReq('list', {
        dir: dir, page: page, num: 1000, limit: 1000,
        order: 'name', desc: 0, showempty: 0, web: 1,
      });
      var list = res.list || [];
      items = items.concat(list);
      if (!res.has_more || list.length < 1000) break;
      page++;
    }
    _dirCache[dir] = { at: Date.now(), items: items };
    return items;
  }

  // 获取文件下载直链（缓存 1 小时）
  // 注意：filemetas 返回的 dlink（d.pcs.baidu.com）在个人网盘账号下常被服务端以 31362 sign error 拒绝，
  // 正确做法是走 method=download（携带 fsid + path），由服务端 302 跳转到自签名的 *.baidupcs.com 直链，
  // 该直链自带 sign/pkey/expires，无需 Cookie/Referer 即可取流，播放器可直接直连。
  async function baiduDownloadUrl(fsId, path) {
    var cacheKey = fsId + '|' + path;
    var cached = _dlinkCache[cacheKey];
    if (cached && (Date.now() - cached.at) < _dlinkCacheTTL) return cached.url;
    var v = getVars();
    var p = { fsid: fsId, path: path, clienttype: 0, app_id: 250528, web: 1 };
    if (v.access_token) p.access_token = v.access_token;
    var cookie = buildCookie(v);
    // 必须携带 Referer：xpan/file 的 method=download 缺失 Referer 会返回 errno=-6
    var headers = { 'User-Agent': UA, Referer: 'https://pan.baidu.com/' };
    if (cookie) headers['Cookie'] = cookie;
    var r;
    try {
      r = await axios.get(buildBaiduUrl('download', p), {
        headers: headers,
        timeout: 15000,
        maxRedirects: 0,            // 不跟随，手动捕获 302 Location
        validateStatus: function () { return true; },
      });
    } catch (netErr) {
      throw new Error('百度网盘下载请求失败：' + (netErr && netErr.message ? netErr.message : String(netErr)) +
        '（请确认移动端网络可访问 pan.baidu.com，且已将本插件更新到最新版）');
    }
    if (r.status === 301 || r.status === 302) {
      var loc = (r.headers && (r.headers.location || r.headers.Location)) || '';
      if (loc) {
        loc = loc.replace(/^http:\/\//i, 'https://');
        _dlinkCache[cacheKey] = { at: Date.now(), url: loc };
        return loc;
      }
    }
    // 移动端 axios 可能自动跟随 302：尝试从最终响应地址取 baidupcs.com 直链
    var finalUrl = (r.request && r.request.res && r.request.res.responseUrl)
      || (r.request && r.request.responseURL) || '';
    if (finalUrl && /baidupcs\.com/.test(finalUrl)) {
      finalUrl = finalUrl.replace(/^http:\/\//i, 'https://');
      _dlinkCache[cacheKey] = { at: Date.now(), url: finalUrl };
      return finalUrl;
    }
    var body = toObj(r.data);
    if (body && body.error_code) {
      throw new Error('百度网盘下载接口错误 error_code=' + body.error_code + '（' + (body.error_msg || '') + '）');
    }
    throw new Error('百度网盘未返回可用的下载直链（HTTP ' + r.status + '）');
  }

  // ---------- 映射 ----------
  function toMusic(item) {
    var name = item.server_filename || item.filename || '';
    var id = String(item.fs_id);
    _musicById[id] = { fs_id: item.fs_id, path: item.path };
    return {
      id: id,
      fs_id: item.fs_id,
      path: item.path,
      title: stripExt(name) || name,
      artist: '',      // 网盘无歌手元数据，留空
      album: '',
      artwork: '',
      duration: undefined,
    };
  }
  function toSheet(item) {
    var name = item.server_filename || item.filename || '';
    return {
      id: item.path,    // 文件夹路径唯一
      path: item.path,
      title: name || item.path,
      artwork: '',
      artist: '',
      description: '百度网盘文件夹',
    };
  }

  // 错误可见化：移动端列表/搜索失败时，返回一个带 ⚠️ 的歌单/歌曲，标题即真实错误原因，
  // 避免 MusicFree 吞掉异常只显示空白，方便用户直接看到「未登录 / 网络不通」等根因。
  function errSheet(msg) {
    return {
      id: '__baidu_err__', path: '', title: '⚠️ ' + msg,
      artwork: '', artist: '', description: '百度网盘插件错误（按提示排查）',
    };
  }
  function errSong(msg) {
    return {
      id: '__baidu_err__', fs_id: 0, path: '', title: '⚠️ ' + msg,
      artist: '', album: '', artwork: '',
    };
  }

  // ---------- MusicFree 插件方法 ----------
  async function getRecommendSheetTags() {
    // 单一根目录：以 pinned 标签呈现，点选后列出其子文件夹为歌单
    return {
      data: [],
      pinned: [{ id: getRoot(), title: '全部歌单' }],
    };
  }

  async function getRecommendSheetsByTag(tag, page) {
    try {
      var root = (tag && tag.id) ? tag.id : getRoot();
      var items = await listDir(root);
      var folders = items.filter(function (it) { return it.isdir === 1; });
      var start = (page - 1) * SHEET_PAGE;
      var slice = folders.slice(start, start + SHEET_PAGE).map(toSheet);
      return { isEnd: start + SHEET_PAGE >= folders.length, data: slice };
    } catch (e) {
      return { isEnd: true, data: [errSheet(e && e.message ? e.message : String(e))] };
    }
  }

  async function getMusicSheetInfo(sheet, page) {
    try {
      var items = await listDir(sheet.id);
      var songs = items.filter(function (it) {
        return it.isdir !== 1 && isAudio(it.server_filename || it.filename || '');
      });
      var start = (page - 1) * SONG_PAGE;
      var slice = songs.slice(start, start + SONG_PAGE).map(toMusic);
      return { isEnd: start + SONG_PAGE >= songs.length, musicList: slice, sheetItem: sheet };
    } catch (e) {
      return { isEnd: true, musicList: [errSong(e && e.message ? e.message : String(e))], sheetItem: sheet };
    }
  }

  async function search(query, page, type) {
    query = (query || '').trim();
    try {
      var root = getRoot();
      if (type === 'sheet') {
        // 在根目录子文件夹中按名称模糊匹配
        var items = await listDir(root);
        var q = query.toLowerCase();
        var folders = items.filter(function (it) {
          return it.isdir === 1 && (it.server_filename || it.filename || '').toLowerCase().indexOf(q) >= 0;
        });
        var start = (page - 1) * SHEET_PAGE;
        var slice = folders.slice(start, start + SHEET_PAGE).map(toSheet);
        return { isEnd: start + SHEET_PAGE >= folders.length, data: slice };
      }
      // type === 'music'：在根目录（含子目录，由网盘 search 处理）按文件名搜索音频
      var res = await baiduReq('search', { key: query, dir: root, page: page, num: 1000 });
      var list = (res.list || []).filter(function (it) {
        return it.isdir !== 1 && isAudio(it.server_filename || it.filename || '');
      });
      var music = list.map(toMusic);
      var hasMore = (res.has_more === true) || list.length >= 1000;
      return { isEnd: !hasMore, data: music };
    } catch (e) {
      return { isEnd: true, data: [errSong(e && e.message ? e.message : String(e))] };
    }
  }

  async function getMediaSource(musicItem, quality) {
    var fsId = musicItem.fs_id
      || (_musicById[musicItem.id] && _musicById[musicItem.id].fs_id);
    var path = musicItem.path
      || (_musicById[musicItem.id] && _musicById[musicItem.id].path);
    if (!fsId || !path) throw new Error('缺少 fs_id/path，无法获取下载直链（请重新加载歌单）');
    // method=download 302 跳转得到的 *.baidupcs.com 直链自带签名，无需 Cookie/Referer，播放器可直接直连
    var url = await baiduDownloadUrl(fsId, path);
    return { url: url, headers: { 'User-Agent': UA } };
  }

  async function getLyric(musicItem) {
    // 百度网盘不提供歌词；返回空（可后续扩展：在同级目录查找同名 .lrc 文件）
    return '';
  }

  // ---------- 导出 ----------
  var plugin = {
    platform: PLATFORM,
    version: VERSION,
    author: 'tianpeng',
    description: 'v0.1.11：百度网盘音源双端发布（GitHub + Gitee），作者 tianpeng；' +
      'TP百度网盘音源：将网盘指定目录下的【子文件夹】映射为歌单、【音频文件】映射为歌曲，' +
      '通过百度网盘 API 获取下载直链播放。需填写 Cookie/BDUSS 鉴权，并配置 root 根目录。' +
      'v0.1.5：实现 folder→歌单 / file→歌曲 映射、搜索（音乐/歌单）、取链与目录/直链缓存；' +
      '修复「能列歌单但无法播放」：取链改为 method=download（携带 fsid+path）获取 302 自签名直链（*.baidupcs.com），' +
      '该直链自带 sign/pkey/expires，无需 Cookie/Referer 即可取流，规避 filemetas dlink 在个人网盘下的 31362 sign error；' +
      'v0.1.5 较 v0.1.4 关键修正：恢复 xpan 接口必需的 Referer 头部（缺失返回 errno=-6，曾误删导致桌面/移动端报 -6 的回归），' +
      '并新增鉴权缺失/网络异常/加载失败的可读错误与错误可见化（移动端失败时以 ⚠️ 歌单/歌曲显示真实原因）。',
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@v0.1.11/musicfree-baidu/github/baidu.js',
    cacheControl: 'no-cache',
    supportedSearchType: ['music', 'sheet'],
    userVariables: [
      { key: 'cookie', name: 'Cookie（推荐，从浏览器复制完整 Cookie）', hint: '登录 pan.baidu.com 后，F12 开发者工具→应用→Cookie，复制【完整】字符串，至少包含 BDUSS（建议含 STOKEN）。取链走 method=download 的 302 自签名直链，无需额外 PCSF 字段。' },
      { key: 'bduss', name: 'BDUSS（仅填 BDUSS 时）', hint: '若不想填完整 Cookie，可只填 BDUSS 值；但部分账号取直链需 STOKEN，建议优先填完整 Cookie。' },
      { key: 'stoken', name: 'STOKEN（可选）', hint: '与 BDUSS 配合，部分账号取直链/下载需要。' },
      { key: 'access_token', name: 'OAuth access_token（可选）', hint: '若使用百度网盘开放平台 OAuth 授权，填此值；个人网盘一般用 Cookie/BDUSS 即可，可留空。' },
      { key: 'root', name: '根目录（可选）', hint: '要扫描的网盘根文件夹路径，例如 /音乐 或 /；留空默认 /。该目录下的每个子文件夹映射为一个歌单。' },
    ],
    hints: {
      getMediaSource: [
        '播放依赖 method=download 返回的 302 自签名直链（*.baidupcs.com），该直链自带 sign/pkey，无需 Cookie/Referer，播放器可直接直连取流。',
        '若提示登录失效/errno=-9/-20，请重新从浏览器获取最新 Cookie（STOKEN 可能已过期）。',
      ],
    },
    // 仅供测试 / 运维的内部诊断接口（不影响取链）
    _internal: {
      isAudio: isAudio,
      stripExt: stripExt,
      listDir: listDir,
      baiduDownloadUrl: baiduDownloadUrl,
      clearCache: function () { _dirCache = {}; _dlinkCache = {}; _musicById = {}; },
      cacheKeys: function () { return { dir: Object.keys(_dirCache), dlink: Object.keys(_dlinkCache) }; },
      getVars: getVars,
    },
    async search(query, page, type) { return await search(query, page, type); },
    getMediaSource: getMediaSource,
    getLyric: getLyric,
    getRecommendSheetTags: getRecommendSheetTags,
    getRecommendSheetsByTag: getRecommendSheetsByTag,
    getMusicSheetInfo: getMusicSheetInfo,
  };

  if (typeof module !== 'undefined' && module && module.exports) module.exports = plugin;
  if (typeof exports !== 'undefined') exports.default = plugin;
  return plugin;
})();
