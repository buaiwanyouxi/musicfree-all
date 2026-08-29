/*
 * MusicFree 插件 —— 哔哩哔哩（B站）音频源（优化版）
 * ============================================================================
 * 本文件在 martin65536/bilibili-musicfree@bilibili.js（v0.6.1）基础上，
 * 依据本地成熟插件 musicfree-bilibili/bilibili.plugin.js（v1.1.5）做了「功能并集」优化：
 *
 * 【保留自 bili.js 的原功能】
 *   • 搜索（视频/专辑/UP主），结果自带播放量/点赞/收藏/弹幕/评论数
 *   • 双语字幕作为歌词（rawLrc 中文 + translation 英文），需登录
 *   • 评论分页（无限滚动）+ 首条自动插入视频简介
 *   • UP主作品（WBI 签名）
 *   • 专辑名自定义模板（{bvid}{date}{playCount}…）
 *   • 自定义 User-Agent
 *   • 多音质映射（low/standard/high/super，码率升序精准选取）
 *
 * 【注入自本地插件的增强】
 *   • 移动端兼容架构：IIFE 包裹 + reqFn 获取 axios（兼容 PC/移动端加载器），
 *     纯 JS 实现 md5/HMAC 替代 crypto-js，避免移动端 Hermes 顶层抛错导致插件无法加载
 *   • SESSDATA 自动提取：支持「仅值 / 标准 Cookie / 冒号格式」三种粘贴方式，并自动 URL 解码
 *   • 「我的收藏夹」板块：登录后自动列出名下全部收藏夹并映射为歌单
 *   • 多 P 分集展开：粘贴视频链接即把每 P 展开为独立音轨（标题带 P序号+分集名）
 *   • 21 个分区排行榜（比 bili.js 原 19 个新增「翻唱」「演奏」）
 *   • 移动端安全播放头：playurl 请求不挂 Cookie/buvid/Origin，CDN 返回头仅 Referer+UA，
 *     规避 B站 412 / 移动端转发 Origin 触发的 403（取得到地址却放不出声）
 *   • buvid 指纹缓存 24h（缓解匿名风控）
 *
 * 所有接口地址均来自对 B站页面的直接观察，未做任何网络搜索猜测。
 */

/*
 * ============================================================================
 * 【版本与作者】
 *   author : tianpeng
 *   version: V0.0.7
 *
 * 【关键修复说明（V0.0.6 → V0.0.7）】
 *   症状：收藏夹✓、播放✓，但 BV16ahK6eE21 等「网页端明明有 AI 字幕」的视频在插件上不显示。
 *   真实根因（与 musicfree-bili「确能看歌词」版本逐行对比后定位）：
 *   ① V0.0.6 只调 /x/player/wbi/v2 且请求里塞了 dm_img_str/dm_cover_img_str/dm_img_inter
 *      风控参数——这些 JSON/base64 值含 {}[]:, 特殊字符，会干扰 WBI 签名校验，登录态下接口
 *      静默返回「空字幕列表」（而非报错），表现为字幕不显示；
 *   ② V0.0.6 跳过了更稳的 /x/player/v2 直连。
 *   musicfree-bili 的字幕接口**：先试无需签名的 /x/player/v2（仅登录态 Cookie + bvid/cid），
 *   失败才用 /x/player/wbi/v2 且只传 bvid/cid、绝不挂 dm_img 参数。
 *   修复：getLyric 双接口兜底——① 先 /x/player/v2 无签名；② 兜底 /x/player/wbi/v2 带签名
 *        但只传 bvid/cid（剔除全部 dm_img 风控参数），与 proven 版本完全一致。
 *   （注：getRawCookie 已正确 decode SESSDATA 为 'SESSDATA=xxx,yyy'，cookie 格式无问题，
 *     故本次无需改凭证逻辑；根因纯在字幕接口的请求构造。）
 *
 * 【关键修复说明（V0.0.5 → V0.0.6）】
 *   症状：收藏夹能拉、音频能播放，但「无 AI 字幕」。
 *   真实根因：getLyric 调用 /x/player/wbi/v2 时**未做 WBI 签名**。该接口是 wbi 受保护
 *            接口，原版 bilibili.js（TS）靠全局 axios 拦截器自动加 w_rid 才工作；opt 是
 *            纯 JS 重写版，没有那个拦截器，登录态请求不带 w_rid 会被 B站 返回空字幕列表
 *            （AI 字幕本就只在登录态返回）。而用户亲证「能看歌词」的 musicfree-bili 恰恰
 *            对该接口做了 WBI 签名（wbiSignedUrl）。
 *   修复：① 复用插件已有的 getWrid 给 /x/player/wbi/v2 追加 w_rid + wts 签名；
 *         ② 字幕选轨优先 ai-zh / ai-en（对齐 musicfree-bili）；
 *         ③ 字幕 JSON 下载补上登录态 Cookie（覆盖需登录才放行的 AI 字幕）；
 *         ④ 增强诊断日志：打印字幕列表条数与语言，便于区分「插件 bug」还是「视频本身无字幕」。
 *
 * 【关键修复说明（V0.0.3 → V0.0.4）】
 *   症状：opt 版「我的收藏夹」与「字幕歌词」双双失效，但用户原用的两款插件各自正常
 *         （musicfree-bilibili 看收藏夹 / musicfree-bili 看歌词）。
 *   真实根因（两处叠加）：
 *   ① platform 大小写错配：MusicFree 的 getUserVariables() 按 platform id 隔离存储。
 *      用户真实凭证 SESSDATA 存放在平台 'Bilibili'（大写）桶（即能看收藏夹那个插件），
 *      V0.0.3 把 platform 误写成 'bilibili'（小写）→ 读到的是空桶 → 收藏夹/歌词全失效。
 *      注意：V0.0.3 的「回退成小写」恰好是反方向，已纠正回 'Bilibili'。
 *   ② _env 捕获不可靠：V0.0.3 用 IIFE 顶部捕获的 _env 去读凭证；而所有能跑通的参考插件
 *      都用裸全局 `env`。捕获链在部分加载器下取不到 → getRawCookie 直接返回空。
 *      本版统一改用与参考插件一致的 `getVars()`（裸 `env.getUserVariables()`）。
 *   修复：platform 改回 'Bilibili'（继承用户已填的 SESSDATA 桶）+ 凭证读取全部走
 *      getVars()；getRawCookie 优先 SESSDATA，并兼容同桶内 cookie / biliSessdata。
 *
 * 【关键修复说明（V0.0.4 → V0.0.5）】
 *   症状：收藏夹已能正常拉取，但点开任意音频均「无法播放」。
 *   真实根因：getMediaSource 原是「纯匿名单路径取链」——playurl 既不挂登录 Cookie、
 *            也没有 durl 兜底。后果：① 收藏夹里的登录/大会员限定视频，匿名 playurl
 *            被 B站 风控返回 -412 或空 audio → 取链失败；② 桌面端（Electron）播放器
 *            对 DASH 分离音频流（mcdn P2P 直链）兼容性差，需要更稳的 durl 合并流。
 *   修复：改为三级兜底取链——① 已登录优先带 SESSDATA 登录态 playurl（仅挂 SESSDATA、
 *            绝不挂 buvid，避免 412）；② 匿名 playurl 兜底（未登录仍可播公开视频）；
 *            ③ fnval=0 durl 合并流最终兜底（upos 直链，桌面端兼容性最强）。
 * ============================================================================
 */
(function () {
  // 跨加载器兼容：优先用沙箱注入的 __musicfree_require，否则回退 require
  // （MusicFree 移动端仅注入 __musicfree_require，裸 require 会 ReferenceError 导致插件无法加载）
  var reqFn = (
    typeof __musicfree_require !== 'undefined' ? __musicfree_require :
    (typeof require !== 'undefined' ? require : null)
  );
  if (!reqFn) {
    throw new Error('[bilibili] 插件沙箱未提供 require，无法加载');
  }
  var axios = reqFn('axios');

  // 读取 MusicFree 注入的用户变量（登录凭证 / 配置项）。
  // 关键：与所有「能跑通」的参考插件（musicfree-bilibili / musicfree-bili / martin65536 bilibili.js）
  // 保持一致——直接读取沙箱提供的裸全局 `env`，不做任何捕获/回退。
  // 原因：MusicFree 的 getUserVariables() 按 platform id 隔离，且 `env` 在不同加载器中
  // 可能以全局 / 模块参数形式注入；裸 `env` 是经实测唯一稳定的取法。
  function getVars() {
    try {
      if (typeof env !== 'undefined' && env && typeof env.getUserVariables === 'function') {
        return env.getUserVariables() || {};
      }
    } catch (e) { /* 本地测试环境无 env */ }
    return {};
  }

  /* ===================== 纯 JS 实现 md5 / HMAC（零外部依赖） ===================== */
  // 替代 bili.js 的 crypto-js，规避移动端沙箱顶层抛错
  function md5hex(s) {
    function rotateLeft(n, s) { return (n << s) | (n >>> (32 - s)); }
    function toUtf8(str) {
      var out = '';
      for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        if (c < 0x80) out += String.fromCharCode(c);
        else if (c < 0x800) out += String.fromCharCode(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        else if (c >= 0xd800 && c < 0xdc00) {
          var c2 = str.charCodeAt(i + 1); i++;
          var u = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
          out += String.fromCharCode(0xf0 | (u >> 18), 0x80 | ((u >> 12) & 0x3f), 0x80 | ((u >> 6) & 0x3f), 0x80 | (u & 0x3f));
        } else out += String.fromCharCode(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
      return out;
    }
    function add32(a, b) { return (a + b) & 0xffffffff; }
    function cmn(q, a, b, x, s, t) { a = add32(add32(a, q), add32(x, t)); return add32(rotateLeft(a, s), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
    var str = toUtf8(s);
    var n = str.length;
    var state = [1732584193, -271733879, -1732584194, 271733878];
    var len = n * 8;
    str = str + String.fromCharCode(0x80);
    while (str.length % 64 !== 56) str += String.fromCharCode(0);
    var lenLo = len >>> 0, lenHi = Math.floor(len / 0x100000000);
    for (var b = 0; b < 4; b++) str += String.fromCharCode((lenLo >>> (8 * b)) & 0xff);
    for (var b2 = 0; b2 < 4; b2++) str += String.fromCharCode((lenHi >>> (8 * b2)) & 0xff);
    for (var i = 0; i < str.length; i += 64) {
      var X = [];
      for (var j = 0; j < 16; j++) {
        var w = i + j * 4;
        X[j] = (str.charCodeAt(w)) | (str.charCodeAt(w + 1) << 8) | (str.charCodeAt(w + 2) << 16) | (str.charCodeAt(w + 3) << 24);
      }
      var a = state[0], b = state[1], c = state[2], d = state[3];
      a = ff(a, b, c, d, X[0], 7, -680876936); d = ff(d, a, b, c, X[1], 12, -389564586); c = ff(c, d, a, b, X[2], 17, 606105819); b = ff(b, c, d, a, X[3], 22, -1044525330);
      a = ff(a, b, c, d, X[4], 7, -176418897); d = ff(d, a, b, c, X[5], 12, 1200080426); c = ff(c, d, a, b, X[6], 17, -1473231341); b = ff(b, c, d, a, X[7], 22, -45705983);
      a = ff(a, b, c, d, X[8], 7, 1770035416); d = ff(d, a, b, c, X[9], 12, -1958414417); c = ff(c, d, a, b, X[10], 17, -42063); b = ff(b, c, d, a, X[11], 22, -1990404162);
      a = ff(a, b, c, d, X[12], 7, 1804603682); d = ff(d, a, b, c, X[13], 12, -40341101); c = ff(c, d, a, b, X[14], 17, -1502002290); b = ff(b, c, d, a, X[15], 22, 1236535329);
      a = gg(a, b, c, d, X[1], 5, -165796510); d = gg(d, a, b, c, X[6], 9, -1069501632); c = gg(c, d, a, b, X[11], 14, 643717713); b = gg(b, c, d, a, X[0], 20, -373897302);
      a = gg(a, b, c, d, X[5], 5, -701558691); d = gg(d, a, b, c, X[10], 9, 38016083); c = gg(c, d, a, b, X[15], 14, -660478335); b = gg(b, c, d, a, X[4], 20, -405537848);
      a = gg(a, b, c, d, X[9], 5, 568446438); d = gg(d, a, b, c, X[14], 9, -1019803690); c = gg(c, d, a, b, X[3], 14, -187363961); b = gg(b, c, d, a, X[8], 20, 1163531501);
      a = gg(a, b, c, d, X[13], 5, -1444681467); d = gg(d, a, b, c, X[2], 9, -51403784); c = gg(c, d, a, b, X[7], 14, 1735328473); b = gg(b, c, d, a, X[12], 20, -1926607734);
      a = hh(a, b, c, d, X[5], 4, -378558); d = hh(d, a, b, c, X[8], 11, -2022574463); c = hh(c, d, a, b, X[11], 16, 1839030562); b = hh(b, c, d, a, X[14], 23, -35309556);
      a = hh(a, b, c, d, X[1], 4, -1530992060); d = hh(d, a, b, c, X[4], 11, 1272893353); c = hh(c, d, a, b, X[7], 16, -155497632); b = hh(b, c, d, a, X[10], 23, -1094730640);
      a = hh(a, b, c, d, X[13], 4, 681279174); d = hh(d, a, b, c, X[0], 11, -358537222); c = hh(c, d, a, b, X[3], 16, -722521979); b = hh(b, c, d, a, X[6], 23, 76029189);
      a = hh(a, b, c, d, X[9], 4, -640364487); d = hh(d, a, b, c, X[12], 11, -421815835); c = hh(c, d, a, b, X[15], 16, 530742520); b = hh(b, c, d, a, X[2], 23, -995338651);
      a = ii(a, b, c, d, X[0], 6, -198630844); d = ii(d, a, b, c, X[7], 10, 1126891415); c = ii(c, d, a, b, X[14], 15, -1416354905); b = ii(b, c, d, a, X[5], 21, -57434055);
      a = ii(a, b, c, d, X[12], 6, 1700485571); d = ii(d, a, b, c, X[3], 10, -1894986606); c = ii(c, d, a, b, X[10], 15, -1051523); b = ii(b, c, d, a, X[1], 21, -2054922799);
      a = ii(a, b, c, d, X[8], 6, 1873313359); d = ii(d, a, b, c, X[15], 10, -30611744); c = ii(c, d, a, b, X[6], 15, -1560198380); b = ii(b, c, d, a, X[13], 21, 1309151649);
      a = ii(a, b, c, d, X[4], 6, -145523070); d = ii(d, a, b, c, X[11], 10, -1120210379); c = ii(c, d, a, b, X[2], 15, 718787259); b = ii(b, c, d, a, X[9], 21, -343485551);
      state[0] = add32(state[0], a); state[1] = add32(state[1], b); state[2] = add32(state[2], c); state[3] = add32(state[3], d);
    }
    function hex(n) {
      var s = '';
      for (var k = 0; k < 4; k++) {
        var v = (n >>> (8 * k)) & 0xff;
        var h = v.toString(16);
        s += (h.length === 1 ? '0' + h : h);
      }
      return s;
    }
    return hex(state[0]) + hex(state[1]) + hex(state[2]) + hex(state[3]);
  }
  function _md5(s) { return md5hex(s); }

  /* ===================== 极简 he / dayjs 替代 ===================== */
  function heDecode(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
  }
  function unixToDate(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const y = d.getFullYear();
    const m = ('0' + (d.getMonth() + 1)).slice(-2);
    const day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }

  /* ===================== 基础常量 ===================== */
  const API_HOST = 'https://api.bilibili.com';
  // 桌面/安卓统一伪装为桌面 Chrome，规避部分接口的 UA 风控
  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // 读取用户自定义 UA（可选）。填了用用户的，否则用默认 Chrome 120
  function getUserUA() {
    try {
      const v = getVars();
      const u = (v && v.ua && String(v.ua).trim()) || '';
      return u || UA;
    } catch (e) {
      return UA;
    }
  }
  // 请求头对齐 Chrome 浏览器，包括 sec-* 系列（字幕/UP主作品等需真浏览器指纹的接口使用）
  function getHeaders() {
    const ua = getUserUA();
    return {
      'user-agent': ua,
      'accept': '*/*',
      'accept-encoding': 'gzip, deflate, br',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
      'sec-ch-ua': '"Not A(Brand";v="99", "Chromium";v="121", "Google Chrome";v="121"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
    };
  }
  const headers = getHeaders();
  const searchHeaders = {
    'user-agent': getUserUA(),
    accept: 'application/json, text/plain, */*',
    'accept-encoding': 'gzip, deflate, br',
    origin: 'https://search.bilibili.com',
    'sec-fetch-site': 'same-site',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    referer: 'https://search.bilibili.com/',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
  };

  /* ===================== Cookie / SESSDATA ===================== */
  // 兼容三种粘贴方式：①仅 SESSDATA 值 ②标准完整 Cookie(=) ③浏览器复制的冒号格式(:)
  // 关键：SESSDATA 值常含 URL 编码字符（如 %2C 表示逗号），必须解码为原始字符，否则 B站 判定 Cookie 非法。
  function getRawCookie() {
    try {
      const vars = getVars();
      // 用户凭据按 platform id 隔离存储。本插件 platform='Bilibili'（大写），
      // 与「能看收藏夹」的本地插件 musicfree-bilibili 完全一致 —— 用户已在该桶填过 SESSDATA。
      // 优先读 SESSDATA（本插件主凭证），并兼容同桶内的 cookie / biliSessdata 写法。
      if (vars.SESSDATA) return normalizeCookie(vars.SESSDATA);
      if (vars.cookie) return String(vars.cookie).trim();
      if (vars.biliSessdata) return normalizeCookie(vars.biliSessdata);
    } catch (e) {
      /* 本地测试环境无 env */
    }
    return '';
  }
  function decodeSess(cookieStr) {
    return cookieStr.replace(/(SESSDATA=)([^;]+)/, function (_, p, v) {
      try { return p + (v.indexOf('%') === -1 ? v : decodeURIComponent(v)); } catch (e) { return p + v; }
    });
  }
  function safeDecode(s) {
    try { return s.indexOf('%') === -1 ? s : decodeURIComponent(s); } catch (e) { return s; }
  }
  function normalizeCookie(raw) {
    if (!raw) return '';
    if (raw.indexOf('SESSDATA=') !== -1) return decodeSess(raw);
    if (raw.indexOf('SESSDATA:') === -1 && raw.indexOf('=') === -1) {
      return 'SESSDATA=' + safeDecode(raw);
    }
    if (raw.indexOf('SESSDATA:') !== -1) {
      const out = raw.split(';').map(function (pair) {
        const idx = pair.indexOf(':');
        if (idx === -1) return pair.trim();
        return pair.slice(0, idx).trim() + '=' + pair.slice(idx + 1).trim();
      }).join(';');
      return decodeSess(out);
    }
    return decodeSess(raw);
  }
  function buildCookie() { return getRawCookie(); }

  // 从 Cookie 提取用户 UID（用于收藏夹列表接口）
  function getMidFromCookie() {
    const raw = getRawCookie();
    if (!raw) return '';
    const m = raw.match(/DedeUserID\s*[:=]\s*([^;\s]+)/);
    return m ? m[1] : '';
  }

  // buvid 指纹：B站 对匿名请求有风控（-352/-412），附加 buvid3/4 可显著降低触发概率。缓存 24h。
  let _buvidCache = '';
  let _buvidTs = 0;
  async function ensureBuvid() {
    const now = Date.now();
    if (_buvidCache && now - _buvidTs < 24 * 3600 * 1000) return;
    try {
      const r = await axios.get(API_HOST + '/x/frontend/finger/spi', {
        headers: { 'User-Agent': UA },
      });
      const d = (r.data && r.data.data) || {};
      if (d.b_3) {
        _buvidCache = 'buvid3=' + d.b_3 + '; buvid4=' + (d.b_4 || d.buvid4 || '') + ';';
        _buvidTs = now;
      }
    } catch (e) {
      /* 指纹获取失败不影响主流程 */
    }
  }

  // 最终 cookie 字符串：用户 cookie 优先，否则匿名 buvid
  async function getCookieString() {
    const userCookie = getRawCookie();
    if (userCookie) return userCookie;
    await ensureBuvid();
    return _buvidCache || '';
  }
  function isLoggedIn() {
    return /SESSDATA=/.test(getRawCookie());
  }

  // 通用请求头：Referer+Origin（www.bilibili.com）+ 可选 buvid/用户 cookie
  function makeHeaders(withBuvid) {
    if (typeof withBuvid === 'undefined') withBuvid = true;
    const cookie = getRawCookie();
    const h = {
      'User-Agent': UA,
      Referer: 'https://www.bilibili.com',
      Origin: 'https://www.bilibili.com',
    };
    let c = cookie;
    if (withBuvid && _buvidCache) c = (c ? c + '; ' : '') + _buvidCache;
    if (c) h['Cookie'] = c;
    return h;
  }

  /* ===================== WBI 签名（nav 取密钥 + 纯 JS md5） ===================== */
  // 本地插件验证过的方案：直接从 /x/web-interface/nav 取 wbi_img，无需 GenWebTicket / HMAC。
  const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
  ];
  const CHR_FILTER = /[!'()*]/g;
  function _getMixinKey(orig) {
    let key = '';
    for (let i = 0; i < 32; i++) key += orig[MIXIN_KEY_ENC_TAB[i]];
    return key;
  }
  let _wbiMixinKeyCache = '';
  let _wbiMixinKeyTs = 0;
  async function getWbiMixinKey() {
    const now = Date.now();
    if (_wbiMixinKeyCache && now - _wbiMixinKeyTs < 10 * 60 * 1000) return _wbiMixinKeyCache;
    const resp = await axios.get(API_HOST + '/x/web-interface/nav', { headers: makeHeaders() });
    const data = resp.data || {};
    if (!data.data || !data.data.wbi_img) throw new Error('获取 WBI 密钥失败（可能未登录）');
    const img = data.data.wbi_img.img_url.split('/').pop().split('.')[0];
    const sub = data.data.wbi_img.sub_url.split('/').pop().split('.')[0];
    _wbiMixinKeyCache = _getMixinKey(img + sub);
    _wbiMixinKeyTs = now;
    return _wbiMixinKeyCache;
  }
  // 给参数追加 w_rid（纯 JS md5），返回签名串（供 UP主作品接口）
  async function getWrid(params) {
    const mixinKey = await getWbiMixinKey();
    const keys = Object.keys(params).sort();
    let q = '';
    keys.forEach(function (k, i) {
      const v = params[k];
      let p = v;
      if (typeof p === 'string' && CHR_FILTER.test(p)) p = p.replace(CHR_FILTER, '');
      if (p === undefined || p === null) return;
      q += (i ? '&' : '') + encodeURIComponent(k) + '=' + encodeURIComponent(String(p));
    });
    return _md5(q + mixinKey);
  }

  /* ===================== 错误标准化 ===================== */
  function wrapError(label, data) {
    const code = data && data.code;
    const msg = (data && data.message) || '';
    if (code === -101 || code === -111 || code === -412) {
      return new Error('认证失败，请检查 SESSDATA Cookie 是否有效');
    }
    if (code === -352 || code === -799 || /风控|验证/.test(msg)) {
      return new Error('该榜单触发了平台风控，请先在插件设置中填写 SESSDATA Cookie（登录态）后重试');
    }
    if (code === -404 || /私密|private/i.test(msg)) {
      return new Error('无法访问私密收藏夹');
    }
    if (/vip|会员|版权|coin|充电/.test(msg)) {
      return new Error('该视频需要大会员权限或存在区域限制，无法播放');
    }
    return new Error(label + '失败：' + (msg || code || '未知错误'));
  }

  /* ===================== 工具函数（bili.js 原有） ===================== */
  function secToMmSs(sec) {
    if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}`;
  }
  function formatNumber(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '';
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    return String(n);
  }
  function durationToSec(duration) {
    if (typeof duration === 'number') return duration;
    if (typeof duration === 'string') {
      const dur = duration.split(':');
      return dur.reduce(function (prev, curr) { return 60 * prev + +curr; }, 0);
    }
    return 0;
  }
  // 读取用户配置的专辑名模板
  function getAlbumTemplate() {
    try {
      const v = getVars();
      return (v && v.albumTemplate && String(v.albumTemplate).trim()) || '';
    } catch (e) { return ''; }
  }
  function renderAlbumTemplate(vars) {
    const tpl = getAlbumTemplate();
    if (!tpl) return vars.bvid || String(vars.aid || '') || '';
    let out = tpl;
    const replacements = {
      '{bvid}': vars.bvid || '', '{aid}': vars.aid != null ? String(vars.aid) : '',
      '{date}': vars.date || '', '{duration}': typeof vars.duration === 'number' ? String(vars.duration) : '',
      '{durationMmSs}': typeof vars.duration === 'number' ? secToMmSs(vars.duration) : '',
      '{artist}': vars.artist || '', '{title}': vars.title || '',
      '{playCount}': typeof vars.playCount === 'number' ? formatNumber(vars.playCount) : '',
      '{likeCount}': typeof vars.likeCount === 'number' ? formatNumber(vars.likeCount) : '',
      '{coinCount}': typeof vars.coinCount === 'number' ? formatNumber(vars.coinCount) : '',
      '{favoriteCount}': typeof vars.favoriteCount === 'number' ? formatNumber(vars.favoriteCount) : '',
      '{danmakuCount}': typeof vars.danmakuCount === 'number' ? formatNumber(vars.danmakuCount) : '',
      '{replyCount}': typeof vars.replyCount === 'number' ? formatNumber(vars.replyCount) : '',
      '{shareCount}': typeof vars.shareCount === 'number' ? formatNumber(vars.shareCount) : '',
      '{category}': vars.category || '',
    };
    for (const [k, v] of Object.entries(replacements)) out = out.split(k).join(v);
    return out.trim();
  }

  /* ===================== 视频详情 / 播放地址 ===================== */
  // 获取视频详情（含全部分P 的 cid / 标题 / 时长）—— 本地插件风格，返回 data.data
  async function getVideoView(bvid) {
    const resp = await axios.get(API_HOST + '/x/web-interface/view', {
      params: { bvid: bvid },
      headers: makeHeaders(),
    });
    const data = resp.data || {};
    if (data.code !== 0) throw wrapError('获取视频信息', data);
    return data.data;
  }
  // 获取视频详情（bili.js 风格，返回完整响应）—— 供 getMediaSource/getMusicInfo 等复用
  async function getCid(bvid, aid) {
    const params = bvid ? { bvid } : { aid };
    const cidRes = (await axios.get(API_HOST + '/x/web-interface/view', {
      headers: Object.assign({}, headers, { cookie: await getCookieString() }),
      params,
    })).data;
    return cidRes;
  }
  /* ===================== 收藏夹（本地插件增强） ===================== */
  async function getLoginMid() {
    try {
      const resp = await axios.get(API_HOST + '/x/web-interface/nav', { headers: makeHeaders(), timeout: 10000 });
      const data = resp.data || {};
      if (data.code !== 0 || !data.data) return '';
      return data.data.mid || '';
    } catch (e) { return ''; }
  }
  // 获取用户创建的全部收藏夹
  async function getFavoriteFolders() {
    const cookie = buildCookie();
    if (!cookie) throw new Error('请先在插件设置中填写 B站 SESSDATA Cookie，以加载「我的收藏夹」');
    let mid = getMidFromCookie();
    if (!mid) mid = await getLoginMid();
    if (!mid) throw new Error('未能获取登录用户 UID，请确认 SESSDATA Cookie 是否有效');
    const params = { up_mid: mid };
    const resp = await axios.get(API_HOST + '/x/v3/fav/folder/created/list-all', {
      params: params, headers: makeHeaders(), timeout: 10000,
    });
    const data = resp.data || {};
    if (data.code !== 0) {
      if (data.code === -101 || data.code === -111 || data.code === -412) {
        throw new Error('SESSDATA 已失效，请重新从浏览器复制 SESSDATA Cookie');
      }
      throw wrapError('获取收藏夹列表', data);
    }
    return (data.data && data.data.list) || data.data || [];
  }
  // 获取某个收藏夹内的视频列表（分页）
  async function getFolderVideos(mediaId, page) {
    const cookie = buildCookie();
    if (!cookie) throw new Error('请先在插件设置中填写 B站 SESSDATA Cookie');
    const params = { media_id: mediaId, pn: page || 1, ps: 20, platform: 'web' };
    const headers2 = makeHeaders();
    const maxRetry = 3;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxRetry; attempt++) {
      try {
        const resp = await axios.get(API_HOST + '/x/v3/fav/resource/list', {
          params: params, headers: headers2, timeout: 10000,
        });
        const data = resp.data || {};
        if (data.code === 0) return data.data || {};
        if (data.code === -403) throw new Error('该收藏夹为「私密收藏夹」，请前往 B站 将其改为「公开」后再导入/播放');
        if (data.code === -412) throw new Error('访问收藏夹触发平台风控，请稍后重试');
        lastErr = new Error('获取收藏夹视频失败：' + (data.message || ('code ' + data.code)));
      } catch (e) { lastErr = e; }
      if (attempt < maxRetry) await new Promise(function (r) { setTimeout(r, 1000); });
    }
    throw lastErr || new Error('获取收藏夹视频失败');
  }
  function mapFolderToSheet(folder) {
    const count = folder.media_count || 0;
    return {
      id: String(folder.id),
      title: folder.title || '未命名收藏夹',
      artwork: folder.cover || '',
      description: '共 ' + count + ' 个视频',
      count: count,
    };
  }
  function ownerNameOf(media) {
    if (media.owner && media.owner.name) return media.owner.name;
    if (media.upper && media.upper.name) return media.upper.name;
    return '未知UP主';
  }
  function firstCidOf(media) {
    const c = media.cid || media.uppermost_cid || media.first_cid;
    return c ? String(c) : '';
  }
  function baseMusicOf(media, sheetTitle) {
    return {
      id: String(media.id || media.bvid),
      bvid: media.bvid,
      cid: firstCidOf(media),
      title: media.title || '未命名视频',
      artist: ownerNameOf(media),
      artwork: media.cover || media.pic || '',
      duration: media.duration || 0,
      album: sheetTitle || '',
      pageCount: media.cnt || media.page_count || 1,
    };
  }
  // 分P展开：单P直接返回；多P则抓取 view 后每个分P生成一个独立条目
  function expandMedia(media, sheetTitle) {
    const base = baseMusicOf(media, sheetTitle);
    if ((media.cnt || media.page_count || 1) <= 1) return Promise.resolve([base]);
    return getVideoView(media.bvid).then(function (view) {
      const pages = view.pages || [];
      if (!pages.length) return [base];
      return pages.map(function (p, i) {
        const partTitle = p.part || '';
        const title = pages.length > 1
          ? media.title + ' - P' + (i + 1) + (partTitle ? ' ' + partTitle : '')
          : media.title;
        return Object.assign({}, base, {
          id: media.bvid + '|' + p.cid,
          cid: String(p.cid),
          title: title,
          duration: p.duration || base.duration,
        });
      });
    }).catch(function () { return [base]; });
  }
  // 收藏夹视频分页拉取并逐条分P展开（导入/歌单详情通用）
  async function loadSheetVideos(sheetItem, page) {
    const mediaId = sheetItem.id;
    const sheetTitle = sheetItem.title || '';
    const data = await getFolderVideos(mediaId, page || 1);
    const medias = data.medias || [];
    const expanded = await Promise.all(medias.map(function (m) { return expandMedia(m, sheetTitle); }));
    const musicList = [].concat.apply([], expanded);
    const hasMore = data.has_more === true || data.has_more === 1;
    return { isEnd: !hasMore, musicList: musicList, sheetItem: sheetItem };
  }

  /* ===================== 榜单静态配置 ===================== */
  // 各分区排行榜的 rid 映射（21 个分区，比 bili.js 原 19 个新增「翻唱」「演奏」）
  const BILI_REGIONS = [
    { rid: 3, name: '音乐' }, { rid: 31, name: '翻唱' }, { rid: 193, name: '演奏' },
    { rid: 1, name: '动画' }, { rid: 168, name: '国创' }, { rid: 4, name: '游戏' },
    { rid: 119, name: '鬼畜' }, { rid: 129, name: '舞蹈' }, { rid: 160, name: '生活' },
    { rid: 211, name: '美食' }, { rid: 36, name: '知识' }, { rid: 188, name: '科技' },
    { rid: 234, name: '运动' }, { rid: 223, name: '汽车' }, { rid: 217, name: '动物圈' },
    { rid: 155, name: '时尚' }, { rid: 5, name: '娱乐' }, { rid: 181, name: '影视' },
    { rid: 0, name: '全站' }, { rid: 0, name: '原创', type: 'origin' }, { rid: 0, name: '新人', type: 'rookie' },
  ];
  const ICON_PRECIOUS = 'https://s1.hdslb.com/bfs/static/jinkela/popular/assets/icon_history.png';
  const ICON_WEEKLY = 'https://s1.hdslb.com/bfs/static/jinkela/popular/assets/icon_weekly.png';
  const ICON_RANK = 'https://s1.hdslb.com/bfs/static/jinkela/popular/assets/icon_rank.png';

  /* ===================== 公开榜单（免登录）数据映射 ===================== */
  function formatPopularMedia(item) {
    return {
      id: String(item.aid || item.bvid),
      bvid: item.bvid,
      cid: item.cid ? String(item.cid) : (item.first_cid ? String(item.first_cid) : ''),
      title: heDecode(item.title || '未知'),
      artist: (item.owner && item.owner.name) || item.author || item.uploader || '未知UP主',
      artwork: item.pic || item.cover || '',
      duration: item.duration || 0,
      album: '',
      pageCount: 1,
    };
  }
  // 公开榜单详情拉取：入站必刷支持分页；每周必刷/各分区为固定榜单
  async function getPublicTopListDetail(topListItem, page) {
    const id = topListItem.id || '';
    let url;
    if (id.indexOf('popular/precious') === 0) {
      url = API_HOST + '/x/web-interface/popular/precious?page_size=20&page=' + (page || 1);
    } else {
      url = API_HOST + '/x/web-interface/' + id;
    }
    await ensureBuvid();
    try {
      const resp = await axios.get(url, { headers: makeHeaders() });
      const data = resp.data || {};
      if (data.code && data.code !== 0) throw wrapError('获取榜单详情', data);
      const d = data.data || {};
      const list = d.list || d.archives || [];
      if (!list.length) {
        console.warn('[getPublicTopListDetail] 该榜单暂无数据 id=' + id);
        return { isEnd: true, musicList: [] };
      }
      const musicList = list.map(formatPopularMedia);
      const isPaged = id.indexOf('popular/precious') === 0;
      const isEnd = isPaged
        ? (page || 1) * 20 >= (d.page && d.page.count ? d.page.count : list.length)
        : true;
      return { isEnd: isEnd, musicList: musicList, sheetItem: topListItem };
    } catch (e) {
      console.warn('[getPublicTopListDetail] 失败 id=' + id + ':', e.message);
      return { isEnd: true, musicList: [] };
    }
  }

  /* ===================== 搜索（bili.js 富字段 + 字幕兼容） ===================== */
  const pageSize = 20;
  async function searchBase(keyword, page, searchType) {
    await ensureBuvid();
    const params = {
      context: '', page, order: '', page_size: pageSize, keyword,
      duration: '', tids_1: '', tids_2: '', __refresh__: true, _extra: '', highlight: 1,
      single_column: 0, platform: 'pc', from_source: '', search_type: searchType, dynamic_offset: 0,
    };
    try {
      const res = (await axios.get(API_HOST + '/x/web-interface/search/type', {
        headers: Object.assign({}, searchHeaders, { cookie: await getCookieString() }),
        params,
      })).data;
      if (!res) throw new Error('搜索接口返回空（可能被风控）');
      if (res.code !== 0) throw new Error('搜索接口返回错误 code=' + res.code + ' msg=' + (res.message || ''));
      if (!res.data || !res.data.result) throw new Error('搜索接口返回数据异常: ' + JSON.stringify(res).slice(0, 200));
      return res.data;
    } catch (error) {
      console.error('[searchBase] 搜索失败 keyword=' + keyword + ' page=' + page + ' type=' + searchType + ':', error.message);
      return { result: [], numResults: 0 };
    }
  }
  // 搜索结果统一映射（含统计字段 + 专辑名模板）
  function formatMedia(result) {
    const title = heDecode((result.title || '').replace(/(\<em(.*?)\>)|(\<\/em\>)/g, ''));
    const durSec = durationToSec(result.duration);
    const pubTs = result.pubdate || result.created;
    const pubDate = pubTs ? unixToDate(pubTs) : '';
    const artistName = (result.author || (result.owner && result.owner.name) || '');
    const playCount = typeof result.play === 'number' ? result.play : (result.stat ? result.stat.view : undefined);
    const likeCount = typeof result.like === 'number' ? result.like : (result.stat ? result.stat.like : undefined);
    const danmakuCount = typeof result.video_review === 'number' ? result.video_review : (typeof result.danmaku === 'number' ? result.danmaku : (result.stat ? result.stat.danmaku : undefined));
    const replyCount = typeof result.review === 'number' ? result.review : (result.stat ? result.stat.reply : undefined);
    const favoriteCount = typeof result.favorites === 'number' ? result.favorites : (result.stat ? result.stat.favorite : undefined);
    const coinCount = typeof result.coins === 'number' ? result.coins : (result.stat ? result.stat.coin : undefined);
    const shareCount = typeof result.share === 'number' ? result.share : (result.stat ? result.stat.share : undefined);
    const category = result.typename || result.tname || '';
    const rawDesc = (result.description && String(result.description).trim()) || (result.desc && String(result.desc).trim()) || '';
    let descParts = [];
    if (rawDesc) descParts.push(rawDesc);
    const statParts = [];
    if (typeof playCount === 'number') statParts.push('播放 ' + formatNumber(playCount));
    if (typeof likeCount === 'number') statParts.push('点赞 ' + formatNumber(likeCount));
    if (typeof coinCount === 'number') statParts.push('投币 ' + formatNumber(coinCount));
    if (typeof favoriteCount === 'number') statParts.push('收藏 ' + formatNumber(favoriteCount));
    if (typeof danmakuCount === 'number') statParts.push('弹幕 ' + formatNumber(danmakuCount));
    if (typeof replyCount === 'number') statParts.push('评论 ' + formatNumber(replyCount));
    if (statParts.length > 0) descParts.push(statParts.join(' | '));
    const description = descParts.join('\n');
    const album = renderAlbumTemplate({
      bvid: result.bvid, aid: result.aid, date: pubDate, duration: durSec,
      durationMmSs: durSec > 0 ? secToMmSs(durSec) : '',
      artist: artistName, title: title,
      playCount: playCount, likeCount: likeCount, coinCount: coinCount,
      favoriteCount: favoriteCount, danmakuCount: danmakuCount, replyCount: replyCount,
      shareCount: shareCount, category: category,
    });
    const item = {
      id: (result.cid || result.bvid || result.aid),
      aid: result.aid, bvid: result.bvid,
      artist: artistName, title,
      alias: (title.match(/《(.+?)》/) || [])[1],
      album: album,
      artwork: (result.pic && String(result.pic).startsWith('//')) ? 'http:' + result.pic : result.pic,
      duration: durSec,
      tags: (result.tag && typeof result.tag === 'string') ? result.tag.split(',') : undefined,
      date: pubDate,
      playCount: playCount, likeCount: likeCount, coinCount: coinCount, favoriteCount: favoriteCount,
      danmakuCount: danmakuCount, replyCount: replyCount, shareCount: shareCount,
      category: category, description: description,
      artistId: result.mid, artistAvatar: result.upic || (result.owner && result.owner.face),
    };
    Object.keys(item).forEach((key) => { if (item[key] === undefined || item[key] === null) delete item[key]; });
    return item;
  }
  async function searchAlbum(keyword, page) {
    const resultData = await searchBase(keyword, page, 'video');
    return { isEnd: resultData.numResults <= page * pageSize, data: resultData.result.map(formatMedia) };
  }
  async function searchArtist(keyword, page) {
    const resultData = await searchBase(keyword, page, 'bili_user');
    const artists = resultData.result.map((result) => ({
      name: result.uname, id: result.mid, fans: result.fans,
      description: result.usign,
      avatar: (result.upic && String(result.upic).startsWith('//')) ? `https://${result.upic}` : result.upic,
      worksNum: result.videos,
    }));
    return { isEnd: resultData.numResults <= page * pageSize, data: artists };
  }

  /* ===================== UP主作品（WBI，纯 JS 签名） ===================== */
  async function getArtistWorks(artistItem, page, type) {
    const queryHeaders = {
      'user-agent': getUserUA(), accept: '*/*', 'accept-encoding': 'gzip, deflate, br, zstd',
      origin: 'https://space.bilibili.com', 'sec-fetch-site': 'same-site',
      'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty',
      referer: `https://space.bilibili.com/${artistItem.id}/video`,
    };
    await ensureBuvid();
    const now = Math.round(Date.now() / 1e3);
    const params = {
      mid: artistItem.id, ps: 30, tid: 0, pn: page, index: 0, special_type: '',
      web_location: '333.1387', order_avoided: true, order: 'pubdate', keyword: '',
      platform: 'web', dm_img_list: '[]',
      dm_img_str: 'V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ',
      dm_cover_img_str: 'QU5HTEUgKE5WSURJQSwgTlZJRElBIEdlRm9yY2UgR1RYIDE2NTAgKDB4MDAwMDFGOTEpIERpcmVjdDNEMTEgdnNfNV8wIHBzXzVfMCwgRDNEMTEpR29vZ2xlIEluYy4gKE5WSURJQS',
      dm_img_inter: '{"ds":[],"wh":[4564,4288,68],"of":[401,802,401]}',
      wts: now.toString(),
    };
    const w_rid = await getWrid(params);
    try {
      const res = (await axios.get(API_HOST + '/x/space/wbi/arc/search', {
        headers: Object.assign({}, queryHeaders, { cookie: await getCookieString() }),
        params: Object.assign({}, params, { w_rid }),
      })).data;
      if (!res) throw new Error('作者作品接口返回空（可能被风控412）');
      if (res.code !== 0) throw new Error('作者作品接口返回错误 code=' + res.code + ' msg=' + (res.message || '') + '（mid=' + artistItem.id + ' page=' + page + '）');
      if (!res.data || !res.data.list || !res.data.list.vlist) throw new Error('作者作品数据异常: ' + JSON.stringify(res).slice(0, 200));
      const resultData = res.data;
      const albums = resultData.list.vlist.map(formatMedia);
      return {
        isEnd: resultData.page && resultData.page.pn ? (resultData.page.pn * resultData.page.ps >= resultData.page.count) : true,
        data: albums,
      };
    } catch (error) {
      console.error('[getArtistWorks] mid=' + artistItem.id + ' page=' + page + ':', error.message);
      return { isEnd: true, data: [] };
    }
  }

  /* ===================== 取链（三级兜底：登录态 → 匿名 → durl 合并流） ===================== */
  // 为什么需要三级兜底（这是「收藏夹能拉取但音频均无法播放」的根因修复）：
  //   • 纯匿名 playurl 对「登录/大会员限定」视频会被风控返回 -412 或空 audio → 直接失败；
  //   • 桌面端（Electron）播放器对 DASH 分离音频流（mcdn P2P 直链）兼容性差，
  //     而 fnval=0 的 durl 合并流（upos 直链）是最稳的单流格式。
  // 策略（与 musicfree-bili 一致）：
  //   ① 已登录（填了 SESSDATA/cookie）→ 带登录态 playurl：解锁限定视频 + 更稳直链；
  //      注意只挂 SESSDATA，绝不挂 buvid（buvid 会触发 B站 HTTP 412，见 musicfree-bilibili 注释）；
  //   ② 匿名 playurl：未登录用户仍可播公开视频；
  //   ③ fnval=0 durl 合并流：最终兜底，桌面端兼容性最强。
  async function getMediaSource(musicItem, quality) {
    const logTag = '[getMediaSource] ' + (musicItem.bvid || musicItem.aid || 'unknown');
    try {
      let cid = musicItem.cid;
      if (!cid) {
        const cidRes = await getCid(musicItem.bvid, musicItem.aid);
        if (!cidRes || !cidRes.data || !cidRes.data.cid) {
          throw new Error('获取cid失败 bvid=' + musicItem.bvid + ' aid=' + musicItem.aid);
        }
        cid = cidRes.data.cid;
      }
      if (!musicItem.bvid && !musicItem.aid) throw new Error('musicItem 缺少 bvid 和 aid');
      const referer = 'https://www.bilibili.com/video/' + (musicItem.bvid || musicItem.aid || '');
      const baseHeaders = { 'User-Agent': UA, Referer: 'https://www.bilibili.com' };
      const params16 = musicItem.bvid
        ? { bvid: musicItem.bvid, cid: cid, fnval: 16 }
        : { aid: musicItem.aid, cid: cid, fnval: 16 };
      const cookie = getRawCookie(); // 已登录（填了 SESSDATA/cookie）则为非空；否则匿名

      let res = null, lastErr = null;
      // ① 登录态 playurl（仅当已登录，挂 SESSDATA，不挂 buvid 以避免 412）
      if (cookie) {
        try {
          res = (await axios.get(API_HOST + '/x/player/playurl', {
            headers: Object.assign({}, baseHeaders, { Cookie: cookie }),
            params: params16,
          })).data;
        } catch (e) { lastErr = e; res = null; }
      }
      // 判定成功：code=0 且 dash.audio 有内容 或 durl 有内容
      const ok = (r) => r && r.code === 0 && r.data &&
        ((r.data.dash && r.data.dash.audio && r.data.dash.audio.length) ||
         (r.data.durl && r.data.durl.length));
      // ② 匿名 playurl 兜底
      if (!ok(res)) {
        try {
          res = (await axios.get(API_HOST + '/x/player/playurl', {
            headers: baseHeaders, params: params16,
          })).data;
        } catch (e) { lastErr = e; }
      }
      // ③ fnval=0 durl 合并流兜底（兼容性最强）
      if (!ok(res)) {
        try {
          res = (await axios.get(API_HOST + '/x/player/playurl', {
            headers: baseHeaders, params: Object.assign({}, params16, { fnval: 0 }),
          })).data;
        } catch (e) { lastErr = e; }
      }
      if (!res || res.code !== 0) {
        throw new Error('playurl接口错误 code=' + (res && res.code) + ' msg=' + ((res && res.message) || '') +
          (lastErr ? (' | 兜底异常: ' + lastErr.message) : ''));
      }
      if (!res.data) throw new Error('playurl返回data为空');
      let url;
      if (res.data.dash && res.data.dash.audio && res.data.dash.audio.length > 0) {
        const audios = res.data.dash.audio.slice().sort((a, b) => a.bandwidth - b.bandwidth); // 升序：索引0=最低码率
        const len = audios.length;
        switch (quality) {
          case 'low': url = (audios[0] || {}).baseUrl; break;
          case 'standard': url = (audios[Math.min(1, len - 1)] || {}).baseUrl; break;
          case 'high': url = (audios[Math.min(2, len - 1)] || {}).baseUrl; break;
          case 'super': url = (audios[len - 1] || {}).baseUrl; break;
          default: url = (audios[len - 1] || {}).baseUrl;
        }
        if (!url) url = (audios[len - 1] || {}).baseUrl;
      } else if (res.data.durl && res.data.durl.length > 0) {
        url = res.data.durl[0].url;
      } else {
        throw new Error('playurl未返回音频流 dash/durl 均为空');
      }
      if (!url) throw new Error('解析出的播放URL为空');
      return {
        url: url,
        headers: {
          'User-Agent': UA,
          Referer: referer,
        },
      };
    } catch (error) {
      console.error(logTag + ':', error.message);
      throw error;
    }
  }

  // 补全单曲信息（点击播放前可选调用）
  async function getMusicInfo(musicItem) {
    const bvid = musicItem.bvid, aid = musicItem.aid;
    if (!bvid && !aid) return {};
    try {
      const cidRes = await getCid(bvid, aid);
      const d = cidRes && cidRes.data;
      if (!d) return {};
      const result = {};
      if (d.cid) result.cid = d.cid;
      if (d.duration) result.duration = d.duration;
      if (d.title) result.title = heDecode(d.title);
      if (d.pic) result.artwork = d.pic.startsWith('//') ? 'https:' + d.pic : d.pic;
      if (d.owner && d.owner.name) result.artist = d.owner.name;
      if (d.desc && String(d.desc).trim()) result.desc = String(d.desc).trim();
      const stat = d.stat;
      if (stat) {
        if (typeof stat.view === 'number') result.playCount = stat.view;
        if (typeof stat.like === 'number') result.likeCount = stat.like;
        if (typeof stat.coin === 'number') result.coinCount = stat.coin;
        if (typeof stat.favorite === 'number') result.favoriteCount = stat.favorite;
        if (typeof stat.danmaku === 'number') result.danmakuCount = stat.danmaku;
        if (typeof stat.reply === 'number') result.replyCount = stat.reply;
        if (typeof stat.share === 'number') result.shareCount = stat.share;
      }
      if (d.pubdate) result.date = unixToDate(d.pubdate);
      if (d.tname) result.category = d.tname;
      if (d.owner && d.owner.face) result.artistAvatar = d.owner.face;
      if (d.owner && d.owner.mid) result.artistId = d.owner.mid;
      Object.keys(result).forEach((key) => { if (result[key] === undefined) delete result[key]; });
      return result;
    } catch (error) {
      console.error('获取歌曲详情失败:', error.message);
      return {};
    }
  }

  /* ===================== 专辑多P展开（bili.js 原有） ===================== */
  async function getAlbumInfo(albumItem) {
    const cidRes = await getCid(albumItem.bvid, albumItem.aid);
    const _ref2 = (cidRes && cidRes.data) || {};
    const cid = _ref2.cid;
    const pages = _ref2.pages;
    let musicList;
    if (pages.length === 1) {
      musicList = [Object.assign({}, albumItem, { cid: cid })];
    } else {
      musicList = pages.map(function (_) {
        return Object.assign({}, albumItem, { cid: _.cid, title: _.part, duration: durationToSec(_.duration), id: _.cid });
      });
    }
    return { musicList };
  }

  /* ===================== 榜单入口（合并：每周必刷/入站必刷/21分区/我的收藏夹） ===================== */
  async function getTopLists() {
    // 1) 入站必刷（个性化推荐，需登录）
    const precious = {
      title: '入站必刷',
      data: [{ id: 'popular/precious', title: '入站必刷', coverImg: ICON_PRECIOUS }],
    };
    // 2) 每周必刷（公开）
    let weekly = { title: '每周必刷', data: [] };
    try {
      await ensureBuvid();
      const resp = await axios.get(API_HOST + '/x/web-interface/popular/series/list', { headers: makeHeaders() });
      const list = (resp.data && resp.data.data && resp.data.data.list) || [];
      weekly.data = list.slice(0, 8).map(function (s) {
        return { id: 'popular/series/one?number=' + s.number, title: s.subject, description: s.name, coverImg: ICON_WEEKLY };
      });
    } catch (e) { /* 公开接口异常不影响其余板块 */ }
    // 3) 各分区排行榜（21 个分区，公开）
    const ranking = {
      title: '各分区排行榜',
      data: BILI_REGIONS.map(function (r) {
        const type = r.type ? '&type=' + r.type : '&type=all';
        return { id: 'ranking/v2?rid=' + r.rid + type, title: r.name, coverImg: ICON_RANK };
      }),
    };
    // 4) 我的收藏夹（需登录）
    let fav = { title: '我的收藏夹', data: [] };
    try {
      const folders = await getFavoriteFolders();
      fav.data = folders.map(mapFolderToSheet);
      if (!fav.data.length) {
        fav.data.push({ id: '__fav_empty__', title: '（未检测到收藏夹）', coverImg: ICON_RANK, description: '尚未创建收藏夹，请前往 B站 创建后重试', count: 0 });
      }
    } catch (e) {
      fav.data = [{ id: '__fav_error__', title: '⚠️ 收藏夹加载失败', coverImg: ICON_RANK, description: (e && e.message) ? e.message : '请检查插件设置中的 SESSDATA 是否有效', count: 0 }];
    }
    return [weekly, precious, ranking, fav];
  }
  // 歌单详情：收藏夹数字 id 走收藏夹；其余走公开榜单
  async function getMusicSheetInfo(sheetItem, page) {
    const id = String(sheetItem.id || '');
    if (id.indexOf('__') === 0) throw new Error(sheetItem.description || '该收藏夹项无法加载');
    if (/^\d+$/.test(id)) return loadSheetVideos(sheetItem, page);
    return getPublicTopListDetail(sheetItem, page);
  }
  // 榜单详情：按 id 路由
  async function getTopListDetail(topListItem, page) {
    const id = String(topListItem.id || '');
    if (id === '__fav_error__' || id === '__fav_empty__' || id.indexOf('__') === 0) {
      throw new Error(topListItem.description || '该收藏夹项无法加载');
    }
    if (/^\d+$/.test(id)) return loadSheetVideos(topListItem, page); // 用户收藏夹
    return getPublicTopListDetail(topListItem, page);
  }

  /* ===================== 导入歌单（多P展开 + 收藏夹链接/ID） ===================== */
  // 通过视频链接（BV 号）导入：单 P 直接成曲，多 P 逐集展开为歌单
  async function importVideo(urlLike) {
    const m = String(urlLike).match(/BV[0-9A-Za-z]+/);
    if (!m) return null;
    const bvid = m[0];
    const view = await getVideoView(bvid);
    const pages = view.pages || [];
    const title = view.title || bvid;
    const artist = (view.owner && view.owner.name) || '未知UP主';
    const artwork = view.pic || '';
    if (!pages.length) {
      return [{ id: bvid + '|' + (view.cid || ''), bvid: bvid, cid: String(view.cid || ''), title: title, artist: artist, artwork: artwork, duration: view.duration || 0, album: title }];
    }
    return pages.map(function (p, i) {
      const partTitle = p.part || '';
      const t = partTitle ? title + ' - P' + (i + 1) + ' ' + partTitle : title + ' - P' + (i + 1);
      return { id: bvid + '|' + p.cid, bvid: bvid, cid: String(p.cid), title: t, artist: artist, artwork: artwork, duration: p.duration || 0, album: title };
    });
  }
  // 全量拉取收藏夹视频（多页）
  async function getAllFolderVideos(mediaId) {
    let page = 1; const all = [];
    while (true) {
      const data = await getFolderVideos(mediaId, page);
      const medias = data.medias || [];
      all.push.apply(all, medias);
      if (!data.has_more) break;
      page += 1;
      if (page > 50) break; // 安全上限
    }
    return all;
  }
  async function importMusicSheet(urlLike) {
    if (!urlLike) throw new Error('请提供收藏夹链接、视频链接或收藏夹 ID');
    // 1) 视频链接（支持多 P 分集导入为歌单）
    if (/BV[0-9A-Za-z]+/.test(String(urlLike))) {
      const list = await importVideo(urlLike);
      if (list && list.length) return list;
      throw new Error('该视频无可用分P信息，无法导入');
    }
    // 2) 收藏夹链接 / 收藏夹数字 ID（合并 bili.js 与本地插件的识别规则）
    const m = String(urlLike).match(/fid=(\d+)/)
      || String(urlLike).match(/favlist\/(\d+)/)
      || String(urlLike).match(/ml(\d+)/)
      || String(urlLike).match(/^\s*(\d+)\s*$/)
      || String(urlLike).match(/\/playlist\/pl(\d+)/i)
      || String(urlLike).match(/\/list\/ml(\d+)/i);
    if (!m) throw new Error('无法识别的收藏夹链接，请确认形如 .../favlist?fid=收藏夹ID，或直接输入收藏夹 ID');
    const mediaId = m[1];
    let sheetTitle = '导入的收藏夹';
    try {
      const folders = await getFavoriteFolders();
      for (let i = 0; i < folders.length; i++) {
        if (String(folders[i].id) === String(mediaId)) { sheetTitle = folders[i].title || sheetTitle; break; }
      }
    } catch (e) { /* 取不到标题不影响导入 */ }
    const medias = await getAllFolderVideos(mediaId);
    if (!medias.length) throw new Error('该收藏夹没有可导入的视频（可能是「私密收藏夹」请改为公开，或收藏夹为空）');
    const expanded = await Promise.all(medias.map(function (md) { return expandMedia(md, sheetTitle); }));
    return [].concat.apply([], expanded);
  }

  /* ===================== 评论（bili.js 原有） ===================== */
  const commentCursorCache = new Map();
  function formatComment(item) {
    return {
      id: item.rpid,
      nickName: (item.member && item.member.uname),
      avatar: (item.member && item.member.avatar),
      comment: (item.content && item.content.message),
      like: item.like,
      createAt: item.ctime * 1000,
      location: ((item.reply_control && item.reply_control.location || '').startsWith('IP属地：')) ? item.reply_control.location.slice(5) : undefined,
    };
  }
  async function getVideoDesc(musicItem) {
    const aid = musicItem.aid, bvid = musicItem.bvid;
    if (!aid && !bvid) return null;
    try {
      const cidRes = await getCid(bvid, aid);
      const desc = cidRes && cidRes.data && cidRes.data.desc;
      if (desc && String(desc).trim()) return String(desc).trim();
      return null;
    } catch (e) { return null; }
  }
  function buildDescComment(descText, musicItem) {
    if (!descText) return null;
    return { id: '__intro__', nickName: '📝 视频简介', comment: descText, avatar: musicItem.artwork || undefined };
  }
  async function getMusicComments(musicItem, page) {
    const aid = musicItem.aid;
    if (!aid) return { isEnd: true, data: [] };
    const currentPage = page || 1;
    const ps = 30;
    const cacheKey = String(aid);
    let next = currentPage === 1 ? 0 : (commentCursorCache.get(cacheKey) || 0);
    const params = { type: 1, oid: aid, mode: 3, next: next, ps: ps, plat: 1, web_location: 1315875, wts: Math.floor(Date.now() / 1000) };
    try {
      const res = (await axios.get(API_HOST + '/x/v2/reply/main', {
        params: params,
        headers: Object.assign({}, headers, { cookie: await getCookieString(), referer: 'https://www.bilibili.com/' }),
      })).data;
      let replies = [];
      let cursor = {};
      if (res.code === 0 && res.data) {
        replies = res.data.replies || [];
        cursor = res.data.cursor || {};
        if (typeof cursor.next === 'number') commentCursorCache.set(cacheKey, cursor.next);
      } else {
        console.warn('[getMusicComments] 接口异常 code=' + res.code + ' msg=' + res.message);
      }
      const comments = [];
      for (let i = 0; i < replies.length; ++i) {
        comments[i] = formatComment(replies[i]);
        if (replies[i].replies && replies[i].replies.length) comments[i].replies = replies[i].replies.map(formatComment);
      }
      if (currentPage === 1) {
        try {
          const desc = await getVideoDesc(musicItem);
          if (desc) { const dc = buildDescComment(desc, musicItem); if (dc) comments.unshift(dc); }
        } catch (e) { console.error('简介插入失败:', e.message); }
      }
      const hasMore = replies.length > 0 && (typeof cursor.next === 'number' && cursor.next > 0) && replies.length >= ps;
      return { isEnd: !hasMore, data: comments };
    } catch (error) {
      console.error('获取评论失败:', error.message);
      return { isEnd: true, data: [] };
    }
  }

  /* ===================== 字幕作为歌词（bili.js 原有，双语） ===================== */
  function secondsToLrcTime(sec) {
    if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    const ss = s.toFixed(2).padStart(5, '0');
    return `${String(m).padStart(2, '0')}:${ss}`;
  }
  function subtitleBodyToLrc(body) {
    if (!Array.isArray(body) || body.length === 0) return '';
    return body.map((item) => {
      const from = typeof item.from === 'number' ? item.from : parseFloat(item.from);
      return `[${secondsToLrcTime(from)}]${item.content || ''}`;
    }).join('\n');
  }
  async function getLyric(musicItem) {
    if (!isLoggedIn()) {
      // 诊断：明确告知用户当前插件是否真正读到了登录凭证，便于排查「歌词不显示」
      let diag = {};
      try {
        const v = getVars();
        diag = { hasSESSDATA: !!v.SESSDATA, hasCookie: !!v.cookie, hasBiliSessdata: !!v.biliSessdata, platform: plugin.platform };
      } catch (e) { diag = { readError: String(e && e.message) }; }
      console.warn('[getLyric] 未登录（当前插件[' + plugin.platform + ']未检测到 SESSDATA/cookie），跳过字幕获取 bvid=' + musicItem.bvid + ' aid=' + musicItem.aid + ' 检测到: ' + JSON.stringify(diag));
      return {};
    }
    console.log('[getLyric] 开始获取字幕 bvid=' + musicItem.bvid + ' aid=' + musicItem.aid + ' cid=' + musicItem.cid);
    try {
      let cid = musicItem.cid;
      const bvid = musicItem.bvid, aid = musicItem.aid;
      if (!cid) { const cidRes = await getCid(bvid, aid); cid = cidRes && cidRes.data && cidRes.data.cid; }
      if (!cid || (!aid && !bvid)) return {};
      const referer = bvid ? `https://www.bilibili.com/video/${bvid}` : 'https://www.bilibili.com/';
      const sessCookie = await getCookieString();
      const baseLrcHeaders = {
        'User-Agent': getUserUA(),
        referer: referer,
        origin: 'https://www.bilibili.com',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        cookie: sessCookie,
      };
      // 字幕接口策略（严格对齐 musicfree-bili 已验证可看歌词版本，这是 ground truth）：
      // ① 先试 /x/player/v2：无需 WBI 签名，仅登录态 Cookie + bvid/cid，最稳；
      // ② 兜底 /x/player/wbi/v2：带 WBI 签名，但**只传 bvid/cid，绝不挂 dm_img 系列风控参数**
      //    （dm_img_str/dm_cover_img_str/dm_img_inter 含 {}[]:, 等特殊字符，会干扰 wbi 签名校验，
      //     导致登录态下接口返回「空字幕列表」而非报错——表现为字幕静默不显示）。
      const queryParams = aid ? { aid: aid, cid: cid } : { bvid: bvid, cid: cid };
      let subtitles = [];
      try {
        const r1 = await axios.get(API_HOST + '/x/player/v2', { params: queryParams, headers: baseLrcHeaders });
        subtitles = (r1.data && r1.data.data && r1.data.data.subtitle && r1.data.data.subtitle.subtitles) || [];
        console.log('[getLyric] /x/player/v2 字幕数=' + subtitles.length);
      } catch (e) { console.warn('[getLyric] /x/player/v2 失败', e.message); }
      if (!subtitles.length) {
        try {
          const wts = String(Math.floor(Date.now() / 1000));
          const w_rid = await getWrid(Object.assign({}, queryParams, { wts }));
          const r2 = await axios.get(API_HOST + '/x/player/wbi/v2', {
            params: Object.assign({}, queryParams, { wts, w_rid }),
            headers: baseLrcHeaders,
          });
          subtitles = (r2.data && r2.data.data && r2.data.data.subtitle && r2.data.data.subtitle.subtitles) || [];
          console.log('[getLyric] /x/player/wbi/v2 兜底 字幕数=' + subtitles.length);
        } catch (e) { console.warn('[getLyric] /x/player/wbi/v2 兜底失败', e.message); }
      }
      console.log('[getLyric] 字幕列表条数=' + subtitles.length + (subtitles.length ? ' 语言=' + subtitles.map((s) => s.lan + '(' + s.lan_doc + ')').join(',') : '（本视频无字幕轨；AI 字幕需登录态且视频本身有字幕）'));
      if (subtitles.length === 0) return {};
      // 优先选 AI 字幕轨（ai-zh / ai-en），其次标准 zh/en，对齐 musicfree-bili（已验证可看歌词）
      const zhSub = subtitles.find((s) => /ai-zh/i.test(s.lan || ''))
        || subtitles.find((s) => /zh|cn/i.test(s.lan || ''));
      const enSub = subtitles.find((s) => /ai-en|en/i.test(s.lan || ''));
      async function fetchSubtitleBody(sub) {
        if (!sub || !sub.subtitle_url) return null;
        let u = sub.subtitle_url;
        if (u.startsWith('//')) u = 'https:' + u;
        if (!u.startsWith('http')) u = 'https://' + u;
        // 字幕 JSON 多数走公开 CDN（匿名可下），但 AI 字幕下载在部分情况下需带登录态 Cookie 才放行
        const r = (await axios.get(u, {
          headers: { 'User-Agent': getUserUA(), referer, cookie: await getCookieString() },
        })).data;
        return Array.isArray(r.body) ? r.body : null;
      }
      const zhBody = zhSub ? await fetchSubtitleBody(zhSub) : null;
      const enBody = enSub ? await fetchSubtitleBody(enSub) : null;
      if (!zhBody && !enBody) return {};
      const result = {};
      if (zhBody) { const lrc = subtitleBodyToLrc(zhBody); if (lrc) result.rawLrc = lrc; }
      if (enBody) { const translation = subtitleBodyToLrc(enBody); if (translation) result.translation = translation; }
      if (!result.rawLrc && !result.translation) {
        const picked = subtitles[0];
        const body = await fetchSubtitleBody(picked);
        if (body && body.length) result.rawLrc = subtitleBodyToLrc(body);
      }
      if (!result.rawLrc && !result.translation) return {};
      return result;
    } catch (error) {
      console.error('获取字幕失败:', error.message);
      return {};
    }
  }

  /* ===================== 插件导出对象 ===================== */
  var plugin = {
    platform: 'Bilibili',
    appVersion: '>=0.0',
    version: 'V0.0.7',
    author: 'tianpeng',
    cacheControl: 'no-store',
    // 更新链接：暂留空，待正式发布仓库确定后再填
    srcUrl: '',
    description:
      '在 MusicFree 搜索/播放 B站视频音频。基于 martin65536/bilibili.js 扩展，并集成本地 musicfree-bilibili 插件增强：\n' +
      '• 移动端兼容（IIFE + 纯 JS md5，无需 crypto-js/dayjs/he 等原生依赖）\n' +
      '• SESSDATA 三种格式自动提取（仅值/标准Cookie/冒号格式），也可填完整 cookie\n' +
      '• 「我的收藏夹」板块：登录后自动列出收藏夹并映射为歌单\n' +
      '• 多 P 分集展开：粘贴视频链接即把每 P 展开为独立音轨\n' +
      '• 21 个分区排行榜（新增翻唱/演奏）+ 入站必刷/每周必刷\n' +
      '• 移动端安全播放头（playurl 不挂 Cookie/Origin，CDN 仅 Referer+UA）\n' +
      '• 保留：双语字幕歌词、评论分页+视频简介、UP主作品、专辑名模板、多音质映射\n\n' +
      '【配置项】SESSDATA（或 cookie）可选：填了才能获取字幕/评论完整分页/导入私有收藏夹。',
    primaryKey: ['id', 'aid', 'bvid', 'cid'],
    supportedSearchType: ['music', 'album', 'artist'],
    userVariables: [
      {
        key: 'SESSDATA',
        name: 'SESSDATA Cookie（本地插件兼容）',
        hint: '可选。登录 B站 后复制 SESSDATA 值；也可直接粘贴完整 Cookie 或冒号格式（自动识别）。填了可解锁收藏夹/字幕/评论分页。',
      },
      {
        key: 'cookie',
        name: 'B站登录Cookie（bili.js 原字段）',
        hint: '可选。完整 cookie 整行值（含SESSDATA）。与 SESSDATA 二选一。',
      },
      {
        key: 'albumTemplate',
        name: '专辑名模板',
        hint: '可选。占位符：{bvid} {aid} {date} {duration} {durationMmSs} {artist} {title} {playCount} {likeCount} {coinCount} {favoriteCount} {danmakuCount} {replyCount} {shareCount} {category}。默认只显示BV号。',
      },
      {
        key: 'ua',
        name: 'User-Agent',
        hint: '可选。自定义请求的User-Agent。不填默认 Chrome 120。',
      },
    ],
    hints: {
      importMusicSheet: [
        '① B站视频链接（含多P分集），如 https://www.bilibili.com/video/BV1oLBXBiEW5，将逐集展开为歌单；',
        '② 收藏夹链接，形如 https://space.bilibili.com/你的UID/favlist?fid=收藏夹ID；',
        '③ 直接输入收藏夹数字 ID。',
        '获取字幕需在插件设置填 SESSDATA（含SESSDATA），匿名无法获取AI字幕。',
      ],
    },
    async search(keyword, page, type) {
      if (type === 'album' || type === 'music') return await searchAlbum(keyword, page);
      if (type === 'artist') return await searchArtist(keyword, page);
    },
    getMediaSource,
    getMusicInfo,
    getAlbumInfo,
    getArtistWorks,
    getTopLists,
    getTopListDetail,
    getMusicSheetInfo,
    importMusicSheet,
    getMusicComments,
    getLyric,
  };

  // 跨加载器导出：新协议用 module.exports，旧协议（移动端）用返回值
  if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = plugin;
  }
  if (typeof exports !== 'undefined') {
    exports.default = plugin;
  }
  return plugin;
})();
