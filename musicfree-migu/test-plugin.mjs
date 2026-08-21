// 加载 migu.js 并测试 search / getMediaSource / getLyric
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// 提供 axios 全局（与 MusicFree 沙箱一致）
import axios from 'axios';
globalThis.axios = axios;

const plugin = require('./migu.js');

function ok(label, cond, extra='') { console.log(`${cond?'✅':'❌'} ${label} ${extra}`); return cond; }

(async () => {
  console.log('=== 测试 search ===');
  const sr = await plugin.search('晴天', 1);
  console.log('  返回条数:', sr.data.length, '| isEnd:', sr.isEnd);
  ok('search 有结果', sr.data.length > 0);
  if (!sr.data.length) { console.log('无结果，终止'); return; }
  const sample = sr.data.find(s => s._contentId && s._copyrightId) || sr.data[0];
  console.log('  样例:', sample.title, '|', sample.artist, '| cover:', sample.coverImg.slice(0,40)+'...');

  console.log('\n=== 测试 getMediaSource ===');
  let src=null, srcErr=null;
  try { src = await plugin.getMediaSource(sample); }
  catch(e){ srcErr = e.message; }
  if (src && src.url) {
    ok('getMediaSource 返回 url', true, src.url.slice(0,60)+'...');
    // 验证可访问性
    const h = await fetch(src.url, { method:'HEAD', headers: src.headers||{} });
    ok('播放URL可访问', h.status===200, `status=${h.status} ct=${h.headers.get('content-type')} cl=${h.headers.get('content-length')}`);
  } else {
    ok('getMediaSource', false, 'err=' + srcErr);
  }

  console.log('\n=== 测试 getLyric ===');
  const ly = await plugin.getLyric(sample);
  const hasLrc = ly.rawLrc && ly.rawLrc.trim().length > 0;
  ok('getLyric 有歌词', hasLrc, hasLrc ? '首行: '+ly.rawLrc.split('\n')[0] : '空');
  if (hasLrc) console.log('  歌词片段:', ly.rawLrc.split('\n').slice(0,3).join(' / '));
})();
