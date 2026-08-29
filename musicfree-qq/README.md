# QQ音乐音源插件（qq.js）使用说明

> **平台**：QQ音乐（腾讯系）｜ **版本**：v0.0.1 ｜ **作者**：tianpeng
> **适配**：[MusicFree](https://github.com/maotoumao/MusicFree) 桌面端 / 移动端

---

## 一、插件定位

将「QQ音乐」作为一个独立音源接入 MusicFree，实现搜索、歌词、排行榜、热门歌单、歌单导入等完整能力。

**接口契约**：

- **浏览类（搜索 / 歌词 / 排行榜 / 热门歌单 / 歌单导入）**：走**旧版 cgi-bin 免签端点**（如 `c.y.qq.com` 的 `s.pl` / `v8/fcg` 等），无需签名；
- **播放取链**：`CgiGetVkey` 本身免签，但其返回的 `purl` 需要登录态 `authst` Cookie 才能拼接出可播直链。

> 注意：`musicu.fcg` 已全面加签名，本插件浏览类已避开该端点，统一走免签旧版接口。

### 取链三层兜底（核心能力）

QQ 官方取链依赖登录态——**未登录时原曲基本全挂**。为此实现三层兜底，保证尽量有歌可播：

1. **① 官方 QQ（CgiGetVkey）**：需登录 Cookie 解锁，返回腾讯官方 CDN 直链（最高音质）；
2. **② 首选备用 无名音乐网 mvmp3**：自动完成「我不是人机」验证并缓存 50 分钟，覆盖大量失效曲；
3. **③ 次选备用 Tonzhon 网易云匹配**：`tonzhon.com` 搜索同名网易云曲 + 纯 JS weapi（AES-128-CBC）取链，覆盖 QQ 的 VIP / 试听失效曲。

> 三层任一成功即用；未登录时自动走 ② / ③，晴天、七里香等已实测可播（返回 `m*.music.126.net` 网易云 CDN 链）。

---

## 二、支持功能

| 功能 | 方法 | 说明 |
|------|------|------|
| 搜索 | `search` | 仅单曲（music） |
| 播放取链 | `getMediaSource` | 三层兜底（见上） |
| 单曲信息 | `getMusicInfo` | 时长/歌手/专辑/封面 |
| 歌词 | `getLyric` | cgi-bin 免签端点 |
| 排行榜 | `getTopLists` / `getTopListDetail` | 按分类分组（飙升/新歌/特色/全球等） |
| 热门歌单 | `getRecommendSheetTags` / `getRecommendSheetsByTag` | 6 个分类分组 + 置顶「全部」 |
| 歌单导入 | `importMusicSheet` | 粘贴 QQ 音乐歌单链接/ID |
| 歌单详情 | `getMusicSheetInfo` | 点进歌单后的歌曲列表 |

### 歌单导入格式

- QQ音乐 APP：歌单 → 分享 → 复制链接，粘贴即可导入；
- 网页：复制歌单 URL（含 `/playlist/数字` 或 `disstid=数字`）粘贴，或直接输入纯数字歌单 ID；
- 导入时间与歌单大小有关，请耐心等待。

---

## 三、所需配置（可选）

| 配置项 key | 名称 | 必填 | 说明 |
|------------|------|------|------|
| `cookie` | Cookie（可选） | 否 | QQ 音乐登录后的会话 Cookie。填入后用于解锁「① 官方 QQ 取链」（需含 `authst` / `uin`）。搜索、歌词、排行榜、热门歌单、歌单导入通常**无需** Cookie。**未填也能播**——自动走 mvmp3 / Tonzhon 备用音源。 |
| `mvmp3_cookie` | mvmp3 Cookie（可选） | 否 | 无名音乐网(mvmp3)的人机验证由插件自动完成，无需手动操作；会话约 50 分钟自动刷新。若自动过验证偶发失败，可在此填 mvmp3 的 `PHPSESSID`（站点 `https://www.mvmp3.com` 登录 / F12 取 Cookie）以跳过自动验证。 |

---

## 四、安装方法

MusicFree →「设置」→「插件设置」→「从网络安装插件」→ 填入本插件源码直链（gitee 发布后提供），或本地「从文件安装」选择 `qq.js`。

---

## 五、已知限制与修复记录

1. **热门歌单崩溃（已修复）**：早期 `getRecommendSheetTags` 返回扁平数组，导致歌单广场 `group.data.forEach` 崩溃；已修复为 **6 个分类分组数组 + 置顶「全部」**，`getRecommendSheetsByTag` 兼容空 `tag.id` 落「全部」并加 try/catch。
2. **未登录取链**：未填 Cookie 时官方层全部失败，但 ② / ③ 层保证可播；若三层均失败会抛出明确错误提示（含各层失败原因）。
3. **Tonzhon 路径说明**：Tonzhon 对 QQ 歌曲播放实际路由回腾讯官方（同源无效），故兜底层实现为「Tonzhon 搜网易云同名曲 + weapi 取链」的有效路径，而非回退 QQ 官方。

---

*本插件仅供个人学习与技术研究，音频内容版权归腾讯及各权利人所有。*
