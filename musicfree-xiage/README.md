# 我要下歌 MusicFree 插件 (xiage.yiwuku.com)

将「我要下歌」(https://xiage.yiwuku.com) 音乐站适配为 MusicFree 插件。站点歌曲的播放后端是 **meting API**（api.qijieya.cn/meting，对接网易云/QQ音乐源），本插件以 meting 为统一音源后端，提供：

- 歌单/排行榜浏览（xiage 站内精选）
- **真实可播放的搜索**（meting 搜索，覆盖网易云/QQ曲库）
- 在线播放（解析最终 CDN 直链，绕过跨域 302 跳转）
- 逐行 LRC 歌词
- **导入网易云 / QQ音乐 歌单与单曲**

> **版本 0.0.5 重大重构**（针对真机「歌曲无法播放 / 搜索空白 / 导入不支持」）：
> - ✅ **播放修复（核心）**：原实现直接把 `meting/?type=url&id=XXX` 返回给播放器，而该地址会 `302` 跳转到网易/QQ CDN，MusicFree 播放器不跟随跨域 302 → 全部无法播放。现改为在插件内跟随 302，解析出最终 **https CDN 直链**再返回（`getMediaSource` 内 `resolveMetingAudio`）。实测 xiage 站内歌曲、搜索结果、导入歌曲均可解析并播放（audio/mpeg，206）。
> - ✅ **搜索修复**：改用 `meting ?type=search&id=关键词`，返回真实可播放结果（实测「周杰伦」「晴天」各 30 条），替换原「站内小池子匹配」（命中率极低→空白）。
> - ✅ **导入修复**：`importMusicSheet` / `importMusicItem` 识别网易云(`music.163.com`)、QQ音乐(`y.qq.com`)链接，走 `meting ?type=playlist` 拉取歌曲（实测网易 539 首 / QQ 30 首均正常导入并可播放）。
> - ✅ **歌词升级**：改用 `meting ?type=lrc`，返回真实逐行 LRC（替换原 meta description 纯文本）。
> - ✅ 自动换源：歌手缺省留空，不填占位符，跨源匹配键干净。

## 功能

| 方法 | 说明 | 状态 |
|------|------|------|
| `getTopLists` / `getTopListDetail` / `getMusicSheetInfo` | 歌单/排行榜：「最新歌曲」（首页翻页）+ 站点「歌单合集」。返回值对齐 MusicFree 分组 / `musicList` 契约 | ✅ |
| `search` | meting 真实搜索（网易云/QQ曲库），返回可播放结果 | ✅ |
| `importMusicSheet` / `importMusicItem` | 导入**网易云 / QQ音乐**歌单/单曲链接 | ✅ |
| `getMediaSource` | 跟随 meting 302，解析最终 https CDN 直链 | ✅ |
| `getLyric` | meting 逐行 LRC 歌词 | ✅ |

## 逆向来源（全部真实站点 + meting 接口实测，无盲猜/网络搜索）

- **浏览层（xiage 站内）**：
  - 歌曲列表：`<ul class="...erx-m-list...">` 下的裸 `<li>` → `<a href="/s/<id>">` → 标题/歌手/时长
  - 歌单合集：首页 `erx-list-special` 卡片 → `/s/<id>`
  - 校内歌曲播放：`/s/<id>` 内联 `songs.php?pos=<内部索引>` → 返回 `src:"https://api.qijieya.cn/meting/?type=url&id=<metingId>"`
- **音源层（meting API，api.qijieya.cn/meting）**：
  - `?type=url&id=XXX` → 302 跳转至网易云 CDN（`m*.music.126.net`）或 QQ CDN（`aqqmusic.tc.qq.com`）真实音频
  - `?type=search&id=关键词` → 歌曲数组（含 `url`/`pic`/`lrc`）
  - `?type=playlist&id=歌单ID&server=netease|tencent` → 歌单歌曲数组
  - `?type=lrc&id=XXX` → 逐行 LRC 文本
  - 参数文档见 `https://api.qijieya.cn/meting/`（作者亦提示该 API 免费、可能被滥用后限流）

## 已知限制

- **meting API 为第三方免费接口，存在限流/偶发不可用风险**（作者已在文档中说明）。若遇播放/搜索/导入整体失败，多为该接口临时限流，稍后重试或关注其迁移地址 `musicapi.qijieya.cn`。
- **酷我（kuwo）歌单导入暂不支持**：meting 后端仅明确支持 `netease`（网易云）与 `tencent`（QQ音乐）两个数据源，故导入目前支持网易云与 QQ 音乐；酷我链接暂无法解析。
- xiage 站内歌单合集详情页单页最多 12 首，大歌单会被截断（站点限制）。
- 搜索结果 `duration` 暂为 0（meting 搜索接口不返回时长），不影响播放。
- 播放直链为带时效的 CDN 签名地址，`cacheControl` 设为 `no-store`。

## 安装

MusicFree → 插件管理 → 从 URL 安装 → 填入：

```
https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js
```

或从本地导入 `xiage.js` 文件。

### 导入歌单 / 单曲（网易云 / QQ音乐）

插件管理 → 该插件 → 「导入歌单」/「导入单曲」→ 粘贴链接：

```
https://music.163.com/playlist?id=2619366284        （网易云歌单）
https://y.qq.com/n/ryqq/playlist/7844717408         （QQ音乐歌单）
https://y.qq.com/n/ryqq/songDetail/003MPbPj2Y23W4   （QQ音乐单曲）
```

> 也可继续导入 xiage 站内歌单：`https://xiage.yiwuku.com/s/<id>`

## 测试

```bash
# 本地验证（模拟 MusicFree 框架校验返回结构 + 播放直链可达性，需 axios）
node verify3.cjs
```

依赖：仅 `axios`（MusicFree 沙箱内置）。
