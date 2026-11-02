#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const publicBuild = require("./build-public-guide.js");
const { buildPublicGuide, collectLocalAssetReferences, copyReferencedAssets } = publicBuild;
const { classifySupabaseKey, PUBLIC_PLACEHOLDERS } = require("./public-config.js");
const { readSupabaseConfig, assertCollaborationRetention, readSelfHostsConfig, sanitizeSelfReferenceSources } = require("./render-guide.js");
const publicConfig = require("./public-config.js");

assert.strictEqual(publicBuild.classifySupabaseKey, publicConfig.classifySupabaseKey, "发布构建必须复用统一密钥分类函数");
assert.strictEqual(publicBuild.PUBLIC_PLACEHOLDERS, publicConfig.PUBLIC_PLACEHOLDERS, "发布构建必须复用统一占位符定义");

const anonPayload = Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url");
const servicePayload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
assert.equal(classifySupabaseKey("sb_publishable_test"), "publishable");
assert.equal(classifySupabaseKey(`x.${anonPayload}.x`), "publishable");
assert.equal(classifySupabaseKey("sb_secret_test"), "secret");
assert.equal(classifySupabaseKey(`x.${servicePayload}.x`), "secret");
assert.equal(classifySupabaseKey("unknown-key"), "invalid");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "travel-guide-public-deploy-"));
const writeConfig = (name, value) => { const file = path.join(temp, name); fs.writeFileSync(file, JSON.stringify(value)); return file; };
assert.equal(readSupabaseConfig(writeConfig("publishable.json", {projectUrl:"https://audit-project.supabase.co",publishableKey:"sb_publishable_test"})).enabled, true);
assert.throws(() => readSupabaseConfig(writeConfig("secret.json", {projectUrl:"https://audit-project.supabase.co",publishableKey:"sb_secret_forbidden"})), /secret\/service_role/);
assert.throws(() => readSupabaseConfig(writeConfig("extra.json", {projectUrl:"https://audit-project.supabase.co",publishableKey:"sb_publishable_test",serviceRoleKey:"forbidden"})), /仅允许/);
const collabHtml = '<body data-guide-features="day-tabs collaboration">';
assert.throws(() => assertCollaborationRetention(collabHtml, false, false), /协作能力防回退门禁/);
assert.doesNotThrow(() => assertCollaborationRetention(collabHtml, true, false));
assert.doesNotThrow(() => assertCollaborationRetention(collabHtml, false, true));

const source = `<meta name="guide-build" content="${PUBLIC_PLACEHOLDERS.buildSha}"><script src="https://maps.googleapis.com/maps/api/js?key=${PUBLIC_PLACEHOLDERS.googleKey}"></script><script>const config={projectUrl:${JSON.stringify(PUBLIC_PLACEHOLDERS.supabaseProjectUrl)},publishableKey:${JSON.stringify(PUBLIC_PLACEHOLDERS.supabasePublishableKey)}};</script>`;
const built = buildPublicGuide(source, {
  GITHUB_SHA: "a1b2c3d4e5f6",
  GOOGLE_MAPS_BROWSER_KEY: "AIzaPublicBrowserKeyForRestrictedPagesOnly1234",
  SUPABASE_PROJECT_URL: "https://audit-project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test"
});
assert(!built.includes("__GOOGLE_") && !built.includes("__SUPABASE_"));
assert(built.includes("AIzaPublicBrowserKeyForRestrictedPagesOnly1234"));
assert(built.includes("https://audit-project.supabase.co"));
assert(built.includes('name="guide-build" content="a1b2c3d4e5f6"'), "部署产物必须注入 GITHUB_SHA 构建标识");
assert.throws(() => buildPublicGuide(source, { GOOGLE_MAPS_BROWSER_KEY: "AIzaPublicBrowserKeyForRestrictedPagesOnly1234", SUPABASE_PROJECT_URL: "https://audit-project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" }), /GITHUB_SHA/);
assert.throws(() => buildPublicGuide(source, {
  GITHUB_SHA: "a1b2c3d4e5f6",
  GOOGLE_MAPS_BROWSER_KEY: "AIzaPublicBrowserKeyForRestrictedPagesOnly1234",
  SUPABASE_PROJECT_URL: "https://audit-project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_secret_forbidden"
}), /secret\/service_role/);
assert.throws(() => buildPublicGuide(source, { GITHUB_SHA: "a1b2c3d4e5f6" }), /GOOGLE_MAPS_BROWSER_KEY/);
assert.throws(() => buildPublicGuide(source.replace(PUBLIC_PLACEHOLDERS.googleKey, "AIzaAlreadyCommittedKey12345678901234567890"), {}), /真实密钥/);
assert.throws(() => buildPublicGuide(`<script src="https://api.map.baidu.com/api?ak=baiduBrowserKey12345678901234567890"></script>`, {}), /真实密钥/);
const baiduSource = `<script src="https://api.map.baidu.com/api?v=1.0&type=webgl&ak=${PUBLIC_PLACEHOLDERS.baiduAk}"></script>`;
const baiduBuilt = buildPublicGuide(baiduSource, { BAIDU_MAP_BROWSER_AK: "baiduBrowserKeyForRestrictedPagesOnly1234" });
assert(baiduBuilt.includes("baiduBrowserKeyForRestrictedPagesOnly1234"), "只使用百度地图的页面不应要求 Google 密钥");
assert.deepEqual([...collectLocalAssetReferences('<img src="photos/封面%20图.jpg"><a href="#day-1">日程</a>')], ["photos/封面 图.jpg"]);
assert.deepEqual([...collectLocalAssetReferences('<link rel="preload" as="image" href="assets/niumou-spritesheet.webp">')], ["assets/niumou-spritesheet.webp"], "公开构建必须识别牛哞预加载素材");
assert.deepEqual([...collectLocalAssetReferences('<a href="xhsdiscover://search/result?keyword=test">小红书</a>')], [], "自定义协议不得被误判为本地资源");
assert.throws(() => collectLocalAssetReferences('<img src="../private.jpg">'), /路径越界/);
assert.throws(() => collectLocalAssetReferences('<a href="second.html">第二页</a>'), /不得引用另一份本地 HTML/);
const assetSourceDir = path.join(temp, "asset-source");
const assetOutputDir = path.join(temp, "asset-output");
fs.mkdirSync(path.join(assetSourceDir, "photos"), { recursive: true });
fs.writeFileSync(path.join(assetSourceDir, "photos/cover.jpg"), "cover-bytes");
const assetHtml = '<html><img src="photos/cover.jpg"></html>';
const copied = copyReferencedAssets(assetHtml, path.join(assetSourceDir, "guide.html"), path.join(assetOutputDir, "guide.html"));
assert.deepEqual([...copied], ["photos/cover.jpg"]);
assert.equal(fs.readFileSync(path.join(assetOutputDir, "photos/cover.jpg"), "utf8"), "cover-bytes", "部署构建必须复制任意目录中的实际引用资源");
assert.throws(() => copyReferencedAssets('<img src="photos/missing.jpg">', path.join(assetSourceDir, "guide.html"), path.join(assetOutputDir, "guide.html")), /本地资源不存在/);
const outsideAsset = path.join(temp, "outside-private.jpg");
fs.writeFileSync(outsideAsset, "private");
fs.symlinkSync(outsideAsset, path.join(assetSourceDir, "photos/private-link.jpg"));
assert.throws(() => copyReferencedAssets('<img src="photos/private-link.jpg">', path.join(assetSourceDir, "guide.html"), path.join(assetOutputDir, "guide.html")), /符号链接越界/);
const workflow = fs.readFileSync(path.resolve(__dirname, "../assets/github-pages-deploy.yml"), "utf8");
[
  "actions/checkout@v7", "actions/configure-pages@v5", "actions/upload-pages-artifact@v4", "actions/deploy-pages@v5",
  "pages: write", "id-token: write", "scripts/build-public-guide.js", "GOOGLE_MAPS_BROWSER_KEY", "SUPABASE_PUBLISHABLE_KEY"
].forEach((marker) => assert(workflow.includes(marker), `Pages workflow 缺少 ${marker}`));
assert(!workflow.includes("cp index.html"), "首页也必须经过公开部署构建，不能绕过占位符和密钥门禁");
assert(workflow.includes("sources=(./*.html)"), "Pages workflow 必须处理所有根目录 HTML");
assert(!workflow.includes("./guide*.html"), "Pages workflow 不得只处理 guide 前缀页面");
assert(!workflow.includes("cp -R images"), "Pages workflow 不得只复制 images 目录，实际引用资源由构建脚本统一同步");
assert(!workflow.includes("Verify required secrets"), "Pages workflow 应按页面实际占位符要求密钥，不得全局强制两套地图密钥");
assert(fs.existsSync(path.resolve(__dirname, "build-public-guide.js")), "Pages workflow 引用的构建脚本必须随技能提供");
// 隐私门禁测试
const guideData = {
  sources: [
    { id: 1, title: "外部来源", url: "https://example.com/page" },
    { id: 2, title: "自引用来源", url: "https://zaoshangqilaishuijiao.github.io/old-guide/guide.html" },
    { id: 3, title: "另一个外部来源", url: "https://lonelyplanet.com/somewhere" }
  ],
  sourceIndex: [
    { sourceId: 1, label: "外部" },
    { sourceId: 2, label: "自引用" },
    { sourceId: 3, label: "另一个" }
  ],
  days: [
    { items: [{ sourceIds: [1, 2, 3] }] }
  ],
  optionalReference: { sourceId: 2 }
};
const originalGuideData = structuredClone(guideData);
const sanitizeResult = sanitizeSelfReferenceSources(guideData, ["zaoshangqilaishuijiao.github.io"]);
const sanitizedGuideData = sanitizeResult.data;
assert.equal(sanitizeResult.removed.length, 1, "隐私门禁应移除 1 条自引用来源");
assert.deepEqual(guideData, originalGuideData, "隐私门禁不得修改 trip-data.json 对应的原始对象");
assert.equal(sanitizedGuideData.sources.length, 2, "移除后应剩 2 条来源");
assert.equal(sanitizedGuideData.sources[0].id, 1, "重排后第一条 id 应为 1");
assert.equal(sanitizedGuideData.sources[1].id, 2, "重排后第二条 id 应为 2");
assert.deepEqual(sanitizedGuideData.days[0].items[0].sourceIds, [1, 2], "sourceIds 应重排为 [1, 2]");
assert.equal(sanitizedGuideData.sourceIndex.length, 2, "sourceIndex 应过滤为 2 条");
assert.equal(sanitizedGuideData.sourceIndex[1].sourceId, 2, "sourceIndex 第二条 sourceId 应重排为 2");
assert(!Object.hasOwn(sanitizedGuideData.optionalReference, "sourceId"), "已移除来源的单值 sourceId 不得保留旧编号");

// 测试无配置时静默跳过
const noop = sanitizeSelfReferenceSources({ sources: [{ id: 1, url: "https://example.com" }] }, []);
assert.equal(noop.removed.length, 0, "无 selfHosts 时应静默跳过");

// 测试无匹配来源时也不报错
const noMatch = sanitizeSelfReferenceSources({ sources: [{ id: 1, url: "https://example.com" }] }, ["zaoshangqilaishuijiao.github.io"]);
assert.equal(noMatch.removed.length, 0, "无匹配来源时应静默跳过");

const allRemoved = sanitizeSelfReferenceSources({ sources: [{ id: 1, url: "https://self.github.io/a" }], days: [{ sourceIds: [1] }] }, ["self.github.io"]);
assert.deepEqual(allRemoved.data.sources, [], "唯一自引用来源移除后应保持明确空集合");
assert.deepEqual(allRemoved.data.days[0].sourceIds, [], "被移除来源不得留下悬空引用");
assert.doesNotThrow(() => sanitizeSelfReferenceSources({ sources: [] }, [null, 123, ""]), "异常 selfHosts 元素不应中断渲染");

const privateRoot = path.join(temp, "private-home");
const privateConfigDir = path.join(privateRoot, "private", "travel-guide-builder-v2");
fs.mkdirSync(privateConfigDir, { recursive: true });
fs.writeFileSync(path.join(privateConfigDir, "github-self-hosts.local.json"), JSON.stringify({ selfHosts: [null, 123, " HTTPS://SELF.GITHUB.IO/path ", "valid.github.io", "not a host/path"] }));
assert.deepEqual(readSelfHostsConfig({ CODEX_HOME: privateRoot }, temp), ["self.github.io", "valid.github.io"], "私有域名配置应忽略非字符串和无效条目");

const renderer = fs.readFileSync(path.resolve(__dirname, "render-guide.js"), "utf8");
assert(/validateTripData\(renderData,\s*\{\s*stage:\s*"content"/.test(renderer), "来源清理后必须再次校验渲染副本");
assert(renderer.includes('baseline: sanitizedBaseline'), "来源清理后的增量校验必须携带同样清理的基线");
assert(renderer.includes("persistedData.meta.guideId = guideId"), "渲染器回写原始 JSON 时只应补充 guideId");

console.log("PASS public source placeholders, deployment injection, and secret-key rejection");
