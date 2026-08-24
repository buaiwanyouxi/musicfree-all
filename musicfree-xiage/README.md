# 我要下歌 MusicFree 插件 (xiage)

将「我要下歌」(https://xiage.yiwuku.com) 音乐站适配为 MusicFree 插件。

**音源后端：铜钟 Tonzhon（https://tonzhon.com）· 全链路统一**。歌单(排行榜)、搜索、歌词、封面、导入均经 Tonzhon `api.php`；播放走「Tonzhon `types=url` → 官方同款网易云外链回退」链路，与 Tonzhon 官方前端行为完全一致。

提供：

- **歌单/排行榜**：铜钟 Tonzhon 排行榜（网易云官方榜，经 Tonzhon `playlist` 接口呈现）
- **真实可播放的搜索**（Tonzhon 搜索，网易云曲库）
- **在线播放**：先调 Tonzhon `types=url`（Tonzhon 自有音源），其 `url` 接口对全部音源返回空时，回退到网易云官方外链 `music.163.com/song/media/outer/url?id=<id>.mp3`（302 → 真实 CDN 直链，插件内解析，绕过播放器不跟随跨域跳转）——此回退即 Tonzhon 前端 `js/ajax.js` 在 `types=url` 失效时的标准处理
- **逐行 LRC 歌词**（Tonzhon `types=lyric`）
- **导入网易云 / QQ音乐 歌单与单曲**

> **版本 0.0.7（全链路 Tonzhon 一致性修复）**
> 针对三点反馈修复：
> 1. **播放使用 Tonzhon 音源**：`getMediaSource` 先调 Tonzhon `types=url`，拿不到再走 Tonzhon 官方同款网易云外链回退（即代码路径真正走 Tonzhon）。
> 2. **歌单与 tonzhon.com 保持一致**：排行榜歌单改由 Tonzhon `playlist` 接口提供（网易云官方榜），不再从 xiage 站点抓取；xiage 站点抓取法降级为「Tonzhon 全失败时」的备用组。
> 3. **搜索与 tonzhon.com 保持一致**：搜索固定 Tonzhon `types=search`（source=netease），与歌单/播放同源。
>
> **版本 0.0.6 历史**：元数据全走 Tonzhon，但歌单仍抓 xiage 站点、播放直连网易云外链，未做到全链路一致。
> **版本 0.0.5 历史**：曾以 meting 为后端，因接口失效切换为 Tonzhon。

## 功能

| 方法 | 说明 | 状态 |
|------|------|------|
| `getTopLists` / `getTopListDetail` / `getMusicSheetInfo` | 铜钟 Tonzhon 排行榜（网易云官方榜，经 Tonzhon `playlist`） | ✅ |
| `search` | Tonzhon 搜索（网易云源），返回可播放结果 | ✅ |
| `importMusicSheet` / `importMusicItem` | 导入**网易云 / QQ音乐**歌单/单曲链接 | ✅（见限制） |
| `getMediaSource` | Tonzhon `types=url` → 官方网易云外链 302 → https CDN 直链 | ✅ |
| `getLyric` | Tonzhon 逐行 LRC 歌词 | ✅ |

## 已知限制（站点/音源侧，非插件 bug）

1. **仅网易云可稳定播放**：Tonzhon 的 `types=url` 接口当前对全部音源（netease/tencent/kugou/baidu）均返回空，唯一可靠播放是网易云官方外链。因此搜索结果、网易云歌单、xiage 站内歌曲均走网易云播放；QQ 歌曲以「歌名匹配网易云」best-effort 播放（可能匹配到同名不同唱版本）。
2. **网易云「私人/需登录」歌单不可导入**：Tonzhon 对私人歌单（如「我喜欢的音乐」）不返回曲目列表。请先在网易云网页端将歌单设为**公开**，再复制链接导入。公开歌单（榜单、公开精选）正常导入。
3. **搜索仅覆盖网易云曲库**：Tonzhon 对 `tencent/kugou/kuwo/baidu` 源的搜索返回 0 条，故搜索固定走 netease。
4. **酷我、百度等音源暂不支持导入**：Tonzhon 未提供稳定后端。

## 逆向来源（全部真实站点 + Tonzhon 接口实测，无盲猜）

- **Tonzhon 接口**（抓前端 `js/ajax.js`、`js/player.js` 反推 + `api.php` 实测）：
  - 搜索：`POST api.php` `types=search&source=netease&name=<词>&pages=<页>&count=<条>` → `[{id,name,album,pic_id,url_id,lyric_id,source,artist:[["a,b"]]}]`
  - 歌词：`types=lyric&id=<lyric_id>&source=netease` → 逐行 LRC 文本
  - 封面：`types=pic&id=<pic_id>&source=netease` → `{url:"https://p3.music.126.net/..."}`
  - 网易云歌单/排行榜：`types=playlist&id=<歌单id>&source=netease` → `playlist.tracks[]`（公开歌单含全曲）
  - QQ 歌单：`types=playlist&id=<歌单id>&source=tencent` → `data.cdlist[0].songlist[]`（含 `mid`/`name`/`singer`）
  - **播放链路（关键）**：Tonzhon 前端 `ajax.js` 中 `ajaxUrl` 在 `types=url` 返回空时，回退 `https://music.163.com/song/media/outer/url?id=<netease_id>.mp3`；非空时将其 `m7c/m8c.music.` 节点修正为 `m7/m8.music.`。本插件完全复刻该逻辑：先 `types=url`，再官方回退。
- **xiage 站点（仅备用）**：列表项位于 `.erx-m-list` 下的裸 `<li>`，字段 `span.m`(标题)/`div.ser span`(歌手)/`span.f12.i`(时长)；仅当 Tonzhon 全部不可达时作为歌单备用源。

## 安装

MusicFree → 设置 → 插件设置 → 添加「从网络链接安装」：

```
https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js
```
