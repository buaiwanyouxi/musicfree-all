import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const plugin = require('./buguyy.js');

function ok(label, cond, extra) {
  console.log((cond ? '✅' : '❌') + ' ' + label + (extra ? '  ' + extra : ''));
}

async function test() {
  console.log('=== 1) search ===');
  let sr;
  try {
    sr = await plugin.search('周杰伦', 1, 'music');
  } catch (e) {
    return console.error('search 抛出异常:', e.message);
  }
  ok('返回对象含 data 数组', Array.isArray(sr.data));
  ok('isEnd 为 true (不翻页)', sr.isEnd === true);
  ok('有结果', sr.data.length > 0, 'count=' + sr.data.length);
  if (sr.data.length) {
    const f = sr.data[0];
    console.log('   首条:', JSON.stringify({ id: f.id, title: f.title, artist: f.artist, artwork: f.artwork?.slice(0, 40), aboutLen: (f.about || '').length }));
    ok('id 为字符串', typeof f.id === 'string');
    ok('title 存在', !!f.title);
    ok('artist 存在', !!f.artist);
  }

  console.log('\n=== 2) getMediaSource (用首条) ===');
  if (sr.data.length) {
    let ms;
    try {
      ms = await plugin.getMediaSource(sr.data[0], 'standard');
    } catch (e) {
      return console.error('getMediaSource 异常:', e.message);
    }
    ok('返回 url', !!ms.url, ms.url?.slice(0, 60) + '...');
    ok('url 为酷我 mp3', /kuwo\.cn.*\.mp3/i.test(ms.url || ''));
    ok('返回 headers', ms.headers && typeof ms.headers === 'object');
    // 验证可访问
    try {
      const h = await fetch(ms.url, { method: 'HEAD', headers: ms.headers });
      ok('直链可访问', h.status === 200, 'status=' + h.status + ' ct=' + h.headers.get('content-type'));
    } catch (e) {
      console.log('❌ 直链访问异常:', e.message);
    }
  }

  console.log('\n=== 3) getLyric (用首条 about) ===');
  if (sr.data.length) {
    const ly = await plugin.getLyric(sr.data[0]);
    console.log('   rawLrc 前120字符:', JSON.stringify((ly.rawLrc || '').slice(0, 120)));
    ok('返回对象', ly && typeof ly === 'object');
    ok('rawLrc 为字符串', typeof (ly.rawLrc || '') === 'string');
    ok('歌词已转义 <br>', !/<br\s*\/?>/i.test(ly.rawLrc || ''));
  }

  console.log('\n=== 4) getTopLists ===');
  let tl;
  try {
    tl = await plugin.getTopLists();
  } catch (e) {
    return console.error('getTopLists 异常:', e.message);
  }
  ok('返回数组', Array.isArray(tl));
  ok('含分组数据', tl.length > 0 && Array.isArray(tl[0].data) && tl[0].data.length > 0, 'groups=' + tl.length);
  if (tl[0]?.data?.length) console.log('   榜单:', tl[0].data.map((d) => d.id + ':' + d.title).join(', '));

  console.log('\n=== 5) getTopListDetail (newlist) ===');
  try {
    const td = await plugin.getTopListDetail({ id: 'newlist' }, 1);
    ok('返回 musicList 数组', Array.isArray(td.musicList));
    ok('isEnd true', td.isEnd === true);
    ok('有歌曲', td.musicList.length > 0, 'count=' + td.musicList.length);
    if (td.musicList.length) console.log('   首条:', JSON.stringify({ id: td.musicList[0].id, title: td.musicList[0].title, artist: td.musicList[0].artist }));
  } catch (e) {
    console.error('getTopListDetail 异常:', e.message);
  }

  console.log('\n全部测试完成。');
}

test();
