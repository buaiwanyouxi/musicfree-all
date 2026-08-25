// 布谷音乐 MusicFree 插件
// 站点: https://www.buguyy.top (在线音乐试听与无损音乐下载平台, Nuxt 3 SPA)
// 数据源: 酷我音乐 (KuWo)。搜索/榜单/播放接口均为站点代理，音频为酷我 CDN 直链。
//
// 已观察并验证的站点接口 (均来自站点前端 bundle 与实测响应):
//   GET /api/search?keyword=          搜索, 最多 50 条, 无翻页 {success,data:[{id,title,singer,picurl,about}],count}
//   GET /api/hotlist                  热歌榜, 50 条, 无翻页
//   GET /api/newlist                  新歌榜, 50 条, 无翻页
//   GET /api/random                   随机推荐, 50 条, 每次调用内容不同
//   GET /api/heji?cid=&page=&timestamp=  合集/串烧列表, 每页 10 条, 带 totalPages/totalCount (cid=11 音乐串烧)
//   GET /api/geturl?id=               播放直链 {success,url,id,name,lrc} (lrc 为 LRC, 换行是 <br>)
//   GET /api/allnetsearch / allneturl 全网搜索/播放, 实测无法稳定返回播放地址, 本插件未采用
//   GET /api/getdown?id=              网盘下载信息, 与播放无关, 本插件未采用
//
// 作者: 船长 (参考 tianpeng 原版, 本版本扩展 random/串烧榜与 geturl 歌词回退)
const axios = require('axios');

const BASE = 'https://www.buguyy.top';
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
    return lrc;
}

module.exports = {
    platform: '布谷音乐',
    version: '0.0.2',
    author: 'tianpeng',
    description:
        '布谷音乐 (buguyy.top) 插件，数据源为酷我音乐。支持歌曲搜索、播放、歌词，热歌/新歌/随机榜单与音乐串烧榜。',
    srcUrl: 'https://www.buguyy.top',
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

    // ===== 获取播放链接 (酷我 CDN 直链; 站点仅提供单一音源, quality 不适用) =====
    async getMediaSource(musicItem, quality) {
        const data = await apiGet('/api/geturl', { id: musicItem.id });
        if (!data.url || data.url === 'None') {
            throw new Error('获取播放链接失败');
        }
        return {
            url: data.url,
            headers: {
                'User-Agent': UA,
                Referer: BASE + '/'
            }
        };
    },

    // ===== 歌词: 优先用条目自带的 about; 否则请求 geturl 取 lrc =====
    async getLyric(musicItem) {
        const fromItem = cleanLrc(musicItem.about);
        if (fromItem) return { rawLrc: fromItem };
        const data = await apiGet('/api/geturl', { id: musicItem.id });
        return { rawLrc: cleanLrc(data.lrc) };
    },

    // ===== 榜单列表 =====
    async getTopLists() {
        return [
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
            }
        ];
    },

    // ===== 榜单详情 (hotlist/newlist/random 不翻页; 串烧榜支持翻页) =====
    async getTopListDetail(topListItem, page) {
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
    }
};
