# 咪咕音乐 MusicFree 插件

将 [咪咕音乐](https://music.migu.cn/) 适配为 MusicFree 播放插件。支持搜索、播放、歌词、排行榜；**歌单需填入咪咕登录 Cookie 后显示**。

- **平台标识**：`migu`（应用内显示为「咪咕音乐」）
- **当前版本**：`v0.0.3`
- **数据源**：`music.migu.cn` / `app.*.nf.migu.cn`（咪咕官方直链，需 Cookie 开启歌单）

## 安装链接（从 URL 安装）

```
https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@main/musicfree-migu/migu.js
```

MusicFree →「设置」→「插件设置」→「从网络安装插件」→ 粘贴上方链接。若需歌单，安装后点击插件「配置」填入 `miguCookie`。

> 逆向方式：使用 Playwright 复用系统 Chrome 真实抓取站内请求，所有接口均来自浏览器实测，无猜测、无第三方 API。

## 接口逆向结论（均免 cookie，插件沙箱内可直接调用）

| 功能 | 接口 | 说明 |
|------|------|------|
| 搜索 | `GET app.u.nf.migu.cn/pc/resource/song/item/search/v1.0?text=关键词&pageNo=N&pageSize=20` | 直接返回 JSON 数组（歌曲列表），**支持翻页**（每页 20 条，不同页返回不同歌曲） |
| 音源 | `GET app.c.nf.migu.cn/MIGUM3.0/strategy/pc/listen/v1.0?resourceType=2&copyrightId=版权ID&contentId=内容ID&toneFlag=PQ` | `data.url` 为 `freetyst.nf.migu.cn` 直链（免费标准音质） |
| 歌词 | 同上接口的 `data.lrcUrl` | 直接返回 LRC 文本 |
| 排行榜列表 | `GET app.c.nf.migu.cn/pc/bmw/rank/rank-index/v1.0` | `data.contents[]` 按分类分组，每组 `contents[]` 为榜单 `{rankId, rankName, imageUrl}` |
| 排行榜详情 | `GET app.c.nf.migu.cn/pc/bmw/rank/rank-info/v1.0?rankId=榜单ID&pageNo=N&pageSize=20` | `data.contents[]` 为歌曲（含 `resId/contentId/copyrightId/resType`），`data.hasNextPage` 可翻页 |

请求头固定携带：`appid=h5`、`channel/subchannel=014X031`、`platform=H5`、`ua=Android_migu`、`version=6.8.8`、`referer=https://music.migu.cn/` 等。

## 支持功能（已按源码逐项核对 v0.0.3）

| 能力 | 实现方法 | 状态 | 说明 |
|------|----------|------|------|
| 搜索 | `search` | ✅ | 按歌曲名 / 歌手，**支持翻页**（20 条/页） |
| 播放 | `getMediaSource` | ✅ | 标准音质 PQ（免费档），返回 `freetyst.nf.migu.cn` 直链 |
| 歌词 | `getLyric` | ✅ | 取音源接口下发的 `lrcUrl`，返回 LRC 文本 |
| 排行榜 | `getTopLists` / `getTopListDetail` | ✅ | 免登录可用；榜单列表按分类展开，榜内歌曲可翻页 |
| 歌单 | `getTopLists` / `getTopListDetail`（`_type: 'playlist'`） | 🔓 | 需填 `miguCookie`；与排行榜合并在同一入口返回 |
| 导入歌单 / 单曲 | — | ❌ | 未实现 `importMusicSheet` / `importMusicItem`（咪咕无免登录歌单数据源） |
| 专辑 / 歌手页 | — | ❌ | 未实现（bmw `album`/`singer` 接口匿名返回 `299997 请求不支持`） |

> 插件内部对榜单与歌单用 `_type` 字段区分（`rank` / `playlist`），并通过 `_rankId` / `_playlistId` 路由到不同接口；歌曲项额外携带 `_contentId` / `_copyrightId` / `_resourceType` 用于取链，缺失者会被过滤掉。

## 关于「歌单 / 排行榜」

本插件**排行榜始终可用**（榜单即一组精选歌曲，支持翻页与播放）。

**歌单**需登录态：咪咕公开歌单无免 cookie 的可播放数据源（实测 `album`/`singer`/`playlist`/`radio` 等 bmw 接口均返回 `299997 请求不支持`）。因此在插件变量中填入咪咕登录 Cookie 后，歌单（推荐/个人歌单）才会显示并可播放。

### 如何开启歌单

1. 浏览器登录 [咪咕音乐](https://music.migu.cn/) 后，从开发者工具复制请求头中的 `Cookie`（一串 `key=value; ...`）。
2. MusicFree → 插件管理 → 找到「咪咕音乐」→ 设置 → 填入变量 `miguCookie` 为该 Cookie。
3. 重启插件 / 重新进入「歌单/排行榜」页，即可看到歌单并播放。

> 未填 Cookie 时，歌单/排行榜页仅展示排行榜，不影响搜索 / 播放 / 歌词。

## 已知限制

1. **会员限定曲目**：原唱热门曲目（如周杰伦《晴天》原版）部分需白金会员（`cannotCode 440013`），插件会提示「该歌曲为会员专属，无法免费播放」。同名翻唱 / Live / 其他版本通常可免费播放。
2. **试听片段**：部分曲目为版权方限制的试听片段，播放链接为片段而非完整版。
3. 歌单需登录态：在插件变量 `miguCookie` 填入咪咕登录 Cookie 后可用（见上）。

## 安装

**方式一：从网络安装（推荐）**

MusicFree →「设置」→「插件设置」→「从网络安装插件」→ 填入：

```
https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@main/musicfree-migu/migu.js
```

**方式二：从本地文件安装** —— 下载 `migu.js` 后选择「从本地文件安装插件」。

安装完成后：搜索「晴天」等关键词即可试听；「榜单」入口可浏览各排行榜并播放；填入 `miguCookie` 后歌单一并出现。

> 该直链已写入插件 `srcUrl`，后续可在 MusicFree 内直接「更新插件」。`https://gitee.com/koujiao/...` 形式也可用，但会 302 跳转。

## 文件

- `migu.js` — 插件主文件（搜索翻页 + 排行榜 + 播放 + 歌词）
- `test-plugin.mjs` — 本地测试脚本（search / getMediaSource / getLyric）
- `test-media.mjs` — 批量音源可播放性验证
- `test-new.mjs` — 翻页 / 排行榜 综合测试
