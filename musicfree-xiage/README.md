# 我要下歌 MusicFree 插件 (xiage.yiwuku.com)

将「我要下歌」(https://xiage.yiwuku.com) 音乐站适配为 MusicFree 插件，支持歌单/排行榜浏览、最佳匹配搜索、在线播放、歌词。

> **版本 0.0.3 修复说明**：
> - ✅ 修复「无法加载歌单」：`parseItems` 原正则写死 `<li class="sound-item">`，但站点真实结构是 `.erx-m-list` 下的裸 `<li>`，导致歌单/排行榜恒为 0 条。已改为截取 `erx-m-list` 区块内裸 `<li>`。
> - ✅ 修复「不支持搜索」：站点服务端搜索接口（`cmd.php?act=search` / `search.php?q=`）对任意关键词均返回固定的一套「歌单合集」卡片，**搜索词被完全忽略**（站点反爬/配置问题，纯 HTTP 无法触发真实搜索）。插件改为「可浏览目录最佳匹配」：在最新歌曲 + 歌单合集名中做子串匹配，命中歌单时展开其内歌曲。
> - ✅ 修复「自动换源失败」：原代码歌手缺省填 `'未知'`，污染跨源匹配键。现已改为取真实歌手，缺省留空，自动换源可正常匹配其它音源。

## 功能

| 方法 | 说明 | 状态 |
|------|------|------|
| `getTopLists` / `getTopListDetail` | 歌单/排行榜：「最新歌曲」（首页，支持 `/page_N.html` 翻页）+ 站点「歌单合集」（每张 `/s/ID` 内含歌曲） | ✅ |
| `search` | 可浏览目录最佳匹配搜索（最新歌曲 + 歌单名），命中歌单展开内曲 | ✅（见限制） |
| `getMediaSource` | 获取 CDN 直链（HTTP→HTTPS 升级） | ✅ |
| `getLyric` | 歌词（取详情页 meta description，纯文本） | ✅ |

## 逆向来源（全部真实站点 HTML 实测，无盲猜/网络搜索）

- **歌曲列表**：`<ul class="...erx-m-list...">` 下的裸 `<li>` → `<a href="/s/<id>">` → `<div class="tit"><span class="m">标题</span><span class="f12 i">时长</span></div><div class="ser"><span>歌手</span></div>`
- **歌单合集**：首页 `erx-list-special` 区块的 `<li><a class="erx-m-box" href="/s/<id>">` → `<div class="a">歌单名</div><div class="p-count">共<N>首</div>`
- **音源**：歌曲详情页 `/s/<id>` 内联 `songs.php?pos=<内部索引>`，该接口返回含 `src` 的播放列表 JSON
  - ⚠️ `pos` 为站点内部索引，无法从歌曲 ID 推导，故 `getMediaSource` 必须先抓详情页取 `pos`
- **歌词**：详情页 `<meta name="description">` 文本（无逐行时间戳）
- **歌单/排行榜分页**：首页最新歌曲分页地址 `/page_N.html`；歌单合集详情页（`/s/ID`）单页最多展示 12 首，站点无分页接口

## 已知限制

- **搜索为「可浏览目录最佳匹配」，非全站搜索**：站点服务端搜索对 HTTP 请求不生效（任何词都回吐固定歌单卡片），插件只能覆盖最新/热门内容（最新歌曲 + 歌单合集）。检索全站历史歌曲请直接使用网站。
- 歌单合集详情页单页最多 12 首，大歌单会被截断（站点限制，无分页接口）。
- 部分歌曲仅提供网盘（迅雷）下载、无在线播放源，此类在 `getMediaSource` 抛友好错误。
- 歌词为纯文本，无逐行时间轴。
- 播放直链来自 CDN，可能带时效，`cacheControl` 设为 `no-store`。

## 安装

MusicFree → 插件管理 → 从 URL 安装 → 填入：

```
https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js
```

或从本地导入 `xiage.js` 文件。

## 测试

```bash
# 本地验证（需 axios；MusicFree 沙箱内置）
node verify.cjs
```

依赖：仅 `axios`（MusicFree 沙箱内置）。
