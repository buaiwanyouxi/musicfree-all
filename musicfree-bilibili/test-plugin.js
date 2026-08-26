/*
 * 本地验证脚本（非插件运行环境）
 * 用法：
 *   npm install axios
 *   BILI_COOKIE="SESSDATA=xxx" node test-plugin.js
 * 脚本从环境变量 BILI_COOKIE 读取 Cookie，逐项验证插件方法。
 * 不会把 Cookie 写入任何文件；不通过本脚本时，请在 MusicFree 内直接测试。
 *
 * 无 Cookie 时仅做「结构 + 公开榜单」校验（各分区排行榜可匿名访问）；
 * 填写 Cookie 后额外验证「我的收藏夹 / 入站必刷 / 每周必刷」等需登录板块。
 */

// 在 require 插件前模拟 MusicFree 沙箱全局
global.env = {
  getUserVariables: function () {
    return { SESSDATA: process.env.BILI_COOKIE || '' };
  },
  os: 'win32',
  appVersion: '1.0.0',
  lang: 'zh-CN',
};

const NODE_PATH = 'C:/Users/18067/.workbuddy/binaries/node/workspace/node_modules';
require('module').globalPaths.push(NODE_PATH);

const plugin = require('./bilibili.plugin.js');

function logSection(name) {
  console.log('\n========== ' + name + ' ==========');
}
function findGroup(lists, title) {
  return lists.find(function (g) { return g.title === title; });
}

async function test() {
  console.log('插件导出字段：', Object.keys(plugin).join(', '));

  // 1. 四大板块结构
  logSection('getTopLists（四大板块）');
  const lists = await plugin.getTopLists();
  console.log('板块数量：', lists.length);
  lists.forEach(function (g) {
    console.log('  ·', g.title, '=>', (g.data || []).length, '项');
  });
  const expectTitles = ['入站必刷', '每周必刷', '各分区排行榜', '我的收藏夹'];
  const gotTitles = lists.map(function (g) { return g.title; });
  const missing = expectTitles.filter(function (t) { return gotTitles.indexOf(t) < 0; });
  if (missing.length) throw new Error('缺少板块：' + missing.join(', '));
  console.log('板块完整性：✓');

  // 2. 各分区排行榜详情（公开，匿名可访问）
  logSection('getTopListDetail（各分区排行榜）');
  const ranking = findGroup(lists, '各分区排行榜');
  let firstMusic = null;
  if (ranking && ranking.data.length) {
    const item = ranking.data[0];
    const d = await plugin.getTopListDetail(item, 1);
    const list = d.musicList || [];
    console.log('榜单「' + item.title + '」数量：', list.length, '| isEnd =', d.isEnd);
    if (list.length) {
      firstMusic = list[0];
      console.log('首条：', JSON.stringify(list[0]).slice(0, 160));
    }
  } else {
    console.log('[跳过] 无分区数据');
  }

  // 3. 每周必刷：有 Cookie 才测详情；无 Cookie 验证降级提示
  logSection('getTopListDetail（每周必刷）');
  const weekly = findGroup(lists, '每周必刷');
  if (weekly && weekly.data.length) {
    const item = weekly.data[0];
    try {
      const d = await plugin.getTopListDetail(item, 1);
      console.log('每周必刷「' + item.title + '」数量：', (d.musicList || []).length);
    } catch (e) {
      console.log('（预期内降级）', e.message.slice(0, 60) + '...');
    }
  }

  // 4. 我的收藏夹（需登录）
  logSection('我的收藏夹（需登录）');
  const fav = findGroup(lists, '我的收藏夹');
  if (!process.env.BILI_COOKIE) {
    console.log('[跳过] 未设置 BILI_COOKIE；当前收藏夹应为空（已优雅降级）。');
  } else if (fav && fav.data.length) {
    const sheet = fav.data[0];
    const info = await plugin.getMusicSheetInfo(sheet, 1);
    console.log('收藏夹「' + sheet.title + '」视频数：', (info.musicList || []).length);
    firstMusic = firstMusic || (info.musicList && info.musicList[0]);
  } else {
    console.log('收藏夹为空或获取失败（请确认 SESSDATA 有效）。');
  }

  // 5. 播放地址
  if (firstMusic) {
    logSection('getMediaSource（音频地址）');
    try {
      const src = await plugin.getMediaSource(firstMusic, 'high');
      console.log('音频 URL 获取：', src && src.url ? '✓ 成功' : '✗ 失败');
      if (src && src.url) console.log('URL 前缀：', src.url.slice(0, 60) + '...');
    } catch (e) {
      console.error('getMediaSource 失败：', e.message);
    }
  }

  // 6. 搜索（WBI 签名）
  logSection('search（视频搜索，WBI 签名）');
  try {
    const res = await plugin.search('测试', 1, 'music');
    console.log('搜索结果：', (res.data || []).length, '条 | isEnd =', res.isEnd);
    if (res.data && res.data.length) console.log('首条：', JSON.stringify(res.data[0]).slice(0, 160));
  } catch (e) {
    console.error('search 失败：', e.message);
  }

  // 7. 视频多P导入（Bug 2 修复验证）
  logSection('importMusicSheet（视频多P导入）');
  try {
    const list = await plugin.importMusicSheet('https://www.bilibili.com/video/BV1oLBXBiEW5');
    console.log('导入视频分P数：', list.length);
    if (list.length) {
      console.log('首条：', JSON.stringify(list[0]).slice(0, 200));
      console.log('末条：', JSON.stringify(list[list.length - 1]).slice(0, 200));
      const src = await plugin.getMediaSource(list[0], 'high');
      console.log('多P首条音频 URL：', src && src.url ? '✓ 成功' : '✗ 失败');
    }
  } catch (e) {
    console.error('视频导入失败：', e.message);
  }
}

test().then(function () {
  console.log('\n========== 测试结束 ==========');
}).catch(function (e) {
  console.error('\n测试中断：', e.message);
  process.exit(1);
});
