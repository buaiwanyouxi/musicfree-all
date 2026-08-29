# 酷我音源插件（kw.js）使用说明

> **平台**：酷我 ｜ **版本**：v0.0.1 ｜ **作者**：tianpeng
> **适配**：[MusicFree](https://github.com/maotoumao/MusicFree) 桌面端 / 移动端

---

## 一、插件定位

将「酷我」作为一个独立音源接入 MusicFree，实现搜索、取链、歌词、专辑、歌手、歌单导入、热门歌单、官方排行榜等完整能力。

**取链方式**：使用第三方社区代理 `music.nxinxz.com/kw.php`，该代理返回**酷我真实音频流**。

> 说明：酷我官方免费 `antiserver` 接口实测对**任一 rid 均返回同一首歌**，已不可用；故本插件取链统一走社区代理。

所有接口均经**真实网络探测**验证（非盲猜）：

| 能力 | 接口 |
|------|------|
| 搜索 | `search.kuwo.cn/r.s`（ft=music/album/artist/sheet） |
| 取链 | `music.nxinxz.com/kw.php`（返回酷我真实音频流） |
| 歌词 | `m.kuwo.cn/newh5/singles/songinfoandlrc` |
| 排行榜列表 | `wapi.kuwo.cn/api/pc/bang/list`（5 组数十个榜单） |
| 榜单详情 | `kbangserver.kuwo.cn/ksong.s` |
| 热门歌单标签 | `wapi.kuwo.cn/api/pc/classify/playlist/getTagList` |
| 热门/标签歌单 | `wapi.kuwo.cn/.../getRcmPlayList`（推荐/热门）、`getTagPlayList`（按标签） |
| 歌单歌曲 | `nplserver.kuwo.cn/pl.svc`（op=getlistinfo，返回键为 `musiclist` 小写） |

---

## 二、支持功能

| 功能 | 方法 | 说明 |
|------|------|------|
| 搜索 | `search` | 支持 单曲 / 专辑 / 歌单 / 歌手（music/album/sheet/artist） |
| 播放取链 | `getMediaSource` | 社区代理 `music.nxinxz.com/kw.php`，按音质档位传 `level` |
| 单曲信息 | `getMusicInfo` | 时长/歌手/专辑/封面补齐 |
| 专辑信息 | `getAlbumInfo` | 专辑曲目列表 |
| 歌词 | `getLyric` | `m.kuwo.cn` 歌词接口 |
| 歌手作品 | `getArtistWorks` | 歌手单曲 / 专辑列表 |
| 排行榜 | `getTopLists` / `getTopListDetail` | 5 组共数十个官方榜单 |
| 歌单导入 | `importMusicSheet` | 粘贴酷我歌单链接/ID |
| 热门歌单 | `getRecommendSheetTags` / `getRecommendSheetsByTag` | 按标签分类浏览 |
| 歌单详情 | `getMusicSheetInfo` | 点进歌单后的歌曲列表 |

### 音质映射

插件档位 → 代理 `level` 参数：`low→128k`、`standard→320k`、`high→flac`、`super→flac`。

### 歌单导入格式

- 酷我 APP：自建歌单 → 分享 → 复制试听链接，直接粘贴即可；
- H5：复制 URL 并粘贴，或直接输入纯数字歌单 ID；
- 导入时间与歌单大小有关，请耐心等待。

---

## 三、所需配置

**本插件无需任何 Cookie / 用户变量**，安装即用。

---

## 四、安装方法

MusicFree →「设置」→「插件设置」→「从网络安装插件」→ 填入本插件源码直链（gitee 发布后提供），或本地「从文件安装」选择 `kw.js`。

---

## 五、已知限制

1. **取链依赖社区代理**：播放完全依赖 `music.nxinxz.com` 代理可用性。若该代理临时不可用，歌曲会取链失败；这是上游代理稳定性问题，非插件缺陷。
2. **酷我官方取链失效**：官方免费 `antiserver` 接口已不可用（任一 rid 返回同一首歌），故未采用官方直链。
3. **歌单接口键名差异**：`nplserver.kuwo.cn/pl.svc` 返回歌曲列表键为小写 `musiclist`，插件已适配；若上游改动字段，歌单详情可能为空。

---

*本插件仅供个人学习与技术研究，音频内容版权归酷我及各权利人所有。*
