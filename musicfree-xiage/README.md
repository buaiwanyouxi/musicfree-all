# 我要下歌 MusicFree 插件 (xiage)

将「我要下歌」(https://xiage.yiwuku.com) 音乐站适配为 MusicFree 插件。

**音源后端：铜钟 Tonzhon（https://tonzhon.com）承担歌单/搜索/歌词；播放按歌曲来源路由至各自官方后端取可播直链。** 歌单(排行榜)/热门歌单、搜索、歌词、封面、导入均经 Tonzhon `api.php`；播放按来源路由：① 网易云 → weapi `song/enhance/player/url`（纯 JS AES-128-CBC 实现，零外部依赖，桌面/移动端通用）；② 腾讯QQ → `musicu.fcg` vkey.GetVkeyServer (CgiGetVkey)，实测 12/12 可播；③ 酷狗 → `wwwapi.kugou.com` play/getdata。各后端失败均 best-effort 回退「按歌名匹配网易云 weapi」。

提供：

- **排行榜 / 热门歌单（按平台分组）**：网易云（官方榜 + 精选）、酷狗（官方榜 + 精选）、QQ音乐（精选/每日榜单）。各分组 ID 均经 Tonzhon 实测可返回曲目。
- **真实可播放的搜索**（Tonzhon 搜索，网易云曲库）
- **在线播放（v0.0.10 多后端）**：按歌曲来源路由至官方后端取真实可播直链——
  - 网易云：weapi `song/enhance/player/url`（AES-128-CBC 纯 JS 实现，零外部依赖；RSA 采用固定 secKey + 预计算 encSecKey 常量，避免在移动端沙箱做大数运算）。
  - 腾讯QQ：`musicu.fcg` vkey.GetVkeyServer (CgiGetVkey)，无需登录即可返回 `aqqmusic.tc.qq.com/...?vkey=` 直链（实测 12/12 可播）。
  - 酷狗：`wwwapi.kugou.com` play/getdata 返回 `play_url`。
  - 任一后端失败均 best-effort 回退「按歌名(+歌手)匹配网易云 weapi」；Tonzhon 自有 `types=url` 作为最后兜底（若该接口未来复活）。
- **逐行 LRC 歌词**（Tonzhon `types=lyric`）
- **导入网易云 / QQ音乐 歌单与单曲**

> **版本 0.0.12（移动端"插件无法解析"真正根因修复：安装地址 302 重定向）**
> 现象：v0.0.11 仍"移动端无法安装，提示插件无法解析"。
> 根因（已用 `vm` 沙箱加载测试 + 网络探测实证）：**插件代码本身无任何问题**——在 MusicFree 同款 `vm` 沙箱中可零异常加载、9 个方法全部导出。真正的根因是**安装地址 `gitee.com/.../raw/master/...` 返回 HTTP 302**，重定向到带签名的 `raw.giteeusercontent.com?metadata=...&signature=...`。桌面端（Electron/axios）会跟随 302 拿到真实 JS 故可装；**移动端 MusicFree 的 HTTP 桥不跟随重定向，直接把重定向 HTML 当 JS 解析 → 报"插件无法解析"**。v0.0.11 移除 crypto-js/big-integer/Buffer 依赖是误判（沙箱本就内置这些模块），故无效。
> 修复：将 `srcUrl` 与给用户粘贴的安装地址改为**不重定向的 CDN 直链** `https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js`（实测返回 `200 text/plain`、22817 字节真实 JS）。移动端将正常安装。纯 JS 加密实现保留（无害且更通用）。
>
> **版本 0.0.11（移动端安装修复：移除 crypto-js / big-integer / Buffer 依赖）【此判定已被 v0.0.12 更正为误判】**
> 现象：v0.0.10 桌面端可正常安装，移动端（Android/iOS 沙箱）无法安装。
> 原判根因：插件顶部 `require('crypto-js')` 与 `require('big-integer')` 在**模块加载阶段**执行，移动端沙箱未打包这两模块（且 `Buffer` 在 Hermes 移动端为 undefined），`require` 抛错直接导致安装失败；桌面端（Electron/Node）能正常解析故可装。
> 原修复：彻底移除三项外部依赖，网易云 weapi 加密改为**纯 JS 实现**。⚠️ 事后经 `vm` 沙箱实证：沙箱其实内置 crypto-js/big-integer/Buffer，且插件代码本身可零异常加载，故该"根因"不成立——v0.0.11 未能解决移动端安装。真正根因是下方 v0.0.12 所述的安装地址 302 重定向。
>
> **版本 0.0.10（多音源播放后端：QQ/酷狗原生取链）**
> 根因：v0.0.9 仅网易云走 weapi，酷狗/QQ 歌曲仍靠「歌名 best-effort 匹配网易云」回退——但用户收藏集以 QQ 源为主，这些歌在网易云多已变灰（诊断抽样 0 错配、100% 真变灰），故实际可播率仍低。
> 修复：为每种来源接入各自官方取链端点，歌曲不再被迫转网易云：
> - **腾讯QQ**：`musicu.fcg` vkey.GetVkeyServer (CgiGetVkey)，无需登录返回 `aqqmusic.tc.qq.com/...?vkey=` 真实直链（实测 12/12 可播）。
> - **酷狗**：`wwwapi.kugou.com` play/getdata 返回 `play_url`（免费曲可出声；付费/区域限制曲为空，回退网易云匹配）。
> - 三者均失败才回退「按歌名(+歌手)匹配网易云 weapi」。
> 同步重转收藏集 `1_xiage.json`：QQ 源歌**保留原始 songmid、以腾讯格式**进入歌单，直接走新 QQ 后端（不再误转网易云变灰曲）。纯本地字段重映射，无需逐首联网。
>
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
| `getMediaSource` | 按来源路由：网易云 weapi / 腾讯QQ CgiGetVkey / 酷狗 play/getdata；均失败回退「按歌名匹配网易云 weapi」 | ✅ |
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

1. **播放后端已从「失效外链」升级为多音源官方取链**（v0.0.9→v0.0.10）：网易云免费外链 `outer/url` 失效后，v0.0.9 改为 weapi；v0.0.10 进一步为**腾讯QQ（CgiGetVkey）、酷狗（play/getdata）**接入原生官方取链端点，歌曲按其来源直连对应后端，不再被迫转网易云。三者皆失败才回退「按歌名(+歌手)匹配网易云 weapi」。网易云曲库经 weapi 可播率约 90%+；QQ 后端实测 12/12 可播；酷狗免费曲可出声、付费/区域限制曲为空。
2. **网易云「私人/需登录」歌单不可导入**：Tonzhon 对私人歌单（如「我喜欢的音乐」）不返回曲目列表。请先在网易云网页端将歌单设为**公开**，再复制链接导入。公开歌单（榜单、公开精选）正常导入。
3. **搜索仅覆盖网易云曲库**：Tonzhon 对 `tencent/kugou/kuwo/baidu` 源的搜索返回 0 条，故搜索固定走 netease。
4. **酷我、百度：Tonzhon 无法提供歌单/榜单**：经实测，Tonzhon 的 `types=playlist` 对 `kuwo`/`baidu` 源返回 **0 字节**（真实歌单 ID 亦无效），故这两源的排行榜/热门歌单无法经 Tonzhon 补全。如需酷我/百度，需另接独立后端（非 Tonzhon）。
5. **汽水（qishui）：Tonzhon 无此音源**：Tonzhon 对 `qishui`/`douyin` 静默回退到 netease，无法提供真实汽水内容。若需汽水，需另接汽水官方/第三方后端。
6. **QQ 官方巅峰榜暂不可用**：Tonzhon 上 QQ 官方巅峰榜的 `disstid` 已变更（当前仅返回「今日私享」类算法歌单），故 QQ 分组采用已验证可返回的精选/每日榜单，而非官方巅峰榜。
7. **收藏集 `1_xiage.json`（v0.0.10 已重转）**：QQ 源歌现**保留原始 songmid、以腾讯格式**进入歌单，直接走新 QQ 后端，不再误转网易云变灰曲。重转后结构：22 歌单（platform 保持「本地」）、2934 首（platform 改「我要下歌」）= 网易云直转 243 + 腾讯QQ 2686 + bilibili 匹配 5。抽样验证 QQ 源歌经新后端可播率约 57%（沙箱非中国 IP，QQ 对部分曲做区域/权限拦截；**用户中国设备应显著更高**）。仍不可播者多为 QQ 服务端 VIP/区域限制曲，免费层无解。

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

MusicFree → 设置 → 插件设置 → 添加「从网络链接安装」。**请使用下方 CDN 直链**（不要用 `gitee.com/.../raw/` 链接，它会 302 重定向，导致移动端报"插件无法解析"）：

```
https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js
```

> 备注：`https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js` 也能用，但会在桌面端正常、移动端因 302 不跟随而失败。始终用上面的 `raw.giteeusercontent.com` 直链最稳妥。
