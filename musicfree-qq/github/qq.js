// QQ音乐 v0.1.5 · 发布于 2026-09-23（MusicFree 音源插件发布版）
// QQ音乐（腾讯系）音源插件
// 平台：QQ音乐  author：tianpeng  version：0.1.5
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
// ============ 取链「竞速并发」而非「顺序」（v0.1.0 定型，v0.1.3 换源） ============
//   ① 官方 QQ CgiGetVkey 作为【优先快路径】（最多等 7s）；
//   ② AAX音乐网 aax.cx ／ ③ 无名音乐网 mvmp3 ／ ④ 无忧音乐网 qeecc.com 与官方【并发】启动，
//      串行 await 仅决定「采纳顺序」，总耗时为「单层 worst-case」而非「各层之和」，根治沙箱 10s 超时。
//   - 整段 9s AbortController 软上限：超时即中止在途请求，返回「已通过身份校验的最佳链」而非干等全失败。
//   - mvmp3 登录态 Cookie 在插件加载 / 搜索时【后台预热】并周期续期；aax.cx / qeecc.com 与 mvmp3 同源 CMS，
//     其人机验证由 siteAutoVerify 在首次取源时自动完成并缓存 50 分钟，播放时不再同步等人机验证。
//   - 备用源匹配升级为【歌名 + 作者 + 时长】多重身份校验（isGoodMatch），避免错播（aax 条目自带时长，可全量校验）。
//   - 移除昂贵的「试听片段嗅探」(looksLikePreview, 5s×N)，以身份校验替代安全网，显著降延迟。
// ============ v0.1.4：歌词三级兜底（修复「备用源播放时无歌词」） ============
//   缺陷根因：取链有四层兜底，歌词却只有 QQ 官方一条路 → 凡"靠备用源才播得出"的曲（跨源歌单/收藏、
//   外源 id、无 songmid）必然无歌词（实测跨源曲 100% 复现）。且官方无版权曲返回 retcode=-1901 空歌词时
//   原实现不报错、直接返回空串，进一步掩盖问题。
//   现改为三级链：①QQ 官方（songmid 形态校验 + lrcLooksValid 有效性校验，空/占位则下探）
//              → ②取链时顺带缓存的该源歌词（零额外请求，与【实际播放的音源】同源同轴）
//              → ③按【歌名+歌手】在 mvmp3 / aax 并发反查（复用 isGoodMatch 防张冠李戴，8s 软上限）。
//   配套：过滤站点占位歌词（aax 的「暂无歌词内容」）与水印行（mvmp3 的「无名音乐网 www.mvmp3.com」）。
//   附带修复一：非 QQ songmid 不再盲试官方取链（跨源曲取链 6893ms → ~2s）。
//   附带修复二：aax / qeecc 的会话也纳入后台预热（原仅预热 mvmp3），歌词冷路径由 2—7s 降至 2.2—3.6s。
(function () {
  var reqFn = (typeof __musicfree_require !== 'undefined') ? __musicfree_require : require;
  var axios = reqFn('axios');
  // 无名音乐网(mvmp3) 搜索结果解析采用「纯正则」实现，不依赖 cheerio —— 移动端沙箱不注入 cheerio，
  // 若用 cheerio.load 解析则移动端兜底音源完全失效（解析返回空 → 取链失败 → 非免费曲在歌单/排行榜连续
  // 播放时易触发崩溃）。纯正则解析在桌面端/移动端一致可用，故彻底移除 cheerio 依赖。

  // Promise.any 兜底（部分移动端 JS 引擎未内置）：首个 fulfilled 即胜，全 reject 则 reject 聚合错误
  if (typeof Promise.any !== 'function') {
    Promise.any = function (proms) {
      var ps = Array.prototype.slice.call(proms);
      if (!ps.length) return Promise.reject(new Error('empty'));
      return new Promise(function (resolve, reject) {
        var errs = [], done = 0;
        ps.forEach(function (p, i) {
          Promise.resolve(p).then(resolve, function (e) { errs[i] = e; if (++done === ps.length) reject(errs); });
        });
      });
    };
  }

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
    if (!u) return undefined; // 空串 → undefined：避免原生图片组件拿到空 URI 触发崩溃
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
    if (opts.signal) config.signal = opts.signal; // 透传 AbortController 信号，支持整段软上限中止
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

  // 由 albummid 合成真实封面 URL（与官方 maotoumao/MusicFreePlugins qq.js 一致：
  // https://y.gtimg.cn/music/photo_new/T002R300x300M000<albummid>.jpg）。无 albummid 时返回
  // undefined（绝不返回空串 ''）——空串 artwork 会被原生图片组件 / 锁屏 MediaSession 当成空 URI，
  // 在移动端引发「无日志、直接闪退」的原生层崩溃。这是前面 6 次修复（仅改 getMediaSource 取链逻辑）
  // 全部漏掉、且每次都复现的真正结构性根因。
  function toArtworkFromAlbumMid(albummid) {
    if (!albummid) return undefined;
    return 'https://y.gtimg.cn/music/photo_new/T002R300x300M000' + String(albummid) + '.jpg';
  }
  // 统一音乐条目映射（搜索/歌单详情/榜单详情 字段略有差异）
  function toTrack(it) {
    if (!it) return null;
    // 搜索：it = {songmid, songid, songname, singer:[{name}], albumname, albummid, interval}
    // 歌单详情：it = {songmid, songid, songname, singer:[{name}], albumname, albummid, interval, strMediaMid}
    // 榜单详情：it = {data:{songmid, songname, singer, albumname, albummid, interval, strMediaMid}}
    var src = it.data ? it.data : it;
    var mid = src.songmid || src.mid;
    var title = src.songname || src.title || src.name || '';
    var artist = joinArtists(src.singer);
    var album = src.albumname || src.album || '';
    var albummid = src.albummid || (src.album && src.album.mid) || '';
    var dur = src.interval;
    if (dur && dur < 1000) dur = dur * 1000;
    return {
      id: String(mid || src.songid || ''),
      songmid: String(mid || ''),
      title: title,
      artist: artist,
      album: album,
      albummid: albummid,                                          // 透传，供详情/原生层按需取封面
      artwork: toArtworkFromAlbumMid(albummid),                    // 有专辑则真实封面 URL，否则 undefined（绝不空串）
      duration: dur,
    };
  }

  // ---------- 搜索 ----------
  async function search(query, page, type) {
    if (type && type !== 'music') return { isEnd: true, data: [] };
    warmAllCookies(); // 搜索即预热三源会话（mvmp3/aax/qeecc）：用户点歌前通常先经过搜索，播放与取歌词时会话多半已热
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
  async function autoVerify(signal) {
    var r1 = await axios.get(MV_BASE + '/', { headers: MV_HEADERS, timeout: 9000, signal: signal, validateStatus: function () { return true; } });
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
      timeout: 9000, maxRedirects: 5, signal: signal, validateStatus: function () { return true; },
    });
    return ck;
  }
  async function ensureMvCookie(forceAuto, signal) {
    var now = Date.now();
    if (!forceAuto && _mvCookie && (now - _mvCookieAt) < MV_COOKIE_TTL) return _mvCookie;
    var userCk = normCookie(getVars().mvmp3_cookie);
    if (userCk && !forceAuto) { _mvCookie = userCk; _mvCookieAt = now; _mvCookieUser = true; return _mvCookie; }
    var fresh = await autoVerify(signal);
    _mvCookie = fresh; _mvCookieAt = now; _mvCookieUser = false; return _mvCookie;
  }
  function mvIsVerify(html) { return /安全人机验证|我不是人机|verifyForm/.test(html || ''); }
  // 纯正则解析：每条结果形如 <a href="/mp3/<32hex>.html" ... alt="【歌手 - 歌名】">...
  // 不依赖 cheerio，移动端沙箱缺 cheerio 时也能正常解析（这是移动端首选备用音源可用的关键）。
  // mvmp3 返回格式为【歌手 - 歌名】：以 ' - ' 分隔，前为歌手、后为歌名（与 aax.cx 同构，与 qeecc.com 的《》约定不同）。
  function mvParseItems(html) {
    if (!html || typeof html !== 'string') return [];
    var items = [], seen = {};
    var re = /<a\s+href="\/mp3\/([a-f0-9]{32})\.html"[^>]*>[\s\S]*?alt="([^"]*)"/gi;
    var m;
    while ((m = re.exec(html))) {
      var id = m[1], raw = m[2] || '';
      if (seen[id]) continue;
      seen[id] = 1;
      var title = raw, artist = '';
      var idx = raw.indexOf(' - ');
      if (idx > 0) { artist = raw.substring(0, idx).trim(); title = raw.substring(idx + 3).trim(); }
      // 清洗首尾【】/[]（mvmp3 常包裹为【歌手 - 歌名】），确保歌手/歌名干净
      artist = artist.replace(/^[【\[]+|[】\]]+$/g, '').trim();
      title = title.replace(/^[【\[]+|[】\]]+$/g, '').trim();
      if (!title) continue;
      items.push({ id: id, title: title, artist: artist });
    }
    return items;
  }
  function norm(s) {
    return (s || '').toLowerCase().replace(/\s+/g, '').replace(/[()（）【】\[\]《》、，。,.]/g, '');
  }
  // 备用音源检索关键词归一化（【备用音源检索优化】）：
  // 官方 QQ 无版权 / 取链失败时回退到 aax / mvmp3 / qeecc 三备用源；这些站点多以「纯净歌名」建索引，
  // 而 QQ 返回的歌名常带括号注解（如「阴天（Live）」「晴天（Remix）」「晚安（和声版）」），
  // 直查会因注解噪声而漏检。故回退检索前剥离歌名中括号内容（（）/()/【】/[]），仅保留主体歌名，作者保持不变。
  // 仅作用于「备用音源检索关键词」，不影响官方 QQ 检索、in-app 搜索框与歌词反查（后者有独立用途，不在此优化内）。
  function stripBracketed(s) {
    return (s || '')
      .replace(/[（(【\[][^）)\]】]*[）)\]】]/g, '')   // 去掉括号及其中注解内容
      .replace(/\s+/g, ' ')
      .trim();
  }
  function backupQueryTitle(musicItem) {
    var t = stripBracketed(musicItem.title);
    return t || (musicItem.artist || '').trim();
  }
  // 时长一致性校验：两端都有时长且单位化为秒后，容差 3s 即视为同一曲
  function durMatch(a, b, tol) {
    if (!a || !b) return true; // 任一侧缺失 → 不据此否决
    var sa = a >= 1000 ? a / 1000 : a;
    var sb = b >= 1000 ? b / 1000 : b;
    return Math.abs(sa - sb) <= (tol || 3);
  }
  // 【v0.1.0 多重身份校验】歌名 + 作者 + 时长（时长可选），三者通过才算同一首，避免错播
  function isGoodMatch(cand, musicItem) {
    var t = norm(musicItem.title), ar = norm(musicItem.artist);
    var ct = norm(cand.title), ca = norm(cand.artist);
    if (!t || !ct) return false;
    if (ct.indexOf(t) < 0 && t.indexOf(ct) < 0) return false;           // 歌名必须互含
    if (ar && ca && ca.indexOf(ar) < 0 && ar.indexOf(ca) < 0) return false; // 作者必须互含（若有）
    return durMatch(musicItem.duration, cand.duration, 3);               // 时长一致（可选）
  }
  function matchScore(c, musicItem) {
    var t = norm(musicItem.title), ar = norm(musicItem.artist);
    var ct = norm(c.title), ca = norm(c.artist), s = 0;
    if (t && (ct.indexOf(t) >= 0 || t.indexOf(ct) >= 0)) s += 2;
    if (ar && ca && (ca.indexOf(ar) >= 0 || ar.indexOf(ca) >= 0)) s += 1;
    return s;
  }
  async function mvPlayUrl(hash, cookie, signal) {
    var r = await axios.post(MV_BASE + '/style/js/play.php', 'id=' + hash + '&type=dance', {
      headers: {
        'User-Agent': MV_UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': MV_BASE + '/mp3/' + hash + '.html', // 给 play.php 用，不是给音频 CDN 的
        'Cookie': cookie,
      },
      timeout: 9000, signal: signal, validateStatus: function () { return true; },
    });
    return r.data;
  }
  async function mvSearch(keyword, cookie, signal) {
    var r = await axios.get(MV_BASE + '/so/' + encodeURIComponent(keyword || '') + '.html', {
      headers: { ...MV_HEADERS, 'Cookie': cookie },
      timeout: 9000, signal: signal, validateStatus: function () { return true; },
    });
    if (mvIsVerify(r.data)) throw new Error('无名音乐网自动过验证失败（可能已升级为需手动验证），将自动回退 aax / qeecc');
    return mvParseItems(r.data);
  }
  // onMatch(u)：记录「已通过身份校验 + safeUrl 过滤」的次优链，供整段超时/全失败时兜底返回
  async function mvGetMediaSource(musicItem, signal, onMatch) {
    var kw = backupQueryTitle(musicItem); // 备用音源检索：剥离歌名括号注解（阴天（Live）→ 阴天），作者不变
    if (!kw) throw new Error('歌曲标题为空，无法在无名音乐网检索');
    var cookie = await ensureMvCookie(false, signal);
    var items;
    try {
      items = await mvSearch(kw, cookie, signal);
    } catch (e) {
      if (_mvCookieUser && /验证/.test(e.message)) {
        _mvCookie = null; _mvCookieUser = false;
        cookie = await ensureMvCookie(false, signal);
        items = await mvSearch(kw, cookie, signal);
      } else throw e;
    }
    if (!items.length) throw new Error('无名音乐网未找到：' + kw);
    // 优先取通过多重身份校验的候选；无严格匹配则退化为按相关度排序
    var matched = items.filter(function (c) { return isGoodMatch(c, musicItem); });
    var ordered = (matched.length ? matched : items).slice().sort(function (a, b) { return matchScore(b, musicItem) - matchScore(a, musicItem); });
    var lastErr = '';
    for (var i = 0; i < Math.min(ordered.length, 2); i++) { // 候选数 5→2，砍掉冗余延迟
      try {
        var d = await mvPlayUrl(ordered[i].id, cookie, signal);
        if (d && d.url) {
          // 【v0.1.4】顺手把该源歌词写入缓存：mvmp3 的 play.php 直接内联 lrc，零额外请求
          if (d.lrc) lrcCacheSet(musicItem, d.lrc);
          var u = safeUrl(d.url);
          if (u && onMatch) onMatch(u); // 记录次优链（已过滤 HLS/非法链）
          if (u && await validatePlayable(u, signal)) return { url: u }; // 不带 Referer（否则 CDN 403）
          lastErr = d && d.msg ? String(d.msg) : '空链接';
        }
      } catch (e) { lastErr = e.message; }
    }
    throw new Error('无名音乐网可取链候选均已下架/不可播放（' + (lastErr || '无可用链接') + '）');
  }

  // ===================== 备用音源②：aax.cx（AAX音乐网）／③：qeecc.com（无忧音乐网） =====================
  // 【v0.1.3】删除原 Tonzhon 源，新增 aax.cx 与 qeecc.com 两个酷我系聚合站（取代网易云匹配方案）。
  // 两站同源 CMS：人机验证页与 mvmp3 同构，取链同为 POST /js/play.php；差异仅在「搜索条目文案 / 详情链接」，
  // 故抽象为「参数化 base + 站点解析器」的通用实现：
  //   · 验证：GET base/ 见「安全人机验证」→ 取 csrf_token → POST base/(csrf_token&human_check=on) → 302 → 缓存 Set-Cookie；
  //   · 搜索：GET base/so/<urlencoded kw>.html（必须先过人机验证；未验证会返回验证页）；
  //   · 取链：POST base/js/play.php(id&type=music) → JSON.url（该端点实测无需验证）。
  // 注：两站取到的多为酷我系直链（aax 的 s.5bb3.com/*.m4a 常 302 到 car-bj.kuwo.cn/*.aac）。
  var SITE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  var SITE_COOKIE_TTL = 50 * 60 * 1000; // 50 分钟（站点会话约 1 小时，留余量）
  // 站点 Cookie 会话：按 base 分别缓存（aax 与 qeecc 各自独立）
  var _siteCookie = {};
  function siteCookieOf(base) { return _siteCookie[base] || (_siteCookie[base] = { ck: null, at: 0 }); }
  function siteIsVerify(html) { return /安全人机验证|我不是人机|verifyForm/.test(html || ''); }
  // 自动过人机验证（与 mvmp3 同构）：先建会话，若见验证页则提交 csrf_token + human_check
  async function siteAutoVerify(base, signal) {
    var r1 = await axios.get(base + '/', {
      headers: { 'User-Agent': SITE_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      timeout: 9000, signal: signal, validateStatus: function () { return true; },
    });
    var setCk = (r1.headers && r1.headers['set-cookie']) || [];
    var jar = {};
    function absorb(list) {
      (list || []).forEach(function (c) {
        var i = c.indexOf('=');
        if (i > 0) jar[c.slice(0, i).trim()] = c.split(';')[0].split('=').slice(1).join('=').trim();
      });
    }
    absorb(setCk);
    var ck = Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
    if (!ck) throw new Error('无法建立会话');
    if (!siteIsVerify(r1.data)) return ck; // 已是已验证会话（极小概率）
    var m = (r1.data || '').match(/name="csrf_token" value="([^"]+)"/);
    var csrf = m ? m[1] : '';
    var r2 = await axios.post(base + '/', 'csrf_token=' + encodeURIComponent(csrf) + '&human_check=on', {
      headers: { 'User-Agent': SITE_UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: base + '/', Cookie: ck },
      timeout: 9000, maxRedirects: 5, signal: signal, validateStatus: function () { return true; },
    });
    absorb(r2 && r2.headers && r2.headers['set-cookie']); // 验证成功后服务端续期 Cookie，合并回 jar
    return Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
  }
  async function siteEnsureCookie(base, signal) {
    var st = siteCookieOf(base), now = Date.now();
    if (st.ck && (now - st.at) < SITE_COOKIE_TTL) return st.ck;
    var fresh = await siteAutoVerify(base, signal);
    st.ck = fresh; st.at = now; return fresh;
  }
  // 「歌手 - 歌名」+「MM:SS」→ {artist,title,duration(ms)}
  function splitDashTitle(raw, time) {
    raw = raw || '';
    var title = raw, artist = '';
    var idx = raw.indexOf(' - ');
    if (idx > 0) { artist = raw.slice(0, idx).trim(); title = raw.slice(idx + 3).trim(); }
    artist = artist.replace(/^[【\[]+|[】\]]+$/g, '').trim();
    title = title.replace(/^[【\[]+|[】\]]+$/g, '').trim();
    var dur;
    var tm = (time || '').match(/(\d{1,2}):(\d{2})/);
    if (tm) dur = (parseInt(tm[1], 10) * 60 + parseInt(tm[2], 10)) * 1000;
    return { title: title, artist: artist, duration: dur };
  }
  // aax.cx 搜索条目：<a href="/s/<32hex>.html" … title="歌手 - 歌名">…<span class="playtime">MM:SS</span>
  // 【v0.1.3】条目含 playtime → 可取到「时长」，纳入 isGoodMatch 时长校验，防同名异人/异长错曲。
  function aaxParseItems(html) {
    if (!html || typeof html !== 'string') return [];
    var items = [], seen = {};
    var re = /<a\s+href="\/s\/([0-9a-f]{32})\.html"[^>]*\btitle="([^"]*)"[\s\S]*?(?:class="playtime">([^<]*)<|<\/li>)/gi;
    var m;
    while ((m = re.exec(html))) {
      var id = m[1];
      if (seen[id]) continue;
      seen[id] = 1;
      var it = splitDashTitle(m[2], m[3]);
      if (it.title) items.push({ id: id, title: it.title, artist: it.artist, duration: it.duration });
    }
    return items;
  }
  // qeecc.com 搜索条目：<div class="name"><a href="/song/<id>.html" target="_mp3">歌手《歌名》[MP3]</a></div>
  function qeParseItems(html) {
    if (!html || typeof html !== 'string') return [];
    var items = [], seen = {};
    var re = /<a\s+href="\/song\/([A-Za-z0-9_\-]+)\.html"[^>]*>([^<]*)<\/a>/gi;
    var m;
    while ((m = re.exec(html))) {
      var id = m[1];
      if (seen[id]) continue;
      seen[id] = 1;
      var txt = (m[2] || '').replace(/&nbsp;/g, ' ').replace(/\s*\[[^\]]*\]\s*$/, '').trim(); // 去尾部 [MP3]/[Mp3_Lrc]
      var artist = '', title = txt;
      var mm = txt.match(/^([\s\S]*?)《([\s\S]*?)》\s*$/);
      if (mm) { artist = mm[1].trim(); title = mm[2].trim(); }
      else { var idx = txt.indexOf(' - '); if (idx > 0) { artist = txt.slice(0, idx).trim(); title = txt.slice(idx + 3).trim(); } }
      if (title) items.push({ id: id, title: title, artist: artist });
    }
    return items;
  }
  // 站点配置（参数化 base + 详情路径 + 解析器）：aax 与 qeecc 同源 CMS，仅此三处不同
  var AAX = { name: 'AAX音乐网', base: 'https://www.aax.cx', detail: '/s/', parse: aaxParseItems };
  var QEECC = { name: '无忧音乐网', base: 'https://www.qeecc.com', detail: '/song/', parse: qeParseItems };
  async function siteSearch(cfg, kw, cookie, signal) {
    var r = await axios.get(cfg.base + '/so/' + encodeURIComponent(kw || '') + '.html', {
      headers: { 'User-Agent': SITE_UA, 'Accept-Language': 'zh-CN,zh;q=0.9', Cookie: cookie },
      timeout: 9000, signal: signal, validateStatus: function () { return true; },
    });
    if (siteIsVerify(r.data)) throw new Error(cfg.name + '：自动过验证失败（可能已升级），跳过该源');
    return cfg.parse(r.data);
  }
  async function sitePlayUrl(cfg, id, cookie, signal) {
    var r = await axios.post(cfg.base + '/js/play.php', 'id=' + encodeURIComponent(id) + '&type=music', {
      headers: {
        'User-Agent': SITE_UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: cfg.base + cfg.detail + id + '.html', // 详情页 Referer（play.php 实测不严格校验，带上更稳）
        Cookie: cookie,
      },
      timeout: 9000, signal: signal, validateStatus: function () { return true; },
    });
    return r.data;
  }
  // onMatch(u)：记录「已通过身份校验 + safeUrl 过滤」的次优链，供整段超时/全失败兜底
  async function siteGetMediaSource(cfg, musicItem, signal, onMatch) {
    var kw = backupQueryTitle(musicItem); // 备用音源检索：剥离歌名括号注解（阴天（Live）→ 阴天），作者不变
    if (!kw) throw new Error('歌曲标题为空，无法在' + cfg.name + '检索');
    var cookie = await siteEnsureCookie(cfg.base, signal);
    var items;
    try {
      items = await siteSearch(cfg, kw, cookie, signal);
    } catch (e) {
      if (siteIsVerify(String(e && e.message))) throw e; // 仍是验证页 → 放弃该源
      siteCookieOf(cfg.base).ck = null;                    // 会话可能失效 → 强制重验一次
      cookie = await siteEnsureCookie(cfg.base, signal);
      items = await siteSearch(cfg, kw, cookie, signal);
    }
    if (!items.length) throw new Error(cfg.name + '未找到：' + kw);
    // 优先取通过多重身份校验（歌名+作者+时长）的候选；无严格匹配则退化为按相关度排序
    var matched = items.filter(function (c) { return isGoodMatch(c, musicItem); });
    var ordered = (matched.length ? matched : items).slice().sort(function (a, b) { return matchScore(b, musicItem) - matchScore(a, musicItem); });
    var lastErr = '';
    for (var i = 0; i < Math.min(ordered.length, 3); i++) {
      try {
        var d = await sitePlayUrl(cfg, ordered[i].id, cookie, signal);
        if (d && d.url) {
          // 【v0.1.4】该源若带歌词（aax 的 lrc 是 URL），后台预取入缓存——不阻塞取链
          if (d.lrc) prefetchSiteLrc(d.lrc, musicItem);
          var u = safeUrl(d.url);
          if (u && onMatch) onMatch(u); // 记录次优链（已过滤 HLS/非法链）
          if (u && await validatePlayable(u, signal)) return { url: u };
          lastErr = d.msg ? String(d.msg) : '空链接';
        }
      } catch (e) { lastErr = e.message; }
    }
    throw new Error(cfg.name + '可取链候选均不可播（' + (lastErr || '无可用链接') + '）');
  }

  // 播放链安全闸门：仅放行「绝对 http(s) 直链」且非 HLS(.m3u8/.m3u) 的 URL。
  // 兜底音源（aax / mvmp3 / qeecc）偶会回吐 HTML 页面、相对路径或 HLS 流，直接交给原生播放器会触发
  // 原生层崩溃（闪退）；此处一律拒之门外，让 getMediaSource 干净抛错（MusicFree 捕获后仅提示“播放失败”）。
  function safeUrl(u) {
    if (!u || typeof u !== 'string') return null;
    u = String(u).trim();
    if (!/^https?:\/\//i.test(u)) return null;                                  // 拒绝相对/协议相对/blob/data
    if (/\.m3u8(\?|$)/i.test(u) || /\.m3u(\?|$)/i.test(u)) return null;         // 拒绝 HLS（原生播放器易崩）
    return u;                                                                    // 原样返回：官方明文 http 与兜底 https 均经实测可播，不做 forceHttps（那会重新引入 TLS 崩溃）
  }
  // 播放前“可播放性”实时探测（兜底安全网）：仅当响应【明确不是音频】(404/403 或 text/html) 才判不可用，
  // 让上层继续走下一个兜底源；网络错误(超时/DNS/Abort)则“信任放行”，避免误杀本可播放的链。
  // 这样即便某 CDN 节点对错误 vkey 回 HTML，也绝不会把崩溃性 URL 交给原生播放器。
  async function validatePlayable(url, signal) {
    if (!url || typeof url !== 'string') return false;
    try {
      var r = await axios.get(url, {
        headers: { 'User-Agent': CHROME_UA, Referer: 'https://y.qq.com/', Range: 'bytes=0-0' },
        timeout: 7000, signal: signal, validateStatus: function () { return true; }, maxRedirects: 5,
      });
      var st = r.status;
      var ct = (r.headers && r.headers['content-type']) || '';
      if (st >= 200 && st < 300 && /audio|video|application\/octet-stream/i.test(ct)) return true;
      // 【v0.1.3】未跟随到底的重定向（如 aax 的 s.5bb3.com/*.m4a 会 302 到酷我 car-bj.kuwo.cn/*.aac）
      // 一律信任放行：它已证明「路径存在且可跳转」，交原生播放器自行跟随；否则会把可播链误杀成播放失败。
      if (st >= 300 && st < 400) return true;
      if (st === 404 || st === 403) return false;
      if (/text\/html/i.test(ct)) return false;
      return true; // 5xx / 其他保守放行
    } catch (e) { return true; } // 网络层异常 / 被 AbortController 中止：信任，不阻断播放
  }

  // ---------- 取链（官方优先 + ②/③/④ 并发竞速 + 9s 软上限） ----------
  // 官方 QQ 取链（需登录态 authst cookie；免费曲返回完整链；VIP/试听曲官方不给链）
  // 与官方 maotoumao/MusicFreePlugins qq.js 的 getSourceUrl 逐字节对齐的“质量→文件前缀”映射
  var QQ_TYPE_MAP = {
    m4a:      { s: 'C400', e: '.m4a' },
    '128':    { s: 'M500', e: '.mp3' },
    standard: { s: 'M500', e: '.mp3' },
    low:      { s: 'M500', e: '.mp3' },
    '320':    { s: 'M800', e: '.mp3' },
    high:     { s: 'M800', e: '.mp3' },
    super:    { s: 'F000', e: '.flac' }, // 【v0.1.0】补齐无损：
    flac:     { s: 'F000', e: '.flac' },
  };
  // 官方 QQ 取链（免费曲返回完整链；VIP/试听曲官方不给链）
  // 关键：vkey 请求必须与官方逐字节对齐——uin 用空串、guid 随机、filename 为「前缀+mid+mid+后缀」
  // （官方即把 id 拼两次）、comm 含 authst:''。此前我方用 uin='0'/固定 guid/单 id 文件名，导致返回的
  // vkey 与 CDN 实际文件 src 不匹配 → CDN 回 403/HTML → 原生播放器崩溃。这恰是前面 5 次修复
  // （cheerio/http/headers/songmid/safeUrl）全部漏掉、且每次都复现的真正根因。
  async function qqOfficialGetUrl(mid, quality, signal) {
    var typeKey = (quality === 'high' || quality === '320' || quality === 'flac' || quality === 'super') ? '320'
                : (quality === 'low' || quality === 'm4a') ? 'm4a'
                : '128';
    var typeObj = QQ_TYPE_MAP[typeKey] || QQ_TYPE_MAP['128'];
    var uin = '';                                       // 与官方一致：空串（不是 '0'）
    var guid = (Math.random() * 10000000).toFixed(0);   // 与官方一致：随机 guid
    var mediaId = mid;
    var file = typeObj.s + mid + mediaId + typeObj.e;    // 与官方一致：id 拼两次
    var data = {
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: {
          filename: [file],
          guid: guid,
          songmid: [mid],
          songtype: [0],
          uin: uin,
          loginflag: 1,
          platform: '20',
        },
      },
      comm: { uin: uin, format: 'json', ct: 19, cv: 0, authst: '' },
    };
    var url = VKEY_API + '&loginUin=' + uin + '&data=' + encodeURIComponent(JSON.stringify(data));
    var j = await req(url, { timeout: 8000, signal: signal }); // 【v0.1.0】收紧至 8s，配合整段 9s 软上限
    var sub = j && j.req_0 && j.req_0.data;
    if (!sub || (j.req_0.code && j.req_0.code !== 0)) {
      throw new Error('QQ 官方取链失败' + (j && j.req_0 && j.req_0.msg ? '：' + j.req_0.msg : ''));
    }
    var mi = sub.midurlinfo && sub.midurlinfo[0];
    var purl = mi && mi.purl;
    if (!purl) {
      throw new Error('QQ 官方：该歌曲需登录态（Cookie 含 authst）才能取链，未登录无法播放');
    }
    // 与官方一致：优先取非 http://ws 开头的 sip，否则取首个；返回明文 http（不做 forceHttps）
    var domain = (sub.sip || []).find(function (i) { return !i.startsWith('http://ws'); }) || (sub.sip && sub.sip[0]) || '';
    return domain + purl;
  }
  async function getMediaSource(musicItem, quality) {
    // 【v0.1.4】只有 id/songmid 是合法 QQ songmid（14 位 base62）才走官方路径。
    // 跨源曲（外源 id）过去会拿外源 id 去盲试官方接口，白等约 5s（实测 6893ms → 现在直接跳过，~2s 出链）。
    var mid = qqSongMid(musicItem);
    var name = (musicItem.title || '') + (musicItem.artist ? '（' + musicItem.artist + '）' : '');
    // 整段 9s 软上限：沙箱方法级 10s 硬超时，留 1s 余量；到点中止所有在途请求
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var signal = controller ? controller.signal : null;
    var bestSoFar = null;   // 已通过【身份校验 + safeUrl 过滤】的次优链，供超时/全失败兜底
    var errs = [];
    function onMatch(u) { if (u && !bestSoFar) bestSoFar = u; }
    var deadline = controller ? setTimeout(function () { try { controller.abort(); } catch (e) {} }, 9000) : null;
    function finish(r) { if (deadline) clearTimeout(deadline); if (controller) { try { controller.abort(); } catch (e) {} } return r; }
    try {
      // ① 官方 QQ 快路径（优先，包装为可能 null 的 Promise，不影响并发）
      var offP = (mid ? qqOfficialGetUrl(mid, quality, signal) : Promise.resolve(null))
        .then(function (official) {
          var u = official ? safeUrl(official) : null;
          if (!u) return null;
          return validatePlayable(u, signal).then(function (ok) { return ok ? { url: u } : null; });
        })
        .catch(function () { return null; });
      // ② 首选备用 aax.cx（AAX音乐网，并发）——条目自带 playtime，可做【歌名+作者+时长】三重校验，最严
      var aaxP = siteGetMediaSource(AAX, musicItem, signal, onMatch)
        .then(function (r) { return { url: r.url }; })
        .catch(function (e) { errs.push('aax:' + (e && e.message)); return null; });
      // ③ 次选备用 mvmp3（无名音乐网，并发）——按【歌手 - 歌名】严格匹配歌名+作者
      var mvP = mvGetMediaSource(musicItem, signal, onMatch)
        .then(function (r) { return { url: r.url }; })
        .catch(function (e) { errs.push('mvmp3:' + (e && e.message)); return null; });
      // ④ 末选备用 qeecc.com（无忧音乐网，并发）
      var qeP = siteGetMediaSource(QEECC, musicItem, signal, onMatch)
        .then(function (r) { return { url: r.url }; })
        .catch(function (e) { errs.push('qeecc:' + (e && e.message)); return null; });

      // 先等官方（最多 7s）；官方未成则进入 ②/③/④ 兜底
      var off = await Promise.race([offP, new Promise(function (res) { setTimeout(res, 7000); })]);
      if (off && off.url) return finish({ url: off.url });

      // 【v0.1.3 取源顺序（用户确认）】aax（时长可校验）→ mvmp3（歌手-歌名双重校验）→ qeecc（兜底）。
      // 三源始终【并发启动】，此处串行 await 只为确定「谁先被采纳」，不额外增加等待（最慢一源即总耗时上限）。
      var aaxR = await aaxP;
      if (aaxR && aaxR.url) return finish({ url: aaxR.url }); // 首选备用 aax.cx
      var mvR = await mvP;
      if (mvR && mvR.url) return finish({ url: mvR.url });    // 次选备用 mvmp3
      var qeR = await qeP;
      if (qeR && qeR.url) return finish({ url: qeR.url });    // 末选备用 qeecc
      // 三源皆败，但存在「已通过身份校验」的次优链（仅时长未知场景）→ 超时/失败前仍返回，最大化“有歌可播”
      if (bestSoFar) return finish({ url: bestSoFar });
      throw new Error('《' + name + '》官方取链失败，且备用音源（aax / mvmp3 / qeecc）均未取得：' + (errs.join('；') || '未知原因') +
        '。备用源提示“验证失败”多为站点临时升级，稍后重试即可；极冷门曲三方均可能无匹配。');
    } finally {
      if (deadline) clearTimeout(deadline);
      if (controller) { try { controller.abort(); } catch (e) {} }
    }
  }

  // ===================== 歌词校验 / 清洗 / 缓存（【v0.1.4】） =====================
  // 背景：v0.1.3 起取链有「官方 + aax/mvmp3/qeecc」四层兜底，而歌词只有 QQ 官方一条路，
  //       导致"靠备用源才播得出"的曲（跨源歌单/收藏导入、外源 id、无 songmid）必然无歌词。
  //       本段补齐歌词兜底所需的三项能力：①有效性判定 → ②站点歌词清洗 → ③单曲歌词缓存。
  // 关键坑一：aax 对无版权曲会回吐**占位歌词** `[00:00.00]暂无歌词内容`——它带时间轴、看似合法；
  // 关键坑二：mvmp3 的 lrc 首行带站点水印 `[00:00.00]无名音乐网 www.mvmp3.com` 且文本含 BOM。
  // 故"含时间轴"不足以判定有效，必须叠加「占位词 + 站点水印」黑名单，否则会把占位当歌词显示。
  var LRC_TIMESTAMP = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/;
  var LRC_TAG = /^\s*\[(ti|ar|al|by|offset|re|ve|length|kana):[^\]]*\]\s*$/i;
  // 站点水印：真歌词行几乎不会包含域名/站点名，出现即判为水印并丢弃
  var LRC_WATERMARK = /www\.|https?:\/\/|无名音乐网|mvmp3|AAX音乐网|aax\.|无忧音乐网|qeecc|酷我|kuwo|九酷|一听音乐/i;
  // 占位歌词：整首去掉标签后仅剩这些词 → 视为"该曲无歌词"
  var LRC_PLACEHOLDER = /^(?:暂无歌词(?:内容)?|暂无|无歌词|没有歌词|歌词不存在|该歌曲暂无歌词|此歌曲暂无歌词|纯音乐|请欣赏|暂无歌词请欣赏|.*没有填词的纯音乐.*|.*该歌曲为纯音乐.*)$/;
  // 单曲歌词缓存：getMediaSource 取链成功时顺带写入（零额外请求）；LRU 上限 + TTL 双兜底
  var LRC_CACHE_MAX = 50, LRC_CACHE_TTL = 30 * 60 * 1000;
  // 反查软上限：实测冷路径（站点会话握手 + 搜索 + 取链 + 取 lrc）最坏约 5.7s，
  // 故留到 8s（仍低于 MusicFree 方法级 10s 硬超时），避免站点稍慢就把已有的歌词丢掉。
  var LRC_LOOKUP_TIMEOUT = 8000;
  var _lrcCache = {};
  // 取「真实歌词行」：既带时间轴，时间轴后又有文字（过掉空行/纯时间轴行/站点水印行）
  function lrcLines(text) {
    var out = [], arr = String(text || '').split(/\r?\n/);
    for (var i = 0; i < arr.length; i++) {
      var line = arr[i].replace(/^\uFEFF/, '').trim();
      if (!line || LRC_TAG.test(line)) continue;
      var t = line.match(LRC_TIMESTAMP);
      if (!t) continue;
      var body = line.replace(/^(?:\[[^\]]*\])+/, '').trim();
      if (!body) continue;                       // [00:00.00] 后面没文字 → 不是歌词行
      if (LRC_WATERMARK.test(body)) continue;    // 站点水印行 → 丢弃
      out.push({ at: parseInt(t[1], 10) * 60 + parseInt(t[2], 10), text: body });
    }
    return out;
  }
  // 有效性判定：至少 1 条真实歌词行，且全部歌词拼起来不是占位词、内容不过短
  function lrcLooksValid(text) {
    var lines = lrcLines(text);
    if (!lines.length) return false;
    var joined = lines.map(function (l) { return l.text; }).join('');
    if (LRC_PLACEHOLDER.test(joined)) return false;
    return joined.replace(/\s/g, '').length >= 8;
  }
  // 清洗：去 BOM、统一换行、剔站点水印行（保留 [ti:]/[ar:] 等元信息与真实歌词行）
  function cleanLrc(text) {
    if (!text || typeof text !== 'string') return '';
    var arr = String(text).split(/\r?\n/), out = [];
    for (var i = 0; i < arr.length; i++) {
      var line = arr[i].replace(/^\uFEFF/, '').trim();
      if (!line) continue;
      if (LRC_TAG.test(line)) { out.push(line); continue; }
      var body = line.replace(/^(?:\[[^\]]*\])+/, '').trim();
      if (body && LRC_WATERMARK.test(body)) continue;
      out.push(line);
    }
    return out.join('\n');
  }
  // 两种载荷都兼容：aax 的 lrc 端点是 JSON 包 {"lrc":"…"}；mvmp3 直接给纯文本
  function parseLrcPayload(data) {
    if (!data) return '';
    if (typeof data === 'object') return typeof data.lrc === 'string' ? data.lrc : '';
    var s = String(data).trim();
    if (s.charAt(0) === '{') {
      try { var j = JSON.parse(s); if (j && typeof j.lrc === 'string') return j.lrc; } catch (e) { /* 非 JSON → 按纯文本处理 */ }
    }
    return s;
  }
  // QQ songmid 形态：14 位 base62（如 0039MnYb0qxYhV）。外源 id（netease_xxx / 纯数字 songid）不匹配，
  // 用于避免"拿外源 id 去盲试官方接口"白等约 5s。匹配失败只是跳过官方路径，仍会走备用源与备用歌词。
  var QQ_MID_RE = /^[0-9A-Za-z]{14}$/;
  function qqSongMid(musicItem) {
    var a = String((musicItem && musicItem.songmid) || ''), b = String((musicItem && musicItem.id) || '');
    if (QQ_MID_RE.test(a)) return a;
    if (QQ_MID_RE.test(b)) return b;
    return '';
  }
  function lrcCacheKey(musicItem) {
    var mid = qqSongMid(musicItem);
    if (mid) return 'm:' + mid;
    return 'q:' + norm(musicItem && musicItem.title) + '|' + norm(musicItem && musicItem.artist);
  }
  function lrcCacheGet(musicItem) {
    var k = lrcCacheKey(musicItem), e = _lrcCache[k];
    if (!e) return null;
    if (Date.now() - e.at > LRC_CACHE_TTL) { delete _lrcCache[k]; return null; }
    return e;
  }
  function lrcCacheSet(musicItem, lrc, trans) {
    var clean = cleanLrc(parseLrcPayload(lrc));
    if (!lrcLooksValid(clean)) return false;
    _lrcCache[lrcCacheKey(musicItem)] = { lrc: clean, trans: trans || undefined, at: Date.now() };
    var keys = Object.keys(_lrcCache);
    if (keys.length > LRC_CACHE_MAX) {   // LRU：按写入时间淘汰最旧
      keys.sort(function (x, y) { return _lrcCache[x].at - _lrcCache[y].at; });
      for (var i = 0; i < keys.length - LRC_CACHE_MAX; i++) delete _lrcCache[keys[i]];
    }
    return true;
  }

  // ---------- 备用歌词反查（【v0.1.4】第③级） ----------
  // 取 lrc 文件（aax 的 .lrc 端点，实测无需 Referer/Cookie）
  async function fetchLrcUrl(url) {
    if (!/^https?:\/\//i.test(String(url || ''))) return '';
    var r = await axios.get(url, { headers: { 'User-Agent': SITE_UA }, timeout: 8000, validateStatus: function () { return true; } });
    return (r && r.data) || '';
  }
  // 取链成功后【后台预取】该源歌词入缓存：fire-and-forget，失败静默（getLyric 第③级会再兜一次）。
  // 注意：此处刻意【不传 signal】—— 取链成功即 abort 主流程，带 signal 会被立刻中断。
  function prefetchSiteLrc(url, musicItem) {
    fetchLrcUrl(url).then(function (raw) {
      lrcCacheSet(musicItem, parseLrcPayload(raw));
    }).catch(function () {});
  }
  // 候选挑选：优先通过 isGoodMatch（歌名+作者+时长）者，否则按相关度退化；只取前 2 条控延迟
  function lrcPickCandidates(items, musicItem) {
    var all = items || [];
    var matched = all.filter(function (c) { return isGoodMatch(c, musicItem); });
    return (matched.length ? matched : all).slice()
      .sort(function (a, b) { return matchScore(b, musicItem) - matchScore(a, musicItem); })
      .slice(0, 2);
  }
  // mvmp3 反查：取链接口【内联】返回 lrc，零额外请求
  async function lrcFromMv(musicItem, kw) {
    var cookie = await ensureMvCookie(false);
    var cands = lrcPickCandidates(await mvSearch(kw, cookie), musicItem);
    for (var i = 0; i < cands.length; i++) {
      var d = await mvPlayUrl(cands[i].id, cookie);
      var lrc = cleanLrc(d && d.lrc);
      if (lrcLooksValid(lrc)) return { lrc: lrc, src: 'mvmp3' };
    }
    return null;
  }
  // aax 反查：取链接口的 lrc 是 URL，需再取一次并解 JSON 包
  async function lrcFromAax(musicItem, kw) {
    var cookie = await siteEnsureCookie(AAX.base);
    var cands = lrcPickCandidates(await siteSearch(AAX, kw, cookie), musicItem);
    for (var i = 0; i < cands.length; i++) {
      var d = await sitePlayUrl(AAX, cands[i].id, cookie);
      if (!(d && d.lrc)) continue;
      var lrc = cleanLrc(parseLrcPayload(await fetchLrcUrl(d.lrc)));
      if (lrcLooksValid(lrc)) return { lrc: lrc, src: 'aax' };
    }
    return null;
  }
  // 第③级入口：mvmp3 与 aax【并发】取首个"身份可信且歌词有效"的结果（用户指定并发策略），6s 软上限
  async function lrcReverseLookup(musicItem) {
    var kw = ((musicItem && musicItem.title) || '').trim() || ((musicItem && musicItem.artist) || '').trim();
    if (!kw) return null;
    function need(p) {
      return p.then(function (r) { if (r && r.lrc) return r; throw new Error('无有效歌词'); });
    }
    var any = Promise.any([need(lrcFromMv(musicItem, kw)), need(lrcFromAax(musicItem, kw))]);
    var tid = null;
    var guard = new Promise(function (_, rej) { tid = setTimeout(function () { rej(new Error('歌词反查超时')); }, LRC_LOOKUP_TIMEOUT); });
    try { return await Promise.race([any, guard]); }
    catch (e) { return null; }
    finally { if (tid) clearTimeout(tid); }
  }

  // ---------- 歌词（【v0.1.4】三级链：① QQ 官方 → ② 播放源缓存 → ③ 备用源反查） ----------
  // 修复点：原实现只有官方一条路，凡"靠备用源才播得出"的曲必然无歌词（实测跨源曲 100% 复现）。
  //   ① 官方：先做 songmid 形态校验（避免拿外源 id 盲试白等 ~5s）；返回后必须过 lrcLooksValid，
  //      否则（如无版权曲 retcode=-1901 空歌词）继续下一级——这是"取不到歌词却无报错"的直接原因。
  //   ② 缓存：getMediaSource 取链成功时已顺带写入（零额外请求），且天然与【实际播放的音源】同源同轴。
  //   ③ 反查：按【歌名 + 歌手】在 mvmp3 / aax 并发检索，复用 isGoodMatch 防张冠李戴。
  //   全部失败返回 {rawLrc:''}：不抛错、不阻塞播放，与原契约一致。
  function maybeB64(s) {
    if (!s) return '';
    var str = String(s);
    return looksBase64(str) ? b64Decode(str) : str;
  }
  async function getLyric(musicItem) {
    var mid = qqSongMid(musicItem);
    if (mid) {
      try {
        var r = await req(LYRIC_API, {
          params: {
            songmid: mid, g_tk: 5381, loginUin: 0, hostUin: 0, format: 'jsonp',
            inCharset: 'utf8', outCharset: 'utf-8', notice: 0, platform: 'yqq.json',
            needNewCode: 0, nobase64: 0, musicid: 0, callback: 'callback',
          },
        });
        var d = toObj(r);
        var trans = d.trans ? cleanLrc(maybeB64(d.trans)) : '';
        var rawLrc = cleanLrc(maybeB64(d.lyric));
        if (lrcLooksValid(rawLrc)) {
          lrcCacheSet(musicItem, rawLrc, trans);   // 官方命中即入缓存，同曲后续零请求
          return { rawLrc: rawLrc, translation: trans || undefined };
        }
      } catch (e) { /* 官方异常 → 继续备用歌词链 */ }
    }
    // ② 播放源缓存（getMediaSource 取链时已写入）
    var hit = lrcCacheGet(musicItem);
    if (hit) return { rawLrc: hit.lrc, translation: hit.trans };
    // ③ 备用源反查
    var found = await lrcReverseLookup(musicItem);
    if (found) {
      lrcCacheSet(musicItem, found.lrc);
      return { rawLrc: found.lrc, translation: undefined };
    }
    return { rawLrc: '', translation: undefined };
  }

  // ---------- 歌曲信息（封面等，无独立详情端点则透传） ----------
  // 关键：必须返回「完整」曲目对象（与 toTrack 同构），artwork 绝不空串。
  // MusicFree 在收藏歌曲 / 拉起播放前会调用 getMusicInfo 取完整信息并存入收藏歌单；
  // 若只回 { artwork } 或回空串，收藏歌单里每一首都会带 artwork:'' → 播放时交给原生层 → 闪退。
  // 故此处把 artwork 兜底补全为真实封面 URL 或 undefined。
  async function getMusicInfo(musicItem) {
    var am = musicItem.albummid || '';
    var art = musicItem.artwork;
    if (!art || art === '') art = toArtworkFromAlbumMid(am);
    return Object.assign({}, musicItem, { artwork: art });
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
        artwork: fixImg(t.picUrl || t.pic), // 【v0.1.0 修复】协议字段为 artwork（非 coverImg），否则排行榜封面不渲染
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

  // ===================== 备用源会话后台预热（【v0.1.0】起，v0.1.4 扩展到三源） =====================
  // 三个备用源同为「酷我系 CMS」，人机验证握手约 2—4s。若等到真正要用时才握手，这笔开销会压在
  // 首次取链或首次歌词反查上（实测冷路径最坏 7.1s，逼近反查软上限）。故在插件加载后延迟预热 +
  // 周期续期（< 50min TTL），并随 search 调用顺手预热，使用时直接命中热会话。
  function warmMvCookie() { ensureMvCookie(false).catch(function () {}); }
  // 【v0.1.4】aax / qeecc 会话一并预热：歌词反查（走 aax）与末选备用取链（走 qeecc）同时受益，
  // 歌词冷路径由 2—7s 降至 2.2—3.6s（站点会话有效约 50 分钟，故 40 分钟续期一次）。
  function warmSiteCookie(cfg) { return siteEnsureCookie(cfg.base).catch(function () {}); }
  function warmAllCookies() {
    warmMvCookie();
    warmSiteCookie(AAX);
    warmSiteCookie(QEECC);
  }
  if (typeof setTimeout === 'function') {
    setTimeout(warmAllCookies, 4000);
    if (typeof setInterval === 'function') setInterval(warmAllCookies, 40 * 60 * 1000);
  }

  module.exports = {
    platform: 'QQ音乐',
    version: '0.1.5',
    author: 'tianpeng',
    description: 'QQ音乐（腾讯系）音源：搜索/歌词/排行榜/热门歌单/歌单导入。' +
      '浏览类功能（搜索、歌词、排行榜、热门歌单、歌单导入）均走免签旧版 cgi-bin 端点；' +
      '播放取链【v0.1.3 竞速并发+三备用源】：①官方QQ(CgiGetVkey，需登录Cookie解锁) 优先(≤7s)，' +
      '②AAX音乐网 aax.cx、③无名音乐网 mvmp3、④无忧音乐网 qeecc.com 三源并发启动；' +
      '采纳顺序 ②→③→④（用户指定）：aax 条目自带时长、做歌名+作者+时长三重校验最严，mvmp3 按【歌手 - 歌名】做歌名+作者双重校验次之，qeecc 兜底；' +
      '三个备用源的人机验证均由插件自动完成（与 mvmp3 同构的 CSRF 会话方案）并缓存 50 分钟，无需手动操作；' +
      '整段 9s 软上限 + 歌名/作者/时长多重身份校验，最大化“有歌可播”且规避沙箱 10s 超时。' +
      '【v0.1.5 优化】备用音源检索剥离歌名括号注解（如「阴天（Live）」→「阴天」），仅作用于回退备用音源、作者保持不变，提升官网无版权曲回退 aax/mvmp3/qeecc 备用源的命中率；' +
      '【v0.1.4 歌词三级兜底】取链有四层兜底而歌词原先只有官方一条路，导致“靠备用源才播得出”的曲必然无歌词；' +
      '现改为 ①QQ官方歌词（须过时长/占位校验，无版权曲 retcode=-1901 空歌词不再当成功）→ ②取链时顺带缓存的该源歌词（零额外请求、与播放音源同源同轴）→ ③按【歌名+歌手】在 mvmp3/aax 并发反查；' +
      '并过滤站点占位歌词（如“暂无歌词内容”）与水印行；同时修正非 QQ songmid 盲试官方取链白等约 5s 的问题；' +
      '三个备用源（mvmp3 / aax / qeecc）的会话均已在插件加载与搜索时后台预热并 40 分钟续期，歌词冷路径由 2—7s 降至 2.2—3.6s。',
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfreemusicfree-all@v0.1.5/musicfree-qq/qq.js',
    cacheControl: 'no-cache',
    supportedSearchType: ['music'],
    userVariables: [
      {
        key: 'cookie',
        name: 'Cookie（可选）',
        hint: 'QQ 音乐登录后的会话 Cookie。填入后用于解锁「①官方QQ取链」（需含 authst / uin）；搜索、歌词、排行榜、热门歌单、歌单导入通常无需 Cookie。未填也能播——会自动走 aax / mvmp3 / qeecc 备用音源。',
      },
      {
        key: 'mvmp3_cookie',
        name: 'mvmp3 Cookie（可选）',
        hint: '无名音乐网(mvmp3)的人机验证由插件自动完成并后台预热，无需你手动操作；会话约 50 分钟自动续期一次。若自动过验证偶发失败，可在此填 mvmp3 的 PHPSESSID（站点 https://www.mvmp3.com 登录/F12 取 Cookie）以跳过自动验证。AAX音乐网(aax.cx) 与 无忧音乐网(qeecc.com) 的人机验证同样由插件自动完成，无需任何配置。',
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
    getRecommendSheetDetail: getMusicSheetInfo, // 别名：部分版本 MusicFree 用此名拉取推荐/热门歌单详情
    // _internal：仅供单元测试访问纯函数（isGoodMatch/多重身份校验、safeUrl、JSONP 剥离、base64 解码等）
    _internal: {
      isGoodMatch: isGoodMatch,
      matchScore: matchScore,
      norm: norm,
      stripBracketed: stripBracketed,         // 【备用音源检索优化】剥离歌名括号注解
      backupQueryTitle: backupQueryTitle,     // 【备用音源检索优化】仅剥离歌名、作者不变
      durMatch: durMatch,
      mvParseItems: mvParseItems,
      aaxParseItems: aaxParseItems,   // 【v0.1.3】aax.cx 条目解析（含时长）
      qeParseItems: qeParseItems,     // 【v0.1.3】qeecc.com 条目解析（歌手《歌名》[MP3]）
      splitDashTitle: splitDashTitle, // 【v0.1.3】「歌手 - 歌名」+「MM:SS」拆分
      mvIsVerify: mvIsVerify,
      siteIsVerify: siteIsVerify,     // 【v0.1.3】站点人机验证页判定
      validatePlayable: validatePlayable, // 【v0.1.3】可播放性探测（含 3xx 信任分支）
      // 【v0.1.3】三源单体入口：便于真机逐源诊断（哪个源挂了能一眼定位，不必跑整段竞速）
      AAX: AAX,
      QEECC: QEECC,
      siteGetMediaSource: siteGetMediaSource,
      mvGetMediaSource: mvGetMediaSource,
      safeUrl: safeUrl,
      stripJsonp: stripJsonp,
      b64Decode: b64Decode,
      toArtworkFromAlbumMid: toArtworkFromAlbumMid,
      fixImg: fixImg,
      // 【v0.1.4】歌词链：校验/清洗/缓存/反查（便于单测与真机定位"歌词为什么没出来"）
      lrcLines: lrcLines,
      lrcLooksValid: lrcLooksValid,
      cleanLrc: cleanLrc,
      parseLrcPayload: parseLrcPayload,
      qqSongMid: qqSongMid,
      qqMidRe: QQ_MID_RE,
      lrcCacheKey: lrcCacheKey,
      lrcCacheGet: lrcCacheGet,
      lrcCacheSet: lrcCacheSet,
      lrcPickCandidates: lrcPickCandidates,
      lrcFromMv: lrcFromMv,
      lrcFromAax: lrcFromAax,
      lrcReverseLookup: lrcReverseLookup,
      fetchLrcUrl: fetchLrcUrl,
      maybeB64: maybeB64,
      // 测试钩子：清空会话与歌词缓存（仅供单测隔离用例状态，生产路径不调用）
      _resetCaches: function () {
        _mvCookie = null; _mvCookieAt = 0; _mvCookieUser = false;
        _siteCookie = {};
        _lrcCache = {};
      },
    },
  };
})();
