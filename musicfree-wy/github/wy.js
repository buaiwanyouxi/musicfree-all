// 网易云音乐 v0.1.1 · 发布于 2026-09-24（MusicFree 音源插件发布版）
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
//   取链四层兜底（参考 kugou_mvmp3.js 思路）：网易云官方直链（免费曲高质量）→
//   无名音乐网 mvmp3.com（①首选备用，自动过人机验证）→ 歌曲宝 gequbao.com（②次选备用）→
//   布谷音乐 buguyy.top（③兜底，酷我镜像）。全程三态身份校验，无安全候选即拒绝错播。
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
  // ============================ 第四批：官方接口监控埋点 + 连续失败告警 ============================
  // 仅做可观测性埋点（不阻断取链；各备用源仍独立兜底）。统计官方 /api 接口成功率与连续失败；
  // 连续失败达阈值（默认 5 次）发出一次告警，提示官方接口可能临时失效、取链将全部走备用源。
  // weapi 加密兜底（AES+MD5）工作量高，按指令暂缓，待官方明文接口确证失效后再评估实施。
  var WY_OFFICIAL_FAIL_LIMIT = 5;
  var _wyOfficialFails = 0;
  var _wyOfficialAlerted = false;
  var _wyOfficialStats = { total: 0, ok: 0, fail: 0, lastErr: '', lastAt: 0 };
  var WY_WEAPI_FALLBACK = false; // 预留开关：weapi 加密兜底，当前暂缓（false）
  function wyOfficialRecord(ok, err) {
    _wyOfficialStats.total++;
    _wyOfficialStats.lastAt = Date.now();
    if (ok) {
      _wyOfficialStats.ok++;
      _wyOfficialFails = 0;
      _wyOfficialAlerted = false;
    } else {
      _wyOfficialStats.fail++;
      _wyOfficialFails++;
      _wyOfficialStats.lastErr = err || '';
      if (_wyOfficialFails >= WY_OFFICIAL_FAIL_LIMIT && !_wyOfficialAlerted) {
        _wyOfficialAlerted = true;
        console.warn('[wy 官方接口告警] 网易云官方 /api 接口连续 ' + _wyOfficialFails +
          ' 次失败，可能已临时不可用；取链将全部走备用源（mvmp3/gequbao/buguyy）。错误：' + (err || '') +
          '。weapi 加密兜底当前未启用。');
      }
    }
  }
  // ============================ 第五批：官方接口失败重试（指数退避） ============================
  // 仅对可重试状态码（460/429/5xx，偶发限流/临时故障）做指数退避重试；其余错误（含网络异常、其他 4xx）一律立即抛出，不盲目重试。
  var WY_RETRY_MAX = 3;          // 最多重试次数（总尝试 1+3=4 次）
  var WY_RETRY_BASE_MS = 1000;   // 基础退避：1s → 2s → 4s
  var _wyRetryTotal = 0;         // 累计重试次数（供诊断）
  function wyRetryableStatus(code) {
    if (code === 460 || code === 429) return true;
    return code >= 500 && code < 600; // 5xx
  }
  async function nget(path, params) {
    var lastErr = null;
    for (var attempt = 0; attempt <= WY_RETRY_MAX; attempt++) {
      try {
        var r = await axios.get(BASE + path, {
          params: params,
          headers: buildHeaders(),
          timeout: 10000,
          validateStatus: function () { return true; },
        });
        var code = r.status || 0;
        if (wyRetryableStatus(code)) {
          lastErr = new Error('官方接口返回可重试状态码 ' + code);
          if (attempt < WY_RETRY_MAX) { _wyRetryTotal++; await sleep(WY_RETRY_BASE_MS * Math.pow(2, attempt)); continue; }
          wyOfficialRecord(false, lastErr.message);
          throw lastErr;
        }
        // 2xx：成功返回数据；其余非可重试状态（如 400/403/404）一律立即抛出，不盲目重试
        if (code >= 200 && code < 300) {
          wyOfficialRecord(true, null);
          return r.data;
        }
        lastErr = new Error('官方接口返回非可重试状态码 ' + code);
        wyOfficialRecord(false, lastErr.message);
        throw lastErr;
      } catch (e) {
        // 网络/解析异常：按指令不重试，立即抛出
        wyOfficialRecord(false, e && e.message);
        throw e;
      }
    }
    wyOfficialRecord(false, lastErr && lastErr.message);
    throw lastErr;
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
  // ============================ 【v0.1.1 第一批】三态身份校验（移植自 qq.js v0.1.8 / kg.js v0.1.0，修复「同名异版错播」） ============================
  // 背景：原 mvRank「无命中即回退未过滤列表」+ 旧「任一侧缺失即放行(fail-open)」叠加，使「歌名相同但歌手不同」
  //   的候选照样被选中（即 qq.js v0.1.7 错播根因同源）。现以三态判定取代之：
  //   三态：ok（已验证一致）／unknown（该侧信息缺失，无从验证）／conflict（双方已知且不一致）。
  //   【v0.1.8】口径：仅以「歌名+歌手」双因子校验（时长多源不可靠，且错播真因是歌手 fail-open，非时长）。
  // 取链质量打分：matchScore 对候选按 歌名互含(+2) + 歌手匹配(+1) + 歌名完全相等(+1) 打分择优。
  var _wyScoreLog = [];   // 结构化打分明细（最多保留最近 50 条），供 _internal.scoreLog() 读取与测试断言
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
  // 【v0.1.1 第一批】统一选池：优先强命中；无强命中则退到「可安全播放」池；两者皆空 → 返回 null（调用方抛错拒绝错播）。
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
  // 结构化打分明细：记录候选总数 / 选中项 / 全候选打分，写入 _wyScoreLog 并输出可读日志（第四批要求）。
  function recordScore(musicItem, all, scored) {
    var entry = {
      at: Date.now(),
      title: musicItem && musicItem.title,
      artist: musicItem && musicItem.artist,
      total: (all || []).length,
      selected: scored && scored.length ? { id: scored[0].id, title: scored[0].title, artist: scored[0].artist, score: matchScore(scored[0], musicItem) } : null,
      candidates: (scored || []).map(function (c) { return { id: c.id, title: c.title, artist: c.artist, score: matchScore(c, musicItem) }; }),
    };
    _wyScoreLog.push(entry);
    if (_wyScoreLog.length > 50) _wyScoreLog.shift();
    if (typeof console !== 'undefined' && console.log) {
      console.log('[wy 取链打分] ' + (entry.title || '') + (entry.artist ? ' - ' + entry.artist : '') +
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
    var ordered = pickOrdered(items, musicItem);
    if (!ordered) throw new Error('无名音乐网候选均未通过身份校验（歌名或歌手不符），已拒绝错播并回退下一层');
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
    var ordered = pickOrdered(items, musicItem);
    if (!ordered) return { rawLrc: '' };
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

  // ===================== 备用音源③：布谷音乐 buguyy.top（酷我镜像，最后兜底） =====================
  // 实测接口（非盲猜）：GET /api/search?keyword= -> {success,data:[{id,title,singer,picurl,about}]}（单页最多 50，无分页）；
  //   GET /api/geturl?id=<kuwo rid> -> {success,url,lrc}。注意：官方 buguyy.js 的 BASE 被误写为 jsdelivr 源（既有 bug），
  //   本适配器直接指向 https://buguyy.top，不继承该 bug；返回媒体只给 {url}（不带 Referer，避免酷我 CDN 403）。
  var BG_BASE = 'https://buguyy.top';
  var BG_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  var BG_TIMEOUT = 3000; // 备用源单请求超时（与 kg.js 备用源一致，≤3000ms）
  function bgMapItem(it) {
    return { id: String(it.id), title: it.title || '', artist: it.singer || '' };
  }
  async function bgSearch(keyword) {
    var r = await axios.get(BG_BASE + '/api/search', {
      params: { keyword: keyword || '' },
      headers: { 'User-Agent': BG_UA, Referer: BG_BASE + '/', 'X-Requested-With': 'XMLHttpRequest' },
      timeout: BG_TIMEOUT, validateStatus: function () { return true; },
    });
    var d = toObj(r.data);
    var arr = (d && d.data) || [];
    if (!Array.isArray(arr)) return [];
    return arr.map(bgMapItem).filter(function (x) { return x.id && x.title; });
  }
  async function bgGetMediaSource(musicItem) {
    var q = (musicItem.title || '').trim() || (musicItem.artist || '').trim();
    if (!q) throw new Error('歌曲标题为空，无法在布谷音乐检索');
    var items = await bgSearch(q);
    if (!items.length) throw new Error('布谷音乐未找到：' + q);
    var ordered = pickOrdered(items, musicItem);
    if (!ordered) throw new Error('布谷音乐候选均未通过身份校验（歌名或歌手不符），已拒绝错播');
    var lastErr = '';
    for (var i = 0; i < Math.min(ordered.length, 5); i++) {
      try {
        var r = await axios.get(BG_BASE + '/api/geturl', {
          params: { id: ordered[i].id },
          headers: { 'User-Agent': BG_UA, Referer: BG_BASE + '/', 'X-Requested-With': 'XMLHttpRequest' },
          timeout: BG_TIMEOUT, validateStatus: function () { return true; },
        });
        var d = toObj(r.data);
        if (d && d.success && d.url) return { url: d.url, rawLrc: d.lrc || '', artwork: musicItem.coverImg || musicItem.artwork || '' };
        lastErr = (d && d.msg) ? String(d.msg) : '空链接';
      } catch (e) { lastErr = e.message; }
    }
    throw new Error('布谷音乐可取链候选均已下架/不可播放（' + (lastErr || '无可用链接') + '）');
  }
  async function bgGetLyric(musicItem) {
    var q = (musicItem.title || '').trim() || (musicItem.artist || '').trim();
    if (!q) return { rawLrc: '' };
    var items; try { items = await bgSearch(q); } catch (e) { return { rawLrc: '' }; }
    if (!items.length) return { rawLrc: '' };
    var ordered = pickOrdered(items, musicItem);
    if (!ordered) return { rawLrc: '' };
    for (var i = 0; i < Math.min(ordered.length, 3); i++) {
      try {
        var r = await axios.get(BG_BASE + '/api/geturl', {
          params: { id: ordered[i].id },
          headers: { 'User-Agent': BG_UA, Referer: BG_BASE + '/', 'X-Requested-With': 'XMLHttpRequest' },
          timeout: BG_TIMEOUT, validateStatus: function () { return true; },
        });
        var d = toObj(r.data);
        if (d && d.success && d.lrc) return { rawLrc: d.lrc };
      } catch (e) {}
    }
    return { rawLrc: '' };
  }

  // ============================ 取链（官方 + 三层备用兜底） ============================
  // 免费曲：官方 m*.music.126.net 直链（高质量）优先；
  // VIP/付费曲（fee=1/4）：官方仅返回约 30s 试听片段，自动改用
  //   【① 首选】无名音乐网 mvmp3.com（自动过人机验证）
  //   【② 次选】歌曲宝 gequbao.com（无需验证）
  //   【③ 兜底】布谷音乐 buguyy.top（酷我镜像）
  // 四层全失败才报错，最大化“有歌可播”。
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
        var ordered = pickOrdered(g, musicItem);
        if (!ordered) throw new Error('歌曲宝候选均未通过身份校验（歌名或歌手不符），已拒绝错播');
        var gurl = await gbGetPlayUrl(ordered[0].id);
        if (gurl) return { url: gurl, artwork: musicItem.coverImg || musicItem.artwork || '' };
      }
    } catch (e) { errs.push('歌曲宝:' + e.message); }

    // ③ 兜底：布谷音乐 buguyy.top（酷我镜像，前两层均失效时的最后兜底）
    try {
      var bg = await bgGetMediaSource(musicItem);
      if (bg && bg.url) return { url: bg.url }; // 不带 Referer（酷我 CDN 会 403）
    } catch (e) { errs.push('布谷音乐:' + e.message); }

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
        var ordered = pickOrdered(g, musicItem);
        if (!ordered) throw new Error('歌曲宝候选均未通过身份校验（歌名或歌手不符），已拒绝错播');
        var gl = await gbGetLyric(ordered[0].id);
        if (gl && gl.rawLrc) return { rawLrc: gl.rawLrc };
      }
    } catch (e) {}
    // ③ 兜底：布谷音乐 buguyy.top
    try { var bl = await bgGetLyric(musicItem); if (bl && bl.rawLrc) return { rawLrc: bl.rawLrc }; } catch (e) {}
    return { rawLrc: '' };
  }

  // ============================ 歌单曲目（全量，支持大歌单） ============================
  // ============================ 歌单曲目缓存 + 大歌单节流 ============================
  // v0.1.1 第二批：歌单详情按 sheet.id 缓存（避免每翻一页都重新拉全量 trackIds + 分批 /song/detail），
  //   大歌单（trackIds > 阈值）分批取 /song/detail 时加请求间隔，避免服务端 460/限流。
  var _sheetCache = {};                 // id -> { at, songs }
  var SHEET_CACHE_TTL = 5 * 60 * 1000; // 5 分钟（翻页期间命中，超时后自动回源）
  var SHEET_THROTTLE_MS = 200;         // 大歌单分批间隔（毫秒）
  var SHEET_THROTTLE_THRESHOLD = 200;  // trackIds 超过该值才间隔（小歌单不打扰、不延迟）
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function getPlaylistSongs(id) {
    var key = String(id);
    var cached = _sheetCache[key];
    if (cached && (Date.now() - cached.at) < SHEET_CACHE_TTL) return cached.songs; // 命中缓存，零重复请求
    var detail = toObj(await nget('/playlist/detail', { id: key }));
    var result = detail.result || detail;
    var trackIds = (result.trackIds || []).map(function (t) { return t.id; });
    var tracks = result.tracks || [];
    var songs;
    // 详情已含全部曲目（如排行榜 100 首）则直接映射
    if (trackIds.length === 0 || tracks.length >= trackIds.length) {
      songs = tracks.map(formatSong);
    } else {
      // 大歌单：按 trackIds 分批取完整曲目；超过阈值时加请求间隔避免 460/限流
      var raw = [];
      var throttled = trackIds.length > SHEET_THROTTLE_THRESHOLD;
      for (var i = 0; i < trackIds.length; i += 200) {
        var batch = trackIds.slice(i, i + 200);
        var sd = toObj(await nget('/song/detail', { ids: JSON.stringify(batch) }));
        (sd.songs || sd.songdetails || []).forEach(function (s) { raw.push(s); });
        if (throttled && i + 200 < trackIds.length) await sleep(SHEET_THROTTLE_MS);
      }
      songs = raw.map(formatSong);
    }
    _sheetCache[key] = { at: Date.now(), songs: songs };
    return songs;
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
    version: '0.1.1',
    author: 'tianpeng + 优化(下沉 qq.js v0.1.8 三态校验)',
    description: '网易云音乐音源：支持歌单导入（含大歌单全量+分页缓存）、热门歌单、官方排行榜，附带搜索/歌词/取链。' +
      '全部走免加密官方 /api 接口；VIP/付费曲目免费态仅返回约 30 秒试听片段（版权限制）。' +
      'v0.1.1：下沉 qq.js v0.1.8 三态身份校验修复「同名异版错播」（无安全候选一律拒绝错播，不再回退未过滤列表）；' +
      '取链四层兜底【官方 → 无名音乐网 mvmp3（①首选）→ 歌曲宝 gequbao（②次选）→ 布谷音乐 buguyy.top（③兜底）】，最大化可播率。' +
      'v0.1.1 第四批：新增官方接口监控埋点（连续 5 次失败告警；weapi 加密兜底暂缓）。' +
      'v0.1.1 第五批：官方 /api 偶发 460/429/5xx 失败指数退避重试（1s→2s→4s），其余错误立即抛出不重试。',
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@v0.1.1/musicfree-wy/wy.js',
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
    // ============================ v0.1.1 内部诊断接口（仅供测试 / 运维，不影响取链） ============================
    _internal: {
      // 第一批：三态身份校验 / 统一选池 / 取链打分
      norm: norm,
      titleOk: titleOk,
      artistState: artistState,
      durState: durState,
      isGoodMatch: isGoodMatch,
      isSafeCandidate: isSafeCandidate,
      matchScore: matchScore,
      pickOrdered: pickOrdered,
      scoreLog: function () { return _wyScoreLog.slice(); },
      scoreLogClear: function () { _wyScoreLog.length = 0; },
      // 第二批：歌单缓存
      sheetCacheClear: function () { _sheetCache = {}; },
      sheetCacheKeys: function () { return Object.keys(_sheetCache); },
      // 第四批：官方接口监控
      officialHealth: function () { return { fails: _wyOfficialFails, alerted: _wyOfficialAlerted, limit: WY_OFFICIAL_FAIL_LIMIT, weapiFallback: WY_WEAPI_FALLBACK, stats: Object.assign({}, _wyOfficialStats) }; },
      officialHealthReset: function () { _wyOfficialFails = 0; _wyOfficialAlerted = false; _wyOfficialStats = { total: 0, ok: 0, fail: 0, lastErr: '', lastAt: 0 }; },
      // 第五批：重试
      retryConfig: function () { return { max: WY_RETRY_MAX, baseMs: WY_RETRY_BASE_MS, total: _wyRetryTotal }; },
      retryReset: function () { _wyRetryTotal = 0; },
    },
    async search(query, page, type) {
      return await search(query, page, type);
    },
    getMediaSource: getMediaSource,
    getLyric: getLyric,
    getTopLists: getTopLists,
    getTopListDetail: getTopListDetail,
    importMusicSheet: importMusicSheet,
    getPlaylistSongs: getPlaylistSongs,
    getRecommendSheetTags: getRecommendSheetTags,
    getRecommendSheetsByTag: getRecommendSheetsByTag,
    getMusicSheetInfo: getMusicSheetInfo,
  };

  if (typeof module !== 'undefined' && module && module.exports) module.exports = plugin;
  if (typeof exports !== 'undefined') exports.default = plugin;
  return plugin;
})();
