import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import axios from 'axios';
globalThis.axios = axios;
const plugin = require('./migu.js');

(async () => {
  const sr = await plugin.search('晴天', 1);
  let tested = 0;
  for (const item of sr.data) {
    try {
      const src = await plugin.getMediaSource(item);
      if (src && src.url) {
        const h = await fetch(src.url, { method:'HEAD', headers: src.headers||{} });
        console.log(`✅ ${item.title} (${item.artist}) -> playable status=${h.status} ct=${h.headers.get('content-type')} cl=${h.headers.get('content-length')}`);
        tested++;
        if (tested >= 2) break;
      }
    } catch (e) {
      console.log(`⚠️  ${item.title} (${item.artist}) -> ${e.message}`);
    }
  }
  console.log('\n测试通过的可播放歌曲数:', tested);
})();
