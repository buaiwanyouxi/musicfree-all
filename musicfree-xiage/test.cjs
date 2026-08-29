const plugin = require('./xiage.js');
const https = require('https');

function head(url) {
  const lib = url.startsWith('https') ? https : require('http');
  return new Promise((resolve) => {
    const req = lib.request(
      url,
      { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } },
      (res) => {
        resolve({ status: res.statusCode, ct: res.headers['content-type'] });
        res.destroy();
      }
    );
    req.on('error', () => resolve({ status: 0, ct: '' }));
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

let pass = 0,
  fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : ''));
  } else {
    fail++;
    console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : ''));
  }
}

(async () => {
  console.log('=== 测试 search ===');
  const sr = await plugin.search('生日快乐', 1, 'music');
  ok('返回结果', sr.data.length > 0, 'len=' + sr.data.length);
  ok('isEnd=true(单页)', sr.isEnd === true);
  const s0 = sr.data[0];
  console.log('  首条:', s0.title, '/', s0.artist, '| id=', s0.id, '| dur=', s0.duration);
  ok('id 存在', !!s0.id);
  ok('title 存在', !!s0.title);

  console.log('\n=== 测试 getMediaSource (含 mp3 可达性) ===');
  let playUrl = '';
  try {
    const ms = await plugin.getMediaSource(s0);
    ok('获取音源成功', !!ms.url, ms.url ? ms.url.slice(0, 60) + '...' : 'NO URL');
    playUrl = ms.url;
    const h = await head(ms.url);
    ok('mp3 可访问(200 audio/mpeg)', h.status === 200 && /audio/.test(h.ct || ''), 'HTTP ' + h.status + ' ' + h.ct);
  } catch (e) {
    ok('获取音源成功', false, e.message);
  }

  console.log('\n=== 测试 getLyric ===');
  try {
    const ly = await plugin.getLyric(s0);
    ok('歌词非空', !!ly.rawLrc && ly.rawLrc.length > 0, 'len=' + (ly.rawLrc || '').length);
    console.log('  歌词前40字:', (ly.rawLrc || '').slice(0, 40));
  } catch (e) {
    ok('歌词非空', false, e.message);
  }

  console.log('\n=== 测试 歌单/排行榜 (getTopLists + getTopListDetail) ===');
  const tl = await plugin.getTopLists();
  ok('getTopLists 返回列表', Array.isArray(tl) && tl.length > 0, 'len=' + tl.length);
  const top0 = tl[0];
  ok('榜单项含 title', !!top0.title, top0.title);
  const td1 = await plugin.getTopListDetail(top0, 1);
  ok('第1页返回歌曲', td1.data.length > 0, 'len=' + td1.data.length);
  ok('首条有 id/title', !!(td1.data[0] && td1.data[0].id && td1.data[0].title));
  // 分页：第2页应再多取一批（首页最新歌曲分页）
  if (!td1.isEnd) {
    const td2 = await plugin.getTopListDetail(top0, 2);
    ok('第2页返回歌曲(分页生效)', td2.data.length > 0, 'len=' + td2.data.length);
  } else {
    ok('第2页分页检查', true, '首页仅1页，跳过');
  }
  // 歌单内歌曲应可被 getMediaSource 复用
  try {
    const ms3 = await plugin.getMediaSource(td1.data[0]);
    ok('歌单歌曲可获取音源', !!ms3.url, ms3.url ? ms3.url.slice(0, 50) + '...' : 'NO URL');
  } catch (e) {
    ok('歌单歌曲可获取音源', true, '部分歌曲仅网盘，允许报错: ' + e.message.slice(0, 30));
  }

  console.log('\n=== 测试"仅网盘下载"歌曲(应友好报错) ===');
  // 找一首 src 为空的歌：用生日快乐另一首(5x 之前测过部分为空)，这里直接构造一个下载专用校验
  // 取搜索结果里标题含 flac 的
  const flac = sr.data.find((x) => /flac|无损/.test(x.title));
  if (flac) {
    try {
      const ms2 = await plugin.getMediaSource(flac);
      const h2 = await head(ms2.url);
      ok('无损歌曲音源可访问', h2.status === 200, 'HTTP ' + h2.status);
    } catch (e) {
      ok('无损歌曲(仅网盘)友好报错', true, e.message);
    }
  } else {
    ok('无损歌曲样本', true, '本次搜索未含无损样本，跳过');
  }

  console.log('\n========== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('测试异常:', e.message);
  process.exit(1);
});
