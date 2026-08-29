// 酷我音源插件（kw.js）
// ---------------------------------------------------------------------------
// 定位：将“酷我”作为一个独立音源接入 MusicFree，实现：
//   1) 歌单导入（importMusicSheet / getMusicSheetInfo）
//   2) 热门歌单（getRecommendSheetTags / getRecommendSheetsByTag）
//   3) 排行榜（getTopLists / getTopListDetail）
//   并附带搜索、歌词、取链等基础能力。
//
// 接口均经真实网络探测验证（非盲猜）：
//   - 搜索：search.kuwo.cn/r.s（ft=music/album/artist/sheet）
//   - 取链：第三方社区代理 music.nxinxz.com/kw.php（返回酷我真实音频流；
//           酷我官方免费 antiserver 接口实测对任一 rid 均返回同一首歌，已不可用）
//   - 歌词：m.kuwo.cn/newh5/singles/songinfoandlrc
//   - 排行榜列表：wapi.kuwo.cn/api/pc/bang/list（5 组共数十个榜单）
//   - 榜单详情：kbangserver.kuwo.cn/ksong.s
//   - 热门歌单标签：wapi.kuwo.cn/api/pc/classify/playlist/getTagList
//   - 热门/标签歌单：wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList（推荐/热门）、getTagPlayList（按标签）
//   - 歌单歌曲：nplserver.kuwo.cn/pl.svc（op=getlistinfo，注意返回键为 musiclist 小写）
//
// 协议：IIFE 兼容 CommonJS(module.exports) 与老协议(return)；移动端用 __musicfree_require 回退 require。
// 依赖沙箱内置 require('axios') / require('he')。
// ---------------------------------------------------------------------------

(function () {
  var reqFn = (
    typeof __musicfree_require !== 'undefined' ? __musicfree_require :
    (typeof require !== 'undefined' ? require : null)
  );
  if (!reqFn) throw new Error('[kw] 插件沙箱未提供 require，无法加载');
  var axios = reqFn('axios');
  var he = reqFn('he');

  var PAGE_SIZE = 30;

  // 音质映射：插件档位 -> 代理 level 参数
  var PLUGIN_QUALITY_MAP = { low: '128k', standard: '320k', high: 'flac', super: 'flac' };
  var QUALITY_MAP = { '128k': 'standard', '320k': 'exhigh', 'flac': 'lossless' };
  var PROXY_BASE = 'https://music.nxinxz.com';

  // ============================ 工具 ============================
  function decode(s) { return he.decode(s || ''); }

  // 酷我专辑封面短链 -> 长链
  function artworkShort2Long(albumpicShort) {
    if (!albumpicShort) return undefined;
    var idx = albumpicShort.indexOf('/');
    return idx !== -1
      ? 'https://img4.kuwo.cn/star/albumcover/1080' + albumpicShort.slice(idx)
      : undefined;
  }

  // 部分接口 Content-Type 非 JSON，axios 会把数据当字符串返回，这里统一解析
  function toObj(d) {
    if (typeof d === 'string') { try { return JSON.parse(d); } catch (e) { return {}; } }
    return d || {};
  }

  // ============================ 搜索 ============================
  function formatMusicItem(_) {
    return {
      id: _.MUSICRID ? String(_.MUSICRID).replace('MUSIC_', '') : _.id,
      artwork: artworkShort2Long(_.web_albumpic_short),
      title: decode(_.NAME || _.name || ''),
      artist: decode(_.ARTIST || _.artist || ''),
      album: decode(_.ALBUM || _.album || ''),
      albumId: _.ALBUMID || _.albumid,
      artistId: _.ARTISTID || _.artistid,
      formats: _.FORMATS || _.formats,
    };
  }
  function formatAlbumItem(_) {
    return {
      id: _.albumid,
      artist: decode(_.artist || ''),
      title: decode(_.name || ''),
      artwork: _.img || artworkShort2Long(_.pic),
      description: decode(_.info || ''),
      date: _.pub,
      artistId: _.artistid,
    };
  }
  function formatArtistItem(_) {
    return {
      id: _.ARTISTID,
      avatar: _.hts_PICPATH,
      name: decode(_.ARTIST || ''),
      artistId: _.ARTISTID,
      description: decode(_.desc || ''),
      worksNum: _.SONGNUM,
    };
  }
  function formatMusicSheet(_) {
    return {
      id: _.playlistid,
      title: decode(_.name || ''),
      artist: decode(_.nickname || ''),
      artwork: _.pic,
      playCount: _.playcnt,
      description: decode(_.intro || ''),
      worksNum: _.songnum,
    };
  }

  async function searchMusic(query, page) {
    const res = toObj((await axios.get('http://search.kuwo.cn/r.s', {
      params: {
        client: 'kt', all: query, pn: page - 1, rn: PAGE_SIZE, uid: 2574109560,
        ver: 'kwplayer_ar_8.5.4.2', vipver: 1, ft: 'music', cluster: 0, strategy: 2012,
        encoding: 'utf8', rformat: 'json', vermerge: 1, mobi: 1,
      },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const songs = (res.abslist || []).map(formatMusicItem);
    return { isEnd: (+res.PN + 1) * +res.RN >= +res.TOTAL, data: songs };
  }
  async function searchAlbum(query, page) {
    const res = toObj((await axios.get('http://search.kuwo.cn/r.s', {
      params: { all: query, ft: 'album', itemset: 'web_2013', client: 'kt', pn: page - 1, rn: PAGE_SIZE, rformat: 'json', encoding: 'utf8', pcjson: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    return { isEnd: (+res.PN + 1) * +res.RN >= +res.TOTAL, data: (res.albumlist || []).map(formatAlbumItem) };
  }
  async function searchArtist(query, page) {
    const res = toObj((await axios.get('http://search.kuwo.cn/r.s', {
      params: { all: query, ft: 'artist', itemset: 'web_2013', client: 'kt', pn: page - 1, rn: PAGE_SIZE, rformat: 'json', encoding: 'utf8', pcjson: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    return { isEnd: (+res.PN + 1) * +res.RN >= +res.TOTAL, data: (res.abslist || []).map(formatArtistItem) };
  }
  async function searchMusicSheet(query, page) {
    const res = toObj((await axios.get('http://search.kuwo.cn/r.s', {
      params: { all: query, ft: 'playlist', itemset: 'web_2013', client: 'kt', pn: page - 1, rn: PAGE_SIZE, rformat: 'json', encoding: 'utf8', pcjson: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    return { isEnd: (+res.PN + 1) * +res.RN >= +res.TOTAL, data: (res.abslist || []).map(formatMusicSheet) };
  }

  // ============================ 取链（念心社区代理） ============================
  // 说明：酷我官方免费 antiserver 接口实测对任一 rid 均返回同一首歌（已失效），
  // 故沿用社区公认的稳定代理 music.nxinxz.com/kw.php（直接返回酷我真实音频流）。
  async function getMediaSource(musicItem, quality) {
    const userQuality = PLUGIN_QUALITY_MAP[quality] || '128k';
    // 注意：代理 music.nxinxz.com 的 level 参数只认 kuwo 内部档位
    // standard / exhigh / lossless（传 128k/320k/flac 均被忽略，固守同一固定音质）。
    // 故这里传 QUALITY_MAP 映射后的档位，与念心插件保持一致。
    const apiLevel = QUALITY_MAP[userQuality];
    if (!apiLevel) throw new Error('不支持的音质: ' + quality);
    const songId = musicItem.id;
    if (!songId) throw new Error('找不到歌曲ID');
    const url = PROXY_BASE + '/kw.php?id=' + encodeURIComponent(songId) + '&level=' + encodeURIComponent(apiLevel) + '&type=mp3';
    return { url };
  }

  // ============================ 歌词 ============================
  async function getLyric(musicItem) {
    const res = toObj((await axios.get('http://m.kuwo.cn/newh5/singles/songinfoandlrc', {
      params: { musicId: musicItem.id, httpStatus: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const list = res.data && res.data.lrclist;
    if (!list || !list.length) return { rawLrc: '' };
    return { rawLrc: list.map(function (_) { return '[' + _.time + ']' + _.lineLyric; }).join('\n') };
  }

  // ============================ 专辑 / 歌手 ============================
  async function getAlbumInfo(albumItem) {
    const res = toObj((await axios.get('http://search.kuwo.cn/r.s', {
      params: { pn: 0, rn: 100, albumid: albumItem.id, stype: 'albuminfo', sortby: 0, alflac: 1, show_copyright_off: 1, pcmp4: 1, encoding: 'utf8', plat: 'pc', thost: 'search.kuwo.cn', vipver: 'MUSIC_9.1.1.2_BCS2', devid: '38668888', newver: 1, pcjson: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const songs = (res.musiclist || []).map(function (_) {
      return {
        id: _.id, artwork: albumItem.artwork || res.img,
        title: decode(_.name || ''), artist: decode(_.artist || ''),
        album: decode(_.album || ''), albumId: albumItem.id, artistId: _.artistid, formats: _.formats,
      };
    });
    return { musicList: songs };
  }
  async function getArtistMusicWorks(artistItem, page) {
    const res = toObj((await axios.get('http://search.kuwo.cn/r.s', {
      params: { pn: page - 1, rn: PAGE_SIZE, artistid: artistItem.id, stype: 'artist2music', sortby: 0, alflac: 1, show_copyright_off: 1, pcmp4: 1, encoding: 'utf8', plat: 'pc', thost: 'search.kuwo.cn', vipver: 'MUSIC_9.1.1.2_BCS2', devid: '38668888', newver: 1, pcjson: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const songs = (res.musiclist || []).map(function (_) {
      return {
        id: _.musicrid, artwork: artworkShort2Long(_.web_albumpic_short),
        title: decode(_.name || ''), artist: decode(_.artist || ''),
        album: decode(_.album || ''), albumId: _.albumid, artistId: _.artistid, formats: _.formats,
      };
    });
    return { isEnd: (+res.pn + 1) * PAGE_SIZE >= +res.total, data: songs };
  }
  async function getArtistAlbumWorks(artistItem, page) {
    const res = toObj((await axios.get('http://search.kuwo.cn/r.s', {
      params: { pn: page - 1, rn: PAGE_SIZE, artistid: artistItem.id, stype: 'albumlist', sortby: 1, alflac: 1, show_copyright_off: 1, pcmp4: 1, encoding: 'utf8', plat: 'pc', thost: 'search.kuwo.cn', vipver: 'MUSIC_9.1.1.2_BCS2', devid: '38668888', newver: 1, pcjson: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    return { isEnd: (+res.pn + 1) * PAGE_SIZE >= +res.total, data: (res.albumlist || []).map(formatAlbumItem) };
  }
  async function getArtistWorks(artistItem, page, type) {
    if (type === 'album') return await getArtistAlbumWorks(artistItem, page);
    return await getArtistMusicWorks(artistItem, page);
  }
  async function getMusicInfo(musicItem) {
    const res = toObj((await axios.get('http://m.kuwo.cn/newh5/singles/songinfoandlrc', {
      params: { musicId: musicItem.id, httpStatus: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const originalUrl = res.data && res.data.songinfo && res.data.songinfo.pic;
    if (!originalUrl) return {};
    var picUrl = originalUrl;
    if (originalUrl.indexOf('starheads/') > -1) picUrl = originalUrl.replace(/starheads\/\d+/, 'starheads/800');
    else if (originalUrl.indexOf('albumcover/') > -1) picUrl = originalUrl.replace(/albumcover\/\d+/, 'albumcover/800');
    return { artwork: picUrl };
  }

  // ============================ 排行榜 ============================
  async function getTopLists() {
    const res = toObj((await axios.get('http://wapi.kuwo.cn/api/pc/bang/list', {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const child = res.child || [];
    return child.map(function (e) {
      return {
        title: e.disname,
        data: (e.child || []).map(function (_) {
          return {
            id: String(_.sourceid),
            coverImg: _.pic5 || _.pic2 || _.pic,
            title: _.name,
            description: _.intro,
          };
        }),
      };
    });
  }
  async function getTopListDetail(topListItem, page) {
    const res = toObj((await axios.get('http://kbangserver.kuwo.cn/ksong.s', {
      params: {
        from: 'pc', fmt: 'json', pn: (page || 1) - 1, rn: 100, type: 'bang', data: 'content',
        id: topListItem.id, show_copyright_off: 0, pcmp4: 1, isbang: 1, userid: 0, httpStatus: 1,
      },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const musicList = (res.musiclist || []).map(function (_) {
      return {
        id: String(_.id),
        title: decode(_.name || ''),
        artist: decode(_.artist || ''),
        album: decode(_.album || ''),
        albumId: _.albumid,
        artistId: _.artistid,
        formats: _.formats,
      };
    });
    return Object.assign({}, topListItem, { isEnd: true, musicList: musicList });
  }

  // ============================ 热门歌单（标签 + 歌单） ============================
  async function getRecommendSheetTags() {
    const res = toObj((await axios.get('http://wapi.kuwo.cn/api/pc/classify/playlist/getTagList', {
      params: { cmd: 'rcm_keyword_playlist', user: 0, prod: 'kwplayer_pc_9.0.5.0', vipver: '9.0.5.0', source: 'kwplayer_pc_9.0.5.0', loginUid: 0, loginSid: 0, appUid: 76039576 },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    const data = (res.data || []).map(function (group) {
      return {
        title: group.name,
        data: (group.data || []).map(function (_) {
          return { id: String(_.id), digest: _.digest, title: _.name };
        }),
      };
    }).filter(function (item) { return item.data.length; });
    const pinned = [
      { id: '1848', title: '翻唱', digest: '10000' },
      { id: '621', title: '网络', digest: '10000' },
      { id: '146', title: '伤感', digest: '10000' },
      { id: '35', title: '欧美', digest: '10000' },
    ];
    return { data: data, pinned: pinned };
  }
  async function getRecommendSheetsByTag(tag, page) {
    const ps = 20;
    var res;
    if (tag && tag.id) {
      if (tag.digest === '10000') {
        // 固定精选标签（翻唱/网络/伤感/欧美等）走 PC 标签接口
        res = toObj((await axios.get('http://wapi.kuwo.cn/api/pc/classify/playlist/getTagPlayList', {
          params: { loginUid: 0, loginSid: 0, appUid: 76039576, pn: (page || 1) - 1, id: tag.id, rn: ps },
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
          timeout: 10000, validateStatus: function () { return true; },
        })).data).data;
      } else {
        // 普通标签（digest 非 10000）走移动端聚合接口，结果按 list 展开
        const erData = toObj((await axios.get('http://mobileinterfaces.kuwo.cn/er.s', {
          params: { type: 'get_pc_qz_data', f: 'web', id: tag.id, prod: 'pc' },
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
          timeout: 10000, validateStatus: function () { return true; },
        })).data);
        const merged = (Array.isArray(erData) ? erData : []).reduce(function (prev, curr) {
          return prev.concat(curr.list || []);
        }, []);
        res = { total: 0, data: merged };
      }
    } else {
      // 无标签：推荐/热门歌单
      res = toObj((await axios.get('https://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList', {
        params: { loginUid: 0, loginSid: 0, appUid: 76039576, pn: (page || 1) - 1, rn: ps, order: 'hot' },
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
        timeout: 10000, validateStatus: function () { return true; },
      })).data).data;
    }
    const list = res.data || [];
    return {
      isEnd: (page || 1) * ps >= (res.total || 0),
      data: list.map(function (_) {
        return {
          title: decode(_.name || ''),
          artist: decode(_.uname || ''),
          id: String(_.id),
          artwork: _.img,
          playCount: _.listencnt,
          createUserId: _.uid,
        };
      }),
    };
  }

  // ============================ 歌单导入 / 详情 ============================
  async function getMusicSheetResponseById(id, page, pagesize) {
    const res = toObj((await axios.get('http://nplserver.kuwo.cn/pl.svc', {
      params: {
        op: 'getlistinfo', pid: id, pn: (page || 1) - 1, rn: pagesize || PAGE_SIZE,
        encode: 'utf8', keyset: 'pl2012', vipver: 'MUSIC_9.1.1.2_BCS2', newver: 1,
      },
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' },
      timeout: 10000, validateStatus: function () { return true; },
    })).data);
    // 注意：nplserver 返回键为小写 musiclist
    return { total: res.total || 0, musicList: res.musiclist || [] };
  }

  function parseKuwoSheetId(urlLike) {
    if (!urlLike) return null;
    var s = String(urlLike).trim();
    var m;
    if ((m = s.match(/playlist_detail\/(\d+)/i))) return m[1];
    if ((m = s.match(/h5app\/playlist\/(\d+)/i))) return m[1];
    if ((m = s.match(/^\s*(\d+)\s*$/))) return m[1];
    return null;
  }

  async function importMusicSheet(urlLike) {
    var id = parseKuwoSheetId(urlLike);
    if (!id) return; // 无法识别则交还空（MusicFree 会提示）
    var musicList = [];
    var page = 1;
    var totalPage = 2;
    while (page <= totalPage) {
      try {
        var data = await getMusicSheetResponseById(id, page, 80);
        totalPage = Math.max(1, Math.ceil((data.total || 0) / 80));
        data.musicList.forEach(function (_) {
          musicList.push({
            id: String(_.id),
            title: decode(_.name || ''),
            artist: decode(_.artist || ''),
            album: decode(_.album || ''),
            albumId: _.albumid,
            artistId: _.artistid,
            formats: _.formats,
          });
        });
      } catch (e) {}
      ++page;
      if (page > 30) break; // 安全上限
    }
    return musicList;
  }

  async function getMusicSheetInfo(sheet, page) {
    var res = await getMusicSheetResponseById(sheet.id, page, PAGE_SIZE);
    return {
      isEnd: (page || 1) * PAGE_SIZE >= (res.total || 0),
      musicList: (res.musicList || []).map(function (_) {
        return {
          id: String(_.id),
          title: decode(_.name || ''),
          artist: decode(_.artist || ''),
          album: decode(_.album || ''),
          albumId: _.albumid,
          artistId: _.artistid,
          formats: _.formats,
        };
      }),
      sheetItem: sheet,
    };
  }

  // ============================ 导出 ============================
  var plugin = {
    platform: '酷我',
    version: '0.0.1',
    author: 'tianpeng',
    description: '酷我音源：支持歌单导入、热门歌单、官方排行榜，附带搜索/歌词/专辑/歌手。' +
      '取链使用社区代理 music.nxinxz.com（酷我官方免费接口已失效）。',
    srcUrl: 'https://gitee.com/koujiao/musicfree-tianpeng/raw/master/musicfree-kw/kw.js',
    cacheControl: 'no-cache',
    hints: {
      importMusicSheet: [
        '酷我APP：自建歌单-分享-复制试听链接，直接粘贴即可',
        'H5：复制URL并粘贴，或者直接输入纯数字歌单ID即可',
        '导入时间和歌单大小有关，请耐心等待',
      ],
    },
    supportedSearchType: ['music', 'album', 'sheet', 'artist'],
    async search(query, page, type) {
      if (type === 'music') return await searchMusic(query, page);
      if (type === 'album') return await searchAlbum(query, page);
      if (type === 'artist') return await searchArtist(query, page);
      if (type === 'sheet') return await searchMusicSheet(query, page);
      return { isEnd: true, data: [] };
    },
    getMediaSource: getMediaSource,
    getMusicInfo: getMusicInfo,
    getAlbumInfo: getAlbumInfo,
    getLyric: getLyric,
    getArtistWorks: getArtistWorks,
    getTopLists: getTopLists,
    getTopListDetail: getTopListDetail,
    importMusicSheet: importMusicSheet,
    getRecommendSheetTags: getRecommendSheetTags,
    getRecommendSheetsByTag: getRecommendSheetsByTag,
    getMusicSheetInfo: getMusicSheetInfo,
  };

  if (typeof module !== 'undefined' && module && module.exports) module.exports = plugin;
  if (typeof exports !== 'undefined') exports.default = plugin;
  return plugin;
})();
