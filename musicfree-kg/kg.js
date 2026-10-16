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
  var cheerio = reqFn('cheerio');   // 新增内联备选源（gequhai/gequke/fengli/liusheng/小蜜蜂/音微）HTML 解析用

  // 安全 JSON 解析（字符串→对象；已对象则原样返回；解析失败返回 {}）—— 新增备选源统一复用
  function toObj(x) {
    if (typeof x === 'string') { try { return JSON.parse(x); } catch (e) { return {}; } }
    return x || {};
  }

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
    var $ = cheerio.load(html);
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
    // 新站结构：play_id 以 JSON 转义形式内嵌于页面（"play_id\u0022:\u0022eyJ..."），旧 window.appData 已失效
    var m = html.match(/play_id\\u0022:\\u0022(eyJ[A-Za-z0-9+/=]+)/);
    if (!m) return null;
    return m[1];
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
    var r2 = await axios.post(GB_BASE + '/member/common-play-url', 'id=' + encodeURIComponent(playId) + '&purpose=play', {
      headers: { 'User-Agent': GB_UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': pageUrl, 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/javascript, */*', 'Cookie': cookie },
      timeout: KG_SRC_TIMEOUT,
      validateStatus: function () { return true; },
    });
    var d = r2.data;
    if (d && d.code === 1 && d.data && d.data.url) return gbForceHttps(d.data.url);
    throw new Error('歌曲宝取链失败：' + (d && d.msg ? d.msg : JSON.stringify(d)));
  }
  async function gbSearch(keyword) {
    var r = await gbGetHtml(GB_BASE + '/search-fallback?keyword=' + encodeURIComponent(keyword || ''), null);
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

  // ===================== 新增内联备选源（第三批：扩酷我系 + 补网易系/聚合深兜底） =====================
  // 移植自 muscifree-other 各 standalone 插件与 wy/kw.js，统一改用 axios + cheerio（与 kg 现有 mv/gequbao 一致，可走测试 stub、生产亦可用），
  // 全部经 pickOrdered 身份校验防错播。kg 内容为酷狗、备选为同名替身（与现有 mvmp3/gequbao 同源逻辑一致，可接受）。
  // 链序：官方(软熔断) → mvmp3② → 歌曲宝③ → 酷我系5(歌曲海/歌曲客/凤梨/溜声/无忧)④-⑧ → 网易系4(GD/MyFree/我要下歌/音乐搜索神器)⑨-⑫ → 独立站2(小蜜蜂/音微)⑬ → aax⑭末位。
  // aax 退化（本轮 0 结果）置极端末位 ⑭，不阻断播放。

  // ---- 酷我系：无忧音乐网 qeecc.com（自动过验证，酷我 CDN 直链）----
  var QE_BASE = 'https://www.qeecc.com', QE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  var _qeCk = null, _qeAt = 0;
  function qeIsVerify(h) { return /安全人机验证|我不是人机|verifyForm/.test(h || ''); }
  function qeParse(html) {
    var items = [], seen = {};
    var re = /<a\s+href="\/song\/([A-Za-z0-9_\-]+)\.html"[^>]*>([^<]*)<\/a>/gi, m;
    while ((m = re.exec(html))) {
      var id = m[1]; if (seen[id]) continue; seen[id] = 1;
      var txt = (m[2] || '').replace(/&nbsp;/g, ' ').replace(/\s*\[[^\]]*\]\s*$/, '').trim();
      var artist = '', title = txt;
      var mm = txt.match(/^([\s\S]*?)《([\s\S]*?)》\s*$/);
      if (mm) { artist = mm[1].trim(); title = mm[2].trim(); }
      else { var idx = txt.indexOf(' - '); if (idx > 0) { artist = txt.slice(0, idx).trim(); title = txt.slice(idx + 3).trim(); } }
      if (title) items.push({ id: id, title: title, artist: artist });
    }
    return items;
  }
  async function qeAutoVerify() {
    var r1 = await axios.get(QE_BASE + '/', { headers: { 'User-Agent': QE_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; } });
    var sc = (r1.headers && r1.headers['set-cookie']) || ''; var jar = {};
    String(sc).split(',').forEach(function (c) { var i = c.indexOf('='); if (i > 0) jar[c.slice(0, i).trim()] = c.split(';')[0].split('=').slice(1).join('=').trim(); });
    var ck = Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
    if (!ck) throw new Error('无忧音乐网：无法建立会话');
    var html = r1.data || ''; if (!qeIsVerify(html)) return ck;
    var m = html.match(/name="csrf_token" value="([^"]+)"/); var csrf = m ? m[1] : '';
    await axios.post(QE_BASE + '/', 'csrf_token=' + encodeURIComponent(csrf) + '&human_check=on', { headers: { 'User-Agent': QE_UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': QE_BASE + '/', 'Cookie': ck }, timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; } });
    return ck;
  }
  async function qeCookie(force) { var now = Date.now(); if (!force && _qeCk && (now - _qeAt) < 50 * 60 * 1000) return _qeCk; var f = await qeAutoVerify(); _qeCk = f; _qeAt = now; return f; }
  async function qeSearch(kw) {
    var ck = await qeCookie(false);
    var r = await axios.get(QE_BASE + '/so/' + encodeURIComponent(kw || '') + '.html', { headers: { 'User-Agent': QE_UA, 'Accept-Language': 'zh-CN,zh;q=0.9', 'Cookie': ck }, timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; } });
    return qeParse(r.data || '');
  }
  async function qeUrl(item) {
    var ck = await qeCookie(false);
    var r = await axios.post(QE_BASE + '/js/play.php', 'id=' + encodeURIComponent(item.id) + '&type=music', { headers: { 'User-Agent': QE_UA, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', 'Referer': QE_BASE + '/song/' + item.id + '.html', 'Cookie': ck }, timeout: 9000, validateStatus: function () { return true; } });
    var t = r.data; var d; try { d = toObj(t); } catch (e) { throw new Error('无忧音乐网：取链非JSON'); }
    if (!d || !d.url) throw new Error('无忧音乐网：无链接' + (d && d.msg ? '（' + d.msg + '）' : ''));
    return { url: d.url, headers: { 'User-Agent': QE_UA } };
  }

  // ---- 酷我系：歌曲海 gequhai.com（play_id + 会话 cookie 取 kuwo 直链）----
  var GH_BASE = 'https://www.gequhai.com', GH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  function ghCookie(sh) { if (!sh) return ''; return String(sh).split(',').map(function (s) { return s.split(';')[0]; }).join('; '); }
  async function ghSearch(kw) {
    var r = await axios.get(GH_BASE + '/search?s=' + encodeURIComponent(kw), { headers: { 'User-Agent': GH_UA }, timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; } });
    var $ = cheerio.load(r.data || ''); var data = [];
    $('a.text-info.font-weight-bold').each(function (i, el) {
      var a = $(el); var href = a.attr('href') || ''; var m = href.match(/\/play\/(\d+)/); if (!m) return;
      var id = m[1], title = a.text().trim(), artist = '未知歌手';
      var tr = a.closest('tr');
      if (tr.length) { var tds = tr.find('td'); var titleTd = a.closest('td'); var idx = tds.index(titleTd); if (idx >= 0 && idx + 1 < tds.length) artist = tds.eq(idx + 1).text().trim() || '未知歌手'; }
      if (title) data.push({ id: id, title: title, artist: artist });
    });
    return data;
  }
  async function ghUrl(item) {
    var dres = await axios.get(GH_BASE + '/play/' + item.id, { headers: { 'User-Agent': GH_UA }, timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; } });
    var text = dres.data || ''; var pm = text.match(/window\.play_id\s*=\s*'([^']+)'/); if (!pm) throw new Error('歌曲海：无play_id');
    var playId = pm[1], cookie = ghCookie(dres.headers && dres.headers['set-cookie']);
    var resp = await axios.post(GH_BASE + '/api/music', 'id=' + encodeURIComponent(playId) + '&type=0', { headers: { 'User-Agent': GH_UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'Http', 'X-Custom-Header': 'Key', 'Referer': GH_BASE + '/play/' + item.id, 'Origin': GH_BASE, 'Accept': 'application/json, text/javascript, */*; q=0.01', 'Cookie': cookie }, timeout: 9000, validateStatus: function () { return true; } });
    var j; try { j = toObj(resp.data); } catch (e) { throw new Error('歌曲海：解析失败'); }
    if (!j || j.code !== 200 || !j.data || !j.data.url) throw new Error('歌曲海：取链失败' + (j ? '(' + j.code + ')' : ''));
    return { url: j.data.url, headers: { 'User-Agent': GH_UA, 'Referer': 'https://www.kuwo.cn/' } };
  }

  // ---- 酷我系：歌曲客 gequke.com（同歌曲海基线，/song/ 路径）----
  var GK_BASE = 'https://www.gequke.com', GK_UA = GH_UA;
  async function gkSearch(kw) {
    var r = await axios.get(GK_BASE + '/search?s=' + encodeURIComponent(kw), { headers: { 'User-Agent': GK_UA }, timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; } });
    var $ = cheerio.load(r.data || ''); var data = [];
    $('a.text-info.font-weight-bold').each(function (i, el) {
      var a = $(el); var href = a.attr('href') || ''; var m = href.match(/\/song\/(\d+)/); if (!m) return;
      var id = m[1], title = a.text().trim(), artist = '未知歌手';
      var tr = a.closest('tr');
      if (tr.length) { var tds = tr.find('td'); var titleTd = a.closest('td'); var idx = tds.index(titleTd); if (idx >= 0 && idx + 1 < tds.length) artist = tds.eq(idx + 1).text().trim() || '未知歌手'; }
      if (title) data.push({ id: id, title: title, artist: artist });
    });
    return data;
  }
  async function gkUrl(item) {
    var dres = await axios.get(GK_BASE + '/song/' + item.id, { headers: { 'User-Agent': GK_UA }, timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; } });
    var text = dres.data || ''; var pm = text.match(/window\.play_id\s*=\s*'([^']+)'/); if (!pm) throw new Error('歌曲客：无play_id');
    var playId = pm[1], cookie = ghCookie(dres.headers && dres.headers['set-cookie']);
    var resp = await axios.post(GK_BASE + '/api/music', 'id=' + encodeURIComponent(playId) + '&type=0', { headers: { 'User-Agent': GK_UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'Http', 'X-Custom-Header': 'Key', 'Referer': GK_BASE + '/song/' + item.id, 'Origin': GK_BASE, 'Accept': 'application/json, text/javascript, */*; q=0.01', 'Cookie': cookie }, timeout: 9000, validateStatus: function () { return true; } });
    var j; try { j = toObj(resp.data); } catch (e) { throw new Error('歌曲客：解析失败'); }
    if (!j || j.code !== 200 || !j.data || !j.data.url) throw new Error('歌曲客：取链失败' + (j ? '(' + j.code + ')' : ''));
    return { url: j.data.url, headers: { 'User-Agent': GK_UA, 'Referer': 'https://www.kuwo.cn/' } };
  }

  // ---- 酷我系：凤梨音乐 flmp3.pro（kuwo CDN 直链）----
  var FL_BASE = 'https://www.flmp3.pro', FL_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  function flReq(url) { return axios.get(url, { headers: { 'User-Agent': FL_UA, 'Referer': FL_BASE + '/', 'X-Requested-With': 'XMLHttpRequest' }, timeout: 10000, validateStatus: function () { return true; } }); }
  async function flSearch(kw) {
    var r = await flReq(FL_BASE + '/search.html?keyword=' + encodeURIComponent(kw) + '&page=1');
    var $ = cheerio.load(r.data || ''); var data = [];
    $('.list ul li').each(function (i, el) {
      var a = $(el).find('a').first(); var href = a.attr('href') || ''; var m = href.match(/\/song\/(\d+)\.html/); if (!m) return;
      var id = m[1], title = a.find('h3').first().text().trim(), artist = a.find('p').first().text().trim();
      if (title) data.push({ id: id, title: title, artist: artist || '未知歌手' });
    });
    return data;
  }
  async function flUrl(item) { var r = await flReq(FL_BASE + '/api/playurl.php?id=' + item.id); var url = String(r.data || '').trim(); if (!/^https?:\/\//.test(url)) throw new Error('凤梨：未解析到直链'); return { url: url, headers: { 'User-Agent': FL_UA, 'Referer': FL_BASE + '/' } }; }

  // ---- 酷我系：溜声音乐 6sing.top（http 站点，kuwo CDN 直链）----
  var LS_BASE = 'http://www.6sing.top', LS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  function lsParseTitle(raw) {
    raw = (raw || '').trim(); if (!raw) return { title: '未知歌曲', artist: '未知歌手' };
    var title = raw, artist = '未知歌手'; var NO = /版|伴奏|演奏|Remix|remix|DJ|flac|mp3/i;
    var pm = raw.match(/[（(]([^）)]*)[）)]/); if (pm && pm[1].length > 0 && pm[1].length <= 5 && !NO.test(pm[1])) artist = pm[1].trim();
    var di = raw.lastIndexOf('-'); if (di >= 0) { var tail = raw.slice(di + 1).trim().replace(/[）)]/g, '').trim(); if (tail && tail.length >= 1 && tail.length <= 10 && !NO.test(tail)) { artist = tail; title = raw.slice(0, di).trim(); } }
    title = title.replace(/[（(][^）)]*[）)]/g, '').trim(); if (!title) title = raw; return { title: title, artist: artist };
  }
  async function lsSearch(kw) {
    var r = await axios.get(LS_BASE + '/search.html?keyword=' + encodeURIComponent(kw), { headers: { 'User-Agent': LS_UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' }, timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; } });
    var $ = cheerio.load(r.data || ''); var data = [];
    $('a[href^="/detail/"]').each(function (i, el) { var a = $(el); var href = a.attr('href') || ''; var m = href.match(/\/detail\/(\d+)\.html/); if (!m) return; var id = m[1]; var p = lsParseTitle(a.attr('title')); data.push({ id: id, title: p.title, artist: p.artist }); });
    return data;
  }
  async function lsUrl(item) {
    var resp = await axios.get(LS_BASE + '/api/play.php?id=' + encodeURIComponent(item.id), { headers: { 'User-Agent': LS_UA, 'Accept': 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', 'Referer': LS_BASE + '/detail/' + item.id + '.html' }, timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; } });
    var j; try { j = toObj(resp.data); } catch (e) { throw new Error('溜声：解析失败'); }
    if (!j || j.code !== '200' || !j.url) throw new Error('溜声：取链失败' + (j ? '(' + j.code + ')' : ''));
    return { url: j.url, headers: { 'User-Agent': LS_UA, 'Referer': 'https://www.kuwo.cn/' } };
  }

  // ---- 网易系：GD音乐台 music-api.gdstudio.xyz（免登录聚合 API，网易云/Joox）----
  var GD_API = 'https://music-api.gdstudio.xyz/api.php?btwaf=99801110';
  var GD_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  var GD_SRCS = ['netease', 'joox'];
  function gdParseItems(raw, src) {
    var d = toObj(raw); if (Object.prototype.toString.call(d) !== '[object Array]') return [];
    var out = [];
    d.forEach(function (it) { if (!it || !it.name || it.id === undefined || it.id === null) return; out.push({ id: src + ':' + String(it.id), title: it.name, artist: (Array.isArray(it.artist) ? it.artist.join('、') : (it.artist || '')), duration: (function (v) { var n = Number(v); if (!isFinite(n) || n <= 0) return undefined; return n < 1000 ? n * 1000 : n; }) }) });
    return out;
  }
  async function gdSearch(kw) {
    var lists = await Promise.all(GD_SRCS.map(function (src) {
      return axios.get(GD_API, { params: { types: 'search', source: src, name: kw, count: 20, pages: 1 }, headers: { 'User-Agent': GD_UA, 'Accept': 'application/json' }, timeout: 10000, validateStatus: function () { return true; } })
        .then(function (r) { return gdParseItems(r.data, src); }).catch(function () { return []; });
    }));
    var merged = [], seen = {};
    lists.forEach(function (arr) { arr.forEach(function (it) { var k = String(it.id); if (seen[k]) return; seen[k] = 1; merged.push(it); }); });
    return merged;
  }
  async function gdUrl(item) {
    var s = String(item.id), i = s.indexOf(':');
    var src = i > 0 ? s.slice(0, i) : 'netease'; var sid = i > 0 ? s.slice(i + 1) : s;
    var chain = ['320', '128']; var lastErr = '';
    for (var j = 0; j < chain.length; j++) {
      try { var r = await axios.get(GD_API, { params: { types: 'url', source: src, id: sid, br: chain[j] }, headers: { 'User-Agent': GD_UA, 'Accept': 'application/json' }, timeout: 10000, validateStatus: function () { return true; } }); var d = toObj(r.data); if (d && d.url) return { url: String(d.url).trim(), headers: { 'User-Agent': GD_UA } }; lastErr = 'br=' + chain[j] + ' 无链接'; } catch (e) { lastErr = e.message; }
    }
    throw new Error('GD音乐台 ' + src + '：' + (lastErr || '无可用链接'));
  }

  // ---- 网易系：MyFreeMP3 myfreemp3.com.cn（聚合搜索，网易云后端，列表自带直链+歌词）----
  var MF_BASE = 'https://www.myfreemp3.com.cn', MF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  async function mfSearch(kw) {
    var r = await axios.post(MF_BASE + '/', 'input=' + encodeURIComponent(kw) + '&filter=name&page=1&type=netease', { headers: { 'User-Agent': MF_UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Referer': MF_BASE + '/' }, timeout: 12000, validateStatus: function () { return true; } });
    var b = r.data; if (!b || b.code !== 200 || !b.data || !Array.isArray(b.data.list)) return [];
    return b.data.list.map(function (it) { return { id: String(it.id != null ? it.id : it.songid), title: it.title || '未知', artist: it.author || '未知歌手', _url: it.url || '', _lrc: it.lrc || '' }; });
  }
  async function mfUrl(item) {
    var outer = item && (item._url || item.url); if (!outer) throw new Error('MyFreeMP3：缺少播放链接');
    try {
      var r = await axios.get(outer, { headers: { 'User-Agent': MF_UA, 'Referer': 'https://music.163.com/' }, maxRedirects: 5, responseType: 'text', timeout: 12000, validateStatus: function () { return true; } });
      var finalUrl = (r.request && (r.request.res && r.request.res.responseUrl)) || r.config.url;
      if (finalUrl && !/404$/.test(finalUrl) && !/\/404(\?|$)/.test(finalUrl)) return { url: finalUrl, headers: { 'User-Agent': MF_UA } };
    } catch (e) {}
    throw new Error('MyFreeMP3：该曲目暂不可播放(资源不可用)');
  }
  async function mfGetLyric(musicItem) {
    try { var items = await mfSearch(musicItem.title || ''); var ordered = pickOrdered(items, musicItem); if (!ordered) return { rawLrc: '' }; var top = ordered[0]; if (top && top._lrc && /^data:text\/plain,/.test(top._lrc)) return { rawLrc: decodeURIComponent(top._lrc.slice('data:text/plain,'.length)) }; } catch (e) {} return { rawLrc: '' };
  }

  // ---- 网易系：我要下歌 xiage（Tonzhon 源，网易云直链 via url 接口）----
  var XG_TZ = 'https://tonzhon.com/api.php', XG_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  function xgPost(types, extra) {
    var data = Object.assign({ types: types }, extra || {}); var parts = []; Object.keys(data).forEach(function (k) { parts.push(k + '=' + encodeURIComponent(data[k])); });
    return axios.post(XG_TZ, parts.join('&'), { headers: { 'User-Agent': XG_UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://tonzhon.com/' }, timeout: 15000, validateStatus: function () { return true; } }).then(function (r) { return r.data; });
  }
  function xgFlattenArtist(a) { if (!a) return ''; if (typeof a === 'string') return a; if (Array.isArray(a)) { var out = []; for (var i = 0; i < a.length; i++) { var x = a[i]; if (typeof x === 'string') out.push(x); else if (Array.isArray(x)) out.push(x.join('/')); else if (x && x.name) out.push(x.name); } return out.filter(Boolean).join('/'); } return ''; }
  async function xgSearch(kw) {
    try { var arr = await xgPost('search', { source: 'netease', name: kw, pages: 1, count: 8 }); if (!Array.isArray(arr)) return []; return arr.map(function (it) { return { id: 'tz_' + String(it.id), title: it.name || '', artist: xgFlattenArtist(it.artist), _nzId: String(it.id) }; }); } catch (e) { return []; }
  }
  async function xgUrl(item) {
    var nid = item && item._nzId; if (!nid) throw new Error('我要下歌：缺少网易云 ID');
    try { var r = await xgPost('url', { id: nid, source: 'netease' }); var u = r && r.url ? String(r.url).replace(/^http:\/\//i, 'https://') : ''; if (u) return { url: u, headers: { 'User-Agent': XG_UA } }; } catch (e) {}
    throw new Error('我要下歌：网易云直链获取失败');
  }

  // ---- 聚合系：音乐搜索神器 music.lmb520.cn（多平台聚合，netease/qq/kugou/kuwo）----
  var SQ_BASE = 'https://music.lmb520.cn/', SQ_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  var SQ_PLATFORMS = ['netease', 'qq', 'kugou', 'kuwo'];
  function sqForm(body) { return Object.keys(body).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(body[k]); }).join('&'); }
  async function sqSearch(kw) {
    var tasks = SQ_PLATFORMS.map(function (plat) {
      return axios.post(SQ_BASE, sqForm({ input: kw, filter: 'name', type: plat, page: 1 }), { headers: { 'User-Agent': SQ_UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': SQ_BASE, 'X-Requested-With': 'XMLHttpRequest' }, timeout: 10000, validateStatus: function () { return true; } })
        .then(function (r) { var d = toObj(r.data); if (d.code !== 200 || !Array.isArray(d.data)) return []; return d.data.map(function (it) { return { id: plat + ':' + String(it.songid != null ? it.songid : it.id), title: it.title || '未知', artist: it.author || '未知歌手', _lrc: it.lrc || '' }; }); }).catch(function () { return []; });
    });
    var lists = await Promise.all(tasks); var merged = [], seen = {};
    lists.forEach(function (arr) { arr.forEach(function (it) { var key = (it.title || '') + '|' + (it.artist || ''); if (!seen[key]) { seen[key] = 1; merged.push(it); } }); });
    return merged;
  }
  async function sqUrl(item) {
    var info = String(item.id).split(':'); var plat = info.shift(); var sid = info.join(':');
    var r = await axios.post(SQ_BASE, sqForm({ input: sid, filter: 'id', type: plat, page: 1 }), { headers: { 'User-Agent': SQ_UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': SQ_BASE, 'X-Requested-With': 'XMLHttpRequest' }, timeout: 10000, validateStatus: function () { return true; } });
    var d = toObj(r.data); var it = (Array.isArray(d.data) && d.data[0]) || {};
    if (!it.url) throw new Error('音乐搜索神器：无法获取播放链接');
    return { url: it.url, headers: { 'User-Agent': SQ_UA, 'Referer': SQ_BASE } };
  }
  async function sqGetLyric(musicItem) {
    try { var items = await sqSearch(musicItem.title || ''); var ordered = pickOrdered(items, musicItem); if (!ordered) return { rawLrc: '' }; var top = ordered[0]; if (top && top._lrc) return { rawLrc: top._lrc }; } catch (e) {} return { rawLrc: '' };
  }

  // ---- 独立站末位兜底（跨平台通用同名替身）----
  var XM_BASE = 'https://www.xmfwav.com', XM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  async function xmSearch(kw) {
    var r = await axios.get(XM_BASE + '/srcj/?kwd=' + encodeURIComponent(kw || ''), { headers: { 'User-Agent': XM_UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }, timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; } });
    var $ = cheerio.load(r.data || ''); var data = [];
    $('a.srcsong-item').each(function (i, el) { var a = $(el); var href = a.attr('href') || ''; var m = href.match(/\/song\/(\d+)/); if (!m) return; var id = m[1]; var title = a.find('span.srcsong-name').first().text().trim(); var artist = a.find('span.srcact').first().text().trim(); if (title) data.push({ id: id, title: title, artist: artist || '未知歌手' }); });
    return data;
  }
  async function xmUrl(item) {
    var html = (await axios.get(XM_BASE + '/song/' + item.id, { timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; } })).data || '';
    var m = String(html).match(/url:\s*['"]([^'"]+\.(?:mp3|wav|flac|ogg|m4a))['"]/i);
    if (!m || !/^https?:\/\//.test(m[1])) throw new Error('小蜜蜂：无直链');
    return { url: m[1], headers: { 'User-Agent': XM_UA } };
  }
  var YW_BASE = 'https://www.yinwe.com', YW_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  function ywParseTitle(raw) {
    raw = (raw || '').trim(); if (!raw) return { title: '未知歌曲', artist: '未知歌手' };
    var m = raw.match(/^(.*?)[（(](.+?)[）)]\s*[-\u2013\u2014]?\s*(.*)$/);
    if (m) return { title: m[1].trim() || raw, artist: m[2].trim() || '未知歌手' };
    if (raw.indexOf(' - ') >= 0) { var p = raw.split(/\s*-\s*/); return { title: p[0].trim(), artist: p.slice(1).join('-').trim() || '未知歌手' }; }
    return { title: raw, artist: '未知歌手' };
  }
  async function ywSearch(kw) {
    var r = await axios.get(YW_BASE + '/?keyword=' + encodeURIComponent(kw), { headers: { 'User-Agent': YW_UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' }, timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; } });
    var $ = cheerio.load(r.data || ''); var data = [];
    $('a.sp1[href*="/yinyue/"]').each(function (i, el) { var a = $(el); var href = a.attr('href') || ''; var m = href.match(/\/yinyue\/(\d+)\.html/); if (!m) return; var id = m[1]; var p = ywParseTitle(a.attr('title')); data.push({ id: id, title: p.title, artist: p.artist }); });
    return data;
  }
  async function ywUrl(item) {
    var resp = await axios.get(YW_BASE + '/?plugin=xmusic_like&do=playmusic&articleId=' + encodeURIComponent(item.id), { headers: { 'User-Agent': YW_UA, 'Accept': 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', 'Referer': YW_BASE + '/yinyue/' + item.id + '.html' }, timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; } });
    var j = toObj(resp.data);
    if (!Array.isArray(j) || !j[0] || (!j[0].url && !j[0].downlink)) throw new Error('音微：取链失败');
    return { url: j[0].url || j[0].downlink, headers: { 'User-Agent': YW_UA } };
  }

  // ---- 通用备选源兜底封装：search → pickOrdered 身份校验 → url，命中即返回并打 X-Kg-Backup 溯源头 ----
  async function tryBackup(name, searchFn, urlFn, musicItem) {
    var q = (musicItem.title || '').trim() || (musicItem.artist || '').trim();
    if (!q) throw new Error(name + '：歌曲标题为空，无法检索');
    var items = await searchFn(q, musicItem);
    var ordered = pickOrdered(items, musicItem);
    if (!ordered || !ordered.length) throw new Error(name + '：无安全候选（身份校验拒绝错播）');
    var res = await urlFn(ordered[0], musicItem);
    if (!res || !res.url) throw new Error(name + '：空链接');
    if (!res.headers) res.headers = {};
    res.headers['X-Kg-Backup'] = name;
    return res;
  }

  // ============================ 组合取链 / 歌词（酷狗 → mvmp3 → gequbao → 11 备选 → aax 末位） ============================
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
          // 【v0.1.2】删除酷狗直链 HEAD 探测（v0.1.0 引入）：该探测成功/失败都返回同一 kg.url，对结果零收益；且每首首播同步阻塞≤4000ms（酷狗 CDN 对 HEAD 常慢/无响应）。直接返回直链，回归 v0.0.9 速度。
          return { url: kg.url, rawLrc: kg.rawLrc, artwork: kg.artwork, headers: { Referer: 'https://www.kugou.com/' } };
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

    // ④–⑬ 内联备选源：酷我系 → 网易系/聚合 → 独立站，顺序 tryBackup（身份校验拒绝错播）
    try { var r4 = await tryBackup('gequhai', ghSearch, ghUrl, musicItem); if (r4 && r4.url) return r4; } catch (e) { errors.push('歌曲海:' + e.message); }
    try { var r5 = await tryBackup('gequke', gkSearch, gkUrl, musicItem); if (r5 && r5.url) return r5; } catch (e) { errors.push('歌曲客:' + e.message); }
    try { var r6 = await tryBackup('fengli', flSearch, flUrl, musicItem); if (r6 && r6.url) return r6; } catch (e) { errors.push('凤梨音乐:' + e.message); }
    try { var r7 = await tryBackup('liusheng', lsSearch, lsUrl, musicItem); if (r7 && r7.url) return r7; } catch (e) { errors.push('溜声音乐:' + e.message); }
    try { var r8 = await tryBackup('qeecc', qeSearch, qeUrl, musicItem); if (r8 && r8.url) return r8; } catch (e) { errors.push('无忧音乐网:' + e.message); }
    try { var r9 = await tryBackup('gd', gdSearch, gdUrl, musicItem); if (r9 && r9.url) return r9; } catch (e) { errors.push('GD音乐台:' + e.message); }
    try { var r10 = await tryBackup('myfree', mfSearch, mfUrl, musicItem); if (r10 && r10.url) return r10; } catch (e) { errors.push('MyFreeMP3:' + e.message); }
    try { var r11 = await tryBackup('xiage', xgSearch, xgUrl, musicItem); if (r11 && r11.url) return r11; } catch (e) { errors.push('我要下歌:' + e.message); }
    try { var r12 = await tryBackup('sq', sqSearch, sqUrl, musicItem); if (r12 && r12.url) return r12; } catch (e) { errors.push('音乐搜索神器:' + e.message); }
    try { var r13a = await tryBackup('xiaomifeng', xmSearch, xmUrl, musicItem); if (r13a && r13a.url) return r13a; } catch (e) { errors.push('小蜜蜂音乐:' + e.message); }
    try { var r13b = await tryBackup('yinwe', ywSearch, ywUrl, musicItem); if (r13b && r13b.url) return r13b; } catch (e) { errors.push('音微音乐:' + e.message); }

    // ⑭ 极端末位：AAX音乐网 aax.cx（酷我系直链，本轮实测 0 结果，仅作最后兜底层；修复前跳过即不阻断）
    try {
      const src = await aaxGetMediaSource(musicItem);
      if (src && src.url) return src;
    } catch (e) { errors.push('AAX音乐网:' + e.message); }

    var songName = (musicItem.title || '') + (musicItem.artist ? '（' + musicItem.artist + '）' : '');
    var msg = '酷狗官方、无名音乐网、歌曲宝及 11 个内联备选源均未能取得《' + songName + '》的音源。';
    msg += '①酷狗官方接口已无免费直链（已软熔断跳过）；②无名音乐网取链失败（详见上）；③歌曲宝曲库未收录该版本（多为翻唱）；';
    msg += '④~⑬ 酷我系/网易系/聚合/独立站备选源均身份校验拒绝或无可用直链；⑭AAX音乐网同样未收录。';
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
    // 网易系/聚合 歌词兜底（自带 lrc，含身份校验）
    try { const ml = await mfGetLyric(musicItem); if (ml && ml.rawLrc) return ml; } catch (e) {}
    try { const sl = await sqGetLyric(musicItem); if (sl && sl.rawLrc) return sl; } catch (e) {}
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
    version: '0.1.5',
    author: 'tianpeng + 优化(下沉 qq.js v0.1.8 三态校验)',
    description: '酷狗官方 + 无名音乐网(mvmp3，自动过人机验证) + 歌曲宝(gequbao) + AAX音乐网(aax.cx) 四层兜底取链；' +
      'v0.1.0：下沉 qq.js v0.1.8 三态身份校验修复「同名异版错播」、新增第③备用源 AAX音乐网(三层→四层)、' +
      '酷狗官方取链软熔断(连续空返回5次跳过)、取链质量打分(matchScore择优)；' +
      'v0.1.2：删除酷狗直链 HEAD 探测（v0.1.0 引入的≤4000ms 首播阻塞、零收益），取得直链直接返回，回归 v0.0.9 速度；' +
      '支持酷狗歌单导入、官方排行榜（按热歌/地区/特色/全球/曲风分层）与热门榜单；' +
      '热门歌单广场（分类标签浏览酷狗歌单）。' +
      'v0.0.9 修复：歌单详情/导入取歌改用 mobilecdn special/song JSON 接口，解决点进歌单歌曲空白。' +
      '⚠️ 仅供个人学习与研究使用。',
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@v0.1.5/musicfree-kg/github/kg.js',
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
      // 第三批：11 个内联备选源 search/url + 通用兜底封装（诊断接口，对齐 wy/kw）
      tryBackup: tryBackup,
      backups: {
        gequhai: { search: ghSearch, url: ghUrl },
        gequke: { search: gkSearch, url: gkUrl },
        fengli: { search: flSearch, url: flUrl },
        liusheng: { search: lsSearch, url: lsUrl },
        qeecc: { search: qeSearch, url: qeUrl },
        gd: { search: gdSearch, url: gdUrl },
        myfree: { search: mfSearch, url: mfUrl },
        xiage: { search: xgSearch, url: xgUrl },
        sq: { search: sqSearch, url: sqUrl },
        xiaomifeng: { search: xmSearch, url: xmUrl },
        yinwe: { search: ywSearch, url: ywUrl },
      },
    },
  };

  if (typeof module !== 'undefined' && module && module.exports) module.exports = plugin;
  if (typeof exports !== 'undefined') exports.default = plugin;
  return plugin;
})();
