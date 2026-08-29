// 网易云音乐音源插件（wy.js）
// ---------------------------------------------------------------------------
// 定位：将"网易云音乐"作为独立音源接入 MusicFree，实现：
//   1) 歌单导入（importMusicSheet / getMusicSheetInfo）
//   2) 热门歌单（getRecommendSheetTags / getRecommendSheetsByTag）
//   3) 排行榜（getTopLists / getTopListDetail）
//   并附带搜索、歌词、取链等基础能力。
//
// 接口均经真实网络探测验证（非盲猜），且全部为**免加密的官方 /api/ 接口**：
//   - 搜索：/api/search/get/web（type: 1=单曲, 1000=歌单）
//   - 取链：/api/song/enhance/player/url（返回 m*.music.126.net 直链）
//   - 歌词：/api/song/lyric（lv/kv/tv=-1，返回 lrc + tlyric）
//   - 歌单详情：/api/playlist/detail（result.tracks 含前 100 首，trackIds 含全量）
//   - 歌单全量曲目：/api/song/detail（按 trackIds 分批 200 取完整曲目，支持大歌单）
//   - 排行榜列表：/api/toplist/detail（list 含 63 个榜单定义，带 id/封面）
//   - 热门歌单标签：/api/playlist/highquality/tags
//   - 热门/分类歌单：/api/playlist/highquality/list（cat=分类名）
//
// 设计说明：
//   早期在聚合插件里曾判定"网易云榜单/歌单需 weapi 加密故不注册"。本轮实测发现
//   上述 /api/ 旧版接口仍可免加密调用（与官方取链失效的酷我不同），故独立插件
//   直接走 plain 接口，无需 crypto-js / weapi，更稳更可移植。
//   取链三层兜底（参考 kugou_mvmp3.js 思路）：网易云官方直链（免费曲高质量）→
//   无名音乐网 mvmp3.com（首选备用，自动过人机验证）→ 歌曲宝 gequbao.com（次选备用）。
//   会员 Cookie 仍可让官方 VIP 曲返回完整链（最高音质）。
//
// 协议：IIFE 兼容 CommonJS(module.exports) 与老协议(return)；移动端用 __musicfree_require
// 回退 require。依赖沙箱内置 require('axios')。headers 带 Referer + UA + Cookie。
// ---------------------------------------------------------------------------

(function () {
  var reqFn = (
    typeof __musicfree_require !== 'undefined' ? __musicfree_require :
    (typeof require !== 'undefined' ? require : null)
  );
  if (!reqFn) throw new Error('[wy] 插件沙箱未提供 require，无法加载');
  var axios = reqFn('axios');
  var cheerio = reqFn('cheerio'); // mvmp3 搜索页解析用（沙箱内置）

  var BASE = 'https://music.163.com/api';
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  var PAGE_SIZE = 30;

  // 音质 -> NetEase br（比特率，单位 bps）
  var BR_MAP = { low: 128000, standard: 192000, high: 320000, super: 999000 };
  // 排行榜分组：含这些关键词的归入"全球媒体榜"，其余归"官方榜"
  var GLOBAL_RE = /UK|Billboard|Oricon|法国|KTV唛|Beatport|俄语|越南语|泰语|俄罗斯|周榜/;

  // ============================ 工具 ============================
  function getCookie() {
    try {
      var v = (typeof env !== 'undefined' && env && env.getUserVariables && env.getUserVariables());
      return (v && v.cookie) || '';
    } catch (e) { return ''; }
  }
  function buildHeaders() {
    return {
      'User-Agent': UA,
      Referer: 'https://music.163.com/',
      Origin: 'https://music.163.com',
      Cookie: (getCookie() || 'os=pc; appver=2.9.7;'),
    };
  }
  function toObj(d) {
    if (typeof d === 'string') { try { return JSON.parse(d); } catch (e) { return {}; } }
    return d || {};
  }
  // HEAD 探测音频真实大小（用于识别"VIP 试听片段"）
  async function headLen(u) {
    try {
      var h = await axios.head(u, {
        headers: { Referer: 'https://music.163.com/' },
        timeout: 8000, validateStatus: function () { return true; },
      });
      return Number(h.headers['content-length'] || 0);
    } catch (e) { return 0; }
  }
  function getVars() {
    try {
      if (typeof env !== 'undefined' && env && typeof env.getUserVariables === 'function') {
        return env.getUserVariables() || {};
      }
    } catch (e) {}
    return {};
  }
  async function nget(path, params) {
    var r = await axios.get(BASE + path, {
      params: params,
      headers: buildHeaders(),
      timeout: 10000,
      validateStatus: function () { return true; },
    });
    return r.data;
  }

  // ============================ 字段映射 ============================
  function formatSong(s) {
    var artists = s.artists || s.ar || [];
    var album = s.album || s.al || {};
    var fee = (s.fee !== undefined) ? s.fee : (s.privilege && s.privilege.fee);
    return {
      id: String(s.id),
      title: s.name,
      artist: artists.map(function (a) { return a.name; }).join('/'),
      album: album.name,
      artwork: album.picUrl || album.pic,
      duration: s.duration || s.dt,
      albumId: album.id,
      fee: fee, // 透传版权标记：0/8=免费, 1=VIP, 4=付费/数字专辑
    };
  }
  function formatSheet(s) {
    return {
      id: String(s.id),
      title: s.name,
      artwork: s.coverImgUrl,
      artist: (s.creator && s.creator.nickname) || '',
      playCount: s.playCount,
      worksNum: s.trackCount,
      createUserId: (s.creator && s.creator.userId) || s.userId,
      description: s.description,
    };
  }

  // ============================ 搜索 ============================
  async function search(query, page, type) {
    var typeMap = { music: 1, sheet: 1000 };
    var t = (typeMap[type] !== undefined) ? typeMap[type] : 1;
    var res = toObj(await nget('/search/get/web', {
      s: query, type: t, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE,
    }));
    var result = res.result || {};
    if (type === 'sheet') {
      var slist = (result.playlists || []).map(formatSheet);
      var stotal = result.playlistCount || 0;
      return { isEnd: slist.length < PAGE_SIZE || page * PAGE_SIZE >= stotal, data: slist };
    }
    var mlist = (result.songs || []).map(formatSong);
    var mtotal = result.songCount || 0;
    return { isEnd: mlist.length < PAGE_SIZE || page * PAGE_SIZE >= mtotal, data: mlist };
  }

  // ===================== 备用音源①：无名音乐网 mvmp3.com =====================
  // 取链质量高；其“我不是人机”是软勾选框，插件【自动】GET/POST 过验证并缓存 50 分钟。
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
    if (mvIsVerify(r.data)) throw new Error('无名音乐网自动过验证失败（可能已升级为需手动验证），将自动回退歌曲宝');
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
        if (d && d.url) return { url: d.url, rawLrc: d.lrc || '', artwork: d.pic || '' }; // 不带 Referer，否则 CDN 403
        lastErr = d && d.msg ? String(d.msg) : '空链接';
      } catch (e) { lastErr = e.message; }
    }
    throw new Error('无名音乐网可取链候选均已下架/不可播放（' + (lastErr || '无可用链接') + '）');
  }
  async function mvGetLyric(musicItem) {
    var kw = (musicItem.title || '').trim() || (musicItem.artist || '').trim();
    if (!kw) return { rawLrc: '' };
    var cookie;
    try { cookie = await ensureMvCookie(); } catch (e) { return { rawLrc: '' }; }
    var items;
    try { items = await mvSearch(kw, cookie); } catch (e) { return { rawLrc: '' }; }
    if (!items.length) return { rawLrc: '' };
    var ordered = mvRank(items, musicItem);
    if (!ordered.length) ordered = items;
    for (var i = 0; i < Math.min(ordered.length, 3); i++) {
      try { var d = await mvPlayUrl(ordered[i].id, cookie); if (d && d.lrc) return { rawLrc: d.lrc }; } catch (e) {}
    }
    return { rawLrc: '' };
  }

  // ===================== 备用音源②：歌曲宝 gequbao.com =====================
  // 无需验证，作为 mvmp3 自动过验证偶发失败时的自动兜底。
  var GB_BASE = 'https://www.gequbao.com';
  var GB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  function gbForceHttps(u) { return u ? String(u).replace(/^http:/i, 'https:') : u; }
  function gbExtractCookie(res) {
    var sc = res && res.headers && res.headers['set-cookie'];
    if (!sc || !sc.length) return '';
    var parts = [];
    for (var i = 0; i < sc.length; i++) {
      var c = sc[i], eq = c.indexOf('=');
      if (eq < 0) continue;
      var name = c.substring(0, eq), semi = c.indexOf(';');
      var val = semi < 0 ? c.substring(eq + 1) : c.substring(eq + 1, semi);
      parts.push(name + '=' + val);
    }
    return parts.join('; ');
  }
  function gbExtractPlayId(html) {
    var m = html.match(/window\.appData\s*=\s*JSON\.parse\('([\s\S]*?)'\)/);
    if (!m) return null;
    try {
      var raw = m[1].replace(/\\u0022/g, '"').replace(/\\u0027/g, "'").replace(/\\\\/g, '\\');
      var obj = JSON.parse(raw);
      return obj && obj.play_id ? obj.play_id : null;
    } catch (e) { return null; }
  }
  function gbParseItems(html) {
    var items = [], seen = {};
    var re = /<a\s+[^>]*?href="\/music\/(\d+)"[^>]*?title="([^"]*)"/g, m;
    while ((m = re.exec(html))) {
      var id = m[1];
      if (seen[id]) continue;
      seen[id] = 1;
      var ta = m[2] || '', title = ta, artist = '';
      var idx = ta.lastIndexOf(' - ');
      if (idx > 0) { title = ta.substring(0, idx).trim(); artist = ta.substring(idx + 3).trim(); }
      items.push({ id: id, title: title, artist: artist });
    }
    return items;
  }
  function gbGetHtml(url, ref) {
    var headers = { 'User-Agent': GB_UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
    if (ref) headers['Referer'] = ref;
    return axios.get(url, { headers: headers, timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; } });
  }
  async function gbGetPlayUrl(musicId) {
    var pageUrl = GB_BASE + '/music/' + musicId;
    var r = await gbGetHtml(pageUrl, null);
    var cookie = gbExtractCookie(r);
    var playId = gbExtractPlayId(r.data);
    if (!playId) throw new Error('歌曲宝无法解析播放令牌（页面结构可能已变更）');
    var r2 = await axios.post(GB_BASE + '/member/common-play-url', 'id=' + encodeURIComponent(playId), {
      headers: { 'User-Agent': GB_UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': pageUrl, 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/javascript, */*', 'Cookie': cookie },
      timeout: 9000, validateStatus: function () { return true; },
    });
    var d = r2.data;
    if (d && d.code === 1 && d.data && d.data.url) return gbForceHttps(d.data.url);
    throw new Error('歌曲宝取链失败：' + (d && d.msg ? d.msg : JSON.stringify(d)));
  }
  async function gbSearch(keyword) {
    var r = await gbGetHtml(GB_BASE + '/s/' + encodeURIComponent(keyword || ''), null);
    return gbParseItems(r.data);
  }
  async function gbGetLyric(musicId) {
    var r = await gbGetHtml(GB_BASE + '/music/' + musicId, null);
    var html = r.data, i = html.indexOf('id="content-lrc"');
    if (i < 0) return { rawLrc: '' };
    var start = html.indexOf('>', i) + 1, end = html.indexOf('</div>', start);
    if (end < 0) end = html.length;
    var lrc = html.substring(start, end)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
      .trim();
    return { rawLrc: lrc };
  }

  // ============================ 取链（官方 + 双层备用兜底） ============================
  // 免费曲：官方 m*.music.126.net 直链（高质量）优先；
  // VIP/付费曲（fee=1/4）：官方仅返回约 30s 试听片段，自动改用
  //   【首选】无名音乐网 mvmp3.com（自动过人机验证）
  //   【次选】歌曲宝 gequbao.com（无需验证）
  // 三层全失败才报错，最大化“有歌可播”。
  async function getMediaSource(musicItem, quality) {
    var br = BR_MAP[quality] || 320000;
    var id = String(musicItem.id);
    var headers = { Referer: 'https://music.163.com/' };
    var isVip = (musicItem.fee === 1 || musicItem.fee === 4);

    // 1) 官方取链（免费曲完整 / VIP 曲试听）
    var officialUrl = null, isPreview = false;
    try {
      var res = toObj(await nget('/song/enhance/player/url', { id: id, ids: '[' + id + ']', br: br }));
      var d = (res.data && res.data[0]) || {};
      if (d.url) {
        officialUrl = d.url;
        // 试听检测：仅 VIP/未知 fee 触发，避免免费曲额外 HEAD 延迟
        if (isVip || musicItem.fee == null) {
          var len = await headLen(officialUrl);
          var durSec = (musicItem.duration || 0) / 1000;
          var actualBr = d.br || br; // 按实际返回码率估算，避免请求 320k 但实回 128k 的免费曲被误判
          var expected = durSec * (actualBr / 8);
          if (len && expected && len < expected * 0.5) isPreview = true;
        }
      }
    } catch (e) {}

    // 官方完整链优先（免费曲 / 会员完整链）
    if (officialUrl && !isPreview) {
      return { url: officialUrl, headers: headers };
    }

    // 2) 官方是试听/无链 -> 双层备用兜底
    var errs = [];
    // 首选：无名音乐网 mvmp3（自动过人机验证）
    try {
      var mv = await mvGetMediaSource(musicItem);
      if (mv && mv.url) return { url: mv.url }; // 不带 Referer（否则 CDN 403）
    } catch (e) { errs.push('mvmp3:' + e.message); }

    // 次选：歌曲宝（无需验证）
    try {
      var q = (musicItem.title || '').trim();
      var g = await gbSearch(q);
      if (g && g.length) {
        var ordered = mvRank(g, musicItem);
        var pick = ordered.length ? ordered : g;
        var gurl = await gbGetPlayUrl(pick[0].id);
        if (gurl) return { url: gurl, artwork: musicItem.coverImg || musicItem.artwork || '' };
      }
    } catch (e) { errs.push('歌曲宝:' + e.message); }

    var name = (musicItem.title || '') + (musicItem.artist ? '（' + musicItem.artist + '）' : '');
    throw new Error('《' + name + '》官方为 VIP 试听且备用音源均未取得：' + (errs.join('；') || '未知原因') +
      '。若无名音乐网报错“验证失败”，多为临时升级，稍后重试即可。');
  }

  // ============================ 歌词（官方 + 备用兜底） ============================
  async function getLyric(musicItem) {
    var res = toObj(await nget('/song/lyric', {
      id: String(musicItem.id), lv: -1, kv: -1, tv: -1,
    }));
    var lrc = (res.lrc && res.lrc.lyric) || '';
    var tlyric = (res.tlyric && res.tlyric.lyric) || '';
    if (lrc) return { rawLrc: lrc, translation: tlyric || undefined };
    // 官方无词 -> 备用源兜底
    try { var ml = await mvGetLyric(musicItem); if (ml && ml.rawLrc) return { rawLrc: ml.rawLrc }; } catch (e) {}
    try {
      var q = (musicItem.title || '').trim();
      var g = await gbSearch(q);
      if (g && g.length) {
        var ordered = mvRank(g, musicItem);
        var pick = ordered.length ? ordered : g;
        var gl = await gbGetLyric(pick[0].id);
        if (gl && gl.rawLrc) return { rawLrc: gl.rawLrc };
      }
    } catch (e) {}
    return { rawLrc: '' };
  }

  // ============================ 歌单曲目（全量，支持大歌单） ============================
  async function getPlaylistSongs(id) {
    var detail = toObj(await nget('/playlist/detail', { id: String(id) }));
    var result = detail.result || detail;
    var trackIds = (result.trackIds || []).map(function (t) { return t.id; });
    var tracks = result.tracks || [];
    // 详情已含全部曲目（如排行榜 100 首）则直接映射
    if (trackIds.length === 0 || tracks.length >= trackIds.length) {
      return tracks.map(formatSong);
    }
    // 大歌单：按 trackIds 分批取完整曲目
    var songs = [];
    for (var i = 0; i < trackIds.length; i += 200) {
      var batch = trackIds.slice(i, i + 200);
      var sd = toObj(await nget('/song/detail', { ids: JSON.stringify(batch) }));
      (sd.songs || sd.songdetails || []).forEach(function (s) { songs.push(s); });
    }
    return songs.map(formatSong);
  }

  // ============================ 排行榜 ============================
  async function getTopLists() {
    var res = toObj(await nget('/toplist/detail', {}));
    var list = res.list || [];
    var official = [], global = [];
    list.forEach(function (x) {
      var item = { id: String(x.id), title: x.name, coverImg: x.coverImgUrl, description: x.description };
      (GLOBAL_RE.test(x.name) ? global : official).push(item);
    });
    return [
      { title: '官方榜', data: official },
      { title: '全球媒体榜', data: global },
    ];
  }
  async function getTopListDetail(topListItem, page) {
    var songs = await getPlaylistSongs(topListItem.id);
    var pageSize = 100;
    var start = (page - 1) * pageSize;
    var slice = songs.slice(start, start + pageSize);
    return { isEnd: start + pageSize >= songs.length, musicList: slice };
  }

  // ============================ 热门歌单（标签 + 歌单） ============================
  async function getRecommendSheetTags() {
    var res = toObj(await nget('/playlist/highquality/tags', {}));
    var tags = res.tags || [];
    var data = [{
      title: '歌单分类',
      data: tags.map(function (t) { return { id: String(t.id), title: t.name }; }),
    }];
    var pinned = [{ id: '', title: '全部' }];
    return { data: data, pinned: pinned };
  }
  async function getRecommendSheetsByTag(tag, page) {
    var pageSize = 20;
    var cat = (tag && tag.id) ? tag.title : '全部';
    var res = toObj(await nget('/playlist/highquality/list', {
      cat: cat, limit: pageSize, offset: (page - 1) * pageSize,
    }));
    var list = (res.playlists || []).map(formatSheet);
    return { isEnd: res.more !== true, data: list };
  }

  // ============================ 歌单导入 / 详情 ============================
  function parsePlaylistId(urlLike) {
    if (!urlLike) return null;
    var s = String(urlLike).trim();
    var m;
    if ((m = s.match(/playlist\?id=(\d+)/i))) return m[1];
    if ((m = s.match(/playlist\/(\d+)/i))) return m[1];
    if ((m = s.match(/^\s*(\d+)\s*$/))) return m[1];
    return null;
  }

  async function importMusicSheet(urlLike) {
    var id = parsePlaylistId(urlLike);
    if (!id) return; // 无法识别则交还空（MusicFree 会提示）
    return await getPlaylistSongs(id);
  }

  async function getMusicSheetInfo(sheet, page) {
    var songs = await getPlaylistSongs(sheet.id);
    var start = (page - 1) * PAGE_SIZE;
    var slice = songs.slice(start, start + PAGE_SIZE);
    return {
      isEnd: start + PAGE_SIZE >= songs.length,
      musicList: slice,
      sheetItem: sheet,
    };
  }

  // ============================ 导出 ============================
  var plugin = {
    platform: '网易云音乐',
    version: '0.0.1',
    author: 'tianpeng',
    description: '网易云音乐音源：支持歌单导入、热门歌单、官方排行榜，附带搜索/歌词/取链。' +
      '全部走免加密官方 /api 接口；VIP/付费曲目免费态仅返回约 30 秒试听片段（版权限制），' +
      '插件自动改用【无名音乐网 mvmp3（首选）】与【歌曲宝 gequbao（次选）】双层备用音源兜底，最大化可播率。',
    srcUrl: 'https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-wy/wy.js',
    cacheControl: 'no-cache',
    supportedSearchType: ['music', 'sheet'],
    userVariables: [
      {
        key: 'cookie',
        name: 'Cookie（可选）',
        hint: '登录 music.163.com 后从浏览器开发者工具复制 Cookie 填入，可让官方 VIP 曲目返回完整链（最高音质）',
      },
      {
        key: 'mvmp3_cookie',
        name: '无名音乐网 Cookie (PHPSESSID)（可选）',
        hint: '通常【无需填写】。插件会自动完成“我不是人机”验证并缓存 50 分钟。' +
          '仅当你想固定使用自己浏览器会话时才填：仅填 PHPSESSID 的值或完整 “PHPSESSID=值” 均可。',
      },
    ],
    hints: {
      importMusicSheet: [
        '网易云APP：歌单-分享-复制链接，直接粘贴即可',
        '支持格式：https://music.163.com/playlist?id=123456 或直接输入纯数字歌单ID',
        '导入时间和歌单大小有关，请耐心等待',
      ],
      getMediaSource: [
        '免费曲优先用网易云官方直链（最高音质）；VIP/付费曲官方仅约 30 秒试听，会自动转无名音乐网（自动过人机验证）兜底，再不行转歌曲宝。',
        '若提示“无名音乐网验证失败”，多为该站临时升级人机验证，稍后重试即可；歌曲宝会作为自动兜底。',
      ],
    },
    async search(query, page, type) {
      return await search(query, page, type);
    },
    getMediaSource: getMediaSource,
    getLyric: getLyric,
    getTopLists: getTopLists,
    getTopListDetail: getTopListDetail,
    importMusicSheet: importMusicSheet,
    getRecommendSheetTags: getRecommendSheetTags,
    getRecommendSheetsByTag: getRecommendSheetsByTag,
    getMusicSheetInfo: getMusicSheetInfo,
  };

  if (typeof module !== 'undefined' && module && module.exports) module.exports = plugin;
  if (typeof exports !== 'undefined') exports.default = plugin;
  return plugin;
})();
