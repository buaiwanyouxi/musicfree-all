# 哔哩哔哩音源插件（bilibili.js）使用说明

> **平台**：Bilibili ｜ **版本**：V0.0.7 ｜ **作者**：tianpeng
> **适配**：[MusicFree](https://github.com/maotoumao/MusicFree) 桌面端 / 移动端

---

## 一、插件定位

在 MusicFree 中搜索 / 播放 B站 视频音频，把 B站 当音乐库用。本文件在 `martin65536/bilibili-musicfree@bilibili.js`（v0.6.1）基础上，并集成本地成熟插件 `musicfree-bilibili/bilibili.plugin.js`（v1.1.5）的功能增强。

### 核心特性

- **移动端兼容架构**：IIFE 包裹 + `reqFn` 获取 `axios`，兼容 PC / 移动端加载器；**纯 JS 实现 md5 / HMAC** 替代 `crypto-js`，避免移动端 Hermes 引擎顶层抛错导致插件无法加载。
- **SESSDATA 自动提取**：支持「仅值 / 标准 Cookie / 冒号格式」三种粘贴方式，并自动 URL 解码。
- **「我的收藏夹」板块**：登录后自动列出名下全部收藏夹并映射为歌单。
- **多 P 分集展开**：粘贴视频链接即把每 P 展开为独立音轨（标题带 P 序号 + 分集名）。
- **21 个分区排行榜**（比原 bili.js 新增「翻唱」「演奏」）+ 入站必刷 / 每周必刷。
- **移动端安全播放头**：`playurl` 请求不挂 Cookie / buvid / Origin，CDN 返回头仅 Referer + UA，规避 B站 412 / 移动端转发 Origin 触发的 403（取得到地址却放不出声）。
- **buvid 指纹缓存 24h**（缓解匿名风控）。

---

## 二、支持功能

| 功能 | 方法 | 说明 |
|------|------|------|
| 搜索 | `search` | 视频 / 专辑 / UP主（music/album/artist），结果带播放量/点赞/收藏/弹幕/评论数 |
| 播放取链 | `getMediaSource` | 从 DASH 流提取音频轨，按音质档位精准选码率（low/standard/high/super 升序） |
| 单曲信息 | `getMusicInfo` | 时长/歌手/专辑/封面 |
| 专辑信息 | `getAlbumInfo` | 专辑曲目（多 P 分集） |
| 歌手作品 | `getArtistWorks` | UP主作品（WBI 签名） |
| 排行榜 | `getTopLists` / `getTopListDetail` | 21 分区榜 + 入站必刷 + 每周必刷 + 我的收藏夹 |
| 歌单详情 | `getMusicSheetInfo` | 收藏夹 / 视频合集详情 |
| 歌单导入 | `importMusicSheet` | 视频链接（多 P）/ 收藏夹链接 / 收藏夹数字 ID |
| 评论 | `getMusicComments` | 评论分页（无限滚动）+ 首条自动插入视频简介 |
| 歌词 | `getLyric` | 双语字幕作为歌词（rawLrc 中文 + translation 英文），**双接口兜底** |

### 字幕歌词（关键修复 V0.0.6 → V0.0.7）

`getLyric` 双接口兜底：① 先试无需签名的 `/x/player/v2`（仅登录态 Cookie + bvid/cid）；② 兜底 `/x/player/wbi/v2` 带 WBI 签名但**只传 bvid/cid**（剔除全部 dm_img 风控参数），与已验证可显示字幕的版本完全一致。

> 早期版本只调 `/x/player/wbi/v2` 且塞入 `dm_img` 风控参数会干扰 WBI 签名校验，登录态下静默返回空字幕列表（表现为字幕不显示），已在 V0.0.7 修复。

### 歌单导入格式

1. **B站视频链接**（含多 P 分集），如 `https://www.bilibili.com/video/BV1oLBXBiEW5`，将逐集展开为歌单；
2. **收藏夹链接**，形如 `https://space.bilibili.com/你的UID/favlist?fid=收藏夹ID`；
3. **直接输入收藏夹数字 ID**。

> 获取字幕需在插件设置填 SESSDATA（含 SESSDATA），匿名无法获取 AI 字幕。

---

## 三、所需配置（可选）

| 配置项 key | 名称 | 必填 | 说明 |
|------------|------|------|------|
| `SESSDATA` | SESSDATA Cookie（本地插件兼容） | 否 | 登录 B站 后复制 SESSDATA 值；也可直接粘贴完整 Cookie 或冒号格式（自动识别）。填了可解锁收藏夹 / 字幕 / 评论分页。 |
| `cookie` | B站登录 Cookie（bili.js 原字段） | 否 | 完整 cookie 整行值（含 SESSDATA）。与 SESSDATA 二选一。 |
| `albumTemplate` | 专辑名模板 | 否 | 占位符：`{bvid} {aid} {date} {duration} {durationMmSs} {artist} {title} {playCount} {likeCount} {coinCount} {favoriteCount} {danmakuCount} {replyCount} {shareCount} {category}`。默认只显示 BV 号。 |
| `ua` | User-Agent | 否 | 自定义请求 User-Agent，不填默认 Chrome 120。 |

> **免登录也能用**：不填 SESSDATA 时「每周必刷 / 各分区排行榜」照常播放；填了才额外解锁「我的收藏夹 / 入站必刷」及字幕 / 评论完整分页。

---

## 四、安装方法

MusicFree →「设置」→「插件设置」→「从网络安装插件」→ 填入本插件源码直链（gitee 发布后提供），或本地「从文件安装」选择 `bilibili.js`。

安装后点击插件「配置」填入 SESSDATA（可选，用于解锁收藏夹 / 字幕 / 评论分页）。

---

## 五、已知限制

1. **字幕 / 收藏夹需登录**：AI 字幕、收藏夹、评论完整分页依赖 SESSDATA；匿名仅能播放公开排行榜/视频。
2. **移动端兼容**：已通过纯 JS md5 / HMAC 移除 `crypto-js` 等原生依赖，桌面 / 移动端均可加载；若仍遇加载失败，请确认 MusicFree 版本支持 `axios` 沙箱。
3. **B站风控**：匿名请求可能触发风控，buvid 指纹已缓存 24h 缓解；极端情况下换网络或登录可解决。

---

*本插件仅供个人学习与技术研究，视频/音频内容版权归哔哩哔哩及各 UP主 所有。*
