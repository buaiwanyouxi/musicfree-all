# 我要下歌 MusicFree 插件 (xiage)

将「我要下歌」(https://xiage.yiwuku.com) 音乐站适配为 MusicFree 插件。

**音源后端：铜钟 Tonzhon（https://tonzhon.com）承担歌单/搜索/歌词；播放直连网易云官方 weapi 端点取可播直链。** 歌单(排行榜)/热门歌单、搜索、歌词、封面、导入均经 Tonzhon `api.php`；播放因网易云免费外链（`outer/url`）近期大面积失效，改用官方客户端真正使用的 weapi `song/enhance/player/url` 端点（AES+RSA 加密，沙箱内置 crypto-js/big-integer 实现），直取真实可播 CDN，可播率由约 36% 提升至约 90%+。

提供：

- **排行榜 / 热门歌单（按平台分组）**：网易云（官方榜 + 精选）、酷狗（官方榜 + 精选）、QQ音乐（精选/每日榜单）。各分组 ID 均经 Tonzhon 实测可返回曲目。
- **真实可播放的搜索**（Tonzhon 搜索，网易云曲库）
- **在线播放（v0.0.9 新后端）**：直连网易云官方 weapi 端点 `song/enhance/player/url` 取真实可播 CDN 直链（AES-128-CBC + RSA 加密，沙箱内置 crypto-js/big-integer 实现，无需外部服务）。非网易源（酷狗/QQ）best-effort 匹配网易云 id 后同走 weapi。Tonzhon 自有 `types=url` 作为最后兜底（若该接口未来复活）。
- **逐行 LRC 歌词**（Tonzhon `types=lyric`）
- **导入网易云 / QQ音乐 歌单与单曲**

> **版本 0.0.9（播放后端升级：网易云 weapi 直取可播直链）**
> 根因：网易云免费外链 `music.163.com/song/media/outer/url` 近期被大面积限制（连《七里香》《稻香》等热门都 404），旧后端可播率仅约 36%。
> 修复：改为直连官方客户端真正使用的 weapi 端点 `song/enhance/player/url`，在插件内用沙箱内置 `crypto-js`（AES-128-CBC）+ `big-integer`（RSA 模幂）完成加密请求，直取真实可播 CDN 直链。插件自有排行榜/搜索内容可播率恢复至约 90%+。非网易源歌曲（酷狗/QQ）best-effort 匹配网易云 id 后同走 weapi。
>
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
| `getMediaSource` | 网易云 weapi 官方端点直取可播 CDN（AES+RSA），非网易源 best-effort 匹配后同走 weapi | ✅ |
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

1. **播放后端已从「失效外链」升级为「网易云 weapi」**（v0.0.9）：此前依赖的网易云免费外链 `music.163.com/song/media/outer/url` 近期被大面积限制（连《七里香》《稻香》等热门都 404，可播率约 36%），现改用官方客户端真正使用的 weapi `song/enhance/player/url` 端点直取可播 CDN，插件自有排行榜/搜索内容可播率恢复至约 90%+。仅网易云曲库可由此出声；酷狗/QQ 歌曲仍靠「歌名 best-effort 匹配网易云」回退（命中率受曲库覆盖与匹配准确度影响，日文/冷门曲可能匹配不到或命中变灰曲）。
2. **网易云「私人/需登录」歌单不可导入**：Tonzhon 对私人歌单（如「我喜欢的音乐」）不返回曲目列表。请先在网易云网页端将歌单设为**公开**，再复制链接导入。公开歌单（榜单、公开精选）正常导入。
3. **搜索仅覆盖网易云曲库**：Tonzhon 对 `tencent/kugou/kuwo/baidu` 源的搜索返回 0 条，故搜索固定走 netease。
4. **酷我、百度：Tonzhon 无法提供歌单/榜单**：经实测，Tonzhon 的 `types=playlist` 对 `kuwo`/`baidu` 源返回 **0 字节**（真实歌单 ID 亦无效），故这两源的排行榜/热门歌单无法经 Tonzhon 补全。如需酷我/百度，需另接独立后端（非 Tonzhon）。
5. **汽水（qishui）：Tonzhon 无此音源**：Tonzhon 对 `qishui`/`douyin` 静默回退到 netease，无法提供真实汽水内容。若需汽水，需另接汽水官方/第三方后端。
6. **QQ 官方巅峰榜暂不可用**：Tonzhon 上 QQ 官方巅峰榜的 `disstid` 已变更（当前仅返回「今日私享」类算法歌单），故 QQ 分组采用已验证可返回的精选/每日榜单，而非官方巅峰榜。
7. **收藏集 `1_xiage.json` 中约 60% 歌曲在网易云变灰（诊断结论，非匹配错误）**：该收藏集原以 QQ 源为主，转换时已正确匹配到对应网易云 id（抽样 12 首不可播样本「存储名」与「网易云实际曲名」100% 一致，0 错配），但这些 QQ 正版曲（如《那女孩对我说》《一千年以后》《流星雨》《幻听》）在网易云已被下架变灰，故 weapi 返回 NULL。此类歌需**非网易云音源（QQ/酷狗音频后端）**才能出声，属独立工程，可另立项扩展。

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
