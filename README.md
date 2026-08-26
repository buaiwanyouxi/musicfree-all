# MusicFree 音乐插件集合（作者：tianpeng）

本仓库收录 5 个适配 [MusicFree](https://github.com/maotoumao/MusicFree) 的音乐源插件，数据源分别为「我要下歌」「咪咕音乐」「布谷音乐」「歌曲宝」「放屁音乐网」。

## 插件列表

| 插件 | 平台标识 | 数据源 | 安装链接 |
|------|----------|--------|----------|
| 我要下歌 | xiage | xiage.yiwuku.com（酷我 CDN） | [xiage.js](musicfree-xiage/xiage.js) |
| 咪咕音乐 | migu | music.migu.cn（咪咕直链，需 Cookie 开启歌单） | [migu.js](musicfree-migu/migu.js) |
| 布谷音乐 | buguyy | buguyy.top（酷我 CDN） | [buguyy.js](musicfree-buguyy/buguyy.js) |
| 歌曲宝 | gequbao | gequbao.com（酷我 CDN 直链） | [gequbao.js](musicfree-gequbao/gequbao.js) |
| 放屁音乐网 | fangpi | fangpi.net（酷我 CDN 直链） | [fangpi.js](musicfree-fangpi/fangpi.js) |

## 安装方法

MusicFree → 插件管理 → 从 URL 安装 → 填入对应插件链接：

- 我要下歌：`https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js`
- 咪咕音乐：`https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-migu/migu.js`
- 布谷音乐：`https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-buguyy/buguyy.js`
- 歌曲宝：`https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-gequbao/gequbao.js`
- 放屁音乐网：`https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-fangpi/fangpi.js`

> 各插件目录内含独立说明与本地测试脚本（需 `node` + `axios`）。

## 歌曲宝 / 放屁音乐网 插件说明

两站为**同引擎**（均使用 `gequbao.com` 系接口），取链流程完全一致；插件已分别打包为 `gequbao.js` / `fangpi.js`，功能相同，仅数据源站点不同。

取链原理（已逆向验证）：

1. 打开歌曲页 `/music/{id}`，取得会话 Cookie 与 `window.appData.play_id`（服务端下发的 Laravel 加密令牌）；
2. `POST /member/common-play-url { id: play_id }`（携带步骤 1 的 Cookie）返回可播直链；
3. 直链为**酷我 CDN**（`kw-er.kuwo.cn/.../*.mp3`，`audio/mpeg`，支持 Range），实测可直接流式播放。

已实现能力：

- `search` 搜索（按歌名/歌手）
- `getTopLists` / `getTopListDetail` 榜单：热歌榜、每周搜索榜、每周下载榜、热词榜
- `getLyric` 歌词（歌曲页内嵌 `#content-lrc`，直接解析）
- `importMusicItem` / `importMusicSheet` 导入单曲与歌单（榜单/列表页链接均可）

已知限制（站点侧，非插件缺陷）：

- 部分歌曲（触发服务端人机验证，或 `mp3_type=1` 仅试听）无法直接取链，此类歌曲会取链失败或仅返回 30s 试听；
- 酷我 CDN 直链为签名限时链接，有效期有限，但足以完成一次播放。

## 布谷音乐 插件说明（v0.0.5）

数据源为 `buguyy.top`（酷我子集镜像），并直连酷我 Web 接口补齐曲库。

已实现能力：

- `search` 搜索（布谷镜像，按标题，单次最多 50 条）
- `getTopLists` / `getTopListDetail` 排行榜：
  - 布谷热门榜（热歌/新歌/随机）+ 音乐串烧
  - 网易云音乐官方榜 7 个（SSR 全量 200 首，可翻页）
  - QQ音乐官方榜 30 个（巅峰/地区/特色/全球，20 首/页）
  - 酷狗官方榜 33 个（热门/特色/全球，22 首/页，TOP500 可翻 23 页）
  - 酷我官方榜（官网榜单组动态获取，20 首/页）
- 热门歌单（`getRecommendSheetTags` / `getRecommendSheetsByTag` / `getMusicSheetInfo`）：
  - 网易云：首页推荐歌单（SSR 取前 10 首，官方榜 200 首）
  - 酷我：官网推荐歌单 + 歌单详情（20 首/页）
  - QQ / 酷狗：平台自有歌单内容需登录态、匿名不可得，故分别以 30 / 33 个官方榜代替提供（可正常翻页播放）
- `getMediaSource` 播放源链：布谷镜像 geturl → 酷我直连兜底
  - 酷我歌曲：原始 rid 直连（`/api/v1/www/music/playUrl`）
  - 其他歌曲：酷我搜索定位 rid（纯标题 → 标题+歌手 两轮，全角括号归一化）
  - 搜索头部命中常为 VIP 版本时，自动尝试下一候选版本直至可播
- `getLyric` 歌词三级链：酷我 geturl.lrc → 布谷镜像 → 歌词网（followlyrics.com）按歌名搜索兜底，补齐跨源歌歌词
- `getMusicInfo` 网易云单曲元数据补齐（时长/歌手/专辑/封面）

已知限制（站点侧，非插件缺陷）：

- VIP/付费歌曲无法播放（酷我 `playUrl` 返回付费提示），此类歌曲会提示「未找到可播放音源」；
- 布谷镜像 geturl 接口有限流（短时大量请求会返回「请求过于频繁」），插件按单次播放取链，正常使用不受影响；
- QQ / 酷狗平台自有歌单（非官方榜）需登录态，匿名无法获取歌曲列表；
- 汽水音乐无公开 Web 数据源，未接入。
