# 布谷音乐 MusicFree 插件 (buguyy.js)

将 [布谷音乐](https://www.buguyy.top)（在线音乐试听与无损音乐下载平台）适配为 MusicFree 插件。
数据源为酷我音乐（KuWo），音频为酷我 CDN 直链，无需登录、无需 Cookie。

- **作者**：tianpeng
- **版本**：0.0.1
- **支持搜索类型**：music（歌曲）

## 已实现功能

| 功能 | 方法 | 说明 |
|------|------|------|
| 搜索 | `search` | `GET /api/search?keyword=` ，固定返回最多 50 条（接口不翻页） |
| 播放 | `getMediaSource` | `GET /api/geturl?id=` 返回酷我 CDN 直链（`*.kuwo.cn/*.mp3`），已验证可直接播放 |
| 歌词 | `getLyric` | 复用搜索结果中的 `about` 字段（LRC 格式，`<br>` 已转义为换行） |
| 榜单 | `getTopLists` / `getTopListDetail` | 新歌榜 `newlist`、热歌榜 `hotlist` |

## 接口分析结论（基于浏览器实际观察）

- 站点为 Nuxt 3 SPA，API 基址 `/api/`。
- 歌曲 `id` 为 base64 编码的数字（即酷我 rid），如 `MTEyMDI5NTI=` → `11202952`。
- 播放直链 `https://car-*.kuwo.cn/.../M800xxxx.mp3`：**带不带 Referer 均可访问**（已用 HEAD 验证 status 200 / audio/mpeg）。
- `/api/getdown` 返回的是**夸克网盘分享链接**（`pan.quark.cn/s/...`），属于"下载"用途，无法直接流媒体播放，故未接入播放；插件仅用其播放接口 `geturl`。
- 搜索接口不翻页（`page` 参数无效），`isEnd` 恒为 `true`。

## 安装方法

### 方式一：从 URL 安装（推荐，支持更新）
1. 将 `buguyy.js` 上传到 GitHub 仓库（或任意可直链访问的位置）。
2. 复制 raw 链接，例如 `https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-buguyy/buguyy.js`。
3. 填入插件 `srcUrl` 字段（位于 `buguyy.js` 顶部）。
4. 在 MusicFree 中「插件管理 → 从 URL 安装」，粘贴该链接即可。

### 方式二：本地加载（开发调试）
- 直接用支持的本地插件加载方式指向本目录的 `buguyy.js`。

## 本地测试

```bash
node test-plugin.mjs
```

会依次验证 search / getMediaSource / getLyric / getTopLists / getTopListDetail，并打印音频直链可访问性。

## 已知限制

1. **搜索不翻页**：站点接口本身只返回约 50 条，无更多分页。
2. **无损下载为夸克网盘**：本插件只做"试听/播放"，无损下载（WAV/MP3 夸克分享）需到原站操作，插件不接管。
3. **部分歌曲无歌词**：站点 `about` 字段为"歌词获取失败"时，`getLyric` 返回空歌词。
4. **直链有时效**：酷我 CDN 链接含临时签名路径，建议 `cacheControl: 'no-cache'`（已设置），播放时实时获取。

## 文件说明

- `buguyy.js` — 插件主文件（交付物）
- `test-plugin.mjs` — 本地测试脚本
- `node_modules/` — 本地开发依赖（axios，仅测试用；插件运行在 MusicFree 沙箱中自带 axios）
