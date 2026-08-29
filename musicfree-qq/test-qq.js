// qq.js 全链路真网测试（模拟 MusicFree 沙箱：__musicfree_require 提供 axios 包装，env 提供 userVariables）
const fs = require('fs');
const path = require('path');

// ---- axios 包装：用 node 22 原生 fetch 模拟沙箱 axios（支持 get + post + params 拼接） ----
function toHeadersObj(h) { return Object.fromEntries(h.entries()); }
async function shimGet(url, config) {
  config = config || {};
  let full = url;
  if (config.params) {
    const us = new URL(full);
    for (const k in config.params) {
      const v = config.params[k];
      if (v === undefined || v === null) continue;
      us.searchParams.set(k, String(v));
    }
    full = us.toString();
  }
  const headers = config.headers || {};
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), config.timeout || 10000);
  let resp;
  try {
    resp = await fetch(full, { headers, signal: ctrl.signal });
  } finally { clearTimeout(to); }
  const text = await resp.text();
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  let data = text;
  if (ct.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try { data = JSON.parse(text); } catch (e) { data = text; }
  }
  return { status: resp.status, data, headers: toHeadersObj(resp.headers) };
}
async function shimPost(url, body, config) {
  config = config || {};
  const headers = config.headers || {};
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), config.timeout || 15000);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
  } finally { clearTimeout(to); }
  const text = await resp.text();
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  let data = text;
  if (ct.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try { data = JSON.parse(text); } catch (e) { data = text; }
  }
  return { status: resp.status, data, headers: toHeadersObj(resp.headers) };
}
const axiosShim = { get: shimGet, post: shimPost };

// ---- 全局环境 ----
// cheerio 仅在 MusicFree 沙箱内置；node 测试环境用 noop mock，让 mvmp3 搜索安全失败转下一层（不影响 Tonzhon 兜底层）
global.__musicfree_require = (m) => {
  if (m === 'axios') return axiosShim;
  if (m === 'cheerio') return { load: () => ({ each: () => {}, find: () => ({ first: () => ({ attr: () => '', text: () => '' }) }) }) };
  return require(m);
};
global.env = { getUserVariables: () => ({ cookie: process.env.QQ_COOKIE || '' }) };

// ---- 加载插件 ----
const plugin = require('./qq.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) { (cond ? pass++ : fail++); console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? '  ' + extra : '')); }

(async () => {
  console.log('===== QQ音乐插件全链路测试（含三层兜底取链）=====\n');

  // 0) 加载
  console.log('0) 加载 OK，platform=', plugin.platform, 'author=', plugin.author, 'version=', plugin.version);

  // 1) 搜索
  let s = await plugin.search('晴天', 1, 'music');
  ok('search 返回条目', Array.isArray(s.data) && s.data.length > 0, 'count=' + (s.data ? s.data.length : 0));
  const firstSong = s.data && s.data[0];
  console.log('   搜索首条:', firstSong && JSON.stringify({ id: firstSong.id, title: firstSong.title, artist: firstSong.artist, album: firstSong.album, duration: firstSong.duration }));

  // 2) 排行榜列表
  let tl = await plugin.getTopLists();
  const tlData = (tl[0] && tl[0].data) || [];
  ok('getTopLists 返回榜单', tlData.length > 0, 'count=' + tlData.length);
  console.log('   榜单样例:', tlData.slice(0, 3).map(t => t.title + '(' + t.id + ')').join(' / '));
  const topId = tlData[0] && tlData[0].id;

  // 3) 排行榜详情
  if (topId) {
    let td = await plugin.getTopListDetail({ id: topId }, 1);
    ok('getTopListDetail 返回曲目', Array.isArray(td.musicList) && td.musicList.length > 0, 'count=' + (td.musicList ? td.musicList.length : 0));
    console.log('   榜单详情首条:', td.musicList[0] && JSON.stringify({ title: td.musicList[0].title, artist: td.musicList[0].artist }));
  } else { ok('getTopListDetail', false, '无 topId'); }

  // 4) 热门歌单标签（协议要求 data 为分组数组：[{title, data:[{id,title}]}]）
  let tags = await plugin.getRecommendSheetTags();
  const groups = tags.data || [];
  const flatTags = [];
  groups.forEach(g => (g.data || []).forEach(t => flatTags.push(t)));
  const pinned = tags.pinned || [];
  const allTags = flatTags.concat(pinned);
  ok('getRecommendSheetTags 分组结构正确', Array.isArray(groups) && groups.length > 0 && Array.isArray(groups[0].data), 'groups=' + groups.length + ' 标签项=' + allTags.length);
  console.log('   分组样例:', groups.slice(0, 4).map(g => g.title + '[' + g.data.length + ']').join(' / '));
  console.log('   pinned:', pinned.map(p => p.title + '(' + p.id + ')').join(' / '));
  const tagId = allTags[0] && allTags[0].id;

  // 5) 按标签取热门歌单
  let hsAll = await plugin.getRecommendSheetsByTag({ id: '10000000' }, 1);
  ok('getRecommendSheetsByTag(全部) 返回歌单', Array.isArray(hsAll.data) && hsAll.data.length > 0, 'count=' + (hsAll.data ? hsAll.data.length : 0));
  console.log('   全部-热门歌单首条:', hsAll.data[0] && JSON.stringify({ id: hsAll.data[0].id, title: hsAll.data[0].title, artist: hsAll.data[0].artist }));
  if (tagId) {
    let hs = await plugin.getRecommendSheetsByTag({ id: tagId }, 1);
    ok('getRecommendSheetsByTag(分类) 返回歌单', Array.isArray(hs.data) && hs.data.length > 0, 'count=' + (hs.data ? hs.data.length : 0));
  } else { ok('getRecommendSheetsByTag(分类)', false, '无 tagId'); }
  const dissId = hsAll.data && hsAll.data[0] && hsAll.data[0].id;

  // 6) 导入歌单
  if (dissId && hsAll.data) {
    let imported = null, privacySkip = 0;
    for (const sheet of hsAll.data) {
      try {
        let imp = await plugin.importMusicSheet(sheet.id);
        if (Array.isArray(imp) && imp.length > 0) { imported = imp; break; }
      } catch (e) {
        if (/私密|privacy/.test(e.message)) privacySkip++;
      }
    }
    ok('importMusicSheet 导入公开歌单', !!imported, 'count=' + (imported ? imported.length : 0) + ' 私密跳过=' + privacySkip);
    if (imported) console.log('   导入首条:', imported[0] && JSON.stringify({ id: imported[0].id, title: imported[0].title, artist: imported[0].artist }));
  } else { ok('importMusicSheet', false, '无 dissId'); }

  // 7) 歌词
  if (firstSong && firstSong.id) {
    try {
      let ly = await plugin.getLyric(firstSong);
      const has = !!(ly && (ly.rawLrc));
      ok('getLyric 返回歌词', has, 'rawLrc.len=' + (ly && ly.rawLrc ? ly.rawLrc.length : 0) + ' trans=' + (ly && ly.translation ? ly.translation.length : 0));
      console.log('   歌词前60字:', ly && ly.rawLrc ? ly.rawLrc.slice(0, 60).replace(/\n/g, '⏎') : '(空)');
    } catch (e) { ok('getLyric', false, 'ERR ' + e.message); }
  } else { ok('getLyric', false, '无 songmid'); }

  // 8) 取链三层兜底（未登录：官方失败 → mvmp3（node 环境 cheerio noop 安全失败）→ Tonzhon 网易云匹配）
  console.log('\n--- 取链三层兜底验证（未登录，官方必失败，应走备用音源）---');
  const testSongs = [
    firstSong,
    { id: '004Hs9w00VlVzs', title: '七里香', artist: '周杰伦' }, // 已知免费流行曲
  ].filter(Boolean);
  let gotUrl = 0, fellThrough = 0;
  for (const song of testSongs) {
    try {
      let src = await plugin.getMediaSource(song);
      if (src && src.url && /^https?:\/\//.test(src.url)) {
        gotUrl++;
        console.log('   ✅《' + song.title + '》取链成功 层=备用音源 url=' + src.url.slice(0, 64));
      } else {
        fellThrough++;
        console.log('   ⚠️《' + song.title + '》返回异常对象:', JSON.stringify(src).slice(0, 80));
      }
    } catch (e) {
      fellThrough++;
      console.log('   ❌《' + song.title + '》最终失败 MSG=' + e.message);
    }
  }
  ok('getMediaSource 三层兜底至少 1 首取得可播链', gotUrl >= 1, '成功=' + gotUrl + ' 失败=' + fellThrough + '（共' + testSongs.length + '首）');

  console.log('\n===== 结果: PASS=' + pass + '  FAIL=' + fail + ' =====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
