// 酷狗音源 + 无名音乐网(mvmp3) + 歌曲宝(gequbao) + AAX音乐网(aax.cx) 四层兜底插件
// ---------------------------------------------------------------------------
// 设计目标：让“无法播放”的场景尽可能被兜住。
//   - 酷狗官方取链：对大量歌曲当前已返回空 play_url（接口层面失效），仅作为第一优先尝试；
//   - 无名音乐网(mvmp3.com)：取链质量高；其“我不是人机”是软勾选框，插件【自动】GET/POST 过验证并缓存 50 分钟，无需你手动操作；
//   - 歌曲宝(gequbao.com)：无需验证，作为“mvmp3 自动过验证偶发失败”时的自动兜底；
//   - AAX音乐网(aax.cx)：酷我系聚合站，作为 gequbao 之后的第③备用源（最后兜底）。
// 取链顺序：酷狗 → 无名音乐网(mvmp3) → 歌曲宝(gequbao) → AAX音乐网(aax.cx)。任一层成功即用，保证尽量有歌可播。
//
// 关键坑（实测）：kuwo CDN 的音频直链【不能带 Referer】，带 mvmp3/gequbao 站 Referer 会 403；
//   因此 mvmp3 / gequbao 返回的媒体只给 {url}，不带 headers。酷狗 CDN 才需要 kugou Referer。
//
// v0.0.6 新增（作者 tianpeng）：
//   - 酷狗【歌单导入】：粘贴酷狗歌单链接（gcid_xxx 或数字 specialid）即可导入；
//   - 【排行榜】：抓取酷狗官方 55 个官方榜单（飙升/新歌/TOP500/各语种流派等）；
//   - 【热门榜单】：精选“历史收藏最多(百万收藏榜)”等高热度榜单。
//
// v0.1.0 优化（下沉 qq.js v0.1.8 三态校验 + 三层→四层 + 官方软熔断 + 取链打分）：
//   - 【第一批/P0】下沉 qq.js v0.1.8 三态身份校验（isGoodMatch/isSafeCandidate/matchScore/pickOrdered），
//     取代原 mvRank「无命中即回退未过滤列表」的 fail-open，修复「同名异版错播」；无安全候选一律返回 null 拒绝错播。
//   - 【第二批/P1】新增第③备用源 AAX音乐网(aax.cx)，取链层级从「酷狗+mvmp3+gequbao」扩展为四层；
//     备用源单请求超时统一收敛至 3000ms（KG_SRC_TIMEOUT）。
//   - 【第三批/P1】酷狗官方取链软熔断：连续空返回/异常 5 次后熔断，跳过官方直走备用源；
//     熔断状态经 _internal.kgOfficialFuse() 可读、_internal.kgOfficialFuseReset() 可重置（重启即复位）。
//   - 【第四批/P2】取链质量打分：matchScore 对 mvmp3/gequbao/aax 候选按「歌名+歌手+完全相等」打分择优，
//     结构化明细写入 _kgScoreLog 并由 _internal.scoreLog() 读取（供诊断与测试）。
//   ⚠️ 合规提醒：本插件仅供个人学习与研究使用，请遵守相关站点服务条款与版权法规。
//
// 协议：IIFE 兼容 CommonJS(module.exports) 与老协议(return)。
// 依赖沙箱内置 require('axios')。
// ---------------------------------------------------------------------------

(function () {
  var reqFn = (
    typeof __musicfree_require !== 'undefined' ? __musicfree_require :
    (typeof require !== 'undefined' ? require : null)
  );
  if (!reqFn) throw new Error('[kugou-mvmp3] 插件沙箱未提供 require，无法加载');
  var axios = reqFn('axios');

  // 备用源（mvmp3 / gequbao / aax）单请求超时（统一 ≤3000ms，与 qq.js v0.1.x 一致）
  var KG_SRC_TIMEOUT = 3000;

  // ============================ 酷狗（官方逻辑） ============================
  var KG_PAGE_SIZE = 20;
  var KG_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };
  // 排行榜/歌单等 m.kugou.com 接口使用的移动端 UA（与 search 同源即可）
  var KG_M_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.0.0 Mobile Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };

  function formatMusicItem(_) {
    return {
      id: _.hash,
      title: _.songname,
      artist: _.singername,
      album: _.album_name,
      album_id: _.album_id,
      album_audio_id: _.album_audio_id,
    };
  }

  async function searchMusic(query, page) {
    const res = (await axios.get('http://mobilecdn.kugou.com/api/v3/search/song', {
      headers: KG_HEADERS,
      params: { format: 'json', keyword: query, page: page, pagesize: KG_PAGE_SIZE, showtype: 1 },
    })).data;
    const info = (res.data && res.data.info) || [];
    const songs = info.map(formatMusicItem);
    return {
      isEnd: page * KG_PAGE_SIZE >= (res.data ? res.data.total : songs.length),
      data: songs,
    };
  }

  async function kugouGetMediaSource(musicItem) {
    const res = (await axios.get('https://wwwapi.kugou.com/yy/index.php', {
      headers: KG_HEADERS,
      params: {
        r: 'play/getdata',
        hash: musicItem.id,
        appid: '1014',
        mid: '56bbbd2918b95d6975f420f96c5c29bb',
        album_id: musicItem.album_id,
        album_audio_id: musicItem.album_audio_id,
        _: Date.now(),
      },
    })).data.data;
    return { url: res.play_url || res.play_backup_url, rawLrc: res.lyrics, artwork: res.img };
  }

  // ===================== 无名音乐网(mvmp3.com) 回退源 =====================
  var MV_BASE = 'https://www.mvmp3.com';
  var MV_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  var MV_HEADERS = {
    'User-Agent': MV_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };

  function getVars() {
    try {
      if (typeof env !== 'undefined' && env && typeof env.getUserVariables === 'function') {
        return env.getUserVariables() || {};
      }
    } catch (e) {}
    return {};
  }
  // 规范化 Cookie：用户可只填 PHPSESSID 的值，也可填完整 "PHPSESSID=xxx"
  function normCookie(raw) {
    raw = (raw || '').trim();
    if (!raw) return '';
    if (raw.indexOf('=') === -1) return 'PHPSESSID=' + raw;
    return raw;
  }

  // ---- 无名音乐网会话：自动过验证 + 缓存 ----
  var _mvCookie = null;          // 已通过验证的会话 Cookie（完整形态）
  var _mvCookieAt = 0;           // 获取时间戳
  var _mvCookieUser = false;     // 是否来自用户变量（true 时失效不自动重过）
  var MV_COOKIE_TTL = 50 * 60 * 1000; // 50 分钟（小于站点 1 小时有效期，留余量）

  // 自动完成“我不是人机”软验证：GET / 取会话+csrf → POST / 提交 human_check=on
  async function autoVerify() {
    var r1 = await axios.get(MV_BASE + '/', { headers: MV_HEADERS, timeout: KG_SRC_TIMEOUT });
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
      timeout: KG_SRC_TIMEOUT, maxRedirects: 5, validateStatus: function () { return true; },
    });
    return ck;
  }

  // 取得可用会话 Cookie：优先用用户变量；否则自动过验证并缓存 50 分钟
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
    var $ = require('cheerio').load(html);
    var items = [];
    var seen = {};
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
  // ============================ 【v0.1.0 第一批】三态身份校验（移植自 qq.js v0.1.8，修复「同名异版错播」） ============================
  // 背景：原 mvRank「无命中即回退未过滤列表」+ 旧「任一侧缺失即放行(fail-open)」叠加，使「歌名相同但歌手不同」
  //   的候选照样被选中（即 qq.js v0.1.7 错播根因同源）。现以三态判定取代之：
  //   三态：ok（已验证一致）／unknown（该侧信息缺失，无从验证）／conflict（双方已知且不一致）。
  //   【v0.1.8】口径：仅以「歌名+歌手」双因子校验（时长多源不可靠，且错播真因是歌手 fail-open，非时长）。
  // 取链质量打分（第四批）：matchScore 对候选按 歌名互含(+2) + 歌手匹配(+1) + 歌名完全相等(+1) 打分择优。
  var _kgScoreLog = [];   // 结构化打分明细（最多保留最近 50 条），供 _internal.scoreLog() 读取与测试断言
  function artistMatch(ar, ca) {
    if (!ar || !ca) return true;                       // 任一侧缺失 → 不据此否决
    if (ca.indexOf(ar) >= 0 || ar.indexOf(ca) >= 0) return true;
    function tokens(s) {
      return String(s).split(/[\/、,，&;；|+]+|\s*feat\.?\s*|\s*ft\.?\s*/i)
        .map(function (x) { return norm(x); })
        .filter(function (x) { return x && x.length >= 2; });
    }
    var A = tokens(ar), B = tokens(ca);
    for (var i = 0; i < A.length; i++) {
      for (var j = 0; j < B.length; j++) {
        if (A[i].indexOf(B[j]) >= 0 || B[j].indexOf(A[i]) >= 0) return true;
      }
    }
    return false;
  }
  function durMatch(a, b, tol) {
    if (!a || !b) return true; // 任一侧缺失 → 不据此否决（调用方须先经 durState 判三态）
    var sa = a >= 1000 ? a / 1000 : a;
    var sb = b >= 1000 ? b / 1000 : b;
    return Math.abs(sa - sb) <= (tol || 3);
  }
  function durState(cand, musicItem) {            // 【v0.1.8】保留未引用：当前校验口径已取消时长，函数留存以备扩展
    var a = musicItem && musicItem.duration, b = cand && cand.duration;
    if (!a || !b) return 'unknown';
    return durMatch(a, b, 5) ? 'ok' : 'conflict';
  }
  function artistState(cand, musicItem) {
    var ar = norm(musicItem && musicItem.artist), ca = norm(cand && cand.artist);
    if (!ar) return 'unknown';                       // 目标侧无歌手信息 → 无从校验
    if (!ca) return titleOk(cand, musicItem) && norm(cand && cand.title).indexOf(ar) >= 0 ? 'ok' : 'unknown';
    return artistMatch(ar, ca) ? 'ok' : 'conflict';
  }
  function titleOk(cand, musicItem) {
    var t = norm(musicItem && musicItem.title), ct = norm(cand && cand.title);
    if (!t || !ct) return false;
    return ct.indexOf(t) >= 0 || t.indexOf(ct) >= 0;
  }
  function isGoodMatch(cand, musicItem) {
    if (!titleOk(cand, musicItem)) return false;
    var a = artistState(cand, musicItem);
    if (a === 'conflict') return false;
    var hasA = !!norm(musicItem && musicItem.artist);
    if (!hasA) return true;
    return a === 'ok';
  }
  function isSafeCandidate(cand, musicItem) {
    if (!titleOk(cand, musicItem)) return false;
    var a = artistState(cand, musicItem);
    if (a === 'conflict') return false;
    if (a === 'ok') return true;
    return !norm(musicItem && musicItem.artist);
  }
  function matchScore(c, musicItem) {
    var t = norm(musicItem.title), ar = norm(musicItem.artist);
    var ct = norm(c.title), ca = norm(c.artist), s = 0;
    if (t && (ct.indexOf(t) >= 0 || t.indexOf(ct) >= 0)) s += 2;
    if (artistMatch(ar, ca) && ar && ca) s += 1;
    if (t && ct === t) s += 1;
    return s;
  }
  // 【v0.1.0 第一批】统一选池：优先强命中；无强命中则退到「可安全播放」池；两者皆空 → 返回 null（调用方抛错拒绝错播）。
  // 取代原先 mvRank「无命中即回退未过滤列表」——它会在无命中时回退到【未过滤】列表，正是错播的最后一环。
  function pickOrdered(items, musicItem) {
    var all = items || [];
    if (!all.length) { recordScore(musicItem, [], null); return null; }
    var strong = all.filter(function (c) { return isGoodMatch(c, musicItem); });
    var pool = strong.length ? strong : all.filter(function (c) { return isSafeCandidate(c, musicItem); });
    var scored = pool.slice().sort(function (a, b) { return matchScore(b, musicItem) - matchScore(a, musicItem); });
    recordScore(musicItem, all, scored);
    if (!scored.length) return null;
    return scored;
  }
  // 结构化打分明细：记录候选总数 / 选中项 / 全候选打分，写入 _kgScoreLog 并输出可读日志（第四批要求）。
  function recordScore(musicItem, all, scored) {
    var entry = {
      at: Date.now(),
      title: musicItem && musicItem.title,
      artist: musicItem && musicItem.artist,
      total: (all || []).length,
      selected: scored && scored.length ? { id: scored[0].id, title: scored[0].title, artist: scored[0].artist, score: matchScore(scored[0], musicItem) } : null,
      candidates: (scored || []).map(function (c) { return { id: c.id, title: c.title, artist: c.artist, score: matchScore(c, musicItem) }; }),
    };
    _kgScoreLog.push(entry);
    if (_kgScoreLog.length > 50) _kgScoreLog.shift();
    if (typeof console !== 'undefined' && console.log) {
      console.log('[kg 取链打分] ' + (entry.title || '') + (entry.artist ? ' - ' + entry.artist : '') +
        ' 候选=' + entry.total + ' 选中=' + (entry.selected ? (entry.selected.title + '/' + entry.selected.artist + ' 分' + entry.selected.score) : '无(拒绝错播)'));
    }
    return entry;
  }

  async function mvPlayUrl(hash, cookie) {
    var r = await axios.post(MV_BASE + '/style/js/play.php', 'id=' + hash + '&type=dance', {
      headers: {
        'User-Agent': MV_UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': MV_BASE + '/mp3/' + hash + '.html', // 这是给 play.php 接口用的，不是给音频 CDN 的
        'Cookie': cookie,
      },
      timeout: KG_SRC_TIMEOUT,
      validateStatus: function () { return true; },
    });
    return r.data;
  }

  async function mvSearch(keyword, cookie) {
    var r = await axios.get(MV_BASE + '/so/' + encodeURIComponent(keyword || '') + '.html', {
      headers: { ...MV_HEADERS, 'Cookie': cookie },
      timeout: KG_SRC_TIMEOUT,
      validateStatus: function () { return true; },
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
      // 用户提供的 Cookie 失效：丢弃它，自动重新过验证再试一次
      if (_mvCookieUser && /验证/.test(e.message)) {
        _mvCookie = null; _mvCookieUser = false;
        cookie = await ensureMvCookie();
        items = await mvSearch(kw, cookie);
      } else throw e;
    }
    if (!items.length) throw new Error('无名音乐网未找到：' + kw);
    var ordered = pickOrdered(items, musicItem);
    if (!ordered) throw new Error('无名音乐网候选均未通过身份校验（歌名或歌手不符），已拒绝错播并回退下一层');
    var lastErr = '';
    for (var i = 0; i < Math.min(ordered.length, 5); i++) {
      try {
        var d = await mvPlayUrl(ordered[i].id, cookie);
        if (d && d.url) return { url: d.url, rawLrc: d.lrc || '', artwork: d.pic || '' }; // 不带 Referer，否则 kuwo CDN 403
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
    var ordered = pickOrdered(items, musicItem);
    if (!ordered) return { rawLrc: '' };
    for (var i = 0; i < Math.min(ordered.length, 3); i++) {
      try { var d = await mvPlayUrl(ordered[i].id, cookie); if (d && d.lrc) return { rawLrc: d.lrc }; } catch (e) {}
    }
    return { rawLrc: '' };
  }

  // ============================ 歌曲宝(gequbao) 回退源 ============================
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
    return axios.get(url, { headers: headers, timeout: KG_SRC_TIMEOUT, maxRedirects: 5, validateStatus: function () { return true; } });
  }
  async function gbGetPlayUrl(musicId) {
    var pageUrl = GB_BASE + '/music/' + musicId;
    var r = await gbGetHtml(pageUrl, null);
    var cookie = gbExtractCookie(r);
    var playId = gbExtractPlayId(r.data);
    if (!playId) throw new Error('歌曲宝无法解析播放令牌（页面结构可能已变更）');
    var r2 = await axios.post(GB_BASE + '/member/common-play-url', 'id=' + encodeURIComponent(playId), {
      headers: { 'User-Agent': GB_UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': pageUrl, 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/javascript, */*', 'Cookie': cookie },
      timeout: KG_SRC_TIMEOUT,
      validateStatus: function () { return true; },
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

  // ===================== AAX音乐网(aax.cx) 备用源（第③层） =====================
  // 酷我系聚合站，与 mvmp3/gequbao 同期接入；GET base/ 见人机验证页 → 取 csrf → POST base/ 提交 human_check；
  // 搜索 base/so/<kw>.html；取链 POST base/js/play.php(id&type=music) → JSON.url（端点实测无需验证）。
  var AAX_BASE = 'https://www.aax.cx';
  var AAX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  var _aaxCookie = null, _aaxCookieAt = 0, _aaxCookieUser = false;
  var AAX_COOKIE_TTL = 50 * 60 * 1000; // 50 分钟（站点会话约 1 小时，留余量）
  async function aaxAutoVerify() {
    var r1 = await axios.get(AAX_BASE + '/', { headers: { 'User-Agent': AAX_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, timeout: KG_SRC_TIMEOUT, validateStatus: function () { return true; } });
    var setCk = (r1.headers && r1.headers['set-cookie']) || [];
    var jar = {};
    setCk.forEach(function (c) { var i = c.indexOf('='); if (i > 0) jar[c.slice(0, i).trim()] = c.split(';')[0].split('=').slice(1).join('=').trim(); });
    var ck = Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
    if (!ck) throw new Error('AAX音乐网：无法建立会话');
    if (aaxIsVerify(r1.data)) return ck;
    var m = (r1.data || '').match(/name="csrf_token" value="([^"]+)"/);
    var csrf = m ? m[1] : '';
    await axios.post(AAX_BASE + '/', 'csrf_token=' + encodeURIComponent(csrf) + '&human_check=on', {
      headers: { 'User-Agent': AAX_UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: AAX_BASE + '/', Cookie: ck },
      timeout: KG_SRC_TIMEOUT, maxRedirects: 5, validateStatus: function () { return true; },
    });
    return ck;
  }
  async function ensureAaxCookie(forceAuto) {
    var now = Date.now();
    if (!forceAuto && _aaxCookie && (now - _aaxCookieAt) < AAX_COOKIE_TTL) return _aaxCookie;
    var userCk = normCookie(getVars().aax_cookie);
    if (userCk && !forceAuto) { _aaxCookie = userCk; _aaxCookieAt = now; _aaxCookieUser = true; return _aaxCookie; }
    var fresh = await aaxAutoVerify();
    _aaxCookie = fresh; _aaxCookieAt = now; _aaxCookieUser = false; return fresh;
  }
  function aaxIsVerify(html) { return /安全人机验证|我不是人机|verifyForm/.test(html || ''); }
  function aaxParseItems(html) {
    if (!html || typeof html !== 'string') return [];
    var items = [], seen = {};
    var re = /<a\s+href="\/s\/([0-9a-f]{32})\.html"[^>]*\btitle="([^"]*)"[\s\S]*?(?:class="playtime">([^<]*)<|<\/li>)/gi;
    var m;
    while ((m = re.exec(html))) {
      var id = m[1]; if (seen[id]) continue; seen[id] = 1;
      var raw = m[2] || '', title = raw, artist = '';
      var idx = raw.indexOf(' - ');
      if (idx > 0) { artist = raw.substring(0, idx).trim(); title = raw.substring(idx + 3).trim(); }
      artist = artist.replace(/^[【\[]+|[】\]]+$/g, '').trim();
      title = title.replace(/^[【\[]+|[】\]]+$/g, '').trim();
      var dur; var tm = (m[3] || '').match(/(\d{1,2}):(\d{2})/); if (tm) dur = (parseInt(tm[1], 10) * 60 + parseInt(tm[2], 10)) * 1000;
      if (title) items.push({ id: id, title: title, artist: artist, duration: dur });
    }
    return items;
  }
  async function aaxPlayUrl(hash, cookie) {
    var r = await axios.post(AAX_BASE + '/js/play.php', 'id=' + hash + '&type=music', {
      headers: { 'User-Agent': AAX_UA, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', Referer: AAX_BASE + '/s/' + hash + '.html', Cookie: cookie },
      timeout: KG_SRC_TIMEOUT, validateStatus: function () { return true; },
    });
    return r.data;
  }
  async function aaxSearch(keyword, cookie) {
    var r = await axios.get(AAX_BASE + '/so/' + encodeURIComponent(keyword || '') + '.html', {
      headers: { 'User-Agent': AAX_UA, 'Accept-Language': 'zh-CN,zh;q=0.9', Cookie: cookie },
      timeout: KG_SRC_TIMEOUT, validateStatus: function () { return true; },
    });
    if (aaxIsVerify(r.data)) throw new Error('AAX音乐网自动过验证失败（可能已升级为需手动验证），跳过该源');
    return aaxParseItems(r.data);
  }
  async function aaxGetMediaSource(musicItem) {
    var kw = (musicItem.title || '').trim() || (musicItem.artist || '').trim();
    if (!kw) throw new Error('歌曲标题为空，无法在AAX音乐网检索');
    var cookie = await ensureAaxCookie();
    var items;
    try { items = await aaxSearch(kw, cookie); }
    catch (e) { if (_aaxCookieUser && /验证/.test(e.message)) { _aaxCookie = null; _aaxCookieUser = false; cookie = await ensureAaxCookie(); items = await aaxSearch(kw, cookie); } else throw e; }
    if (!items.length) throw new Error('AAX音乐网未找到：' + kw);
    var ordered = pickOrdered(items, musicItem);
    if (!ordered) throw new Error('AAX音乐网候选均未通过身份校验（歌名或歌手不符），已拒绝错播并回退下一层');
    var lastErr = '';
    for (var i = 0; i < Math.min(ordered.length, 5); i++) {
      try { var d = await aaxPlayUrl(ordered[i].id, cookie); if (d && d.url) return { url: d.url, rawLrc: d.lrc || '', artwork: d.pic || '' }; lastErr = d && d.msg ? String(d.msg) : '空链接'; } catch (e) { lastErr = e.message; }
    }
    throw new Error('AAX音乐网可取链候选均已下架/不可播放（' + (lastErr || '无可用链接') + '）');
  }
  async function aaxGetLyric(musicItem) {
    var kw = (musicItem.title || '').trim() || (musicItem.artist || '').trim();
    if (!kw) return { rawLrc: '' };
    var cookie; try { cookie = await ensureAaxCookie(); } catch (e) { return { rawLrc: '' }; }
    var items; try { items = await aaxSearch(kw, cookie); } catch (e) { return { rawLrc: '' }; }
    if (!items.length) return { rawLrc: '' };
    var ordered = pickOrdered(items, musicItem);
    if (!ordered) return { rawLrc: '' };
    for (var i = 0; i < Math.min(ordered.length, 3); i++) {
      try { var d = await aaxPlayUrl(ordered[i].id, cookie); if (d && d.lrc) return { rawLrc: d.lrc }; } catch (e) {}
    }
    return { rawLrc: '' };
  }

  // ============================ 四层组合取链 / 歌词（酷狗 → mvmp3 → gequbao → aax） ============================
  // 【v0.1.0 第三批】酷狗官方取链软熔断：官方 play/getdata 对大量歌曲返回空，空返回不进排序但徒增无谓请求；
  //   连续空返回/异常 5 次后熔断，跳过官方直走备用源；熔断状态可读（_internal.kgOfficialFuse）可重置（_internal.kgOfficialFuseReset）。
  var KG_OFFICIAL_FUSE_STREAK = 0;   // 连续空返回/异常计数
  var KG_OFFICIAL_FUSE_LIMIT = 5;    // 熔断阈值（可调）
  var KG_OFFICIAL_FUSED = false;     // 是否已熔断
  var KG_OFFICIAL_FUSE_AT = 0;       // 熔断时间戳

  async function getMediaSource(musicItem, quality) {
    var errors = [];

    // 1) 酷狗官方（软熔断：连续空返回 5 次后跳过，直走备用源）
    if (KG_OFFICIAL_FUSED) {
      errors.push('酷狗官方:已软熔断(跳过)');
    } else {
      try {
        const kg = await kugouGetMediaSource(musicItem);
        if (kg && kg.url && /^https?:\/\//i.test(kg.url)) {
          KG_OFFICIAL_FUSE_STREAK = 0;   // 取得有效直链 → 复位连续空计数
          try {
            const head = await axios.head(kg.url, { timeout: 4000, validateStatus: function () { return true; } });
            const ct = (head.headers && head.headers['content-type']) || '';
            const ok = head.status >= 200 && head.status < 400 && /audio|mp4|octet|mpeg/i.test(ct || 'audio');
            if (ok) return { url: kg.url, rawLrc: kg.rawLrc, artwork: kg.artwork, headers: { Referer: 'https://www.kugou.com/' } };
          } catch (e) {
            return { url: kg.url, rawLrc: kg.rawLrc, artwork: kg.artwork, headers: { Referer: 'https://www.kugou.com/' } };
          }
        } else {
          KG_OFFICIAL_FUSE_STREAK++;
          if (KG_OFFICIAL_FUSE_STREAK >= KG_OFFICIAL_FUSE_LIMIT && !KG_OFFICIAL_FUSED) {
            KG_OFFICIAL_FUSED = true; KG_OFFICIAL_FUSE_AT = Date.now();
            console.warn('[kg 软熔断] 酷狗官方连续 ' + KG_OFFICIAL_FUSE_STREAK + ' 次空返回，已熔断（后续跳过官方直走备用源）。重置：_internal.kgOfficialFuseReset()');
          }
        }
      } catch (e) {
        KG_OFFICIAL_FUSE_STREAK++;
        if (KG_OFFICIAL_FUSE_STREAK >= KG_OFFICIAL_FUSE_LIMIT && !KG_OFFICIAL_FUSED) {
          KG_OFFICIAL_FUSED = true; KG_OFFICIAL_FUSE_AT = Date.now();
          console.warn('[kg 软熔断] 酷狗官方连续 ' + KG_OFFICIAL_FUSE_STREAK + ' 次异常，已熔断。重置：_internal.kgOfficialFuseReset()');
        }
        errors.push('酷狗官方:' + e.message);
      }
    }

    // 2) 无名音乐网 mvmp3（不带 Referer 返回，否则 kuwo CDN 403）
    try {
      const src = await mvGetMediaSource(musicItem);
      if (src && src.url) return src;
    } catch (e) { errors.push('无名音乐网:' + e.message); }

    // 3) 歌曲宝 gequbao（无需每小时验证，作为 mvmp3 Cookie 过期时的兜底）
    //    按“歌名”搜索（组合“歌名 歌手”在歌曲宝会返回 0 结果）；结果经三态校验 + matchScore 择优。
    try {
      const q = (musicItem.title || '').trim();
      const g = await gbSearch(q);
      const ordered = pickOrdered(g, musicItem);
      if (ordered && ordered.length) {
        const url = await gbGetPlayUrl(ordered[0].id);
        if (url) return { url: url, rawLrc: '', artwork: musicItem.coverImg || musicItem.artwork || '' };
      }
    } catch (e) { errors.push('歌曲宝:' + e.message); }

    // 4) AAX音乐网 aax.cx（第③备用源，酷我系直链，作为 gequbao 之后的最后兜底）
    try {
      const src = await aaxGetMediaSource(musicItem);
      if (src && src.url) return src;
    } catch (e) { errors.push('AAX音乐网:' + e.message); }

    var songName = (musicItem.title || '') + (musicItem.artist ? '（' + musicItem.artist + '）' : '');
    var msg = '酷狗、无名音乐网、歌曲宝、AAX音乐网四层均未能取得《' + songName + '》的音源。';
    msg += '①酷狗官方接口已无免费直链（已软熔断跳过）；②无名音乐网取链失败（详见上）；③歌曲宝曲库未收录该版本（多为翻唱）；④AAX音乐网同样未收录。';
    msg += '若你确定该曲在无名音乐网有原唱，通常是其人机验证临时升级导致自动过验证失败，稍后重试即可。';
    msg += '。明细：' + errors.join('；');
    throw new Error(msg);
  }

  async function getLyric(musicItem) {
    try { const kg = await kugouGetMediaSource(musicItem); if (kg && kg.rawLrc) return { rawLrc: kg.rawLrc }; } catch (e) {}
    try { const l = await mvGetLyric(musicItem); if (l && l.rawLrc) return l; } catch (e) {}
    try {
      const q = (musicItem.title || '').trim();
      const g = await gbSearch(q);
      const ordered = pickOrdered(g, musicItem);
      if (ordered && ordered.length) {
        const l = await gbGetLyric(ordered[0].id);
        if (l && l.rawLrc) return l;
      }
    } catch (e) {}
    try {
      const l = await aaxGetLyric(musicItem); if (l && l.rawLrc) return l;
    } catch (e) {}
    return { rawLrc: '' };
  }

  // ===================== 酷狗官方【排行榜】+【热门榜单】 =====================
  function fixImg(url) {
    if (!url) return '';
    return String(url).replace(/\{size\}/g, '400');
  }

  // 酷狗官方 55 个榜单中，按“热度/收藏”语义精选出的【热门榜单】代表（id 见 rank/list）。
  // 说明：酷狗公开 rank 接口并未直接暴露“历史播放最多/今日推荐”这三个中文标签的专属榜单，
  // 故“历史收藏最多”精确对应“百万收藏榜”，其余以最贴近的官方高热度榜单代表。
  var HOT_RANK_IDS = ['85432', '6666', '82831', '52144', '74534', '8888', '35811', '52767'];

  // rank/list 中每个榜单带 classify 类别码（实测分布 1~5）。对标酷我 getTopLists 的
  // 分层分组（disname），将 55 个官方榜单按类别归并为 5 个有意义的中文分组。
  var KG_RANK_GROUP = {
    '1': '热歌榜',
    '2': '地区榜',
    '3': '特色榜',
    '4': '全球榜',
    '5': '曲风榜',
  };

  async function getTopLists() {
    var res = await axios.get('https://m.kugou.com/rank/list?json=true', {
      headers: KG_M_HEADERS, timeout: 9000, validateStatus: function () { return true; },
    });
    var data = res.data;
    var list = (data && data.rank && data.rank.list) || [];
    var byId = {};
    list.forEach(function (it) { byId[String(it.rankid)] = it; });

    // 组一：酷狗官方·各类排行榜单（按 classify 分层归组，对标酷我 hierarchical 分组）
    var grouped = {}; // groupTitle -> [items]
    list.forEach(function (it) {
      var g = KG_RANK_GROUP[String(it.classify)] || '其他榜';
      (grouped[g] = grouped[g] || []).push({
        id: String(it.rankid),
        title: it.rankname,
        description: (it.intro || '').replace(/\r|\n/g, ' ').trim(),
        artwork: fixImg(it.imgurl),
        playCount: it.play_times,
      });
    });
    // 固定顺序输出分组，保证 UI 稳定
    var groupOrder = ['热歌榜', '地区榜', '特色榜', '全球榜', '曲风榜', '其他榜'];
    var official = groupOrder.filter(function (g) { return grouped[g]; }).map(function (g) {
      return { title: g, data: grouped[g] };
    });

    // 组二：热门榜单（精选高热度榜）
    var hot = HOT_RANK_IDS.filter(function (id) { return byId[id]; }).map(function (id) {
      var it = byId[id];
      var title = it.rankname;
      if (id === '85432') title = '百万收藏榜（历史收藏最多）';
      else if (id === '82831') title = '网络热歌榜（历史播放最多）';
      else if (id === '74534') title = '新歌榜（今日推荐）';
      return {
        id: String(it.rankid),
        title: title,
        description: (it.intro || '').replace(/\r|\n/g, ' ').trim(),
        artwork: fixImg(it.imgurl),
      };
    });

    return official.concat([{ title: '热门榜单', data: hot }]);
  }

  async function getTopListDetail(topListItem, page) {
    var rankid = topListItem.id;
    var cur = page || 1;
    var res = await axios.get('https://m.kugou.com/rank/info/', {
      params: { rankid: rankid, page: cur, json: true },
      headers: KG_M_HEADERS, timeout: 9000, validateStatus: function () { return true; },
    });
    var data = res.data;
    var wrap = (data && data.songs) || {};
    var arr = wrap.list || [];
    var items = arr.map(function (s) {
      var fn = s.filename || s.songname || '';
      var parts = fn.split(' - ');
      var artist = parts.length > 1 ? parts[0].trim() : (s.h5_author_name || s.singername || '');
      var title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : fn;
      return {
        id: s.hash,
        title: title || s.songname || '',
        artist: artist,
        album: s.album_name,
        album_id: s.album_id,
        album_audio_id: s.album_audio_id,
      };
    }).filter(function (x) { return x.id; });

    var total = wrap.total || 0;
    var ps = wrap.pagesize || 30;
    var isEnd = cur * ps >= total;
    return { isEnd: isEnd, musicList: items, topListItem: topListItem };
  }

  // ===================== 酷狗官方【歌单导入】 =====================
  // 现代酷狗歌单链接形如：
  //   https://www.kugou.com/songlist/gcid_3zjy761gz1maz03e/
  //   https://www.kugou.com/songlist/123456.html
  //   也可能含 specialid=xxx 参数或纯数字。
  function parseKugouSheetId(urlLike) {
    if (!urlLike) return null;
    var s = String(urlLike).trim();
    var m;
    if ((m = s.match(/gcid_[a-z0-9]+/i))) return m[0];
    if ((m = s.match(/\/songlist\/(\d+)/i))) return m[1];
    if ((m = s.match(/specialid=([^&\s"'<>]+)/i))) return decodeURIComponent(m[1].trim());
    if ((m = s.match(/^(\d{4,12})$/))) return m[1];
    return null;
  }

  function kgSheetItemToMusic(it) {
    var hash = it.hash || it.HASH || '';
    var fn = (it.filename || it.songname || '').replace(/\.mp3$/i, '').trim();
    var parts = fn.split(' - ');
    var artist = parts.length > 1 ? parts[0].trim() : (it.singername || '');
    var title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : fn;
    return {
      id: hash,
      title: title || it.songname || '',
      artist: artist,
      album: it.album_name,
      album_id: it.album_id,
      album_audio_id: it.album_audio_id,
    };
  }

  // v0.0.9 修复：原 wwwapi.kugou.com/yy/index.php?r=play/get_songlist 在用户设备端取歌空白
  // （该域在部分网络环境下受限，且需配合签名/Referer，返回结构不稳定）。
  // 现改用与歌单列表同源、已验证可达的【mobilecdn 歌单歌曲 JSON 接口】
  //   GET http://mobilecdn.kugou.com/api/v3/special/song
  //       ?version=9108&specialid={id}&page={n}&pagesize=100&plat=0&area_code=1&with_res_tag=0
  // 返回：{ status:1, data:{ total, info:[ { hash, filename, songname, singername,
  //          album_name, album_id, album_audio_id, duration, "320hash", sqhash, origin_hash } ] } }
  // 该接口为正在运行的 MusicFree 酷狗插件（kg.js）标准实现，设备端稳定可用。
  async function kgGetSheetSongs(specialid, page) {
    var res = await axios.get('http://mobilecdn.kugou.com/api/v3/special/song', {
      params: {
        version: 9108,
        specialid: specialid,
        page: page || 1,
        pagesize: 100,
        plat: 0,
        area_code: 1,
        with_res_tag: 0,
      },
      headers: KG_M_HEADERS,
      timeout: 9000,
      validateStatus: function () { return true; },
    });
    var d = res.data;
    if (!d || d.status !== 1 || !d.data) {
      throw new Error('酷狗歌单接口未返回有效数据（可能网络限制或歌单已失效），请确认后重试');
    }
    var data = d.data;
    var info = data.info || [];
    var total = data.total || 0;
    return { info: info, total: total, pagesize: 100 };
  }

  async function importMusicSheet(urlLike) {
    var sid = parseKugouSheetId(urlLike);
    if (!sid) {
      throw new Error('无法识别酷狗歌单链接。请粘贴形如 https://www.kugou.com/songlist/gcid_xxx/ 或 /songlist/12345.html 的链接');
    }
    var r = await kgGetSheetSongs(sid, 1);
    if (!r.info.length) {
      throw new Error('该酷狗歌单暂无可导入歌曲（可能已失效，或接口临时限制，请稍后重试）');
    }
    return r.info.map(kgSheetItemToMusic).filter(function (x) { return x.id; });
  }

  async function getMusicSheetInfo(sheetItem, page) {
    var sid = sheetItem && (sheetItem.id || sheetItem);
    if (typeof sid === 'string' && sid.indexOf('id_') === 0) sid = sid.slice(3);
    if (!sid) throw new Error('歌单标识缺失，无法获取详情');
    var cur = page || 1;
    var r = await kgGetSheetSongs(sid, cur);
    return {
      isEnd: cur * 100 >= r.total,
      musicList: r.info.map(kgSheetItemToMusic).filter(function (x) { return x.id; }),
      sheetItem: sheetItem,
    };
  }

  // ===================== 酷狗官方【热门歌单广场】 =====================
  // 对标酷我 getRecommendSheetTags / getRecommendSheetsByTag：在 MusicFree“歌单”Tab
  // 提供“分类标签 → 该分类下的歌单列表”的浏览能力。
  //
  // 实现说明（v0.0.8 修正）：原 v0.0.7 抓取 www.kugou.com 搜索页（SPA）用 cheerio 解析，
  // 因结果由 JS 异步渲染、初始 HTML 不含歌单卡片，导致设备端所有分类空白。
  // 现改用酷狗官方【mobilecdn 歌单搜索 JSON 接口】
  //   GET http://mobilecdn.kugou.com/api/v3/search/special
  // 该接口无需签名、直接返回 data.info[]（specialid/specialname/imgurl/playcount 等），
  // 与主流 MusicFree 酷狗插件一致，已在开发沙箱实网验证通过。
  //   1) getRecommendSheetTags 返回【静态分类目录】（网络无关，菜单永远可渲染），
  //      结构对标酷我（多分组 groups + 置顶 pinned）；
  //   2) getRecommendSheetsByTag 按标签 keyword 调用 mobilecdn 接口取歌单列表。

  // 酷狗歌单(专辑)搜索 JSON 接口（mobilecdn，无需签名，与主流 MusicFree 酷狗插件一致）。
  // 返回：{ data: { total, info: [ { specialid, specialname, imgurl, playcount,
  //          nickname, intro, songcount, publishtime } ] } }
  var KG_SHEET_SEARCH = 'http://mobilecdn.kugou.com/api/v3/search/special';

  // 将 mobilecdn 歌单条目映射为 MusicFree IMusicSheetItem
  function kgSpecialItemToSheet(it) {
    if (!it) return null;
    var img = (it.imgurl || '').replace(/\{size\}/g, '400');
    return {
      id: String(it.specialid),
      title: it.specialname || '未命名歌单',
      artist: it.nickname || '',
      description: it.intro || '',
      artwork: img,
      playCount: it.playcount || 0,
      worksNum: it.songcount || 0,
      createAt: it.publishtime ? String(it.publishtime).slice(0, 10) : '',
    };
  }

  // 静态分类目录（网络无关）。每个 tag 带 keyword 用于歌单搜索；pinned 为置顶精选。
  var KG_SHEET_TAGS = {
    data: [
      { title: '风格', data: [
        { id: 'pop', title: '流行', keyword: '流行' },
        { id: 'rock', title: '摇滚', keyword: '摇滚' },
        { id: 'folk', title: '民谣', keyword: '民谣' },
        { id: 'electronic', title: '电子', keyword: '电音' },
        { id: 'rap', title: '说唱', keyword: '说唱' },
        { id: 'rnb', title: 'R&B', keyword: 'R&B' },
        { id: 'classical', title: '古典', keyword: '古典' },
        { id: 'acg', title: 'ACG', keyword: 'ACG' },
        { id: 'pure', title: '纯音乐', keyword: '纯音乐' },
      ] },
      { title: '场景', data: [
        { id: 'work', title: '工作', keyword: '工作' },
        { id: 'study', title: '学习', keyword: '学习' },
        { id: 'sleep', title: '睡眠', keyword: '睡眠' },
        { id: 'drive', title: '开车', keyword: '开车' },
        { id: 'sport', title: '运动', keyword: '运动' },
        { id: 'party', title: '派对', keyword: '派对' },
        { id: 'travel', title: '旅行', keyword: '旅行' },
      ] },
      { title: '语种', data: [
        { id: 'chinese', title: '华语', keyword: '华语' },
        { id: 'europe', title: '欧美', keyword: '欧美' },
        { id: 'korea', title: '韩语', keyword: '韩语' },
        { id: 'japan', title: '日语', keyword: '日语' },
        { id: 'cantonese', title: '粤语', keyword: '粤语' },
        { id: 'minority', title: '小语种', keyword: '小语种' },
      ] },
      { title: '心情', data: [
        { id: 'heal', title: '治愈', keyword: '治愈' },
        { id: 'sad', title: '伤感', keyword: '伤感' },
        { id: 'happy', title: '快乐', keyword: '快乐' },
        { id: 'miss', title: '怀旧', keyword: '怀旧' },
        { id: 'motivational', title: '励志', keyword: '励志' },
        { id: 'relax', title: '放松', keyword: '放松' },
      ] },
    ],
    pinned: [
      { id: 'hot', title: '热门歌单', keyword: '热门' },
      { id: 'new', title: '最新歌单', keyword: '最新' },
      { id: 'collect', title: '收藏最多', keyword: '收藏' },
    ],
  };

  async function getRecommendSheetTags() {
    return KG_SHEET_TAGS;
  }

  async function getRecommendSheetsByTag(tag, page) {
    var keyword = (tag && (tag.keyword || tag.title)) || '';
    if (!keyword) return { isEnd: true, data: [] };
    var cur = page || 1;
    var ps = 30;
    var res = await axios.get(KG_SHEET_SEARCH, {
      params: { format: 'json', keyword: keyword, page: cur, pagesize: ps, showtype: 1 },
      headers: KG_M_HEADERS, timeout: 9000,
      validateStatus: function () { return true; },
    });
    var d = res.data && res.data.data;
    if (!d || !Array.isArray(d.info)) {
      // 接口异常时抛错，由 MusicFree 提示，避免无声空白
      throw new Error('酷狗歌单广场接口返回异常（keyword=' + keyword + '），请稍后重试');
    }
    var items = d.info.map(kgSpecialItemToSheet).filter(function (x) { return x; });
    var total = d.total || 0;
    return {
      isEnd: cur * ps >= total || items.length < ps,
      data: items,
    };
  }

  // ============================ 导出 ============================
  var plugin = {
    platform: '酷狗',
    version: '0.1.0',
    author: 'tianpeng + 优化(下沉 qq.js v0.1.8 三态校验)',
    description: '酷狗官方 + 无名音乐网(mvmp3，自动过人机验证) + 歌曲宝(gequbao) + AAX音乐网(aax.cx) 四层兜底取链；' +
      'v0.1.0：下沉 qq.js v0.1.8 三态身份校验修复「同名异版错播」、新增第③备用源 AAX音乐网(三层→四层)、' +
      '酷狗官方取链软熔断(连续空返回5次跳过)、取链质量打分(matchScore择优)；' +
      '支持酷狗歌单导入、官方排行榜（按热歌/地区/特色/全球/曲风分层）与热门榜单；' +
      '热门歌单广场（分类标签浏览酷狗歌单）。' +
      'v0.0.9 修复：歌单详情/导入取歌改用 mobilecdn special/song JSON 接口，解决点进歌单歌曲空白。' +
      '⚠️ 仅供个人学习与研究使用。',
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@v0.1.0/musicfree-kg/kg.js',
    cacheControl: 'no-store',
    supportedSearchType: ['music'],
    primaryKey: ['id', 'album_id', 'album_audio_id'],
    userVariables: [
      {
        key: 'mvmp3_cookie',
        name: '无名音乐网 Cookie (PHPSESSID)（可选）',
        hint: '通常【无需填写】。插件会自动完成“我不是人机”验证并缓存 50 分钟。'
            + '仅当你想固定使用自己浏览器会话时才填：仅填 PHPSESSID 的值或完整 “PHPSESSID=值” 均可。'
            + '留空即可全自动使用无名音乐网高质量音源。',
      },
      {
        key: 'aax_cookie',
        name: 'AAX音乐网 Cookie (PHPSESSID)（可选）',
        hint: '通常【无需填写】。AAX音乐网(aax.cx)的人机验证由插件自动完成并缓存 50 分钟。'
            + '仅当你想固定使用自己浏览器会话时才填：仅填 PHPSESSID 的值或完整 “PHPSESSID=值” 均可。'
            + '留空即可全自动使用 AAX音乐网备用音源。',
      },
    ],
    hints: {
      getMediaSource: [
        '取链顺序：酷狗官方 → 无名音乐网(mvmp3) → 歌曲宝(gequbao) → AAX音乐网(aax.cx) 四层兜底，任一层成功即用。',
        '无名音乐网(mvmp3)与 AAX音乐网(aax.cx)的人机验证由插件自动完成，无需你手动操作；会话约 50 分钟自动刷新一次。',
        '酷狗官方接口对大量歌曲已无免费直链，连续 5 次空返回会自动软熔断并跳过官方，直走备用源（重启或 _internal.kgOfficialFuseReset() 可重置）。',
      ],
      importMusicSheet: [
        '支持粘贴酷狗歌单链接导入，例如：',
        'https://www.kugou.com/songlist/gcid_3zjy761gz1maz03e/',
        'https://www.kugou.com/songlist/123456.html',
      ],
      getTopLists: [
        '“排行榜”按热歌/地区/特色/全球/曲风分层归组（对标酷我分层分组）；“热门榜单”精选历史收藏最多、历史播放最多、今日推荐等高热度榜。',
      ],
      getRecommendSheetTags: [
        '“歌单”Tab 提供酷狗歌单广场：按风格/场景/语种/心情等分类标签浏览歌单。',
        '标签目录为内置静态分类（始终可用）；点击标签后按关键词调用酷狗 mobilecdn 歌单搜索接口返回结果。',
      ],
      getMusicSheetInfo: [
        '点进歌单后，歌曲列表由酷狗 mobilecdn special/song 接口实时获取（与歌单广场同源，稳定可用）。',
      ],
    },
    async search(query, page, type) {
      if (type === 'music') return await searchMusic(query, page);
      return { isEnd: true, data: [] };
    },
    getMediaSource: getMediaSource,
    getLyric: getLyric,
    // 新增：酷狗歌单导入
    importMusicSheet: importMusicSheet,
    getMusicSheetInfo: getMusicSheetInfo,
    // 新增：排行榜 + 热门榜单
    getTopLists: getTopLists,
    getTopListDetail: getTopListDetail,
    // 新增：热门歌单广场（对标酷我 getRecommendSheetTags / getRecommendSheetsByTag）
    getRecommendSheetTags: getRecommendSheetTags,
    getRecommendSheetsByTag: getRecommendSheetsByTag,
    // ============================ v0.1.0 内部诊断接口（仅供测试 / 运维，不影响取链） ============================
    _internal: {
      // 第一批 + 第四批：三态身份校验 / 统一选池 / 取链打分
      norm: norm,
      titleOk: titleOk,
      artistState: artistState,
      durState: durState,
      isGoodMatch: isGoodMatch,
      isSafeCandidate: isSafeCandidate,
      matchScore: matchScore,
      pickOrdered: pickOrdered,
      scoreLog: function () { return _kgScoreLog.slice(); },
      scoreLogClear: function () { _kgScoreLog.length = 0; },
      // 第三批：酷狗官方软熔断
      kgOfficialFuse: function () { return { fused: KG_OFFICIAL_FUSED, streak: KG_OFFICIAL_FUSE_STREAK, limit: KG_OFFICIAL_FUSE_LIMIT, at: KG_OFFICIAL_FUSE_AT }; },
      kgOfficialFuseReset: function () { KG_OFFICIAL_FUSED = false; KG_OFFICIAL_FUSE_STREAK = 0; KG_OFFICIAL_FUSE_AT = 0; },
      // 第二批：AAX音乐网会话预热 / 状态
      aaxEnsureCookie: function () { return ensureAaxCookie(); },
    },
  };

  if (typeof module !== 'undefined' && module && module.exports) module.exports = plugin;
  if (typeof exports !== 'undefined') exports.default = plugin;
  return plugin;
})();
