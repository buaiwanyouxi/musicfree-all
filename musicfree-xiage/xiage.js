// 我要下歌 (xiage) MusicFree 插件 · 后端：铜钟 Tonzhon (https://tonzhon.com)
// 全链路统一走 Tonzhon 音源 (https://tonzhon.com/api.php)：
//   - 歌单/排行榜  : Tonzhon types=playlist（网易云/酷狗/QQ 三源）
//   - 搜索          : Tonzhon types=search  (source=netease)
//   - 歌词 / 封面   : Tonzhon types=lyric / types=pic
//   - 播放直链      : 按来源路由至各自官方后端，均直取真实可播 CDN：
//                     ① 网易云 → weapi song/enhance/player/url（纯 JS AES-128-CBC，零外部依赖，桌面/移动端通用）
//                     ② 腾讯QQ → musicu.fcg vkey.GetVkeyServer (CgiGetVkey)，实测 12/12 可播
//                     ③ 酷狗   → wwwapi.kugou.com play/getdata
//                     各后端失败均 best-effort 回退：按歌名匹配网易云 id 走 weapi。
// 说明：网易云免费外链 outer/url 近期大面积限制，故网易云改用 weapi；QQ/酷狗亦各自直连官方取链端点。
//
// ⚠️ 已知后端限制（Tonzhon 实测）：
//   - 汽水(qishui)/抖音：Tonzhon 无此源，静默回退网易云，无法提供真实汽水内容。
//   - 酷我(kuwo)/百度(baidu)：Tonzhon 的 types=playlist 对这两源返回空(0字节)，无法提供歌单/榜单。
//   - QQ 官方巅峰榜 disstid 在 Tonzhon 上已变更（仅返回"今日私享"类算法歌单），故 QQ 分组采用已验证可返回的精选/每日榜单。
//   - 酷狗歌单名 Tonzhon 不返回，分组标题为人工标注。
//
// 返回值结构严格遵循 MusicFree 插件协议：
//  - getTopLists       -> IMusicSheetGroupItem[] = [{ title, data: IMusicSheetItem[] }]
//  - getTopListDetail  -> { isEnd, musicList: IMusicItem[] }
//  - getMusicSheetInfo -> { isEnd, musicList: IMusicItem[] }
//  - search            -> { isEnd, data: IMusicItem[] }
//  - importMusicSheet  -> IMusicItem[]
//  - importMusicItem   -> IMusicItem
//  - getMediaSource    -> { url }（已解析为可播直链）
//  - getLyric          -> { rawLrc }
//
// ===== 跨加载器协议兼容（关键）=====
// MusicFree 存在两种插件加载协议：
//   (A) 新协议 CommonJS：沙箱注入 module/exports，期望 `module.exports = {...}`；
//   (B) 老协议 `return ${funcCode}`：把整段源码当表达式返回对象，且不注入 module/exports。
// 若插件只写 `module.exports = {...}`，在老协议加载器下 `module` 未定义 → ReferenceError → 安装报“插件无法解析”。
// 故本插件整体包为 IIFE 表达式，既用 module.exports 兼容(A)，其返回值又兼容(B)，并用 typeof 安全取 require。
(function () {
  // ---- 安全获取 require（兼容两种沙箱注入名）----
  var reqFn = (
    typeof __musicfree_require !== 'undefined' ? __musicfree_require :
    (typeof require !== 'undefined' ? require : null)
  );
  if (!reqFn) {
    throw new Error('[xiage] 插件沙箱未提供 require，无法加载');
  }
  var axios = reqFn('axios');
  // 用 qs 构造 query string（避免沙箱未注入的 URLSearchParams）；若 qs 不可用则回退手动拼接
  var qs = (function () { try { return reqFn('qs'); } catch (e) { return null; } })();

  // ===== 铜钟 Tonzhon 音源后端（歌单/搜索/歌词）=====
  var TZ = 'https://tonzhon.com/api.php';
  // 网易云 weapi 播放端点（直取可播 CDN，绕开已失效的 outer/url 外链）
  var NETEASE_WEAPI = 'https://music.163.com/weapi/song/enhance/player/url/v1?csrf_token=';

  var UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // ===== 平台歌单/榜单定义（ID 均经 Tonzhon 实测可返回曲目）=====

  // 网易云官方排行榜（稳定 ID）
  var NETEASE_RANKS = [
    { id: '19723756', title: '云音乐飙升榜' },
    { id: '3779629', title: '云音乐新歌榜' },
    { id: '3778678', title: '云音乐热歌榜' },
    { id: '2884035', title: '网易原创歌曲榜' },
    { id: '2809577409', title: '云音乐欧美新歌榜' },
    { id: '1978921795', title: '云音乐电音榜' },
    { id: '3411278', title: '云音乐快手榜' },
    { id: '1747976524', title: '云音乐怀旧榜' },
    { id: '6723173524', title: '云音乐网络歌曲榜' }
  ];

  // 酷狗官方排行榜（ID 见社区榜单清单，经 Tonzhon 实测返回曲目）
  var KUGOU_RANKS = [
    { id: '59703', title: '酷狗·蜂鸟流行音乐榜' },
    { id: '52144', title: '酷狗·抖音热歌榜' },
    { id: '52767', title: '酷狗·快手热歌榜' },
    { id: '24971', title: '酷狗·DJ热歌榜' },
    { id: '31308', title: '酷狗·内地榜' }
  ];

  // QQ音乐歌单（Tonzhon 上官方巅峰榜 disstid 已变更，采用已验证可返回的精选/每日榜单）
  var QQ_RANKS = [
    { id: '7013848675', title: 'QQ音乐·【ACG治愈】即使孤单也要温柔' },
    { id: '7021611886', title: 'QQ音乐·影魔炎的今日私享' }
  ];

  // 热门歌单·网易云（已验证可返回曲目的精选歌单）
  var NETEASE_HOT = [
    { id: '3136952023', title: '网易云·私人雷达' },
    { id: '528437612', title: '网易云·圆神电音' },
    { id: '3778679', title: '网易云·CNBLUE 热门50单曲' }
  ];

  // 热门歌单·酷狗（ID 经 Tonzhon 实测返回曲目；歌单名 Tonzhon 不返回，人工标注）
  var KUGOU_HOT = [
    { id: '709458', title: '酷狗热门精选①' },
    { id: '125032', title: '酷狗热门精选②' },
    { id: '123', title: '酷狗热门大歌单(500首)' }
  ];

  // 热门歌单·QQ音乐（已验证可返回曲目）
  var QQ_HOT = [
    { id: '7021611884', title: 'QQ音乐·犯二才是青春的今日私享' },
    { id: '7021611885', title: 'QQ音乐·字' }
  ];

  // ===== Tonzhon api.php 统一 POST 封装 =====
  function tzPost(types, extra) {
    var data = Object.assign({ types: types }, extra || {});
    var keys = Object.keys(data);
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      parts.push(keys[i] + '=' + encodeURIComponent(data[keys[i]]));
    }
    var body = parts.join('&');
    return axios
      .post(TZ, body, {
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: 'https://tonzhon.com/'
        },
        timeout: 15000
      })
      .then(function (r) { return r.data; });
  }

  // 歌手字段扁平化：Tonzhon 搜索返回 [["周杰伦,温岚"]]，网易云返回 [{name}]
  function flattenArtist(a) {
    if (!a) return '';
    if (typeof a === 'string') return a;
    if (Array.isArray(a)) {
      var out = [];
      for (var i = 0; i < a.length; i++) {
        var x = a[i];
        if (typeof x === 'string') out.push(x);
        else if (Array.isArray(x)) out.push(x.join('/'));
        else if (x && x.name) out.push(x.name);
      }
      return out.filter(Boolean).join('/');
    }
    return '';
  }

  // ===== 网易云 weapi 播放端点（纯 JS AES-128-CBC 实现，无任何外部依赖，桌面/移动端沙箱通用）=====
  // 加密为 AES-128-CBC（两次）+ RSA；为最大化沙箱可移植性（避免依赖 crypto-js/big-integer，桌面/移动端通用），
  // 此处采用纯 JS 实现：AES 自实现，RSA 采用【固定 secKey + 预计算 encSecKey 常量】规避运行时大数运算。
  var WEAPI_NONCE = '0CoJUm6Qyw8W8jud';
  var WEAPI_IV = '0102030405060708';
  var WEAPI_SEC_KEY = '0CoJUm6Qyw8W8jud'; // 固定外层 AES 密钥（第三方客户端通用做法）
  var WEAPI_ENC_SEC_KEY =
    'bf50d0bcf56833b06d8d1219496a452a1d860fd58a14c0aafba3e770104ca77dc6856cb310ed3309039e6865081be4ddc2df52663373b20b70ac25b4d0c6ca466daef6b50174e93536e2d580c49e70649ad1936584899e85722eb83ceddfb4f56c1172fca5e60592d0e6ee3e8e02be1fe6e53f285b0389162d8e6ddc553857cd'; // RSA(reversed(SEC_KEY)) 预计算常量

  // --- 纯 JS AES-128-CBC（PKCS7）---
  var _SBOX = [0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
  var _RCON = [0x01000000,0x02000000,0x04000000,0x08000000,0x10000000,0x20000000,0x40000000,0x80000000,0x1b000000,0x36000000];
  function _subWord(w){return (_SBOX[(w>>>24)&0xff]<<24)|(_SBOX[(w>>>16)&0xff]<<16)|(_SBOX[(w>>>8)&0xff]<<8)|_SBOX[w&0xff];}
  function _rotWord(w){return ((w<<8)|(w>>>24))>>>0;}
  function _keyExp(key){var Nk=4,Nr=10;var w=new Array(44);for(var i=0;i<Nk;i++)w[i]=(key[4*i]<<24)|(key[4*i+1]<<16)|(key[4*i+2]<<8)|key[4*i+3];for(var i=Nk;i<44;i++){var t=w[i-1];if(i%Nk===0)t=_subWord(_rotWord(t))^_RCON[(i/Nk)-1];w[i]=(w[i-Nk]^t)>>>0;}return w;}
  function _gfMul(a,b){var p=0;for(var i=0;i<8;i++){if(b&1)p^=a;var hi=a&0x80;a=(a<<1)&0xff;if(hi)a^=0x1b;b>>=1;}return p&0xff;}
  function _encBlock(block,w){var Nr=10;var s=block.slice();var addRK=function(rnd){for(var c=0;c<4;c++){var word=w[rnd*4+c];s[c*4]^=(word>>>24)&0xff;s[c*4+1]^=(word>>>16)&0xff;s[c*4+2]^=(word>>>8)&0xff;s[c*4+3]^=word&0xff;}};addRK(0);for(var r=1;r<Nr;r++){for(var i=0;i<16;i++)s[i]=_SBOX[s[i]];var sh=s.slice();for(var row=1;row<4;row++)for(var c=0;c<4;c++)s[c*4+row]=sh[((c+row)%4)*4+row];for(var c=0;c<4;c++){var i=c*4;var a0=s[i],a1=s[i+1],a2=s[i+2],a3=s[i+3];s[i]=_gfMul(a0,2)^_gfMul(a1,3)^a2^a3;s[i+1]=a0^_gfMul(a1,2)^_gfMul(a2,3)^a3;s[i+2]=a0^a1^_gfMul(a2,2)^_gfMul(a3,3);s[i+3]=_gfMul(a0,3)^a1^a2^_gfMul(a3,2);}addRK(r);}for(var i=0;i<16;i++)s[i]=_SBOX[s[i]];var sh=s.slice();for(var row=1;row<4;row++)for(var c=0;c<4;c++)s[c*4+row]=sh[((c+row)%4)*4+row];addRK(Nr);return s;}
  function _utf8Bytes(str){var out=[];for(var i=0;i<str.length;i++){var c=str.charCodeAt(i);if(c<0x80)out.push(c);else if(c<0x800){out.push(0xc0|(c>>6),0x80|(c&0x3f));}else if(c<0xd800||c>=0xe000){out.push(0xe0|(c>>12),0x80|((c>>6)&0x3f),0x80|(c&0x3f));}else{i++;c=0x10000+(((c&0x3ff)<<10)|(str.charCodeAt(i)&0x3ff));out.push(0xf0|(c>>18),0x80|((c>>12)&0x3f),0x80|((c>>6)&0x3f),0x80|(c&0x3f));}}return out;}
  function _toB64(bytes){var CH='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';var s='';for(var i=0;i<bytes.length;i+=3){var b0=bytes[i],b1=i+1<bytes.length?bytes[i+1]:0,b2=i+2<bytes.length?bytes[i+2]:0;var n=(b0<<16)|(b1<<8)|b2;s+=CH[(n>>18)&0x3f]+CH[(n>>12)&0x3f]+(i+1<bytes.length?CH[(n>>6)&0x3f]:'=')+(i+2<bytes.length?CH[n&0x3f]:'=');}return s;}
  function _pkcs7(b,bs){var p=bs-(b.length%bs);var o=b.slice();for(var i=0;i<p;i++)o.push(p);return o;}
  function _aesCbc(text,keyStr){var kb=_utf8Bytes(keyStr),ivb=_utf8Bytes(WEAPI_IV);var pt=_pkcs7(_utf8Bytes(text),16);var w=_keyExp(kb);var out=[];var prev=ivb.slice();for(var b=0;b<pt.length;b+=16){var blk=pt.slice(b,b+16).map(function(x,i){return x^prev[i];});var e=_encBlock(blk,w);for(var i=0;i<16;i++)out.push(e[i]);prev=e;}return _toB64(out);}
  function weapiEncrypt(text) {
    var p1 = _aesCbc(text, WEAPI_NONCE);
    var p2 = _aesCbc(p1, WEAPI_SEC_KEY);
    return { params: p2, encSecKey: WEAPI_ENC_SEC_KEY };
  }

  // 直连网易云 weapi 取播放直链（返回 http(s) CDN；下架/变灰曲返回 null）
  function getNeteaseUrl(id) {
    try {
      var payload = JSON.stringify({ ids: '[' + id + ']', level: 'standard', encodeType: 'mp3', csrf_token: '' });
      var enc = weapiEncrypt(payload);
      // 构造 params/encSecKey 表单（沙箱未注入 URLSearchParams，改用 qs 或手动拼接）
      var reqBody = 'params=' + encodeURIComponent(enc.params) + '&encSecKey=' + encodeURIComponent(enc.encSecKey);
      return axios
        .post(NETEASE_WEAPI, reqBody, {
          headers: {
            'User-Agent': UA,
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: 'https://music.163.com/'
          },
          timeout: 10000
        })
        .then(function (r) {
          var u = r.data && r.data.data && r.data.data[0] ? r.data.data[0].url : null;
          return u || null;
        })
        .catch(function (e) { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }
  function forceHttps(u) {
    return String(u).replace(/^http:\/\//i, 'https://');
  }

  // 尝试从 Tonzhon types=url 取自有音源直链（当前对全部音源返回空，故多数为 null）
  function tzAudioUrl(id, source) {
    try {
      return tzPost('url', { id: String(id), source: source || 'netease' }).then(function (r) {
        var u = r && r.url ? r.url : '';
        if (u) {
          return u
            .replace(/^http:\/\//i, 'https://')
            .replace(/m7c\.music\./g, 'm7.music.')
            .replace(/m8c\.music\./g, 'm8.music.');
        }
        return null;
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  // 用歌名 best-effort 匹配网易云 id（用于非网易源歌曲的播放/歌词回退）
  function matchNeteaseByQuery(name, artist) {
    if (!name) return Promise.resolve(null);
    function tryQuery(q) {
      return tzPost('search', { source: 'netease', name: q, pages: 1, count: 1 })
        .then(function (arr) {
          var it = Array.isArray(arr) ? arr[0] : null;
          return it && it.id ? String(it.id) : null;
        })
        .catch(function (e) { return null; });
    }
    return tryQuery(name).then(function (id) {
      if (!id && artist) return tryQuery(name + ' ' + artist);
      return id;
    });
  }

  // ===== 腾讯QQ 音频后端：musicu.fcg vkey.GetVkeyServer (CgiGetVkey) =====
  // 经实测：QQ 官方取链接口，无需登录即可返回真实可播直链（aqqmusic.tc.qq.com/...?vkey=...）。
  function getQQUrl(mid) {
    if (!mid) return Promise.resolve(null);
    try {
      var data = {
        req_0: {
          module: 'vkey.GetVkeyServer',
          method: 'CgiGetVkey',
          param: {
            guid: String(Math.floor(Math.random() * 1e10)).padStart(10, '0'),
            songmid: [String(mid)],
            songtype: [0],
            uin: '0',
            loginflag: 1,
            platform: '20'
          }
        },
        comm: { uin: 0, format: 'json', ct: 24, cv: 0 }
      };
      var url =
        'https://u.y.qq.com/cgi-bin/musicu.fcg?-=getplaysongvkey&g_tk=5381&loginUin=0&hostUin=0' +
        '&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0' +
        '&data=' + encodeURIComponent(JSON.stringify(data));
      return axios
        .get(url, { headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' }, timeout: 12000 })
        .then(function (r) {
          var v = r.data && r.data.req_0 && r.data.req_0.data;
          if (v) {
            var sip = (v.sip && v.sip[0]) || '';
            var info = (v.midurlinfo && v.midurlinfo[0]) || {};
            var purl = info.purl || '';
            if (purl) return forceHttps(sip + purl);
          }
          return null;
        })
        .catch(function (e) { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  // ===== 酷狗音频后端：wwwapi.kugou.com play/getdata =====
  // 说明：免费曲可返回 play_url；付费/区域限制曲为空，此时回退网易云匹配。
  function getKugouUrl(hash, albumId) {
    if (!hash) return Promise.resolve(null);
    try {
      var url =
        'https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=' + hash +
        '&album_id=' + (albumId || '') +
        '&dfid=&mid=286974383886022203545511837994020015101&platid=4';
      return axios
        .get(url, { headers: { 'User-Agent': UA, Referer: 'https://www.kugou.com/' }, timeout: 12000 })
        .then(function (r) {
          var d = r.data && r.data.data;
          if (d) {
            var u = d.play_url || d.url || d.play_backup_url;
            if (u) return forceHttps(u);
          }
          return null;
        })
        .catch(function (e) { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  // ===== 各源歌曲映射 =====

  // 网易云：d.playlist.tracks
  function mapNeteaseTracks(tracks) {
    return (tracks || []).map(function (t) {
      return {
        id: 'tz_' + t.id,
        title: t.name || '',
        artist: (t.ar || []).map(function (a) { return a.name; }).join('/'),
        album: (t.al && t.al.name) || '',
        artwork: (t.al && t.al.picUrl) || '',
        duration: t.dt ? Math.round(t.dt / 1000) : 0,
        _nzId: String(t.id),
        _lyricId: String(t.id),
        _source: 'netease'
      };
    });
  }

  // 酷狗：d.data.info[]，filename 为 "歌手 - 歌名"
  function mapKugouTracks(info) {
    return (info || []).map(function (t) {
      var fm = t.filename || '';
      var i = fm.indexOf(' - ');
      var artist = i > 0 ? fm.slice(0, i).trim() : '';
      var title = i > 0 ? fm.slice(i + 3).trim() : fm.trim();
      return {
        id: 'kg_' + t.hash,
        title: title,
        artist: artist,
        album: '',
        artwork: '',
        duration: t.duration ? Number(t.duration) : 0,
        _src: 'kugou',
        _kgHash: t.hash,
        _name: title,
        _artist: artist
      };
    });
  }

  // QQ音乐：d.data.cdlist[0].songlist[]
  function mapTencentTracks(songlist) {
    return (songlist || []).map(function (s) {
      var singer;
      if (Array.isArray(s.singer)) {
        singer = s.singer
          .map(function (x) { return typeof x === 'string' ? x : (x && x.name) || ''; })
          .filter(Boolean)
          .join('/');
      } else {
        singer = s.singer || '';
      }
      var album = typeof s.album === 'string' ? s.album : (s.album && s.album.name) || '';
      return {
        id: 'qq_' + s.mid,
        title: s.name || '',
        artist: singer,
        album: album,
        artwork: '',
        duration: s.interval ? Number(s.interval) : 0,
        _src: 'tencent',
        _qqMid: s.mid,
        _name: s.name,
        _artist: singer
      };
    });
  }

  // ===== 链接识别（导入）=====
  function detectPlatform(input) {
    var s = String(input || '');
    if (/music\.163\.com/.test(s)) {
      var m = s.match(/[?&/#]id=(\d+)/) || s.match(/\/(?:song|playlist)\/(\d+)/);
      if (m) return { server: 'netease', id: m[1] };
    }
    if (/y\.qq\.com|qq\.com/.test(s)) {
      var m2 =
        s.match(/disstid=(\d+)/) ||
        s.match(/\/(?:playlist|songDetail)\/([A-Za-z0-9]+)/) ||
        s.match(/[?&/#]id=([A-Za-z0-9]+)/);
      if (m2) return { server: 'tencent', id: m2[1] };
    }
    return null;
  }

  // 构建分组（标题/ID 均预置，避免 getTopLists 阶段大量网络请求导致超时）
  function buildGroup(title, list, src, kindLabel) {
    return {
      title: title,
      data: list.map(function (p) {
        return {
          id: 'pl_' + src + '_' + p.id,
          title: p.title,
          artwork: '',
          description: kindLabel,
          _kind: 'tzpl',
          _src: src,
          _plId: p.id
        };
      })
    };
  }

    // ===== 插件导出对象 =====

    // 歌单/榜单详情抓取：提升为 IIFE 自由函数（与 getNeteaseUrl 等并列）。
    // 关键修复：此前写在 plugin 对象字面量里作为属性，而 getTopListDetail/getMusicSheetInfo
    // 用裸 _fetchSongs(...) 调用，作用域中无此自由变量 → ReferenceError → 排行榜/歌单详情为空。
    function _fetchSongs(sheetItem) {
      if (!sheetItem || sheetItem._kind !== 'tzpl') return Promise.resolve({ songs: [], hasNext: false });
      var src = sheetItem._src;
      try {
        if (src === 'netease') {
          return tzPost('playlist', { id: sheetItem._plId, source: 'netease' }).then(function (d) {
            var tracks = (d && d.playlist && d.playlist.tracks) || [];
            return { songs: mapNeteaseTracks(tracks), hasNext: false };
          });
        }
        if (src === 'kugou') {
          return tzPost('playlist', { id: sheetItem._plId, source: 'kugou' }).then(function (d) {
            var info = (d && d.data && d.data.info) || [];
            return { songs: mapKugouTracks(info), hasNext: false };
          });
        }
        if (src === 'tencent') {
          return tzPost('playlist', { id: sheetItem._plId, source: 'tencent' }).then(function (d) {
            var cd = (d && d.data && d.data.cdlist) || [];
            var sl = cd.length ? cd[0].songlist || [] : [];
            return { songs: mapTencentTracks(sl), hasNext: false };
          });
        }
      } catch (e) {
        return Promise.resolve({ songs: [], hasNext: false });
      }
      return Promise.resolve({ songs: [], hasNext: false });
    }

    // 试听片段探测：QQ 免费账号对部分曲（含非 VIP 的试听限制曲）经 CgiGetVkey 返回 30s 试听片段，
    // 仅凭 CgiGetVkey 的 buy 标志无法区分（预览曲与完整曲标志完全相同，见实测），必须以「实际文件大小」判定。
    // 用 Range GET（bytes=0-0）取响应头 content-range 的 TOTAL 字节数；aqqmusic 等 CDN 对 HEAD 不回 content-length，
    // 但对 Range GET 稳定回 content-range: bytes 0-0/TOTAL。30s@128kbps≈500KB，完整曲通常≥2MB，阈值取 1.2MB。
    // 无法判断（请求失败/不支持 Range）时返回 false，绝不误伤完整曲、绝不阻塞播放。
    function looksLikePreview(url) {
      if (!url || typeof url !== 'string') return Promise.resolve(false);
      var u = forceHttps(url);
      return axios
        .get(u, {
          headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/', Range: 'bytes=0-0' },
          responseType: 'stream',
          timeout: 5000,
          validateStatus: function () { return true; }
        })
        .then(function (r) {
          try { r.data.resume(); } catch (e) { /* 丢弃响应体，仅读头 */ }
          var cr = r.headers && r.headers['content-range'];
          if (cr) {
            var m = /bytes\s+\d+-\d+\/(\d+)/i.exec(cr);
            if (m) {
              var total = parseInt(m[1], 10);
              return total > 0 && total < 1.2 * 1024 * 1024;
            }
          }
          // 兜底：部分 CDN 不支持 Range 时退用 content-length
          var cl = r.headers && r.headers['content-length'] ? parseInt(r.headers['content-length'], 10) : 0;
          return cl > 0 && cl < 1.2 * 1024 * 1024;
        })
        .catch(function () { return false; });
    }

    // 按歌名+歌手匹配网易云并返回「首个完整」直链（QQ/酷狗 试听或取链失败时的回退，网易云直连不产试听）。
    // 关键点：网易云搜索结果首位常为官方版但可能已变灰（weapi 返回 url:null），个别匹配到的曲即便返回直链也可能是
    // 试听片段（实测白月光与朱砂痣 大籽版网易云直链仅 0.94MB ≈ 试听）。故遍历前若干结果，按 Tonzhon 相关度顺序
    // 逐个取链并排除试听片段（<1.2MB），返回首个「完整」直链；若候选全是试听/变灰，则退回最后一个非空直链（至少能播）。
    // 实测：慢冷 Live 首位李荣浩版变灰→第 2 名梁静茹版完整 1.5MB 命中；白月光首位试听→继续命中完整版。
    function getNeteaseUrlForQuery(name, artist) {
      if (!name) return Promise.resolve(null);
      return tzPost('search', { source: 'netease', name: name, pages: 1, count: 8 })
        .then(function (arr) {
          var list = Array.isArray(arr) ? arr : [];
          if (!list.length) return null;
          var lastAny = null;
          var chain = list.reduce(function (p, it) {
            var id = it && it.id ? String(it.id) : null;
            if (!id) return p;
            return p.then(function (found) {
              if (found) return found; // 已找到完整直链，短路后续取链
              return getNeteaseUrl(id).then(function (u) {
                if (!u) return null;
                lastAny = u; // 记录最近一个非空直链，供全试听时兜底
                return looksLikePreview(u).then(function (isPrev) {
                  return isPrev ? null : u; // 完整→命中；试听/变灰→继续下一个候选
                });
              });
            });
          }, Promise.resolve(null));
          return chain.then(function (found) { return found || lastAny; });
        })
        .catch(function (e) { return null; });
    }

    var plugin = {
      platform: '我要下歌',
      version: '0.0.14',
    author: 'tianpeng',
    // 安装/更新地址：raw.giteeusercontent.com 直链（gitee.com/raw 会 302，虽 axios 跟随但直链更稳）
    srcUrl: 'https://raw.giteeusercontent.com/koujiao/musicfree-tianpeng/raw/master/musicfree-xiage/xiage.js',
    description:
      '我要下歌(xiage) 音乐插件 · 铜钟Tonzhon音源：网易云/酷狗/QQ 排行榜与热门歌单，搜索/歌词走 tonzhon.com，播放按来源路由至官方后端——网易云 weapi / 腾讯QQ CgiGetVkey / 酷狗 play/getdata，失败回退网易云匹配',
    cacheControl: 'no-store',
    supportedSearchType: ['music'],

    // ===== 排行榜 / 热门歌单（全部来自 Tonzhon playlist 接口，按平台分组）=====
    getTopLists: function () {
      var groups = [];
      groups.push(buildGroup('网易云排行榜', NETEASE_RANKS, 'netease', '排行榜'));
      groups.push(buildGroup('酷狗排行榜', KUGOU_RANKS, 'kugou', '排行榜'));
      groups.push(buildGroup('QQ音乐歌单', QQ_RANKS, 'tencent', '排行榜'));
      groups.push(buildGroup('热门歌单·网易云', NETEASE_HOT, 'netease', '热门歌单'));
      groups.push(buildGroup('热门歌单·酷狗', KUGOU_HOT, 'kugou', '热门歌单'));
      groups.push(buildGroup('热门歌单·QQ音乐', QQ_HOT, 'tencent', '热门歌单'));
      return Promise.resolve(groups);
    },

    getTopListDetail: function (topListItem, page) {
      page = page || 1;
      return _fetchSongs(topListItem).then(function (res) {
        return { isEnd: res.songs.length === 0 || !res.hasNext, musicList: res.songs };
      });
    },

    getMusicSheetInfo: function (sheetItem, page) {
      page = page || 1;
      return _fetchSongs(sheetItem).then(function (res) {
        return { isEnd: res.songs.length === 0 || !res.hasNext, musicList: res.songs };
      });
    },

    // ===== 搜索（Tonzhon，netease 源）=====
    search: function (query, page, type) {
      page = page || 1;
      if (type && type !== 'music') return Promise.resolve({ isEnd: true, data: [] });
      var q = (query || '').trim();
      if (!q) return Promise.resolve({ isEnd: true, data: [] });
      return tzPost('search', { source: 'netease', name: q, pages: page, count: 30 })
        .then(function (arr) {
          var list = Array.isArray(arr) ? arr : [];
          var data = list.map(function (it) {
            return {
              id: 'tz_' + it.id,
              title: it.name || '',
              artist: flattenArtist(it.artist),
              album: it.album || '',
              artwork: '',
              duration: 0,
              _nzId: String(it.id),
              _lyricId: String(it.lyric_id || it.id),
              _source: it.source || 'netease'
            };
          });
          return { isEnd: data.length < 30, data: data };
        })
        .catch(function (e) { return { isEnd: true, data: [] }; });
    },

    // ===== 导入歌单（网易云 / QQ音乐，均经 Tonzhon）=====
    importMusicSheet: function (urlLike) {
      var info = detectPlatform(urlLike);
      if (!info) {
        return Promise.reject(new Error('无法识别的歌单链接，请粘贴网易云(music.163.com)或QQ音乐(y.qq.com)的歌单链接'));
      }
      if (info.server === 'netease') {
        return tzPost('playlist', { id: info.id, source: 'netease' }).then(function (d) {
          var tracks = (d && d.playlist && d.playlist.tracks) || [];
          if (!tracks.length) {
            throw new Error('该网易云歌单未返回曲目，通常为私人/需登录歌单；请在网易云网页端将其设为「公开」后再导入');
          }
          return mapNeteaseTracks(tracks);
        });
      }
      if (info.server === 'tencent') {
        return tzPost('playlist', { id: info.id, source: 'tencent' }).then(function (d) {
          var cd = (d && d.data && d.data.cdlist) || [];
          var sl = cd.length ? cd[0].songlist || [] : [];
          if (!sl.length) throw new Error('该QQ歌单未解析到歌曲，可能链接有误或已失效（或需登录）');
          return mapTencentTracks(sl);
        });
      }
      return Promise.reject(new Error('暂不支持该平台的歌单导入'));
    },

    // ===== 导入单曲（网易云可靠；QQ best-effort）=====
    importMusicItem: function (urlLike) {
      var info = detectPlatform(urlLike);
      if (!info) {
        return Promise.reject(new Error('无法识别的歌曲链接，请粘贴网易云或QQ音乐的歌曲链接'));
      }
      if (info.server === 'netease') {
        return Promise.resolve({
          id: 'tz_' + info.id,
          title: '',
          artist: '',
          album: '',
          artwork: '',
          duration: 0,
          _nzId: info.id,
          _lyricId: info.id,
          _source: 'netease'
        });
      }
      if (info.server === 'tencent') {
        return Promise.resolve({
          id: 'qq_' + info.id,
          title: '',
          artist: '',
          album: '',
          artwork: '',
          duration: 0,
          _src: 'tencent',
          _qqMid: info.id,
          _name: '',
          _artist: ''
        });
      }
      return Promise.reject(new Error('暂不支持该平台的单曲导入'));
    },

    // ===== 播放直链（按来源路由至各自官方后端；失败 best-effort 匹配网易云）=====
    getMediaSource: function (musicItem) {
      // ① 网易源：weapi 直取真实可播 CDN
      if (musicItem._nzId) {
        return getNeteaseUrl(musicItem._nzId).then(function (url) {
          if (url) return { url: forceHttps(url) };
          return _fallback(musicItem);
        });
      }
      // ② 腾讯QQ 源：官方 CgiGetVkey 取链。免费账号对 VIP/付费曲返回 30s 试听，
      //    故探测文件大小，疑似试听则回退网易云完整版（完整 QQ 曲仍走 QQ，保留原格式）。
      if (musicItem._qqMid) {
        return getQQUrl(musicItem._qqMid).then(function (url) {
          if (!url) {
            return getNeteaseUrlForQuery(musicItem._name || musicItem.title, musicItem._artist || musicItem.artist)
              .then(function (nu) { return nu ? { url: forceHttps(nu) } : _fallback(musicItem); });
          }
          return looksLikePreview(url).then(function (isPrev) {
            if (!isPrev) return { url: forceHttps(url) };
            return getNeteaseUrlForQuery(musicItem._name || musicItem.title, musicItem._artist || musicItem.artist)
              .then(function (nu) { return nu ? { url: forceHttps(nu) } : { url: forceHttps(url) }; });
          });
        });
      }
      // ③ 酷狗源：官方 play/getdata 取链；失败回退网易云匹配
      if (musicItem._kgHash) {
        return getKugouUrl(musicItem._kgHash, musicItem._kgAlbum).then(function (url) {
          if (url) return { url: forceHttps(url) };
          return matchNeteaseByQuery(musicItem._name || musicItem.title, musicItem._artist || musicItem.artist)
            .then(function (nid) {
              if (nid) return getNeteaseUrl(nid).then(function (nu) { return nu ? { url: forceHttps(nu) } : _fallback(musicItem); });
              return _fallback(musicItem);
            });
        });
      }
      return _fallback(musicItem);
    },

    // ===== 歌词（Tonzhon lyric 接口，netease）=====
    getLyric: function (musicItem) {
      var lyricId = musicItem._lyricId || musicItem._nzId;
      // 非网易源：best-effort 匹配网易云 id 取歌词
      function fetchLyric(id) {
        if (!id) return Promise.resolve({ rawLrc: '', translation: '' });
        return tzPost('lyric', { id: id, source: 'netease' })
          .then(function (r) {
            var lrc = typeof r === 'string' ? r : (r && (r.lrc || r.lyric)) || '';
            return { rawLrc: lrc || '', translation: '' };
          })
          .catch(function (e) { return { rawLrc: '', translation: '' }; });
      }
      if (!lyricId && (musicItem._qqMid || musicItem._kgHash || musicItem._name)) {
        return matchNeteaseByQuery(musicItem._name || musicItem.title, musicItem._artist || musicItem.artist)
          .then(function (nid) { return fetchLyric(nid); });
      }
      return fetchLyric(lyricId);
    }
  };

  // 统一兜底：先尝试自有音源（若未来复活），否则抛错
  function _fallback(musicItem) {
    var fallbackId = musicItem._nzId || musicItem._qqMid || musicItem._kgHash;
    if (fallbackId) {
      var src = musicItem._source || (musicItem._qqMid ? 'tencent' : musicItem._kgHash ? 'kugou' : 'netease');
      return tzAudioUrl(fallbackId, src).then(function (tz) {
        if (tz) return { url: tz };
        throw new Error('该歌曲暂无可用的播放音源（QQ/酷狗/网易云后端均未返回直链；付费或区域限制曲可能无解，或匹配未命中）');
      });
    }
    return Promise.reject(new Error('该歌曲暂无可用的播放音源（QQ/酷狗/网易云后端均未返回直链；付费或区域限制曲可能无解，或匹配未命中）'));
  }

  // ===== 跨加载器导出 =====
  // (A) 新协议 CommonJS：写入 module.exports
  if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = plugin;
  }
  // (B) 部分环境导出到 exports
  if (typeof exports !== 'undefined') {
    exports.default = plugin;
  }
  // (C) 老协议 `return ${funcCode}`：本 IIFE 作为表达式被返回，下面是返回值
  return plugin;
})();
