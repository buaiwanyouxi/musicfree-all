# 我要下歌 MusicFree 插件 (xiage)

将「我要下歌」(https://xiage.yiwuku.com) 音乐站适配为 MusicFree 插件。

**音源后端：铜钟 Tonzhon（https://tonzhon.com）· 全链路统一**。歌单(排行榜)/热门歌单、搜索、歌词、封面、导入均经 Tonzhon `api.php`；播放走「Tonzhon `types=url` → 官方同款网易云外链回退」链路，与 Tonzhon 官方前端行为完全一致。

提供：

- **排行榜 / 热门歌单（按平台分组）**：网易云（官方榜 + 精选）、酷狗（官方榜 + 精选）、QQ音乐（精选/每日榜单）。各分组 ID 均经 Tonzhon 实测可返回曲目。
- **真实可播放的搜索**（Tonzhon 搜索，网易云曲库）
- **在线播放**：先调 Tonzhon `types=url`（Tonzhon 自有音源），其 `url` 接口对全部音源返回空时，回退到网易云官方外链 `music.163.com/song/media/outer/url?id=<id>.mp3`（302 → 真实 CDN 直链，插件内解析，绕过播放器不跟随跨域跳转）——此回退即 Tonzhon 前端 `js/ajax.js` 在 `types=url` 失效时的标准处理。非网易源歌曲（酷狗/QQ）以「歌名 best-effort 匹配网易云」回退播放。
- **逐行 LRC 歌词**（Tonzhon `types=lyric`）
- **导入网易云 / QQ音乐 歌单与单曲**

> **版本 0.0.8（多平台排行榜 + 热门歌单补全）**
> 按你的分批要求补全歌单 Tab：
> 1. **排行榜**：新增「酷狗排行榜」（蜂鸟流行/抖音热歌/快手热歌/DJ热歌/内地榜 5 个官方榜，经 Tonzhon `playlist` 实测可用）；网易云保留 9 个官方榜；QQ音乐以已验证可返回的精选/每日榜单呈现。
> 2. **热门歌单**：原空白区补入网易云/酷狗/QQ音乐 各若干精选歌单（均实测可返回曲目）。
> 3. **非网易源播放/歌词回退**：酷狗、QQ 歌曲在 Tonzhon `types=url` 失效时，best-effort 匹配网易云外链播放与取词；并拒绝 404 错误页（不再把死链交给播放器）。
> 4. 移除 xiage 站点抓取备用链路，全链路严格 Tonzhon。
>
> **版本 0.0.7（全链路 Tonzhon 一致性修复）**：播放/歌单/搜索三处统一走 Tonzhon。
> **版本 0.0.6 历史**：元数据全走 Tonzhon，但歌单仍抓 xiage 站点。
> **版本 0.0.5 历史**：曾以 meting 为后端，因接口失效切换为 Tonzhon。

## 功能

| 方法 | 说明 | 状态 |
|------|------|------|
| `getTopLists` / `getTopListDetail` / `getMusicSheetInfo` | 排行榜 + 热门歌单（网易云 / 酷狗 / QQ音乐，经 Tonzhon `playlist`） | ✅ |
| `search` | Tonzhon 搜索（网易云源），返回可播放结果 | ✅ |
| `importMusicSheet` / `importMusicItem` | 导入**网易云 / QQ音乐**歌单/单曲链接 | ✅（见限制） |
| `getMediaSource` | Tonzhon `types=url` → 官方网易云外链 302 → https CDN 直链（非网易源 best-effort 匹配） | ✅ |
| `getLyric` | Tonzhon 逐行 LRC 歌词（非网易源 best-effort 匹配） | ✅ |

## 歌单 Tab 结构（v0.0.8）

| 区块 | 分组 | 内容 | 来源 |
|------|------|------|------|
| 排行榜 | 网易云排行榜 | 飙升/新歌/热歌/原创/欧美/电音/快手/怀旧/网络 共 9 榜 | Tonzhon netease |
| 排行榜 | 酷狗排行榜 | 蜂鸟流行/抖音热歌/快手热歌/DJ热歌/内地榜 共 5 榜 | Tonzhon kugou |
| 排行榜 | QQ音乐歌单 | ACG治愈 / 今日私享 等精选（注：官方巅峰榜 disstid 在 Tonzhon 已变更） | Tonzhon tencent |
| 热门歌单 | 热门歌单·网易云 | 私人雷达 / 圆神电音 / CNBLUE热门50 等 | Tonzhon netease |
| 热门歌单 | 热门歌单·酷狗 | 3 个精选歌单 | Tonzhon kugou |
| 热门歌单 | 热门歌单·QQ音乐 | 今日私享 / 字 等 | Tonzhon tencent |

## 已知限制（站点/音源侧，非插件 bug）

1. **仅网易云可稳定播放**：Tonzhon 的 `types=url` 接口当前对全部音源（netease/tencent/kugou/baidu）均返回空，唯一可靠播放是网易云官方外链。酷狗/QQ 歌曲以「歌名 best-effort 匹配网易云」回退播放（匹配不到或网易云无此曲时，会明确报错而非给死链；日文/韩文/冷门曲命中率较低）。
2. **网易云「私人/需登录」歌单不可导入**：Tonzhon 对私人歌单（如「我喜欢的音乐」）不返回曲目列表。请先在网易云网页端将歌单设为**公开**，再复制链接导入。公开歌单（榜单、公开精选）正常导入。
3. **搜索仅覆盖网易云曲库**：Tonzhon 对 `tencent/kugou/kuwo/baidu` 源的搜索返回 0 条，故搜索固定走 netease。
4. **酷我、百度：Tonzhon 无法提供歌单/榜单**：经实测，Tonzhon 的 `types=playlist` 对 `kuwo`/`baidu` 源返回 **0 字节**（真实歌单 ID 亦无效），故这两源的排行榜/热门歌单无法经 Tonzhon 补全。如需酷我/百度，需另接独立后端（非 Tonzhon）。
5. **汽水（qishui）：Tonzhon 无此音源**：Tonzhon 对 `qishui`/`douyin` 静默回退到 netease，无法提供真实汽水内容。若需汽水，需另接汽水官方/第三方后端。
6. **QQ 官方巅峰榜暂不可用**：Tonzhon 上 QQ 官方巅峰榜的 `disstid` 已变更（当前仅返回「今日私享」类算法歌单），故 QQ 分组采用已验证可返回的精选/每日榜单，而非官方巅峰榜。

## 逆向来源（全部真实站点 + Tonzhon 接口实测，无盲猜）

- **Tonzhon 接口**（抓前端 `js/ajax.js`、`js/player.js` 反推 + `api.php` 实测）：
  - 搜索：`POST api.php` `types=search&source=netease&name=<词>&pages=<页>&count=<条>` → `[{id,name,album,pic_id,url_id,lyric_id,source,artist:[["a,b"]]}]`
  - 歌词：`types=lyric&id=<lyric_id>&source=netease` → 逐行 LRC 文本
  - 封面：`types=pic&id=<pic_id>&source=netease` → `{url:"https://p3.music.126.net/..."}`
  - 网易云歌单/排行榜：`types=playlist&id=<歌单id>&source=netease` → `playlist.tracks[]`
  - 酷狗歌单/榜单：`types=playlist&id=<歌单id>&source=kugou` → `data.info[]`（`filename` 为「歌手 - 歌名」，`hash` 为文件标识）
  - QQ 歌单：`types=playlist&id=<歌单id>&source=tencent` → `data.cdlist[0].songlist[]`（含 `mid`/`name`/`singer`）
  - **播放链路（关键）**：Tonzhon 前端 `ajax.js` 中 `ajaxUrl` 在 `types=url` 返回空时，回退 `https://music.163.com/song/media/outer/url?id=<netease_id>.mp3`；非空时将其 `m7c/m8c.music.` 节点修正为 `m7/m8.music.`。本插件完全复刻该逻辑：先 `types=url`，再官方回退；非网易源再 best-effort 匹配网易云。

## 安装

MusicFree → 设置 → 插件设置 → 添加「从网络链接安装」：

```
https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js
```
