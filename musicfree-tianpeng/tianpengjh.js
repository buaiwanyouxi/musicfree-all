// tianpengjh.js —— 天蓬聚合插件（自动生成，请勿手改；改源后重跑 build_tianpengjh.mjs）
// 合并音源：tp-kg / tp-kw / tp-qq / tp-qs / tp-wy / tp-bili
// 顶层 platform = TianPengJH；各源以 tp- 前缀独立标识，登录态按源隔离。

// ===== 源：tp-kg（来自 musicfree-kg/kg.js，内联，platform=tp-kg）=====
var TP_KG = (function () {
  var module = { exports: {} };
  var exports = module.exports;

  var reqFn = (
    typeof __musicfree_require !== 'undefined' ? __musicfree_require :
    (typeof require !== 'undefined' ? require : null)
  );
  if (!reqFn) throw new Error('[kugou-mvmp3] 插件沙箱未提供 require，无法加载');
  var axios = reqFn('axios');

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
        'Referer': MV_BASE + '/mp3/' + hash + '.html', // 这是给 play.php 接口用的，不是给音频 CDN 的
        'Cookie': cookie,
      },
      timeout: 9000,
      validateStatus: function () { return true; },
    });
    return r.data;
  }

  async function mvSearch(keyword, cookie) {
    var r = await axios.get(MV_BASE + '/so/' + encodeURIComponent(keyword || '') + '.html', {
      headers: { ...MV_HEADERS, 'Cookie': cookie },
      timeout: 9000,
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
    var ordered = mvRank(items, musicItem);
    if (!ordered.length) ordered = items;
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
    var ordered = mvRank(items, musicItem);
    if (!ordered.length) ordered = items;
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
      timeout: 9000,
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

  // ============================ 三层组合取链 / 歌词 ============================
  async function getMediaSource(musicItem, quality) {
    var errors = [];

    // 1) 酷狗官方
    try {
      const kg = await kugouGetMediaSource(musicItem);
      if (kg && kg.url && /^https?:\/\//i.test(kg.url)) {
        try {
          const head = await axios.head(kg.url, { timeout: 4000, validateStatus: function () { return true; } });
          const ct = (head.headers && head.headers['content-type']) || '';
          const ok = head.status >= 200 && head.status < 400 && /audio|mp4|octet|mpeg/i.test(ct || 'audio');
          if (ok) return { url: kg.url, rawLrc: kg.rawLrc, artwork: kg.artwork, headers: { Referer: 'https://www.kugou.com/' } };
        } catch (e) {
          return { url: kg.url, rawLrc: kg.rawLrc, artwork: kg.artwork, headers: { Referer: 'https://www.kugou.com/' } };
        }
      }
    } catch (e) { errors.push('酷狗:' + e.message); }

    // 2) 无名音乐网 mvmp3（不带 Referer 返回，否则 kuwo CDN 403）
    try {
      const src = await mvGetMediaSource(musicItem);
      if (src && src.url) return src;
    } catch (e) { errors.push('无名音乐网:' + e.message); }

    // 3) 歌曲宝 gequbao（无需每小时验证，作为 mvmp3 Cookie 过期时的兜底）
    //    按“歌名”搜索（组合“歌名 歌手”在歌曲宝会返回 0 结果）；结果按 歌名+歌手 排序取最优。
    try {
      const q = (musicItem.title || '').trim();
      const g = await gbSearch(q);
      if (g && g.length) {
        const ranked = mvRank(g, musicItem);
        const ordered = ranked.length ? ranked : g;
        const url = await gbGetPlayUrl(ordered[0].id);
        if (url) return { url: url, rawLrc: '', artwork: musicItem.coverImg || musicItem.artwork || '' };
      }
    } catch (e) { errors.push('歌曲宝:' + e.message); }

    var songName = (musicItem.title || '') + (musicItem.artist ? '（' + musicItem.artist + '）' : '');
    var msg = '酷狗、无名音乐网、歌曲宝三层均未能取得《' + songName + '》的音源。';
    msg += '①酷狗官方接口已无免费直链；②无名音乐网取链失败（详见上）；③歌曲宝曲库未收录该版本（多为翻唱）。';
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
      if (g && g.length) {
        const ranked = mvRank(g, musicItem);
        const ordered = ranked.length ? ranked : g;
        const l = await gbGetLyric(ordered[0].id);
        if (l && l.rawLrc) return l;
      }
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
    platform: 'tp-kg',
    version: '0.0.9',
    author: 'tianpeng',
    description: '酷狗官方 + 无名音乐网(mvmp3，自动过人机验证) + 歌曲宝(gequbao) 三层兜底取链；' +
      '支持酷狗歌单导入、官方排行榜（按热歌/地区/特色/全球/曲风分层）与热门榜单；' +
      '热门歌单广场（分类标签浏览酷狗歌单）。' +
      'v0.0.9 修复：歌单详情/导入取歌改用 mobilecdn special/song JSON 接口，解决点进歌单歌曲空白。',
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfreemusicfree-all@main/musicfree-kg/kg.js',
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
    ],
    hints: {
      getMediaSource: [
        '无名音乐网(mvmp3)的人机验证由插件自动完成，无需你手动操作；会话约 50 分钟自动刷新一次。',
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
  };

  if (typeof module !== 'undefined' && module && module.exports) module.exports = plugin;
  if (typeof exports !== 'undefined') exports.default = plugin;
  return plugin;

  return module.exports;
})();

// ===== 源：tp-kw（来自 musicfree-kw/kw.js，内联，platform=tp-kw）=====
var TP_KW = (function () {
  var module = { exports: {} };
  var exports = module.exports;

  var reqFn = (
    typeof __musicfree_require !== 'undefined' ? __musicfree_require :
    (typeof require !== 'undefined' ? require : null)
  );
  if (!reqFn) throw new Error('[kw] 插件沙箱未提供 require，无法加载');
  var axios = reqFn('axios');
  var he = reqFn('he');

  var PAGE_SIZE = 30;

  // 音质映射：插件档位 -> 代理 level 参数
  var PLUGIN_QUALITY_MAP = { low: '128k', standard: '320k', high: 'flac', super: 'flac' };
  var QUALITY_MAP = { '128k': 'standard', '320k': 'exhigh', 'flac': 'lossless' };
  var PROXY_BASE = 'https://music.nxinxz.com';

  // ============================ 工具 ============================
  function decode(s) { return he.decode(s || ''); }

  // 酷我专辑封面短链 -> 长链
  function artworkShort2Long(albumpicShort) {
    if (!albumpicShort) return undefined;
    var idx = albumpicShort.indexOf('/');
    return idx !== -1
      ? 'https://img4.kuwo.cn/star/albumcover/1080' + albumpicShort.slice(idx)
      : undefined;
  }

  // 部分接口 Content-Type 非 JSON，axios 会把数据当字符串返回，这里统一解析
  function toObj(d) {
    if (typeof d === 'string') { try { return JSON.parse(d); } catch (e) { return {}; } }
    return d || {};
  }

  // ============================ 搜索 ============================
  function formatMusicItem(_) {
    return {
      id: _.MUSICRID ? String(_.MUSICRID).replace('MUSIC_', '') : _.id,
      artwork: artworkShort2Long(_.web_albumpic_short),
      title: decode(_.NAME || _.name || ''),
      artist: decode(_.ARTIST || _.artist || ''),
      album: decode(_.ALBUM || _.album || ''),
      albumId: _.ALBUMID || _.albumid,
      artistId: _.ARTISTID || _.artistid,
      formats: _.FORMATS || _.formats,
    };
  }
  function formatAlbumItem(_) {
    return {
      id: _.albumid,
      artist: decode(_.artist || ''),
      title: decode(_.name || ''),
      artwork: _.img || artworkShort2Long(_.pic),
      description: decode(_.info || ''),
      date: _.pub,
      artistId: _.artistid,
    };
  }
  function formatArtistItem(_) {
    return {
      id: _.ARTISTID,
      avatar: _.hts_PICPATH,
      name: decode(_.ARTIST || ''),
      artistId: _.ARTISTID,
      description: decode(_.desc || ''),
      worksNum: _.SONGNUM,
    };
  }
  function formatMusicSheet(_) {
    return {
      id: _.playlistid,
      title: decode(_.name || ''),
      artist: decode(_.nickname || ''),
      artwork: _.pic,
      playCount: _.playcnt,
      description: decode(_.intro || ''),
      worksNum: _.songnum,
    };
  }

  async function searchMusic(query, page) {
    const res = toObj((await axios.get('http://search.kuwo.cn/r.s', {
      params: {
        client: 'kt', all: query, pn: page - 1, rn: PAGE_SIZE, uid: 2574109560,
        ver: 'kwplayer_ar_8.5.4.2', vipver: 1, ft: 'music', cluster: 0, strategy: 2012,
        encoding: 'utf8', rformat: 'json', vermerge: 1, mobi: 1,
      },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const songs = (res.abslist || []).map(formatMusicItem);
    return { isEnd: (+res.PN + 1) * +res.RN >= +res.TOTAL, data: songs };
  }
  async function searchAlbum(query, page) {
    const res = toObj((await axios.get('http://search.kuwo.cn/r.s', {
      params: { all: query, ft: 'album', itemset: 'web_2013', client: 'kt', pn: page - 1, rn: PAGE_SIZE, rformat: 'json', encoding: 'utf8', pcjson: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    return { isEnd: (+res.PN + 1) * +res.RN >= +res.TOTAL, data: (res.albumlist || []).map(formatAlbumItem) };
  }
  async function searchArtist(query, page) {
    const res = toObj((await axios.get('http://search.kuwo.cn/r.s', {
      params: { all: query, ft: 'artist', itemset: 'web_2013', client: 'kt', pn: page - 1, rn: PAGE_SIZE, rformat: 'json', encoding: 'utf8', pcjson: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    return { isEnd: (+res.PN + 1) * +res.RN >= +res.TOTAL, data: (res.abslist || []).map(formatArtistItem) };
  }
  async function searchMusicSheet(query, page) {
    const res = toObj((await axios.get('http://search.kuwo.cn/r.s', {
      params: { all: query, ft: 'playlist', itemset: 'web_2013', client: 'kt', pn: page - 1, rn: PAGE_SIZE, rformat: 'json', encoding: 'utf8', pcjson: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    return { isEnd: (+res.PN + 1) * +res.RN >= +res.TOTAL, data: (res.abslist || []).map(formatMusicSheet) };
  }

  // ============================ 取链（念心社区代理） ============================
  // 说明：酷我官方免费 antiserver 接口实测对任一 rid 均返回同一首歌（已失效），
  // 故沿用社区公认的稳定代理 music.nxinxz.com/kw.php（直接返回酷我真实音频流）。
  async function getMediaSource(musicItem, quality) {
    const userQuality = PLUGIN_QUALITY_MAP[quality] || '128k';
    // 注意：代理 music.nxinxz.com 的 level 参数只认 kuwo 内部档位
    // standard / exhigh / lossless（传 128k/320k/flac 均被忽略，固守同一固定音质）。
    // 故这里传 QUALITY_MAP 映射后的档位，与念心插件保持一致。
    const apiLevel = QUALITY_MAP[userQuality];
    if (!apiLevel) throw new Error('不支持的音质: ' + quality);
    const songId = musicItem.id;
    if (!songId) throw new Error('找不到歌曲ID');
    const url = PROXY_BASE + '/kw.php?id=' + encodeURIComponent(songId) + '&level=' + encodeURIComponent(apiLevel) + '&type=mp3';
    return { url };
  }

  // ============================ 歌词 ============================
  async function getLyric(musicItem) {
    const res = toObj((await axios.get('http://m.kuwo.cn/newh5/singles/songinfoandlrc', {
      params: { musicId: musicItem.id, httpStatus: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const list = res.data && res.data.lrclist;
    if (!list || !list.length) return { rawLrc: '' };
    return { rawLrc: list.map(function (_) { return '[' + _.time + ']' + _.lineLyric; }).join('\n') };
  }

  // ============================ 专辑 / 歌手 ============================
  async function getAlbumInfo(albumItem) {
    const res = toObj((await axios.get('http://search.kuwo.cn/r.s', {
      params: { pn: 0, rn: 100, albumid: albumItem.id, stype: 'albuminfo', sortby: 0, alflac: 1, show_copyright_off: 1, pcmp4: 1, encoding: 'utf8', plat: 'pc', thost: 'search.kuwo.cn', vipver: 'MUSIC_9.1.1.2_BCS2', devid: '38668888', newver: 1, pcjson: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const songs = (res.musiclist || []).map(function (_) {
      return {
        id: _.id, artwork: albumItem.artwork || res.img,
        title: decode(_.name || ''), artist: decode(_.artist || ''),
        album: decode(_.album || ''), albumId: albumItem.id, artistId: _.artistid, formats: _.formats,
      };
    });
    return { musicList: songs };
  }
  async function getArtistMusicWorks(artistItem, page) {
    const res = toObj((await axios.get('http://search.kuwo.cn/r.s', {
      params: { pn: page - 1, rn: PAGE_SIZE, artistid: artistItem.id, stype: 'artist2music', sortby: 0, alflac: 1, show_copyright_off: 1, pcmp4: 1, encoding: 'utf8', plat: 'pc', thost: 'search.kuwo.cn', vipver: 'MUSIC_9.1.1.2_BCS2', devid: '38668888', newver: 1, pcjson: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const songs = (res.musiclist || []).map(function (_) {
      return {
        id: _.musicrid, artwork: artworkShort2Long(_.web_albumpic_short),
        title: decode(_.name || ''), artist: decode(_.artist || ''),
        album: decode(_.album || ''), albumId: _.albumid, artistId: _.artistid, formats: _.formats,
      };
    });
    return { isEnd: (+res.pn + 1) * PAGE_SIZE >= +res.total, data: songs };
  }
  async function getArtistAlbumWorks(artistItem, page) {
    const res = toObj((await axios.get('http://search.kuwo.cn/r.s', {
      params: { pn: page - 1, rn: PAGE_SIZE, artistid: artistItem.id, stype: 'albumlist', sortby: 1, alflac: 1, show_copyright_off: 1, pcmp4: 1, encoding: 'utf8', plat: 'pc', thost: 'search.kuwo.cn', vipver: 'MUSIC_9.1.1.2_BCS2', devid: '38668888', newver: 1, pcjson: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    return { isEnd: (+res.pn + 1) * PAGE_SIZE >= +res.total, data: (res.albumlist || []).map(formatAlbumItem) };
  }
  async function getArtistWorks(artistItem, page, type) {
    if (type === 'album') return await getArtistAlbumWorks(artistItem, page);
    return await getArtistMusicWorks(artistItem, page);
  }
  async function getMusicInfo(musicItem) {
    const res = toObj((await axios.get('http://m.kuwo.cn/newh5/singles/songinfoandlrc', {
      params: { musicId: musicItem.id, httpStatus: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const originalUrl = res.data && res.data.songinfo && res.data.songinfo.pic;
    if (!originalUrl) return {};
    var picUrl = originalUrl;
    if (originalUrl.indexOf('starheads/') > -1) picUrl = originalUrl.replace(/starheads\/\d+/, 'starheads/800');
    else if (originalUrl.indexOf('albumcover/') > -1) picUrl = originalUrl.replace(/albumcover\/\d+/, 'albumcover/800');
    return { artwork: picUrl };
  }

  // ============================ 排行榜 ============================
  async function getTopLists() {
    const res = toObj((await axios.get('http://wapi.kuwo.cn/api/pc/bang/list', {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const child = res.child || [];
    return child.map(function (e) {
      return {
        title: e.disname,
        data: (e.child || []).map(function (_) {
          return {
            id: String(_.sourceid),
            coverImg: _.pic5 || _.pic2 || _.pic,
            title: _.name,
            description: _.intro,
          };
        }),
      };
    });
  }
  async function getTopListDetail(topListItem, page) {
    const res = toObj((await axios.get('http://kbangserver.kuwo.cn/ksong.s', {
      params: {
        from: 'pc', fmt: 'json', pn: (page || 1) - 1, rn: 100, type: 'bang', data: 'content',
        id: topListItem.id, show_copyright_off: 0, pcmp4: 1, isbang: 1, userid: 0, httpStatus: 1,
      },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const musicList = (res.musiclist || []).map(function (_) {
      return {
        id: String(_.id),
        title: decode(_.name || ''),
        artist: decode(_.artist || ''),
        album: decode(_.album || ''),
        albumId: _.albumid,
        artistId: _.artistid,
        formats: _.formats,
      };
    });
    return Object.assign({}, topListItem, { isEnd: true, musicList: musicList });
  }

  // ============================ 热门歌单（标签 + 歌单） ============================
  async function getRecommendSheetTags() {
    const res = toObj((await axios.get('http://wapi.kuwo.cn/api/pc/classify/playlist/getTagList', {
      params: { cmd: 'rcm_keyword_playlist', user: 0, prod: 'kwplayer_pc_9.0.5.0', vipver: '9.0.5.0', source: 'kwplayer_pc_9.0.5.0', loginUid: 0, loginSid: 0, appUid: 76039576 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const data = (res.data || []).map(function (group) {
      return {
        title: group.name,
        data: (group.data || []).map(function (_) {
          return { id: String(_.id), digest: _.digest, title: _.name };
        }),
      };
    }).filter(function (item) { return item.data.length; });
    const pinned = [
      { id: '1848', title: '翻唱', digest: '10000' },
      { id: '621', title: '网络', digest: '10000' },
      { id: '146', title: '伤感', digest: '10000' },
      { id: '35', title: '欧美', digest: '10000' },
    ];
    return { data: data, pinned: pinned };
  }
  async function getRecommendSheetsByTag(tag, page) {
    const ps = 20;
    var res;
    if (tag && tag.id) {
      if (tag.digest === '10000') {
        // 固定精选标签（翻唱/网络/伤感/欧美等）走 PC 标签接口
        res = toObj((await axios.get('http://wapi.kuwo.cn/api/pc/classify/playlist/getTagPlayList', {
          params: { loginUid: 0, loginSid: 0, appUid: 76039576, pn: (page || 1) - 1, id: tag.id, rn: ps },
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
          timeout: 10000, validateStatus: function () { return true; },
        })).data).data;
      } else {
        // 普通标签（digest 非 10000）走移动端聚合接口，结果按 list 展开
        const erData = toObj((await axios.get('http://mobileinterfaces.kuwo.cn/er.s', {
          params: { type: 'get_pc_qz_data', f: 'web', id: tag.id, prod: 'pc' },
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
          timeout: 10000, validateStatus: function () { return true; },
        })).data);
        const merged = (Array.isArray(erData) ? erData : []).reduce(function (prev, curr) {
          return prev.concat(curr.list || []);
        }, []);
        res = { total: 0, data: merged };
      }
    } else {
      // 无标签：推荐/热门歌单
      res = toObj((await axios.get('https://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList', {
        params: { loginUid: 0, loginSid: 0, appUid: 76039576, pn: (page || 1) - 1, rn: ps, order: 'hot' },
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
        timeout: 10000, validateStatus: function () { return true; },
      })).data).data;
    }
    const list = res.data || [];
    return {
      isEnd: (page || 1) * ps >= (res.total || 0),
      data: list.map(function (_) {
        return {
          title: decode(_.name || ''),
          artist: decode(_.uname || ''),
          id: String(_.id),
          artwork: _.img,
          playCount: _.listencnt,
          createUserId: _.uid,
        };
      }),
    };
  }

  // ============================ 歌单导入 / 详情 ============================
  async function getMusicSheetResponseById(id, page, pagesize) {
    const res = toObj((await axios.get('http://nplserver.kuwo.cn/pl.svc', {
      params: {
        op: 'getlistinfo', pid: id, pn: (page || 1) - 1, rn: pagesize || PAGE_SIZE,
        encode: 'utf8', keyset: 'pl2012', vipver: 'MUSIC_9.1.1.2_BCS2', newver: 1,
      },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    // 注意：nplserver 返回键为小写 musiclist
    return { total: res.total || 0, musicList: res.musiclist || [] };
  }

  function parseKuwoSheetId(urlLike) {
    if (!urlLike) return null;
    var s = String(urlLike).trim();
    var m;
    if ((m = s.match(/playlist_detail\/(\d+)/i))) return m[1];
    if ((m = s.match(/h5app\/playlist\/(\d+)/i))) return m[1];
    if ((m = s.match(/^\s*(\d+)\s*$/))) return m[1];
    return null;
  }

  async function importMusicSheet(urlLike) {
    var id = parseKuwoSheetId(urlLike);
    if (!id) return; // 无法识别则交还空（MusicFree 会提示）
    var musicList = [];
    var page = 1;
    var totalPage = 2;
    while (page <= totalPage) {
      try {
        var data = await getMusicSheetResponseById(id, page, 80);
        totalPage = Math.max(1, Math.ceil((data.total || 0) / 80));
        data.musicList.forEach(function (_) {
          musicList.push({
            id: String(_.id),
            title: decode(_.name || ''),
            artist: decode(_.artist || ''),
            album: decode(_.album || ''),
            albumId: _.albumid,
            artistId: _.artistid,
            formats: _.formats,
          });
        });
      } catch (e) {}
      ++page;
      if (page > 30) break; // 安全上限
    }
    return musicList;
  }

  async function getMusicSheetInfo(sheet, page) {
    var res = await getMusicSheetResponseById(sheet.id, page, PAGE_SIZE);
    return {
      isEnd: (page || 1) * PAGE_SIZE >= (res.total || 0),
      musicList: (res.musicList || []).map(function (_) {
        return {
          id: String(_.id),
          title: decode(_.name || ''),
          artist: decode(_.artist || ''),
          album: decode(_.album || ''),
          albumId: _.albumid,
          artistId: _.artistid,
          formats: _.formats,
        };
      }),
      sheetItem: sheet,
    };
  }

  // ============================ 导出 ============================
  var plugin = {
    platform: 'tp-kw',
    version: '0.0.1',
    author: 'tianpeng',
    description: '酷我音源：支持歌单导入、热门歌单、官方排行榜，附带搜索/歌词/专辑/歌手。' +
      '取链使用社区代理 music.nxinxz.com（酷我官方免费接口已失效）。',
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfreemusicfree-all@main/musicfree-kw/kw.js',
    cacheControl: 'no-cache',
    hints: {
      importMusicSheet: [
        '酷我APP：自建歌单-分享-复制试听链接，直接粘贴即可',
        'H5：复制URL并粘贴，或者直接输入纯数字歌单ID即可',
        '导入时间和歌单大小有关，请耐心等待',
      ],
    },
    supportedSearchType: ['music', 'album', 'sheet', 'artist'],
    async search(query, page, type) {
      if (type === 'music') return await searchMusic(query, page);
      if (type === 'album') return await searchAlbum(query, page);
      if (type === 'artist') return await searchArtist(query, page);
      if (type === 'sheet') return await searchMusicSheet(query, page);
      return { isEnd: true, data: [] };
    },
    getMediaSource: getMediaSource,
    getMusicInfo: getMusicInfo,
    getAlbumInfo: getAlbumInfo,
    getLyric: getLyric,
    getArtistWorks: getArtistWorks,
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

  return module.exports;
})();

// ===== 源：tp-qq（来自 musicfree-qq/qq.js，内联，platform=tp-qq）=====
var TP_QQ = (function () {
  var module = { exports: {} };
  var exports = module.exports;

  var reqFn = (typeof __musicfree_require !== 'undefined') ? __musicfree_require : require;
  var axios = reqFn('axios');
  // 无名音乐网(mvmp3) 搜索结果解析采用「纯正则」实现，不依赖 cheerio —— 移动端沙箱不注入 cheerio，
  // 若用 cheerio.load 解析则移动端兜底音源完全失效（解析返回空 → 取链失败 → 非免费曲在歌单/排行榜连续
  // 播放时易触发崩溃）。纯正则解析在桌面端/移动端一致可用，故彻底移除 cheerio 依赖。

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
    try { var v = (typeof env !== 'undefined' && env && env.getUserVariables && env.getUserVariables()); return (v && v['tp-qq_cookie']) || ''; }
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
    var r1 = await axios.get(MV_BASE + '/', { headers: MV_HEADERS, timeout: 9000, validateStatus: function () { return true; } });
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
  // 纯正则解析：每条结果形如 <a href="/mp3/<32hex>.html" ...><img ... alt="歌名/歌手 - 曲名">...
  // 不依赖 cheerio，移动端沙箱缺 cheerio 时也能正常解析（这是移动端首选备用音源可用的关键）。
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
      items.push({ id: id, title: title, artist: artist });
    }
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
      .then(function (r) { return r.data; })
      .catch(function () { return null; });
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
  // 播放链安全闸门：仅放行「绝对 http(s) 直链」且非 HLS(.m3u8/.m3u) 的 URL。
  // 兜底音源（mvmp3 / Tonzhon）偶会回吐 HTML 页面、相对路径或 HLS 流，直接交给原生播放器会触发
  // 原生层崩溃（闪退）；此处一律拒之门外，让 getMediaSource 干净抛错（MusicFree 捕获后仅提示“播放失败”）。
  function safeUrl(u) {
    if (!u || typeof u !== 'string') return null;
    u = String(u).trim();
    if (!/^https?:\/\//i.test(u)) return null;                                  // 拒绝相对/协议相对/blob/data
    if (/\.m3u8(\?|$)/i.test(u) || /\.m3u(\?|$)/i.test(u)) return null;         // 拒绝 HLS（原生播放器易崩）
    return u;                                                                    // 原样返回：官方明文 http 与兜底 https 均经实测可播，不做 forceHttps（那会重新引入 TLS 崩溃）
  }
  // 播放前“可播放性”实时探测（兜底安全网）：仅当响应【明确不是音频】(404/403 或 text/html) 才判不可用，
  // 让上层继续走下一个兜底源；网络错误(超时/DNS)则“信任放行”，避免误杀本可播放的链。
  // 这样即便某 CDN 节点对错误 vkey 回 HTML，也绝不会把崩溃性 URL 交给原生播放器。
  async function validatePlayable(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      var r = await axios.get(url, {
        headers: { 'User-Agent': CHROME_UA, Referer: 'https://y.qq.com/', Range: 'bytes=0-0' },
        timeout: 7000, validateStatus: function () { return true; }, maxRedirects: 5,
      });
      var st = r.status;
      var ct = (r.headers && r.headers['content-type']) || '';
      if (st >= 200 && st < 300 && /audio|video|application\/octet-stream/i.test(ct)) return true;
      if (st === 404 || st === 403) return false;
      if (/text\/html/i.test(ct)) return false;
      return true; // 5xx / 其他保守放行
    } catch (e) { return true; } // 网络层异常：信任，不阻断播放
  }
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
  // 与官方 maotoumao/MusicFreePlugins qq.js 的 getSourceUrl 逐字节对齐的“质量→文件前缀”映射
  var QQ_TYPE_MAP = {
    m4a:      { s: 'C400', e: '.m4a' },
    '128':    { s: 'M500', e: '.mp3' },
    standard: { s: 'M500', e: '.mp3' },
    low:      { s: 'M500', e: '.mp3' },
    '320':    { s: 'M800', e: '.mp3' },
    high:     { s: 'M800', e: '.mp3' },
    ape:      { s: 'A000', e: '.ape' },
    flac:     { s: 'F000', e: '.flac' },
  };
  // 官方 QQ 取链（免费曲返回完整链；VIP/试听曲官方不给链）
  // 关键：vkey 请求必须与官方逐字节对齐——uin 用空串、guid 随机、filename 为「前缀+mid+mid+后缀」
  // （官方即把 id 拼两次）、comm 含 authst:''。此前我方用 uin='0'/固定 guid/单 id 文件名，导致返回的
  // vkey 与 CDN 实际文件 src 不匹配 → CDN 回 403/HTML → 原生播放器崩溃。这恰是前面 5 次修复
  // （cheerio/http/headers/songmid/safeUrl）全部漏掉、且每次都复现的真正根因。
  async function qqOfficialGetUrl(mid, quality) {
    var typeKey = (quality === 'high' || quality === '320' || quality === 'flac') ? '320'
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
    // 与官方一致：优先取非 http://ws 开头的 sip，否则取首个；返回明文 http（不做 forceHttps）
    var domain = (sub.sip || []).find(function (i) { return !i.startsWith('http://ws'); }) || (sub.sip && sub.sip[0]) || '';
    return domain + purl;
  }
  async function getMediaSource(musicItem, quality) {
    var mid = String(musicItem.songmid || musicItem.id || '');
    var name = (musicItem.title || '') + (musicItem.artist ? '（' + musicItem.artist + '）' : '');
    var errs = [];
    // 1) 官方 QQ 取链（vkey 构造已对齐官方；返回明文 http，不带 headers）
    if (mid) {
      try {
        var official = await qqOfficialGetUrl(mid, quality);
        // 经 safeUrl(过滤 HLS/非法链) + 实时可播放探测双闸门，确保交给播放器的必是可放音频；
        // 即便某 CDN 节点对错误 vkey 回 HTML，也不会把崩溃性 URL 交给原生播放器。
        var offU = safeUrl(official);
        if (offU && await validatePlayable(offU)) return { url: offU };
        if (offU) errs.push('QQ官方:链不可播放(已跳过)');
      } catch (e) { errs.push('QQ官方:' + e.message); }
    }
    // 2) 首选备用：无名音乐网 mvmp3（自动过人机验证）
    try {
      var mv = await mvGetMediaSource(musicItem);
      var mvU = mv && mv.url ? safeUrl(mv.url) : null;
      if (mvU && await validatePlayable(mvU)) return { url: mvU }; // 不带 Referer（否则 CDN 403）
      if (mvU) errs.push('mvmp3:链不可播放(已跳过)');
    } catch (e) { errs.push('mvmp3:' + e.message); }
    // 3) 次选备用：Tonzhon 网易云匹配（tonzhon 搜索发现 + 网易云 weapi 取链）
    try {
      var tz = await getNeteaseUrlForQuery((musicItem.title || '').trim(), (musicItem.artist || '').trim());
      var tzU = tz ? safeUrl(tz) : null;
      if (tzU && await validatePlayable(tzU)) return { url: tzU };
      if (tzU) errs.push('Tonzhon:链不可播放(已跳过)');
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
    platform: 'tp-qq',
  version: '0.0.8',
  author: 'tianpeng',
    description: 'QQ音乐（腾讯系）音源：搜索/歌词/排行榜/热门歌单/歌单导入。' +
      '浏览类功能（搜索、歌词、排行榜、热门歌单、歌单导入）均走免签旧版 cgi-bin 端点；' +
      '播放取链三层兜底：①官方QQ(CgiGetVkey，需登录Cookie解锁) → ②首选备用 无名音乐网mvmp3(自动过人机验证) → ③次选备用 Tonzhon网易云匹配(tonzhon.com搜索+weapi取链，覆盖QQ的VIP/试听失效曲)。',
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfreemusicfree-all@main/musicfree-qq/qq.js',
    cacheControl: 'no-cache',
    supportedSearchType: ['music'],
    userVariables: [
      {
        key: 'tp-qq_cookie',
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
    getRecommendSheetDetail: getMusicSheetInfo, // 别名：部分版本 MusicFree 用此名拉取推荐/热门歌单详情
  };

  return module.exports;
})();

// ===== 源：tp-qs（来自 musicfree-qs/qs.js，内联，platform=tp-qs）=====
var TP_QS = (function () {
  var module = { exports: {} };
  var exports = module.exports;

  var reqFn = (typeof __musicfree_require !== 'undefined') ? __musicfree_require : require;
  var axios = reqFn('axios');

  // ---------- 端点 ----------
  var SEARCH_API = 'https://api-vehicle.volcengine.com/v2/search/type';
  var CONTENT_API = 'https://api-vehicle.volcengine.com/v2/custom/contents';
  var SEO_TRACK = 'https://beta-luna.douyin.com/luna/h5/seo_track';
  var CHARTS_API = 'https://api5-lf.qishui.com/luna/charts/';
  var PLAYLIST_API = 'https://api5-lf.qishui.com/luna/playlist/detail?charge=0';
  var DISCOVER_API = 'https://api5-lq.qishui.com/luna/discover/mix?charge=0';

  var CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36';
  var QISHUI_UA = 'com.luna.music/100159040 (Linux; U; Android 11; zh_CN; Cronet/TTNetVersion:dd1b0931 2024-06-28 QuicVersion:d299248d 2024-04-09)';

  // ---------- 工具 ----------
  function toObj(d) {
    if (typeof d === 'string') { try { return JSON.parse(d); } catch (e) { return {}; } }
    return d || {};
  }
  function getCookie() {
    try { var v = (typeof env !== 'undefined' && env && env.getUserVariables && env.getUserVariables()); return (v && v['tp-qs_cookie']) || ''; }
    catch (e) { return ''; }
  }
  // 给需要签名的 qishui 接口附加可选 cookie（用户若提供汽水会话 cookie，可能解锁更多接口）
  function qHeaders() {
    var h = {
      'Accept': '*/*',
      'Content-Type': 'application/json; charset=UTF-8',
      'User-Agent': QISHUI_UA,
      'X-Argus': '=',
      'x-common-params-v2': 'channel=appstore&aid=8478&device_id=1100210274091033',
    };
    var ck = getCookie();
    if (ck) h['Cookie'] = ck;
    return h;
  }

  // 封面重构：汽水 album.url_cover = {uri, urls:[base], template_prefix}
  function artworkFromCover(c) {
    if (!c) return '';
    if (typeof c === 'string') return c;
    if (c.url) return c.url;
    if (c.cover_url) return c.cover_url;
    if (c.pic_url) return c.pic_url;
    if (c.url_cover) {
      var uc = c.url_cover;
      if (typeof uc === 'string') return uc;
      if (uc.urls && uc.urls[0] && uc.uri) {
        return uc.urls[0] + uc.uri + '~' + (uc.template_prefix || 'tplv-b829550vbb') + '-resize:960:960.png';
      }
    }
    return '';
  }
  // 统一字段映射（覆盖 charts / playlist / search 多种形态）
  function formatTrack(it) {
    if (!it) return null;
    var artists = it.artists || it.artist_list || [];
    var artist = it.artist;
    if (!artist && artists.length) artist = artists.map(function (a) { return a.name || a; }).join('/');
    if (!artist && it.artist_info) artist = it.artist_info.name;
    var album = it.album || (it.album_info && it.album_info.name) || '';
    var artwork = artworkFromCover(it.artwork || it.album || it.cover_url || it.pic_url);
    var dur = it.duration;
    if (dur && dur < 1000) dur = dur * 1000; // 秒->毫秒
    return {
      id: String(it.id || it.track_id || it.item_id),
      title: it.title || it.name || it.song_name || '',
      artist: artist || '',
      album: (typeof album === 'object' ? album.name : album) || '',
      artwork: artwork,
      albumId: it.albumId || (it.album && it.album.id),
      duration: dur,
    };
  }

  function parsePlaylistId(s) {
    if (!s) return null;
    var str = String(s).trim();
    var m = str.match(/https?:\/\/(?:.*?)\.douyin\.com\/qishui\/share\/playlist\?playlist_id=(\d+)/) ||
      str.match(/playlist_id=(\d+)/) ||
      str.match(/^\s*(\d{10,})\s*$/);
    return m ? m[1] : null;
  }

  // ---------- 搜索 ----------
  async function search(query, page, type) {
    if (type && type !== 'music') return { isEnd: true, data: [] };
    var r = await axios.get(SEARCH_API, {
      params: {
        keyword: query, search_type: 'music', limit: 20,
        real_offset: (Math.max(1, page || 1) - 1) * 20, search_source: 'qishui',
      },
      timeout: 10000, validateStatus: function () { return true; },
    });
    var d = toObj(r.data);
    var list = (d.data && d.data.list) || [];
    var data = list.map(function (it) {
      return {
        id: String(it.item_id),
        title: it.title || '',
        artist: (it.author_info && it.author_info.name) || '',
        artwork: it.cover_url || '',
        duration: it.duration ? it.duration * 1000 : undefined,
      };
    });
    return { isEnd: list.length < 20, data: data };
  }

  // ---------- 取链（两步：seo_track -> GetPlayInfo / video_model） ----------
  async function getMediaSource(musicItem, quality) {
    var tid = String(musicItem.id);
    var r = await axios.get(SEO_TRACK, {
      params: { track_id: tid, device_platform: 'web' },
      headers: {}, timeout: 10000, validateStatus: function () { return true; },
    });
    var d = toObj(r.data);
    var tp = d.track_player;
    if (!tp) throw new Error('无法获取播放信息（汽水返回异常）');
    var url = null;
    if (tp.url_player_info) {
      try {
        var g = await axios.get(tp.url_player_info, { timeout: 10000, validateStatus: function () { return true; } });
        var gd = toObj(g.data);
        url = gd.url || (gd.video_list && gd.video_list[0] && (gd.video_list[0].main_url || gd.video_list[0].backup_url));
      } catch (e) { /* 忽略，尝试下一条路径 */ }
    }
    if (!url && tp.video_model) {
      try {
        var vm = (typeof tp.video_model === 'string') ? JSON.parse(tp.video_model) : tp.video_model;
        var vl = (vm && vm.video_list) || [];
        if (vl[0]) url = vl[0].main_url || vl[0].backup_url;
      } catch (e) { /* ignore */ }
    }
    if (!url) throw new Error('无法获取播放链接：该汽水歌曲可能已下架或需登录');
    return {
      url: url,
      headers: { 'Referer': 'https://www.douyin.com/', 'User-Agent': CHROME_UA, 'Accept': '*/*' },
    };
  }

  // ---------- 歌曲信息 / 歌词 ----------
  async function getContentItem(id) {
    var r = await axios.get(CONTENT_API, {
      params: { sources: 'qishui', need_author: true, need_album: true, need_ugc: true, need_stat: true, item_ids: String(id) },
      timeout: 10000, validateStatus: function () { return true; },
    });
    var d = toObj(r.data);
    return (d.data && d.data.list && d.data.list[0]) || {};
  }
  async function getMusicInfo(musicItem) {
    var item = await getContentItem(musicItem.id);
    return { artwork: item.cover_url || musicItem.artwork };
  }
  async function getLyric(musicItem) {
    var item = await getContentItem(musicItem.id);
    var li = item.lyric_info || {};
    var ti = item.tlyric_info || {};
    return {
      rawLrc: li.lyric_text || '',
      translation: ti.lyric_text || undefined,
    };
  }

  // ---------- 排行榜 ----------
  async function getTopLists() {
    // 汽水官方公开榜单（实测可免签访问）
    return [{
      title: '汽水音乐排行榜',
      data: [
        { id: '7036274230471712007', title: '热歌榜', description: '汽水音乐内每周热度最高的50首歌，每周四更新', coverImg: 'https://p3-luna.douyinpic.com/img/tos-cn-i-b829550vbb/d0d8d48461a62748e84689cdf049b19a.png~tplv-b829550vbb-resize:960:960.png' },
        { id: '7060812597884869927', title: '新歌榜', description: '近期发行的热度最高的50首新歌，每周四更新', coverImg: 'https://p3-luna.douyinpic.com/img/tos-cn-i-b829550vbb/f12f7eb5b54d0899c7c724df009668a8.png~tplv-b829550vbb-resize:960:960.png' },
        { id: '7061475546400005410', title: '欧美榜', description: '汽水音乐内每周热度最高的50首外文歌曲，每周四更新', coverImg: 'https://p3-luna.douyinpic.com/img/tos-cn-i-b829550vbb/33747550ed5499b58feda42a21748637.png~tplv-b829550vbb-resize:960:960.png' },
        { id: '7415959718721494311', title: '音乐人歌曲榜', description: '抖音音乐人开放平台上传歌曲，综合每周站内热度进行排序展示', coverImg: 'https://p3-luna.douyinpic.com/img/tos-cn-v-2774c002/o8FQKiQQBxHWa2hzsBNAgYOX6iEHEAibADAbfB~tplv-b829550vbb-resize:960:960.png' },
      ],
    }];
  }
  async function getTopListDetail(topListItem, page) {
    var r = await axios.get(CHARTS_API + topListItem.id + '?charge=0', {
      headers: qHeaders(), timeout: 10000, validateStatus: function () { return true; },
    });
    var d = toObj(r.data);
    var ranks = (d.chart && d.chart.track_ranks) || [];
    var musicList = ranks.map(function (x) { return formatTrack(x.track); }).filter(Boolean);
    return { isEnd: true, musicList: musicList };
  }

  // ---------- 热门歌单（标签 + 按标签） ----------
  async function getRecommendSheetTags() {
    // 汽水歌单分类（实测 pinned 列表，稳定不依赖接口）
    var pinned = [
      { id: 0, title: '每日推荐' }, { id: 14, title: '流行' }, { id: 8, title: '华语' },
      { id: 9, title: '欧美' }, { id: 20, title: '国风' }, { id: 18, title: '民谣' },
      { id: 15, title: '摇滚' }, { id: 38, title: '说唱' }, { id: 16, title: '电子' },
      { id: 19, title: 'R&B' }, { id: 69, title: '治愈' }, { id: 45, title: '睡前' }, { id: 40, title: '学习' },
    ];
    return { data: [], pinned: pinned };
  }
  async function getRecommendSheetsByTag(tag, page) {
    // 注意：discover/mix 需汽水 App 原生签名，plain 客户端通常返回空（已知限制，不崩溃）
    try {
      var r = await axios.post(DISCOVER_API, {
        block_type: 'discover_playlist_mix', feed_discover_extra: {},
        latest_douyin_liked_playlist_show_ts: 0,
        sub_channel_id: tag && tag.id,
      }, { headers: qHeaders(), timeout: 10000, validateStatus: function () { return true; } });
      var d = toObj(r.data);
      var arr = d.data || d.mix_list || d.playlists || [];
      if (arr && arr.data) arr = arr.data;
      var data = (arr || []).map(function (it) {
        return {
          id: String(it.id || it.playlist_id),
          title: it.title || it.name || '',
          artist: it.creator || (it.creator_info && it.creator_info.name) || '',
          artwork: it.cover_url || it.pic_url || it.coverImg || '',
          playCount: it.play_count || it.stat && it.stat.play_count,
          createUserId: it.creator_id || it.user_id,
        };
      });
      return { isEnd: !d.has_more, data: data };
    } catch (e) {
      return { isEnd: true, data: [] };
    }
  }

  // ---------- 歌单导入 ----------
  async function getPlaylistRaw(pid) {
    var r = await axios.post(PLAYLIST_API, { playlist_id: pid }, {
      headers: qHeaders(), timeout: 10000, validateStatus: function () { return true; },
    });
    var d = toObj(r.data);
    if (d.status_code) {
      throw new Error('歌单获取失败：' + ((d.status_info && d.status_info.status_msg) || d.status_code));
    }
    return d;
  }
  async function importMusicSheet(urlLike) {
    var pid = parsePlaylistId(urlLike);
    if (!pid) throw new Error('无法识别的汽水歌单链接，请粘贴汽水APP分享链接或纯数字歌单ID');
    var d = await getPlaylistRaw(pid);
    var meta = d.playlist || d;
    var tracks = d.media_resources || d.track_list || d.musics || (meta && meta.media_resources) || [];
    var list = tracks.map(formatTrack).filter(Boolean);
    if (!list.length) throw new Error('该汽水歌单暂无歌曲或需登录后才能访问');
    return list;
  }
  async function getMusicSheetInfo(sheetItem, page) {
    var pid = parsePlaylistId(sheetItem.id) || sheetItem.id;
    var d = await getPlaylistRaw(pid);
    var meta = d.playlist || d;
    var tracks = d.media_resources || d.track_list || d.musics || (meta && meta.media_resources) || [];
    var musicList = tracks.map(formatTrack).filter(Boolean);
    return {
      isEnd: true,
      musicList: musicList,
      sheetItem: {
        id: String(pid),
        title: meta.title || meta.name || sheetItem.title,
        artwork: meta.cover_url || meta.pic_url || meta.coverImg || sheetItem.artwork,
        description: meta.description,
      },
    };
  }

  module.exports = {
    platform: 'tp-qs',
    version: '0.0.1',
    author: 'tianpeng',
    description: '汽水音乐（字节 Luna）音源：搜索/取链/歌词/排行榜/歌单导入。' +
      '搜索、取链、歌词、排行榜、歌单导入均可免签调用；按标签热门歌单依赖汽水原生签名，plain 客户端可能返回空（可在 userVariables 填汽水会话 Cookie 尝试解锁）。',
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfreemusicfree-all@main/musicfree-qs/qs.js',
    cacheControl: 'no-cache',
    supportedSearchType: ['music'],
    userVariables: [
      {
        key: 'tp-qs_cookie',
        name: 'Cookie（可选）',
        hint: '汽水音乐/抖音登录后的会话 Cookie。填入后可能解锁「按标签热门歌单」等需签名的接口；歌单导入与取链通常无需 Cookie。',
      },
    ],
    hints: {
      importMusicSheet: [
        '汽水APP：歌单-分享-分享链接；手动访问链接后再复制链接粘贴即可',
        '网页：复制URL并粘贴，或者直接输入纯数字歌单ID即可',
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

  return module.exports;
})();

// ===== 源：tp-wy（来自 musicfree-wy/wy.js，内联，platform=tp-wy）=====
var TP_WY = (function () {
  var module = { exports: {} };
  var exports = module.exports;

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
      return (v && v['tp-wy_cookie']) || '';
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
    platform: 'tp-wy',
    version: '0.0.1',
    author: 'tianpeng',
    description: '网易云音乐音源：支持歌单导入、热门歌单、官方排行榜，附带搜索/歌词/取链。' +
      '全部走免加密官方 /api 接口；VIP/付费曲目免费态仅返回约 30 秒试听片段（版权限制），' +
      '插件自动改用【无名音乐网 mvmp3（首选）】与【歌曲宝 gequbao（次选）】双层备用音源兜底，最大化可播率。',
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfreemusicfree-all@main/musicfree-wy/wy.js',
    cacheControl: 'no-cache',
    supportedSearchType: ['music', 'sheet'],
    userVariables: [
      {
        key: 'tp-wy_cookie',
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

  return module.exports;
})();

// ===== 源：tp-bili（来自 musicfree-bilibili/bilibili.js，内联，platform=tp-bili）=====
var TP_BILI = (function () {
  var module = { exports: {} };
  var exports = module.exports;

  // 跨加载器兼容：优先用沙箱注入的 __musicfree_require，否则回退 require
  // （MusicFree 移动端仅注入 __musicfree_require，裸 require 会 ReferenceError 导致插件无法加载）
  var reqFn = (
    typeof __musicfree_require !== 'undefined' ? __musicfree_require :
    (typeof require !== 'undefined' ? require : null)
  );
  if (!reqFn) {
    throw new Error('[bilibili] 插件沙箱未提供 require，无法加载');
  }
  var axios = reqFn('axios');

  // 读取 MusicFree 注入的用户变量（登录凭证 / 配置项）。
  // 跨端兼容关键：桌面端 `env` 作为沙箱全局注入；移动端 `env` 仅作为插件「方法参数」注入
  // （见 MusicFree mobile 加载器：Function(require, __musicfree_require, module, exports, console, env, URL, process)）。
  // 因此 getVars 的解析优先级为：方法显式传入的 env 参数 > 各导出方法入口写入的 _envRef > 裸全局 env。
  // 这样无论桌面还是移动端，都能稳定读到用户填入的 SESSDATA / cookie，彻底规避「移动端读不到凭证」的问题。
  var _envRef = null; // 由各导出方法在入口处写入（来自 MusicFree 传入的方法参数 env）
  function resolveEnv(e) {
    var ev = e || _envRef;
    if (!ev && typeof env !== 'undefined' && env) ev = env;
    return ev || null;
  }
  function getVars(e) {
    var ev = resolveEnv(e);
    try {
      if (ev && typeof ev.getUserVariables === 'function') {
        return ev.getUserVariables() || {};
      }
    } catch (err) { /* 本地测试环境无 env */ }
    return {};
  }

  /* ===================== 纯 JS 实现 md5 / HMAC（零外部依赖） ===================== */
  // 替代 bili.js 的 crypto-js，规避移动端沙箱顶层抛错
  function md5hex(s) {
    function rotateLeft(n, s) { return (n << s) | (n >>> (32 - s)); }
    function toUtf8(str) {
      var out = '';
      for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        if (c < 0x80) out += String.fromCharCode(c);
        else if (c < 0x800) out += String.fromCharCode(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        else if (c >= 0xd800 && c < 0xdc00) {
          var c2 = str.charCodeAt(i + 1); i++;
          var u = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
          out += String.fromCharCode(0xf0 | (u >> 18), 0x80 | ((u >> 12) & 0x3f), 0x80 | ((u >> 6) & 0x3f), 0x80 | (u & 0x3f));
        } else out += String.fromCharCode(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
      return out;
    }
    function add32(a, b) { return (a + b) & 0xffffffff; }
    function cmn(q, a, b, x, s, t) { a = add32(add32(a, q), add32(x, t)); return add32(rotateLeft(a, s), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
    var str = toUtf8(s);
    var n = str.length;
    var state = [1732584193, -271733879, -1732584194, 271733878];
    var len = n * 8;
    str = str + String.fromCharCode(0x80);
    while (str.length % 64 !== 56) str += String.fromCharCode(0);
    var lenLo = len >>> 0, lenHi = Math.floor(len / 0x100000000);
    for (var b = 0; b < 4; b++) str += String.fromCharCode((lenLo >>> (8 * b)) & 0xff);
    for (var b2 = 0; b2 < 4; b2++) str += String.fromCharCode((lenHi >>> (8 * b2)) & 0xff);
    for (var i = 0; i < str.length; i += 64) {
      var X = [];
      for (var j = 0; j < 16; j++) {
        var w = i + j * 4;
        X[j] = (str.charCodeAt(w)) | (str.charCodeAt(w + 1) << 8) | (str.charCodeAt(w + 2) << 16) | (str.charCodeAt(w + 3) << 24);
      }
      var a = state[0], b = state[1], c = state[2], d = state[3];
      a = ff(a, b, c, d, X[0], 7, -680876936); d = ff(d, a, b, c, X[1], 12, -389564586); c = ff(c, d, a, b, X[2], 17, 606105819); b = ff(b, c, d, a, X[3], 22, -1044525330);
      a = ff(a, b, c, d, X[4], 7, -176418897); d = ff(d, a, b, c, X[5], 12, 1200080426); c = ff(c, d, a, b, X[6], 17, -1473231341); b = ff(b, c, d, a, X[7], 22, -45705983);
      a = ff(a, b, c, d, X[8], 7, 1770035416); d = ff(d, a, b, c, X[9], 12, -1958414417); c = ff(c, d, a, b, X[10], 17, -42063); b = ff(b, c, d, a, X[11], 22, -1990404162);
      a = ff(a, b, c, d, X[12], 7, 1804603682); d = ff(d, a, b, c, X[13], 12, -40341101); c = ff(c, d, a, b, X[14], 17, -1502002290); b = ff(b, c, d, a, X[15], 22, 1236535329);
      a = gg(a, b, c, d, X[1], 5, -165796510); d = gg(d, a, b, c, X[6], 9, -1069501632); c = gg(c, d, a, b, X[11], 14, 643717713); b = gg(b, c, d, a, X[0], 20, -373897302);
      a = gg(a, b, c, d, X[5], 5, -701558691); d = gg(d, a, b, c, X[10], 9, 38016083); c = gg(c, d, a, b, X[15], 14, -660478335); b = gg(b, c, d, a, X[4], 20, -405537848);
      a = gg(a, b, c, d, X[9], 5, 568446438); d = gg(d, a, b, c, X[14], 9, -1019803690); c = gg(c, d, a, b, X[3], 14, -187363961); b = gg(b, c, d, a, X[8], 20, 1163531501);
      a = gg(a, b, c, d, X[13], 5, -1444681467); d = gg(d, a, b, c, X[2], 9, -51403784); c = gg(c, d, a, b, X[7], 14, 1735328473); b = gg(b, c, d, a, X[12], 20, -1926607734);
      a = hh(a, b, c, d, X[5], 4, -378558); d = hh(d, a, b, c, X[8], 11, -2022574463); c = hh(c, d, a, b, X[11], 16, 1839030562); b = hh(b, c, d, a, X[14], 23, -35309556);
      a = hh(a, b, c, d, X[1], 4, -1530992060); d = hh(d, a, b, c, X[4], 11, 1272893353); c = hh(c, d, a, b, X[7], 16, -155497632); b = hh(b, c, d, a, X[10], 23, -1094730640);
      a = hh(a, b, c, d, X[13], 4, 681279174); d = hh(d, a, b, c, X[0], 11, -358537222); c = hh(c, d, a, b, X[3], 16, -722521979); b = hh(b, c, d, a, X[6], 23, 76029189);
      a = hh(a, b, c, d, X[9], 4, -640364487); d = hh(d, a, b, c, X[12], 11, -421815835); c = hh(c, d, a, b, X[15], 16, 530742520); b = hh(b, c, d, a, X[2], 23, -995338651);
      a = ii(a, b, c, d, X[0], 6, -198630844); d = ii(d, a, b, c, X[7], 10, 1126891415); c = ii(c, d, a, b, X[14], 15, -1416354905); b = ii(b, c, d, a, X[5], 21, -57434055);
      a = ii(a, b, c, d, X[12], 6, 1700485571); d = ii(d, a, b, c, X[3], 10, -1894986606); c = ii(c, d, a, b, X[10], 15, -1051523); b = ii(b, c, d, a, X[1], 21, -2054922799);
      a = ii(a, b, c, d, X[8], 6, 1873313359); d = ii(d, a, b, c, X[15], 10, -30611744); c = ii(c, d, a, b, X[6], 15, -1560198380); b = ii(b, c, d, a, X[13], 21, 1309151649);
      a = ii(a, b, c, d, X[4], 6, -145523070); d = ii(d, a, b, c, X[11], 10, -1120210379); c = ii(c, d, a, b, X[2], 15, 718787259); b = ii(b, c, d, a, X[9], 21, -343485551);
      state[0] = add32(state[0], a); state[1] = add32(state[1], b); state[2] = add32(state[2], c); state[3] = add32(state[3], d);
    }
    function hex(n) {
      var s = '';
      for (var k = 0; k < 4; k++) {
        var v = (n >>> (8 * k)) & 0xff;
        var h = v.toString(16);
        s += (h.length === 1 ? '0' + h : h);
      }
      return s;
    }
    return hex(state[0]) + hex(state[1]) + hex(state[2]) + hex(state[3]);
  }
  function _md5(s) { return md5hex(s); }

  /* ===================== 极简 he / dayjs 替代 ===================== */
  function heDecode(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
  }
  function unixToDate(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const y = d.getFullYear();
    const m = ('0' + (d.getMonth() + 1)).slice(-2);
    const day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }

  /* ===================== 基础常量 ===================== */
  const API_HOST = 'https://api.bilibili.com';
  // 桌面/安卓统一伪装为桌面 Chrome，规避部分接口的 UA 风控
  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  // 获取 buvid 指纹时使用移动端 UA（与官方 maotoumao/bilibili 插件一致，移动端风控更友好、指纹更易通过）
  const FINGER_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1';

  // 读取用户自定义 UA（可选）。填了用用户的，否则用默认 Chrome 120
  function getUserUA() {
    try {
      const v = getVars();
      const u = (v && v.ua && String(v.ua).trim()) || '';
      return u || UA;
    } catch (e) {
      return UA;
    }
  }
  // 移动端检测：MusicFree 在移动端暴露 env.os === 'android' | 'ios'。
  // 移动端播放器为 ExoPlayer，无法播放 B站 DASH 分离音频流（.m4s 碎片化 MP4），
  // 故取链时移动端优先 fnval=0 的 durl 合并流（.mp4 单文件，兼容性最强）。
  function isMobile() {
    try {
      var ev = resolveEnv();
      if (ev && ev.os) {
        var os = String(ev.os).toLowerCase();
        if (os === 'android' || os === 'ios') return true;
        if (os.indexOf('android') >= 0 || os.indexOf('ios') >= 0) return true;
      }
    } catch (e) { /* 本地无 env */ }
    return false;
  }
  // 请求头对齐 Chrome 浏览器，包括 sec-* 系列（字幕/UP主作品等需真浏览器指纹的接口使用）
  function getHeaders() {
    const ua = getUserUA();
    return {
      'user-agent': ua,
      'accept': '*/*',
      'accept-encoding': 'gzip, deflate, br',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
      'sec-ch-ua': '"Not A(Brand";v="99", "Chromium";v="121", "Google Chrome";v="121"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
    };
  }
  const headers = getHeaders();
  const searchHeaders = {
    'user-agent': getUserUA(),
    accept: 'application/json, text/plain, */*',
    'accept-encoding': 'gzip, deflate, br',
    origin: 'https://search.bilibili.com',
    'sec-fetch-site': 'same-site',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    referer: 'https://search.bilibili.com/',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
  };

  /* ===================== Cookie / SESSDATA ===================== */
  // 兼容三种粘贴方式：①仅 SESSDATA 值 ②标准完整 Cookie(=) ③浏览器复制的冒号格式(:)
  // 关键：SESSDATA 值常含 URL 编码字符（如 %2C 表示逗号），必须解码为原始字符，否则 B站 判定 Cookie 非法。
  function getRawCookie() {
    try {
      const vars = getVars();
      // 用户凭据按 platform id 隔离存储。本插件 platform='Bilibili'（大写），
      // 与「能看收藏夹」的本地插件 musicfree-bilibili 完全一致 —— 用户已在该桶填过 SESSDATA。
      // 优先读 SESSDATA（本插件主凭证），并兼容同桶内的 cookie / biliSessdata 写法。
      if (vars.SESSDATA) return normalizeCookie(vars.SESSDATA);
      if (vars['tp-bili_cookie']) return String(vars['tp-bili_cookie']).trim();
      if (vars.biliSessdata) return normalizeCookie(vars.biliSessdata);
    } catch (e) {
      /* 本地测试环境无 env */
    }
    return '';
  }
  function decodeSess(cookieStr) {
    return cookieStr.replace(/(SESSDATA=)([^;]+)/, function (_, p, v) {
      try { return p + (v.indexOf('%') === -1 ? v : decodeURIComponent(v)); } catch (e) { return p + v; }
    });
  }
  function safeDecode(s) {
    try { return s.indexOf('%') === -1 ? s : decodeURIComponent(s); } catch (e) { return s; }
  }
  function normalizeCookie(raw) {
    if (!raw) return '';
    if (raw.indexOf('SESSDATA=') !== -1) return decodeSess(raw);
    if (raw.indexOf('SESSDATA:') === -1 && raw.indexOf('=') === -1) {
      return 'SESSDATA=' + safeDecode(raw);
    }
    if (raw.indexOf('SESSDATA:') !== -1) {
      const out = raw.split(';').map(function (pair) {
        const idx = pair.indexOf(':');
        if (idx === -1) return pair.trim();
        return pair.slice(0, idx).trim() + '=' + pair.slice(idx + 1).trim();
      }).join(';');
      return decodeSess(out);
    }
    return decodeSess(raw);
  }
  function buildCookie() { return getRawCookie(); }

  // 从 Cookie 提取用户 UID（用于收藏夹列表接口）
  function getMidFromCookie() {
    const raw = getRawCookie();
    if (!raw) return '';
    const m = raw.match(/DedeUserID\s*[:=]\s*([^;\s]+)/);
    return m ? m[1] : '';
  }

  // buvid 指纹：B站 对匿名请求有风控（-352/-412），附加 buvid3/4 可显著降低触发概率。缓存 24h。
  let _buvidCache = '';
  let _buvidTs = 0;
  async function ensureBuvid() {
    const now = Date.now();
    if (_buvidCache && now - _buvidTs < 24 * 3600 * 1000) return;
    try {
      const r = await axios.get(API_HOST + '/x/frontend/finger/spi', {
        headers: { 'User-Agent': FINGER_UA },
      });
      const d = (r.data && r.data.data) || {};
      if (d.b_3) {
        _buvidCache = 'buvid3=' + d.b_3 + '; buvid4=' + (d.b_4 || d.buvid4 || '') + ';';
        _buvidTs = now;
      }
    } catch (e) {
      /* 指纹获取失败不影响主流程 */
    }
  }

  // 最终 cookie 字符串：用户 cookie 优先，否则匿名 buvid
  async function getCookieString() {
    const userCookie = getRawCookie();
    if (userCookie) return userCookie;
    await ensureBuvid();
    return _buvidCache || '';
  }
  // 仅返回匿名 buvid Cookie（搜索 / 公开榜单使用）。
  // 关键：绝不携带用户登录态 SESSDATA —— 若用户在插件设置里填了「过期 / 异常」的 SESSDATA，
  // 一旦随搜索请求发出，B站 会直接拒绝搜索（返回风控 code）导致「移动端搜不到任何结果」。
  // 官方 maotoumao/bilibili 插件搜索也仅用 buvid，故对齐之。
  async function getBuvidCookie() {
    await ensureBuvid();
    return _buvidCache || '';
  }
  function isLoggedIn() {
    return /SESSDATA=/.test(getRawCookie());
  }

  // 通用请求头：Referer+Origin（www.bilibili.com）+ 可选 buvid/用户 cookie
  function makeHeaders(withBuvid) {
    if (typeof withBuvid === 'undefined') withBuvid = true;
    const cookie = getRawCookie();
    const h = {
      'User-Agent': UA,
      Referer: 'https://www.bilibili.com',
      Origin: 'https://www.bilibili.com',
    };
    let c = cookie;
    if (withBuvid && _buvidCache) c = (c ? c + '; ' : '') + _buvidCache;
    if (c) h['Cookie'] = c;
    return h;
  }

  /* ===================== WBI 签名（nav 取密钥 + 纯 JS md5） ===================== */
  // 本地插件验证过的方案：直接从 /x/web-interface/nav 取 wbi_img，无需 GenWebTicket / HMAC。
  const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
  ];
  const CHR_FILTER = /[!'()*]/g;
  function _getMixinKey(orig) {
    let key = '';
    for (let i = 0; i < 32; i++) key += orig[MIXIN_KEY_ENC_TAB[i]];
    return key;
  }
  let _wbiMixinKeyCache = '';
  let _wbiMixinKeyTs = 0;
  async function getWbiMixinKey() {
    const now = Date.now();
    if (_wbiMixinKeyCache && now - _wbiMixinKeyTs < 10 * 60 * 1000) return _wbiMixinKeyCache;
    const resp = await axios.get(API_HOST + '/x/web-interface/nav', { headers: makeHeaders() });
    const data = resp.data || {};
    if (!data.data || !data.data.wbi_img) throw new Error('获取 WBI 密钥失败（可能未登录）');
    const img = data.data.wbi_img.img_url.split('/').pop().split('.')[0];
    const sub = data.data.wbi_img.sub_url.split('/').pop().split('.')[0];
    _wbiMixinKeyCache = _getMixinKey(img + sub);
    _wbiMixinKeyTs = now;
    return _wbiMixinKeyCache;
  }
  // 给参数追加 w_rid（纯 JS md5），返回签名串（供 UP主作品接口）
  async function getWrid(params) {
    const mixinKey = await getWbiMixinKey();
    const keys = Object.keys(params).sort();
    let q = '';
    keys.forEach(function (k, i) {
      const v = params[k];
      let p = v;
      if (typeof p === 'string' && CHR_FILTER.test(p)) p = p.replace(CHR_FILTER, '');
      if (p === undefined || p === null) return;
      q += (i ? '&' : '') + encodeURIComponent(k) + '=' + encodeURIComponent(String(p));
    });
    return _md5(q + mixinKey);
  }

  /* ===================== 错误标准化 ===================== */
  function wrapError(label, data) {
    const code = data && data.code;
    const msg = (data && data.message) || '';
    if (code === -101 || code === -111 || code === -412) {
      return new Error('认证失败，请检查 SESSDATA Cookie 是否有效');
    }
    if (code === -352 || code === -799 || /风控|验证/.test(msg)) {
      return new Error('该榜单触发了平台风控，请先在插件设置中填写 SESSDATA Cookie（登录态）后重试');
    }
    if (code === -404 || /私密|private/i.test(msg)) {
      return new Error('无法访问私密收藏夹');
    }
    if (/vip|会员|版权|coin|充电/.test(msg)) {
      return new Error('该视频需要大会员权限或存在区域限制，无法播放');
    }
    return new Error(label + '失败：' + (msg || code || '未知错误'));
  }

  /* ===================== 工具函数（bili.js 原有） ===================== */
  function secToMmSs(sec) {
    if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}`;
  }
  function formatNumber(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '';
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    return String(n);
  }
  function durationToSec(duration) {
    if (typeof duration === 'number') return duration;
    if (typeof duration === 'string') {
      const dur = duration.split(':');
      return dur.reduce(function (prev, curr) { return 60 * prev + +curr; }, 0);
    }
    return 0;
  }
  // 读取用户配置的专辑名模板
  function getAlbumTemplate() {
    try {
      const v = getVars();
      return (v && v.albumTemplate && String(v.albumTemplate).trim()) || '';
    } catch (e) { return ''; }
  }
  function renderAlbumTemplate(vars) {
    const tpl = getAlbumTemplate();
    if (!tpl) return vars.bvid || String(vars.aid || '') || '';
    let out = tpl;
    const replacements = {
      '{bvid}': vars.bvid || '', '{aid}': vars.aid != null ? String(vars.aid) : '',
      '{date}': vars.date || '', '{duration}': typeof vars.duration === 'number' ? String(vars.duration) : '',
      '{durationMmSs}': typeof vars.duration === 'number' ? secToMmSs(vars.duration) : '',
      '{artist}': vars.artist || '', '{title}': vars.title || '',
      '{playCount}': typeof vars.playCount === 'number' ? formatNumber(vars.playCount) : '',
      '{likeCount}': typeof vars.likeCount === 'number' ? formatNumber(vars.likeCount) : '',
      '{coinCount}': typeof vars.coinCount === 'number' ? formatNumber(vars.coinCount) : '',
      '{favoriteCount}': typeof vars.favoriteCount === 'number' ? formatNumber(vars.favoriteCount) : '',
      '{danmakuCount}': typeof vars.danmakuCount === 'number' ? formatNumber(vars.danmakuCount) : '',
      '{replyCount}': typeof vars.replyCount === 'number' ? formatNumber(vars.replyCount) : '',
      '{shareCount}': typeof vars.shareCount === 'number' ? formatNumber(vars.shareCount) : '',
      '{category}': vars.category || '',
    };
    for (const [k, v] of Object.entries(replacements)) out = out.split(k).join(v);
    return out.trim();
  }

  /* ===================== 视频详情 / 播放地址 ===================== */
  // 获取视频详情（含全部分P 的 cid / 标题 / 时长）—— 本地插件风格，返回 data.data
  async function getVideoView(bvid) {
    const resp = await axios.get(API_HOST + '/x/web-interface/view', {
      params: { bvid: bvid },
      headers: makeHeaders(),
    });
    const data = resp.data || {};
    if (data.code !== 0) throw wrapError('获取视频信息', data);
    return data.data;
  }
  // 获取视频详情（bili.js 风格，返回完整响应）—— 供 getMediaSource/getMusicInfo 等复用
  async function getCid(bvid, aid) {
    const params = bvid ? { bvid } : { aid };
    const cidRes = (await axios.get(API_HOST + '/x/web-interface/view', {
      headers: Object.assign({}, headers, { cookie: await getCookieString() }),
      params,
    })).data;
    return cidRes;
  }
  /* ===================== 收藏夹（本地插件增强） ===================== */
  async function getLoginMid() {
    try {
      const resp = await axios.get(API_HOST + '/x/web-interface/nav', { headers: makeHeaders(), timeout: 10000 });
      const data = resp.data || {};
      if (data.code !== 0 || !data.data) return '';
      return data.data.mid || '';
    } catch (e) { return ''; }
  }
  // 获取用户创建的全部收藏夹
  async function getFavoriteFolders() {
    const cookie = buildCookie();
    if (!cookie) throw new Error('请先在插件设置中填写 B站 SESSDATA Cookie，以加载「我的收藏夹」');
    let mid = getMidFromCookie();
    if (!mid) mid = await getLoginMid();
    if (!mid) throw new Error('未能获取登录用户 UID，请确认 SESSDATA Cookie 是否有效');
    const params = { up_mid: mid };
    const resp = await axios.get(API_HOST + '/x/v3/fav/folder/created/list-all', {
      params: params, headers: makeHeaders(), timeout: 10000,
    });
    const data = resp.data || {};
    if (data.code !== 0) {
      if (data.code === -101 || data.code === -111 || data.code === -412) {
        throw new Error('SESSDATA 已失效，请重新从浏览器复制 SESSDATA Cookie');
      }
      throw wrapError('获取收藏夹列表', data);
    }
    return (data.data && data.data.list) || data.data || [];
  }
  // 获取某个收藏夹内的视频列表（分页）
  async function getFolderVideos(mediaId, page) {
    const cookie = buildCookie();
    if (!cookie) throw new Error('请先在插件设置中填写 B站 SESSDATA Cookie');
    const params = { media_id: mediaId, pn: page || 1, ps: 20, platform: 'web' };
    const headers2 = makeHeaders();
    const maxRetry = 3;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxRetry; attempt++) {
      try {
        const resp = await axios.get(API_HOST + '/x/v3/fav/resource/list', {
          params: params, headers: headers2, timeout: 10000,
        });
        const data = resp.data || {};
        if (data.code === 0) return data.data || {};
        if (data.code === -403) throw new Error('该收藏夹为「私密收藏夹」，请前往 B站 将其改为「公开」后再导入/播放');
        if (data.code === -412) throw new Error('访问收藏夹触发平台风控，请稍后重试');
        lastErr = new Error('获取收藏夹视频失败：' + (data.message || ('code ' + data.code)));
      } catch (e) { lastErr = e; }
      if (attempt < maxRetry) await new Promise(function (r) { setTimeout(r, 1000); });
    }
    throw lastErr || new Error('获取收藏夹视频失败');
  }
  function mapFolderToSheet(folder) {
    const count = folder.media_count || 0;
    return {
      id: String(folder.id),
      title: folder.title || '未命名收藏夹',
      artwork: folder.cover || '',
      description: '共 ' + count + ' 个视频',
      count: count,
    };
  }
  function ownerNameOf(media) {
    if (media.owner && media.owner.name) return media.owner.name;
    if (media.upper && media.upper.name) return media.upper.name;
    return '未知UP主';
  }
  function firstCidOf(media) {
    const c = media.cid || media.uppermost_cid || media.first_cid;
    return c ? String(c) : '';
  }
  function baseMusicOf(media, sheetTitle) {
    return {
      id: String(media.id || media.bvid),
      bvid: media.bvid,
      cid: firstCidOf(media),
      title: media.title || '未命名视频',
      artist: ownerNameOf(media),
      artwork: media.cover || media.pic || '',
      duration: media.duration || 0,
      album: sheetTitle || '',
      pageCount: media.cnt || media.page_count || 1,
    };
  }
  // 分P展开：单P直接返回；多P则抓取 view 后每个分P生成一个独立条目
  function expandMedia(media, sheetTitle) {
    const base = baseMusicOf(media, sheetTitle);
    if ((media.cnt || media.page_count || 1) <= 1) return Promise.resolve([base]);
    return getVideoView(media.bvid).then(function (view) {
      const pages = view.pages || [];
      if (!pages.length) return [base];
      return pages.map(function (p, i) {
        const partTitle = p.part || '';
        const title = pages.length > 1
          ? media.title + ' - P' + (i + 1) + (partTitle ? ' ' + partTitle : '')
          : media.title;
        return Object.assign({}, base, {
          id: media.bvid + '|' + p.cid,
          cid: String(p.cid),
          title: title,
          duration: p.duration || base.duration,
        });
      });
    }).catch(function () { return [base]; });
  }
  // 收藏夹视频分页拉取并逐条分P展开（导入/歌单详情通用）
  async function loadSheetVideos(sheetItem, page) {
    const mediaId = sheetItem.id;
    const sheetTitle = sheetItem.title || '';
    const data = await getFolderVideos(mediaId, page || 1);
    const medias = data.medias || [];
    const expanded = await Promise.all(medias.map(function (m) { return expandMedia(m, sheetTitle); }));
    const musicList = [].concat.apply([], expanded);
    const hasMore = data.has_more === true || data.has_more === 1;
    return { isEnd: !hasMore, musicList: musicList, sheetItem: sheetItem };
  }

  /* ===================== 榜单静态配置 ===================== */
  // 各分区排行榜的 rid 映射（21 个分区，比 bili.js 原 19 个新增「翻唱」「演奏」）
  const BILI_REGIONS = [
    { rid: 3, name: '音乐' }, { rid: 31, name: '翻唱' }, { rid: 193, name: '演奏' },
    { rid: 1, name: '动画' }, { rid: 168, name: '国创' }, { rid: 4, name: '游戏' },
    { rid: 119, name: '鬼畜' }, { rid: 129, name: '舞蹈' }, { rid: 160, name: '生活' },
    { rid: 211, name: '美食' }, { rid: 36, name: '知识' }, { rid: 188, name: '科技' },
    { rid: 234, name: '运动' }, { rid: 223, name: '汽车' }, { rid: 217, name: '动物圈' },
    { rid: 155, name: '时尚' }, { rid: 5, name: '娱乐' }, { rid: 181, name: '影视' },
    { rid: 0, name: '全站' }, { rid: 0, name: '原创', type: 'origin' }, { rid: 0, name: '新人', type: 'rookie' },
  ];
  const ICON_PRECIOUS = 'https://s1.hdslb.com/bfs/static/jinkela/popular/assets/icon_history.png';
  const ICON_WEEKLY = 'https://s1.hdslb.com/bfs/static/jinkela/popular/assets/icon_weekly.png';
  const ICON_RANK = 'https://s1.hdslb.com/bfs/static/jinkela/popular/assets/icon_rank.png';

  /* ===================== 公开榜单（免登录）数据映射 ===================== */
  function formatPopularMedia(item) {
    return {
      id: String(item.aid || item.bvid),
      bvid: item.bvid,
      cid: item.cid ? String(item.cid) : (item.first_cid ? String(item.first_cid) : ''),
      title: heDecode(item.title || '未知'),
      artist: (item.owner && item.owner.name) || item.author || item.uploader || '未知UP主',
      artwork: item.pic || item.cover || '',
      duration: item.duration || 0,
      album: '',
      pageCount: 1,
    };
  }
  // 公开榜单详情拉取：入站必刷支持分页；每周必刷/各分区为固定榜单
  async function getPublicTopListDetail(topListItem, page) {
    const id = topListItem.id || '';
    let url;
    if (id.indexOf('popular/precious') === 0) {
      url = API_HOST + '/x/web-interface/popular/precious?page_size=20&page=' + (page || 1);
    } else {
      url = API_HOST + '/x/web-interface/' + id;
    }
    await ensureBuvid();
    try {
      const resp = await axios.get(url, { headers: makeHeaders() });
      const data = resp.data || {};
      if (data.code && data.code !== 0) throw wrapError('获取榜单详情', data);
      const d = data.data || {};
      const list = d.list || d.archives || [];
      if (!list.length) {
        console.warn('[getPublicTopListDetail] 该榜单暂无数据 id=' + id);
        return { isEnd: true, musicList: [] };
      }
      const musicList = list.map(formatPopularMedia);
      const isPaged = id.indexOf('popular/precious') === 0;
      const isEnd = isPaged
        ? (page || 1) * 20 >= (d.page && d.page.count ? d.page.count : list.length)
        : true;
      return { isEnd: isEnd, musicList: musicList, sheetItem: topListItem };
    } catch (e) {
      console.warn('[getPublicTopListDetail] 失败 id=' + id + ':', e.message);
      return { isEnd: true, musicList: [] };
    }
  }

  /* ===================== 搜索（bili.js 富字段 + 字幕兼容） ===================== */
  const pageSize = 20;
  async function searchBase(keyword, page, searchType) {
    await ensureBuvid();
    const params = {
      context: '', page, order: '', page_size: pageSize, keyword,
      duration: '', tids_1: '', tids_2: '', __refresh__: true, _extra: '', highlight: 1,
      single_column: 0, platform: 'pc', from_source: '', search_type: searchType, dynamic_offset: 0,
    };
    try {
      const res = (await axios.get(API_HOST + '/x/web-interface/search/type', {
        headers: Object.assign({}, searchHeaders, { cookie: await getBuvidCookie() }),
        params,
      })).data;
      if (!res) throw new Error('搜索接口返回空（可能被风控）');
      if (res.code !== 0) throw new Error('搜索接口返回错误 code=' + res.code + ' msg=' + (res.message || ''));
      if (!res.data || !res.data.result) throw new Error('搜索接口返回数据异常: ' + JSON.stringify(res).slice(0, 200));
      return res.data;
    } catch (error) {
      console.error('[searchBase] 搜索失败 keyword=' + keyword + ' page=' + page + ' type=' + searchType + ':', error.message);
      return { result: [], numResults: 0 };
    }
  }
  // 搜索结果统一映射（含统计字段 + 专辑名模板）
  function formatMedia(result) {
    const title = heDecode((result.title || '').replace(/(\<em(.*?)\>)|(\<\/em\>)/g, ''));
    const durSec = durationToSec(result.duration);
    const pubTs = result.pubdate || result.created;
    const pubDate = pubTs ? unixToDate(pubTs) : '';
    const artistName = (result.author || (result.owner && result.owner.name) || '');
    const playCount = typeof result.play === 'number' ? result.play : (result.stat ? result.stat.view : undefined);
    const likeCount = typeof result.like === 'number' ? result.like : (result.stat ? result.stat.like : undefined);
    const danmakuCount = typeof result.video_review === 'number' ? result.video_review : (typeof result.danmaku === 'number' ? result.danmaku : (result.stat ? result.stat.danmaku : undefined));
    const replyCount = typeof result.review === 'number' ? result.review : (result.stat ? result.stat.reply : undefined);
    const favoriteCount = typeof result.favorites === 'number' ? result.favorites : (result.stat ? result.stat.favorite : undefined);
    const coinCount = typeof result.coins === 'number' ? result.coins : (result.stat ? result.stat.coin : undefined);
    const shareCount = typeof result.share === 'number' ? result.share : (result.stat ? result.stat.share : undefined);
    const category = result.typename || result.tname || '';
    const rawDesc = (result.description && String(result.description).trim()) || (result.desc && String(result.desc).trim()) || '';
    let descParts = [];
    if (rawDesc) descParts.push(rawDesc);
    const statParts = [];
    if (typeof playCount === 'number') statParts.push('播放 ' + formatNumber(playCount));
    if (typeof likeCount === 'number') statParts.push('点赞 ' + formatNumber(likeCount));
    if (typeof coinCount === 'number') statParts.push('投币 ' + formatNumber(coinCount));
    if (typeof favoriteCount === 'number') statParts.push('收藏 ' + formatNumber(favoriteCount));
    if (typeof danmakuCount === 'number') statParts.push('弹幕 ' + formatNumber(danmakuCount));
    if (typeof replyCount === 'number') statParts.push('评论 ' + formatNumber(replyCount));
    if (statParts.length > 0) descParts.push(statParts.join(' | '));
    const description = descParts.join('\n');
    const album = renderAlbumTemplate({
      bvid: result.bvid, aid: result.aid, date: pubDate, duration: durSec,
      durationMmSs: durSec > 0 ? secToMmSs(durSec) : '',
      artist: artistName, title: title,
      playCount: playCount, likeCount: likeCount, coinCount: coinCount,
      favoriteCount: favoriteCount, danmakuCount: danmakuCount, replyCount: replyCount,
      shareCount: shareCount, category: category,
    });
    const item = {
      id: (result.cid || result.bvid || result.aid),
      aid: result.aid, bvid: result.bvid,
      artist: artistName, title,
      alias: (title.match(/《(.+?)》/) || [])[1],
      album: album,
      artwork: (result.pic && String(result.pic).startsWith('//')) ? 'http:' + result.pic : result.pic,
      duration: durSec,
      tags: (result.tag && typeof result.tag === 'string') ? result.tag.split(',') : undefined,
      date: pubDate,
      playCount: playCount, likeCount: likeCount, coinCount: coinCount, favoriteCount: favoriteCount,
      danmakuCount: danmakuCount, replyCount: replyCount, shareCount: shareCount,
      category: category, description: description,
      artistId: result.mid, artistAvatar: result.upic || (result.owner && result.owner.face),
    };
    Object.keys(item).forEach((key) => { if (item[key] === undefined || item[key] === null) delete item[key]; });
    return item;
  }
  async function searchAlbum(keyword, page) {
    const resultData = await searchBase(keyword, page, 'video');
    return { isEnd: resultData.numResults <= page * pageSize, data: resultData.result.map(formatMedia) };
  }
  async function searchArtist(keyword, page) {
    const resultData = await searchBase(keyword, page, 'bili_user');
    const artists = resultData.result.map((result) => ({
      name: result.uname, id: result.mid, fans: result.fans,
      description: result.usign,
      avatar: (result.upic && String(result.upic).startsWith('//')) ? `https://${result.upic}` : result.upic,
      worksNum: result.videos,
    }));
    return { isEnd: resultData.numResults <= page * pageSize, data: artists };
  }

  /* ===================== UP主作品（WBI，纯 JS 签名） ===================== */
  async function getArtistWorks(artistItem, page, type, env) {
    _envRef = env;
    const queryHeaders = {
      'user-agent': getUserUA(), accept: '*/*', 'accept-encoding': 'gzip, deflate, br, zstd',
      origin: 'https://space.bilibili.com', 'sec-fetch-site': 'same-site',
      'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty',
      referer: `https://space.bilibili.com/${artistItem.id}/video`,
    };
    await ensureBuvid();
    const now = Math.round(Date.now() / 1e3);
    const params = {
      mid: artistItem.id, ps: 30, tid: 0, pn: page, index: 0, special_type: '',
      web_location: '333.1387', order_avoided: true, order: 'pubdate', keyword: '',
      platform: 'web', dm_img_list: '[]',
      dm_img_str: 'V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ',
      dm_cover_img_str: 'QU5HTEUgKE5WSURJQSwgTlZJRElBIEdlRm9yY2UgR1RYIDE2NTAgKDB4MDAwMDFGOTEpIERpcmVjdDNEMTEgdnNfNV8wIHBzXzVfMCwgRDNEMTEpR29vZ2xlIEluYy4gKE5WSURJQS',
      dm_img_inter: '{"ds":[],"wh":[4564,4288,68],"of":[401,802,401]}',
      wts: now.toString(),
    };
    const w_rid = await getWrid(params);
    try {
      const res = (await axios.get(API_HOST + '/x/space/wbi/arc/search', {
        headers: Object.assign({}, queryHeaders, { cookie: await getCookieString() }),
        params: Object.assign({}, params, { w_rid }),
      })).data;
      if (!res) throw new Error('作者作品接口返回空（可能被风控412）');
      if (res.code !== 0) throw new Error('作者作品接口返回错误 code=' + res.code + ' msg=' + (res.message || '') + '（mid=' + artistItem.id + ' page=' + page + '）');
      if (!res.data || !res.data.list || !res.data.list.vlist) throw new Error('作者作品数据异常: ' + JSON.stringify(res).slice(0, 200));
      const resultData = res.data;
      const albums = resultData.list.vlist.map(formatMedia);
      return {
        isEnd: resultData.page && resultData.page.pn ? (resultData.page.pn * resultData.page.ps >= resultData.page.count) : true,
        data: albums,
      };
    } catch (error) {
      console.error('[getArtistWorks] mid=' + artistItem.id + ' page=' + page + ':', error.message);
      return { isEnd: true, data: [] };
    }
  }

  /* ===================== 取链（三级兜底：登录态 → 匿名 → durl 合并流） ===================== */
  // 为什么需要三级兜底（这是「收藏夹能拉取但音频均无法播放」的根因修复）：
  //   • 纯匿名 playurl 对「登录/大会员限定」视频会被风控返回 -412 或空 audio → 直接失败；
  //   • 桌面端（Electron）播放器对 DASH 分离音频流（mcdn P2P 直链）兼容性差，
  //     而 fnval=0 的 durl 合并流（upos 直链）是最稳的单流格式。
  // 策略（与 musicfree-bili 一致）：
  //   ① 已登录（填了 SESSDATA/cookie）→ 带登录态 playurl：解锁限定视频 + 更稳直链；
  //      注意只挂 SESSDATA，绝不挂 buvid（buvid 会触发 B站 HTTP 412，见 musicfree-bilibili 注释）；
  //   ② 匿名 playurl：未登录用户仍可播公开视频；
  //   ③ fnval=0 durl 合并流：最终兜底，桌面端兼容性最强。
  async function getMediaSource(musicItem, quality, env) {
    _envRef = env;
    const logTag = '[getMediaSource] ' + (musicItem.bvid || musicItem.aid || 'unknown');
    try {
      let cid = musicItem.cid;
      if (!cid) {
        const cidRes = await getCid(musicItem.bvid, musicItem.aid);
        if (!cidRes || !cidRes.data || !cidRes.data.cid) {
          throw new Error('获取cid失败 bvid=' + musicItem.bvid + ' aid=' + musicItem.aid);
        }
        cid = cidRes.data.cid;
      }
      if (!musicItem.bvid && !musicItem.aid) throw new Error('musicItem 缺少 bvid 和 aid');
      const referer = 'https://www.bilibili.com/video/' + (musicItem.bvid || musicItem.aid || '');
      const baseHeaders = { 'User-Agent': UA, Referer: 'https://www.bilibili.com' };
      const cookie = getRawCookie(); // 已登录（填了 SESSDATA/cookie）则为非空；否则匿名
      // 移动端 ExoPlayer 无法播放 B站 DASH 分离音频流（.m4s 碎片化 MP4），
      // 故移动端首选 fnval=0 的 durl 合并流（.mp4 单文件，兼容性最强）；
      // 桌面端 Electron 播放器可正常播放 .m4s，保留 fnval=16 dash 以获得低/标准/高/超高音质选择。
      // 统一请求 fnval=16（DASH 分离音频流）。经与官方 maotoumao/bilibili 插件核对：
      // MusicFree 移动端(ExoPlayer)与桌面端均原生支持 DASH .m4s，无需在移动端降为 fnval=0 的 durl。
      // 旧版「移动端优先 durl」分支实测在移动端取不到可播流（表现为取得到地址却放不出声），故统一走 DASH。
      const params = musicItem.bvid
        ? { bvid: musicItem.bvid, cid: cid, fnval: 16 }
        : { aid: musicItem.aid, cid: cid, fnval: 16 };

      // 成功判定：code=0 且 DASH 音频轨非空
      const okDash = (r) => r && r.code === 0 && r.data && r.data.dash && r.data.dash.audio && r.data.dash.audio.length;

      let res = null, lastErr = null;
      // ① 已登录（填了 SESSDATA/cookie）→ 带登录态 playurl：解锁限定视频 + 更稳直链；仅挂 SESSDATA，不挂 buvid（避免 412）
      if (cookie) {
        try {
          res = (await axios.get(API_HOST + '/x/player/playurl', {
            headers: Object.assign({}, baseHeaders, { Cookie: cookie }),
            params: params,
          })).data;
        } catch (e) { lastErr = e; res = null; }
      }
      // ② 匿名 playurl 兜底（未登录/登录态失败仍可播公开视频）
      if (!okDash(res)) {
        try {
          res = (await axios.get(API_HOST + '/x/player/playurl', {
            headers: baseHeaders, params: params,
          })).data;
        } catch (e) { lastErr = e; }
      }
      if (!res || res.code !== 0) {
        throw new Error('playurl接口错误 code=' + (res && res.code) + ' msg=' + ((res && res.message) || '') +
          (lastErr ? (' | 兜底异常: ' + lastErr.message) : ''));
      }
      if (!res.data) throw new Error('playurl返回data为空');
      let url;
      if (res.data.dash && res.data.dash.audio && res.data.dash.audio.length > 0) {
        const audios = res.data.dash.audio.slice().sort((a, b) => a.bandwidth - b.bandwidth); // 升序：索引0=最低码率
        const len = audios.length;
        switch (quality) {
          case 'low': url = (audios[0] || {}).baseUrl; break;
          case 'standard': url = (audios[Math.min(1, len - 1)] || {}).baseUrl; break;
          case 'high': url = (audios[Math.min(2, len - 1)] || {}).baseUrl; break;
          case 'super': url = (audios[len - 1] || {}).baseUrl; break;
          default: url = (audios[len - 1] || {}).baseUrl;
        }
        if (!url) url = (audios[len - 1] || {}).baseUrl;
      } else if (res.data.durl && res.data.durl.length > 0) {
        // 极少数无 DASH 音频轨的视频：退回 legacy durl 单流
        url = res.data.durl[0].url;
      } else {
        throw new Error('playurl未返回音频流（该视频可能受限或需登录态）');
      }
      if (!url) throw new Error('解析出的播放URL为空');
      // 提取 CDN 主机名写入 host 头（B站 upos/mcdn CDN 对 host 头敏感，缺失可能 403/空流）
      let host = '';
      try { const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url); host = m ? m[1] : ''; } catch (e) { host = ''; }
      return {
        url: url,
        headers: {
          'User-Agent': UA,
          'Referer': referer,
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Host': host,
        },
      };
    } catch (error) {
      console.error(logTag + ':', error.message);
      throw error;
    }
  }

  // 补全单曲信息（点击播放前可选调用）
  async function getMusicInfo(musicItem, env) {
    _envRef = env;
    const bvid = musicItem.bvid, aid = musicItem.aid;
    if (!bvid && !aid) return {};
    try {
      const cidRes = await getCid(bvid, aid);
      const d = cidRes && cidRes.data;
      if (!d) return {};
      const result = {};
      if (d.cid) result.cid = d.cid;
      if (d.duration) result.duration = d.duration;
      if (d.title) result.title = heDecode(d.title);
      if (d.pic) result.artwork = d.pic.startsWith('//') ? 'https:' + d.pic : d.pic;
      if (d.owner && d.owner.name) result.artist = d.owner.name;
      if (d.desc && String(d.desc).trim()) result.desc = String(d.desc).trim();
      const stat = d.stat;
      if (stat) {
        if (typeof stat.view === 'number') result.playCount = stat.view;
        if (typeof stat.like === 'number') result.likeCount = stat.like;
        if (typeof stat.coin === 'number') result.coinCount = stat.coin;
        if (typeof stat.favorite === 'number') result.favoriteCount = stat.favorite;
        if (typeof stat.danmaku === 'number') result.danmakuCount = stat.danmaku;
        if (typeof stat.reply === 'number') result.replyCount = stat.reply;
        if (typeof stat.share === 'number') result.shareCount = stat.share;
      }
      if (d.pubdate) result.date = unixToDate(d.pubdate);
      if (d.tname) result.category = d.tname;
      if (d.owner && d.owner.face) result.artistAvatar = d.owner.face;
      if (d.owner && d.owner.mid) result.artistId = d.owner.mid;
      Object.keys(result).forEach((key) => { if (result[key] === undefined) delete result[key]; });
      return result;
    } catch (error) {
      console.error('获取歌曲详情失败:', error.message);
      return {};
    }
  }

  /* ===================== 专辑多P展开（bili.js 原有） ===================== */
  async function getAlbumInfo(albumItem, env) {
    _envRef = env;
    const cidRes = await getCid(albumItem.bvid, albumItem.aid);
    const _ref2 = (cidRes && cidRes.data) || {};
    const cid = _ref2.cid;
    const pages = _ref2.pages;
    let musicList;
    if (pages.length === 1) {
      musicList = [Object.assign({}, albumItem, { cid: cid })];
    } else {
      musicList = pages.map(function (_) {
        return Object.assign({}, albumItem, { cid: _.cid, title: _.part, duration: durationToSec(_.duration), id: _.cid });
      });
    }
    return { musicList };
  }

  /* ===================== 榜单入口（合并：每周必刷/入站必刷/21分区/我的收藏夹） ===================== */
  async function getTopLists(_, page, env) {
    _envRef = env;
    // 1) 入站必刷（个性化推荐，需登录）
    const precious = {
      title: '入站必刷',
      data: [{ id: 'popular/precious', title: '入站必刷', coverImg: ICON_PRECIOUS }],
    };
    // 2) 每周必刷（公开）
    let weekly = { title: '每周必刷', data: [] };
    try {
      await ensureBuvid();
      const resp = await axios.get(API_HOST + '/x/web-interface/popular/series/list', { headers: makeHeaders() });
      const list = (resp.data && resp.data.data && resp.data.data.list) || [];
      weekly.data = list.slice(0, 8).map(function (s) {
        return { id: 'popular/series/one?number=' + s.number, title: s.subject, description: s.name, coverImg: ICON_WEEKLY };
      });
    } catch (e) { /* 公开接口异常不影响其余板块 */ }
    // 3) 各分区排行榜（21 个分区，公开）
    const ranking = {
      title: '各分区排行榜',
      data: BILI_REGIONS.map(function (r) {
        const type = r.type ? '&type=' + r.type : '&type=all';
        return { id: 'ranking/v2?rid=' + r.rid + type, title: r.name, coverImg: ICON_RANK };
      }),
    };
    // 4) 我的收藏夹（需登录）
    let fav = { title: '我的收藏夹', data: [] };
    try {
      const folders = await getFavoriteFolders();
      fav.data = folders.map(mapFolderToSheet);
      if (!fav.data.length) {
        fav.data.push({ id: '__fav_empty__', title: '（未检测到收藏夹）', coverImg: ICON_RANK, description: '尚未创建收藏夹，请前往 B站 创建后重试', count: 0 });
      }
    } catch (e) {
      fav.data = [{ id: '__fav_error__', title: '⚠️ 收藏夹加载失败', coverImg: ICON_RANK, description: (e && e.message) ? e.message : '请检查插件设置中的 SESSDATA 是否有效', count: 0 }];
    }
    return [weekly, precious, ranking, fav];
  }
  // 歌单详情：收藏夹数字 id 走收藏夹；其余走公开榜单
  async function getMusicSheetInfo(sheetItem, page, env) {
    _envRef = env;
    const id = String(sheetItem.id || '');
    if (id.indexOf('__') === 0) throw new Error(sheetItem.description || '该收藏夹项无法加载');
    if (/^\d+$/.test(id)) return loadSheetVideos(sheetItem, page);
    return getPublicTopListDetail(sheetItem, page);
  }
  // 榜单详情：按 id 路由
  async function getTopListDetail(topListItem, page, env) {
    _envRef = env;
    const id = String(topListItem.id || '');
    if (id === '__fav_error__' || id === '__fav_empty__' || id.indexOf('__') === 0) {
      throw new Error(topListItem.description || '该收藏夹项无法加载');
    }
    if (/^\d+$/.test(id)) return loadSheetVideos(topListItem, page); // 用户收藏夹
    return getPublicTopListDetail(topListItem, page);
  }

  /* ===================== 导入歌单（多P展开 + 收藏夹链接/ID） ===================== */
  // 通过视频链接（BV 号）导入：单 P 直接成曲，多 P 逐集展开为歌单
  async function importVideo(urlLike) {
    const m = String(urlLike).match(/BV[0-9A-Za-z]+/);
    if (!m) return null;
    const bvid = m[0];
    const view = await getVideoView(bvid);
    const pages = view.pages || [];
    const title = view.title || bvid;
    const artist = (view.owner && view.owner.name) || '未知UP主';
    const artwork = view.pic || '';
    if (!pages.length) {
      return [{ id: bvid + '|' + (view.cid || ''), bvid: bvid, cid: String(view.cid || ''), title: title, artist: artist, artwork: artwork, duration: view.duration || 0, album: title }];
    }
    return pages.map(function (p, i) {
      const partTitle = p.part || '';
      const t = partTitle ? title + ' - P' + (i + 1) + ' ' + partTitle : title + ' - P' + (i + 1);
      return { id: bvid + '|' + p.cid, bvid: bvid, cid: String(p.cid), title: t, artist: artist, artwork: artwork, duration: p.duration || 0, album: title };
    });
  }
  // 全量拉取收藏夹视频（多页）
  async function getAllFolderVideos(mediaId) {
    let page = 1; const all = [];
    while (true) {
      const data = await getFolderVideos(mediaId, page);
      const medias = data.medias || [];
      all.push.apply(all, medias);
      if (!data.has_more) break;
      page += 1;
      if (page > 50) break; // 安全上限
    }
    return all;
  }
  async function importMusicSheet(urlLike, env) {
    _envRef = env;
    if (!urlLike) throw new Error('请提供收藏夹链接、视频链接或收藏夹 ID');
    // 1) 视频链接（支持多 P 分集导入为歌单）
    if (/BV[0-9A-Za-z]+/.test(String(urlLike))) {
      const list = await importVideo(urlLike);
      if (list && list.length) return list;
      throw new Error('该视频无可用分P信息，无法导入');
    }
    // 2) 收藏夹链接 / 收藏夹数字 ID（合并 bili.js 与本地插件的识别规则）
    const m = String(urlLike).match(/fid=(\d+)/)
      || String(urlLike).match(/favlist\/(\d+)/)
      || String(urlLike).match(/ml(\d+)/)
      || String(urlLike).match(/^\s*(\d+)\s*$/)
      || String(urlLike).match(/\/playlist\/pl(\d+)/i)
      || String(urlLike).match(/\/list\/ml(\d+)/i);
    if (!m) throw new Error('无法识别的收藏夹链接，请确认形如 .../favlist?fid=收藏夹ID，或直接输入收藏夹 ID');
    const mediaId = m[1];
    let sheetTitle = '导入的收藏夹';
    try {
      const folders = await getFavoriteFolders();
      for (let i = 0; i < folders.length; i++) {
        if (String(folders[i].id) === String(mediaId)) { sheetTitle = folders[i].title || sheetTitle; break; }
      }
    } catch (e) { /* 取不到标题不影响导入 */ }
    const medias = await getAllFolderVideos(mediaId);
    if (!medias.length) throw new Error('该收藏夹没有可导入的视频（可能是「私密收藏夹」请改为公开，或收藏夹为空）');
    const expanded = await Promise.all(medias.map(function (md) { return expandMedia(md, sheetTitle); }));
    return [].concat.apply([], expanded);
  }

  /* ===================== 评论（bili.js 原有） ===================== */
  const commentCursorCache = new Map();
  function formatComment(item) {
    return {
      id: item.rpid,
      nickName: (item.member && item.member.uname),
      avatar: (item.member && item.member.avatar),
      comment: (item.content && item.content.message),
      like: item.like,
      createAt: item.ctime * 1000,
      location: ((item.reply_control && item.reply_control.location || '').startsWith('IP属地：')) ? item.reply_control.location.slice(5) : undefined,
    };
  }
  async function getVideoDesc(musicItem) {
    const aid = musicItem.aid, bvid = musicItem.bvid;
    if (!aid && !bvid) return null;
    try {
      const cidRes = await getCid(bvid, aid);
      const desc = cidRes && cidRes.data && cidRes.data.desc;
      if (desc && String(desc).trim()) return String(desc).trim();
      return null;
    } catch (e) { return null; }
  }
  function buildDescComment(descText, musicItem) {
    if (!descText) return null;
    return { id: '__intro__', nickName: '📝 视频简介', comment: descText, avatar: musicItem.artwork || undefined };
  }
  async function getMusicComments(musicItem, page, env) {
    _envRef = env;
    const aid = musicItem.aid;
    if (!aid) return { isEnd: true, data: [] };
    const currentPage = page || 1;
    const ps = 30;
    const cacheKey = String(aid);
    let next = currentPage === 1 ? 0 : (commentCursorCache.get(cacheKey) || 0);
    const params = { type: 1, oid: aid, mode: 3, next: next, ps: ps, plat: 1, web_location: 1315875, wts: Math.floor(Date.now() / 1000) };
    try {
      const res = (await axios.get(API_HOST + '/x/v2/reply/main', {
        params: params,
        headers: Object.assign({}, headers, { cookie: await getCookieString(), referer: 'https://www.bilibili.com/' }),
      })).data;
      let replies = [];
      let cursor = {};
      if (res.code === 0 && res.data) {
        replies = res.data.replies || [];
        cursor = res.data.cursor || {};
        if (typeof cursor.next === 'number') commentCursorCache.set(cacheKey, cursor.next);
      } else {
        console.warn('[getMusicComments] 接口异常 code=' + res.code + ' msg=' + res.message);
      }
      const comments = [];
      for (let i = 0; i < replies.length; ++i) {
        comments[i] = formatComment(replies[i]);
        if (replies[i].replies && replies[i].replies.length) comments[i].replies = replies[i].replies.map(formatComment);
      }
      if (currentPage === 1) {
        try {
          const desc = await getVideoDesc(musicItem);
          if (desc) { const dc = buildDescComment(desc, musicItem); if (dc) comments.unshift(dc); }
        } catch (e) { console.error('简介插入失败:', e.message); }
      }
      const hasMore = replies.length > 0 && (typeof cursor.next === 'number' && cursor.next > 0) && replies.length >= ps;
      return { isEnd: !hasMore, data: comments };
    } catch (error) {
      console.error('获取评论失败:', error.message);
      return { isEnd: true, data: [] };
    }
  }

  /* ===================== 字幕作为歌词（bili.js 原有，双语） ===================== */
  function secondsToLrcTime(sec) {
    if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    const ss = s.toFixed(2).padStart(5, '0');
    return `${String(m).padStart(2, '0')}:${ss}`;
  }
  function subtitleBodyToLrc(body) {
    if (!Array.isArray(body) || body.length === 0) return '';
    return body.map((item) => {
      const from = typeof item.from === 'number' ? item.from : parseFloat(item.from);
      return `[${secondsToLrcTime(from)}]${item.content || ''}`;
    }).join('\n');
  }
  async function getLyric(musicItem, env) {
    _envRef = env;
    if (!isLoggedIn()) {
      // 诊断：明确告知用户当前插件是否真正读到了登录凭证，便于排查「歌词不显示」
      let diag = {};
      try {
        const v = getVars();
        diag = { hasSESSDATA: !!v.SESSDATA, hasCookie: !!v['tp-bili_cookie'], hasBiliSessdata: !!v.biliSessdata, platform: plugin.platform };
      } catch (e) { diag = { readError: String(e && e.message) }; }
      console.warn('[getLyric] 未登录（当前插件[' + plugin.platform + ']未检测到 SESSDATA/cookie），跳过字幕获取 bvid=' + musicItem.bvid + ' aid=' + musicItem.aid + ' 检测到: ' + JSON.stringify(diag));
      return {};
    }
    console.log('[getLyric] 开始获取字幕 bvid=' + musicItem.bvid + ' aid=' + musicItem.aid + ' cid=' + musicItem.cid);
    try {
      let cid = musicItem.cid;
      const bvid = musicItem.bvid, aid = musicItem.aid;
      if (!cid) { const cidRes = await getCid(bvid, aid); cid = cidRes && cidRes.data && cidRes.data.cid; }
      if (!cid || (!aid && !bvid)) return {};
      const referer = bvid ? `https://www.bilibili.com/video/${bvid}` : 'https://www.bilibili.com/';
      const sessCookie = await getCookieString();
      const baseLrcHeaders = {
        'User-Agent': getUserUA(),
        referer: referer,
        origin: 'https://www.bilibili.com',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        cookie: sessCookie,
      };
      // 字幕接口策略（严格对齐 musicfree-bili 已验证可看歌词版本，这是 ground truth）：
      // ① 先试 /x/player/v2：无需 WBI 签名，仅登录态 Cookie + bvid/cid，最稳；
      // ② 兜底 /x/player/wbi/v2：带 WBI 签名，但**只传 bvid/cid，绝不挂 dm_img 系列风控参数**
      //    （dm_img_str/dm_cover_img_str/dm_img_inter 含 {}[]:, 等特殊字符，会干扰 wbi 签名校验，
      //     导致登录态下接口返回「空字幕列表」而非报错——表现为字幕静默不显示）。
      const queryParams = aid ? { aid: aid, cid: cid } : { bvid: bvid, cid: cid };
      let subtitles = [];
      try {
        const r1 = await axios.get(API_HOST + '/x/player/v2', { params: queryParams, headers: baseLrcHeaders });
        subtitles = (r1.data && r1.data.data && r1.data.data.subtitle && r1.data.data.subtitle.subtitles) || [];
        console.log('[getLyric] /x/player/v2 字幕数=' + subtitles.length);
      } catch (e) { console.warn('[getLyric] /x/player/v2 失败', e.message); }
      if (!subtitles.length) {
        try {
          const wts = String(Math.floor(Date.now() / 1000));
          const w_rid = await getWrid(Object.assign({}, queryParams, { wts }));
          const r2 = await axios.get(API_HOST + '/x/player/wbi/v2', {
            params: Object.assign({}, queryParams, { wts, w_rid }),
            headers: baseLrcHeaders,
          });
          subtitles = (r2.data && r2.data.data && r2.data.data.subtitle && r2.data.data.subtitle.subtitles) || [];
          console.log('[getLyric] /x/player/wbi/v2 兜底 字幕数=' + subtitles.length);
        } catch (e) { console.warn('[getLyric] /x/player/wbi/v2 兜底失败', e.message); }
      }
      console.log('[getLyric] 字幕列表条数=' + subtitles.length + (subtitles.length ? ' 语言=' + subtitles.map((s) => s.lan + '(' + s.lan_doc + ')').join(',') : '（本视频无字幕轨；AI 字幕需登录态且视频本身有字幕）'));
      if (subtitles.length === 0) return {};
      // 优先选 AI 字幕轨（ai-zh / ai-en），其次标准 zh/en，对齐 musicfree-bili（已验证可看歌词）
      const zhSub = subtitles.find((s) => /ai-zh/i.test(s.lan || ''))
        || subtitles.find((s) => /zh|cn/i.test(s.lan || ''));
      const enSub = subtitles.find((s) => /ai-en|en/i.test(s.lan || ''));
      async function fetchSubtitleBody(sub) {
        if (!sub || !sub.subtitle_url) return null;
        let u = sub.subtitle_url;
        if (u.startsWith('//')) u = 'https:' + u;
        if (!u.startsWith('http')) u = 'https://' + u;
        // 字幕 JSON 多数走公开 CDN（匿名可下），但 AI 字幕下载在部分情况下需带登录态 Cookie 才放行
        const r = (await axios.get(u, {
          headers: { 'User-Agent': getUserUA(), referer, cookie: await getCookieString() },
        })).data;
        return Array.isArray(r.body) ? r.body : null;
      }
      const zhBody = zhSub ? await fetchSubtitleBody(zhSub) : null;
      const enBody = enSub ? await fetchSubtitleBody(enSub) : null;
      if (!zhBody && !enBody) return {};
      const result = {};
      if (zhBody) { const lrc = subtitleBodyToLrc(zhBody); if (lrc) result.rawLrc = lrc; }
      if (enBody) { const translation = subtitleBodyToLrc(enBody); if (translation) result.translation = translation; }
      if (!result.rawLrc && !result.translation) {
        const picked = subtitles[0];
        const body = await fetchSubtitleBody(picked);
        if (body && body.length) result.rawLrc = subtitleBodyToLrc(body);
      }
      if (!result.rawLrc && !result.translation) return {};
      return result;
    } catch (error) {
      console.error('获取字幕失败:', error.message);
      return {};
    }
  }

  /* ===================== 插件导出对象 ===================== */
  var plugin = {
    platform: 'tp-bili',
    appVersion: '>=0.0',
    version: 'V0.0.10',
    author: 'tianpeng',
    cacheControl: 'no-store',
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfreemusicfree-all@main/musicfree-bilibili/bilibili.js',
    description:
      '在 MusicFree 搜索/播放 B站视频音频。基于 martin65536/bilibili.js 扩展，并集成本地 musicfree-bilibili 插件增强：\n' +
      '• 移动端兼容（IIFE + 纯 JS md5，无需 crypto-js/dayjs/he 等原生依赖）\n' +
      '• SESSDATA 三种格式自动提取（仅值/标准Cookie/冒号格式），也可填完整 cookie\n' +
      '• 「我的收藏夹」板块：登录后自动列出收藏夹并映射为歌单\n' +
      '• 多 P 分集展开：粘贴视频链接即把每 P 展开为独立音轨\n' +
      '• 21 个分区排行榜（新增翻唱/演奏）+ 入站必刷/每周必刷\n' +
      '• 移动端安全播放头（playurl 不挂 Cookie/Origin，CDN 仅 Referer+UA）\n' +
      '• 保留：双语字幕歌词、评论分页+视频简介、UP主作品、专辑名模板、多音质映射\n\n' +
      '【配置项】SESSDATA（或 cookie）可选：填了才能获取字幕/评论完整分页/导入私有收藏夹。',
    primaryKey: ['id', 'aid', 'bvid', 'cid'],
    supportedSearchType: ['music', 'album', 'artist'],
    userVariables: [
      {
        key: 'SESSDATA',
        name: 'SESSDATA Cookie（本地插件兼容）',
        hint: '可选。登录 B站 后复制 SESSDATA 值；也可直接粘贴完整 Cookie 或冒号格式（自动识别）。填了可解锁收藏夹/字幕/评论分页。',
      },
      {
        key: 'tp-bili_cookie',
        name: 'B站登录Cookie（bili.js 原字段）',
        hint: '可选。完整 cookie 整行值（含SESSDATA）。与 SESSDATA 二选一。',
      },
      {
        key: 'albumTemplate',
        name: '专辑名模板',
        hint: '可选。占位符：{bvid} {aid} {date} {duration} {durationMmSs} {artist} {title} {playCount} {likeCount} {coinCount} {favoriteCount} {danmakuCount} {replyCount} {shareCount} {category}。默认只显示BV号。',
      },
      {
        key: 'ua',
        name: 'User-Agent',
        hint: '可选。自定义请求的User-Agent。不填默认 Chrome 120。',
      },
    ],
    hints: {
      importMusicSheet: [
        '① B站视频链接（含多P分集），如 https://www.bilibili.com/video/BV1oLBXBiEW5，将逐集展开为歌单；',
        '② 收藏夹链接，形如 https://space.bilibili.com/你的UID/favlist?fid=收藏夹ID；',
        '③ 直接输入收藏夹数字 ID。',
        '获取字幕需在插件设置填 SESSDATA（含SESSDATA），匿名无法获取AI字幕。',
      ],
    },
    async search(keyword, page, type, env) {
      _envRef = env;
      if (type === 'album' || type === 'music') return await searchAlbum(keyword, page);
      if (type === 'artist') return await searchArtist(keyword, page);
    },
    getMediaSource,
    getMusicInfo,
    getAlbumInfo,
    getArtistWorks,
    getTopLists,
    getTopListDetail,
    getMusicSheetInfo,
    importMusicSheet,
    getMusicComments,
    getLyric,
  };

  // 跨加载器导出：新协议用 module.exports，旧协议（移动端）用返回值
  if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = plugin;
  }
  if (typeof exports !== 'undefined') {
    exports.default = plugin;
  }
  return plugin;

  return module.exports;
})();

var SOURCES = [
  { id: 'tp-kg', name: 'tp-kg', platform: 'tp-kg', plugin: TP_KG, nativePlatform: '酷狗' },
  { id: 'tp-kw', name: 'tp-kw', platform: 'tp-kw', plugin: TP_KW, nativePlatform: '酷我' },
  { id: 'tp-qq', name: 'tp-qq', platform: 'tp-qq', plugin: TP_QQ, nativePlatform: 'QQ音乐' },
  { id: 'tp-qs', name: 'tp-qs', platform: 'tp-qs', plugin: TP_QS, nativePlatform: '汽水音乐' },
  { id: 'tp-wy', name: 'tp-wy', platform: 'tp-wy', plugin: TP_WY, nativePlatform: '网易云音乐' },
  { id: 'tp-bili', name: 'tp-bili', platform: 'tp-bili', plugin: TP_BILI, nativePlatform: 'Bilibili' }
];


// ===================== 天蓬聚合调度层 =====================
var AGG_PLATFORM = 'TianPengJH';
var _envRef = null;

function _setEnv(e) {
  if (e && typeof e.getUserVariables === 'function') {
    try { globalThis.env = e; } catch (err) {}
    _envRef = e;
  }
}
function _resolveEnv(e) {
  return e || _envRef || (typeof globalThis !== 'undefined' && globalThis.env) || (typeof env !== 'undefined' ? env : null);
}
function _srcById(id) {
  for (var i = 0; i < SOURCES.length; i++) { if (SOURCES[i].id === id) return SOURCES[i]; }
  return null;
}
function _srcByNative(plat) {
  for (var i = 0; i < SOURCES.length; i++) { if (SOURCES[i].nativePlatform === plat) return SOURCES[i]; }
  return null;
}
function _resolveSource(item) {
  if (!item) return null;
  if (item.source) { var s = _srcById(item.source); if (s) return s; }
  if (item.platform) { var n = _srcByNative(item.platform); if (n) return n; }
  return null;
}
function _tag(item, src) {
  item.source = src.id;
  item.sourceName = src.name;
  item.platform = AGG_PLATFORM;
  return item;
}
// 由 topListItem/tag 的编码 id（src.id + '::' + origId）还原原始 id
function _origId(id) {
  if (typeof id === 'string' && id.indexOf('::') >= 0) return id.slice(id.indexOf('::') + 2);
  return id;
}

// userVariables 合并（按 key 去重；源私有 cookie 已在各源体内重命名为 tp-xx_cookie）
var _uvSeen = {};
var USER_VARIABLES = [];
for (var si = 0; si < SOURCES.length; si++) {
  var _uvs = SOURCES[si].plugin.userVariables || [];
  for (var ui = 0; ui < _uvs.length; ui++) {
    var _u = _uvs[ui];
    if (!_u || !_u.key) continue;
    if (_uvSeen[_u.key]) continue;
    _uvSeen[_u.key] = true;
    USER_VARIABLES.push(_u);
  }
}

// 按 URL 启发式猜测导入源（失败再全源兜底尝试）
function _detectImportSource(url) {
  if (typeof url !== 'string') return null;
  var u = url.toLowerCase();
  if (u.indexOf('bilibili.com') >= 0 || u.indexOf('b23.tv') >= 0) return _srcById('tp-bili');
  if (u.indexOf('kugou.com') >= 0) return _srcById('tp-kg');
  if (u.indexOf('kuwo.cn') >= 0) return _srcById('tp-kw');
  if (u.indexOf('music.163.com') >= 0) return _srcById('tp-wy');
  if (u.indexOf('y.qq.com') >= 0 || u.indexOf('qq.com') >= 0) return _srcById('tp-qq');
  if (u.indexOf('qishui.com') >= 0 || u.indexOf('douyin') >= 0 || u.indexOf('volcengine') >= 0) return _srcById('tp-qs');
  return null;
}

// ---------- 搜索：聚合全部支持该 type 的源 ----------
async function search(...args) {
  _setEnv(args[args.length - 1]);
  var query = args[0], page = args[1], type = args[2];
  var all = [];
  for (var i = 0; i < SOURCES.length; i++) {
    var src = SOURCES[i];
    var fn = src.plugin.search;
    if (typeof fn !== 'function') continue;
    var sup = src.plugin.supportedSearchType || [];
    if (type && sup.length && sup.indexOf(type) === -1) continue;
    try {
      var r = await fn.apply(src.plugin, args);
      if (r && Array.isArray(r.data)) {
        for (var j = 0; j < r.data.length; j++) all.push(_tag(Object.assign({}, r.data[j]), src));
      }
    } catch (e) { console.warn('[TianPengJH] search ' + src.id + ' (' + type + ') 失败:', e && e.message); }
  }
  return { isEnd: true, data: all };
}

// ---------- 取链：按 source 路由 ----------
async function getMediaSource(...args) {
  _setEnv(args[args.length - 1]);
  var musicItem = args[0];
  var src = _resolveSource(musicItem);
  if (!src) throw new Error('[TianPengJH] 未知音源(取链): ' + (musicItem && (musicItem.source || musicItem.platform)));
  var fn = src.plugin.getMediaSource;
  if (!fn) throw new Error('[TianPengJH] 音源未实现 getMediaSource: ' + src.id);
  return await fn.apply(src.plugin, args);
}

// ---------- 歌词：按 source 路由，失败不报错 ----------
async function getLyric(...args) {
  _setEnv(args[args.length - 1]);
  var musicItem = args[0];
  var src = _resolveSource(musicItem);
  if (!src) return { rawLrc: '' };
  var fn = src.plugin.getLyric;
  if (!fn) return { rawLrc: '' };
  try { return await fn.apply(src.plugin, args); } catch (e) { return { rawLrc: '' }; }
}

// ---------- 歌曲详情 ----------
async function getMusicInfo(...args) {
  _setEnv(args[args.length - 1]);
  var musicItem = args[0];
  var src = _resolveSource(musicItem);
  if (!src) return musicItem;
  var fn = src.plugin.getMusicInfo;
  if (!fn) return musicItem;
  return await fn.apply(src.plugin, args);
}

// ---------- 专辑详情 ----------
async function getAlbumInfo(...args) {
  _setEnv(args[args.length - 1]);
  var album = args[0];
  var src = _resolveSource(album);
  if (!src) return { isEnd: true, data: [] };
  var fn = src.plugin.getAlbumInfo;
  if (!fn) return { isEnd: true, data: [] };
  return await fn.apply(src.plugin, args);
}

// ---------- 歌手作品 ----------
async function getArtistWorks(...args) {
  _setEnv(args[args.length - 1]);
  var artist = args[0];
  var src = _resolveSource(artist);
  if (!src) return { isEnd: true, data: [] };
  var fn = src.plugin.getArtistWorks;
  if (!fn) return { isEnd: true, data: [] };
  return await fn.apply(src.plugin, args);
}

// ---------- 排行榜列表：聚合全部源，id 编码 source ----------
async function getTopLists(...args) {
  _setEnv(args[args.length - 1]);
  var all = [];
  for (var i = 0; i < SOURCES.length; i++) {
    var src = SOURCES[i];
    var fn = src.plugin.getTopLists;
    if (typeof fn !== 'function') continue;
    try {
      var r = await fn.apply(src.plugin, args);
      if (Array.isArray(r)) {
        for (var j = 0; j < r.length; j++) {
          var t = Object.assign({}, r[j]);
          t.id = src.id + '::' + (t.id != null ? t.id : '');
          t.source = src.id;
          t.platform = AGG_PLATFORM;
          all.push(t);
        }
      }
    } catch (e) { console.warn('[TianPengJH] getTopLists ' + src.id + ' 失败:', e && e.message); }
  }
  return all;
}

// ---------- 排行榜详情：还原原始 id 后路由 ----------
async function getTopListDetail(...args) {
  _setEnv(args[args.length - 1]);
  var top = args[0];
  var src = _resolveSource(top);
  if (!src) return { isEnd: true, data: [] };
  var fn = src.plugin.getTopListDetail;
  if (!fn) return { isEnd: true, data: [] };
  var orig = Object.assign({}, top);
  orig.id = _origId(top.id);
  args[0] = orig;
  return await fn.apply(src.plugin, args);
}

// ---------- 歌单分类标签：聚合全部源，id 编码 source ----------
async function getRecommendSheetTags(...args) {
  _setEnv(args[args.length - 1]);
  var all = [];
  for (var i = 0; i < SOURCES.length; i++) {
    var src = SOURCES[i];
    var fn = src.plugin.getRecommendSheetTags;
    if (typeof fn !== 'function') continue;
    try {
      var r = await fn.apply(src.plugin, args);
      if (Array.isArray(r)) {
        for (var j = 0; j < r.length; j++) {
          var t = Object.assign({}, r[j]);
          t.id = src.id + '::' + (t.id != null ? t.id : '');
          t.source = src.id;
          t.platform = AGG_PLATFORM;
          all.push(t);
        }
      }
    } catch (e) { console.warn('[TianPengJH] getRecommendSheetTags ' + src.id + ' 失败:', e && e.message); }
  }
  return all;
}

// ---------- 按标签取歌单：还原原始 id 后路由，结果打 source ----------
async function getRecommendSheetsByTag(...args) {
  _setEnv(args[args.length - 1]);
  var tag = args[0];
  var src = _resolveSource(tag);
  if (!src) return [];
  var fn = src.plugin.getRecommendSheetsByTag;
  if (!fn) return [];
  var orig = Object.assign({}, tag);
  orig.id = _origId(tag.id);
  args[0] = orig;
  try {
    var r = await fn.apply(src.plugin, args);
    if (Array.isArray(r)) {
      for (var i = 0; i < r.length; i++) r[i] = _tag(Object.assign({}, r[i]), src);
    } else if (r && Array.isArray(r.data)) {
      for (var j = 0; j < r.data.length; j++) r.data[j] = _tag(Object.assign({}, r.data[j]), src);
    }
    return r;
  } catch (e) { return []; }
}

// ---------- 歌单详情：按 source 路由，结果打 source ----------
async function getMusicSheetInfo(...args) {
  _setEnv(args[args.length - 1]);
  var sheet = args[0];
  var src = _resolveSource(sheet);
  if (!src) return { isEnd: true, musicList: [] };
  var fn = src.plugin.getMusicSheetInfo;
  if (!fn) return { isEnd: true, musicList: [] };
  try {
    var r = await fn.apply(src.plugin, args);
    if (r && Array.isArray(r.musicList)) {
      for (var i = 0; i < r.musicList.length; i++) r.musicList[i] = _tag(Object.assign({}, r.musicList[i]), src);
    } else if (r && Array.isArray(r.data)) {
      for (var j = 0; j < r.data.length; j++) r.data[j] = _tag(Object.assign({}, r.data[j]), src);
    }
    return r;
  } catch (e) { return { isEnd: true, musicList: [] }; }
}

// 老接口兼容：getMusicSheets 委托给 getTopLists
async function getMusicSheets(...args) {
  _setEnv(args[args.length - 1]);
  return await getTopLists.apply(null, args);
}

// ---------- 歌单导入：先按 URL 启发式路由，失败全源兜底 ----------
async function importMusicSheet(...args) {
  _setEnv(args[args.length - 1]);
  var url = args[0];
  var src = _detectImportSource(url);
  if (!src) {
    for (var i = 0; i < SOURCES.length; i++) {
      var f = SOURCES[i].plugin.importMusicSheet;
      if (typeof f !== 'function') continue;
      try {
        var r2 = await f.apply(SOURCES[i].plugin, args);
        if (r2) return _tag(Object.assign({}, r2), SOURCES[i]);
      } catch (e) {}
    }
    return null;
  }
  var fn = src.plugin.importMusicSheet;
  if (!fn) return null;
  try {
    var r = await fn.apply(src.plugin, args);
    if (r) return _tag(Object.assign({}, r), src);
    return null;
  } catch (e) { return null; }
}

// ---------- 评论：B站专属 ----------
async function getMusicComments(...args) {
  _setEnv(args[args.length - 1]);
  var musicItem = args[0];
  var src = _resolveSource(musicItem);
  if (!src || src.id !== 'tp-bili') return { isEnd: true, data: [] };
  var fn = src.plugin.getMusicComments;
  if (!fn) return { isEnd: true, data: [] };
  return await fn.apply(src.plugin, args);
}

// ---------- 收藏夹：B站专属（无 source 入参）----------
async function getFavoriteFolders(...args) {
  _setEnv(args[args.length - 1]);
  var bili = _srcById('tp-bili');
  if (!bili || typeof bili.plugin.getFavoriteFolders !== 'function') return [];
  try { return await bili.plugin.getFavoriteFolders.apply(bili.plugin, args); } catch (e) { return []; }
}

module.exports = {
  platform: AGG_PLATFORM,
  version: '1.0.0',
  author: 'tianpeng',
  description: '天蓬聚合插件：合并 tp-kg/tp-kw/tp-qq/tp-qs/tp-wy/tp-bili 六个音源，统一搜索/取链/歌词/专辑/歌手/排行榜/歌单/评论。各源登录态(SESSDATA、各站 Cookie、无名音乐网)独立配置，互不干扰；单个音源插件仍可并存。',
  srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfreemusicfree-all@main/musicfree-tianpeng/tianpengjh.js',
  cacheControl: 'no-cache',
  supportedSearchType: ['music', 'album', 'artist', 'sheet'],
  primaryKey: ['id', 'source'],
  userVariables: USER_VARIABLES,
  search: search,
  getMediaSource: getMediaSource,
  getLyric: getLyric,
  getMusicInfo: getMusicInfo,
  getAlbumInfo: getAlbumInfo,
  getArtistWorks: getArtistWorks,
  getTopLists: getTopLists,
  getTopListDetail: getTopListDetail,
  getRecommendSheetTags: getRecommendSheetTags,
  getRecommendSheetsByTag: getRecommendSheetsByTag,
  getMusicSheetInfo: getMusicSheetInfo,
  getMusicSheets: getMusicSheets,
  importMusicSheet: importMusicSheet,
  getMusicComments: getMusicComments,
  getFavoriteFolders: getFavoriteFolders,
};
