# 布谷音乐 MusicFree 插件 (buguyy.js)

将 [布谷音乐](https://www.buguyy.top)（在线音乐试听与无损音乐下载平台）适配为 MusicFree 插件。
数据源为布谷镜像（酷我曲库子集）并直连酷我 Web 接口补齐曲库，音频为酷我 CDN 直链，无需登录、无需 Cookie。

- **作者**：tianpeng
- **版本**：0.0.4
- **支持搜索类型**：music（歌曲）

## 已实现功能

| 功能 | 方法 | 说明 |
|------|------|------|
| 搜索 | `search` | 布谷镜像 `/api/search`，按标题，单次最多 50 条（接口不翻页） |
| 播放 | `getMediaSource` | 源链：布谷镜像 geturl → 酷我直连兜底（见下节） |
| 歌词 | `getLyric` | 布谷镜像 LRC；跨源歌曲经搜索匹配 `about` 兜底 |
| 排行榜 | `getTopLists` / `getTopListDetail` | 布谷热歌/新歌/随机 + 音乐串烧 + **网易云 7 / QQ 30 / 酷我 6 / 酷狗 33 官方榜**（均支持翻页） |
| 热门歌单 | `getRecommendSheetTags` / `getRecommendSheetsByTag` / `getMusicSheetInfo` | 网易云/酷我 推荐歌单（含详情）；QQ/酷狗 平台歌单需登录态，**以 30/33 个官方榜代替提供** |
| 元数据 | `getMusicInfo` | 网易云单曲时长/歌手/专辑/封面补齐（SSR ld+json） |

### 播放源链（getMediaSource）

1. **布谷镜像**：`GET /api/geturl?id=`（原生歌曲直取；跨源歌曲先 `/api/search` 定位镜像 id 再取链）；
2. **酷我直连兜底**（镜像未收录的歌曲）：
   - 酷我歌曲 → `GET www.kuwo.cn/api/v1/www/music/playUrl?mid=<rid>&type=music` 直连；
   - 其他歌曲 → 酷我搜索定位 rid（纯标题 → 标题+歌手 两轮，全角括号归一化，打分防错配）；
   - 搜索命中常为 VIP 版本时（playUrl 返回付费提示），**自动尝试下一候选版本**直至取到可播免费链接；
3. 全部失败（VIP 付费 / 酷我也未收录）→ 抛出「未找到可播放音源（可能为付费内容或未收录）」。

## 接口分析结论（基于浏览器实际观察）

- 布谷站点为 Nuxt 3 SPA，API 基址 `/api/`；歌曲 `id` 为 base64 编码数字（即酷我 rid）。
- 播放直链 `https://car-*.kuwo.cn/.../M800xxxx.mp3`：带不带 Referer 均可访问；`/api/getdown` 为夸克网盘分享链接，不接入播放。
- **酷我直连接口**（前端 bundle 挖掘）：`playUrl?mid=<rid>`（参数名 mid，实传 rid 整数）、`musicInfo?mid=<rid>`；搜索接口 `searchMusicBykeyWord` **关键词参数名为 `all`**，仅需 UA + Referer（无需 Cookie/Secret）。
- **酷我榜单/歌单**：`/api/www/bang/bang/musicList`（20 首/页，需 Secret 签名 + 随机 32 位 hex cookie，算法已移植）+ 官网 SSR（NUXT 载荷，自研免 eval 解析器）。
- **QQ 榜**：`/n/ryqq_v2/toplist/<topId>` SSR（20 首/页，INITIAL_DATA 需将 `:undefined` 替换为 `:null` 再 JSON.parse）。
- **酷狗榜**：`/yy/rank/home/<page>-<rankId>.html` SSR（22 首/页，TOP500 可翻 23 页）。
- **登录墙**：QQ/酷狗 平台自有歌单为 SPA 无匿名数据请求（`musicu.fcg` 匿名返回 `860100001`），故热门歌单以官方榜代替。

## 安装方法

### 方式一：从 URL 安装（推荐，支持更新）
1. 复制 raw 链接：`https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-buguyy/buguyy.js`
2. 在 MusicFree 中「插件管理 → 从 URL 安装」，粘贴该链接即可。

### 方式二：本地加载（开发调试）
- 直接用支持的本地插件加载方式指向本目录的 `buguyy.js`。

## 本地测试

```bash
node test-plugin.mjs
```

会依次验证 search / getMediaSource / getLyric / getTopLists / getTopListDetail，并打印音频直链可访问性。

## 已知限制

1. **VIP/付费歌曲无法播放**：酷我 `playUrl` 返回付费提示，插件提示「未找到可播放音源」；
2. **geturl 限流**：布谷镜像 `geturl` 接口对短时大量请求限流（返回「请求过于频繁」），插件按单次播放取链，正常使用不受影响；
3. **QQ/酷狗 平台自有歌单**（非官方榜）需登录态，匿名无法获取歌曲列表；
4. **搜索不翻页**：接口单次最多约 50 条；
5. **网易云普通歌单** SSR 仅取前 10 首（官方榜为全量 200 首）；
6. **部分歌曲无歌词**：镜像无 LRC 时返回空歌词；
7. **汽水音乐**无公开 Web 数据源，未接入。

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.0.1 | 2026-08-21 | 初版：搜索/播放/歌词/热歌榜/新歌榜 |
| 0.0.2 | 2026-08-25 | 新增随机推荐/音乐串烧榜（分页）、歌词 geturl 回退、排除不可用全网源 |
| 0.0.3 | 2026-08-25 | 新增网易云 7 / QQ 30 / 酷我 / 酷狗 33 官方排行榜 + 四平台热门歌单；跨源播放兜底（布谷搜索→geturl）；酷我榜 Secret API；汽水音乐无公开数据源未接入 |
| 0.0.4 | 2026-08-26 | 修复：QQ/酷狗热门歌单无内容（改用官方榜提供）；榜/歌单大部分歌曲无法播放（酷我直连 playUrl + 搜索定位 rid + 候选版本轮换规避 VIP 命中）；标题全角括号归一化提升匹配率 |

## 文件说明

- `buguyy.js` — 插件主文件（交付物）
- `test-plugin.mjs` — 本地测试脚本
- `package.json` — 本地开发依赖声明（axios，仅测试用；插件运行在 MusicFree 沙箱中自带 axios）
