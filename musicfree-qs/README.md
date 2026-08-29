# 汽水音乐音源插件（qs.js）使用说明

> **平台**：汽水音乐（字节系 Qishui / Luna）｜ **版本**：v0.0.1 ｜ **作者**：tianpeng
> **适配**：[MusicFree](https://github.com/maotoumao/MusicFree) 桌面端 / 移动端

---

## 一、插件定位

将「汽水音乐」作为一个独立音源接入 MusicFree。**汽水音乐为字节私有加密 API（社区公认难度最高）**，本插件通过实测定位出可**免签**调用的接口集合，覆盖搜索、取链、歌词、排行榜、歌单导入。

接口契约（经真实请求验证）：

| 能力 | 接口 |
|------|------|
| 搜索 | `GET api-vehicle.volcengine.com/v2/search/type` |
| 歌曲 / 歌词 | `GET api-vehicle.volcengine.com/v2/custom/contents` |
| 取链（两步） | `GET beta-luna.douyin.com/luna/h5/seo_track` → `track_player.url_player_info`(GetPlayInfo) / `video_model.main_url` |
| 排行榜详情 | `GET api5-lf.qishui.com/luna/charts/<id>?charge=0` |
| 歌单详情 | `POST api5-lf.qishui.com/luna/playlist/detail?charge=0`（body: playlist_id） |
| 热门歌单 | `POST api5-lq.qishui.com/luna/discover/mix?charge=0`（需原生签名） |

> 注意：歌单详情用开放子域 `lf`（参考插件用的 `lq` 被墙返回空）；热门歌单 `discover/mix` 用 `lq` 且需汽水 App 原生签名。

---

## 二、支持功能

| 功能 | 方法 | 说明 |
|------|------|------|
| 搜索 | `search` | 仅单曲（music） |
| 播放取链 | `getMediaSource` | 两步：seo_track → 取 `url_player_info` / `main_url` |
| 单曲信息 | `getMusicInfo` | 标题/歌手/专辑/封面 |
| 歌词 | `getLyric` | `custom/contents` 内嵌歌词 |
| 排行榜 | `getTopLists` / `getTopListDetail` | 热歌榜 / 新歌榜 / 欧美榜 / 音乐人歌曲榜 等 |
| 热门歌单 | `getRecommendSheetTags` / `getRecommendSheetsByTag` | 每日推荐/流行/华语/欧美/国风/民谣… 分类标签 |
| 歌单导入 | `importMusicSheet` | 粘贴汽水歌单链接/ID |
| 歌单详情 | `getMusicSheetInfo` | 点进歌单后的歌曲列表 |

### 歌单导入格式

- 汽水 APP：歌单 → 分享 → 分享链接；手动访问链接后再复制链接粘贴即可；
- 网页：复制 URL 并粘贴，或直接输入纯数字歌单 ID；
- 导入时间与歌单大小有关，请耐心等待。

---

## 三、所需配置（可选）

| 配置项 key | 名称 | 必填 | 说明 |
|------------|------|------|------|
| `cookie` | Cookie（可选） | 否 | 汽水音乐/抖音登录后的会话 Cookie。填入后**可能**解锁「按标签热门歌单」等需签名的接口；歌单导入与取链通常无需 Cookie。 |

---

## 四、安装方法

MusicFree →「设置」→「插件设置」→「从网络安装插件」→ 填入本插件源码直链（gitee 发布后提供），或本地「从文件安装」选择 `qs.js`。

---

## 五、已知限制

1. **按标签热门歌单依赖原生签名**：汽水 `discover/mix`（按标签取热门歌单）接口需汽水 App 原生签名（X-Gorgon / X-Argus）。plain 客户端无签时该接口返回空——插件**不崩溃、返回空列表**，不影响其他功能。填入汽水会话 Cookie 可能解锁，但不保证（签名算法在客户端侧）。
2. **取链为两步跳转**：先请求 `seo_track` 再解析播放地址，较官方直链多一次往返；若上游调整字段名，取链可能失败。
3. **搜索仅单曲**：当前 `supportedSearchType` 仅 `music`，未做专辑/歌手搜索。

---

*本插件仅供个人学习与技术研究，音频内容版权归汽水音乐/字节跳动及各权利人所有。*
