# MusicFree 音源插件 - 汽水音乐

## 简介
汽水音乐音源（抖音系接口，双域名互备）。

> 当前版本：v0.0.7 ｜ 作者：tianpeng

## 安装方式
### 方式一：订阅源安装（推荐）
将以下 URL 添加到 MusicFree 订阅源：
https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-qs/gitee/qs.js

### 方式二：本地安装
下载 `qs.js` 文件，在 MusicFree 中手动导入。

## 更新日志
- v0.0.7 (2026-11-16)：短片段防护补字节闸门兜底：资产时长元数据缺失（durSec=0）时按总字节判片段（<期望时长×2000B），与 qq/kg/kw/wy 同口径
- v0.0.6 (2026-11-16)：修复热门歌单空白：discover/mix 改网页 UA 免签请求（伪造 X-Argus/App UA 会被静默清空）+ inner_block/entity.playlist 结构解析 + 分页
### 0.0.1 (2026-09-23)
- 发布版，包含完整插件逻辑（单文件、无外部依赖）
- 支持搜索、播放、歌单等功能

## 依赖说明
- 无需额外依赖（所有逻辑已内联）
- 需要 Cookie（可选）（如需要）

## 合规声明
本插件仅供个人学习研究使用，请勿用于商业用途。
