// MusicFree 沙箱内会注入全局 axios；本地测试需手动提供
globalThis.axios = require('axios');
const plugin = require('./migu.js');
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log('  ✓ ' + n + (x ? '  [' + x + ']' : '')); } else { fail++; console.log('  ✗ ' + n + (x ? '  [' + x + ']' : '')); } }

(async () => {
  console.log('=== migu 加载 ===');
  ok('插件对象存在', !!plugin && typeof plugin.getTopLists === 'function');
  ok('版本号 0.0.3', plugin.version === '0.0.3', plugin.version);
  ok('声明 userVariables(miguCookie)', Array.isArray(plugin.userVariables) && plugin.userVariables.some(v => v.name === 'miguCookie'));

  console.log('\n=== getTopLists（无 cookie：仅排行榜）===');
  const tl = await plugin.getTopLists();
  const ranks = tl.filter(t => t._type === 'rank');
  const pls = tl.filter(t => t._type === 'playlist');
  ok('返回榜单列表', ranks.length > 0, 'ranks=' + ranks.length);
  ok('无 cookie 时歌单为空', pls.length === 0, 'playlists=' + pls.length);
  console.log('  前3个榜单:', ranks.slice(0, 3).map(r => r.title).join(' / '));

  console.log('\n=== getTopListDetail（榜单详情+分页）===');
  const td = await plugin.getTopListDetail(ranks[0], 1);
  ok('第1页有歌曲', td.data.length > 0, 'len=' + td.data.length);
  ok('歌曲可定位音源字段', !!(td.data[0] && td.data[0]._contentId && td.data[0]._copyrightId));

  console.log('\n=== 歌单 cookie -gated（填入假 cookie 应尝试但不报错）===');
  plugin.userVariables = { miguCookie: 'test_fake_cookie' };
  const tl2 = await plugin.getTopLists();
  ok('带 cookie 调用不抛错', Array.isArray(tl2), 'total=' + tl2.length);

  console.log('\n========== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
