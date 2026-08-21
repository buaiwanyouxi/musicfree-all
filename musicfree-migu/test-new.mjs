import axios from 'axios';
// MusicFree 沙箱中 axios 为全局注入；本地测试需手动提供
globalThis.axios = axios;

const plugin = await import('./migu.js');
const p = plugin.default || plugin;

function ok(name, cond, extra='') { console.log((cond?'✅':'❌')+' '+name+(extra?'  '+extra:'')); return cond; }

// 1) 搜索翻页
console.log('\n=== 搜索翻页 ===');
const s1 = await p.search('周杰伦', 1);
const s2 = await p.search('周杰伦', 2);
const ids1 = s1.data.map(x=>x.id);
const ids2 = s2.data.map(x=>x.id);
ok('search p1 返回数据', s1.data.length>0, `len=${s1.data.length}`);
ok('search p2 返回数据', s2.data.length>0, `len=${s2.data.length}`);
ok('p1/p2 内容不同(翻页生效)', JSON.stringify(ids1)!==JSON.stringify(ids2));
ok('p1 未标记末页', s1.isEnd===false);
console.log('   p1示例:', s1.data[0]?.title, '/', s1.data[0]?.artist);

// 2) getTopLists
console.log('\n=== getTopLists ===');
const tops = await p.getTopLists();
const ranks = tops.filter(t=>t._type==='rank');
const cols = tops.filter(t=>t._type==='column');
ok('返回榜单列表', ranks.length>0, `ranks=${ranks.length}`);
console.log('   (公开歌单需登录，本版以排行榜作为榜单/歌单集合；cols='+cols.length+')');
console.log('   榜单示例:', ranks.slice(0,5).map(r=>r.title).join('、'));
console.log('   歌单示例:', cols.map(c=>c.title).join('、'));

// 3) 榜单详情 + 翻页
console.log('\n=== 榜单详情(翻页) ===');
const rank = ranks[0];
const rd1 = await p.getTopListDetail(rank, 1);
const rd2 = await p.getTopListDetail(rank, 2);
ok('榜单详情 p1 有歌曲', rd1.data.length>0, `len=${rd1.data.length}`);
ok('榜单详情 p1 未末页', rd1.isEnd===false);
ok('榜单详情 p2 有歌曲', rd2.data.length>0, `len=${rd2.data.length}`);
const rids1 = rd1.data.map(x=>x.id), rids2 = rd2.data.map(x=>x.id);
ok('榜单详情 p1/p2 不同', JSON.stringify(rids1)!==JSON.stringify(rids2));
const rsong = rd1.data[0];
console.log('   歌曲示例:', rsong?.title, '/', rsong?.artist, '| _contentId=', rsong?._contentId, '| _resourceType=', rsong?._resourceType);

// 4) 歌单详情（公开歌单无免cookie可播放源，已移除栏目歌单；此处仅在有栏目时校验）
const col = cols[0];
if (col) {
  console.log('\n=== 歌单详情 ===');
  const cd = await p.getTopListDetail(col, 1);
  ok('歌单详情有歌曲', cd.data.length>0, `len=${cd.data.length}`);
} else {
  console.log('\n=== 歌单：已移除不可用栏目（公开歌单需登录，详情见 README）===');
}
const csong = col ? (await p.getTopListDetail(col, 1)).data[0] : null;

// 5) 播放音源（榜单歌曲批量可播性）
console.log('\n=== 播放音源验证（榜单前若干首）===');
let playOk = 0, playTry = 0;
const sampleSongs = [rsong, ...rd1.data.slice(1, 8)];
for (const song of sampleSongs) {
  if (!song) continue;
  playTry++;
  try {
    const ms = await p.getMediaSource(song);
    const httpOk = await axios.get(ms.url, { headers: ms.headers, timeout: 15000, responseType:'head' }).then(r=>r.status===200).catch(()=>false);
    ok(`音源可播放 [${song.title}]`, httpOk, httpOk?ms.url.slice(0,50)+'...':'NO-URL');
    if (httpOk) playOk++;
  } catch(e) { ok(`音源可播放 [${song.title}]`, false, e.message.slice(0,24)); }
}
console.log(`\n播放验证: ${playOk}/${playTry} 成功`);
console.log('\n=== 测试完成 ===');
