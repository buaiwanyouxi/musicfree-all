/*
 * MusicFree 插件 —— 哔哩哔哩（B站）音频源
 * -------------------------------------------------------------
 * 功能：将登录用户的 B站收藏夹映射为「歌单」，收藏夹内视频以音频模式播放。
 * 技术约束（来自需求）：
 *   1) 不硬编码 Cookie，统一从 userVariables.SESSDATA 读取；
 *   2) 不使用 async 箭头函数（安卓 Hermes 引擎不支持），全部用 async function / 方法简写；
 *   3) 仅依赖沙箱内置 axios，不引入平台特定库；
 *   4) 音频 URL 有时效性，cacheControl 设为 no-store，每次播放实时获取。
 *
 * 所有接口地址均来自对 B站页面的直接观察（需求文档已给出），未做任何网络搜索猜测。
 */

const axios = require('axios');
const crypto = require('crypto');

const API_HOST = 'https://api.bilibili.com';
// 桌面/安卓统一伪装为桌面 Chrome，规避部分接口的 UA 风控
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* ===================== 榜单静态配置 ===================== */
// 各分区排行榜的 rid 映射（B站 region id）。「音乐」类分区排在靠前，便于音频场景快速定位。
const BILI_REGIONS = [
  { rid: 3, name: '音乐' },
  { rid: 31, name: '翻唱' },
  { rid: 193, name: '演奏' },
  { rid: 1, name: '动画' },
  { rid: 168, name: '国创' },
  { rid: 4, name: '游戏' },
  { rid: 119, name: '鬼畜' },
  { rid: 129, name: '舞蹈' },
  { rid: 160, name: '生活' },
  { rid: 211, name: '美食' },
  { rid: 36, name: '知识' },
  { rid: 188, name: '科技' },
  { rid: 234, name: '运动' },
  { rid: 223, name: '汽车' },
  { rid: 217, name: '动物圈' },
  { rid: 155, name: '时尚' },
  { rid: 5, name: '娱乐' },
  { rid: 181, name: '影视' },
  { rid: 0, name: '全站' },
  { rid: 0, name: '原创', type: 'origin' },
  { rid: 0, name: '新人', type: 'rookie' },
];

// 榜单分组图标（B站官方静态资源，白底加载更快）
const ICON_PRECIOUS =
  'https://s1.hdslb.com/bfs/static/jinkela/popular/assets/icon_history.png';
const ICON_WEEKLY =
  'https://s1.hdslb.com/bfs/static/jinkela/popular/assets/icon_weekly.png';
const ICON_RANK =
  'https://s1.hdslb.com/bfs/static/jinkela/popular/assets/icon_rank.png';

/* ===================== Cookie / 请求头 ===================== */

function getRawCookie() {
  try {
    if (typeof env !== 'undefined' && env.getUserVariables) {
      const vars = env.getUserVariables();
      if (vars && vars.SESSDATA) return vars.SESSDATA;
    }
  } catch (e) {
    /* 忽略：本地测试环境无 env */
  }
  return '';
}

// 兼容三种粘贴方式：①仅 SESSDATA 值 ②标准完整 Cookie(=) ③浏览器复制的冒号格式(:)
// 关键：SESSDATA 值常含 URL 编码字符（如 %2C 表示逗号、%2A 表示 *），
// 必须解码为原始字符，否则 B站 会判定 Cookie 非法、返回 -101 未登录。
function normalizeCookie(raw) {
  if (!raw) return '';
  if (raw.indexOf('SESSDATA=') !== -1) return decodeSess(raw); // 标准完整 Cookie
  if (raw.indexOf('SESSDATA:') === -1 && raw.indexOf('=') === -1) {
    return 'SESSDATA=' + safeDecode(raw); // 仅 SESSDATA 值
  }
  if (raw.indexOf('SESSDATA:') !== -1) {
    // 冒号分隔格式：SESSDATA:xxx;DedeUserID:xxx → 转为标准 = 格式并解码 SESSDATA
    const out = raw
      .split(';')
      .map(function (pair) {
        const idx = pair.indexOf(':');
        if (idx === -1) return pair.trim();
        return pair.slice(0, idx).trim() + '=' + pair.slice(idx + 1).trim();
      })
      .join(';');
    return decodeSess(out);
  }
  return decodeSess(raw);
}

// 仅对 SESSDATA 值做 URL 解码（其余 Cookie 字段保持原样，避免误伤）
function decodeSess(cookieStr) {
  return cookieStr.replace(/(SESSDATA=)([^;]+)/, function (_, p, v) {
    return p + safeDecode(v);
  });
}

function safeDecode(s) {
  try {
    // 解码一次即可；若已解码（无 %）则原样返回，避免二次解码破坏
    return s.indexOf('%') === -1 ? s : decodeURIComponent(s);
  } catch (e) {
    return s;
  }
}

function buildCookie() {
  return normalizeCookie(getRawCookie());
}

// 从 Cookie 中提取用户 UID（mid），用于收藏夹列表接口（list-all 必须带 mid）
function getMidFromCookie() {
  const raw = getRawCookie();
  if (!raw) return '';
  const m = raw.match(/DedeUserID\s*[:=]\s*([^;\s]+)/);
  return m ? m[1] : '';
}

function makeHeaders(withBuvid) {
  if (typeof withBuvid === 'undefined') withBuvid = true;
  const cookie = buildCookie();
  const headers = {
    'User-Agent': UA,
    Referer: 'https://www.bilibili.com',
    Origin: 'https://www.bilibili.com',
  };
  // buvid 指纹用于缓解公开读取接口的风控；
  // 但 playurl 接口对 buvid 校验极严，附加后会触发 B站 HTTP 412，故播放地址请求须关闭。
  let c = cookie;
  if (withBuvid && _buvidCache) c = (c ? c + '; ' : '') + _buvidCache;
  if (c) headers['Cookie'] = c;
  return headers;
}

/* buvid 指纹：B站 对匿名请求有风控（-352/-412），附加 buvid3/4 可显著降低触发概率。
   参考 wbl.js 的 getCookie/finger.spi 流程；结果缓存 24h。 */
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
    /* 指纹获取失败不影响主流程，仅风控概率略升 */
  }
}

/* ===================== WBI 签名（B站 风控接口必备） ===================== */
// B站 自 2023 年起对收藏夹等接口启用 WBI 签名，未带 w_rid 会返回 -400。
// 以下实现依据官方公开算法，已在本地用真实账号验证（acc/info 返回 0）。

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

function _md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

let _wbiMixinKeyCache = '';
let _wbiMixinKeyTs = 0;

// 获取并缓存 mixinKey（10 分钟有效，避免每次请求都拉 nav）
async function getWbiMixinKey() {
  const now = Date.now();
  if (_wbiMixinKeyCache && now - _wbiMixinKeyTs < 10 * 60 * 1000) {
    return _wbiMixinKeyCache;
  }
  const resp = await axios.get(API_HOST + '/x/web-interface/nav', {
    headers: makeHeaders(),
  });
  const data = resp.data || {};
  if (!data.data || !data.data.wbi_img) {
    throw new Error('获取 WBI 密钥失败（可能未登录）');
  }
  const img = data.data.wbi_img.img_url.split('/').pop().split('.')[0];
  const sub = data.data.wbi_img.sub_url.split('/').pop().split('.')[0];
  _wbiMixinKeyCache = _getMixinKey(img + sub);
  _wbiMixinKeyTs = now;
  return _wbiMixinKeyCache;
}

// 给参数追加 wts/w_rid，返回可直接传给 axios params 的对象
async function signParams(params) {
  const mixinKey = await getWbiMixinKey();
  const wts = Math.floor(Date.now() / 1000);
  const merged = Object.assign({}, params, { wts: wts });
  const keys = Object.keys(merged).sort();
  let q = '';
  keys.forEach(function (k, i) {
    if (i) q += '&';
    q +=
      encodeURIComponent(k) +
      '=' +
      encodeURIComponent(String(merged[k]).replace(CHR_FILTER, ''));
  });
  return Object.assign({}, params, { wts: wts, w_rid: _md5(q + mixinKey) });
}

/* ===================== 错误标准化 ===================== */

function wrapError(label, data) {
  const code = data && data.code;
  const msg = (data && data.message) || '';
  // 未登录 / 登录失效
  if (code === -101 || code === -111 || code === -412) {
    return new Error('认证失败，请检查 SESSDATA Cookie 是否有效');
  }
  // 匿名风控（-352/-799 等）：入站必刷/每周必刷等个性化榜单需登录态，引导填写 Cookie
  if (code === -352 || code === -799 || /风控|验证/.test(msg)) {
    return new Error('该榜单触发了平台风控，请先在插件设置中填写 SESSDATA Cookie（登录态）后重试；若仍失败，可能是当前网络环境被风控，建议切换网络');
  }
  // 私密收藏夹
  if (code === -404 || /私密|private/i.test(msg)) {
    return new Error('无法访问私密收藏夹');
  }
  // 会员 / 版权限制
  if (/vip|会员|版权|coin|充电/.test(msg)) {
    return new Error('该视频需要大会员权限或存在区域限制，无法播放');
  }
  return new Error(label + '失败：' + (msg || code || '未知错误'));
}

/* ===================== B站 API 封装 ===================== */

// 获取当前登录用户信息（校验 Cookie 是否有效）
async function getUserInfo() {
  const resp = await axios.get(API_HOST + '/x/space/myinfo', {
    headers: makeHeaders(),
  });
  const data = resp.data || {};
  if (data.code !== 0) throw wrapError('获取用户信息', data);
  return data.data;
}

// 获取当前登录用户的 UID（mid）。
// 收藏夹列表接口 list-all 仅需 up_mid，经验证无需 WBI 签名；
// 此函数同时用于「已填 Cookie 但拿不到 mid」时判定 SESSDATA 是否失效。
async function getLoginMid() {
  try {
    const resp = await axios.get(API_HOST + '/x/web-interface/nav', {
      headers: makeHeaders(),
      timeout: 10000,
    });
    const data = resp.data || {};
    if (data.code !== 0 || !data.data) return '';
    return data.data.mid || '';
  } catch (e) {
    return '';
  }
}

// 获取用户创建的全部收藏夹
// 关键修复（v1.1.4）：list-all 接口仅需 up_mid，经验证【无需 WBI 签名】；
// 旧实现强制对 list-all 做 WBI 签名（nav 取密钥 + md5 + 签名请求），
// 在移动端（Hermes 引擎 + 真实手机网络）易触发风控/-400 导致「收藏夹加载失败」，
// 而数据中心沙箱因 IP 差异反而能成功，造成「沙箱通过、设备失败」的假象。
// 现去掉签名，并优先从 Cookie 解析 DedeUserID，取不到则回退 nav 取 mid，提升健壮性。
async function getFavoriteFolders() {
  const cookie = buildCookie();
  if (!cookie) {
    throw new Error('请先在插件设置中填写 B站 SESSDATA Cookie，以加载「我的收藏夹」');
  }
  let mid = getMidFromCookie();
  if (!mid) mid = await getLoginMid();
  if (!mid) {
    // 已填 Cookie 但拿不到 mid：通常是 SESSDATA 失效或 nav 异常
    throw new Error('未能获取登录用户 UID，请确认 SESSDATA Cookie 是否有效（可重新从浏览器复制）');
  }
  const params = { up_mid: mid }; // 注意：接口参数为 up_mid，非 mid（传 mid 会 -400）
  const resp = await axios.get(
    API_HOST + '/x/v3/fav/folder/created/list-all',
    { params: params, headers: makeHeaders(), timeout: 10000 }
  );
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
// 对齐社区成熟实现（sinmite/bilibili）：resource/list 仅需 media_id + platform=web + 分页，
// 无需 WBI 签名、无需 order/type/tid —— 多余参数反而增加风控失败面。
async function getFolderVideos(mediaId, page) {
  const cookie = buildCookie();
  if (!cookie) {
    throw new Error('请先在插件设置中填写 B站 SESSDATA Cookie');
  }
  const params = {
    media_id: mediaId,
    pn: page || 1,
    ps: 20,
    platform: 'web', // 必需：影响返回数据结构
  };
  const headers = makeHeaders();
  const maxRetry = 3;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    try {
      const resp = await axios.get(API_HOST + '/x/v3/fav/resource/list', {
        params: params,
        headers: headers,
        timeout: 10000,
      });
      const data = resp.data || {};
      if (data.code === 0) {
        return data.data || {};
      }
      // 私密收藏夹：明确指引用户去 B站 改为公开
      if (data.code === -403) {
        throw new Error('该收藏夹为「私密收藏夹」，请前往 B站 将其改为「公开」后再导入/播放');
      }
      // 风控：直接抛出，不再重试
      if (data.code === -412) {
        throw new Error('访问收藏夹触发平台风控，请稍后重试；若持续失败，建议切换网络或重新登录');
      }
      lastErr = new Error('获取收藏夹视频失败：' + (data.message || ('code ' + data.code)));
    } catch (e) {
      lastErr = e;
    }
    // 重试前等待 1 秒
    if (attempt < maxRetry) {
      await new Promise(function (r) { setTimeout(r, 1000); });
    }
  }
  throw lastErr || new Error('获取收藏夹视频失败');
}

// 获取视频详情（含全部分P的 cid / 标题 / 时长）
async function getVideoView(bvid) {
  const resp = await axios.get(API_HOST + '/x/web-interface/view', {
    params: { bvid: bvid },
    headers: makeHeaders(),
  });
  const data = resp.data || {};
  if (data.code !== 0) throw wrapError('获取视频信息', data);
  return data.data;
}

// 获取视频音频流播放地址
async function getVideoPlayUrl(bvid, cid) {
  // 对齐成熟可用的参考实现：playurl 请求不携带 Cookie / buvid / Origin，
  // 仅取 DASH 音频流（fnval=16）。普通视频的音频直链无需登录即可获取，
  // 不附带 Cookie 与 Origin 可彻底规避 B站 对 playurl 的 HTTP 412 风控，
  // 也避免移动端播放器把 Origin 头转发给音频 CDN 时被拦截（403）导致「取得到地址却放不出声」。
  const params = { bvid: bvid, cid: cid, fnval: 16 };
  const resp = await axios.get(API_HOST + '/x/player/playurl', {
    params: params,
    headers: {
      'User-Agent': UA,
      Referer: 'https://www.bilibili.com',
    },
  });
  const data = resp.data || {};
  if (data.code !== 0) throw wrapError('获取播放地址', data);
  return data.data;
}

/* ===================== 数据映射 ===================== */

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

// 取视频首个分P的 cid：resource/list 返回里字段名可能是 cid / uppermost_cid / first_cid
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
  if ((media.cnt || media.page_count || 1) <= 1) {
    return Promise.resolve([base]);
  }
  return getVideoView(media.bvid)
    .then(function (view) {
      const pages = view.pages || [];
      if (!pages.length) return [base];
      return pages.map(function (p, i) {
        const partTitle = p.part || '';
        const title =
          pages.length > 1
            ? media.title + ' - P' + (i + 1) + (partTitle ? ' ' + partTitle : '')
            : media.title;
        return Object.assign({}, base, {
          id: media.bvid + '|' + p.cid,
          cid: String(p.cid),
          title: title,
          duration: p.duration || base.duration,
        });
      });
    })
    .catch(function () {
      // 单条视频信息获取失败不影响整个歌单
      return [base];
    });
}

/* ===================== 音质选择 ===================== */

// 按 MusicFree quality 从 dash.audio 中挑选（已按带宽降序：索引0=最高）
function pickByQuality(audios, quality) {
  if (!audios.length) return null;
  const sorted = audios.slice().sort(function (a, b) {
    return (b.bandwidth || 0) - (a.bandwidth || 0);
  });
  switch (quality) {
    case 'low':
      return sorted[sorted.length - 1];
    case 'standard':
      return sorted[Math.min(1, sorted.length - 1)];
    case 'super':
    case 'high':
    default:
      return sorted[0];
  }
}

function audioUrlOf(audio) {
  return audio.baseUrl || audio.base_url || '';
}

// 歌单/榜单详情通用拉取：分页获取收藏夹视频，逐条分P展开
async function loadSheetVideos(sheetItem, page) {
  const mediaId = sheetItem.id;
  const sheetTitle = sheetItem.title || '';
  const data = await getFolderVideos(mediaId, page || 1);
  const medias = data.medias || [];
  const expanded = await Promise.all(
    medias.map(function (m) {
      return expandMedia(m, sheetTitle);
    })
  );
  const musicList = [].concat.apply([], expanded);
  const hasMore = data.has_more === true || data.has_more === 1;
  return {
    isEnd: !hasMore,
    musicList: musicList,
    sheetItem: sheetItem,
  };
}

/* ===================== 公开榜单（免登录）数据映射 ===================== */

// 将 入站必刷 / 每周必刷 / 各分区排行榜 列表项统一映射为 MusicFree 音轨
function formatPopularMedia(item) {
  return {
    id: String(item.aid || item.bvid),
    bvid: item.bvid,
    cid: item.cid ? String(item.cid) : (item.first_cid ? String(item.first_cid) : ''),
    title: item.title || '未知',
    artist: (item.owner && item.owner.name) || item.author || item.uploader || '未知UP主',
    artwork: item.pic || item.cover || '',
    duration: item.duration || 0,
    album: '',
    pageCount: 1,
  };
}

// 公开榜单详情拉取：URL 形如 /x/web-interface/<id>，id 已含查询串。
// 入站必刷需分页；每周必刷/各分区为固定榜单，直接一次性返回。
async function getPublicTopListDetail(topListItem, page) {
  const id = topListItem.id || '';
  let url;
  if (id.indexOf('popular/precious') === 0) {
    // 入站必刷（个性化推荐）支持分页
    url = API_HOST + '/x/web-interface/popular/precious?page_size=20&page=' + (page || 1);
  } else {
    // 各分区排行榜 / 每周必刷：id 直接拼接
    url = API_HOST + '/x/web-interface/' + id;
  }
  await ensureBuvid();
  const resp = await axios.get(url, { headers: makeHeaders() });
  const data = resp.data || {};
  if (data.code && data.code !== 0) throw wrapError('获取榜单详情', data);
  const d = data.data || {};
  const list = d.list || d.archives || [];
  if (!list.length) {
    throw new Error('该榜单暂无数据（入站必刷需先登录，或榜单已更新）');
  }
  const musicList = list.map(formatPopularMedia);
  const isPaged = id.indexOf('popular/precious') === 0;
  const isEnd = isPaged
    ? (page || 1) * 20 >= (d.page && d.page.count ? d.page.count : list.length)
    : true;
  return { isEnd: isEnd, musicList: musicList, sheetItem: topListItem };
}

/* ===================== 插件导出对象 ===================== */

module.exports = {
  platform: 'Bilibili',
  version: '1.1.4',
  author: '船长',
  description: 'B站音频源：入站必刷/每周必刷/各分区排行榜/我的收藏夹，以音频模式播放（仅供个人学习）',
  // 远程更新地址（Gitee raw 直链，MusicFree 据此检测插件更新）
  srcUrl: 'https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-bilibili/bilibili.plugin.js',
  cacheControl: 'no-store', // 音频 URL 有时效性，禁止缓存
  primaryKey: ['bvid', 'cid'],
  supportedSearchType: ['music'],
  userVariables: [
    {
      key: 'SESSDATA',
      name: 'SESSDATA Cookie',
      hint: '登录 B站 后，从浏览器开发者工具「Application → Cookies → SESSDATA」复制其值；也可直接粘贴完整 Cookie 字符串。未填写时仍可浏览「每周必刷/各分区排行榜」等公开榜单；填写后额外解锁「我的收藏夹」与「入站必刷」。',
    },
  ],
  hints: {
    importMusicSheet: [
      '支持三类导入：',
      '① B站视频链接（含多P分集），如 https://www.bilibili.com/video/BV1oLBXBiEW5，将逐集展开为歌单；',
      '② 收藏夹链接，形如 https://space.bilibili.com/你的UID/favlist?fid=收藏夹ID；',
      '③ 直接输入收藏夹数字 ID。',
    ],
  },

  // 榜单/歌单入口：返回 入站必刷 / 每周必刷 / 各分区排行榜 / 我的收藏夹 四大板块。
  // 公开板块（前三项）免登录即可展示；我的收藏夹需登录，异常时静默降级不阻断其余板块。
  async getTopLists() {
    // 1) 入站必刷（个性化推荐，需登录）
    const precious = {
      title: '入站必刷',
      data: [
        {
          id: 'popular/precious',
          title: '入站必刷',
          coverImg: ICON_PRECIOUS,
        },
      ],
    };

    // 2) 每周必刷（每周必看系列，公开）
    let weekly = { title: '每周必刷', data: [] };
    try {
      await ensureBuvid();
      const resp = await axios.get(
        API_HOST + '/x/web-interface/popular/series/list',
        { headers: makeHeaders() }
      );
      const list = (resp.data && resp.data.data && resp.data.data.list) || [];
      weekly.data = list.slice(0, 8).map(function (s) {
        return {
          id: 'popular/series/one?number=' + s.number,
          title: s.subject,
          description: s.name,
          coverImg: ICON_WEEKLY,
        };
      });
    } catch (e) {
      /* 公开接口异常不影响其余板块 */
    }

    // 3) 各分区排行榜（公开）
    const ranking = {
      title: '各分区排行榜',
      data: BILI_REGIONS.map(function (r) {
        const type = r.type ? '&type=' + r.type : '&type=all';
        return {
          id: 'ranking/v2?rid=' + r.rid + type,
          title: r.name,
          coverImg: ICON_RANK,
        };
      }),
    };

    // 4) 我的收藏夹（需登录）
    let fav = { title: '我的收藏夹', data: [] };
    try {
      const folders = await getFavoriteFolders();
      fav.data = folders.map(mapFolderToSheet);
      if (!fav.data.length) {
        // 已登录但无收藏夹：给出说明项（非错误，不影响其余板块）
        fav.data.push({
          id: '__fav_empty__',
          title: '（未检测到收藏夹）',
          coverImg: ICON_RANK,
          description: '尚未创建收藏夹，请前往 B站 创建后重试',
          count: 0,
        });
      }
    } catch (e) {
      // 收藏夹加载失败（多为 SESSDATA 无效/未填写）：给出可见提示而非静默空列表
      fav.data = [
        {
          id: '__fav_error__',
          title: '⚠️ 收藏夹加载失败',
          coverImg: ICON_RANK,
          description: (e && e.message) ? e.message : '请检查插件设置中的 SESSDATA 是否有效',
          count: 0,
        },
      ];
    }

    return [precious, weekly, ranking, fav];
  },

  // 歌单详情：返回某个收藏夹内的视频列表（含分P展开）
  async getMusicSheetInfo(sheetItem, page) {
    const id = String(sheetItem.id || '');
    if (id.indexOf('__') === 0) {
      throw new Error(sheetItem.description || '该收藏夹项无法加载');
    }
    return loadSheetVideos(sheetItem, page);
  },

  // 榜单详情：按 id 路由——数字 id 走收藏夹；其余走公开榜单接口
  async getTopListDetail(topListItem, page) {
    const id = String(topListItem.id || '');
    // 提示类特殊项（加载失败/空）：短路，给出明确说明而非发起无效请求
    if (id === '__fav_error__' || id === '__fav_empty__' || id.indexOf('__') === 0) {
      throw new Error(topListItem.description || '该收藏夹项无法加载');
    }
    if (/^\d+$/.test(id)) {
      // 用户收藏夹
      return loadSheetVideos(topListItem, page);
    }
    return getPublicTopListDetail(topListItem, page);
  },

  // 核心：获取音频播放地址（DASH 音频流，按音质挑选最高码率）
  async getMediaSource(musicItem, quality) {
    const bvid = musicItem.bvid;
    let cid = musicItem.cid;
    if (!cid) {
      const view = await getVideoView(bvid);
      const firstPage = (view.pages && view.pages[0]) || {};
      cid = firstPage.cid;
    }
    if (!cid) throw new Error('无法获取视频分P信息（cid 缺失）');

    const playData = await getVideoPlayUrl(bvid, cid);
    const dash = playData.dash;
    if (dash && dash.audio && dash.audio.length) {
      const chosen = pickByQuality(dash.audio, quality);
      const url = audioUrlOf(chosen);
      if (!url) throw new Error('未找到可用的音频流');
      return {
        url: url,
        headers: {
          Referer: 'https://www.bilibili.com/video/' + (bvid || ''),
          'User-Agent': UA,
        },
      };
    }
    // 兼容旧版 durl 格式
    if (playData.durl && playData.durl.length) {
      return {
        url: playData.durl[0].url,
        headers: {
          Referer: 'https://www.bilibili.com/video/' + (bvid || ''),
          'User-Agent': UA,
        },
      };
    }
    throw new Error('未找到可用的音频流');
  },

  // 补全单曲信息（点击播放前可选调用）
  async getMusicInfo(musicItem) {
    const view = await getVideoView(musicItem.bvid);
    const owner = view.owner || {};
    const pages = view.pages || [];
    let page = null;
    if (musicItem.cid) {
      for (let i = 0; i < pages.length; i++) {
        if (String(pages[i].cid) === String(musicItem.cid)) {
          page = pages[i];
          break;
        }
      }
    }
    if (!page) page = pages[0] || {};
    return {
      title: view.title,
      artist: owner.name || musicItem.artist,
      artwork: view.pic || musicItem.artwork,
      duration: page.duration || view.duration || musicItem.duration,
      album: musicItem.album || '',
    };
  },

  // 搜索 B站 视频。自 2023 起搜索接口启用 WBI 签名，这里复用 signParams 生成 w_rid，
  // 规避 -412 风控；未登录（无 Cookie）时仍可搜索，但可能受频控。
  async search(query, page, type) {
    if (type && type !== 'music') return { isEnd: true, data: [] };
    const signed = await signParams({
      keyword: query,
      search_type: 'video',
      view_type: 'hot_rank',
      order: 'totalrank',
      page: page || 1,
    });
    await ensureBuvid();
    // 搜索接口要求 search.bilibili.com 来源，否则匿名请求被返回空结果
    const searchHeaders = Object.assign({}, makeHeaders(), {
      Referer: 'https://search.bilibili.com',
      Origin: 'https://search.bilibili.com',
    });
    const resp = await axios.get(API_HOST + '/x/web-interface/search/type', {
      params: signed,
      headers: searchHeaders,
    });
    const data = resp.data || {};
    if (data.code && data.code !== 0) {
      throw wrapError('搜索', data);
    }
    const videos = (data.data && data.data.result) || [];
    const data_out = videos.map(function (v) {
      const titleRaw = v.title || v.name || '未知';
      return {
        id: String(v.aid || v.bvid),
        bvid: v.bvid,
        cid: v.cid ? String(v.cid) : (v.first_cid ? String(v.first_cid) : ''),
        title: String(titleRaw).replace(/<[^>]+>/g, ''),
        artist: v.author || (v.owner && v.owner.name) || '未知UP主',
        artwork: v.pic || '',
        duration: v.duration || 0,
        album: '',
        pageCount: 1,
      };
    });
    return {
      isEnd: data_out.length < 20,
      data: data_out,
    };
  },

  // 通过视频链接（BV 号）导入：单 P 直接成曲，多 P 逐集展开为歌单
  // 例：https://www.bilibili.com/video/BV1oLBXBiEW5（含 100 个分P）
  async importVideo(urlLike) {
    const m = String(urlLike).match(/BV[0-9A-Za-z]+/);
    if (!m) return null;
    const bvid = m[0];
    const view = await getVideoView(bvid);
    const pages = view.pages || [];
    const title = view.title || bvid;
    const artist = (view.owner && view.owner.name) || '未知UP主';
    const artwork = view.pic || '';
    if (!pages.length) {
      // 兜底：无分P 信息时用首条 cid
      return [{
        id: bvid + '|' + (view.cid || ''),
        bvid: bvid,
        cid: String(view.cid || ''),
        title: title,
        artist: artist,
        artwork: artwork,
        duration: view.duration || 0,
        album: title,
      }];
    }
    // 多 P：每一 P 生成一个独立音轨，标题含「P序号 + 分集名」
    return pages.map(function (p, i) {
      const partTitle = p.part || '';
      const t = partTitle
        ? title + ' - P' + (i + 1) + ' ' + partTitle
        : title + ' - P' + (i + 1);
      return {
        id: bvid + '|' + p.cid,
        bvid: bvid,
        cid: String(p.cid),
        title: t,
        artist: artist,
        artwork: artwork,
        duration: p.duration || 0,
        album: title,
      };
    });
  },

  // 通过链接/ID 导入歌单
  async importMusicSheet(urlLike) {
    if (!urlLike) {
      throw new Error('请提供收藏夹链接、视频链接或收藏夹 ID');
    }
    // 1) 视频链接（支持多 P 分集导入为歌单）
    if (/BV[0-9A-Za-z]+/.test(String(urlLike))) {
      const list = await this.importVideo(urlLike);
      if (list && list.length) return list;
      throw new Error('该视频无可用分P信息，无法导入');
    }
    // 2) 收藏夹链接 / 收藏夹数字 ID
    const m =
      String(urlLike).match(/fid=(\d+)/) ||
      String(urlLike).match(/favlist\/(\d+)/) ||
      String(urlLike).match(/ml(\d+)/) ||
      String(urlLike).match(/(\d{6,})/); // 兜底：参考成熟实现，支持直接输入收藏夹数字 ID
    if (!m) {
      throw new Error('无法识别的收藏夹链接，请确认形如 .../favlist?fid=收藏夹ID，或直接输入收藏夹 ID');
    }
    const mediaId = m[1];
    let sheetTitle = '导入的收藏夹';
    // 仅用于匹配更友好的标题；失败不影响导入主体（去除对 getFavoriteFolders 的强依赖）
    try {
      const folders = await getFavoriteFolders();
      for (let i = 0; i < folders.length; i++) {
        if (String(folders[i].id) === String(mediaId)) {
          sheetTitle = folders[i].title || sheetTitle;
          break;
        }
      }
    } catch (e) {
      /* 取不到标题不影响导入 */
    }
    const data = await getFolderVideos(mediaId, 1);
    const medias = data.medias || [];
    if (!medias.length) {
      throw new Error('该收藏夹没有可导入的视频（可能是「私密收藏夹」请改为公开，或收藏夹为空）');
    }
    const expanded = await Promise.all(
      medias.map(function (md) {
        return expandMedia(md, sheetTitle);
      })
    );
    return [].concat.apply([], expanded);
  },
};
