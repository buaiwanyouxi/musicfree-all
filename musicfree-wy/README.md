# 网易云音乐音源插件（wy.js）使用说明

> **平台**：网易云音乐 ｜ **版本**：v0.1.14 ｜ **作者**：tianpeng + 优化(下沉 qq.js v0.1.8 三态校验)
> **适配**：[MusicFree](https://github.com/maotoumao/MusicFree) 桌面端 / 移动端

---

## 一、插件定位

将「网易云音乐」作为一个独立音源接入 MusicFree，实现搜索、歌词、取链、歌单导入、热门歌单、官方排行榜等完整能力。

**全部接口均经真实网络探测验证，且为免加密的官方 `/api/` 接口**（与官方取链失效的酷我不同，网易云旧版 `/api/` 仍可免加密调用，无需 crypto-js / weapi，更稳更可移植）：

| 能力 | 接口 |
|------|------|
| 搜索 | `/api/search/get/web`（type: 1=单曲, 1000=歌单） |
| 取链 | `/api/song/enhance/player/url`（返回 `m*.music.126.net` 直链） |
| 歌词 | `/api/song/lyric`（lv/kv/tv=-1，返回 lrc + tlyric） |
| 歌单详情 | `/api/playlist/detail`（tracks 前 100 首，trackIds 含全量） |
| 歌单全量曲目 | `/api/song/detail`（按 trackIds 分批 200 取完整曲目，支持大歌单） |
| 排行榜列表 | `/api/toplist/detail`（63 个榜单定义，带 id/封面） |
| 热门歌单标签 | `/api/playlist/highquality/tags` |
| 热门/分类歌单 | `/api/playlist/highquality/list`（cat=分类名） |

### 取链兜底策略（十三层兜底链）

网易云免费曲优先用官方直链（最高音质）；**VIP / 付费曲目免费态仅返回约 30 秒试听片段**（版权限制），插件自动改用十三层备用兜底链（全程三态身份校验，无安全候选即拒绝错播，最大化「有歌可播」且防错播）：

1. **【①】无名音乐网 mvmp3.com**：自动完成「我不是人机」验证并缓存 50 分钟，无需手动操作；
2. **【②】歌曲宝 gequbao.com**：无需验证（当前接口 `/search-fallback` + JWT `play_id` + `purpose=play`），作为 mvmp3 自动过验证偶发失败时的自动兜底；
3. **【③】无忧音乐网 qeecc.com**：自动过验证 + 会话缓存 50 分钟，返回酷我 CDN 直链；
4. **【④】歌曲海 gequhai.com**：`play_id` + 会话 cookie 取酷我直链；
5. **【⑤】歌曲客 gequke.com**：同歌曲海基线（`/song/` 路径）取酷我直链；
6. **【⑥】凤梨音乐 flmp3.pro**：酷我 CDN 直链；
7. **【⑦】溜声音乐 6sing.top**：酷我 CDN 直链（http 站点）；
8. **【⑧】GD音乐台 gdstudio**：免登录聚合 API（网易云 / Joox）；
9. **【⑨】MyFreeMP3**：网易云后端，列表自带直链 + 歌词；
10. **【⑩】我要下歌 xiage**：Tonzhon 源，网易云直链；
11. **【⑪】音乐搜索神器 lmb520**：netease / qq / kugou / kuwo 多平台聚合；
12. **【⑫】小蜜蜂 xmfwav / 音微 yinwe**：独立站同名替身（跨平台通用）；
13. **【⑬】布谷音乐 buguyy.top**：直连真实 API（不继承其官方 BASE 误写 jsdelivr 的既有 bug），返回媒体不带 Referer（规避酷我 CDN 403），作为前十二层均失败时的极端末位兜底。

> 参考 `kugou_mvmp3.js` 思路实现；酷我系 5 源（③④⑤⑥⑦）为主力兜底，aax 实测 0 结果暂不接入。会员 Cookie 可让官方 VIP 曲返回完整链（最高音质）。

---

## 二、支持功能

| 功能 | 方法 | 说明 |
|------|------|------|
| 搜索 | `search` | 单曲 / 歌单（music/sheet） |
| 播放取链 | `getMediaSource` | 官方直链 + 十三层备用兜底链 |
| 歌词 | `getLyric` | 官方 + 备用源兜底（含 MyFreeMP3 / 音乐搜索神器歌词） |
| 排行榜 | `getTopLists` / `getTopListDetail` | 官方 63 个榜单 |
| 热门歌单 | `getRecommendSheetTags` / `getRecommendSheetsByTag` | 精选/分类歌单（highquality） |
| 歌单导入 | `importMusicSheet` | 粘贴网易云歌单链接/ID |
| 歌单详情 | `getMusicSheetInfo` | 分批拉全量曲目，支持大歌单 |

### 歌单导入格式

- 网易云 APP：歌单 → 分享 → 复制链接，直接粘贴即可；
- 支持 `https://music.163.com/playlist?id=123456` 或直接输入纯数字歌单 ID；
- 导入时间与歌单大小有关，请耐心等待。

---

## 三、所需配置（可选）

| 配置项 key | 名称 | 必填 | 说明 |
|------------|------|------|------|
| `cookie` | Cookie（可选） | 否 | 登录 `music.163.com` 后从浏览器开发者工具复制 Cookie 填入，可让官方 VIP 曲目返回完整链（最高音质）。 |
| `mvmp3_cookie` | 无名音乐网 Cookie (PHPSESSID)（可选） | 否 | 通常**无需填写**。插件会自动完成人机验证并缓存 50 分钟。仅当你想固定使用自己浏览器会话时才填。 |

> 不填 Cookie 也能正常搜索、播放免费曲、浏览榜单/歌单。

---

## 四、安装方法

MusicFree →「设置」→「插件设置」→「从网络安装插件」→ 填入本插件源码直链（gitee 发布后提供），或本地「从文件安装」选择 `wy.js`。

---

## 五、已知限制

1. **VIP / 付费曲试听限制**：免费态下官方仅返回约 30 秒试听片段，插件自动转 mvmp3 / gequbao / buguyy 三层兜底；若提示「无名音乐网验证失败」，多为该站临时升级人机验证，稍后重试即可，歌曲宝会作为自动兜底，布谷音乐作为最后兜底。
2. **大歌单分批**：歌单详情按 trackIds 分批 200 拉取，超大歌单加载稍慢，属正常。

---

*本插件仅供个人学习与技术研究，音频内容版权归网易云音乐及各权利人所有。*
