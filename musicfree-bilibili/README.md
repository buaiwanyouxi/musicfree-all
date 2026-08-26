# MusicFree 插件：哔哩哔哩（B站）音频源

把哔哩哔哩当成**音乐库**来用：登录后你的 **个人收藏夹**直接变成 MusicFree 的歌单，多分 P 的「歌单合集视频」可**一键拉取全部分集**生成歌单，所有内容以**纯音频模式**后台播放。

> ⚠️ 仅供个人学习研究使用，请遵守 B站服务条款。插件仅作播放器，不存储任何视频/音频文件。

## 安装链接（从 URL 安装）

```
https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-bilibili/bilibili.plugin.js
```

MusicFree → 侧边栏「设置」→「插件设置」→「从网络安装插件」→ 粘贴上方链接 → 安装完成后点击插件「配置」填入 `SESSDATA`。

> 也可用 `https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-bilibili/bilibili.plugin.js`，该地址会 302 跳转到上方直链，实测同样可安装，但直链零跳转更稳。

## 核心特性

| 特性 | 说明 |
|------|------|
| **支持用户 SESSDATA 登录** | 通过插件设置项 `SESSDATA` 填入登录凭证（也可整段粘贴 Cookie，插件自动提取），凭证仅保存在本地应用内，不写死于代码 |
| **支持畅听个人收藏夹** | 登录后自动列出你名下**全部收藏夹**并映射为歌单，逐页加载、点开即听；收藏夹内的多 P 视频会自动展开为独立音轨 |
| **支持拉取全部分 P 添加歌单** | 粘贴任意 B站 视频链接即可把它的**所有分 P 逐集展开**为一个歌单。实测 `BV1oLBXBiEW5`（100 个分集的无损歌单合集）→ 导入后得到 100 首独立可播音轨，标题自动带「P序号 + 分集名」 |
| **四大榜单开箱可用** | 入站必刷、每周必刷、各分区排行榜（音乐/翻唱/演奏/动画/游戏…共 21 个分区）、我的收藏夹 |
| **纯音频播放 + 多音质** | 从 DASH 流中提取音频轨，按 MusicFree 音质档位（低/标准/高/超高）自动选择码率，不下载视频画面，省流量 |
| **视频搜索** | 内置 WBI 签名，可直接在 MusicFree 搜索框检索 B站 视频并播放 |
| **免登录也能用** | 不填 SESSDATA 时「每周必刷 / 各分区排行榜」照常浏览播放；填了才额外解锁「我的收藏夹 / 入站必刷」 |
| **移动端兼容** | 全程避开 async 箭头函数（安卓 Hermes 引擎不支持），播放头精简以规避 CDN 拦截，安卓/桌面双端可用 |

### 近期修复

- **v1.1.4（收藏夹加载失败 + 多P视频导入）**：
  1. **收藏夹加载失败根因修复**：`getFavoriteFolders` 旧实现强制对 `list-all` 做 WBI 签名（nav 取密钥 + md5 + 签名请求），并在仅粘贴 SESSDATA（无 `DedeUserID`）时回退调用 `getUserInfo`(myinfo) 取 mid。该路径在数据中心沙箱正常、却在真实手机端（Hermes 引擎 + 真实网络）易失败——myinfo 异常会致 mid 为空、`list-all` 不带 `up_mid` 直接返回 `-400`；WBI 签名本身也对设备端不友好。现**彻底去除 list-all 的 WBI 签名**（已实测签名/不签名均返回 16 项），并改用更可靠的 `nav` 直接取 `mid`，同时保留 `DedeUserID` 优先解析。收藏夹列表接口本就无需签名，与社区成熟实现一致。
  2. **多P视频导入为歌单（新增）**：`importMusicSheet` 现优先识别视频链接（含 `BV` 号），通过 `/x/web-interface/view` 拉取全部分P，**逐集展开为独立音轨**（标题含「P序号 + 分集名」），如 `BV1oLBXBiEW5`（100 个分P）导入后形成 100 首的歌单，每首可独立播放。
- **v1.1.3（收藏夹加载/导入修复）**：学习 `nainoz_naa/other` 哔哩哔哩.js（sinmite）对齐成熟实现。① 收藏夹视频请求 `/x/v3/fav/resource/list` **去除 WBI 签名与多余参数 `order/type/tid`**，仅保留 `media_id+platform:web+分页`（签名/多余参数在某些设备端更易触发风控失败，是该插件能稳定工作的关键差异）；② `getTopLists` 收藏夹分组**失败不再静默空列表**，改为返回可见的「⚠️ 收藏夹加载失败：<原因>」提示项（根因多为 SESSDATA 失效/未填写）；③ `importMusicSheet` 去除对 `getFavoriteFolders` 的强依赖，并**新增支持直接输入收藏夹数字 ID** 导入，私密/空收藏夹给出明确提示。
- **v1.1.2（播放仍失败，关键修复）**：参考成熟可用的第三方插件，重写播放链路。根因——`getMediaSource` 返回的播放头带 `Origin: https://www.bilibili.com`，移动端播放器（ExoPlayer/AVPlayer）将该头转发给音频 CDN 后被拦截（403），表现为「能拿到地址却放不出声」。`playurl` 请求也改为**不携带任何 Cookie / buvid / Origin**，仅取 DASH 音频流（`fnval=16`），与已验证可用的实现对齐；返回头仅保留 `Referer: 视频页` + `User-Agent`。
- **v1.1.1**：收藏夹接口参数名 `mid`→`up_mid`（修复 `-400` 静默吞掉）；`playurl` 去除 buvid 规避 HTTP 412。
- **v1.1.0**：新增入站必刷/每周必刷/各分区排行榜/收藏夹四大板块；搜索补 WBI 签名。

---

## 一、功能清单

| 功能 | 对应接口 | 说明 |
|------|----------|------|
| 登录认证 | `userVariables.SESSDATA` | 在插件设置中填入 SESSDATA Cookie（可选，详见下方） |
| 榜单·入站必刷 | `getTopLists` / `getTopListDetail` | 个性化推荐（需登录） |
| 榜单·每周必刷 | `getTopLists` / `getTopListDetail` | 每周必看系列（公开，匿名可浏览列表） |
| 榜单·各分区排行榜 | `getTopLists` / `getTopListDetail` | 音乐/动画/游戏…等 20+ 分区（公开，匿名可访问） |
| 榜单·我的收藏夹 | `getTopLists` / `getMusicSheetInfo` | 当前登录用户全部收藏夹（需登录） |
| 歌单详情 | `getMusicSheetInfo` / `getTopListDetail` | 返回视频列表，支持分页 |
| 音频播放 | `getMediaSource` | 从 DASH 流中提取音频（按音质挑选） |
| 分P支持 | `expandMedia` | 每个分P作为独立音轨 |
| 单曲补全 | `getMusicInfo` | 获取视频详细信息 |
| 视频搜索 | `search` | 搜索 B站 视频（WBI 签名，见下方说明） |
| 链接导入 | `importMusicSheet` | 支持收藏夹 URL、收藏夹数字 ID、**视频链接（多P逐集展开为歌单）** |

---

## 二、安装步骤

**方式一：从网络安装（推荐）**

1. MusicFree →「设置」→「插件设置」→「从网络安装插件」。
2. 粘贴：`https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-bilibili/bilibili.plugin.js`
3. 安装后在插件列表找到「Bilibili」→「配置」→ 填入 SESSDATA（见下一节）。
4. 刷新插件，进入「榜单」即可看到「我的收藏夹」。

**方式二：从本地文件安装**

下载 `bilibili.plugin.js` 后，选择「从本地文件安装插件」并指向该文件，后续步骤同上。

> 插件已内置 `srcUrl` 指向本仓库 raw 直链，后续可在 MusicFree 内直接「更新插件」获取新版本。

---

## 三、如何获取 SESSDATA

1. 电脑浏览器登录 [bilibili.com](https://www.bilibili.com)。
2. 按 `F12` 打开开发者工具 → `Application`（应用）标签 → 左侧 `Cookies` → `https://www.bilibili.com`。
3. 找到名为 `SESSDATA` 的条目，复制其 **Value**。
4. 也可以直接复制整个 Cookie 字符串粘贴进插件配置（插件会自动识别）。

> 🔒 SESSDATA 是敏感凭证，会随登录态过期，请定期更新；切勿分享给他人。

---

## 四、验收对照

| 场景 | 预期 |
|------|------|
| 未配置 Cookie | 「每周必刷 / 各分区排行榜」仍可见并可播放；「我的收藏夹 / 入站必刷」为空或提示需登录 |
| 配置正确 SESSDATA | 四大板块全部可用：入站必刷、每周必刷、各分区排行榜、我的收藏夹 |
| 配置错误/过期 | 收藏夹与个性化榜单提示「认证失败/触发风控，请检查 SESSDATA」|
| 点击分区排行榜 | 显示该分区 Top 视频（标题/UP主/时长/封面）|
| 点击收藏夹 | 显示该收藏夹视频列表（标题/UP主/时长/封面）|
| 点击视频 | 提取音频流播放（无画面）|
| 分P视频 | 每个分P可独立选择播放 |
| 视频链接导入 | 粘贴如 `https://www.bilibili.com/video/BV1oLBXBiEW5` 的多P视频，自动展开为包含全部分集的歌单 |
| 空收藏夹 | 显示空列表 |
| 私密收藏夹 | 提示「无法访问私密收藏夹」|

---

## 五、技术说明

- **单文件 CommonJS**：仅依赖 MusicFree 沙箱内置 `axios`，未使用 Parcel/TypeScript 打包，规避安卓 Hermes 引擎兼容问题。
- **Cookie 安全**：SESSDATA 通过 `userVariables` 在应用内填写，不写死在代码中。
- **音频时效**：播放地址实时获取，`cacheControl: no-store`。
- **合规**：仅播放、不存储；搜索与播放均携带 Referer/UA 以通过 B站 基础风控。

---

## 六、已知限制 / 待补完

1. **登录态与公开榜单**：「每周必刷 / 各分区排行榜」为公开接口，未登录（无 SESSDATA）也可浏览与播放；「入站必刷 / 我的收藏夹」需登录态，未登录时会优雅降级（为空或提示填写 Cookie），不会崩溃。部分数据中心 IP 访问个性化榜单可能触发 B站 `-352` 风控，属平台侧限制，使用本机网络 + 有效 SESSDATA 即可正常。
2. **搜索接口（WBI 签名）**：搜索已使用 `/x/web-interface/search/type` + WBI 签名（`w_rid`），可规避 `-412` 风控；匿名时仍可能受频控返回较少结果，登录后更稳定。
3. **会员/地区限制视频**：部分视频需大会员，播放时返回明确错误提示，无法绕过。
4. **分P展开的网络开销**：多P视频在展开时会额外请求 `view` 接口；普通收藏夹多为单P，影响可控。
5. **视频链接导入**：`importMusicSheet` 现支持直接粘贴 B站 视频页链接（含 `BV` 号），自动读取全部分P并逐集生成音轨；单P视频导入为单首，多P视频（如 100 集歌单）导入为完整歌单。注意收藏夹内的多P视频由 `expandMedia` 负责展开（依赖 `resource/list` 返回的 `cnt` 字段）。
5. **Buvid 指纹**：为降低匿名风控概率，插件会自动请求 `/x/frontend/finger/spi` 获取 `buvid3/4` 指纹并缓存 24h（参考社区成熟实现），与用户 Cookie 互不冲突。**注意**：`playurl`（取音频地址）请求与返回给播放器的头均**不携带 buvid / Origin**，否则会被 B站 拦截（412 / 403）。

---

## 七、本地测试（可选）

`test-plugin.js` 可在 Node.js 下模拟 `env` 验证各方法（不依赖 MusicFree）：

```bash
cd projects/musicfree-bilibili
npm install axios        # 仅本地测试需要，插件本身不依赖
export BILI_COOKIE="SESSDATA=你的SESSDATA值"   # 或粘贴完整 Cookie
node test-plugin.js
```

脚本会从环境变量读取 Cookie，逐项测试 `getTopLists` / `getMusicSheetInfo` / `getMediaSource` / `search`。

---

## 八、发布与更新

本插件发布于 Gitee：<https://gitee.com/koujiao/musicfree-tianpeng>（目录 `musicfree-bilibili/`）。

- raw 直链：`https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-bilibili/bilibili.plugin.js`
- 该直链已写入插件 `srcUrl` 字段，用户在 MusicFree 内「更新插件」即可拉取新版本。
- 维护者更新流程：修改 `bilibili.plugin.js` → 提升 `version` → 推送至上述仓库路径。
