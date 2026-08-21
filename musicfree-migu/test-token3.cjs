const https = require("https");
const TOKEN = process.argv[2];
function call(path, scheme) {
  return new Promise((res) => {
    const req = https.request({
      hostname: "api.github.com", path, method: "GET",
      headers: { Authorization: (scheme || "Bearer") + " " + TOKEN, Accept: "application/vnd.github+json", "User-Agent": "t", "X-GitHub-Api-Version": "2022-11-28" }
    }, r => {
      let d = ""; r.on("data", c => d += c);
      r.on("end", () => { try { res({ status: r.statusCode, json: JSON.parse(d) }); } catch { res({ status: r.statusCode, json: d.slice(0,200) }); } });
    });
    req.on("error", e => res({ status: 0, json: e.message }));
    req.end();
  });
}
(async () => {
  const me = await call("/user");
  console.log("=== /user ===", me.status, me.json.login || me.json.message || "");
  for (const repo of ["buaiwanyouxi/musicfree-xiage", "buaiwanyouxi/musicfree-migu"]) {
    const r = await call("/repos/" + repo);
    console.log("=== " + repo + " ===", r.status, r.json.full_name || r.json.message || "");
    if (r.status === 200) console.log("   permissions:", JSON.stringify(r.json.permissions));
  }
})();
