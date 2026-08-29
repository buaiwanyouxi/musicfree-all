# 歌曲宝 MusicFree 插件 (gequbao.js)

将 [歌曲宝](https://www.gequbao.com) 适配为 MusicFree 插件。数据源为酷我音乐（KuWo）CDN 直链，无需登录。

> 歌曲宝与「放屁音乐网」(fangpi.net) 为**同引擎、同接口**（均使用 `gequbao.com` 系接口），取链流程完全一致；本插件与 `fangpi.js` 代码逻辑相同，仅数据源站点不同。

- **作者**：tianpeng
- **版本**：1.0.0
- **支持搜索类型**：music（歌曲）

## 已实现功能

| 功能 | 方法 | 说明 |
|------|------|------|
| 搜索 | `search` | `GET /s/{关键词}`，单页返回全部结果（`?page=` 无效，恒 `isEnd=true`） |
| 播放 | `getMediaSource` | 见下方「取链原理」，返回酷我 CDN 直链（`kw-er.kuwo.cn/.../*.mp3`，支持 Range） |
| 歌词 | `getLyric` | 歌曲页内嵌 `<div id="content-lrc">`（`<br>` 分隔的 LRC），直接解析 |
| 榜单/歌单 | `getTopLists` / `getTopListDetail` / `getMusicSheetInfo` | 热歌榜 `hot-music`、每周搜索榜 `top/week-search`、每周下载榜 `top/week-download`、热词榜 `hot-words`；歌单/榜单详情统一经 `fetchSheetItems` 拉取 |
| 导入 | `importMusicItem` / `importMusicSheet` | 支持单曲链接与歌单/榜单链接导入 |

## 取链原理（已逆向验证）

歌曲宝不提供直链接口，取链为「歌曲页拿会话 → 解密令牌 → 接口换链」三步：

1. `GET /music/{id}` 页面，取得两样东西：
   - `Set-Cookie`（会话 Cookie，**取链必须携带**）；
   - `window.appData.play_id` —— 服务端下发的 Laravel 加密令牌（base64）。
2. `POST /member/common-play-url` `{ id: play_id }`（携带步骤 1 的 Cookie + Referer）
   → 返回 `{ code:1, data:{ url: <可播直链> } }`。
   > 若不携带 Cookie，接口返回 `code:0` 取链失败。
3. 直链为**酷我 CDN**（`kw-er.kuwo.cn/.../*.mp3`，`audio/mpeg`，支持 Range），实测可直接流式播放。

搜索 / 榜单 / 歌单列表页结构一致，均解析 `<a href="/music/{id}" title="{标题} - {歌手}">`。

## 安装方法

### 方式一：从 URL 安装（推荐，支持更新）
1. 复制以下 raw 链接：
   ```
   https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@main/musicfree-gequbao/gequbao.js
   ```
2. MusicFree → 插件管理 → 从 URL 安装 → 粘贴该链接即可。

> 说明：统一使用 `jsDelivr` 零跳转直链，桌面端与移动端均可稳定加载（`gitee.com/.../raw/` 形式在部分移动端不跟随 302 跳转，可能安装失败）。

### 方式二：本地加载（开发调试）
- 直接用支持的本地插件加载方式指向本目录的 `gequbao.js`。

## 已知限制

1. **部分歌曲需人机验证 / 仅试听**：服务端对部分歌曲（触发 `should_verify` 或 `mp3_type=1`）要求人机验证或仅提供约 30s 试听片段，插件无法代解验证码，此类歌曲取链会失败或仅返回片段（best-effort 返回直链）。
2. **直链有时效**：酷我 CDN 链接含临时签名路径，建议实时获取后播放。
3. **搜索不翻页**：站点 `?page=` 参数无效，搜索结果单页返回，恒 `isEnd=true`。

## 文件说明

- `gequbao.js` — 插件主文件（交付物）
- `publish_gitee.cjs` — 推送至 Gitee 的发布脚本（开发用）
