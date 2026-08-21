# 咪咕音乐 MusicFree 插件

将 [咪咕音乐](https://music.migu.cn/) 适配为 MusicFree 播放插件。支持搜索、播放、歌词、排行榜；**歌单需填入咪咕登录 Cookie 后显示**。

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

## 支持功能

- ✅ 搜索（歌曲名 / 歌手），**支持翻页**
- ✅ 播放（标准音质 PQ，免费档）
- ✅ 歌词（LRC）
- ✅ 排行榜（`getTopLists` / `getTopListDetail`，榜单列表 + 榜单内歌曲翻页）
- 🔓 歌单（`getTopLists` / `getTopListDetail`，需填入咪咕登录 Cookie）

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

1. 将 `migu.js` 传到可访问的 raw 链接（GitHub 等），或本地「从文件安装」。
2. MusicFree → 插件管理 → 从 URL 安装 → 填入：
   ```
   https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-migu/migu.js
   ```
3. 搜索「晴天」等关键词即可试听；「榜单」入口可浏览各排行榜并播放。

## 文件

- `migu.js` — 插件主文件（搜索翻页 + 排行榜 + 播放 + 歌词）
- `test-plugin.mjs` — 本地测试脚本（search / getMediaSource / getLyric）
- `test-media.mjs` — 批量音源可播放性验证
- `test-new.mjs` — 翻页 / 排行榜 综合测试
