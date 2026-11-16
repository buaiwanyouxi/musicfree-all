// 汽水音乐（字节系 Qishui / Luna）音源插件
// 平台：汽水音乐  author：tianpeng  version：0.0.6
//
// 接口契约（经运行时联网实测参考插件「开心汽水.js」+ 真实请求验证得出）：
//   搜索        GET  api-vehicle.volcengine.com/v2/search/type
//   歌曲/歌词   GET  api-vehicle.volcengine.com/v2/custom/contents
//   取链(两步)  GET  beta-luna.douyin.com/luna/h5/seo_track  ->  track_player.url_player_info(GetPlayInfo) / video_model.main_url
//   排行榜详情  GET  api5-lf.qishui.com/luna/charts/<id>?charge=0
//   歌单详情    POST api5-lf.qishui.com/luna/playlist/detail?charge=0   (body: playlist_id)  —— 注意：用开放子域 lf，参考插件用的 lq 被墙返回空
//   热门歌单    POST api5-lq.qishui.com/luna/discover/mix?charge=0       —— v0.0.6 起用网页 UA 无签名头可免签返回 inner_block 卡片流（伪造 X-Argus/App UA 会被静默清空）
// 说明：汽水音乐为字节私有加密 API（社区公认难度最高）。搜索/取链/歌词/排行榜/歌单导入/热门歌单均可免签调用。
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

  // ---------- 超时/分页/换算 常量（魔数常量化） ----------
  var QS_TIMEOUT = 10000;       // 通用接口超时
  var QS_TRACK_TIMEOUT = 5000;  // 取链两步（seo_track / GetPlayInfo）收紧为 5s
  var QS_SEARCH_SIZE = 20;      // 搜索页大小
  var QS_PAGE_SIZE = 30;        // 排行榜/歌单详情分页大小
  var SEC_TO_MS = 1000;         // 秒 -> 毫秒换算

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
  // discover/mix 专用头（2026-11-16）：网页 UA、【不带】伪造 X-Argus/App 公共参数——实测伪造签名头会让接口静默返回空 {}
  function discoverHeaders() {
    var h = {
      'Accept': '*/*',
      'Content-Type': 'application/json',
      'User-Agent': CHROME_UA,
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
    // 歌单详情 media_resources 形态：{id,type,entity:{track_wrapper:{track:{...}}}}（2026-11-16 修复）：
    //   真实曲目嵌在 entity.track_wrapper.track 内层（字段 name/artists/duration/album），原实现直读外层
    //   导致歌单曲目全空（「歌单里也没有歌曲」）。先解嵌套再映射；兼容 entity.track 直挂形态。
    if (it.entity && it.entity.track_wrapper && it.entity.track_wrapper.track) it = it.entity.track_wrapper.track;
    else if (it.entity && it.entity.track) it = it.entity.track;
    var artists = it.artists || it.artist_list || [];
    var artist = it.artist;
    if (!artist && artists.length) artist = artists.map(function (a) { return a.name || a; }).join('/');
    if (!artist && it.artist_info) artist = it.artist_info.name;
    var album = it.album || (it.album_info && it.album_info.name) || '';
    var artwork = artworkFromCover(it.artwork || it.album || it.cover_url || it.pic_url);
    var dur = it.duration;
    if (dur && dur < SEC_TO_MS) dur = dur * SEC_TO_MS; // 秒->毫秒
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
        keyword: query, search_type: 'music', limit: QS_SEARCH_SIZE,
        real_offset: (Math.max(1, page || 1) - 1) * QS_SEARCH_SIZE, search_source: 'qishui',
      },
      timeout: QS_TIMEOUT, validateStatus: function () { return true; },
    });
    var d = toObj(r.data);
    var list = (d.data && d.data.list) || [];
    var data = list.map(function (it) {
      return {
        id: String(it.item_id),
        title: it.title || '',
        artist: (it.author_info && it.author_info.name) || '',
        artwork: it.cover_url || '',
        duration: it.duration ? it.duration * SEC_TO_MS : undefined,
      };
    });
    return { isEnd: list.length < QS_SEARCH_SIZE, data: data };
  }

  // ---------- 取链（两步：seo_track -> GetPlayInfo / video_model） ----------
  async function seoTrack(trackId) {
    var r = await axios.get(SEO_TRACK, {
      params: { track_id: trackId, device_platform: 'web' },
      headers: {}, timeout: QS_TRACK_TIMEOUT, validateStatus: function () { return true; },
    });
    return toObj(r.data);
  }
  // 从 track_player 解析「可播 URL + 资产时长（秒）」。
  // 时长权威字段：video_model.video_duration（GetPlayInfo Result.Data.Duration 与之实测一致，如 29.002 / 279.918）。
  // URL 两路径：① url_player_info 的 GetPlayInfo（Result.Data.PlayInfoList[].MainPlayUrl，或平铺 gd.url/gd.video_list）；
  //            ② video_model.video_list[0].main_url。实测 GetPlayInfo 用 MainPlayUrl 字段（原 gd.url 解析不到，靠②兜底）。
  async function pickPlayable(tp) {
    var url = null, durSec = 0;
    var vm = tp.video_model;
    if (typeof vm === 'string') { try { vm = JSON.parse(vm); } catch (e) { vm = null; } }
    if (vm && vm.video_duration) durSec = +vm.video_duration || 0;
    if (tp.url_player_info) {
      try {
        var g = await axios.get(tp.url_player_info, { timeout: QS_TRACK_TIMEOUT, validateStatus: function () { return true; } });
        var gd = toObj(g.data);
        url = gd.url || (gd.video_list && gd.video_list[0] && (gd.video_list[0].main_url || gd.video_list[0].backup_url));
        if (gd.Result && gd.Result.Data) {
          var D = gd.Result.Data;
          if (!durSec && D.Duration) durSec = +D.Duration || 0;
          if (!url && D.PlayInfoList && D.PlayInfoList[0]) url = D.PlayInfoList[0].MainPlayUrl || D.PlayInfoList[0].BackupPlayUrl || null;
        }
      } catch (e) { /* 忽略，尝试下一条路径 */ }
    }
    if (!url && vm) {
      var vl = vm.video_list || [];
      if (vl[0]) url = vl[0].main_url || vl[0].backup_url;
    }
    return { url: url, durSec: durSec };
  }
  // 短片段判定：期望时长已知（musicItem.duration 毫秒）且资产不足期望的一半
  function isClip(durSec, expectMs) {
    return !!(expectMs > 0 && durSec > 0 && durSec * SEC_TO_MS < expectMs * 0.5);
  }
  // 【2026-11-16】试听/铃声短片段字节闸门：资产时长元数据缺失（durSec=0）时的兜底判定，
  //   与 qq.js/kg.js/kw.js/wy.js 同口径——Range GET(bytes=0-0) 读资产总字节（content-range 总量优先、
  //   200 的 content-length 兜底），低于「16kbps 半量线」（秒数×2000 字节）判短片段；未知退 1.2MB 绝对阈值。
  //   背景（真机复现）：酷我系聚合站对部分条目回吐铃声/试听片段（「Letting Go」75KB≈12s，
  //   car-bj.kuwo.cn/…/lx/resource/*.aac），仅凭元数据时长无法拦截 durSec 缺失的条目。
  function isPreviewBytes(total, expectMs) {
    if (!total || total < 8192) return false;            // 无法判定（含 206 仅回 range 长度）→ 不误杀
    if (expectMs > 0) return total < (expectMs / 1000) * 2000;
    return total < 1.2 * 1024 * 1024;
  }
  async function urlIsPreview(url, expectMs) {
    if (!url || typeof url !== 'string') return false;
    try {
      var r = await axios.get(url, {
        headers: { 'User-Agent': CHROME_UA, Referer: 'https://www.douyin.com/', Range: 'bytes=0-0' },
        timeout: 4000, validateStatus: function () { return true; }, maxRedirects: 5,
      });
      var total = 0;
      if (r.status >= 200 && r.status < 300) {
        var cr = (r.headers && r.headers['content-range']) || '';
        var mc = /bytes\s+\d+-\d+\/(\d+)/i.exec(cr);
        if (mc) total = parseInt(mc[1], 10);
        else if (r.status === 200 && r.headers && r.headers['content-length']) total = parseInt(r.headers['content-length'], 10) || 0; // 206 的 content-length 仅 range 长度
      }
      return isPreviewBytes(total, expectMs);
    } catch (e) { return false; } // 探测异常不误杀
  }
  async function getMediaSource(musicItem, quality) {
    var d, tp;
    try {
      d = await seoTrack(String(musicItem.id));
      tp = d.track_player;
      if (!tp) throw new Error('无法获取播放信息（汽水返回异常）');
    } catch (e) {
      // 取链零兜底（仅 1 次重试）：seo_track 抛错或 track_player 缺失时，按 musicItem.title 调自身 search
      // 取第一个结果的 id 重试 seo_track；重试仍失败则照常抛错。
      var s = await search(musicItem.title || '', 1, 'music');
      var first = s && s.data && s.data[0];
      if (!first || !first.id) throw e;
      d = await seoTrack(String(first.id));
      tp = d.track_player;
      if (!tp) throw new Error('无法获取播放信息（汽水返回异常）');
    }
    var pk = await pickPlayable(tp);
    if (!pk.url) throw new Error('无法获取播放链接：该汽水歌曲可能已下架或需登录');

    // 修复（2026-11-16）：汽水曲库部分条目资产仅为 20–60s 短视频片段——
    //   实测「孤勇者-陈奕迅」搜索元数据 256s，但 video_model.video_duration=29.002s（GetPlayInfo 同 29s），
    //   播放约 1 分钟即停。现对「资产时长 < 期望时长一半」自动换完整版：
    //   按标题重搜，候选排序（同歌手优先 → 元数据时长接近期望优先），逐个取链校验资产时长
    //   （容差 max(15s, 期望20%)，且不得仍是短片段），命中即换用，最多验证 3 个候选。
    //   全部候选仍为片段（曲库仅有片段授权）时保留原链路并告警，宁可短片段也不拒播。
    var expectMs = musicItem && musicItem.duration;
    // 【2026-11-16】时长元数据缺失（durSec=0）时 isClip 无法判定 → 退字节闸门兜底（Range 读总字节）
    var clipByBytes = false;
    if (!isClip(pk.durSec, expectMs) && !(pk.durSec > 0) && expectMs > 0 && pk.url) {
      clipByBytes = await urlIsPreview(pk.url, expectMs);
    }
    if (isClip(pk.durSec, expectMs) || clipByBytes) {
      var expectSec = expectMs / SEC_TO_MS;
      var myId = String(musicItem.id);
      var myArtist = (musicItem.artist || '').trim();
      try {
        var s2 = await search(musicItem.title || '', 1, 'music');
        var cands = (s2 && s2.data) || [];
        var scored = [];
        for (var i = 0; i < cands.length; i++) {
          var c = cands[i];
          if (!c || !c.id || c.id === myId) continue;               // 排除已证实为片段的原条目
          var md = (c.duration || 0) / SEC_TO_MS;
          if (md > 0 && md < expectSec * 0.5) continue;             // 元数据即短的候选跳过
          var sameArtist = myArtist && (c.artist || '').trim() === myArtist;
          var diff = md > 0 ? Math.abs(md - expectSec) : 1e9;
          scored.push({ c: c, diff: diff, artistRank: sameArtist ? 0 : 1 });
        }
        scored.sort(function (a, b) {
          if (a.artistRank !== b.artistRank) return a.artistRank - b.artistRank;
          return a.diff - b.diff;
        });
        var tried = 0;
        for (var j = 0; j < scored.length && tried < 3; j++) {
          var cand = scored[j].c;
          tried++;
          try {
            var d2 = await seoTrack(String(cand.id));
            var tp2 = d2 && d2.track_player;
            if (!tp2) continue;
            var pk2 = await pickPlayable(tp2);
            if (!pk2.url || isClip(pk2.durSec, expectMs)) continue;                    // 仍是片段
            if (!(pk2.durSec > 0) && (await urlIsPreview(pk2.url, expectMs))) continue; // 【2026-11-16】时长缺失退字节闸门：仍是片段
            if (pk2.durSec > 0 && Math.abs(pk2.durSec - expectSec) > Math.max(15, expectSec * 0.2)) continue; // 时长仍不符
            console.warn('[qs] 短片段换完整版: ' + musicItem.title + ' id ' + myId + ' 资产 ' + pk.durSec + 's -> id ' + cand.id + ' 资产 ' + pk2.durSec + 's (' + (cand.artist || '?') + ')');
            pk = pk2;
            break;
          } catch (e2) { /* 单候选失败继续下一个 */ }
        }
      } catch (e3) { /* 重搜失败保留原链路 */ }
      if (isClip(pk.durSec, expectMs)) {
        console.warn('[qs] ' + (musicItem.title || myId) + ' 在汽水仅有短片段资产(' + pk.durSec + 's)，换源后仍无完整版（曲库限制）');
      }
    }
    return {
      url: pk.url,
      headers: { 'Referer': 'https://www.douyin.com/', 'User-Agent': CHROME_UA, 'Accept': '*/*' },
    };
  }

  // ---------- 歌曲信息 / 歌词 ----------
  async function getContentItem(id) {
    var r = await axios.get(CONTENT_API, {
      params: { sources: 'qishui', need_author: true, need_album: true, need_ugc: true, need_stat: true, item_ids: String(id) },
      timeout: QS_TIMEOUT, validateStatus: function () { return true; },
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
      headers: qHeaders(), timeout: QS_TIMEOUT, validateStatus: function () { return true; },
    });
    var d = toObj(r.data);
    var ranks = (d.chart && d.chart.track_ranks) || [];
    var all = ranks.map(function (x) { return formatTrack(x.track); }).filter(Boolean);
    // 按 page 分页（每页 QS_PAGE_SIZE；MusicFree 页码从 1 开始，即 0-based 的 (page+1)*30 >= total 口径）
    var cur = Math.max(1, page || 1);
    var musicList = all.slice((cur - 1) * QS_PAGE_SIZE, cur * QS_PAGE_SIZE);
    return { isEnd: cur * QS_PAGE_SIZE >= all.length, musicList: musicList };
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
    // 修复（2026-11-16）：原实现两坑叠加导致热门歌单恒空白：
    //   ① 用 qHeaders（含伪造 X-Argus:'=' + App UA）请求 discover/mix，接口静默返回空 {}（实测裸 Chrome UA
    //      无 X-Argus 才返回卡片流；qishui App UA 无合法签名同样被清空）；
    //   ② 解析按 d.data/mix_list/playlists 找列表，实际形态是 inner_block:[{type:'discover_playlist',
    //      resources:[{type:'playlist', entity:{playlist:{...}}}]}]（entity.playlist 内层才是歌单元数据）。
    //   现改网页 UA 无签名头请求 + 按 inner_block/entity.playlist 解析；cursor 分页（每页约 10 卡片）。
    var cur = Math.max(1, page || 1);
    try {
      var r = await axios.post(DISCOVER_API, {
        block_type: 'discover_playlist_mix', feed_discover_extra: {},
        latest_douyin_liked_playlist_show_ts: 0,
        sub_channel_id: tag && tag.id,
        cursor: (cur - 1) * 10,
      }, { headers: discoverHeaders(), timeout: QS_TIMEOUT, validateStatus: function () { return true; } });
      var d = toObj(r.data);
      var blocks = d.inner_block || d.data || d.mix_list || d.playlists || [];
      if (blocks && blocks.data) blocks = blocks.data;
      var data = [];
      (blocks || []).forEach(function (b) {
        var resArr = (b && b.resources) || [];
        if (!resArr.length && b && b.entity) resArr = [b];
        resArr.forEach(function (rr) {
          var pl = (rr && rr.entity && rr.entity.playlist) || (b && b.playlist) || null;
          if (!pl) return;
          data.push({
            id: String(pl.id || (b && b.inner_block_id) || ''),
            title: pl.title || (b && b.title) || '',
            artist: (pl.owner && pl.owner.nickname) || '',
            artwork: artworkFromCover(pl.url_cover || pl.cover_url),
            description: pl.desc,
            playCount: pl.play_count || (pl.stats && pl.stats.play_count),
            createUserId: pl.owner && pl.owner.id,
          });
        });
      });
      return { isEnd: !d.has_more, data: data };
    } catch (e) {
      console.warn('[qs] discover/mix 失败: ' + (e && e.message));
      return { isEnd: true, data: [] };
    }
  }

  // ---------- 歌单导入 ----------
  async function getPlaylistRaw(pid) {
    var r = await axios.post(PLAYLIST_API, { playlist_id: pid }, {
      headers: qHeaders(), timeout: QS_TIMEOUT, validateStatus: function () { return true; },
    });
    var d = toObj(r.data);
    if (d.status_code) {
      throw new Error('歌单获取失败：' + ((d.status_info && d.status_info.status_msg) || d.status_code));
    }
    return d;
  }
  // 歌单曲目提取（importMusicSheet / getMusicSheetInfo 共用，去重四元表达式）
  function extractTracks(d) {
    var meta = d.playlist || d;
    return d.media_resources || d.track_list || d.musics || (meta && meta.media_resources) || [];
  }
  async function importMusicSheet(urlLike) {
    var pid = parsePlaylistId(urlLike);
    if (!pid) throw new Error('无法识别的汽水歌单链接，请粘贴汽水APP分享链接或纯数字歌单ID');
    var d = await getPlaylistRaw(pid);
    var list = extractTracks(d).map(formatTrack).filter(Boolean);
    if (!list.length) throw new Error('该汽水歌单暂无歌曲或需登录后才能访问');
    return list;
  }
  async function getMusicSheetInfo(sheetItem, page) {
    var pid = parsePlaylistId(sheetItem.id) || sheetItem.id;
    var d = await getPlaylistRaw(pid);
    var meta = d.playlist || d;
    var musicList = extractTracks(d).map(formatTrack).filter(Boolean);
    // 按 page 分页（每页 QS_PAGE_SIZE；MusicFree 页码从 1 开始）；importMusicSheet 仍全量拉取不受影响
    var cur = Math.max(1, page || 1);
    var pageList = musicList.slice((cur - 1) * QS_PAGE_SIZE, cur * QS_PAGE_SIZE);
    return {
      isEnd: cur * QS_PAGE_SIZE >= musicList.length,
      musicList: pageList,
      sheetItem: {
        id: String(pid),
        title: meta.title || meta.name || sheetItem.title,
        artwork: meta.cover_url || meta.pic_url || meta.coverImg || sheetItem.artwork,
        description: meta.description,
      },
    };
  }

  var plugin = {
    platform: '汽水音乐',
    version: '0.0.7',
    author: 'tianpeng',
    description: '汽水音乐（字节 Luna）音源：搜索/取链/歌词/排行榜/歌单/热门歌单。' +
      '搜索、取链、歌词、排行榜、歌单导入、按标签热门歌单均可免签调用（v0.0.6 修复热门歌单空白与歌单曲目为空）。',
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@v0.0.7/musicfree-qs/github/qs.js',
    cacheControl: 'no-cache',
    supportedSearchType: ['music'],
    primaryKey: ['id'],
    userVariables: [
      {
        key: 'cookie',
        name: 'Cookie（可选）',
        hint: '汽水音乐/抖音登录后的会话 Cookie。填入后可能解锁「按标签热门歌单」等需签名的接口；歌单导入与取链通常无需 Cookie。',
      },
    ],
    hints: {
      getMediaSource: [
        '当前单音质输出（quality 参数暂未分档）',
      ],
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
    // 诊断用内部接口（不影响取链）
    _internal: {
      formatTrack: formatTrack,
      parsePlaylistId: parsePlaylistId,
      // 【2026-11-16】试听/铃声短片段闸门（供单测）
      isPreviewBytes: isPreviewBytes,
      urlIsPreview: urlIsPreview,
    },
  };

  if (typeof module !== 'undefined' && module && module.exports) module.exports = plugin;
  if (typeof exports !== 'undefined') exports.default = plugin;
  return plugin;
})();
