# 我要下歌 MusicFree 插件 (xiage.yiwuku.com)

将「我要下歌」(https://xiage.yiwuku.com) 音乐站适配为 MusicFree 插件，支持歌单/排行榜浏览、最佳匹配搜索、在线播放、歌词、**导入歌单/单曲**。

> **版本 0.0.4 修复说明**（针对真机报错）：
> - ✅ 修复「歌单界面 `cannot read property 'length' of undefined`」：上一版 `getTopLists` 直接返回扁平数组，但 MusicFree 协议要求返回**分组数组** `[{ title, data: [] }]`（框架读 `group.data.length`）；且 `getTopListDetail` 误用 `data` 字段，协议要求 `musicList`。两者都已对齐协议，歌单列表与详情页均可正常加载。
> - ✅ 修复「搜索不出结果」：搜索池从仅首页 15 首扩大到**首页前 3 页（≈39 首）+ 歌单名匹配展开**，命中歌单名时展开其内全部歌曲；同时修正返回值结构（`search` 用 `data` 字段，符合协议）。
> - ✅ 新增「导入歌单 / 导入单曲」：实现 `importMusicSheet(urlLike)` 与 `importMusicItem(urlLike)`，粘贴 `xiage.yiwuku.com/s/ID` 链接即可导入，MusicFree 因此显示导入入口。
> - ✅ 自动换源（沿用 0.0.3）：歌手缺省留空，不填 `'未知'` 占位符，跨源匹配键干净。

> **版本 0.0.3 已修复**（网页层逻辑）：`parseItems` 正则由写死的 `<li class="sound-item">` 改为截取 `.erx-m-list` 区块内裸 `<li>`，解决歌单/搜索恒为 0 条；站点服务端搜索对 HTTP 不生效，改为「可浏览目录最佳匹配」。

## 功能

| 方法 | 说明 | 状态 |
|------|------|------|
| `getTopLists` / `getTopListDetail` / `getMusicSheetInfo` | 歌单/排行榜：「最新歌曲」（首页，支持 `/page_N.html` 翻页）+ 站点「歌单合集」（每张 `/s/ID` 内含歌曲）。返回值严格对齐 MusicFree 分组/ `musicList` 契约 | ✅ |
| `search` | 可浏览目录最佳匹配搜索（首页前 3 页最新歌曲 + 歌单名），命中歌单展开内曲 | ✅（见限制） |
| `importMusicSheet` / `importMusicItem` | 粘贴 `xiage.yiwuku.com/s/ID` 链接导入歌单/单曲 | ✅ |
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

- **搜索为「可浏览目录最佳匹配」，非全站搜索**：站点服务端搜索对 HTTP 请求不生效（任何词都回吐固定歌单卡片），插件只能覆盖最新/热门内容（最新 3 页歌曲 + 歌单合集）。检索全站历史歌曲请直接使用网站。
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

### 导入歌单 / 单曲

插件管理 → 该插件 → 「导入歌单」/「导入单曲」→ 粘贴链接：

```
https://xiage.yiwuku.com/s/9y2ow696v21qivt162vd   （歌单链接示例）
https://xiage.yiwuku.com/s/hgdmmiov5q8poujd6g35   （单曲所在详情页链接示例）
```

## 测试

```bash
# 本地验证（模拟 MusicFree 框架校验返回结构，需 axios）
node verify2.cjs
```

依赖：仅 `axios`（MusicFree 沙箱内置）。
