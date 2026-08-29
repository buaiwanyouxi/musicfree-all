// QQ音乐（腾讯系）音源插件
// 平台：QQ音乐  author：tianpeng  version：0.0.1
//
// 接口契约（经运行时真实联网探测 + 研读 jsososo/QQMusicApi 开源实现得出，全部免签端点）：
//   搜索        GET  c.y.qq.com/soso/fcgi-bin/client_search_cp?aggr=1&cr=1&flag_qc=0&p=<page>&n=30&w=<kw>&format=json
//   歌词        GET  c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=<mid>&...&nobase64=0&callback=callback  (返回 base64 歌词，沙箱内用纯 JS 解码)
//   排行榜列表  GET  c.y.qq.com/v8/fcg-bin/fcg_myqq_toplist.fcg?format=json&json=1&uin=0
//   排行榜详情  GET  c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?type=1&topid=<id>&format=json&json=1&utf8=1&platform=yqq.json&new_format=1
//   歌单搜索    GET  c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?remoteplace=txt.yqq.playlist&page_no=<p-1>&num_per_page=30&query=<kw>  (JSONP)
//   歌单详情    GET  c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&utf8=1&disstid=<id>&...&format=json  (纯 JSON)
//   热门歌单    GET  c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg?...&sortId=5&categoryId=<id>&sin=<(p-1)*30>&ein=<p*30-1>  (JSONP)
//   歌单分类    GET  c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_tag_conf.fcg?format=json&inCharset=utf8&outCharset=utf-8
//   取链        GET  u.y.qq.com/cgi-bin/musicu.fcg?-=getplaysongvkey&...&data={vkey.GetVkeyServer.CgiGetVkey}  (免签，但 purl 需登录态 authst cookie，未登录返回空)
//
// 播放取链三层兜底（参考本仓库 wy.js / kugou_mvmp3.js / xiage.js）：
//   ① 官方 QQ CgiGetVkey（需登录 Cookie；免费曲返回完整链，VIP/试听曲官方不给链）
//   ② 首选备用：无名音乐网 mvmp3.com（自动过人机验证，独立跨源库）
//   ③ 次选备用：Tonzhon 网易云匹配（tonzhon.com 按歌名搜到网易云同名曲，纯 JS weapi 取链；不依赖 QQ 登录态，对 QQ 的 VIP/试听曲有效）
// 官方取链失败时不再直接抛错，而是依次尝试 ② ③，最大化“有歌可播”。
(function () {
  var reqFn = (typeof __musicfree_require !== 'undefined') ? __musicfree_require : require;
  var axios = reqFn('axios');
  // 移动端沙箱可能未注入 cheerio：改为「顶层 try/catch 懒失败」而非直接 reqFn('cheerio')。
  // 旧写法在模块加载期即抛错，导致整个插件在移动端加载失败、播放直接闪退（应用崩溃）。
  // mvmp3 解析处已做空值保护（!cheerio || !cheerio.load → 返回空列表），取不到 cheerio 时
  // 会安全转下一层兜底音源，不会中断插件加载。
  var cheerio = null;
  try { cheerio = reqFn('cheerio'); } catch (e) { cheerio = null; }

  // ---------- 端点 ----------
  var HOST = 'https://c.y.qq.com';
  var SEARCH_API = HOST + '/soso/fcgi-bin/client_search_cp';
  var LYRIC_API = HOST + '/lyric/fcgi-bin/fcg_query_lyric_new.fcg';
  var TOPLIST_API = HOST + '/v8/fcg-bin/fcg_myqq_toplist.fcg';
  var TOPLIST_DETAIL_API = HOST + '/v8/fcg-bin/fcg_v8_toplist_cp.fcg';
  var SHEET_SEARCH_API = HOST + '/soso/fcgi-bin/client_music_search_songlist';
  var SHEET_DETAIL_API = HOST + '/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg';
  var HOT_SHEET_API = HOST + '/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg';
  var SHEET_TAG_API = HOST + '/splcloud/fcgi-bin/fcg_get_diss_tag_conf.fcg';
  var VKEY_API = 'https://u.y.qq.com/cgi-bin/musicu.fcg?-=getplaysongvkey&g_tk=5381&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0';

  var CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  var REFERER = 'https://y.qq.com/';

  // ---------- 工具 ----------
  function toObj(d) {
    if (typeof d === 'string') { try { return JSON.parse(d); } catch (e) { return {}; } }
    return d || {};
  }
  // 去除 JSONP 包裹（callback({...}) / MusicJsonCallback({...})）；纯 JSON 直返
  function stripJsonp(text) {
    if (typeof text !== 'string') return text;
    var t = text.trim();
    var m = t.match(/^[^(]*\(([\s\S]*)\);?\s*$/);
    if (m) { try { return JSON.parse(m[1]); } catch (e) { /* fallthrough */ } }
    try { return JSON.parse(t); } catch (e) { return text; }
  }
  function getCookie() {
    try { var v = (typeof env !== 'undefined' && env && env.getUserVariables && env.getUserVariables()); return (v && v.cookie) || ''; }
    catch (e) { return ''; }
  }
  function getUinFromCookie() {
    var ck = getCookie();
    if (!ck) return '0';
    var m = ck.match(/(?:^|;| )uin=o?(\d+)/) || ck.match(/(?:^|;| )wxuin=(\d+)/);
    return m ? m[1] : '0';
  }
  function getVars() {
    try { if (typeof env !== 'undefined' && env && typeof env.getUserVariables === 'function') return env.getUserVariables() || {}; } catch (e) {}
    return {};
  }
  function fixImg(u) {
    if (!u) return '';
    u = String(u).trim();
    if (u.indexOf('http') === 0) return u;
    if (u.indexOf('//') === 0) return 'https:' + u;
    if (u.indexOf('M000') === 0 || u.indexOf('T002') === 0) return 'https://y.gtimg.cn/music/photo_new/' + u;
    return 'https://y.gtimg.cn/' + u;
  }
  function joinArtists(singer) {
    if (!singer) return '';
    if (typeof singer === 'string') return singer;
    if (Array.isArray(singer)) return singer.map(function (s) { return (s && (s.name || s)) || ''; }).filter(Boolean).join('/');
    if (singer.name) return singer.name; // 对象形态（榜单详情常见）
    return '';
  }
  function defaultHeaders(extra) {
    var h = { 'Referer': REFERER, 'User-Agent': CHROME_UA, 'Accept': '*/*' };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }
  async function req(url, opts) {
    opts = opts || {};
    var config = {
      timeout: opts.timeout || 10000,
      headers: defaultHeaders(opts.headers),
      validateStatus: function () { return true; },
    };
    if (opts.params) config.params = opts.params;
    var r = await axios.get(url, config);
    var raw = r.data;
    if (typeof raw === 'string') raw = stripJsonp(raw);
    return raw;
  }

  // ---------- 纯 JS base64 解码（移动端无 Buffer） ----------
  var B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64ToBytes(input) {
    var str = String(input).replace(/\s+/g, '');
    var eq = (str.match(/=+$/) || [''])[0].length;
    str = str.replace(/=+$/, '');
    var bytes = [];
    for (var i = 0; i < str.length; i += 4) {
      var a = B64CHARS.indexOf(str.charAt(i));
      var b = B64CHARS.indexOf(str.charAt(i + 1));
      var c = (i + 2 < str.length) ? B64CHARS.indexOf(str.charAt(i + 2)) : 0;
      var d = (i + 3 < str.length) ? B64CHARS.indexOf(str.charAt(i + 3)) : 0;
      if (a < 0) a = 0; if (b < 0) b = 0;
      var n = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63);
      bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
    }
    for (var k = 0; k < eq; k++) bytes.pop();
    return bytes;
  }
  function utf8BytesToStr(bytes) {
    var s = '', i = 0;
    while (i < bytes.length) {
      var c = bytes[i++];
      if (c < 0x80) s += String.fromCharCode(c);
      else if (c >= 0xC0 && c < 0xE0) { var c2 = bytes[i++]; s += String.fromCharCode(((c & 0x1F) << 6) | (c2 & 0x3F)); }
      else if (c >= 0xE0 && c < 0xF0) { var c2 = bytes[i++], c3 = bytes[i++]; s += String.fromCharCode(((c & 0x0F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F)); }
      else s += String.fromCharCode(c);
    }
    return s;
  }
  function b64Decode(str) {
    try { return utf8BytesToStr(b64ToBytes(str)); } catch (e) { return String(str || ''); }
  }
  function looksBase64(s) {
    return typeof s === 'string' && s.length > 24 && /^[A-Za-z0-9+/=\r\n]+$/.test(s.replace(/\s/g, ''));
  }

  // 统一音乐条目映射（搜索/歌单详情/榜单详情 字段略有差异）
  function toTrack(it) {
    if (!it) return null;
    // 搜索：it = {songmid, songid, songname, singer:[{name}], albumname, interval}
    // 歌单详情：it = {songmid, songid, songname, singer:[{name}], albumname, albummid, interval, strMediaMid}
    // 榜单详情：it = {data:{songmid, songname, singer, albumname, albummid, interval, strMediaMid}}
    var src = it.data ? it.data : it;
    var mid = src.songmid || src.mid;
    var title = src.songname || src.title || src.name || '';
    var artist = joinArtists(src.singer);
    var album = src.albumname || src.album || '';
    var dur = src.interval;
    if (dur && dur < 1000) dur = dur * 1000;
    return {
      id: String(mid || src.songid || ''),
      title: title,
      artist: artist,
      album: album,
      artwork: '',
      duration: dur,
    };
  }

  // ---------- 搜索 ----------
  async function search(query, page, type) {
    if (type && type !== 'music') return { isEnd: true, data: [] };
    var r = await req(SEARCH_API, {
      params: { aggr: 1, cr: 1, flag_qc: 0, p: Math.max(1, page || 1), n: 30, w: query, format: 'json' },
    });
    var d = toObj(r);
    var list = (d.data && d.data.song && d.data.song.list) || [];
    var data = list.map(toTrack).filter(Boolean);
    return { isEnd: list.length < 30, data: data };
  }

  // ===================== 备用音源①：无名音乐网 mvmp3.com（自动过人机验证） =====================
  // 取链质量高；其“我不是人机”是软勾选框，插件【自动】GET/POST 过验证并缓存 50 分钟。
  // （本段移植自本仓库已验证的 wy.js / kugou_mvmp3.js）
  var MV_BASE = 'https://www.mvmp3.com';
  var MV_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  var MV_HEADERS = {
    'User-Agent': MV_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };
  var _mvCookie = null, _mvCookieAt = 0, _mvCookieUser = false;
  var MV_COOKIE_TTL = 50 * 60 * 1000; // 50 分钟（小于站点 1 小时有效期，留余量）
  function normCookie(raw) {
    raw = (raw || '').trim();
    if (!raw) return '';
    if (raw.indexOf('=') === -1) return 'PHPSESSID=' + raw;
    return raw;
  }
  async function autoVerify() {
    var r1 = await axios.get(MV_BASE + '/', { headers: MV_HEADERS, timeout: 9000 });
    var setCk = (r1.headers && r1.headers['set-cookie']) || [];
    var jar = {};
    setCk.forEach(function (c) {
      var i = c.indexOf('=');
      if (i > 0) jar[c.slice(0, i).trim()] = c.split(';')[0].split('=').slice(1).join('=').trim();
    });
    var ck = Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
    if (!ck) throw new Error('无名音乐网：无法建立会话');
    if (!mvIsVerify(r1.data)) return ck; // 已是已验证会话（极小概率）
    var m = (r1.data || '').match(/name="csrf_token" value="([^"]+)"/);
    var csrf = m ? m[1] : '';
    await axios.post(MV_BASE + '/', 'csrf_token=' + encodeURIComponent(csrf) + '&human_check=on', {
      headers: { ...MV_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', Referer: MV_BASE + '/', Cookie: ck },
      timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; },
    });
    return ck;
  }
  async function ensureMvCookie(forceAuto) {
    var now = Date.now();
    if (!forceAuto && _mvCookie && (now - _mvCookieAt) < MV_COOKIE_TTL) return _mvCookie;
    var userCk = normCookie(getVars().mvmp3_cookie);
    if (userCk && !forceAuto) { _mvCookie = userCk; _mvCookieAt = now; _mvCookieUser = true; return _mvCookie; }
    var fresh = await autoVerify();
    _mvCookie = fresh; _mvCookieAt = now; _mvCookieUser = false; return _mvCookie;
  }
  function mvIsVerify(html) { return /安全人机验证|我不是人机|verifyForm/.test(html || ''); }
  function mvParseItems(html) {
    if (!cheerio || !cheerio.load) return [];
    var $ = cheerio.load(html);
    var items = [], seen = {};
    $('.play_list li').each(function (i, el) {
      var a = $(el).find('a.url').first();
      if (!a.length) return;
      var href = a.attr('href') || '';
      var m = href.match(/\/mp3\/([a-f0-9]{32})\.html/i);
      if (!m) return;
      var id = m[1];
      if (seen[id]) return;
      seen[id] = 1;
      var ta = (a.text() || '').replace(/\s+/g, ' ').trim();
      var artist = '', title = ta;
      var idx = ta.indexOf(' - ');
      if (idx > 0) { artist = ta.substring(0, idx).trim(); title = ta.substring(idx + 3).trim(); }
      items.push({ id: id, title: title, artist: artist });
    });
    return items;
  }
  function norm(s) {
    return (s || '').toLowerCase().replace(/\s+/g, '').replace(/[()（）【】\[\]《》、，。,.]/g, '');
  }
  function mvRank(cands, musicItem) {
    var t = norm(musicItem.title), ar = norm(musicItem.artist);
    var scored = cands.map(function (c) {
      var ct = norm(c.title), ca = norm(c.artist), s = 0;
      if (t && (ct.indexOf(t) >= 0 || t.indexOf(ct) >= 0)) s += 2;
      if (ar && ca && (ca.indexOf(ar) >= 0 || ar.indexOf(ca) >= 0)) s += 1;
      return { c: c, s: s };
    }).filter(function (x) { return x.s > 0; });
    scored.sort(function (a, b) { return b.s - a.s; });
    return scored.map(function (x) { return x.c; });
  }
  async function mvPlayUrl(hash, cookie) {
    var r = await axios.post(MV_BASE + '/style/js/play.php', 'id=' + hash + '&type=dance', {
      headers: {
        'User-Agent': MV_UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': MV_BASE + '/mp3/' + hash + '.html', // 给 play.php 用，不是给音频 CDN 的
        'Cookie': cookie,
      },
      timeout: 9000, validateStatus: function () { return true; },
    });
    return r.data;
  }
  async function mvSearch(keyword, cookie) {
    var r = await axios.get(MV_BASE + '/so/' + encodeURIComponent(keyword || '') + '.html', {
      headers: { ...MV_HEADERS, 'Cookie': cookie },
      timeout: 9000, validateStatus: function () { return true; },
    });
    if (mvIsVerify(r.data)) throw new Error('无名音乐网自动过验证失败（可能已升级为需手动验证），将自动回退 Tonzhon');
    return mvParseItems(r.data);
  }
  async function mvGetMediaSource(musicItem) {
    var kw = (musicItem.title || '').trim() || (musicItem.artist || '').trim();
    if (!kw) throw new Error('歌曲标题为空，无法在无名音乐网检索');
    var cookie = await ensureMvCookie();
    var items;
    try {
      items = await mvSearch(kw, cookie);
    } catch (e) {
      if (_mvCookieUser && /验证/.test(e.message)) {
        _mvCookie = null; _mvCookieUser = false;
        cookie = await ensureMvCookie();
        items = await mvSearch(kw, cookie);
      } else throw e;
    }
    if (!items.length) throw new Error('无名音乐网未找到：' + kw);
    var ordered = mvRank(items, musicItem);
    if (!ordered.length) ordered = items;
    var lastErr = '';
    for (var i = 0; i < Math.min(ordered.length, 5); i++) {
      try {
        var d = await mvPlayUrl(ordered[i].id, cookie);
        if (d && d.url) return { url: d.url }; // 不带 Referer，否则 CDN 403
        lastErr = d && d.msg ? String(d.msg) : '空链接';
      } catch (e) { lastErr = e.message; }
    }
    throw new Error('无名音乐网可取链候选均已下架/不可播放（' + (lastErr || '无可用链接') + '）');
  }

  // ===================== 备用音源②：Tonzhon 网易云匹配（tonzhon.com 搜索 + 网易云 weapi 取链） =====================
  // 说明：QQ 官方对 VIP/试听曲取链受限；Tonzhon 对 QQ 搜索会回退网易云匹配同名曲，再用纯 JS weapi(AES-128-CBC)
  //       取链，不依赖 QQ 登录态，能有效覆盖 QQ 的 VIP/试听失效场景。weapi 实现为零外部依赖纯 JS（桌面/移动端通用），
  //       移植自本仓库已验证的 xiage.js。
  var TZ = 'https://tonzhon.com/api.php';
  var NETEASE_WEAPI = 'https://music.163.com/weapi/song/enhance/player/url/v1?csrf_token=';
  var TZ_UA = CHROME_UA;
  function tzPost(types, extra) {
    var data = Object.assign({ types: types }, extra || {});
    var keys = Object.keys(data), parts = [];
    for (var i = 0; i < keys.length; i++) parts.push(keys[i] + '=' + encodeURIComponent(data[keys[i]]));
    return axios
      .post(TZ, parts.join('&'), {
        headers: { 'User-Agent': TZ_UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://tonzhon.com/' },
        timeout: 15000,
      })
      .then(function (r) { return r.data; });
  }
  function flattenArtist(a) {
    if (!a) return '';
    if (typeof a === 'string') return a;
    if (Array.isArray(a)) {
      var out = [];
      for (var i = 0; i < a.length; i++) {
        var x = a[i];
        if (typeof x === 'string') out.push(x);
        else if (Array.isArray(x)) out.push(x.join('/'));
        else if (x && x.name) out.push(x.name);
      }
      return out.filter(Boolean).join('/');
    }
    return '';
  }
  // --- 网易云 weapi 纯 JS AES-128-CBC（零外部依赖，桌面/移动端沙箱通用）---
  var WEAPI_NONCE = '0CoJUm6Qyw8W8jud';
  var WEAPI_IV = '0102030405060708';
  var WEAPI_SEC_KEY = '0CoJUm6Qyw8W8jud'; // 固定外层 AES 密钥（第三方客户端通用做法）
  var WEAPI_ENC_SEC_KEY =
    'bf50d0bcf56833b06d8d1219496a452a1d860fd58a14c0aafba3e770104ca77dc6856cb310ed3309039e6865081be4ddc2df52663373b20b70ac25b4d0c6ca466daef6b50174e93536e2d580c49e70649ad1936584899e85722eb83ceddfb4f56c1172fca5e60592d0e6ee3e8e02be1fe6e53f285b0389162d8e6ddc553857cd'; // RSA(reversed(SEC_KEY)) 预计算常量
  var _SBOX = [0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
  var _RCON = [0x01000000,0x02000000,0x04000000,0x08000000,0x10000000,0x20000000,0x40000000,0x80000000,0x1b000000,0x36000000];
  function _subWord(w){return (_SBOX[(w>>>24)&0xff]<<24)|(_SBOX[(w>>>16)&0xff]<<16)|(_SBOX[(w>>>8)&0xff]<<8)|_SBOX[w&0xff];}
  function _rotWord(w){return ((w<<8)|(w>>>24))>>>0;}
  function _keyExp(key){var Nk=4,Nr=10;var w=new Array(44);for(var i=0;i<Nk;i++)w[i]=(key[4*i]<<24)|(key[4*i+1]<<16)|(key[4*i+2]<<8)|key[4*i+3];for(var i=Nk;i<44;i++){var t=w[i-1];if(i%Nk===0)t=_subWord(_rotWord(t))^_RCON[(i/Nk)-1];w[i]=(w[i-Nk]^t)>>>0;}return w;}
  function _gfMul(a,b){var p=0;for(var i=0;i<8;i++){if(b&1)p^=a;var hi=a&0x80;a=(a<<1)&0xff;if(hi)a^=0x1b;b>>=1;}return p&0xff;}
  function _encBlock(block,w){var Nr=10;var s=block.slice();var addRK=function(rnd){for(var c=0;c<4;c++){var word=w[rnd*4+c];s[c*4]^=(word>>>24)&0xff;s[c*4+1]^=(word>>>16)&0xff;s[c*4+2]^=(word>>>8)&0xff;s[c*4+3]^=word&0xff;}};addRK(0);for(var r=1;r<Nr;r++){for(var i=0;i<16;i++)s[i]=_SBOX[s[i]];var sh=s.slice();for(var row=1;row<4;row++)for(var c=0;c<4;c++)s[c*4+row]=sh[((c+row)%4)*4+row];for(var c=0;c<4;c++){var i=c*4;var a0=s[i],a1=s[i+1],a2=s[i+2],a3=s[i+3];s[i]=_gfMul(a0,2)^_gfMul(a1,3)^a2^a3;s[i+1]=a0^_gfMul(a1,2)^_gfMul(a2,3)^a3;s[i+2]=a0^a1^_gfMul(a2,2)^_gfMul(a3,3);s[i+3]=_gfMul(a0,3)^a1^a2^_gfMul(a3,2);}addRK(r);}for(var i=0;i<16;i++)s[i]=_SBOX[s[i]];var sh=s.slice();for(var row=1;row<4;row++)for(var c=0;c<4;c++)s[c*4+row]=sh[((c+row)%4)*4+row];addRK(Nr);return s;}
  function _utf8Bytes(str){var out=[];for(var i=0;i<str.length;i++){var c=str.charCodeAt(i);if(c<0x80)out.push(c);else if(c<0x800){out.push(0xc0|(c>>6),0x80|(c&0x3f));}else if(c<0xd800||c>=0xe000){out.push(0xe0|(c>>12),0x80|((c>>6)&0x3f),0x80|(c&0x3f));}else{i++;c=0x10000+(((c&0x3ff)<<10)|(str.charCodeAt(i)&0x3ff));out.push(0xf0|(c>>18),0x80|((c>>12)&0x3f),0x80|((c>>6)&0x3f),0x80|(c&0x3f));}}return out;}
  function _toB64(bytes){var CH='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';var s='';for(var i=0;i<bytes.length;i+=3){var b0=bytes[i],b1=i+1<bytes.length?bytes[i+1]:0,b2=i+2<bytes.length?bytes[i+2]:0;var n=(b0<<16)|(b1<<8)|b2;s+=CH[(n>>18)&0x3f]+CH[(n>>12)&0x3f]+(i+1<bytes.length?CH[(n>>6)&0x3f]:'=')+(i+2<bytes.length?CH[n&0x3f]:'=');}return s;}
  function _pkcs7(b,bs){var p=bs-(b.length%bs);var o=b.slice();for(var i=0;i<p;i++)o.push(p);return o;}
  function _aesCbc(text,keyStr){var kb=_utf8Bytes(keyStr),ivb=_utf8Bytes(WEAPI_IV);var pt=_pkcs7(_utf8Bytes(text),16);var w=_keyExp(kb);var out=[];var prev=ivb.slice();for(var b=0;b<pt.length;b+=16){var blk=pt.slice(b,b+16).map(function(x,i){return x^prev[i];});var e=_encBlock(blk,w);for(var i=0;i<16;i++)out.push(e[i]);prev=e;}return _toB64(out);}
  function weapiEncrypt(text) {
    var p1 = _aesCbc(text, WEAPI_NONCE);
    var p2 = _aesCbc(p1, WEAPI_SEC_KEY);
    return { params: p2, encSecKey: WEAPI_ENC_SEC_KEY };
  }
  // 直连网易云 weapi 取播放直链（返回 http(s) CDN；下架/变灰曲返回 null）
  function getNeteaseUrl(id) {
    try {
      var payload = JSON.stringify({ ids: '[' + id + ']', level: 'standard', encodeType: 'mp3', csrf_token: '' });
      var enc = weapiEncrypt(payload);
      var reqBody = 'params=' + encodeURIComponent(enc.params) + '&encSecKey=' + encodeURIComponent(enc.encSecKey);
      return axios
        .post(NETEASE_WEAPI, reqBody, {
          headers: { 'User-Agent': TZ_UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' },
          timeout: 10000,
        })
        .then(function (r) {
          var u = r.data && r.data.data && r.data.data[0] ? r.data.data[0].url : null;
          return u || null;
        })
        .catch(function (e) { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }
  function forceHttps(u) { return String(u).replace(/^http:\/\//i, 'https://'); }
  // 试听片段探测（移动端兼容版：不用 stream，仅读响应头）。30s@128kbps≈500KB，完整曲通常≥2MB，阈值取 1.2MB。
  // 无法判断时返回 false，绝不误伤完整曲、绝不阻塞播放。
  function looksLikePreview(url) {
    if (!url || typeof url !== 'string') return Promise.resolve(false);
    var u = forceHttps(url);
    return axios
      .get(u, {
        headers: { 'User-Agent': TZ_UA, Referer: 'https://y.qq.com/', Range: 'bytes=0-0' },
        timeout: 5000,
        validateStatus: function () { return true; },
      })
      .then(function (r) {
        var cr = r.headers && r.headers['content-range'];
        if (cr) {
          var m = /bytes\s+\d+-\d+\/(\d+)/i.exec(cr);
          if (m) { var total = parseInt(m[1], 10); return total > 0 && total < 1.2 * 1024 * 1024; }
        }
        var cl = r.headers && r.headers['content-length'] ? parseInt(r.headers['content-length'], 10) : 0;
        return cl > 0 && cl < 1.2 * 1024 * 1024;
      })
      .catch(function () { return false; });
  }
  // 按歌名+歌手匹配网易云并返回「首个完整」直链（遍历前若干候选，排除试听片段，返回首个完整链；全试听则退回最后一个非空）。
  async function getNeteaseUrlForQuery(name, artist) {
    if (!name) return null;
    var arr = await tzPost('search', { source: 'netease', name: name, pages: 1, count: 8 });
    var list = Array.isArray(arr) ? arr : [];
    if (!list.length) return null;
    var lastAny = null;
    for (var k = 0; k < list.length; k++) {
      var id = list[k] && list[k].id ? String(list[k].id) : null;
      if (!id) continue;
      var u = await getNeteaseUrl(id);
      if (!u) continue;
      lastAny = u; // 记录最近一个非空直链，供全试听时兜底
      var isPrev = await looksLikePreview(u);
      if (!isPrev) return u; // 完整命中
    }
    return lastAny; // 全是试听则退回最后一个非空（至少能播）
  }

  // ---------- 取链（三层兜底：官方 QQ → mvmp3 → Tonzhon 网易云匹配） ----------
  // 官方 QQ 取链（需登录态 authst cookie；免费曲返回完整链；VIP/试听曲官方不给链）
  async function qqOfficialGetUrl(mid) {
    var uin = getUinFromCookie();
    var filename = 'M500' + mid + mid + '.mp3'; // 高码率；C400 + .m4a 为普通码率
    var data = {
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: { filename: [filename], guid: '2796982635', songmid: [mid], songtype: [0], uin: uin, loginflag: 1, platform: '20' },
      },
      comm: { uin: Number(uin), format: 'json', ct: 19, cv: 0 },
    };
    var url = VKEY_API + '&loginUin=' + uin + '&data=' + encodeURIComponent(JSON.stringify(data));
    var j = await req(url, { timeout: 12000 });
    var sub = j && j.req_0 && j.req_0.data;
    if (!sub || (j.req_0.code && j.req_0.code !== 0)) {
      throw new Error('QQ 官方取链失败' + (j && j.req_0 && j.req_0.msg ? '：' + j.req_0.msg : ''));
    }
    var mi = sub.midurlinfo && sub.midurlinfo[0];
    var purl = mi && mi.purl;
    if (!purl) {
      throw new Error('QQ 官方：该歌曲需登录态（Cookie 含 authst）才能取链，未登录无法播放');
    }
    var sip = (sub.sip || []).filter(function (s) { return s && s.indexOf('http://ws') !== 0; });
    var domain = sip[0] || (sub.sip && sub.sip[0]) || '';
    return domain + purl;
  }
  async function getMediaSource(musicItem, quality) {
    var mid = String(musicItem.id || musicItem.songmid || '');
    var name = (musicItem.title || '') + (musicItem.artist ? '（' + musicItem.artist + '）' : '');
    var errs = [];
    // 1) 官方 QQ 取链（免费曲完整链；VIP/未登录则失败进入兜底）
    if (mid) {
      try {
        var official = await qqOfficialGetUrl(mid);
        if (official) return { url: official, headers: { Referer: REFERER, 'User-Agent': CHROME_UA, 'Accept': '*/*' } };
      } catch (e) { errs.push('QQ官方:' + e.message); }
    }
    // 2) 首选备用：无名音乐网 mvmp3（自动过人机验证）
    try {
      var mv = await mvGetMediaSource(musicItem);
      if (mv && mv.url) return { url: mv.url }; // 不带 Referer（否则 CDN 403）
    } catch (e) { errs.push('mvmp3:' + e.message); }
    // 3) 次选备用：Tonzhon 网易云匹配（tonzhon 搜索发现 + 网易云 weapi 取链）
    try {
      var tz = await getNeteaseUrlForQuery((musicItem.title || '').trim(), (musicItem.artist || '').trim());
      if (tz) return { url: forceHttps(tz) };
    } catch (e) { errs.push('Tonzhon:' + e.message); }
    throw new Error('《' + name + '》QQ官方取链失败，且备用音源（mvmp3 / Tonzhon）均未取得：' + (errs.join('；') || '未知原因') +
      '。若 mvmp3 提示“验证失败”多为临时升级，稍后重试即可；Tonzhon 对极冷门曲也可能无匹配。');
  }

  // ---------- 歌词 ----------
  async function getLyric(musicItem) {
    var mid = String(musicItem.id || musicItem.songmid || '');
    if (!mid) return { rawLrc: '', translation: undefined };
    var r = await req(LYRIC_API, {
      params: {
        songmid: mid, g_tk: 5381, loginUin: 0, hostUin: 0, format: 'jsonp',
        inCharset: 'utf8', outCharset: 'utf-8', notice: 0, platform: 'yqq.json',
        needNewCode: 0, nobase64: 0, musicid: 0, callback: 'callback',
      },
    });
    var d = toObj(r);
    var raw = d.lyric || '';
    var trans = d.trans || '';
    // nobase64=0 返回 base64；若后端直接返回纯文本则直接用
    var rawLrc = looksBase64(raw) ? b64Decode(raw) : (raw || '');
    var translation = trans ? (looksBase64(trans) ? b64Decode(trans) : trans) : undefined;
    return { rawLrc: rawLrc, translation: translation };
  }

  // ---------- 歌曲信息（封面等，无独立详情端点则透传） ----------
  async function getMusicInfo(musicItem) {
    return { artwork: musicItem.artwork };
  }

  // ---------- 排行榜 ----------
  async function getTopLists() {
    var r = await req(TOPLIST_API, { params: { format: 'json', json: 1, uin: 0 } });
    var d = toObj(r);
    var topList = (d.data && d.data.topList) || [];
    var data = topList.map(function (t) {
      return {
        id: String(t.id),
        title: t.topTitle || t.name || t.title || ('榜单' + t.id),
        description: t.description || t.intro || '',
        coverImg: fixImg(t.picUrl || t.pic),
        playCount: t.listenCount || t.listennum,
      };
    });
    return [{ title: 'QQ音乐排行榜', data: data }];
  }
  async function getTopListDetail(topListItem, page) {
    var r = await req(TOPLIST_DETAIL_API, {
      params: { type: 1, topid: topListItem.id, format: 'json', json: 1, utf8: 1, platform: 'yqq.json', new_format: 1 },
    });
    var d = toObj(r);
    var songlist = d.songlist || [];
    var musicList = songlist.map(toTrack).filter(Boolean);
    return { isEnd: true, musicList: musicList };
  }

  // ---------- 热门歌单（标签 + 按标签） ----------
  async function getRecommendSheetTags() {
    var r = await req(SHEET_TAG_API, { params: { format: 'json', inCharset: 'utf8', outCharset: 'utf-8' } });
    var d = toObj(r);
    var cats = (d.data && d.data.categories) || [];
    // 协议要求 data 为「分组数组」，每个分组 {title, data:[标签项]}（参考 wy.js / 官方协议文档）
    var data = cats.map(function (group) {
      var items = (group.items || []).map(function (it) {
        return { id: String(it.categoryId), title: it.categoryName };
      });
      return { title: group.categoryGroupName || group.name || '分类', data: items };
    }).filter(function (g) { return g.data.length > 0; });
    // pinned：固定在顶部的「全部」标签（QQ categoryId=10000000 表示全部热门歌单）
    var pinned = [{ id: '10000000', title: '全部' }];
    return { data: data, pinned: pinned };
  }
  async function getRecommendSheetsByTag(tag, page) {
    // 兼容协议：默认标签 id 可能为空串，落到「全部」(10000000)
    var cid = (tag && (tag.id !== undefined && tag.id !== null) && String(tag.id) !== '') ? tag.id : 10000000; // 10000000 = 全部
    var p = Math.max(1, page || 1);
    var sin = (p - 1) * 30, ein = p * 30 - 1;
    try {
      var r = await req(HOT_SHEET_API, {
        params: { inCharset: 'utf8', outCharset: 'utf-8', sortId: 5, categoryId: cid, sin: sin, ein: ein },
      });
      var d = toObj(r);
      var list = (d.data && d.data.list) || [];
      var data = list.map(function (it) {
        var creator = it.creator || {};
        var name = (typeof creator === 'string') ? creator : (creator.name || '');
        return {
          id: String(it.dissid),
          title: it.dissname || it.diss_name || '',
          artist: name,
          artwork: fixImg(it.imgurl),
          playCount: it.song_num,
          createUserId: name,
        };
      });
      return { isEnd: list.length < 30, data: data };
    } catch (e) {
      // 网络/解析异常时返回空列表，避免歌单广场因单点失败崩溃
      return { isEnd: true, data: [] };
    }
  }

  // ---------- 歌单导入 ----------
  function parsePlaylistId(s) {
    if (!s) return null;
    var str = String(s).trim();
    var m = str.match(/disstid=(\d+)/) ||
      str.match(/[?&]id=(\d+)/) ||
      str.match(/\/playlist\/(\d+)/) ||
      str.match(/^\s*(\d{6,})\s*$/);
    return m ? m[1] : null;
  }
  async function getPlaylistRaw(pid) {
    var r = await req(SHEET_DETAIL_API, {
      params: { type: 1, utf8: 1, disstid: pid, loginUin: 0, hostUin: 0, format: 'json', inCharset: 'utf8', outCharset: 'utf-8', notice: 0, platform: 'yqq.json', needNewCode: 0 },
    });
    var d = toObj(r);
    if (d.subcode && d.subcode !== 0) {
      throw new Error('QQ 歌单获取失败：' + (d.msg || ('subcode ' + d.subcode)) + '（歌单可能已设为私密或需登录）');
    }
    if (!d.cdlist || !d.cdlist[0]) throw new Error('QQ 歌单获取失败（接口未返回曲目，可能已设为私密）');
    return d;
  }
  async function importMusicSheet(urlLike) {
    var pid = parsePlaylistId(urlLike);
    if (!pid) throw new Error('无法识别的 QQ 歌单链接，请粘贴 QQ 音乐分享链接（含 disstid 或 /playlist/数字）或直接输入歌单 ID');
    var d = await getPlaylistRaw(pid);
    var cd = d.cdlist[0];
    var tracks = cd.songlist || [];
    var list = tracks.map(toTrack).filter(Boolean);
    if (!list.length) throw new Error('该 QQ 歌单暂无歌曲或需登录后才能访问');
    return list;
  }
  async function getMusicSheetInfo(sheetItem, page) {
    var pid = parsePlaylistId(sheetItem.id) || sheetItem.id;
    var d = await getPlaylistRaw(pid);
    var cd = d.cdlist[0];
    var tracks = cd.songlist || [];
    var musicList = tracks.map(toTrack).filter(Boolean);
    return {
      isEnd: true,
      musicList: musicList,
      sheetItem: {
        id: String(pid),
        title: cd.dissname || cd.name || sheetItem.title,
        artwork: fixImg(cd.logo || cd.pic_url || sheetItem.artwork),
        description: cd.desc || cd.description,
      },
    };
  }

  module.exports = {
    platform: 'QQ音乐',
  version: '0.0.2',
  author: 'tianpeng',
    description: 'QQ音乐（腾讯系）音源：搜索/歌词/排行榜/热门歌单/歌单导入。' +
      '浏览类功能（搜索、歌词、排行榜、热门歌单、歌单导入）均走免签旧版 cgi-bin 端点；' +
      '播放取链三层兜底：①官方QQ(CgiGetVkey，需登录Cookie解锁) → ②首选备用 无名音乐网mvmp3(自动过人机验证) → ③次选备用 Tonzhon网易云匹配(tonzhon.com搜索+weapi取链，覆盖QQ的VIP/试听失效曲)。',
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfreemusicfree-all@main/musicfree-qq/qq.js',
    cacheControl: 'no-cache',
    supportedSearchType: ['music'],
    userVariables: [
      {
        key: 'cookie',
        name: 'Cookie（可选）',
        hint: 'QQ 音乐登录后的会话 Cookie。填入后用于解锁「①官方QQ取链」（需含 authst / uin）；搜索、歌词、排行榜、热门歌单、歌单导入通常无需 Cookie。未填也能播——会自动走 mvmp3 / Tonzhon 备用音源。',
      },
      {
        key: 'mvmp3_cookie',
        name: 'mvmp3 Cookie（可选）',
        hint: '无名音乐网(mvmp3)的人机验证由插件自动完成，无需你手动操作；会话约 50 分钟自动刷新一次。若自动过验证偶发失败，可在此填 mvmp3 的 PHPSESSID（站点 https://www.mvmp3.com 登录/F12 取 Cookie）以跳过自动验证。',
      },
    ],
    hints: {
      importMusicSheet: [
        'QQ音乐APP：歌单-分享-复制链接；粘贴链接即可导入',
        '网页：复制歌单 URL（含 /playlist/数字 或 disstid=数字）粘贴，或直接输入纯数字歌单 ID',
        '导入时间和歌单大小有关，请耐心等待',
      ],
    },
    search: search,
    getMediaSource: getMediaSource,
    getMusicInfo: getMusicInfo,
    getLyric: getLyric,
    getTopLists: getTopLists,
    getTopListDetail: getTopListDetail,
    getRecommendSheetTags: getRecommendSheetTags,
    getRecommendSheetsByTag: getRecommendSheetsByTag,
    importMusicSheet: importMusicSheet,
    getMusicSheetInfo: getMusicSheetInfo,
  };
})();
