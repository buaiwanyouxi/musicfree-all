// 酷我音源插件（kw.js）
// ---------------------------------------------------------------------------
// 定位：将“酷我”作为一个独立音源接入 MusicFree，实现：
//   1) 歌单导入（importMusicSheet / getMusicSheetInfo）
//   2) 热门歌单（getRecommendSheetTags / getRecommendSheetsByTag）
//   3) 排行榜（getTopLists / getTopListDetail）
//   并附带搜索、歌词、取链等基础能力。
//
// 接口均经真实网络探测验证（非盲猜）：
//   - 搜索：search.kuwo.cn/r.s（ft=music/album/artist/sheet）
//   - 取链：第三方社区代理 music.nxinxz.com/kw.php（返回酷我真实音频流；
//           酷我官方免费 antiserver 接口实测对任一 rid 均返回同一首歌，已不可用）
//   - 歌词：m.kuwo.cn/newh5/singles/songinfoandlrc
//   - 排行榜列表：wapi.kuwo.cn/api/pc/bang/list（5 组共数十个榜单）
//   - 榜单详情：kbangserver.kuwo.cn/ksong.s
//   - 热门歌单标签：wapi.kuwo.cn/api/pc/classify/playlist/getTagList
//   - 热门/标签歌单：wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList（推荐/热门）、getTagPlayList（按标签）
//   - 歌单歌曲：nplserver.kuwo.cn/pl.svc（op=getlistinfo，注意返回键为 musiclist 小写）
//
// 协议：IIFE 兼容 CommonJS(module.exports) 与老协议(return)；移动端用 __musicfree_require 回退 require。
// 依赖沙箱内置 require('axios') / require('he')。
// ---------------------------------------------------------------------------

(function () {
  var reqFn = (
    typeof __musicfree_require !== 'undefined' ? __musicfree_require :
    (typeof require !== 'undefined' ? require : null)
  );
  if (!reqFn) throw new Error('[kw] 插件沙箱未提供 require，无法加载');
  var axios = reqFn('axios');
  var he = reqFn('he');
  var cheerio = reqFn('cheerio');

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

  // ============================ 酷我系多源兜底（内联备选源） ============================
  // 各备选源逻辑移植自 muscifree-other/musicfree-<slug>/<slug>.js（均已联网实测 6/6）。
  // 统一经 kwPick 身份校验防错播；aax 本轮实测 0 结果暂不接入；buguyy 稳定性差不接入。
  // 链序：官方代理 → 酷我系(T1：qeecc/gequhai/gequke/gequbao/凤梨/溜声/无名) → 独立站(小蜜蜂/音微)。
  function kwNorm(s) { return (s || '').toLowerCase().replace(/\s+/g, '').replace(/[()（）【】\[\]《》、，。,.]/g, ''); }
  function kwTokens(s) { return String(s || '').split(/[\/、,，&;；|+]+|\s*feat\.?\s*|\s*ft\.?\s*/i).map(function (x) { return kwNorm(x); }).filter(function (x) { return x && x.length >= 2; }); }
  function kwArtistMatch(ar, ca) {
    if (!ar || !ca) return true;
    if (ca.indexOf(ar) >= 0 || ar.indexOf(ca) >= 0) return true;
    var A = kwTokens(ar), B = kwTokens(ca);
    for (var i = 0; i < A.length; i++) for (var j = 0; j < B.length; j++) if (A[i].indexOf(B[j]) >= 0 || B[j].indexOf(A[i]) >= 0) return true;
    return false;
  }
  function kwTitleOk(c, mi) { var t = kwNorm(mi.title), ct = kwNorm(c.title); if (!t || !ct) return false; return ct.indexOf(t) >= 0 || t.indexOf(ct) >= 0; }
  function kwArtistState(c, mi) {
    var ar = kwNorm(mi.artist), ca = kwNorm(c.artist);
    if (!ar) return 'unknown';
    if (!ca) return (kwTitleOk(c, mi) && kwNorm(c.title).indexOf(ar) >= 0) ? 'ok' : 'unknown';
    return kwArtistMatch(ar, ca) ? 'ok' : 'conflict';
  }
  function kwIsSafe(c, mi) {
    if (!kwTitleOk(c, mi)) return false;
    var a = kwArtistState(c, mi);
    if (a === 'conflict') return false;
    if (a === 'ok') return true;
    return !kwNorm(mi.artist);
  }
  function kwPick(items, mi) {
    var all = items || [];
    if (!all.length) return null;
    var strong = all.filter(function (c) { if (!kwTitleOk(c, mi)) return false; var a = kwArtistState(c, mi); return a !== 'conflict' && (!kwNorm(mi.artist) || a === 'ok'); });
    var pool = strong.length ? strong : all.filter(function (c) { return kwIsSafe(c, mi); });
    return pool.length ? pool : null;
  }

  // ---- ① 无忧音乐网 qeecc.com（fetch + 自动过验证，酷我系直链 m4a）----
  var QE_BASE = 'https://www.qeecc.com', QE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
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
    var r1 = await fetch(QE_BASE + '/', { method: 'GET', headers: { 'User-Agent': QE_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, redirect: 'follow' });
    var sc = r1.headers.get('set-cookie'); var jar = {};
    (sc || '').split(',').forEach(function (c) { var i = c.indexOf('='); if (i > 0) jar[c.slice(0, i).trim()] = c.split(';')[0].split('=').slice(1).join('=').trim(); });
    var ck = Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
    if (!ck) throw new Error('无忧音乐网：无法建立会话');
    var html = await r1.text(); if (!qeIsVerify(html)) return ck;
    var m = html.match(/name="csrf_token" value="([^"]+)"/); var csrf = m ? m[1] : '';
    await fetch(QE_BASE + '/', { method: 'POST', headers: { 'User-Agent': QE_UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': QE_BASE + '/', 'Cookie': ck }, body: 'csrf_token=' + encodeURIComponent(csrf) + '&human_check=on', redirect: 'follow' });
    return ck;
  }
  async function qeCookie(force) { var now = Date.now(); if (!force && _qeCk && (now - _qeAt) < 50 * 60 * 1000) return _qeCk; var f = await qeAutoVerify(); _qeCk = f; _qeAt = now; return f; }
  async function qeSearch(kw) {
    var ck = await qeCookie(false);
    var r = await fetch(QE_BASE + '/so/' + encodeURIComponent(kw || '') + '.html', { method: 'GET', headers: { 'User-Agent': QE_UA, 'Accept-Language': 'zh-CN,zh;q=0.9', 'Cookie': ck }, redirect: 'follow' });
    var html = await r.text(); if (qeIsVerify(html)) throw new Error('无忧音乐网：验证未过');
    return qeParse(html);
  }
  async function qeUrl(id) {
    var ck = await qeCookie(false);
    var r = await fetch(QE_BASE + '/js/play.php', { method: 'POST', headers: { 'User-Agent': QE_UA, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', 'Referer': QE_BASE + '/song/' + id + '.html', 'Cookie': ck }, body: 'id=' + encodeURIComponent(id) + '&type=music', redirect: 'follow' });
    var t = await r.text(); var d; try { d = JSON.parse(t); } catch (e) { throw new Error('无忧音乐网：取链非JSON'); }
    if (!d || !d.url) throw new Error('无忧音乐网：无链接' + (d && d.msg ? '（' + d.msg + '）' : ''));
    return { url: d.url, headers: { 'User-Agent': QE_UA } };
  }

  // ---- ② 歌曲海 gequhai.com（fetch + cheerio，play_id+会话cookie 取 kuwo 直链）----
  var GH_BASE = 'https://www.gequhai.com', GH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  function ghCookie(sh) { if (!sh) return ''; return sh.split(',').map(function (s) { return s.split(';')[0]; }).join('; '); }
  async function ghSearch(kw) {
    var r = await fetch(GH_BASE + '/search?s=' + encodeURIComponent(kw), { headers: { 'User-Agent': GH_UA }, redirect: 'follow' });
    var $ = cheerio.load(await r.text()); var data = [];
    $('a.text-info.font-weight-bold').each(function (i, el) {
      var a = $(el); var href = a.attr('href') || ''; var m = href.match(/\/play\/(\d+)/); if (!m) return;
      var id = m[1], title = a.text().trim(), artist = '未知歌手';
      var tr = a.closest('tr');
      if (tr.length) { var tds = tr.find('td'); var titleTd = a.closest('td'); var idx = tds.index(titleTd); if (idx >= 0 && idx + 1 < tds.length) artist = tds.eq(idx + 1).text().trim() || '未知歌手'; }
      if (title) data.push({ id: id, title: title, artist: artist });
    });
    return data;
  }
  async function ghUrl(id) {
    var dres = await fetch(GH_BASE + '/play/' + id, { headers: { 'User-Agent': GH_UA }, redirect: 'follow' });
    var text = await dres.text(); var pm = text.match(/window\.play_id\s*=\s*'([^']+)'/); if (!pm) throw new Error('歌曲海：无play_id');
    var playId = pm[1], cookie = ghCookie(dres.headers.get('set-cookie'));
    var resp = await fetch(GH_BASE + '/api/music', { method: 'POST', headers: { 'User-Agent': GH_UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'Http', 'X-Custom-Header': 'Key', 'Referer': GH_BASE + '/play/' + id, 'Origin': GH_BASE, 'Accept': 'application/json, text/javascript, */*; q=0.01', 'Cookie': cookie }, body: 'id=' + encodeURIComponent(playId) + '&type=0', redirect: 'follow' });
    var j; try { j = JSON.parse(await resp.text()); } catch (e) { throw new Error('歌曲海：解析失败'); }
    if (!j || j.code !== 200 || !j.data || !j.data.url) throw new Error('歌曲海：取链失败' + (j ? '(' + j.code + ')' : ''));
    return { url: j.data.url, headers: { 'User-Agent': GH_UA, 'Referer': 'https://www.kuwo.cn/' } };
  }

  // ---- ③ 歌曲客 gequke.com（同歌曲海基线，/song/ 路径）----
  var GK_BASE = 'https://www.gequke.com', GK_UA = GH_UA;
  async function gkSearch(kw) {
    var r = await fetch(GK_BASE + '/search?s=' + encodeURIComponent(kw), { headers: { 'User-Agent': GK_UA }, redirect: 'follow' });
    var $ = cheerio.load(await r.text()); var data = [];
    $('a.text-info.font-weight-bold').each(function (i, el) {
      var a = $(el); var href = a.attr('href') || ''; var m = href.match(/\/song\/(\d+)/); if (!m) return;
      var id = m[1], title = a.text().trim(), artist = '未知歌手';
      var tr = a.closest('tr');
      if (tr.length) { var tds = tr.find('td'); var titleTd = a.closest('td'); var idx = tds.index(titleTd); if (idx >= 0 && idx + 1 < tds.length) artist = tds.eq(idx + 1).text().trim() || '未知歌手'; }
      if (title) data.push({ id: id, title: title, artist: artist });
    });
    return data;
  }
  async function gkUrl(id) {
    var dres = await fetch(GK_BASE + '/song/' + id, { headers: { 'User-Agent': GK_UA }, redirect: 'follow' });
    var text = await dres.text(); var pm = text.match(/window\.play_id\s*=\s*'([^']+)'/); if (!pm) throw new Error('歌曲客：无play_id');
    var playId = pm[1], cookie = ghCookie(dres.headers.get('set-cookie'));
    var resp = await fetch(GK_BASE + '/api/music', { method: 'POST', headers: { 'User-Agent': GK_UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'Http', 'X-Custom-Header': 'Key', 'Referer': GK_BASE + '/song/' + id, 'Origin': GK_BASE, 'Accept': 'application/json, text/javascript, */*; q=0.01', 'Cookie': cookie }, body: 'id=' + encodeURIComponent(playId) + '&type=0', redirect: 'follow' });
    var j; try { j = JSON.parse(await resp.text()); } catch (e) { throw new Error('歌曲客：解析失败'); }
    if (!j || j.code !== 200 || !j.data || !j.data.url) throw new Error('歌曲客：取链失败' + (j ? '(' + j.code + ')' : ''));
    return { url: j.data.url, headers: { 'User-Agent': GK_UA, 'Referer': 'https://www.kuwo.cn/' } };
  }

  // ---- ④ 歌曲宝 gequbao.com（fetch + cheerio，当前站结构：search-fallback + JWT play_id + purpose=play）----
  var GB_BASE = 'https://www.gequbao.com', GB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  function gbCookie(sh) { if (!sh) return ''; return sh.split(',').map(function (s) { return s.split(';')[0]; }).join('; '); }
  async function gbSearch(kw) {
    var r = await fetch(GB_BASE + '/search-fallback?keyword=' + encodeURIComponent(kw), { headers: { 'User-Agent': GB_UA }, redirect: 'follow' });
    var $ = cheerio.load(await r.text()); var data = [];
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
  async function gbUrl(id) {
    var dres = await fetch(GB_BASE + '/music/' + id, { headers: { 'User-Agent': GB_UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' }, redirect: 'follow' });
    var text = await dres.text();
    var pm = text.match(/play_id\\u0022:\\u0022(eyJ[A-Za-z0-9+/=]+)/);
    if (!pm) throw new Error('歌曲宝：详情页未找到 play_id');
    var playId = pm[1], cookie = gbCookie(dres.headers.get('set-cookie'));
    var resp = await fetch(GB_BASE + '/member/common-play-url', { method: 'POST', headers: { 'User-Agent': GB_UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Referer': GB_BASE + '/music/' + id, 'Origin': GB_BASE, 'Accept': 'application/json, text/javascript, */*; q=0.01', 'Cookie': cookie }, body: 'id=' + encodeURIComponent(playId) + '&purpose=play', redirect: 'follow' });
    var j; try { j = JSON.parse(await resp.text()); } catch (e) { throw new Error('歌曲宝：接口返回解析失败'); }
    if (!j || j.code !== 1 || !j.data || !j.data.url) throw new Error('歌曲宝：取链失败' + (j ? '(' + j.code + ')' : ''));
    return { url: j.data.url, headers: { 'User-Agent': GB_UA, 'Referer': 'https://www.kuwo.cn/' } };
  }

  // ---- ⑤ 凤梨音乐 flmp3.pro（axios + cheerio，kuwo CDN 直链）----
  var FL_BASE = 'https://www.flmp3.pro', FL_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  function flReq(url) { return axios.get(url, { headers: { 'User-Agent': FL_UA, 'Referer': FL_BASE + '/', 'X-Requested-With': 'XMLHttpRequest' }, timeout: 10000, responseType: 'text' }); }
  async function flSearch(kw) {
    var r = await flReq(FL_BASE + '/search.html?keyword=' + encodeURIComponent(kw) + '&page=1');
    var $ = cheerio.load(r.data); var data = [];
    $('.list ul li').each(function (i, el) {
      var a = $(el).find('a').first(); var href = a.attr('href') || ''; var m = href.match(/\/song\/(\d+)\.html/); if (!m) return;
      var id = m[1], title = a.find('h3').first().text().trim(), artist = a.find('p').first().text().trim();
      if (title) data.push({ id: id, title: title, artist: artist || '未知歌手' });
    });
    return data;
  }
  async function flUrl(id) { var r = await flReq(FL_BASE + '/api/playurl.php?id=' + id); var url = String(r.data).trim(); if (!/^https?:\/\//.test(url)) throw new Error('凤梨：未解析到直链'); return { url: url, headers: { 'User-Agent': FL_UA, 'Referer': FL_BASE + '/' } }; }

  // ---- ⑥ 溜声音乐 6sing.top（fetch + cheerio，http 站点，kuwo CDN 直链）----
  var LS_BASE = 'http://www.6sing.top', LS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  function lsParseTitle(raw) {
    raw = (raw || '').trim(); if (!raw) return { title: '未知歌曲', artist: '未知歌手' };
    var title = raw, artist = '未知歌手'; var NO = /版|伴奏|演奏|Remix|remix|DJ|flac|mp3/i;
    var pm = raw.match(/[（(]([^）)]*)[）)]/); if (pm && pm[1].length > 0 && pm[1].length <= 5 && !NO.test(pm[1])) artist = pm[1].trim();
    var di = raw.lastIndexOf('-'); if (di >= 0) { var tail = raw.slice(di + 1).trim().replace(/[）)]/g, '').trim(); if (tail && tail.length >= 1 && tail.length <= 10 && !NO.test(tail)) { artist = tail; title = raw.slice(0, di).trim(); } }
    title = title.replace(/[（(][^）)]*[）)]/g, '').trim(); if (!title) title = raw; return { title: title, artist: artist };
  }
  async function lsSearch(kw) {
    var r = await fetch(LS_BASE + '/search.html?keyword=' + encodeURIComponent(kw), { headers: { 'User-Agent': LS_UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' }, redirect: 'follow' });
    var $ = cheerio.load(await r.text()); var data = [];
    $('a[href^="/detail/"]').each(function (i, el) { var a = $(el); var href = a.attr('href') || ''; var m = href.match(/\/detail\/(\d+)\.html/); if (!m) return; var id = m[1]; var p = lsParseTitle(a.attr('title')); data.push({ id: id, title: p.title, artist: p.artist }); });
    return data;
  }
  async function lsUrl(id) {
    var resp = await fetch(LS_BASE + '/api/play.php?id=' + encodeURIComponent(id), { method: 'GET', headers: { 'User-Agent': LS_UA, 'Accept': 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', 'Referer': LS_BASE + '/detail/' + id + '.html' }, redirect: 'follow' });
    var j; try { j = await resp.json(); } catch (e) { throw new Error('溜声：解析失败'); }
    if (!j || j.code !== '200' || !j.url) throw new Error('溜声：取链失败' + (j ? '(' + j.code + ')' : ''));
    return { url: j.url, headers: { 'User-Agent': LS_UA, 'Referer': 'https://www.kuwo.cn/' } };
  }

  // ---- ⑦ 无名音乐网 mvmp3.com（axios + cheerio，移植自 wy.js，自动过验证，返歌手+时长便于校验）----
  var MV_BASE = 'https://www.mvmp3.com', MV_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  var MV_HEADERS = { 'User-Agent': MV_UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' };
  var _mvCk = null, _mvAt = 0;
  function mvIsVerify(h) { return /安全人机验证|我不是人机|verifyForm/.test(h || ''); }
  function mvParse(html) {
    var $ = cheerio.load(html); var items = [], seen = {};
    $('.play_list li').each(function (i, el) {
      var a = $(el).find('a.url').first(); if (!a.length) return;
      var href = a.attr('href') || ''; var m = href.match(/\/mp3\/([a-f0-9]{32})\.html/i); if (!m) return;
      var id = m[1]; if (seen[id]) return; seen[id] = 1;
      var ta = (a.text() || '').replace(/\s+/g, ' ').trim(); var artist = '', title = ta;
      var idx = ta.indexOf(' - '); if (idx > 0) { artist = ta.substring(0, idx).trim(); title = ta.substring(idx + 3).trim(); }
      items.push({ id: id, title: title, artist: artist });
    });
    return items;
  }
  function mvNormCookie(raw) { raw = (raw || '').trim(); if (!raw) return ''; if (raw.indexOf('=') === -1) return 'PHPSESSID=' + raw; return raw; }
  async function mvAutoVerify() {
    var r1 = await axios.get(MV_BASE + '/', { headers: MV_HEADERS, timeout: 9000 });
    var sc = (r1.headers && r1.headers['set-cookie']) || []; var jar = {};
    sc.forEach(function (c) { var i = c.indexOf('='); if (i > 0) jar[c.slice(0, i).trim()] = c.split(';')[0].split('=').slice(1).join('=').trim(); });
    var ck = Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
    if (!ck) throw new Error('无名：无法建会话');
    if (!mvIsVerify(r1.data)) return ck;
    var m = (r1.data || '').match(/name="csrf_token" value="([^"]+)"/); var csrf = m ? m[1] : '';
    await axios.post(MV_BASE + '/', 'csrf_token=' + encodeURIComponent(csrf) + '&human_check=on', { headers: Object.assign({}, MV_HEADERS, { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': MV_BASE + '/', 'Cookie': ck }), timeout: 9000, maxRedirects: 5, validateStatus: function () { return true; } });
    return ck;
  }
  async function mvCookie(force) { var now = Date.now(); if (!force && _mvCk && (now - _mvAt) < 50 * 60 * 1000) return _mvCk; var f = await mvAutoVerify(); _mvCk = f; _mvAt = now; return f; }
  async function mvSearch(kw, cookie) {
    var r = await axios.get(MV_BASE + '/so/' + encodeURIComponent(kw || '') + '.html', { headers: Object.assign({}, MV_HEADERS, { 'Cookie': cookie }), timeout: 9000, validateStatus: function () { return true; } });
    if (mvIsVerify(r.data)) throw new Error('无名：验证失败');
    return mvParse(r.data);
  }
  async function mvUrl(hash, cookie) {
    var r = await axios.post(MV_BASE + '/style/js/play.php', 'id=' + hash + '&type=dance', { headers: { 'User-Agent': MV_UA, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', 'Referer': MV_BASE + '/mp3/' + hash + '.html', 'Cookie': cookie }, timeout: 9000, validateStatus: function () { return true; } });
    return r.data;
  }

  // ---- ⑧⑨ 独立站末位兜底（跨平台通用同名替身）----
  var XM_BASE = 'https://www.xmfwav.com', XM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  async function xmSearch(kw) {
    var r = await fetch(XM_BASE + '/srcj/?kwd=' + encodeURIComponent(kw), { headers: { 'User-Agent': XM_UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }, redirect: 'follow' });
    var $ = cheerio.load(await r.text()); var data = [];
    $('a.srcsong-item').each(function (i, el) { var a = $(el); var href = a.attr('href') || ''; var m = href.match(/\/song\/(\d+)/); if (!m) return; var id = m[1]; var title = a.find('span.srcsong-name').first().text().trim(); var artist = a.find('span.srcact').first().text().trim(); if (title) data.push({ id: id, title: title, artist: artist || '未知歌手' }); });
    return data;
  }
  async function xmUrl(id) { var html = await (await fetch(XM_BASE + '/song/' + id, { redirect: 'follow' })).text(); var m = html.match(/url:\s*['"]([^'"]+\.(?:mp3|wav|flac|ogg|m4a))['"]/i); if (!m || !/^https?:\/\//.test(m[1])) throw new Error('小蜜蜂：无直链'); return { url: m[1], headers: { 'User-Agent': XM_UA } }; }
  var YW_BASE = 'https://www.yinwe.com', YW_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  function ywParseTitle(raw) { raw = (raw || '').trim(); if (!raw) return { title: '未知歌曲', artist: '未知歌手' }; var m = raw.match(/^(.*?)[（(](.+?)[）)]\s*[-\u2013\u2014]?\s*(.*)$/); if (m) return { title: m[1].trim() || raw, artist: m[2].trim() || '未知歌手' }; if (raw.indexOf(' - ') >= 0) { var p = raw.split(/\s*-\s*/); return { title: p[0].trim(), artist: p.slice(1).join('-').trim() || '未知歌手' }; } return { title: raw, artist: '未知歌手' }; }
  async function ywSearch(kw) {
    var r = await fetch(YW_BASE + '/?keyword=' + encodeURIComponent(kw), { headers: { 'User-Agent': YW_UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' }, redirect: 'follow' });
    var $ = cheerio.load(await r.text()); var data = [];
    $('a.sp1[href*="/yinyue/"]').each(function (i, el) { var a = $(el); var href = a.attr('href') || ''; var m = href.match(/\/yinyue\/(\d+)\.html/); if (!m) return; var id = m[1]; var p = ywParseTitle(a.attr('title')); data.push({ id: id, title: p.title, artist: p.artist }); });
    return data;
  }
  async function ywUrl(id) {
    var resp = await fetch(YW_BASE + '/?plugin=xmusic_like&do=playmusic&articleId=' + encodeURIComponent(id), { method: 'GET', headers: { 'User-Agent': YW_UA, 'Accept': 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', 'Referer': YW_BASE + '/yinyue/' + id + '.html' }, redirect: 'follow' });
    var j; try { j = await resp.json(); } catch (e) { throw new Error('音微：解析失败'); }
    if (!Array.isArray(j) || !j[0] || (!j[0].url && !j[0].downlink)) throw new Error('音微：取链失败');
    return { url: j[0].url || j[0].downlink, headers: { 'User-Agent': YW_UA } };
  }

  // 兜底编排：官方代理优先 → 依次尝试备选源（每源经 kwPick 身份校验）
  var KW_BACKUPS = [
    { name: '无忧音乐网', search: qeSearch, url: qeUrl },
    { name: '歌曲海', search: ghSearch, url: ghUrl },
    { name: '歌曲客', search: gkSearch, url: gkUrl },
    { name: '歌曲宝', search: gbSearch, url: gbUrl },
    { name: '凤梨音乐', search: flSearch, url: flUrl },
    { name: '溜声音乐', search: lsSearch, url: lsUrl },
    { name: '无名音乐网', search: async function (kw) { var ck = await mvCookie(false); return mvSearch(kw, ck); }, url: async function (id) { var ck = await mvCookie(false); return mvUrl(id, ck); } },
    { name: '小蜜蜂', search: xmSearch, url: xmUrl },
    { name: '音微网', search: ywSearch, url: ywUrl },
  ];
  async function kwFallback(musicItem) {
    var kw = (musicItem.title || '').trim();
    if (!kw) throw new Error('歌曲标题为空，无法在备选源检索');
    var errs = [];
    for (var i = 0; i < KW_BACKUPS.length; i++) {
      var b = KW_BACKUPS[i];
      try {
        var items = await b.search(kw);
        var ordered = kwPick(items, musicItem);
        if (!ordered || !ordered.length) { errs.push(b.name + ':无匹配候选'); continue; }
        var res = await b.url(ordered[0].id);
        if (res && res.url) {
          if (!res.headers) res.headers = {};
          res.headers['X-Kw-Backup'] = b.name;
          return res;
        }
        errs.push(b.name + ':空链接');
      } catch (e) { errs.push(b.name + ':' + e.message); }
    }
    var name = (musicItem.title || '') + (musicItem.artist ? '（' + musicItem.artist + '）' : '');
    throw new Error('《' + name + '》官方代理与全部备选源均未取得：' + errs.join('；'));
  }

  // ============================ 取链（念心社区代理 + 酷我系多源兜底） ============================
  // 说明：酷我官方免费 antiserver 接口实测对任一 rid 均返回同一首歌（已失效），
  // 故沿用社区公认的稳定代理 music.nxinxz.com/kw.php（直接返回酷我真实音频流）作为第一优先；
  // 代理不可达时，按 KW_BACKUPS 顺序经酷我系备选源兜底（均经身份校验防错播）。
  async function getMediaSource(musicItem, quality) {
    const userQuality = PLUGIN_QUALITY_MAP[quality] || '128k';
    // 代理 music.nxinxz.com 的 level 参数只认 kuwo 内部档位，故传 QUALITY_MAP 映射后的档位
    const apiLevel = QUALITY_MAP[userQuality];
    if (!apiLevel) throw new Error('不支持的音质: ' + quality);
    const songId = musicItem.id;
    if (songId) {
      const url = PROXY_BASE + '/kw.php?id=' + encodeURIComponent(songId) + '&level=' + encodeURIComponent(apiLevel) + '&type=mp3';
      // 官方代理第一优先：轻量可达性探测（仅读响应头，不下载音频体），失败则兜底
      try {
        const probe = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
        const ct = (probe.headers && probe.headers.get && probe.headers.get('content-type')) || '';
        if ((probe.status === 200 || probe.status === 206) && /^audio|video\/mp4|application\/octet-stream/i.test(ct)) {
          return { url: url };
        }
      } catch (e) { /* 代理不可达，走兜底 */ }
    }
    return await kwFallback(musicItem);
  }

  // ============================ 歌词 ============================
  // 修复（2026-10-16）：酷我 lrclist[].time 为「秒」浮点（如 15.38），原实现直接拼成 [15.38]歌词，
  //   该时间戳不符合 LRC 标准 [mm:ss.xx]，导致：① 播放器无法解析时间戳 → 歌词加载失败（部分曲目）；
  //   ② 无法按播放进度滚动（不跟随歌曲）。现统一转换为 LRC 标准格式，并对歌词做 HTML 实体解码。
  function kwSecToLrc(sec) {
    var t = parseFloat(sec);
    if (isNaN(t) || t < 0) return null;
    var m = Math.floor(t / 60);
    var s = (t - m * 60).toFixed(2);
    var ss = (s < 10 ? '0' + s : '' + s);   // s 形如 "x.xx"，<10 补零（如 5.38 → 05.38）
    var mm = (m < 10 ? '0' + m : '' + m);
    return '[' + mm + ':' + ss + ']';
  }
  async function getLyric(musicItem) {
    const res = toObj((await axios.get('http://m.kuwo.cn/newh5/singles/songinfoandlrc', {
      params: { musicId: musicItem.id, httpStatus: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const data = res.data || {};
    const list = data.lrclist;
    if (list && list.length) {
      const lines = [];
      for (let i = 0; i < list.length; i++) {
        const it = list[i] || {};
        const txt = decode(it.lineLyric || '');   // 解码 HTML 实体（&amp; / &#23621; 等），避免乱码
        const ts = kwSecToLrc(it.time);
        if (!ts) continue;                         // 缺时间戳（间奏占位等）→ 跳过该行，避免污染滚动锚点
        lines.push(ts + txt);
      }
      if (lines.length) return { rawLrc: lines.join('\n') };
    }
    // 兜底：部分曲目仅返回整段 lrc 文本（data.lrc 已含正确 [mm:ss.xx] 时间戳），直接透传并解码
    if (typeof data.lrc === 'string' && data.lrc.trim()) return { rawLrc: decode(data.lrc) };
    return { rawLrc: '' };
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
    platform: '酷我',
    version: '0.0.2',
    author: 'tianpeng',
    description: '酷我音源：支持歌单导入、热门歌单、官方排行榜，附带搜索/歌词/专辑/歌手。' +
      '取链使用社区代理 music.nxinxz.com（酷我官方免费接口已失效）。',
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@v0.0.2/musicfree-kw/github/kw.js',
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
    _backups: KW_BACKUPS, // 调试/测试用：暴露内联备选源清单
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
})();
