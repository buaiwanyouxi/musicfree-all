// 汽水音乐（字节系 Qishui / Luna）音源插件
// 平台：汽水音乐  author：tianpeng  version：0.0.1
//
// 接口契约（经运行时联网实测参考插件「开心汽水.js」+ 真实请求验证得出）：
//   搜索        GET  api-vehicle.volcengine.com/v2/search/type
//   歌曲/歌词   GET  api-vehicle.volcengine.com/v2/custom/contents
//   取链(两步)  GET  beta-luna.douyin.com/luna/h5/seo_track  ->  track_player.url_player_info(GetPlayInfo) / video_model.main_url
//   排行榜详情  GET  api5-lf.qishui.com/luna/charts/<id>?charge=0
//   歌单详情    POST api5-lf.qishui.com/luna/playlist/detail?charge=0   (body: playlist_id)  —— 注意：用开放子域 lf，参考插件用的 lq 被墙返回空
//   热门歌单    POST api5-lq.qishui.com/luna/discover/mix?charge=0       —— 该接口需汽水 App 原生签名(X-Gorgon/X-Argus)，plain 客户端返回空，属已知限制
// 说明：汽水音乐为字节私有加密 API（社区公认难度最高）。搜索/取链/歌词/排行榜/歌单导入均可免签调用；
//      仅「按标签取热门歌单」依赖原生签名，无签 plain 客户端无法返回数据（插件不崩溃、返回空列表）。
(function () {
  var reqFn = (typeof __musicfree_require !== 'undefined') ? __musicfree_require : require;
  var axios = reqFn('axios');

  // ---------- 端点 ----------
  var SEARCH_API = 'https://api-vehicle.volcengine.com/v2/search/type';
  var CONTENT_API = 'https://api-vehicle.volcengine.com/v2/custom/contents';
  var SEO_TRACK = 'https://beta-luna.douyin.com/luna/h5/seo_track';
  var CHARTS_API = 'https://api5-lf.qishui.com/luna/charts/';
  var PLAYLIST_API = 'https://api5-lf.qishui.com/luna/playlist/detail?charge=0';
  var DISCOVER_API = 'https://api5-lq.qishui.com/luna/discover/mix?charge=0';

  var CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36';
  var QISHUI_UA = 'com.luna.music/100159040 (Linux; U; Android 11; zh_CN; Cronet/TTNetVersion:dd1b0931 2024-06-28 QuicVersion:d299248d 2024-04-09)';

  // ---------- 工具 ----------
  function toObj(d) {
    if (typeof d === 'string') { try { return JSON.parse(d); } catch (e) { return {}; } }
    return d || {};
  }
  function getCookie() {
    try { var v = (typeof env !== 'undefined' && env && env.getUserVariables && env.getUserVariables()); return (v && v.cookie) || ''; }
    catch (e) { return ''; }
  }
  // 给需要签名的 qishui 接口附加可选 cookie（用户若提供汽水会话 cookie，可能解锁更多接口）
  function qHeaders() {
    var h = {
      'Accept': '*/*',
      'Content-Type': 'application/json; charset=UTF-8',
      'User-Agent': QISHUI_UA,
      'X-Argus': '=',
      'x-common-params-v2': 'channel=appstore&aid=8478&device_id=1100210274091033',
    };
    var ck = getCookie();
    if (ck) h['Cookie'] = ck;
    return h;
  }

  // 封面重构：汽水 album.url_cover = {uri, urls:[base], template_prefix}
  function artworkFromCover(c) {
    if (!c) return '';
    if (typeof c === 'string') return c;
    if (c.url) return c.url;
    if (c.cover_url) return c.cover_url;
    if (c.pic_url) return c.pic_url;
    if (c.url_cover) {
      var uc = c.url_cover;
      if (typeof uc === 'string') return uc;
      if (uc.urls && uc.urls[0] && uc.uri) {
        return uc.urls[0] + uc.uri + '~' + (uc.template_prefix || 'tplv-b829550vbb') + '-resize:960:960.png';
      }
    }
    return '';
  }
  // 统一字段映射（覆盖 charts / playlist / search 多种形态）
  function formatTrack(it) {
    if (!it) return null;
    var artists = it.artists || it.artist_list || [];
    var artist = it.artist;
    if (!artist && artists.length) artist = artists.map(function (a) { return a.name || a; }).join('/');
    if (!artist && it.artist_info) artist = it.artist_info.name;
    var album = it.album || (it.album_info && it.album_info.name) || '';
    var artwork = artworkFromCover(it.artwork || it.album || it.cover_url || it.pic_url);
    var dur = it.duration;
    if (dur && dur < 1000) dur = dur * 1000; // 秒->毫秒
    return {
      id: String(it.id || it.track_id || it.item_id),
      title: it.title || it.name || it.song_name || '',
      artist: artist || '',
      album: (typeof album === 'object' ? album.name : album) || '',
      artwork: artwork,
      albumId: it.albumId || (it.album && it.album.id),
      duration: dur,
    };
  }

  function parsePlaylistId(s) {
    if (!s) return null;
    var str = String(s).trim();
    var m = str.match(/https?:\/\/(?:.*?)\.douyin\.com\/qishui\/share\/playlist\?playlist_id=(\d+)/) ||
      str.match(/playlist_id=(\d+)/) ||
      str.match(/^\s*(\d{10,})\s*$/);
    return m ? m[1] : null;
  }

  // ---------- 搜索 ----------
  async function search(query, page, type) {
    if (type && type !== 'music') return { isEnd: true, data: [] };
    var r = await axios.get(SEARCH_API, {
      params: {
        keyword: query, search_type: 'music', limit: 20,
        real_offset: (Math.max(1, page || 1) - 1) * 20, search_source: 'qishui',
      },
      timeout: 10000, validateStatus: function () { return true; },
    });
    var d = toObj(r.data);
    var list = (d.data && d.data.list) || [];
    var data = list.map(function (it) {
      return {
        id: String(it.item_id),
        title: it.title || '',
        artist: (it.author_info && it.author_info.name) || '',
        artwork: it.cover_url || '',
        duration: it.duration ? it.duration * 1000 : undefined,
      };
    });
    return { isEnd: list.length < 20, data: data };
  }

  // ---------- 取链（两步：seo_track -> GetPlayInfo / video_model） ----------
  async function getMediaSource(musicItem, quality) {
    var tid = String(musicItem.id);
    var r = await axios.get(SEO_TRACK, {
      params: { track_id: tid, device_platform: 'web' },
      headers: {}, timeout: 10000, validateStatus: function () { return true; },
    });
    var d = toObj(r.data);
    var tp = d.track_player;
    if (!tp) throw new Error('无法获取播放信息（汽水返回异常）');
    var url = null;
    if (tp.url_player_info) {
      try {
        var g = await axios.get(tp.url_player_info, { timeout: 10000, validateStatus: function () { return true; } });
        var gd = toObj(g.data);
        url = gd.url || (gd.video_list && gd.video_list[0] && (gd.video_list[0].main_url || gd.video_list[0].backup_url));
      } catch (e) { /* 忽略，尝试下一条路径 */ }
    }
    if (!url && tp.video_model) {
      try {
        var vm = (typeof tp.video_model === 'string') ? JSON.parse(tp.video_model) : tp.video_model;
        var vl = (vm && vm.video_list) || [];
        if (vl[0]) url = vl[0].main_url || vl[0].backup_url;
      } catch (e) { /* ignore */ }
    }
    if (!url) throw new Error('无法获取播放链接：该汽水歌曲可能已下架或需登录');
    return {
      url: url,
      headers: { 'Referer': 'https://www.douyin.com/', 'User-Agent': CHROME_UA, 'Accept': '*/*' },
    };
  }

  // ---------- 歌曲信息 / 歌词 ----------
  async function getContentItem(id) {
    var r = await axios.get(CONTENT_API, {
      params: { sources: 'qishui', need_author: true, need_album: true, need_ugc: true, need_stat: true, item_ids: String(id) },
      timeout: 10000, validateStatus: function () { return true; },
    });
    var d = toObj(r.data);
    return (d.data && d.data.list && d.data.list[0]) || {};
  }
  async function getMusicInfo(musicItem) {
    var item = await getContentItem(musicItem.id);
    return { artwork: item.cover_url || musicItem.artwork };
  }
  async function getLyric(musicItem) {
    var item = await getContentItem(musicItem.id);
    var li = item.lyric_info || {};
    var ti = item.tlyric_info || {};
    return {
      rawLrc: li.lyric_text || '',
      translation: ti.lyric_text || undefined,
    };
  }

  // ---------- 排行榜 ----------
  async function getTopLists() {
    // 汽水官方公开榜单（实测可免签访问）
    return [{
      title: '汽水音乐排行榜',
      data: [
        { id: '7036274230471712007', title: '热歌榜', description: '汽水音乐内每周热度最高的50首歌，每周四更新', coverImg: 'https://p3-luna.douyinpic.com/img/tos-cn-i-b829550vbb/d0d8d48461a62748e84689cdf049b19a.png~tplv-b829550vbb-resize:960:960.png' },
        { id: '7060812597884869927', title: '新歌榜', description: '近期发行的热度最高的50首新歌，每周四更新', coverImg: 'https://p3-luna.douyinpic.com/img/tos-cn-i-b829550vbb/f12f7eb5b54d0899c7c724df009668a8.png~tplv-b829550vbb-resize:960:960.png' },
        { id: '7061475546400005410', title: '欧美榜', description: '汽水音乐内每周热度最高的50首外文歌曲，每周四更新', coverImg: 'https://p3-luna.douyinpic.com/img/tos-cn-i-b829550vbb/33747550ed5499b58feda42a21748637.png~tplv-b829550vbb-resize:960:960.png' },
        { id: '7415959718721494311', title: '音乐人歌曲榜', description: '抖音音乐人开放平台上传歌曲，综合每周站内热度进行排序展示', coverImg: 'https://p3-luna.douyinpic.com/img/tos-cn-v-2774c002/o8FQKiQQBxHWa2hzsBNAgYOX6iEHEAibADAbfB~tplv-b829550vbb-resize:960:960.png' },
      ],
    }];
  }
  async function getTopListDetail(topListItem, page) {
    var r = await axios.get(CHARTS_API + topListItem.id + '?charge=0', {
      headers: qHeaders(), timeout: 10000, validateStatus: function () { return true; },
    });
    var d = toObj(r.data);
    var ranks = (d.chart && d.chart.track_ranks) || [];
    var musicList = ranks.map(function (x) { return formatTrack(x.track); }).filter(Boolean);
    return { isEnd: true, musicList: musicList };
  }

  // ---------- 热门歌单（标签 + 按标签） ----------
  async function getRecommendSheetTags() {
    // 汽水歌单分类（实测 pinned 列表，稳定不依赖接口）
    var pinned = [
      { id: 0, title: '每日推荐' }, { id: 14, title: '流行' }, { id: 8, title: '华语' },
      { id: 9, title: '欧美' }, { id: 20, title: '国风' }, { id: 18, title: '民谣' },
      { id: 15, title: '摇滚' }, { id: 38, title: '说唱' }, { id: 16, title: '电子' },
      { id: 19, title: 'R&B' }, { id: 69, title: '治愈' }, { id: 45, title: '睡前' }, { id: 40, title: '学习' },
    ];
    return { data: [], pinned: pinned };
  }
  async function getRecommendSheetsByTag(tag, page) {
    // 注意：discover/mix 需汽水 App 原生签名，plain 客户端通常返回空（已知限制，不崩溃）
    try {
      var r = await axios.post(DISCOVER_API, {
        block_type: 'discover_playlist_mix', feed_discover_extra: {},
        latest_douyin_liked_playlist_show_ts: 0,
        sub_channel_id: tag && tag.id,
      }, { headers: qHeaders(), timeout: 10000, validateStatus: function () { return true; } });
      var d = toObj(r.data);
      var arr = d.data || d.mix_list || d.playlists || [];
      if (arr && arr.data) arr = arr.data;
      var data = (arr || []).map(function (it) {
        return {
          id: String(it.id || it.playlist_id),
          title: it.title || it.name || '',
          artist: it.creator || (it.creator_info && it.creator_info.name) || '',
          artwork: it.cover_url || it.pic_url || it.coverImg || '',
          playCount: it.play_count || it.stat && it.stat.play_count,
          createUserId: it.creator_id || it.user_id,
        };
      });
      return { isEnd: !d.has_more, data: data };
    } catch (e) {
      return { isEnd: true, data: [] };
    }
  }

  // ---------- 歌单导入 ----------
  async function getPlaylistRaw(pid) {
    var r = await axios.post(PLAYLIST_API, { playlist_id: pid }, {
      headers: qHeaders(), timeout: 10000, validateStatus: function () { return true; },
    });
    var d = toObj(r.data);
    if (d.status_code) {
      throw new Error('歌单获取失败：' + ((d.status_info && d.status_info.status_msg) || d.status_code));
    }
    return d;
  }
  async function importMusicSheet(urlLike) {
    var pid = parsePlaylistId(urlLike);
    if (!pid) throw new Error('无法识别的汽水歌单链接，请粘贴汽水APP分享链接或纯数字歌单ID');
    var d = await getPlaylistRaw(pid);
    var meta = d.playlist || d;
    var tracks = d.media_resources || d.track_list || d.musics || (meta && meta.media_resources) || [];
    var list = tracks.map(formatTrack).filter(Boolean);
    if (!list.length) throw new Error('该汽水歌单暂无歌曲或需登录后才能访问');
    return list;
  }
  async function getMusicSheetInfo(sheetItem, page) {
    var pid = parsePlaylistId(sheetItem.id) || sheetItem.id;
    var d = await getPlaylistRaw(pid);
    var meta = d.playlist || d;
    var tracks = d.media_resources || d.track_list || d.musics || (meta && meta.media_resources) || [];
    var musicList = tracks.map(formatTrack).filter(Boolean);
    return {
      isEnd: true,
      musicList: musicList,
      sheetItem: {
        id: String(pid),
        title: meta.title || meta.name || sheetItem.title,
        artwork: meta.cover_url || meta.pic_url || meta.coverImg || sheetItem.artwork,
        description: meta.description,
      },
    };
  }

  module.exports = {
    platform: '汽水音乐',
    version: '0.0.1',
    author: 'tianpeng',
    description: '汽水音乐（字节 Luna）音源：搜索/取链/歌词/排行榜/歌单导入。' +
      '搜索、取链、歌词、排行榜、歌单导入均可免签调用；按标签热门歌单依赖汽水原生签名，plain 客户端可能返回空（可在 userVariables 填汽水会话 Cookie 尝试解锁）。',
    srcUrl: 'https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-qs/qs.js',
    cacheControl: 'no-cache',
    supportedSearchType: ['music'],
    userVariables: [
      {
        key: 'cookie',
        name: 'Cookie（可选）',
        hint: '汽水音乐/抖音登录后的会话 Cookie。填入后可能解锁「按标签热门歌单」等需签名的接口；歌单导入与取链通常无需 Cookie。',
      },
    ],
    hints: {
      importMusicSheet: [
        '汽水APP：歌单-分享-分享链接；手动访问链接后再复制链接粘贴即可',
        '网页：复制URL并粘贴，或者直接输入纯数字歌单ID即可',
        '导入时间和歌单大小有关，请耐心等待',
      ],
    },
    search: search,
    getMediaSource: getMediaSource,
    getMusicInfo: getMusicInfo,
    getLyric: getLyric,
    getTopLists: getTopLists,
    getTopListDetail: getTopListDetail,
    getRecommendSheetTags: getRecommendSheetTags,
    getRecommendSheetsByTag: getRecommendSheetsByTag,
    importMusicSheet: importMusicSheet,
    getMusicSheetInfo: getMusicSheetInfo,
  };
})();
