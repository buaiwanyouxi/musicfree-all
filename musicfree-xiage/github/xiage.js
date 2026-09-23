// 我要下歌 v0.0.14 · 发布于 2026-09-23（MusicFree 音源插件发布版）
// ��Ҫ�¸� (xiage) MusicFree ��� �� ��ˣ�ͭ�� Tonzhon (https://tonzhon.com)
// ȫ��·ͳһ�� Tonzhon ��Դ (https://tonzhon.com/api.php)��
//   - �赥/���а�  : Tonzhon types=playlist��������/�ṷ/QQ ��Դ��
//   - ����          : Tonzhon types=search  (source=netease)
//   - ��� / ����   : Tonzhon types=lyric / types=pic
//   - ����ֱ��      : ����Դ·�������Թٷ���ˣ���ֱȡ��ʵ�ɲ� CDN��
//                     �� ������ �� weapi song/enhance/player/url���� JS AES-128-CBC�����ⲿ����������/�ƶ���ͨ�ã�
//                     �� ��ѶQQ �� musicu.fcg vkey.GetVkeyServer (CgiGetVkey)��ʵ�� 12/12 �ɲ�
//                     �� �ṷ   �� wwwapi.kugou.com play/getdata
//                     �����ʧ�ܾ� best-effort ���ˣ�������ƥ�������� id �� weapi��
// ˵����������������� outer/url ���ڴ�������ƣ��������Ƹ��� weapi��QQ/�ṷ�����ֱ���ٷ�ȡ���˵㡣
//
// ?? ��֪������ƣ�Tonzhon ʵ�⣩��
//   - ��ˮ(qishui)/������Tonzhon �޴�Դ����Ĭ���������ƣ��޷��ṩ��ʵ��ˮ���ݡ�
//   - ����(kuwo)/�ٶ�(baidu)��Tonzhon �� types=playlist ������Դ���ؿ�(0�ֽ�)���޷��ṩ�赥/�񵥡�
//   - QQ �ٷ��۷�� disstid �� Tonzhon ���ѱ����������"����˽��"���㷨�赥������ QQ �����������֤�ɷ��صľ�ѡ/ÿ�հ񵥡�
//   - �ṷ�赥�� Tonzhon �����أ��������Ϊ�˹���ע��
//
// ����ֵ�ṹ�ϸ���ѭ MusicFree ���Э�飺
//  - getTopLists       -> IMusicSheetGroupItem[] = [{ title, data: IMusicSheetItem[] }]
//  - getTopListDetail  -> { isEnd, musicList: IMusicItem[] }
//  - getMusicSheetInfo -> { isEnd, musicList: IMusicItem[] }
//  - search            -> { isEnd, data: IMusicItem[] }
//  - importMusicSheet  -> IMusicItem[]
//  - importMusicItem   -> IMusicItem
//  - getMediaSource    -> { url }���ѽ���Ϊ�ɲ�ֱ����
//  - getLyric          -> { rawLrc }
//
// ===== �������Э����ݣ��ؼ���=====
// MusicFree �������ֲ������Э�飺
//   (A) ��Э�� CommonJS��ɳ��ע�� module/exports������ `module.exports = {...}`��
//   (B) ��Э�� `return ${funcCode}`��������Դ�뵱����ʽ���ض����Ҳ�ע�� module/exports��
// �����ֻд `module.exports = {...}`������Э��������� `module` δ���� �� ReferenceError �� ��װ��������޷���������
// �ʱ���������Ϊ IIFE ����ʽ������ module.exports ����(A)���䷵��ֵ�ּ���(B)������ typeof ��ȫȡ require��
(function () {
  // ---- ��ȫ��ȡ require����������ɳ��ע������----
  var reqFn = (
    typeof __musicfree_require !== 'undefined' ? __musicfree_require :
    (typeof require !== 'undefined' ? require : null)
  );
  if (!reqFn) {
    throw new Error('[xiage] ���ɳ��δ�ṩ require���޷�����');
  }
  var axios = reqFn('axios');
  // �� qs ���� query string������ɳ��δע��� URLSearchParams������ qs ������������ֶ�ƴ��
  var qs = (function () { try { return reqFn('qs'); } catch (e) { return null; } })();

  // ===== ͭ�� Tonzhon ��Դ��ˣ��赥/����/��ʣ�=====
  var TZ = 'https://tonzhon.com/api.php';
  // ������ weapi ���Ŷ˵㣨ֱȡ�ɲ� CDN���ƿ���ʧЧ�� outer/url ������
  var NETEASE_WEAPI = 'https://music.163.com/weapi/song/enhance/player/url/v1?csrf_token=';

  var UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // ===== ƽ̨�赥/�񵥶��壨ID ���� Tonzhon ʵ��ɷ�����Ŀ��=====

  // �����ƹٷ����а��ȶ� ID��
  var NETEASE_RANKS = [
    { id: '19723756', title: '�����������' },
    { id: '3779629', title: '�������¸��' },
    { id: '3778678', title: '�������ȸ��' },
    { id: '2884035', title: '����ԭ��������' },
    { id: '2809577409', title: '������ŷ���¸��' },
    { id: '1978921795', title: '�����ֵ�����' },
    { id: '3411278', title: '�����ֿ��ְ�' },
    { id: '1747976524', title: '�����ֻ��ɰ�' },
    { id: '6723173524', title: '���������������' }
  ];

  // �ṷ�ٷ����а�ID ���������嵥���� Tonzhon ʵ�ⷵ����Ŀ��
  var KUGOU_RANKS = [
    { id: '59703', title: '�ṷ�������������ְ�' },
    { id: '52144', title: '�ṷ�������ȸ��' },
    { id: '52767', title: '�ṷ�������ȸ��' },
    { id: '24971', title: '�ṷ��DJ�ȸ��' },
    { id: '31308', title: '�ṷ���ڵذ�' }
  ];

  // QQ���ָ赥��Tonzhon �Ϲٷ��۷�� disstid �ѱ������������֤�ɷ��صľ�ѡ/ÿ�հ񵥣�
  var QQ_RANKS = [
    { id: '7013848675', title: 'QQ���֡���ACG��������ʹ�µ�ҲҪ����' },
    { id: '7021611886', title: 'QQ���֡�Ӱħ�׵Ľ���˽��' }
  ];

  // ���Ÿ赥�������ƣ�����֤�ɷ�����Ŀ�ľ�ѡ�赥��
  var NETEASE_HOT = [
    { id: '3136952023', title: '�����ơ�˽���״�' },
    { id: '528437612', title: '�����ơ�Բ�����' },
    { id: '3778679', title: '�����ơ�CNBLUE ����50����' }
  ];

  // ���Ÿ赥���ṷ��ID �� Tonzhon ʵ�ⷵ����Ŀ���赥�� Tonzhon �����أ��˹���ע��
  var KUGOU_HOT = [
    { id: '709458', title: '�ṷ���ž�ѡ��' },
    { id: '125032', title: '�ṷ���ž�ѡ��' },
    { id: '123', title: '�ṷ���Ŵ�赥(500��)' }
  ];

  // ���Ÿ赥��QQ���֣�����֤�ɷ�����Ŀ��
  var QQ_HOT = [
    { id: '7021611884', title: 'QQ���֡����������ഺ�Ľ���˽��' },
    { id: '7021611885', title: 'QQ���֡���' }
  ];

  // ===== Tonzhon api.php ͳһ POST ��װ =====
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

  // �����ֶα�ƽ����Tonzhon �������� [["�ܽ���,���"]]�������Ʒ��� [{name}]
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

  // ===== ������ weapi ���Ŷ˵㣨�� JS AES-128-CBC ʵ�֣����κ��ⲿ����������/�ƶ���ɳ��ͨ�ã�=====
  // ����Ϊ AES-128-CBC�����Σ�+ RSA��Ϊ���ɳ�����ֲ�ԣ��������� crypto-js/big-integer������/�ƶ���ͨ�ã���
  // �˴����ô� JS ʵ�֣�AES ��ʵ�֣�RSA ���á��̶� secKey + Ԥ���� encSecKey �������������ʱ�������㡣
  var WEAPI_NONCE = '0CoJUm6Qyw8W8jud';
  var WEAPI_IV = '0102030405060708';
  var WEAPI_SEC_KEY = '0CoJUm6Qyw8W8jud'; // �̶���� AES ��Կ���������ͻ���ͨ��������
  var WEAPI_ENC_SEC_KEY =
    'bf50d0bcf56833b06d8d1219496a452a1d860fd58a14c0aafba3e770104ca77dc6856cb310ed3309039e6865081be4ddc2df52663373b20b70ac25b4d0c6ca466daef6b50174e93536e2d580c49e70649ad1936584899e85722eb83ceddfb4f56c1172fca5e60592d0e6ee3e8e02be1fe6e53f285b0389162d8e6ddc553857cd'; // RSA(reversed(SEC_KEY)) Ԥ���㳣��

  // --- �� JS AES-128-CBC��PKCS7��---
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

  // ֱ�������� weapi ȡ����ֱ�������� http(s) CDN���¼�/��������� null��
  function getNeteaseUrl(id) {
    try {
      var payload = JSON.stringify({ ids: '[' + id + ']', level: 'standard', encodeType: 'mp3', csrf_token: '' });
      var enc = weapiEncrypt(payload);
      // ���� params/encSecKey ������ɳ��δע�� URLSearchParams������ qs ���ֶ�ƴ�ӣ�
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

  // ���Դ� Tonzhon types=url ȡ������Դֱ������ǰ��ȫ����Դ���ؿգ��ʶ���Ϊ null��
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

  // �ø��� best-effort ƥ�������� id�����ڷ�����Դ�����Ĳ���/��ʻ��ˣ�
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

  // ===== ��ѶQQ ��Ƶ��ˣ�musicu.fcg vkey.GetVkeyServer (CgiGetVkey) =====
  // ��ʵ�⣺QQ �ٷ�ȡ���ӿڣ������¼���ɷ�����ʵ�ɲ�ֱ����aqqmusic.tc.qq.com/...?vkey=...����
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

  // ===== �ṷ��Ƶ��ˣ�wwwapi.kugou.com play/getdata =====
  // ˵����������ɷ��� play_url������/����������Ϊ�գ���ʱ����������ƥ�䡣
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

  // ===== ��Դ����ӳ�� =====

  // �����ƣ�d.playlist.tracks
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

  // �ṷ��d.data.info[]��filename Ϊ "���� - ����"
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

  // QQ���֣�d.data.cdlist[0].songlist[]
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

  // ===== ����ʶ�𣨵��룩=====
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

  // �������飨����/ID ��Ԥ�ã����� getTopLists �׶δ������������³�ʱ��
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

    // ===== ����������� =====

    // �赥/������ץȡ������Ϊ IIFE ���ɺ������� getNeteaseUrl �Ȳ��У���
    // �ؼ��޸�����ǰд�� plugin ��������������Ϊ���ԣ��� getTopListDetail/getMusicSheetInfo
    // ���� _fetchSongs(...) ���ã����������޴����ɱ��� �� ReferenceError �� ���а�/�赥����Ϊ�ա�
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

    // ����Ƭ��̽�⣺QQ ����˺ŶԲ����������� VIP ���������������� CgiGetVkey ���� 30s ����Ƭ�Σ�
    // ��ƾ CgiGetVkey �� buy ��־�޷����֣�Ԥ��������������־��ȫ��ͬ����ʵ�⣩�������ԡ�ʵ���ļ���С���ж���
    // �� Range GET��bytes=0-0��ȡ��Ӧͷ content-range �� TOTAL �ֽ�����aqqmusic �� CDN �� HEAD ���� content-length��
    // ���� Range GET �ȶ��� content-range: bytes 0-0/TOTAL��30s@128kbps��500KB��������ͨ����2MB����ֵȡ 1.2MB��
    // �޷��жϣ�����ʧ��/��֧�� Range��ʱ���� false�����������������������������š�
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
          try { r.data.resume(); } catch (e) { /* ������Ӧ�壬����ͷ */ }
          var cr = r.headers && r.headers['content-range'];
          if (cr) {
            var m = /bytes\s+\d+-\d+\/(\d+)/i.exec(cr);
            if (m) {
              var total = parseInt(m[1], 10);
              return total > 0 && total < 1.2 * 1024 * 1024;
            }
          }
          // ���ף����� CDN ��֧�� Range ʱ���� content-length
          var cl = r.headers && r.headers['content-length'] ? parseInt(r.headers['content-length'], 10) : 0;
          return cl > 0 && cl < 1.2 * 1024 * 1024;
        })
        .catch(function () { return false; });
    }

    // ������+����ƥ�������Ʋ����ء��׸�������ֱ����QQ/�ṷ ������ȡ��ʧ��ʱ�Ļ��ˣ�������ֱ��������������
    // �ؼ��㣺���������������λ��Ϊ�ٷ��浫�����ѱ�ң�weapi ���� url:null��������ƥ�䵽�������㷵��ֱ��Ҳ������
    // ����Ƭ�Σ�ʵ����¹�����ɰ�� ���Ѱ�������ֱ���� 0.94MB �� ���������ʱ���ǰ���ɽ������ Tonzhon ��ض�˳��
    // ���ȡ�����ų�����Ƭ�Σ�<1.2MB���������׸���������ֱ��������ѡȫ������/��ң����˻����һ���ǿ�ֱ���������ܲ�����
    // ʵ�⣺���� Live ��λ���ٺư��ҡ��� 2 ������������� 1.5MB ���У����¹���λ�������������������档
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
              if (found) return found; // ���ҵ�����ֱ������·����ȡ��
              return getNeteaseUrl(id).then(function (u) {
                if (!u) return null;
                lastAny = u; // ��¼���һ���ǿ�ֱ������ȫ����ʱ����
                return looksLikePreview(u).then(function (isPrev) {
                  return isPrev ? null : u; // ���������У�����/��ҡ�������һ����ѡ
                });
              });
            });
          }, Promise.resolve(null));
          return chain.then(function (found) { return found || lastAny; });
        })
        .catch(function (e) { return null; });
    }

    var plugin = {
      platform: '��Ҫ�¸�',
      version: '0.0.14',
    author: 'tianpeng',
    // ��װ/���µ�ַ��jsDelivr ֱ����gitee.com/raw �� 302���� axios ���浫ֱ�����ȣ�
    srcUrl: 'https://cdn.jsdelivr.net/gh/buaiwanyouxi/musicfree-all@main/musicfree-xiage/xiage.js',
    description:
      '��Ҫ�¸�(xiage) ���ֲ�� �� ͭ��Tonzhon��Դ��������/�ṷ/QQ ���а������Ÿ赥������/����� tonzhon.com�����Ű���Դ·�����ٷ���ˡ��������� weapi / ��ѶQQ CgiGetVkey / �ṷ play/getdata��ʧ�ܻ���������ƥ��',
    cacheControl: 'no-store',
    supportedSearchType: ['music'],

    // ===== ���а� / ���Ÿ赥��ȫ������ Tonzhon playlist �ӿڣ���ƽ̨���飩=====
    getTopLists: function () {
      var groups = [];
      groups.push(buildGroup('���������а�', NETEASE_RANKS, 'netease', '���а�'));
      groups.push(buildGroup('�ṷ���а�', KUGOU_RANKS, 'kugou', '���а�'));
      groups.push(buildGroup('QQ���ָ赥', QQ_RANKS, 'tencent', '���а�'));
      groups.push(buildGroup('���Ÿ赥��������', NETEASE_HOT, 'netease', '���Ÿ赥'));
      groups.push(buildGroup('���Ÿ赥���ṷ', KUGOU_HOT, 'kugou', '���Ÿ赥'));
      groups.push(buildGroup('���Ÿ赥��QQ����', QQ_HOT, 'tencent', '���Ÿ赥'));
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

    // ===== ������Tonzhon��netease Դ��=====
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

    // ===== ����赥�������� / QQ���֣����� Tonzhon��=====
    importMusicSheet: function (urlLike) {
      var info = detectPlatform(urlLike);
      if (!info) {
        return Promise.reject(new Error('�޷�ʶ��ĸ赥���ӣ���ճ��������(music.163.com)��QQ����(y.qq.com)�ĸ赥����'));
      }
      if (info.server === 'netease') {
        return tzPost('playlist', { id: info.id, source: 'netease' }).then(function (d) {
          var tracks = (d && d.playlist && d.playlist.tracks) || [];
          if (!tracks.length) {
            throw new Error('�������Ƹ赥δ������Ŀ��ͨ��Ϊ˽��/���¼�赥��������������ҳ�˽�����Ϊ�����������ٵ���');
          }
          return mapNeteaseTracks(tracks);
        });
      }
      if (info.server === 'tencent') {
        return tzPost('playlist', { id: info.id, source: 'tencent' }).then(function (d) {
          var cd = (d && d.data && d.data.cdlist) || [];
          var sl = cd.length ? cd[0].songlist || [] : [];
          if (!sl.length) throw new Error('��QQ�赥δ���������������������������ʧЧ�������¼��');
          return mapTencentTracks(sl);
        });
      }
      return Promise.reject(new Error('�ݲ�֧�ָ�ƽ̨�ĸ赥����'));
    },

    // ===== ���뵥���������ƿɿ���QQ best-effort��=====
    importMusicItem: function (urlLike) {
      var info = detectPlatform(urlLike);
      if (!info) {
        return Promise.reject(new Error('�޷�ʶ��ĸ������ӣ���ճ�������ƻ�QQ���ֵĸ�������'));
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
      return Promise.reject(new Error('�ݲ�֧�ָ�ƽ̨�ĵ�������'));
    },

    // ===== ����ֱ��������Դ·�������Թٷ���ˣ�ʧ�� best-effort ƥ�������ƣ�=====
    getMediaSource: function (musicItem) {
      // �� ����Դ��weapi ֱȡ��ʵ�ɲ� CDN
      if (musicItem._nzId) {
        return getNeteaseUrl(musicItem._nzId).then(function (url) {
          if (url) return { url: forceHttps(url) };
          return _fallback(musicItem);
        });
      }
      // �� ��ѶQQ Դ���ٷ� CgiGetVkey ȡ��������˺Ŷ� VIP/���������� 30s ������
      //    ��̽���ļ���С��������������������������棨���� QQ ������ QQ������ԭ��ʽ����
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
      // �� �ṷԴ���ٷ� play/getdata ȡ����ʧ�ܻ���������ƥ��
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

    // ===== ��ʣ�Tonzhon lyric �ӿڣ�netease��=====
    getLyric: function (musicItem) {
      var lyricId = musicItem._lyricId || musicItem._nzId;
      // ������Դ��best-effort ƥ�������� id ȡ���
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

  // ͳһ���ף��ȳ���������Դ����δ������������״�
  function _fallback(musicItem) {
    var fallbackId = musicItem._nzId || musicItem._qqMid || musicItem._kgHash;
    if (fallbackId) {
      var src = musicItem._source || (musicItem._qqMid ? 'tencent' : musicItem._kgHash ? 'kugou' : 'netease');
      return tzAudioUrl(fallbackId, src).then(function (tz) {
        if (tz) return { url: tz };
        throw new Error('�ø������޿��õĲ�����Դ��QQ/�ṷ/�����ƺ�˾�δ����ֱ�������ѻ����������������޽⣬��ƥ��δ���У�');
      });
    }
    return Promise.reject(new Error('�ø������޿��õĲ�����Դ��QQ/�ṷ/�����ƺ�˾�δ����ֱ�������ѻ����������������޽⣬��ƥ��δ���У�'));
  }

  // ===== ����������� =====
  // (A) ��Э�� CommonJS��д�� module.exports
  if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = plugin;
  }
  // (B) ���ֻ��������� exports
  if (typeof exports !== 'undefined') {
    exports.default = plugin;
  }
  // (C) ��Э�� `return ${funcCode}`���� IIFE ��Ϊ����ʽ�����أ������Ƿ���ֵ
  return plugin;
})();