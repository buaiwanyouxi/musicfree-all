# 我要下歌 MusicFree 插件 (xiage)

- **平台标识**：`xiage`（应用内显示为「我要下歌」）
- **当前版本**：`v0.0.14`
- **数据源**：原站点 `xiage.yiwuku.com` **已变更为 铜钟 Tonzhon**（`tonzhon.com`）；适配 **wy 网易云 / kg 酷狗 / QQ 音乐** 三源
- **不支持的源**：kw 酷我、百度（Tonzhon `types=playlist` 对二者返回 0 字节）；汽水/抖音（Tonzhon 无此源）

## 安装链接（从 URL 安装）

```
https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@main/musicfree-xiage/xiage.js
```

---

将「我要下歌」音乐站适配为 MusicFree 插件（原站点 `xiage.yiwuku.com` 已变更，后端现为 Tonzhon）。

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

> **版本 0.0.14（修复：①排行榜歌单为空 ②部分 QQ 曲仅 30s 试听）**
> **① 排行榜为空**：v0.0.13 将插件改写为 IIFE 后，`_fetchSongs` 仅作为 `plugin` 对象字面量属性存在，而 `getTopListDetail` / `getMusicSheetInfo` 用裸标识符 `_fetchSongs(...)` 调用 → IIFE 作用域内找不到 → `ReferenceError: _fetchSongs is not defined` → 排行榜/歌单详情返回空。修复：将 `_fetchSongs` **提升为 IIFE 作用域自由函数**（删除对象字面量内属性），两处调用即生效。验证 `getTopListDetail` 现返回 100 首（云音乐飙升榜）。
> **② 部分 QQ 曲仅 30s**：QQ 免费账号经 CgiGetVkey 对部分曲（含非 VIP 的试听限制曲）返回 30s 试听片段；且仅凭 CgiGetVkey 的 buy 标志**无法区分**试听与完整（实测慢冷 Live 与空气变软标志完全相同）。修复为两道保险：
>   - **QQ 试听识别**：`looksLikePreview` 由 HEAD 改为 **Range GET**（`Range: bytes=0-0` 读 `content-range` 的 TOTAL 字节），aqqmusic 对 HEAD 不回 content-length、但对 Range GET 稳定回 `content-range: bytes 0-0/TOTAL`；`total < 1.2MB` 判为试听（30s@128kbps≈500KB，完整曲≥2MB），命中即回退网易云完整版；完整 QQ 曲保留原链。
>   - **网易云回退提质**：原 `matchNeteaseByQuery` 仅取搜索第 1 名，若其变灰（weapi 返回 `url:null`）则整体回退失败、退回 30s QQ 试听。改为 `getNeteaseUrlForQuery` **遍历前 8 个搜索结果、逐个取链并排除试听片段，返回首个完整直链**；候选全为试听/变灰时退守最后一个非空直链（至少可播）。实测：慢冷 Live 首位李荣浩版变灰→第 2 名梁静茹版 1.5MB 命中；白月光与朱砂痣 大籽版网易云原直链仅 0.94MB（试听）→ 继续命中完整版 1.9MB。
> 验证：慢冷 Live / 白月光 → 网易云完整（1.5/1.9MB）；空气变软 → 保留 QQ 完整（2.8MB）；20 首 QQ 曲抽样 0 试听、0 失败、4 首走 QQ 完整、16 首因 QQ 免费账号版权拦截走网易云回退且均成功拿到完整版。
>
> **版本 0.0.13（移动端"插件无法解析"真正修复：跨加载器协议兼容 IIFE）**
> 现象：v0.0.11 / v0.0.12 桌面端可装，**移动端本地安装仍报"插件无法解析"**。
> 根因（已用与 MusicFree 真实加载器**完全一致**的 `Function(body)()` 外壳复现并定位）：MusicFree 的插件加载器有两种协议形态——
>   - (A) 新协议 CommonJS：沙箱注入 `module`/`exports`，期望插件写 `module.exports = {...}`；
>   - (B) 老式协议 `return ${funcCode}`：把整段源码当**表达式**直接 `return`，且**不注入 `module`/`exports`**。
> 旧版插件（v0.0.11/0.0.12）仅写 `module.exports = {...}`。在(B)类加载器下 `module` 未定义 → `ReferenceError: module is not defined` → 被 `mountPlugin` 捕获为 `PluginErrorReason.CannotParse` → 报"插件无法解析"。**这正是用户判定"非 302、而是代码依赖/语法"所指的依赖**——依赖了一个沙箱未注入的 `module` 全局。
> 修复：整个插件改写为 **IIFE 表达式** `(function(){ ... return plugin; })()`，三路导出兼容两种协议：
>   1. 注入 `module` 的环境 → `module.exports = plugin`（兼容 A）；
>   2. 注入 `exports` 的环境 → `exports.default = plugin`（兼容 A 的 `.default` 读取分支）；
>   3. 不注入 `module`/`exports` 的老式 `return funcCode` 环境 → IIFE 作为表达式被 `return`，返回 `plugin`（兼容 B）。
>   同时 `require` 用 `typeof __musicfree_require !== 'undefined' ? __musicfree_require : require` 安全取用，避免依赖具体注入名。
> 验证：用 `new Function("'use strict'; return function(require,__musicfree_require,module,exports,console,env,URL,process){ "+源码+" }")()` 严格复现真实加载器——在「注入 module」与「不注入 module」两种环境下均 **9/9 方法导出成功**；并经 `hermes-parser`（Hermes 引擎规范）与 `esprima` ES2017 双重解析验证无语法问题。
>
> **版本 0.0.12（仅改安装地址为 CDN 直链）【此结论已被 v0.0.13 更正：302 非根因】**
> 现象：v0.0.11 移动端仍无法安装。原误判为安装地址 `gitee.com/raw` 的 **302 重定向**导致移动端拿到 HTML。但用户实测确认 302 并非根因（且本地安装本就无 302；网络安装时 axios 默认跟随 302），故该修复只是无害的次要优化，未触及真正问题。真正根因为上方 v0.0.13 所述的**加载器协议不兼容**。
>
> **版本 0.0.11（移除 crypto-js / big-integer / Buffer 依赖）【此判定同样非根因】**
> 原判移动端沙箱缺 crypto-js/big-integer/Buffer。经 `vm` 沙箱与真实加载器复现，沙箱其实内置这些模块、且代码本身可零异常加载——故该"根因"不成立。其纯 JS 加密实现被 v0.0.13 保留（无害且更通用），但移除依赖本身并非修复关键。
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

MusicFree → 设置 → 插件设置 → 添加「从网络链接安装」或「从本地文件安装」。

**推荐使用下方 CDN 直链**（无 302 重定向，最稳妥）：

```
https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@main/musicfree-xiage/xiage.js
```

> 说明：v0.0.13 已从**代码层面**修复移动端"插件无法解析"（跨加载器协议兼容 IIFE，详见上方版本说明）；v0.0.14 进一步修复排行榜为空与部分 QQ 曲仅 30s 试听（详见上方版本说明）。若仍用旧版 `gitee.com/.../raw/` 链接，桌面端可装、移动端因 302 不跟随可能异常；故统一用上面的 `jsDelivr` 直链最稳妥。本地安装请直接加载本仓库 `musicfree-xiage/xiage.js`（v0.0.14+）。
