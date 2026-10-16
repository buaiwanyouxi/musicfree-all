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
  // 注意：gequbao.com 站点结构已演进，取链须用当前接口（/search-fallback + JWT play_id + purpose=play）；
  // 旧 window.appData / /s/ 搜索已失效（实测取不到 play_id），本段已同步为当前站结构。
  var GB_BASE = 'https://www.gequbao.com';
  var GB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  function gbCookie(sh) {
    if (!sh) return '';
    return String(sh).split(',').map(function (s) { return s.split(';')[0]; }).join('; ');
  }
  async function gbSearch(keyword) {
    var r = await axios.get(GB_BASE + '/search-fallback?keyword=' + encodeURIComponent(keyword || ''), {
      headers: { 'User-Agent': GB_UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' },
      timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; },
    });
    var $ = cheerio.load(r.data || '');
    var data = [];
    $('a.hover-zoom[href^="/music/"]').each(function (i, el) {
      var a = $(el); var href = a.attr('href') || ''; var m = href.match(/\/music\/(\d+)/); if (!m) return;
      var id = m[1];
      var titleAttr = (a.attr('title') || '').trim(); var title = '', artist = '未知歌手';
      if (titleAttr.indexOf(' - ') >= 0) { var parts = titleAttr.split(' - '); title = (parts[0] || '').trim(); artist = (parts[1] || '未知歌手').trim(); }
      else { title = titleAttr || a.find('.text-primary').first().text().trim(); artist = a.find('.text-jade').first().text().trim() || '未知歌手'; }
      if (title) data.push({ id: id, title: title, artist: artist });
    });
    return data;
  }
  async function gbGetPlayUrl(musicId) {
    var pageUrl = GB_BASE + '/music/' + musicId;
    var dres = await axios.get(pageUrl, {
      headers: { 'User-Agent': GB_UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' },
      timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; },
    });
    var text = dres.data || '';
    var pm = text.match(/play_id\\u0022:\\u0022(eyJ[A-Za-z0-9+/=]+)/);
    if (!pm) throw new Error('歌曲宝：详情页未找到 play_id');
    var playId = pm[1], cookie = gbCookie(dres.headers && dres.headers['set-cookie']);
    var resp = await axios.post(GB_BASE + '/member/common-play-url', 'id=' + encodeURIComponent(playId) + '&purpose=play', {
      headers: { 'User-Agent': GB_UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Referer': pageUrl, 'Origin': GB_BASE, 'Accept': 'application/json, text/javascript, */*; q=0.01', 'Cookie': cookie },
      timeout: 9000, validateStatus: function () { return true; },
    });
    var j = toObj(resp.data);
    if (!j || j.code !== 1 || !j.data || !j.data.url) throw new Error('歌曲宝：取链失败' + (j ? '(' + j.code + ')' : ''));
    return { url: String(j.data.url).replace(/^http:/i, 'https:'), headers: { 'User-Agent': GB_UA, 'Referer': 'https://www.kuwo.cn/' } };
  }
  async function gbGetLyric(musicId) {
    var r = await axios.get(GB_BASE + '/music/' + musicId, { headers: { 'User-Agent': GB_UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' }, timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; } });
    var html = r.data || '', i = html.indexOf('id="content-lrc"');
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

  // ===================== 新增内联备选源（第二批：补网易系 + 扩酷我系，避免单一体系依赖） =====================
  // 移植自 muscifree-other 各 standalone 插件与 kw.js，统一改用 axios（与 wy 现有 mv/gequbao/buguyy 一致，可走测试 stub、生产亦可用），
  // 全部经 pickOrdered 身份校验防错播。aax 本轮实测 0 结果暂不接入；buguyy 已移出默认链（仅置极端末位 ⑬）。
  // 链序：官方 → mvmp3 → 歌曲宝 → 酷我系5(qeecc/gequhai/gequke/凤梨/溜声) → 网易系4(gd/myfree/我要下歌/音乐搜索神器) → 独立站2(小蜜蜂/音微) → 布谷极端末位。

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

  // ---- 通用备选源兜底封装：search → pickOrdered 身份校验 → url，命中即返回并打 X-Wy-Backup 溯源头 ----
  async function tryBackup(name, searchFn, urlFn, musicItem) {
    var q = (musicItem.title || '').trim() || (musicItem.artist || '').trim();
    if (!q) throw new Error(name + '：歌曲标题为空，无法检索');
    var items = await searchFn(q, musicItem);
    var ordered = pickOrdered(items, musicItem);
    if (!ordered || !ordered.length) throw new Error(name + '：无安全候选（身份校验拒绝错播）');
    var res = await urlFn(ordered[0], musicItem);
    if (!res || !res.url) throw new Error(name + '：空链接');
    if (!res.headers) res.headers = {};
    res.headers['X-Wy-Backup'] = name;
    return res;
  }

  // ============================ 取链（官方 + 13 层备用兜底链） ============================
  // 免费曲：官方 m*.music.126.net 直链（高质量）优先；
  // VIP/付费曲（fee=1/4）：官方仅返回约 30s 试听片段，自动改用备用链：
  //   ① 无名音乐网 mvmp3.com（自动过人机验证）
  //   ② 歌曲宝 gequbao.com（无需验证）
  //   ③ 无忧音乐网 qeecc.com（自动过验证 + 会话缓存）
  //   ④ 歌曲海 gequhai.com（kuwo 直链）
  //   ⑤ 歌曲客 gequke.com（kuwo 直链）
  //   ⑥ 凤梨音乐 flmp3.pro（kuwo CDN 直链）
  //   ⑦ 溜声音乐 6sing.top（kuwo CDN 直链）
  //   ⑧ GD音乐台 gdstudio（网易云/Joox 聚合 API）
  //   ⑨ MyFreeMP3（网易云后端，列表自带直链）
  //   ⑩ 我要下歌 xiage（Tonzhon 网易云直链）
  //   ⑪ 音乐搜索神器 lmb520（netease/qq/kugou/kuwo 聚合）
  //   ⑫ 小蜜蜂 xmfwav / 音微 yinwe（独立站同名替身）
  //   ⑬ 布谷音乐 buguyy.top（酷我镜像，极端末位兜底）
  // 全链失败才报错，最大化“有歌可播”；每个命中源打 X-Wy-Backup 响应头溯源。
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

    // 2) 官方是试听/无链 -> 13 层备用兜底链
    var errs = [];
    // ① 首选：无名音乐网 mvmp3（自动过人机验证）
    try {
      var mv = await mvGetMediaSource(musicItem);
      if (mv && mv.url) return { url: mv.url }; // 不带 Referer（否则 CDN 403）
    } catch (e) { errs.push('mvmp3:' + e.message); }

    // ② 次选：歌曲宝（无需验证）
    try {
      var q = (musicItem.title || '').trim();
      var g = await gbSearch(q);
      if (g && g.length) {
        var ordered = pickOrdered(g, musicItem);
        if (!ordered) throw new Error('歌曲宝候选均未通过身份校验（歌名或歌手不符），已拒绝错播');
        var gurl = await gbGetPlayUrl(ordered[0].id);
        if (gurl && gurl.url) return { url: gurl.url, artwork: musicItem.coverImg || musicItem.artwork || '' };
      }
    } catch (e) { errs.push('歌曲宝:' + e.message); }

    // ③–⑫ 内联备选源：酷我系 → 网易系/聚合 → 独立站，顺序 tryBackup（身份校验拒绝错播）
    try { var r3 = await tryBackup('qeecc', qeSearch, qeUrl, musicItem); if (r3 && r3.url) return r3; } catch (e) { errs.push('qeecc:' + e.message); }
    try { var r4 = await tryBackup('gequhai', ghSearch, ghUrl, musicItem); if (r4 && r4.url) return r4; } catch (e) { errs.push('gequhai:' + e.message); }
    try { var r5 = await tryBackup('gequke', gkSearch, gkUrl, musicItem); if (r5 && r5.url) return r5; } catch (e) { errs.push('gequke:' + e.message); }
    try { var r6 = await tryBackup('fengli', flSearch, flUrl, musicItem); if (r6 && r6.url) return r6; } catch (e) { errs.push('fengli:' + e.message); }
    try { var r7 = await tryBackup('liusheng', lsSearch, lsUrl, musicItem); if (r7 && r7.url) return r7; } catch (e) { errs.push('liusheng:' + e.message); }
    try { var r8 = await tryBackup('gd', gdSearch, gdUrl, musicItem); if (r8 && r8.url) return r8; } catch (e) { errs.push('gd:' + e.message); }
    try { var r9 = await tryBackup('myfree', mfSearch, mfUrl, musicItem); if (r9 && r9.url) return r9; } catch (e) { errs.push('myfree:' + e.message); }
    try { var r10 = await tryBackup('xiage', xgSearch, xgUrl, musicItem); if (r10 && r10.url) return r10; } catch (e) { errs.push('xiage:' + e.message); }
    try { var r11 = await tryBackup('sq', sqSearch, sqUrl, musicItem); if (r11 && r11.url) return r11; } catch (e) { errs.push('sq:' + e.message); }
    try { var r12a = await tryBackup('xiaomifeng', xmSearch, xmUrl, musicItem); if (r12a && r12a.url) return r12a; } catch (e) { errs.push('xiaomifeng:' + e.message); }
    try { var r12b = await tryBackup('yinwe', ywSearch, ywUrl, musicItem); if (r12b && r12b.url) return r12b; } catch (e) { errs.push('yinwe:' + e.message); }

    // ⑬ 极端末位：布谷音乐 buguyy.top（酷我镜像，前 12 层均失效时的最后兜底）
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
    // 新增：MyFreeMP3 / 音乐搜索神器 歌词兜底（自带 lrc，含身份校验）
    try { var mfL = await mfGetLyric(musicItem); if (mfL && mfL.rawLrc) return { rawLrc: mfL.rawLrc }; } catch (e) {}
    try { var sqL = await sqGetLyric(musicItem); if (sqL && sqL.rawLrc) return { rawLrc: sqL.rawLrc }; } catch (e) {}
    // 末位兜底：布谷音乐 buguyy.top
    try { var bl = await bgGetLyric(musicItem); if (bl && bl.rawLrc) return { rawLrc: bl.rawLrc }; } catch (e) {}
    return { rawLrc: '' };
  }

  // ============================ 歌单曲目（全量，支持大歌单） ============================
  // ============================ 歌单曲目缓存 + 大歌单节流 ============================
  // v0.1.1 第二批：歌单详情按 sheet.id 缓存（避免每翻一页都重新拉全量 trackIds + 分批 /song/detail），
  //   大歌单（trackIds > 阈值）分批取 /song/detail 时加请求间隔，避免服务端 460/限流。
  // v0.1.3：/playlist/detail 显式传 limit(大值)，修复「推荐歌单/精品歌单只能取前 10 首」：
  //   网易云未加密接口对推荐/精品歌单在未传 limit 时默认仅回前 ~10 首 tracks 且 trackIds 可能缺失，
  //   旧逻辑走 tracks.map 直接分支被静默截断为前 10 首；传大 limit 后 tracks 直接回全量。
  var _sheetCache = {};                 // id -> { at, songs }
  var SHEET_CACHE_TTL = 5 * 60 * 1000; // 5 分钟（翻页期间命中，超时后自动回源）
  var SHEET_THROTTLE_MS = 200;         // 大歌单分批间隔（毫秒）
  var SHEET_THROTTLE_THRESHOLD = 200;  // trackIds 超过该值才间隔（小歌单不打扰、不延迟）
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function getPlaylistSongs(id) {
    var key = String(id);
    var cached = _sheetCache[key];
    if (cached && (Date.now() - cached.at) < SHEET_CACHE_TTL) return cached.songs; // 命中缓存，零重复请求
    // v0.1.3：显式传 limit 拉全量 tracks（推荐/精品歌单未传 limit 时接口默认仅回前 ~10 首）
    var detail = toObj(await nget('/playlist/detail', { id: key, limit: 1000, offset: 0 }));
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
    version: '0.1.4',
    author: 'tianpeng + 优化(下沉 qq.js v0.1.8 三态校验)',
    description: '网易云音乐音源：支持歌单导入（含大歌单全量+分页缓存）、热门歌单、官方排行榜，附带搜索/歌词/取链。' +
      '全部走免加密官方 /api 接口；VIP/付费曲目免费态仅返回约 30 秒试听片段（版权限制）。' +
      'v0.1.1：下沉 qq.js v0.1.8 三态身份校验修复「同名异版错播」（无安全候选一律拒绝错播，不再回退未过滤列表）；' +
      '取链四层兜底【官方 → 无名音乐网 mvmp3（①首选）→ 歌曲宝 gequbao（②次选）→ 布谷音乐 buguyy.top（③兜底）】，最大化可播率。' +
      'v0.1.1 第四批：新增官方接口监控埋点（连续 5 次失败告警；weapi 加密兜底暂缓）。' +
      'v0.1.1 第五批：官方 /api 偶发 460/429/5xx 失败指数退避重试（1s→2s→4s），其余错误立即抛出不重试。' +
      'v0.1.3：修复「推荐歌单/精品歌单只能获取前 10 首」——/playlist/detail 显式传 limit(1000)，使 tracks 直接回全量曲目，' +
      '不再因接口默认仅回前 ~10 首且 trackIds 缺失而被静默截断；大歌单(>1000)仍走 trackIds 分批 /song/detail 兜底。',
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@v0.1.4/musicfree-wy/github/wy.js',
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
      // 第二批：内联备选源诊断接口（与 kw.js 一致，供联网实测/运维逐源验证；不含 buguyy⑬，其走 bg* 既有路径）
      _backups: {
        qeecc: { search: qeSearch, url: qeUrl },
        gequhai: { search: ghSearch, url: ghUrl },
        gequke: { search: gkSearch, url: gkUrl },
        fengli: { search: flSearch, url: flUrl },
        liusheng: { search: lsSearch, url: lsUrl },
        gd: { search: gdSearch, url: gdUrl },
        myfree: { search: mfSearch, url: mfUrl },
        xiage: { search: xgSearch, url: xgUrl },
        sq: { search: sqSearch, url: sqUrl },
        xiaomifeng: { search: xmSearch, url: xmUrl },
        yinwe: { search: ywSearch, url: ywUrl },
        tryBackup: tryBackup,
      },
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
