# 我要下歌 MusicFree 插件 (xiage.yiwuku.com)

将「我要下歌」(https://xiage.yiwuku.com) 音乐站适配为 MusicFree 插件，支持搜索、在线播放、歌词、歌单/排行榜。

> 本插件已实现歌单/排行榜：以首页「最新歌曲」目录作为可浏览的歌单/排行榜集合，支持分页（`/page_N.html`）。

## 功能

| 方法 | 说明 | 状态 |
|------|------|------|
| `search` | 关键词搜索，返回歌曲（标题/歌手/时长） | ✅ |
| `getMediaSource` | 获取 kuwo CDN 直链（HTTP→HTTPS 升级） | ✅ |
| `getLyric` | 歌词（取详情页 meta description，纯文本） | ✅ |
| `getTopLists` / `getTopListDetail` | 歌单/排行榜（首页最新歌曲目录，支持分页） | ✅ |

## 逆向来源（全部浏览器实测，无盲猜/网络搜索）

- 搜索：`GET /search.php?q=<关键词>` → 解析 `.sound-item`（无分页，单页结果）
- 音源：歌曲详情页 `/s/<id>` 内联 `songs.php?pos=<内部索引>`，该接口返回含 `src` 的播放列表 JSON
  - ⚠️ `pos` 为站点内部索引，无法从歌曲 ID 推导，故 `getMediaSource` 必须先抓详情页取 `pos`
- 歌词：详情页 `<meta name="description">` 文本（无逐行时间戳）
- 歌单/排行榜：首页 `/` 的「最新歌曲」目录，分页地址 `/page_N.html`，解析 `.sound-item`

## 已知限制

- 搜索为单页结果（`isEnd` 恒为 `true`）
- 歌单/排行榜仅首页「最新歌曲」一个集合（该站为静态下载站，无独立榜单/分类接口）
- 部分歌曲仅提供网盘（迅雷）下载、无在线播放源，此类在 `getMediaSource` 抛友好错误
- 歌词为纯文本，无逐行时间轴
- 播放直链来自 kuwo CDN，可能带时效，`cacheControl` 设为 `no-store`

## 安装

MusicFree → 插件管理 → 从 URL 安装 → 填入：

```
https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js
```

或从本地导入 `xiage.js` 文件。

## 测试

```bash
# 本地测试需要 axios（MusicFree 沙箱内置）；用本机已有的 node_modules 即可
node test.cjs
```

依赖：仅 `axios`（MusicFree 沙箱内置）。
