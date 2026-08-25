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
