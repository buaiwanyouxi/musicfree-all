# MusicFree 音乐插件集合（作者：tianpeng）

> ## 🔝 一键订阅（推荐）
>
> 在 MusicFree 中「设置 → 插件设置 → 插件订阅 → 添加订阅源」，粘贴下方订阅直链即可**一次性订阅全部已收录插件**（当前含 我要下歌 / 哔哩哔哩 / 布谷音乐）：
>
> ```
> https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-tianpeng.json
> ```
>
> 该链接为 `raw.giteeusercontent.com` 零跳转直链，桌面端与移动端均可稳定加载；订阅源文件详见 [musicfree-tianpeng.json](musicfree-tianpeng.json)。

本仓库收录 6 个适配 [MusicFree](https://github.com/maotoumao/MusicFree) 的音源插件，数据源分别为「我要下歌」「咪咕音乐」「布谷音乐」「歌曲宝」「放屁音乐网」「哔哩哔哩」。

## 插件列表

| 插件 | 平台标识 | 数据源 | 安装链接 |
|------|----------|--------|----------|
| 我要下歌 | `xiage` | `xiage.yiwuku.com` 已变更为 **Tonzhon**（`tonzhon.com`）；适配 wy 网易云 / kg 酷狗 / QQ 音乐 | [安装](https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js) · [源码](musicfree-xiage/xiage.js) |
| 咪咕音乐 | `migu` | `music.migu.cn`（咪咕直链，需 Cookie 开启歌单） | [安装](https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-migu/migu.js) · [源码](musicfree-migu/migu.js) |
| 布谷音乐 | `buguyy` | `buguyy.top`（kw CDN） | [安装](https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-buguyy/buguyy.js) · [源码](musicfree-buguyy/buguyy.js) |
| 歌曲宝 | `gequbao` | `gequbao.com`（kw CDN 直链） | [安装](https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-gequbao/gequbao.js) · [源码](musicfree-gequbao/gequbao.js) |
| 放屁音乐网 | `fangpi` | `fangpi.net`（kw CDN 直链） | [安装](https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-fangpi/fangpi.js) · [源码](musicfree-fangpi/fangpi.js) |
| 哔哩哔哩 | `bilibili` | `bilibili.com`（需 Cookie 开启歌单） | [安装](https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-bilibili/bilibili.plugin.js) · [源码](musicfree-bilibili/bilibili.plugin.js) |

> 「平台标识」为本仓库的插件目录标识；插件安装后在 MusicFree 内显示的平台名可能为中文，如 `xiage` → 「我要下歌」、`bilibili` → 「Bilibili」、`buguyy` → 「布谷音乐」、`migu` → 「咪咕音乐」。

## 安装方法

MusicFree →「设置」→「插件设置」→「从网络安装插件」→ 填入对应链接：

| 插件 | 安装链接（直接复制） |
|------|----------------------|
| 我要下歌 | `https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js` |
| 咪咕音乐 | `https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-migu/migu.js` |
| 布谷音乐 | `https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-buguyy/buguyy.js` |
| 歌曲宝 | `https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-gequbao/gequbao.js` |
| 放屁音乐网 | `https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-fangpi/fangpi.js` |
| 哔哩哔哩 | `https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-bilibili/bilibili.plugin.js` |

**关于链接形式**：以上使用 `raw.giteeusercontent.com` 直链，**零跳转**、最稳定。若需要，`https://gitee.com/koujiao/musicfree-tianpeng/raw/master/<目录>/<文件>` 同样可用，但它会 302 跳转到上面的直链。

> 需要 Cookie 的插件（咪咕、哔哩哔哩）安装后请点击插件「配置」填入对应变量；不填也能使用榜单等公开内容。
>
> 各插件目录内含独立说明文档与本地测试脚本（需 `node` + `axios`）。

---

## 哔哩哔哩 插件说明（v1.1.4）

把 B站 当音乐库用：**个人收藏夹变歌单**、**多分 P 视频一键拉取成歌单**、纯音频后台播放。

- **支持用户 SESSDATA 登录**：插件设置项 `SESSDATA` 填入凭证（也可整段粘贴 Cookie，插件自动提取），凭证仅存于本地应用，不写死于代码。
- **支持畅听个人收藏夹**：登录后列出名下全部收藏夹并映射为歌单，逐页加载、点开即听；收藏夹内多 P 视频自动展开为独立音轨。
- **支持拉取全部分 P 添加歌单**：粘贴任意视频链接即把其**所有分 P 逐集展开**为歌单。实测 `BV1oLBXBiEW5`（100 集无损歌单合集）→ 得到 100 首独立音轨，标题自动带「P序号 + 分集名」。
- **四大榜单**：入站必刷、每周必刷、各分区排行榜（音乐/翻唱/演奏/动画/游戏…共 21 个分区）、我的收藏夹。
- **纯音频 + 多音质**：从 DASH 流提取音频轨，按 MusicFree 音质档位自动选码率，不下载画面。
- **免登录也能用**：不填 SESSDATA 时「每周必刷 / 各分区排行榜」照常播放，填了才额外解锁「我的收藏夹 / 入站必刷」。

详见 [musicfree-bilibili/README.md](musicfree-bilibili/README.md)（含 SESSDATA 获取步骤、多 P 导入用法、已知限制）。

---

## 我要下歌 插件说明（v0.0.14）

原站点 `xiage.yiwuku.com` 已变更，插件后端现为 **铜钟 Tonzhon**（`tonzhon.com`）。

- 榜单 / 热门歌单：网易云排行榜、酷狗排行榜、QQ音乐歌单，以及三平台热门歌单，均取自 Tonzhon `playlist` 接口。
- 搜索与歌词走 `tonzhon.com`；**播放按来源路由至各平台官方后端**——网易云 `weapi`、腾讯 QQ `CgiGetVkey`、酷狗 `play/getdata`，取链失败时回退网易云匹配。
- 已知后端限制（Tonzhon 侧，非插件缺陷）：汽水/抖音无此源；kw 酷我与百度的 `types=playlist` 返回空，故未提供其歌单/榜单；QQ 官方巅峰榜 `disstid` 已变更，QQ 分组改用可稳定返回的精选/每日榜单。

详见 [musicfree-xiage/README.md](musicfree-xiage/README.md)。

---

## 咪咕音乐 插件说明（v0.0.3）

数据源 `music.migu.cn`，播放为咪咕官方直链。

- 排行榜免登录可用；**歌单（个人歌单 / 推荐歌单）需填入 `miguCookie`** 后才显示并可播放。
- 详见 [musicfree-migu/README.md](musicfree-migu/README.md)。

---

## 歌曲宝 / 放屁音乐网 插件说明（v1.0.0）

两站为**同引擎**（均使用 `gequbao.com` 系接口），取链流程完全一致；插件已分别打包为 `gequbao.js` / `fangpi.js`，功能相同，仅数据源站点不同。

取链原理（已逆向验证）：

1. 打开歌曲页 `/music/{id}`，取得会话 Cookie 与 `window.appData.play_id`（服务端下发的 Laravel 加密令牌）；
2. `POST /member/common-play-url { id: play_id }`（携带步骤 1 的 Cookie）返回可播直链；
3. 直链为 **kw CDN**（`kw-er.kuwo.cn/.../*.mp3`，`audio/mpeg`，支持 Range），实测可直接流式播放。

已实现能力：

- `search` 搜索（按歌名/歌手）
- `getTopLists` / `getTopListDetail` 榜单：热歌榜、每周搜索榜、每周下载榜、热词榜
- `getLyric` 歌词（歌曲页内嵌 `#content-lrc`，直接解析）
- `importMusicItem` / `importMusicSheet` 导入单曲与歌单（榜单/列表页链接均可）

已知限制（站点侧，非插件缺陷）：

- 部分歌曲（触发服务端人机验证，或 `mp3_type=1` 仅试听）无法直接取链，此类歌曲会取链失败或仅返回 30s 试听；
- kw CDN 直链为签名限时链接，有效期有限，但足以完成一次播放。

---

## 布谷音乐 插件说明（v0.0.4）

数据源为 `buguyy.top`（kw 子集镜像），并直连 kw Web 接口补齐曲库。

已实现能力：

- `search` 搜索（布谷镜像，按标题，单次最多 50 条）
- `getTopLists` / `getTopListDetail` 排行榜：
  - 布谷热门榜（热歌/新歌/随机）+ 音乐串烧
  - 网易云音乐官方榜 7 个（SSR 全量 200 首，可翻页）
  - QQ音乐官方榜 30 个（巅峰/地区/特色/全球，20 首/页）
  - 酷狗官方榜 33 个（热门/特色/全球，22 首/页，TOP500 可翻 23 页）
  - kw 官方榜（官网榜单组动态获取，20 首/页）
- 热门歌单（`getRecommendSheetTags` / `getRecommendSheetsByTag` / `getMusicSheetInfo`）：
  - 网易云：首页推荐歌单（SSR 取前 10 首，官方榜 200 首）
  - kw：官网推荐歌单 + 歌单详情（20 首/页）
  - QQ / 酷狗：平台自有歌单内容需登录态、匿名不可得，故分别以 30 / 33 个官方榜代替提供（可正常翻页播放）
- `getMediaSource` 播放源链：布谷镜像 geturl → kw 直连兜底
  - kw 歌曲：原始 rid 直连（`/api/v1/www/music/playUrl`）
  - 其他歌曲：kw 搜索定位 rid（纯标题 → 标题+歌手 两轮，全角括号归一化）
  - 搜索头部命中常为 VIP 版本时，自动尝试下一候选版本直至可播
- `getLyric` 歌词（布谷镜像 LRC，跨源歌曲经搜索匹配兜底）
- `getMusicInfo` 网易云单曲元数据补齐（时长/歌手/专辑/封面）

已知限制（站点侧，非插件缺陷）：

- VIP/付费歌曲无法播放（kw `playUrl` 返回付费提示），此类歌曲会提示「未找到可播放音源」；
- 布谷镜像 geturl 接口有限流（短时大量请求会返回「请求过于频繁」），插件按单次播放取链，正常使用不受影响；
- QQ / 酷狗平台自有歌单（非官方榜）需登录态，匿名无法获取歌曲列表；
- 汽水音乐无公开 Web 数据源，未接入。

---

## 声明

- 本仓库插件仅供个人学习与技术研究，所有音频/视频内容版权归各平台及权利人所有。
- 插件仅作播放器，不缓存、不存储、不分发任何媒体文件；请勿用于商业用途。
- 需要 Cookie 的插件，凭证仅保存在你本机的 MusicFree 应用内，不上传任何第三方服务。
