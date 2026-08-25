// 歌曲宝 (gequbao) MusicFree 插件
// 后端：歌曲宝 https://www.gequbao.com
//   （与「放屁音乐网」fangpi.net 同引擎、同接口，仅 BASE/PLATFORM 不同；本文件为歌曲宝版）
//
// 取链原理（已逆向验证）：
//   1) GET /music/{id} 页面，拿到两样东西：
//        a. Set-Cookie（会话 Cookie，取链必须携带）
//        b. window.appData.play_id —— 服务端下发的 Laravel 加密令牌（base64）
//   2) POST /member/common-play-url  { id: play_id }（携带步骤1的 Cookie + Referer）
//        → { code:1, data:{ url: <可播直链> } }
//   3) 直链为 Kuwo CDN（kw-er.kuwo.cn/.../*.mp3，audio/mpeg，支持 Range），实测可直接流式播放。
//
// 歌词：/music/{id} 页面内嵌 <div id="content-lrc">（以 <br> 分隔的 LRC），直接解析即可。
//
// 搜索/榜单：/s/{kw} 与 /hot-music、/top/week-search、/top/week-download、/hot-words
//           列表页结构一致，均解析 <a href="/music/{id}" title="{标题} - {歌手}">。
//
// 已知限制：
//   - 部分歌曲（mp3_type=1 或触发 should_verify）服务端要求人机验证/仅试听，
//     插件无法代解验证码，此类歌曲取链会失败或仅返回 30s 试听（best-effort 返回直链）。
//   - Kuwo CDN 直链为签名限时链接，有效期有限，但足以完成一次播放。
//
// 返回值结构严格遵循 MusicFree 插件协议：
//  - getTopLists       -> IMusicSheetGroupItem[] = [{ title, data: IMusicSheetItem[] }]
//  - getTopListDetail  -> { isEnd, musicList: IMusicItem[] }
//  - getMusicSheetInfo -> { isEnd, musicList: IMusicItem[] }
//  - search            -> { isEnd, data: IMusicItem[] }
//  - importMusicSheet  -> IMusicItem[]
//  - importMusicItem   -> IMusicItem
//  - getMediaSource    -> { url }
//  - getLyric          -> { rawLrc }

// ===== 跨加载器协议兼容（关键）=====
// MusicFree 存在两种插件加载协议：
//   (A) 新协议 CommonJS：沙箱注入 module/exports，期望 `module.exports = {...}`；
//   (B) 老协议 `return ${funcCode}`：把整段源码当表达式返回对象，且不注入 module/exports。
// 故整体包为 IIFE 表达式，既用 module.exports 兼容(A)，其返回值又兼容(B)。
(function () {
  // ---- 安全获取 require（兼容两种沙箱注入名）----
  var reqFn = (
    typeof __musicfree_require !== 'undefined' ? __musicfree_require :
    (typeof require !== 'undefined' ? require : null)
  );
  if (!reqFn) {
    throw new Error('[gequbao] 插件沙箱未提供 require，无法加载');
  }
  var axios = reqFn('axios');

  var PLATFORM = 'gequbao';
  var BASE = 'https://www.gequbao.com';
  var UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  function forceHttps(u) {
    return u ? String(u).replace(/^http:/i, 'https:') : u;
  }

  // 从响应头提取 Cookie（name=value 拼接），用于携带会话
  function extractCookie(res) {
    var sc = res && res.headers && res.headers['set-cookie'];
    if (!sc || !sc.length) return '';
    var parts = [];
    for (var i = 0; i < sc.length; i++) {
      var c = sc[i];
      var eq = c.indexOf('=');
      if (eq < 0) continue;
      var name = c.substring(0, eq);
      var semi = c.indexOf(';');
      var val = semi < 0 ? c.substring(eq + 1) : c.substring(eq + 1, semi);
      parts.push(name + '=' + val);
    }
    return parts.join('; ');
  }

  // 从 /music/{id} 页面解析 play_id（window.appData.play_id）
  function extractPlayId(html) {
    var m = html.match(/window\.appData\s*=\s*JSON\.parse\('([\s\S]*?)'\)/);
    if (!m) return null;
    try {
      var raw = m[1]
        .replace(/\\u0022/g, '"')
        .replace(/\\u0027/g, "'")
        .replace(/\\\\/g, '\\');
      var obj = JSON.parse(raw);
      return obj && obj.play_id ? obj.play_id : null;
    } catch (e) {
      return null;
    }
  }

  // 从列表页 HTML 解析歌曲条目（搜索页 / 榜单页通用）
  function parseItems(html) {
    var items = [];
    var seen = {};
    var re = /<a\s+[^>]*?href="\/music\/(\d+)"[^>]*?title="([^"]*)"/g;
    var m;
    while ((m = re.exec(html))) {
      var id = m[1];
      if (seen[id]) continue; // 同一首歌在卡片与“播放&下载”按钮各出现一次，按 id 去重
      seen[id] = 1;
      var ta = m[2] || '';
      var title = ta;
      var artist = '';
      var idx = ta.lastIndexOf(' - ');
      if (idx > 0) {
        title = ta.substring(0, idx).trim();
        artist = ta.substring(idx + 3).trim();
      }
      items.push({
        id: id,
        title: title,
        artist: artist,
        album: '',
        coverImg: '',
        platform: PLATFORM
      });
    }
    return items;
  }

  function getHtml(url, ref) {
    var headers = {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    };
    if (ref) headers['Referer'] = ref;
    return axios.get(url, {
      headers: headers,
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: function () { return true; }
    });
  }

  // ===== 取链核心 =====
  function getPlayUrl(musicId) {
    var pageUrl = BASE + '/music/' + musicId;
    return getHtml(pageUrl, null).then(function (r) {
      var cookie = extractCookie(r);
      var playId = extractPlayId(r.data);
      if (!playId) {
        return Promise.reject(new Error('无法解析播放令牌（页面结构可能已变更）'));
      }
      var body = 'id=' + encodeURIComponent(playId);
      return axios
        .post(BASE + '/member/common-play-url', body, {
          headers: {
            'User-Agent': UA,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': pageUrl,
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/javascript, */*',
            'Cookie': cookie
          },
          timeout: 15000,
          validateStatus: function () { return true; }
        })
        .then(function (r2) {
          var d = r2.data;
          if (d && d.code === 1 && d.data && d.data.url) {
            return forceHttps(d.data.url);
          }
          return Promise.reject(
            new Error('取链失败：' + (d && d.msg ? d.msg : JSON.stringify(d)))
          );
        });
    });
  }

  // ===== 歌词 =====
  function getLyricById(musicId) {
    return getHtml(BASE + '/music/' + musicId, null).then(function (r) {
      var html = r.data;
      var i = html.indexOf('id="content-lrc"');
      if (i < 0) return { rawLrc: '' };
      var start = html.indexOf('>', i) + 1;
      var end = html.indexOf('</div>', start);
      if (end < 0) end = html.length;
      var lrc = html.substring(start, end);
      lrc = lrc
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim();
      return { rawLrc: lrc };
    });
  }

  // ===== 榜单定义 =====
  var TOPLISTS = [
    { id: 'hot-music', title: '热歌榜' },
    { id: 'top/week-search', title: '每周搜索榜' },
    { id: 'top/week-download', title: '每周下载榜' },
    { id: 'hot-words', title: '热词榜' }
  ];

  function getTopLists() {
    var data = TOPLISTS.map(function (t) {
      return { id: t.id, title: t.title, platform: PLATFORM, coverImg: '' };
    });
    return Promise.resolve([{ title: '歌曲宝 · 榜单', data: data }]);
  }

  function fetchSheetItems(sheetId) {
    var url = BASE + '/' + sheetId;
    return getHtml(url, null).then(function (r) {
      return { isEnd: true, musicList: parseItems(r.data) };
    });
  }

  function search(keyword, page, type) {
    var url = BASE + '/s/' + encodeURIComponent(keyword || '');
    return getHtml(url, null).then(function (r) {
      // 该站点搜索为单页返回（?page= 实测不改变结果），直接返回全部并标记 isEnd
      return { isEnd: true, data: parseItems(r.data) };
    });
  }

  function importMusicItem(url) {
    var m = String(url || '').match(/\/music\/(\d+)/);
    if (!m) return Promise.reject(new Error('无法识别的歌曲链接'));
    var id = m[1];
    return getHtml(BASE + '/music/' + id, null).then(function (r) {
      var title = '';
      var artist = '';
      var am = r.data.match(/window\.appData\s*=\s*JSON\.parse\('([\s\S]*?)'\)/);
      if (am) {
        try {
          var raw = am[1]
            .replace(/\\u0022/g, '"')
            .replace(/\\u0027/g, "'")
            .replace(/\\\\/g, '\\');
          var obj = JSON.parse(raw);
          title = obj.mp3_title || '';
          artist = obj.mp3_author || '';
        } catch (e) {}
      }
      if (!title) {
        var items = parseItems(r.data);
        if (items.length) {
          title = items[0].title;
          artist = items[0].artist;
        }
      }
      return {
        id: id,
        title: title || '未知',
        artist: artist || '',
        album: '',
        coverImg: '',
        platform: PLATFORM
      };
    });
  }

  function importMusicSheet(url) {
    var u = String(url || '');
    if (u.indexOf('http') !== 0) {
      u = BASE + (u.charAt(0) === '/' ? u : '/' + u);
    }
    return getHtml(u, null).then(function (r) {
      return parseItems(r.data);
    });
  }

  // ===== 跨加载器导出 =====
  var plugin = {
    platform: PLATFORM,
    version: '1.0.0',
    appVersion: '0.6.0',
    defaultSearchType: 'music',
    srcUrl: BASE,
    getTopLists: getTopLists,
    getTopListDetail: function (sheetItem) {
      return fetchSheetItems(sheetItem.id);
    },
    getMusicSheetInfo: function (sheetItem) {
      return fetchSheetItems(sheetItem.id);
    },
    search: search,
    importMusicSheet: importMusicSheet,
    importMusicItem: importMusicItem,
    getMediaSource: function (musicItem) {
      return getPlayUrl(musicItem.id).then(function (u) {
        return { url: u };
      });
    },
    getLyric: function (musicItem) {
      return getLyricById(musicItem.id);
    }
  };

  if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = plugin;
  }
  if (typeof exports !== 'undefined') {
    exports.default = plugin;
  }
  return plugin;
})();
