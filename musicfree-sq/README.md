# 音乐搜索神器（MusicFree 音源插件）

多平台聚合音乐搜索音源，后端为 [music.lmb520.cn](https://music.lmb520.cn/)（基于 maicong/music）。

支持平台：网易云 / QQ / 酷狗 / 酷我 / 百度 / 一听 / 咪咕 / 荔枝 / 蜻蜓 / 喜马拉雅 / 5sing（原唱/翻唱）。

## 功能
- 搜索（跨平台并发、合并去重）
- 播放取链（按歌曲 ID 回查）
- 歌词

## 说明
- 免登录；部分平台（qq / kugou / 1ting / migu / ximalaya / kg）可能需 Cookie 或上游临时不可用，插件会自动忽略失败平台、合并其余可用结果。
- 发布版位于 `github/`（GitHub raw）与 `gitee/`（Gitee raw）子目录。
