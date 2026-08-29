// 布谷音乐 MusicFree 插件
// 站点: https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@main/musicfree-buguyy/buguyy.js (在线音乐试听与无损音乐下载平台, Nuxt 3 SPA)
// 数据源: 酷我音乐 (KuWo)。搜索/榜单/播放接口均为站点代理，音频为酷我 CDN 直链。
//
// 多平台扩展 (0.0.3):
//   排行榜: 网易云 / QQ / 酷我 / 酷狗 官方榜 (汽水音乐无公开 Web 数据源, 未接入)
//   热门歌单: 网易云 (全量可播) / QQ (卡片, 详情需登录) / 酷我 (前20首) / 酷狗 (卡片, 详情需登录)
//   非原生歌曲播放/歌词: 跨源搜索兜底 (按歌名+歌手搜同名酷我歌曲, 用户确认方案)
//   歌词三级兜底 (0.0.5): 歌词网 followlyrics.com — 酷我 lrc 与布谷镜像均落空时按歌名搜 LRC (修复官方插件删换行压扁 bug)
//
// 已观察并验证的接口:
//   [buguyy.top]  GET /api/search?keyword=  搜索 最多50条无翻页 {success,data:[{id,title,singer,picurl,about}]}
//                 GET /api/geturl?id=      播放直链 {success,url,lrc} (id 为酷我 rid)
//                 GET /api/hotlist /api/newlist /api/random /api/heji?cid=&page=
//   [music.163.com SSR]  /playlist?id=  ld+json MusicPlaylist + #song-list-pre-cache
//                 /song?id=  ld+json MusicRecording + music:duration
//                 /discover/playlist/  #m-pl-container 热门歌单卡片
//   [y.qq.com SSR]  /n/ryqq_v2/toplist/<topId>  INITIAL_DATA.songInfoList (top20/页)
//                 /n/ryqq_v2/category  INITIAL_DATA.playlist (20 歌单卡)
//                 歌单详情页为纯 SPA (ag-1 加密 API), 无法离线解析
//   [kuwo.cn]  GET /rankList  SSR __NUXT__ bangMenu (榜单菜单)
//              GET /api/www/bang/bang/musicList?bangId=<sourceid>&pn=&rn=20  需 Secret 头 (算法已移植)
//              GET /  SSR __NUXT__ playlist.list (11 热门歌单卡)
//              GET /playlist_detail/<id>  SSR __NUXT__ playListInfo (前20首)
//   [kugou.com SSR]  /yy/rank/home/<page>-<rankid>.html  内嵌歌曲 22首/页
//                 /yy/special/index/1-<cid>-0.html  歌单卡片 (songlist 详情需登录)
//
// 作者: tianpeng (参考船长原版; 0.0.3 扩展多平台官方榜与热门歌单)
const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@main/musicfree-buguyy/buguyy.js';
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UA163 =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function stdHeaders() {
    return {
        'User-Agent': UA,
        Referer: BASE + '/',
        Accept: 'application/json, text/plain, */*'
    };
}

async function apiGet(path, params) {
    const res = await axios.get(BASE + path, { params, headers: stdHeaders(), timeout: 10000 });
    const data = res.data;
    if (!data || data.success === false) {
        throw new Error((data && data.message) || '接口返回失败');
    }
    return data;
}

// 搜索/榜单项 -> IMusicItem; 保留 about(歌词原文) 供 getLyric 使用
function toMusicItem(it) {
    return {
        id: String(it.id),
        title: it.title || '未知标题',
        artist: it.singer || '未知歌手',
        artwork: it.picurl || '',
        about: it.about || ''
    };
}

// 清洗 LRC 文本: <br> 转换行, 过滤“歌词获取失败”占位
function cleanLrc(text) {
    if (!text) return '';
    let lrc = String(text).replace(/<br\s*\/?>/gi, '\n').trim();
    if (lrc.indexOf('歌词获取失败') !== -1) return '';
    // 占位文本识别: 无时间戳行且内容过短 → 视为无歌词 (如"暂未发现歌词信息"), 交给调用方兜底
    if (lrc.length < 50 && !/^\s*\[\d/m.test(lrc)) return '';
    return lrc;
}

// HTML 实体还原 (预缓存列表标题用)
function unescapeHtml(s) {
    if (!s) return '';
    return String(s)
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

// ===================== 跨源搜索兜底 =====================
// 非 buguyy 原生歌曲 (如网易云/QQ/酷狗榜歌) 的播放/歌词: 用布谷 /api/search 按歌名(+歌手) 搜同名歌曲,
// 返回命中的酷我条目 {id,title,singer,picurl,about}。找不到则抛错。
async function crossResolve(musicItem) {
    const kw = (musicItem.title || '').trim();
    if (!kw) throw new Error('歌曲标题为空, 无法检索音源');
    const data = await apiGet('/api/search', { keyword: kw });
    const list = Array.isArray(data.data) ? data.data : [];
    if (!list.length) throw new Error('未找到可用音源: ' + musicItem.title);
    const artist = ((musicItem.artist || '').split(/[\/，,、&\s]+/)[0] || '').trim();
    let best = null;
    let bestScore = -1;
    for (const it of list) {
        const t = (it.title || '').replace(/\s+/g, '');
        const k = kw.replace(/\s+/g, '');
        let s = 0;
        if (t === k) s += 4;
        else if (t.indexOf(k) !== -1 || k.indexOf(t) !== -1) s += 2;
        if (artist && (it.singer || '').indexOf(artist) !== -1) s += 3;
        if (s > bestScore) {
            bestScore = s;
            best = it;
        }
    }
    if (!best || bestScore < 2) throw new Error('未找到匹配音源: ' + musicItem.title);
    return best;
}

// ===================== 网易云 (163) =====================
async function http163(path) {
    const res = await axios.get('https://music.163.com' + path, {
        headers: {
            'User-Agent': UA163,
            Referer: 'https://music.163.com/',
            'Accept-Language': 'zh-CN,zh;q=0.9'
        },
        timeout: 10000,
        maxRedirects: 5
    });
    return res.data;
}

// 取 ld+json 中 @type 含 want 的首个对象
function findLd(html, want) {
    const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        try {
            const j = JSON.parse(m[1]);
            const t = j['@type'];
            if ((Array.isArray(t) ? t : [t]).indexOf(want) !== -1) return j;
        } catch (e) { /* 忽略非 JSON 块 */ }
    }
    return null;
}

// 解析 /playlist?id= 页 (榜单与普通歌单通用):
// 返回 { meta:{name,image,description,numTracks}, songs:[{id,title}] }
function parsePlaylistPage(html) {
    const ld = findLd(html, 'MusicPlaylist');
    let ldTracks = [];
    if (ld && ld.track && Array.isArray(ld.track.itemListElement)) {
        ldTracks = ld.track.itemListElement
            .map(e => {
                const u = (e.item && e.item.url) || '';
                const idm = u.match(/id=(\d+)/);
                return { id: idm ? idm[1] : '', title: (e.item && e.item.name) || '' };
            })
            .filter(s => s.id);
    }
    let pre = [];
    const pi = html.indexOf('song-list-pre-cache');
    if (pi !== -1) {
        const segEnd = html.indexOf('</ul>', pi);
        const seg = segEnd > pi ? html.slice(pi, segEnd) : '';
        const re2 = /<a href="\/song\?id=(\d+)">([^<]*)<\/a>/g;
        let m2;
        const seen = {};
        while ((m2 = re2.exec(seg)) !== null) {
            if (seen[m2[1]]) continue;
            seen[m2[1]] = 1;
            pre.push({ id: m2[1], title: unescapeHtml(m2[2]) });
        }
    }
    const songs = pre.length >= ldTracks.length ? pre : ldTracks;
    if (!songs.length) throw new Error('榜单/歌单页面解析失败: 未取到歌曲列表');
    const meta = ld
        ? {
            name: ld.name || '',
            image: (ld.image || '').replace(/^http:/, 'https:'),
            description: ld.description || '',
            numTracks: ld.numTracks || songs.length
        }
        : { name: '', image: '', description: '', numTracks: songs.length };
    return { meta: meta, songs: songs };
}

// 网易云官方榜 (硬编码自 music.163.com 首页 SSR 观察, 榜 id 稳定)
const NETEASE_CHARTS = [
    { id: '3778678', title: '热歌榜', cover: 'https://p2.music.126.net/0SUEG8yDACfx0Bw2MYFv4Q==/109951170048519512.jpg?param=200y200' },
    { id: '19723756', title: '飙升榜', cover: 'https://p2.music.126.net/rIi7Qzy2i2Y_1QD7cd0MYA==/109951170048506929.jpg?param=200y200' },
    { id: '3779629', title: '新歌榜', cover: 'https://p2.music.126.net/5guhqPBTcIrrhLBotgaT6w==/109951170048511751.jpg?param=200y200' },
    { id: '2884035', title: '原创榜', cover: 'https://p2.music.126.net/BaP9nrocNTL3gGThysv4eQ==/109951170091896587.jpg?param=200y200' },
    { id: '60198', title: '美国Billboard榜', cover: 'https://p2.music.126.net/rwRsVIJHQ68gglhA6TNEYA==/109951165611413732.jpg?param=200y200' },
    { id: '60131', title: '日本Oricon榜', cover: 'https://p2.music.126.net/aXUPgImt8hhf4cMUZEjP4g==/109951165611417794.jpg?param=200y200' },
    { id: '180106', title: 'UK排行榜周榜', cover: 'https://p2.music.126.net/fhAqiflLy3eU-ldmBQByrg==/109951165613082765.jpg?param=200y200' }
];

// ===================== QQ 音乐 (y.qq.com SSR) =====================
// INITIAL_DATA 是含裸 undefined 的 JS 字面量, 需替换后 JSON.parse
function parseQQInitialData(html) {
    const marker = 'window.__INITIAL_DATA__ =';
    const i = html.indexOf(marker);
    if (i === -1) {
        const i2 = html.indexOf('window.__INITIAL_DATA__=');
        if (i2 === -1) return null;
        const start = i2 + 'window.__INITIAL_DATA__='.length;
        const end = html.indexOf('</script>', start);
        if (end === -1) return null;
        return JSON.parse(html.slice(start, end).replace(/:\s*undefined/g, ':null').trim().replace(/;$/, ''));
    }
    const start = i + marker.length;
    const end = html.indexOf('</script>', start);
    if (end === -1) return null;
    return JSON.parse(html.slice(start, end).replace(/:\s*undefined/g, ':null').trim().replace(/;$/, ''));
}

// QQ 官方榜 (硬编码自 /n/ryqq_v2/toplist/4 页 INITIAL_DATA.topNavData, 榜 id 稳定)
// 详情: /n/ryqq_v2/toplist/<topId> 每页 SSR top20
const QQ_CHARTS = [
    { group: 'QQ巅峰榜', topId: '62', title: '飙升榜' },
    { group: 'QQ巅峰榜', topId: '26', title: '热歌榜' },
    { group: 'QQ巅峰榜', topId: '27', title: '新歌榜' },
    { group: 'QQ巅峰榜', topId: '4', title: '流行指数榜' },
    { group: 'QQ巅峰榜', topId: '67', title: '听歌识曲榜' },
    { group: 'QQ巅峰榜', topId: '201', title: 'MV榜' },
    { group: 'QQ地区榜', topId: '5', title: '内地榜' },
    { group: 'QQ地区榜', topId: '59', title: '香港地区榜' },
    { group: 'QQ地区榜', topId: '61', title: '台湾地区榜' },
    { group: 'QQ地区榜', topId: '3', title: '欧美榜' },
    { group: 'QQ地区榜', topId: '16', title: '韩国榜' },
    { group: 'QQ地区榜', topId: '17', title: '日本榜' },
    { group: 'QQ地区榜', topId: '126', title: 'JOOX本地榜' },
    { group: 'QQ地区榜', topId: '130', title: 'TVB劲歌金曲榜' },
    { group: 'QQ地区榜', topId: '127', title: 'KKBOX榜' },
    { group: 'QQ特色榜', topId: '58', title: '说唱榜' },
    { group: 'QQ特色榜', topId: '57', title: '电音榜' },
    { group: 'QQ特色榜', topId: '73', title: '游戏榜' },
    { group: 'QQ特色榜', topId: '72', title: '动漫榜' },
    { group: 'QQ特色榜', topId: '29', title: '影视金曲榜' },
    { group: 'QQ特色榜', topId: '64', title: '综艺新歌榜' },
    { group: 'QQ特色榜', topId: '65', title: '国风榜' },
    { group: 'QQ特色榜', topId: '36', title: 'K歌榜' },
    { group: 'QQ特色榜', topId: '60', title: '抖音榜' },
    { group: 'QQ特色榜', topId: '63', title: 'DJ榜' },
    { group: 'QQ特色榜', topId: '28', title: '网络歌曲榜' },
    { group: 'QQ全球榜', topId: '108', title: '美国Billboard榜' },
    { group: 'QQ全球榜', topId: '129', title: '韩国Melon榜' },
    { group: 'QQ全球榜', topId: '107', title: '英国UK榜' },
    { group: 'QQ全球榜', topId: '105', title: '日本公信榜' }
];

// QQ 榜详情解析 (getTopListDetail/getMusicSheetInfo 共用): 返回 { musicList, total, intro }
// 页面改版后 songInfoList 可能位于 data 下或顶层, 兼容两种结构; 再兜底轻量列表 data.song
async function qqChartDetail(topId) {
    const html = await httpQQ('/n/ryqq_v2/toplist/' + topId);
    const d = parseQQInitialData(html);
    const info = (d && d.data) || d;
    let songs = [];
    if (info && Array.isArray(info.songInfoList)) songs = info.songInfoList;
    else if (d && Array.isArray(d.songInfoList)) songs = d.songInfoList;
    else if (info && Array.isArray(info.song)) songs = info.song;
    if (!songs.length) throw new Error('QQ 榜单解析失败: 未取到歌曲');
    const musicList = songs.map(sg => {
        let cover = (sg.coverUrl || '').replace(/^http:/, 'https:');
        if (cover.indexOf('//') === 0) cover = 'https:' + cover; // 协议相对 URL
        return {
            id: String(sg.mid || sg.id),
            title: sg.title || sg.name || '',
            artist: (sg.singer || []).map(x => x.name).join(' / '),
            artwork: cover,
            duration: sg.interval || undefined,
            album: (sg.album && sg.album.name) || undefined,
            src: 'qq'
        };
    });
    return {
        musicList: musicList,
        total: (info && info.totalNum) || songs.length,
        intro: (info && (info.intro || info.updateTips)) || ''
    };
}

async function httpQQ(path) {
    const res = await axios.get('https://y.qq.com' + path, {
        headers: {
            'User-Agent': UA163,
            Referer: 'https://y.qq.com/',
            'Accept-Language': 'zh-CN,zh;q=0.9'
        },
        timeout: 10000,
        maxRedirects: 5
    });
    return res.data;
}

// ===================== 酷我 (kuwo.cn) =====================
const KUWO_BASE = 'https://www.kuwo.cn';
const KUWO_COOKIE_NAME = 'Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324';
// 服务端不校验 cookie 内容 (实测任意 32 位 hex 均可), 进程内生成一次即可
let KUWO_COOKIE = null;
function kuwoCookie() {
    if (!KUWO_COOKIE) {
        let s = '';
        for (let i = 0; i < 32; i++) s += '0123456789abcdef'.charAt(Math.floor(Math.random() * 16));
        KUWO_COOKIE = s;
    }
    return KUWO_COOKIE;
}
// Secret 头算法 (移植自 kuwo.cn 前端 bundle h5s.kuwo.cn/www/kw-www/497fe0a.js 请求拦截器)
function kuwoSecret(t, e) {
    if (null == e || e.length <= 0) return null;
    let n = '';
    for (let i = 0; i < e.length; i++) n += e.charCodeAt(i).toString();
    const o = Math.floor(n.length / 5);
    let r = parseInt(n.charAt(o) + n.charAt(2 * o) + n.charAt(3 * o) + n.charAt(4 * o) + n.charAt(5 * o), 10);
    const c = Math.ceil(e.length / 2);
    const l = Math.pow(2, 31) - 1;
    if (r < 2) return null;
    let d = Math.round(1e9 * Math.random()) % 1e8;
    n += d;
    while (n.length > 10) {
        n = (parseInt(n.substring(0, 10), 10) + parseInt(n.substring(10, n.length), 10)).toString();
    }
    n = (r * n + c) % l;
    let h = '';
    for (let i2 = 0; i2 < t.length; i2++) {
        let f = parseInt(t.charCodeAt(i2) ^ Math.floor(n / l * 255), 10);
        h += f < 16 ? '0' + f.toString(16) : f.toString(16);
        n = (r * n + c) % l;
    }
    d = d.toString(16);
    while (d.length < 8) d = '0' + d;
    return h + d;
}
async function kuwoApiGet(path, params) {
    const cookie = kuwoCookie();
    const reqId = 'kuwo' + Math.floor(Math.random() * 1e12).toString(36);
    const res = await axios.get(KUWO_BASE + path, {
        params: Object.assign({ httpsStatus: 1, reqId: reqId, plat: 'web_www', from: '' }, params),
        headers: {
            'User-Agent': UA163,
            Referer: 'https://www.kuwo.cn/rankList',
            'Accept': 'application/json, text/plain, */*',
            'Cookie': KUWO_COOKIE_NAME + '=' + cookie,
            'Secret': kuwoSecret(cookie, KUWO_COOKIE_NAME)
        },
        timeout: 10000
    });
    const data = res.data;
    if (!data || Number(data.code) !== 200) {
        throw new Error('酷我接口返回失败: ' + (data && data.msg ? data.msg : JSON.stringify(data).slice(0, 80)));
    }
    return data;
}
// 酷我遗留搜索 (观察自 kuwo.cn 搜索页: 关键词参数为 all; 仅需 UA+Referer, 无需 Cookie/Secret)
// 返回 [{rid, name, artist, album}]
async function kuwoSearch(kw, pn, rn) {
    const res = await axios.get(KUWO_BASE + '/search/searchMusicBykeyWord', {
        params: {
            all: kw, vipver: 1, client: 'kt', ft: 'music', cluster: 0, strategy: 2012,
            encoding: 'utf8', rformat: 'json', mobi: 1, issubtitle: 1, show_copyright_off: 1,
            pn: pn || 0, rn: rn || 20
        },
        headers: { 'User-Agent': UA163, Referer: 'https://www.kuwo.cn/search/list' },
        timeout: 10000
    });
    const d = res.data || {};
    const list = Array.isArray(d.abslist) ? d.abslist : [];
    const out = [];
    for (const s of list) {
        const rid = String(s.MUSICRID || '').replace(/^MUSIC_/, '');
        if (!rid) continue;
        out.push({ rid: rid, name: s.NAME || '', artist: s.ARTIST || '', album: s.ALBUM || '' });
    }
    return out;
}
// 酷我网页直连播放 (观察自前端 bundle getPlayUrl: /api/v1/www/music/playUrl, 参数名 mid 实传 rid)
// 免费歌曲返回 {code:200,data:{url}}; 付费歌曲返回 {code:-1,msg:该歌曲为付费内容...}
async function kuwoPlayUrl(rid) {
    const data = await kuwoApiGet('/api/v1/www/music/playUrl', { mid: rid, type: 'music' });
    const url = data.data && data.data.url;
    if (!url) throw new Error('酷我直连未返回播放地址');
    return url;
}
// 标题归一化: 全角括号→半角, 去空白 (命中 "金达莱花 (猛）" vs 请求 "金达莱花(猛Remix)" 的差异)
function normalizeKuwoTitle(s) {
    return (s || '').replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '');
}
// 酷我搜索结果打分: 标题相等+4 / 包含+2 / 去括号后缀后核心标题相等+4, 歌手包含+3; 总分<4 拒绝, 防错配
function pickKuwoHit(hits, musicItem) {
    const k = normalizeKuwoTitle(musicItem.title);
    if (!k) return null;
    const kCore = k.replace(/\([^)]*\)/g, '');
    const artist = ((musicItem.artist || '').split(/[\/，,、&\s]+/)[0] || '').trim();
    let best = null;
    let bestScore = -1;
    for (const it of hits) {
        const t = normalizeKuwoTitle(it.name);
        if (!t) continue;
        let s = 0;
        if (t === k) s += 4;
        else if (t.indexOf(k) !== -1 || k.indexOf(t) !== -1) s += 2;
        else {
            const tCore = t.replace(/\([^)]*\)/g, '');
            if (kCore && tCore === kCore) s += 4;
        }
        if (artist && (it.artist || '').indexOf(artist) !== -1) s += 3;
        if (s > bestScore) {
            bestScore = s;
            best = it;
        }
    }
    if (!best || bestScore < 4) return null;
    return best;
}

// 在搜索结果中挑一个 可替代 命中的条目 (跳过已确认付费的 excludeRid, 按相关度顺序)
function pickKuwoAlt(hits, musicItem, excludeRid) {
    const ex = String(excludeRid || '');
    for (const it of hits) {
        if (ex && it.rid === ex) continue;
        const solo = pickKuwoHit([it], musicItem);
        if (solo) return solo;
    }
    return null;
}
// 酷我直连解析: 按候选顺序尝试 playUrl, 任一免费版本命中即返回
// 候选顺序: (kuwo源) 原始rid 优先; 搜索按 标题+歌手 → 纯标题, 跳过打分<4 与重复 rid;
// 头部命中常为 VIP 版本 (playUrl code:-1), 逐候选重试直到拿到免费 URL。
async function resolveKuwoDirect(musicItem) {
    const firstArtist = ((musicItem.artist || '').split(/[\/，,、&\s]+/)[0] || '').trim();
    const candidates = [];
    const tried = {};
    function pushHits(hits) {
        for (const it of hits) {
            if (!it.rid || tried[it.rid]) continue;
            const solo = pickKuwoHit([it], musicItem);
            if (solo) { tried[it.rid] = 1; candidates.push(solo); }
        }
    }
    if (musicItem.src === 'kuwo' && musicItem.id) {
        candidates.push({ rid: String(musicItem.id) });
        tried[String(musicItem.id)] = 1;
    }
    const kw1 = (musicItem.title || '').trim();
    const kw2 = (kw1 + ' ' + firstArtist).replace(/\s+/g, ' ').trim();
    try {
        if (firstArtist && kw2 !== kw1) {
            pushHits(await kuwoSearch(kw2, 0, 10));
        }
        pushHits(await kuwoSearch(kw1, 0, 10));
    } catch (e) { /* 搜索异常: 仍尝试已收集候选 */ }
    for (const c of candidates) {
        try {
            const u = await kuwoPlayUrl(c.rid);
            if (u) return u;
        } catch (e) { /* 付费/不可用, 试下一个候选 */ }
    }
    return null;
}

// ===================== 歌词网 (followlyrics.com) 歌词三级兜底 =====================
// 酷我 geturl.lrc 与布谷镜像 about 均落空时, 按歌名 (纯标题, 同布谷搜索) 搜 followlyrics 并取详情页 LRC。
// 站点为 SSR HTML: 搜索结果表格 table.table-striped>tbody>tr (标题/歌手/专辑/详情链接);
// 详情页 div#lyrics 内 LRC 每行一个 tr (时间戳与歌词文本可能分列多 td) → 按行提取合并,
// 避免官方插件“删全部换行”的做法把整份 LRC 压成单行 (不可用)。
const FOLLOW_BASE = 'https://zh.followlyrics.com';
const FOLLOW_NL = String.fromCharCode(10);
async function followlyricsSearch(title) {
    const res = await axios.get(FOLLOW_BASE + '/search', {
        params: { name: title, type: 'song' },
        headers: { 'User-Agent': UA, Accept: 'text/html, application/xhtml+xml' },
        timeout: 10000
    });
    const $ = cheerio.load(res.data);
    const out = [];
    $('table.table-striped > tbody > tr').each(function () {
        const tds = $(this).children();
        if (tds.length < 4) return;
        const t = $(tds.get(0)).text().trim();
        const href = $(tds.get(3)).find('a').attr('href') || '';
        if (!t || !href) return;
        out.push({
            title: t,
            artist: $(tds.get(1)).text().trim(),
            url: href.indexOf('http') === 0 ? href : FOLLOW_BASE + href
        });
    });
    return out;
}
// 命中打分 (同 pickKuwoHit): 标题相等+4 / 包含+2 / 去括号核心标题相等+4, 歌手包含+3, 总分<4 拒绝, 防错配
function pickFollowHit(hits, musicItem) {
    const k = normalizeKuwoTitle(musicItem.title);
    if (!k) return null;
    const kCore = k.replace(/\([^)]*\)/g, '');
    const artist = ((musicItem.artist || '').split(/[\/，,、&\s]+/)[0] || '').trim();
    let best = null;
    let bestScore = -1;
    for (const it of hits) {
        const t = normalizeKuwoTitle(it.title);
        if (!t) continue;
        let s = 0;
        if (t === k) s += 4;
        else if (t.indexOf(k) !== -1 || k.indexOf(t) !== -1) s += 2;
        else {
            const tCore = t.replace(/\([^)]*\)/g, '');
            if (kCore && tCore === kCore) s += 4;
        }
        if (artist && it.artist && it.artist.indexOf(artist) !== -1) s += 3;
        if (s > bestScore) { bestScore = s; best = it; }
    }
    if (!best || bestScore < 4) return null;
    return best;
}
// 取详情页 LRC: div#lyrics 按行提取 (纯时间戳行与下一文本行合并), 需含 [时间戳] 才算有效
async function followlyricsLrc(url) {
    const res = await axios.get(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html, application/xhtml+xml' },
        timeout: 10000
    });
    const $ = cheerio.load(res.data);
    const $box = $('div#lyrics');
    if (!$box.length) return '';
    const raw = $box.text().split(FOLLOW_NL).map(x => x.trim()).filter(Boolean);
    const lines = [];
    for (let i = 0; i < raw.length; i++) {
        if (/^\[\d{1,2}:\d{2}(\.\d+)?\]$/.test(raw[i]) && i + 1 < raw.length && raw[i + 1].charAt(0) !== '[') {
            lines.push(raw[i] + raw[i + 1]);
            i++;
        } else {
            lines.push(raw[i]);
        }
    }
    const lrc = lines.join(FOLLOW_NL).trim();
    if (!lrc || !/\[\d{1,2}:\d{2}/.test(lrc)) return '';
    return lrc;
}
// getLyric 三级兜底入口: 任何异常/空返回 '' (歌词兜底不抛错)
async function followlyricsResolve(musicItem) {
    const kw = (musicItem.title || '').trim();
    if (!kw) return '';
    try {
        const hits = await followlyricsSearch(kw);
        const hit = pickFollowHit(hits, musicItem);
        if (!hit) return '';
        return await followlyricsLrc(hit.url);
    } catch (e) {
        return '';
    }
}

// ===================== NUXT 载荷解析器 (不依赖 eval) =====================
// Nuxt SSR 形式: window.__NUXT__=(function(a,b,c){return{...}}(arg0,arg1,...))
// 对象 key 内联, 字符串/数字值被抽成参数 → 确定性括号提取 + 字符串感知扫描求值
const NUX_BSLASH = String.fromCharCode(92);
function nuxtIsWs(c) {
    return c === ' ' || c === String.fromCharCode(9) || c === String.fromCharCode(10) || c === String.fromCharCode(13);
}
// 从 openIdx (指向开括号) 找匹配闭括号, 跳过字符串
function nuxtMatchParen(s, openIdx) {
    const open = s.charAt(openIdx);
    const close = open === '(' ? ')' : (open === '{' ? '}' : ']');
    let depth = 0, inStr = false, q = '';
    for (let k = openIdx; k < s.length; k++) {
        const c = s.charAt(k);
        if (inStr) {
            if (c === NUX_BSLASH) k++;
            else if (c === q) inStr = false;
            continue;
        }
        if (c === '"' || c === "'") { inStr = true; q = c; continue; }
        if (c === open) depth++;
        else if (c === close) { depth--; if (depth === 0) return k; }
    }
    return -1;
}
function nuxtParseLiteral(s) {
    if (!s) return null;
    const q0 = s.charAt(0), q1 = s.charAt(s.length - 1);
    if ((q0 === '"' && q1 === '"') || (q0 === "'" && q1 === "'")) {
        let inner = s.slice(1, -1);
        if (q0 === "'") inner = inner.split(NUX_BSLASH + "'").join("'");
        try { return JSON.parse('"' + inner + '"'); } catch (e) { return inner; }
    }
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    if (s === 'undefined') return undefined;
    const n = Number(s);
    if (s !== '' && !isNaN(n)) return n;
    return s;
}
function nuxtSplitTopLevel(s) {
    const out = [];
    let depth = 0, cur = '', inStr = false, q = '';
    for (let i = 0; i < s.length; i++) {
        const c = s.charAt(i);
        if (inStr) {
            cur += c;
            if (c === NUX_BSLASH) { cur += s.charAt(i + 1) || ''; i++; }
            else if (c === q) inStr = false;
            continue;
        }
        if (c === '"' || c === "'") { inStr = true; q = c; cur += c; continue; }
        if (c === '(' || c === '[' || c === '{') depth++;
        if (c === ')' || c === ']' || c === '}') depth--;
        if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out.map(x => nuxtParseLiteral(x.trim()));
}
function nuxtEvalExpr(s, env) {
    let i = 0;
    function ws() { while (i < s.length && nuxtIsWs(s.charAt(i))) i++; }
    function value() {
        ws();
        const c = s.charAt(i);
        if (c === '{') return readObj();
        if (c === '[') return readArr();
        if (c === '"' || c === "'") { const v = readStr(); return { value: v.value, pos: v.pos }; }
        if (c === '(') { i++; const v2 = value(); ws(); if (s.charAt(i) === ')') i++; return v2; }
        let j = i;
        while (j < s.length && s.charAt(j) !== ',' && s.charAt(j) !== '}' && s.charAt(j) !== ']') j++;
        const tok = s.slice(i, j).trim();
        if (tok === 'true') return { value: true, pos: j };
        if (tok === 'false') return { value: false, pos: j };
        if (tok === 'null') return { value: null, pos: j };
        if (tok === 'undefined') return { value: undefined, pos: j };
        if (tok !== '' && (tok.charAt(0) === '-' || (tok.charCodeAt(0) >= 48 && tok.charCodeAt(0) <= 57))) {
            const n = Number(tok);
            if (!isNaN(n)) return { value: n, pos: j };
        }
        if (Object.prototype.hasOwnProperty.call(env, tok)) return { value: env[tok], pos: j };
        return { value: tok, pos: j };
    }
    function readStr() {
        const q = s.charAt(i); i++;
        let out = '';
        while (i < s.length && s.charAt(i) !== q) {
            if (s.charAt(i) === NUX_BSLASH) {
                const nx = s.charAt(i + 1);
                if (nx === 'n') out += String.fromCharCode(10);
                else if (nx === 't') out += String.fromCharCode(9);
                else if (nx === 'u' && i + 5 < s.length) {
                    out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16));
                    i += 6;
                    continue;
                } else out += (nx || '');
                i += 2;
                continue;
            }
            out += s.charAt(i); i++;
        }
        i++;
        return { value: out, pos: i };
    }
    function readObj() {
        i++;
        const o = {};
        ws();
        if (s.charAt(i) === '}') { i++; return { value: o, pos: i }; }
        while (i < s.length) {
            ws();
            let key;
            if (s.charAt(i) === '"' || s.charAt(i) === "'") { const v = readStr(); key = v.value; i = v.pos; }
            else {
                let j = i;
                while (j < s.length && s.charAt(j) !== ':' && s.charAt(j) !== ',' && s.charAt(j) !== '}') j++;
                key = s.slice(i, j).trim(); i = j;
            }
            ws();
            if (s.charAt(i) === ':') i++;
            const r = value();
            o[key] = r.value;
            i = r.pos;
            ws();
            if (s.charAt(i) === ',') { i++; continue; }
            if (s.charAt(i) === '}') { i++; break; }
            break;
        }
        return { value: o, pos: i };
    }
    function readArr() {
        i++;
        const a = [];
        ws();
        if (s.charAt(i) === ']') { i++; return { value: a, pos: i }; }
        while (i < s.length) {
            const r = value();
            a.push(r.value);
            i = r.pos;
            ws();
            if (s.charAt(i) === ',') { i++; continue; }
            if (s.charAt(i) === ']') { i++; break; }
            break;
        }
        return { value: a, pos: i };
    }
    return value();
}
function parseNuxt(html) {
    const marker = 'window.__NUXT__=';
    const i = html.indexOf(marker);
    if (i === -1) return null;
    let j = i + marker.length;
    while (j < html.length && nuxtIsWs(html.charAt(j))) j++;
    if (html.charAt(j) !== '(') return null;
    const iifeEnd = nuxtMatchParen(html, j);
    if (iifeEnd === -1) return null;
    const src = html.slice(j, iifeEnd + 1);
    const fnIdx = src.indexOf('function');
    if (fnIdx === -1) return null;
    const pOpen = src.indexOf('(', fnIdx);
    const pClose = nuxtMatchParen(src, pOpen);
    const bodyOpen = src.indexOf('{', pClose);
    const bodyClose = nuxtMatchParen(src, bodyOpen);
    const aOpen = src.indexOf('(', bodyClose);
    if (aOpen === -1) return null;
    const aClose = nuxtMatchParen(src, aOpen);
    if (pClose === -1 || bodyOpen === -1 || bodyClose === -1 || aClose === -1) return null;
    const params = src.slice(pOpen + 1, pClose).split(',').map(s => s.trim()).filter(Boolean);
    const argsSrc = src.slice(aOpen + 1, aClose);
    const retIdx = src.indexOf('return', bodyOpen);
    if (retIdx === -1) return null;
    const body = src.slice(retIdx + 6, bodyClose).trim();
    const args = nuxtSplitTopLevel(argsSrc);
    const env = {};
    for (let p = 0; p < params.length; p++) env[params[p]] = args[p];
    return nuxtEvalExpr(body, env).value;
}
async function httpKuwoHtml(path) {
    const res = await axios.get(KUWO_BASE + path, {
        headers: {
            'User-Agent': UA163,
            Referer: 'https://www.kuwo.cn/',
            'Accept': 'text/html,application/xhtml+xml'
        },
        timeout: 10000,
        maxRedirects: 5
    });
    return res.data;
}
// 酷我榜单菜单: /rankList SSR NUXT.data[0].bangMenu
async function kuwoBangMenu() {
    const html = await httpKuwoHtml('/rankList');
    const d = parseNuxt(html);
    const menu = d && d.data && d.data[0] && d.data[0].bangMenu;
    if (!Array.isArray(menu) || !menu.length) throw new Error('酷我榜单菜单解析失败');
    return menu;
}

// ===================== 酷狗 (kugou.com SSR) =====================
// 官方榜 (硬编码自 /yy/rank/home/1-8888.html 侧边栏, 榜 id 稳定)
// 详情: /yy/rank/home/<page>-<rankid>.html SSR 内嵌 22 首/页
const KUGOU_CHARTS = [
    { group: '酷狗热门榜', rankId: '6666', title: '酷狗飙升榜' },
    { group: '酷狗热门榜', rankId: '8888', title: '酷狗TOP500' },
    { group: '酷狗热门榜', rankId: '59703', title: '蜂鸟流行音乐榜' },
    { group: '酷狗热门榜', rankId: '52144', title: '短视频热歌榜' },
    { group: '酷狗热门榜', rankId: '52767', title: '短视频收藏人气榜' },
    { group: '酷狗热门榜', rankId: '24971', title: 'DJ热歌榜' },
    { group: '酷狗热门榜', rankId: '31308', title: '内地榜' },
    { group: '酷狗热门榜', rankId: '31313', title: '香港地区榜' },
    { group: '酷狗热门榜', rankId: '54848', title: '台湾地区榜' },
    { group: '酷狗热门榜', rankId: '31310', title: '欧美榜' },
    { group: '酷狗热门榜', rankId: '31311', title: '韩国榜' },
    { group: '酷狗热门榜', rankId: '31312', title: '日本榜' },
    { group: '酷狗特色榜', rankId: '33162', title: 'ACG新歌榜' },
    { group: '酷狗特色榜', rankId: '33160', title: '电音热歌榜' },
    { group: '酷狗特色榜', rankId: '46910', title: '综艺新歌榜' },
    { group: '酷狗特色榜', rankId: '44412', title: '说唱先锋榜' },
    { group: '酷狗特色榜', rankId: '33163', title: '影视金曲榜' },
    { group: '酷狗特色榜', rankId: '33165', title: '粤语金曲榜' },
    { group: '酷狗特色榜', rankId: '33166', title: '欧美金曲榜' },
    { group: '酷狗特色榜', rankId: '30972', title: '酷狗音乐人原创榜' },
    { group: '酷狗特色榜', rankId: '37361', title: '酷狗识曲榜' },
    { group: '酷狗特色榜', rankId: '49225', title: '80后热歌榜' },
    { group: '酷狗特色榜', rankId: '49223', title: '90后热歌榜' },
    { group: '酷狗特色榜', rankId: '49224', title: '00后热歌榜' },
    { group: '酷狗全球榜', rankId: '4681', title: '美国BillBoard榜' },
    { group: '酷狗全球榜', rankId: '4680', title: '英国单曲榜' },
    { group: '酷狗全球榜', rankId: '4673', title: '日本公信榜' },
    { group: '酷狗全球榜', rankId: '38623', title: '韩国Melon音乐榜' },
    { group: '酷狗全球榜', rankId: '42807', title: 'joox本地热歌榜' },
    { group: '酷狗全球榜', rankId: '42808', title: 'KKBOX风云榜' },
    { group: '酷狗全球榜', rankId: '46868', title: '日本SPACE SHOWER榜' },
    { group: '酷狗全球榜', rankId: '25028', title: 'Beatport电子舞曲榜' },
    { group: '酷狗全球榜', rankId: '36107', title: '小语种热歌榜' }
];
async function httpKugou(path) {
    const res = await axios.get('https://www.kugou.com' + path, {
        headers: {
            'User-Agent': UA163,
            Referer: 'https://www.kugou.com/',
            'Accept': 'text/html,application/xhtml+xml'
        },
        timeout: 10000,
        maxRedirects: 5
    });
    return res.data;
}
// 酷狗榜单页 SSR 解析: /yy/rank/home/<page>-<rankid>.html 内嵌 22 首/页
function kugouRankSongs(html) {
    const $ = cheerio.load(html);
    const musicList = [];
    $('#rankWrap li[data-eid]').each((idx, el) => {
        const e = $(el);
        const title = e.attr('title') || '';
        const dash = title.indexOf(' - ');
        const artist = dash !== -1 ? title.slice(0, dash).trim() : '';
        const name = dash !== -1 ? title.slice(dash + 3).trim() : title.trim();
        const eid = e.attr('data-eid');
        if (!eid || !name) return;
        const dur = e.find('.pc_temp_time').first().text().trim();
        const dm = dur.match(/(\d+):(\d+)/);
        musicList.push({
            id: eid,
            title: name,
            artist: artist,
            duration: dm ? Number(dm[1]) * 60 + Number(dm[2]) : undefined,
            src: 'kugou'
        });
    });
    return musicList;
}

// ===================== 插件入口 =====================
module.exports = {
    platform: '布谷音乐',
    version: '0.0.5',
    author: 'tianpeng',
    description:
        '布谷音乐 (buguyy.top) 插件，数据源为酷我音乐。支持歌曲搜索、播放、歌词，热歌/新歌/随机榜单与音乐串烧榜；'
        + '内置网易云/QQ/酷我/酷狗官方排行榜 (QQ/酷狗热门歌单以官方榜提供, 平台歌单内容需登录态)；'
        + '播放源链: 布谷镜像 → 酷我直连 (playUrl/搜索解析 rid), 跨源兜底补齐镜像未收录歌曲 (汽水音乐无公开 Web 数据源未接入)。'
        + '歌词链: 酷我 lrc → 布谷镜像 → 歌词网 (followlyrics) 按歌名搜索兜底, 补齐跨源歌歌词。',
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@main/musicfree-buguyy/buguyy.js',
    cacheControl: 'no-cache',
    supportedSearchType: ['music'],

    // ===== 搜索 (接口不翻页，固定返回最多 50 条) =====
    async search(query, page, type) {
        if (type !== 'music') return { isEnd: true, data: [] };
        if (page > 1) return { isEnd: true, data: [] };
        const data = await apiGet('/api/search', { keyword: query });
        if (!Array.isArray(data.data)) throw new Error('搜索接口返回数据格式异常');
        return {
            isEnd: true,
            data: data.data.map(toMusicItem)
        };
    },

    // ===== 获取播放链接 =====
    // 播放源链: 1) 布谷镜像 (原生 geturl / 跨源搜索 geturl) → 2) 酷我直连
    // (酷我歌曲 playUrl(rid); 其他歌曲 酷我搜索定位 rid 后 playUrl) → 3) 失败 (付费/无收录)。
    // 布谷镜像只覆盖部分曲库且 geturl 有限流, 酷我直连兜底保障榜单/歌单歌曲可播。
    async getMediaSource(musicItem, quality) {
        let kuwoId = musicItem.id;
        if (musicItem.src && musicItem.src !== 'buguyy' && musicItem.src !== 'kuwo') {
            try { kuwoId = (await crossResolve(musicItem)).id; } catch (e) { kuwoId = null; }
        }
        if (kuwoId) {
            let data = null;
            try { data = await apiGet('/api/geturl', { id: kuwoId }); } catch (e) { data = null; }
            // 酷我榜/歌单歌曲: rid 可能不在布谷镜像内 (新歌/区域歌曲) → 跨源搜索兜底
            if ((!data || !data.url || data.url === 'None') && musicItem.src === 'kuwo') {
                try {
                    const m = await crossResolve(musicItem);
                    if (m && m.id !== kuwoId) data = await apiGet('/api/geturl', { id: m.id });
                } catch (e) { /* 镜像未收录, 走酷我直连 */ }
            }
            if (data && data.url && data.url !== 'None') {
                return {
                    url: data.url,
                    headers: {
                        'User-Agent': UA,
                        Referer: BASE + '/'
                    }
                };
            }
        }
        // 酷我直连兜底: 原始rid/搜索候选 逐个 playUrl (头部命中常为VIP版, 自动换下一候选)
        let kuwoUrl = null;
        try {
            kuwoUrl = await resolveKuwoDirect(musicItem);
        } catch (e) { /* 酷我服务异常 */ }

        if (kuwoUrl) {
            return {
                url: kuwoUrl,
                headers: {
                    'User-Agent': UA163,
                    Referer: 'https://www.kuwo.cn/'
                }
            };
        }
        throw new Error('未找到可播放音源 (可能为付费内容或未收录): ' + (musicItem.title || ''));
    },

    // ===== 歌词 =====
    // buguyy 原生: 条目自带 about, 否则 geturl 的 lrc; 酷我榜/歌单: geturl 的 lrc, 再跨源兜底;
    // 网易云/QQ/酷狗: 跨源命中条目的 about。
    async getLyric(musicItem) {
        if (musicItem.src === 'kuwo') {
            try {
                const data = await apiGet('/api/geturl', { id: musicItem.id });
                const l = cleanLrc(data.lrc);
                if (l) return { rawLrc: l };
            } catch (e) { /* 继续跨源兜底 */ }
            try {
                const m = await crossResolve(musicItem);
                let l = cleanLrc(m.about);
                if (!l) {
                    try { const gu = await apiGet('/api/geturl', { id: m.id }); l = cleanLrc(gu.lrc); } catch (e2) { /* 忽略 */ }
                }
                if (l) return { rawLrc: l };
            } catch (e) { /* 忽略 */ }
            const l3 = await followlyricsResolve(musicItem);
            if (l3) return { rawLrc: l3 };
            return { rawLrc: '' };
        }
        if (musicItem.src && musicItem.src !== 'buguyy') {
            try {
                const m = await crossResolve(musicItem);
                let l = cleanLrc(m.about);
                if (!l) {
                    // 搜索结果的 about 可能无歌词 → 用 geturl 的 lrc 兜底 (同原生路径)
                    try {
                        const gu = await apiGet('/api/geturl', { id: m.id });
                        l = cleanLrc(gu.lrc);
                    } catch (e) { /* 忽略 */ }
                }
                if (l) return { rawLrc: l };
            } catch (e) { /* 跨源未命中则返回空歌词 */ }
            const l3 = await followlyricsResolve(musicItem);
            if (l3) return { rawLrc: l3 };
            return { rawLrc: '' };
        }
        const fromItem = cleanLrc(musicItem.about);
        if (fromItem) return { rawLrc: fromItem };
        const data = await apiGet('/api/geturl', { id: musicItem.id });
        const l2 = cleanLrc(data.lrc);
        if (l2) return { rawLrc: l2 };
        const l3 = await followlyricsResolve(musicItem);
        if (l3) return { rawLrc: l3 };
        return { rawLrc: '' };
    },

    // ===== 单曲元数据补充 (可选) =====
    // 网易云榜单/歌单歌曲 SSR 只带 标题+id, 歌手/专辑/封面/时长 由此方法按需补齐。
    async getMusicInfo(musicItem) {
        if (!musicItem || musicItem.src !== 'netease') return {};
        const html = await http163('/song?id=' + musicItem.id);
        const out = { url: 'https://music.163.com/song?id=' + musicItem.id };
        const dm = html.match(/<meta property="music:duration" content="(\d+)"/);
        if (dm) out.duration = Number(dm[1]);
        const ld = findLd(html, 'MusicRecording');
        if (ld) {
            const artist = (ld.byArtist || []).map(a => a.name).join(' / ');
            if (artist) out.artist = artist;
            if (ld.inAlbum && ld.inAlbum.name) out.album = ld.inAlbum.name;
            const img = (ld.image || (ld.inAlbum && ld.inAlbum.image) || '').replace(/^http:/, 'https:');
            if (img) out.artwork = img;
        }
        return out;
    },

    // ===== 榜单列表 =====
    async getTopLists() {
        const out = [
            {
                title: '热门榜单',
                data: [
                    { id: 'hotlist', title: '热歌榜', artwork: '' },
                    { id: 'newlist', title: '新歌榜', artwork: '' },
                    { id: 'random', title: '随机推荐', artwork: '' }
                ]
            },
            {
                title: '音乐串烧',
                data: [{ id: 'heji-cid11', title: '串烧精选', artwork: '', cid: 11 }]
            },
            {
                title: '网易云音乐官方榜',
                data: NETEASE_CHARTS.map(c => ({
                    id: c.id,
                    title: c.title,
                    artwork: c.cover,
                    src: 'netease'
                }))
            },
            {
                title: 'QQ音乐官方榜',
                data: QQ_CHARTS.map(c => ({
                    id: 'qq' + c.topId,
                    title: c.title,
                    artwork: '',
                    src: 'qq',
                    topId: c.topId
                }))
            },
            {
                title: '酷狗官方榜',
                data: KUGOU_CHARTS.map(c => ({
                    id: 'kg' + c.rankId,
                    title: c.title,
                    artwork: '',
                    src: 'kugou',
                    rankId: c.rankId
                }))
            }
        ];
        // 酷我官方榜 (动态获取 bangMenu 官方组, 获取失败则跳过该组)
        try {
            const menu = await kuwoBangMenu();
            const official = menu.find(g => g.name === '官方') || menu[0];
            if (official && Array.isArray(official.list) && official.list.length) {
                out.push({
                    title: '酷我官方榜',
                    data: official.list.map(c => ({
                        id: 'kw' + c.sourceid,
                        title: c.name,
                        artwork: (c.pic || '').replace(/^http:/, 'https:'),
                        src: 'kuwo',
                        sourceid: c.sourceid
                    }))
                });
            }
        } catch (e) { /* 酷我榜单组获取失败不影响其他榜单 */ }
        return out;
    },

    // ===== 榜单详情 =====
    async getTopListDetail(topListItem, page) {
        // --- 网易云官方榜: /playlist?id=<chartId> SSR 解析 ---
        if (topListItem.src === 'netease') {
            if (page > 1) return { isEnd: true, musicList: [] };
            const html = await http163('/playlist?id=' + topListItem.id);
            const p = parsePlaylistPage(html);
            const result = {
                isEnd: true, // 网页 SSR 仅第一页 (官方榜为全量)
                musicList: p.songs.map(s => ({ id: s.id, title: s.title, src: 'netease' }))
            };
            result.topListItem = Object.assign({}, topListItem, {
                description: p.meta.description,
                artwork: p.meta.image || topListItem.artwork,
                worksNum: p.meta.numTracks
            });
            return result;
        }
        // --- QQ 官方榜: /n/ryqq_v2/toplist/<topId> SSR top20 ---
        if (topListItem.src === 'qq') {
            if (page > 1) return { isEnd: true, musicList: [] };
            const d = await qqChartDetail(topListItem.topId || String(topListItem.id).replace(/^qq/, ''));
            const result = { isEnd: true, musicList: d.musicList };
            result.topListItem = Object.assign({}, topListItem, {
                worksNum: d.total,
                description: d.intro || undefined
            });
            return result;
        }
        // --- 酷我官方榜: Secret API 分页 (20首/页) ---
        if (topListItem.src === 'kuwo') {
            const data = await kuwoApiGet('/api/www/bang/bang/musicList', {
                bangId: topListItem.sourceid,
                pn: page,
                rn: 20
            });
            const d2 = data.data || {};
            const list = Array.isArray(d2.musicList) ? d2.musicList : [];
            const total = Number(d2.num) || 0;
            if (!list.length && page > 1) return { isEnd: true, musicList: [] };
            const musicList = list.map(sg => ({
                id: String(sg.rid),
                title: sg.name || '',
                artist: sg.artist || '',
                artwork: (sg.pic || '').replace(/^http:/, 'https:'),
                duration: sg.duration || undefined,
                album: sg.album || undefined,
                src: 'kuwo'
            }));
            const result = { isEnd: total ? page * 20 >= total : true, musicList: musicList };
            if (page === 1) {
                result.topListItem = Object.assign({}, topListItem, { worksNum: total || undefined });
            }
            return result;
        }
        // --- 酷狗官方榜: /yy/rank/home/<page>-<rankid>.html SSR 22首/页 ---
        if (topListItem.src === 'kugou') {
            const html = await httpKugou('/yy/rank/home/' + page + '-' + topListItem.rankId + '.html');
            const musicList = kugouRankSongs(html);
            if (!musicList.length) return { isEnd: true, musicList: [] };
            const result = { isEnd: musicList.length < 22, musicList: musicList };
            if (page === 1) {
                const $ = cheerio.load(html);
                const h3 = $('#pc_temp_title h3').first().text().trim();
                const up = $('.rank_update').first().text().trim();
                result.topListItem = Object.assign({}, topListItem, {
                    title: h3 || topListItem.title,
                    description: up || undefined
                });
            }
            return result;
        }
        const id = topListItem.id;
        if (id === 'heji-cid11' || topListItem.cid) {
            const data = await apiGet('/api/heji', {
                cid: topListItem.cid || 11,
                page: page,
                timestamp: Date.now()
            });
            if (!Array.isArray(data.data)) throw new Error('串烧榜接口返回数据格式异常');
            const totalPages = Number(data.totalPages) || page;
            const result = {
                isEnd: page >= totalPages,
                musicList: data.data.map(toMusicItem)
            };
            if (page === 1) result.topListItem = topListItem;
            return result;
        }
        if (id === 'hotlist' || id === 'newlist' || id === 'random') {
            if (page > 1) return { isEnd: true, musicList: [] };
            const data = await apiGet('/api/' + id);
            if (!Array.isArray(data.data)) throw new Error('榜单接口返回数据格式异常');
            return {
                isEnd: true,
                musicList: data.data.map(toMusicItem),
                topListItem: topListItem
            };
        }
        throw new Error('未知榜单: ' + id);
    },

    // ===== 热门歌单标签 (应用“热门歌单”页的标签页) =====
    async getRecommendSheetTags() {
        return {
            data: [{
                title: '热门歌单',
                data: [
                    { id: 'netease', title: '网易云' },
                    { id: 'qq', title: 'QQ音乐' },
                    { id: 'kuwo', title: '酷我' },
                    { id: 'kugou', title: '酷狗' }
                ]
            }]
        };
    },

    // ===== 按标签取热门歌单列表 =====
    async getRecommendSheetsByTag(tag, page) {
        if (tag.id === 'netease') {
            if (page > 1) return { isEnd: true, data: [] };
            const html = await http163('/discover/playlist/');
            const $ = cheerio.load(html);
            const sheets = [];
            $('#m-pl-container > li').each((i, el) => {
                const e = $(el);
                const a = e.find('a.tit').first();
                const idm = (a.attr('href') || '').match(/id=(\d+)/);
                if (!idm) return;
                const by = e.find('a.nm').first().text().trim();
                const nb = e.find('span.nb').first().text().trim();
                sheets.push({
                    id: idm[1],
                    title: (a.attr('title') || a.text() || '').trim(),
                    artwork: (e.find('img').attr('src') || '').replace(/^http:/, 'https:'),
                    artist: by || undefined,
                    playCount: Number(nb) || undefined,
                    src: 'netease'
                });
            });
            if (!sheets.length) throw new Error('热门歌单页面解析失败');
            return { isEnd: true, data: sheets };
        }
        if (tag.id === 'qq') {
            // QQ 歌单歌曲列表需登录态 (ag-1 加密通道), 热门歌单以 QQ 官方榜提供 (10个/页)
            const start = (page - 1) * 10;
            const slice = QQ_CHARTS.slice(start, start + 10);
            return {
                isEnd: start + 10 >= QQ_CHARTS.length,
                data: slice.map(c => ({
                    id: 'qq' + c.topId,
                    title: c.title,
                    artwork: '',
                    src: 'qq',
                    topId: c.topId,
                    description: c.group
                }))
            };
        }
        if (tag.id === 'kuwo') {
            if (page > 1) return { isEnd: true, data: [] };
            const html = await httpKuwoHtml('/');
            const d = parseNuxt(html);
            const list = d && d.data && d.data[0] && d.data[0].playlist && d.data[0].playlist.list;
            if (!Array.isArray(list) || !list.length) throw new Error('酷我热门歌单解析失败');
            return {
                isEnd: true,
                data: list.map(p => ({
                    id: 'kwp' + p.id,
                    title: p.name || '',
                    artwork: (p.img || p.img500 || '').replace(/^http:/, 'https:'),
                    artist: p.uname || undefined,
                    playCount: Number(p.listencnt) || undefined,
                    description: p.desc || undefined,
                    src: 'kuwo'
                }))
            };
        }
        if (tag.id === 'kugou') {
            // 酷狗歌单详情需登录态 (统一登录墙), 热门歌单以酷狗官方榜提供 (10个/页)
            const start = (page - 1) * 10;
            const slice = KUGOU_CHARTS.slice(start, start + 10);
            return {
                isEnd: start + 10 >= KUGOU_CHARTS.length,
                data: slice.map(c => ({
                    id: 'kg' + c.rankId,
                    title: c.title,
                    artwork: '',
                    src: 'kugou',
                    rankId: c.rankId,
                    description: c.group
                }))
            };
        }
        throw new Error('未知歌单标签: ' + tag.id);
    },

    // ===== 歌单详情 =====
    async getMusicSheetInfo(sheetItem, page) {
        if (sheetItem.src === 'netease') {
            if (page > 1) return { isEnd: true, musicList: [] };
            const html = await http163('/playlist?id=' + sheetItem.id);
            const p = parsePlaylistPage(html);
            const result = {
                isEnd: true, // 网页 SSR 仅第一页 (官方榜全量; 普通歌单截断, 客户端补全需登录态)
                musicList: p.songs.map(s => ({ id: s.id, title: s.title, src: 'netease' }))
            };
            result.sheetItem = Object.assign({}, sheetItem, {
                description: p.meta.description || sheetItem.description,
                artwork: p.meta.image || sheetItem.artwork,
                worksNum: p.meta.numTracks
            });
            return result;
        }
        if (sheetItem.src === 'kuwo') {
            if (page > 1) return { isEnd: true, musicList: [] };
            const plId = String(sheetItem.id).replace(/^kwp/, '');
            const html = await httpKuwoHtml('/playlist_detail/' + plId);
            const d = parseNuxt(html);
            const info = d && d.data && d.data[0] && d.data[0].playListInfo;
            if (!info || !Array.isArray(info.musicList)) throw new Error('酷我歌单详情解析失败');
            const result = {
                isEnd: true, // SSR 仅前 20 首, 完整列表需登录态
                musicList: info.musicList.map(sg => ({
                    id: String(sg.rid),
                    title: sg.name || '',
                    artist: sg.artist || '',
                    artwork: (sg.pic || '').replace(/^http:/, 'https:'),
                    duration: sg.duration || undefined,
                    album: sg.album || undefined,
                    src: 'kuwo'
                }))
            };
            result.sheetItem = Object.assign({}, sheetItem, {
                description: info.desc || info.name || sheetItem.description,
                artwork: (info.img || '').replace(/^http:/, 'https:') || sheetItem.artwork,
                worksNum: Number(info.total) || undefined
            });
            return result;
        }
        if (sheetItem.src === 'qq') {
            // 热门歌单标签下的 QQ 条目为官方榜 (id=qq<topId>)
            if (page > 1) return { isEnd: true, musicList: [] };
            const topId = sheetItem.topId || String(sheetItem.id).replace(/^qq/, '');
            const d = await qqChartDetail(topId);
            const result = { isEnd: true, musicList: d.musicList };
            result.sheetItem = Object.assign({}, sheetItem, {
                worksNum: d.total,
                description: d.intro || sheetItem.description
            });
            return result;
        }
        if (sheetItem.src === 'kugou') {
            // 热门歌单标签下的酷狗条目为官方榜 (id=kg<rankId>, 22首/页)
            const rankId = sheetItem.rankId || String(sheetItem.id).replace(/^kg/, '');
            const html = await httpKugou('/yy/rank/home/' + page + '-' + rankId + '.html');
            const musicList = kugouRankSongs(html);
            const result = { isEnd: musicList.length < 22, musicList: musicList };
            result.sheetItem = Object.assign({}, sheetItem);
            return result;
        }
        throw new Error('不支持的歌单类型: ' + (sheetItem.src || '未知'));
    }
};
