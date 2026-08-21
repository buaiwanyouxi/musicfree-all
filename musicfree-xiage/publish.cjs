// 通用 GitHub Contents API 发布脚本（读取本地 git 凭据，不打印 token）
const fs = require('fs');
const https = require('https');
const os = require('os');

function loadToken() {
  // 从 git credential store 读取 github.com 的 token
  const credPath = process.env.USERPROFILE + '/.git-credentials';
  const raw = fs.readFileSync(credPath, 'utf8');
  const m = raw.match(/https:\/\/([^@]+)@github\.com/);
  if (!m) throw new Error('未找到 github.com 凭据');
  return m[1];
}

function api(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: 'api.github.com',
        path,
        method,
        headers: {
          'Authorization': 'Bearer ' + token,
          'User-Agent': 'musicfree-publisher',
          'Accept': 'application/vnd.github+json',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(d); } catch (e) {}
          resolve({ status: res.statusCode, json, raw: d });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function publish(owner, repo, filePath, localPath) {
  const token = loadToken();
  const content = fs.readFileSync(localPath, 'utf8');
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  // 取得当前 sha
  let sha = null;
  const getRes = await api('GET', `/repos/${owner}/${repo}/contents/${filePath}`, token);
  if (getRes.status === 200 && getRes.json && getRes.json.sha) {
    sha = getRes.json.sha;
  } else if (getRes.status !== 404) {
    console.log('GET 警告:', getRes.status, getRes.raw.slice(0, 200));
  }
  const body = { message: `update ${filePath}`, content: b64 };
  if (sha) body.sha = sha;
  const putRes = await api('PUT', `/repos/${owner}/${repo}/contents/${filePath}`, token, body);
  console.log(`PUT ${owner}/${repo}/${filePath} ->`, putRes.status);
  if (putRes.status === 200 || putRes.status === 201) {
    console.log('  commit:', putRes.json.content && putRes.json.content.sha);
    return true;
  } else {
    console.log('  失败:', putRes.raw.slice(0, 300));
    return false;
  }
}

// 用法: node publish.cjs <owner> <repo> <filePath> <localPath>
(async () => {
  const [, , owner, repo, filePath, localPath] = process.argv;
  if (!owner || !repo || !filePath || !localPath) {
    console.log('用法: node publish.cjs <owner> <repo> <filePath> <localPath>');
    process.exit(1);
  }
  const ok = await publish(owner, repo, filePath, localPath);
  process.exit(ok ? 0 : 1);
})();
