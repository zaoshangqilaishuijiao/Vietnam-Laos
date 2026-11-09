#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { MODULE_KEYS, extractSections, applyPatch } = require("./extract-trip-sections.js");
const { REQUIRED_CHECKS, sha256 } = require("./record-browser-qa.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "travel-guide-context-"));

/* ---------- extract-trip-sections ---------- */
const data = {
  meta: { title: "t" },
  features: {},
  days: [
    { dayNumber: 1, date: "2026-01-01", city: "A", theme: "a", kind: "city", intensity: { score: 2 }, accommodation: {}, items: [{ id: "d1-x", title: "x" }], sourceIds: [1] },
    { dayNumber: 2, date: "2026-01-02", city: "B", theme: "b", kind: "city", intensity: { score: 3 }, accommodation: {}, items: [{ id: "d2-y", title: "y" }, { id: "d2-z", title: "z" }], sourceIds: [1] }
  ],
  transport: [{ from: "A", to: "B" }],
  budget: { baseCurrency: "CNY", items: [], total: { min: 0, max: 0, currency: "CNY" } },
  sources: [],
  unknownModule: 1
};

const file = path.join(temp, "trip-data.json");
fs.writeFileSync(file, JSON.stringify(data, null, 2));

const daySections = extractSections(data, { days: ["2"] });
assert.deepEqual(daySections._dayNumbers, [2]);
assert.equal(daySections.days.length, 1);
assert.equal(daySections.days[0].theme, "b");

const itemSections = extractSections(data, { days: ["2"], items: ["d2-y"] });
assert.equal(itemSections.days[0].items.length, 1);
assert.equal(itemSections.days[0].items[0].id, "d2-y");

const rangeSections = extractSections(data, { days: ["1-2"] });
assert.equal(rangeSections.days.length, 2);

const moduleSections = extractSections(data, { modules: ["transport", "budget"] });
assert.equal(moduleSections.transport.length, 1);
assert.ok(moduleSections.budget);
assert.equal(moduleSections.days, undefined);

assert.throws(() => extractSections(data, { modules: ["nonexistent"] }), /未知模块/);

const modulePatch = { transport: [{ from: "A2", to: "B" }] };
const moduleApplied = applyPatch(data, modulePatch, { modules: ["transport"] });
assert.equal(moduleApplied.next.transport[0].from, "A2");
assert.deepEqual(moduleApplied.touched, ["transport"]);

const dayPatch = { days: [{ ...data.days[1], theme: "b2" }] };
const dayApplied = applyPatch(data, dayPatch, { days: ["2"] });
assert.equal(dayApplied.next.days[1].theme, "b2");

/* 2.38.2 复审：写回范围强制与原子替换 */
const guarded = { meta: { title: "t" }, features: {}, days: [
  { dayNumber: 1, date: "2026-01-01", city: "A", theme: "a", kind: "city", intensity: { score: 2 }, accommodation: {}, items: [{ id: "d1-a", title: "a" }, { id: "d1-b", title: "b" }], sourceIds: [1] },
  { dayNumber: 2, date: "2026-01-02", city: "B", theme: "b", kind: "city", intensity: { score: 3 }, accommodation: {}, items: [{ id: "d2-c", title: "c" }], sourceIds: [1] }
], transport: [{ from: "A", to: "B" }], budget: { baseCurrency: "CNY", items: [], total: { min: 0, max: 0, currency: "CNY" } } };
const guardedFile = path.join(temp, "guarded-trip-data.json");
fs.writeFileSync(guardedFile, JSON.stringify(guarded, null, 2));

assert.throws(() => applyPatch(guarded, { days: [{ ...guarded.days[1], theme: "x" }] }, { days: ["1"] }), /超出 --days 声明范围/, "越权 day 必须拦截");
assert.throws(() => applyPatch(guarded, { days: [{ ...guarded.days[0], theme: "x" }] }, {}), /未声明 --days/, "未声明范围必须拦截");
assert.throws(() => applyPatch(guarded, { transport: [{ from: "Z" }] }, { modules: ["budget"] }), /超出 --module 声明范围/, "越权 module 必须拦截");
assert.throws(() => applyPatch(guarded, { transport: [{ from: "Z" }] }, {}), /--module/, "未声明 --module 必须拦截");
assert.throws(() => applyPatch(guarded, { days: [{ ...guarded.days[0] }] }, { modules: ["days"] }), /module=days/, "module=days 必须拦截");
assert.throws(() => applyPatch(guarded, { days: [{ ...guarded.days[0], extra: 1 }] }, { days: ["1"] }), /顶层字段集合不一致|未声明 --days/, "增删顶层字段必须拦截");
assert.throws(() => applyPatch(guarded, { days: [{ dayNumber: guarded.days[0].dayNumber, items: guarded.days[0].items, date: guarded.days[0].date, city: guarded.days[0].city, theme: guarded.days[0].theme, kind: guarded.days[0].kind, intensity: guarded.days[0].intensity, accommodation: guarded.days[0].accommodation, sourceIds: guarded.days[0].sourceIds }] }, {}), /未声明 --days/, "无任何声明必须拦截");
assert.throws(() => applyPatch(guarded, { days: [{ dayNumber: 1, items: [{ id: "d1-a", title: "a" }, { id: "d2-c", title: "c" }] }] }, { days: ["1"], items: ["d1-a"] }), /未提取的条目/, "item 写入未提取条目必须拦截");
assert.throws(() => applyPatch(guarded, { days: [{ dayNumber: 1, items: [{ id: "d1-a", title: "a" }] }] }, { days: ["1"], items: ["d1-a", "d1-b"] }), /不得删除同天其他行程/, "提取多个只写回一个必须拦截");

const itemMerged = applyPatch(guarded, { days: [{ dayNumber: 1, items: [{ id: "d1-a", title: "a2" }] }] }, { days: ["1"], items: ["d1-a"] });
assert.equal(itemMerged.next.days[0].items.length, 2, "单条目合并不得删除相邻条目");
assert.equal(itemMerged.next.days[0].items[0].title, "a2");
assert.equal(itemMerged.next.days[0].items[1].title, "b", "相邻条目内容不变");
assert.equal(itemMerged.next.days[0].theme, "a", "day 其余字段不变");

/* CLI 端到端：写回失败时原文件保持不变（原子替换验证） */
const guardPatchFile = path.join(temp, "guard-patch.json");
fs.writeFileSync(guardPatchFile, JSON.stringify({ days: [{ dayNumber: 2, items: guarded.days[1].items, theme: "x", date: guarded.days[1].date, city: guarded.days[1].city, kind: guarded.days[1].kind, intensity: guarded.days[1].intensity, accommodation: guarded.days[1].accommodation, sourceIds: guarded.days[1].sourceIds }] }));
const guardCli = spawnSync(process.execPath, [path.join(__dirname, "extract-trip-sections.js"), guardedFile, "--days=1", `--patch-file=${guardPatchFile}`, "--apply"], { encoding: "utf8" });
assert.notEqual(guardCli.status, 0, "越权 patch 的 CLI 写回应失败");
assert.equal(JSON.parse(fs.readFileSync(guardedFile, "utf8")).transport[0].from, "A", "失败的写回不得改动原文件");

/* --apply 在原子替换前必须执行完整 content 校验，非法内容不可落盘。guarded fixture 有意不是完整攻略，因此即使结构合法也必须拒绝。 */
const invalidContentPatch = path.join(temp, "invalid-content-patch.json");
fs.writeFileSync(invalidContentPatch, JSON.stringify({ transport: [{ from: "A3", to: "B" }] }));
const invalidContentCli = spawnSync(process.execPath, [path.join(__dirname, "extract-trip-sections.js"), guardedFile, `--module=transport`, `--patch-file=${invalidContentPatch}`, "--apply"], { encoding: "utf8" });
assert.notEqual(invalidContentCli.status, 0, "完整内容校验失败时不得写回");
assert.equal(JSON.parse(fs.readFileSync(guardedFile, "utf8")).transport[0].from, "A", "内容校验失败必须保持原文件");
assert.equal(fs.readdirSync(temp).filter((name) => name.endsWith(".tmp")).length, 0, "校验失败不得遗留临时文件");

const badDayPatch = { days: [{ ...data.days[1], extraField: 1 }] };
assert.throws(() => applyPatch(data, badDayPatch, { days: ["2"] }), /顶层字段集合不一致/);

const badModulePatch = { nonexistent: 1 };
assert.throws(() => applyPatch(data, badModulePatch, {}), /不可写回模块/);

/* CLI 端到端：完整有效攻略写回必须先通过 content 校验，且不影响未触碰模块。 */
const validGuideFile = path.join(temp, "valid-trip-data.json");
const fixtureResult = spawnSync(process.execPath, [path.join(__dirname, "test-data-pipeline.js"), `--write-content-fixture=${validGuideFile}`], { encoding: "utf8" });
assert.equal(fixtureResult.status, 0, fixtureResult.stderr || "无法生成内置完整内容夹具");
const validGuide = JSON.parse(fs.readFileSync(validGuideFile, "utf8"));
const patchFile = path.join(temp, "patch.json");
const transportPatch = structuredClone(validGuide.transport);
transportPatch[0].duration = `${transportPatch[0].duration}（测试）`;
fs.writeFileSync(patchFile, JSON.stringify({ transport: transportPatch }));
const result = spawnSync(process.execPath, [path.join(__dirname, "extract-trip-sections.js"), validGuideFile, `--module=transport`, `--patch-file=${patchFile}`, "--apply"], { encoding: "utf8" });
assert.equal(result.status, 0, result.stderr);
const written = JSON.parse(fs.readFileSync(validGuideFile, "utf8"));
assert.equal(written.transport[0].duration, transportPatch[0].duration);
assert.equal(written.days.length, validGuide.days.length, "未触碰模块不得改变");
assert.equal(written.days[0].theme, validGuide.days[0].theme, "未触碰字段不得改变");
for(const module of ['dayRoadRoutes','explorationSegments']) {
  fs.writeFileSync(patchFile,JSON.stringify({[module]:[]}));
  const updated=spawnSync(process.execPath,[path.join(__dirname,'extract-trip-sections.js'),validGuideFile,`--module=${module}`,`--patch-file=${patchFile}`,'--apply'],{encoding:'utf8'});
  assert.equal(updated.status,0,updated.stderr);
  const extracted=spawnSync(process.execPath,[path.join(__dirname,'extract-trip-sections.js'),validGuideFile,`--module=${module}`],{encoding:'utf8'});
  assert.equal(extracted.status,0,extracted.stderr);assert.deepEqual(JSON.parse(extracted.stdout)[module],[]);
  fs.writeFileSync(patchFile,JSON.stringify({[module]:[{dayNumber:999}]}));
  const before=fs.readFileSync(validGuideFile,'utf8');
  const rejected=spawnSync(process.execPath,[path.join(__dirname,'extract-trip-sections.js'),validGuideFile,`--module=${module}`,`--patch-file=${patchFile}`,'--apply'],{encoding:'utf8'});
  assert.notEqual(rejected.status,0,'road/exploration edits still require full content validation');
  assert.equal(fs.readFileSync(validGuideFile,'utf8'),before,'invalid map data cannot overwrite the current guide');
}

/* ---------- publish-checklist：白名单推导、敏感扫描、新鲜度 ---------- */
const { FORBIDDEN_PUBLISH_PATTERNS, parseArgs, deriveWhitelist, discoverDeploymentExtras, collectOutgoingCommits, findForbiddenOutgoingFiles, scanSecrets } = require("./publish-checklist.js");
const hits = (name) => FORBIDDEN_PUBLISH_PATTERNS.some(({ test }) => test.test(name));
assert.ok(hits("trip-data.json"));
assert.ok(hits("trip-data.before-hotels.json"));
assert.ok(hits("guide.validation.json"));
assert.ok(hits("guide.before-hcm.html"));
assert.ok(hits("guide.baseline.json"));
assert.ok(hits("research/note.md"));
assert.ok(hits(".DS_Store"));
assert.ok(hits("supabase.local.json"));
assert.ok(!hits("guide.html"));
assert.ok(!hits("images/cover.jpg"));
assert.ok(!hits("build-public-guide.js"));
const cliOptions = parseArgs(["/tmp/x", "--repo=/tmp/r", "--remote=upstream", "--branch=gh-pages"]);
assert.equal(cliOptions.remote, "upstream");
assert.equal(cliOptions.branch, "gh-pages");
assert.equal(cliOptions.execute, false, "默认只读模式");
assert.equal(parseArgs(["/tmp/x", "--execute"]).execute, true);

/* 白名单推导：只跟随真实相对引用 */
const publishDir = path.join(temp, "publish");
fs.mkdirSync(path.join(publishDir, "images"), { recursive: true });
fs.writeFileSync(path.join(publishDir, "guide.html"), '<html><body><img src="images/cover.jpg"><a href="https://external.example/x">外链</a><a href="#anchor">锚点</a></body></html>');
fs.writeFileSync(path.join(publishDir, "images/cover.jpg"), "fake");
fs.writeFileSync(path.join(publishDir, "trip-data.json"), "{}");
const whitelist = deriveWhitelist(publishDir, "guide.html");
assert.ok(whitelist.has("guide.html"));
assert.ok(whitelist.has("images/cover.jpg"), "真实相对引用必须进入白名单");
assert.ok(!whitelist.has("trip-data.json"), "未引用文件不进白名单");
fs.writeFileSync(path.join(publishDir, "guide.html"), '<html><body><img src="missing.png"></body></html>');
assert.throws(() => deriveWhitelist(publishDir, "guide.html"), /本地资源不存在/, "不存在的引用必须拦截，不能静默丢失资源");

/* 部署附加文件必须是实际构建脚本和有效 Pages workflow，且源 HTML 必须带构建占位符。 */
const deployRepo = path.join(temp, "deploy-repo");
fs.mkdirSync(path.join(deployRepo, "scripts"), { recursive: true });
fs.mkdirSync(path.join(deployRepo, ".github/workflows"), { recursive: true });
for (const file of require("./public-config.js").DEPLOYMENT_FILES) fs.copyFileSync(path.join(__dirname,"..",file),path.join(deployRepo,file));
fs.copyFileSync(path.join(__dirname,"../assets/github-pages-deploy.yml"),path.join(deployRepo,".github/workflows/travel.yml"));
assert.deepEqual(discoverDeploymentExtras(deployRepo, '<meta name="guide-build" content="__GUIDE_BUILD_SHA__">'), ["scripts/build-public-guide.js", "scripts/public-config.js", ".github/workflows/travel.yml"]);
assert.throws(() => discoverDeploymentExtras(deployRepo, "<html></html>"), /--public-source/, "本地版 HTML 不得进入公开发布链路");

/* 待推送历史必须扫描全部提交，而非只看暂存区。 */
const calls = [];
const mockGit = (...args) => {
  calls.push(args.join(" "));
  if (args[0] === "rev-parse") return { status: 0, stdout: "remote-head\n", stderr: "" };
  if (args[0] === "rev-list") return { status: 0, stdout: "abc123\ndef456\n", stderr: "" };
  if (args[0] === "diff-tree" && args.at(-1) === "abc123") return { status: 0, stdout: "guide.html\n", stderr: "" };
  if (args[0] === "diff-tree") return { status: 0, stdout: "trip-data.json\n", stderr: "" };
  return { status: 1, stdout: "", stderr: "unexpected" };
};
const outgoing = collectOutgoingCommits(mockGit, "origin", "main");
assert.deepEqual(outgoing, ["abc123", "def456"]);
assert.ok(calls.includes("rev-list HEAD ^refs/remotes/origin/main"));
assert.ok(findForbiddenOutgoingFiles(mockGit, outgoing).some((hit) => hit.includes("trip-data.json")), "历史提交中的过程 JSON 必须被拦截");

/* 敏感信息复扫 */
fs.writeFileSync(path.join(publishDir, "guide.html"), 'key = "AIzaSyA1234567890abcdefghijklmnopqrstuv"');
const googleHits = scanSecrets(publishDir, new Set(["guide.html"]));
assert.ok(googleHits.some((hit) => hit.includes("真实 Google API Key")), `Google 密钥必须命中：${JSON.stringify(googleHits)}`);
fs.writeFileSync(path.join(publishDir, "guide.html"), '<html><body><img src="images/cover.jpg"></body></html>');
assert.deepEqual(scanSecrets(publishDir, new Set(["guide.html"])), [], "干净 HTML 不得误报");
const secretHtml = path.join(publishDir, "secret.html");
fs.writeFileSync(secretHtml, 'key = "sb_secret_abcdefg"');
assert.ok(scanSecrets(publishDir, new Set(["secret.html"])).length > 0, "sb_secret_ 必须命中");
fs.rmSync(secretHtml);

/* 浏览器验收记录：完整检查项 + 当前 HTML SHA256；少项必须拒绝。 */
const qaHtml = path.join(temp, "qa-guide.html");
const qaValidation = path.join(temp, "qa-guide.validation.json");
fs.writeFileSync(qaHtml, "<!doctype html><meta name=\"guide-build\" content=\"local\">");
fs.writeFileSync(qaValidation, JSON.stringify({ output: "qa-guide.html", htmlValidation: { valid: true }, browserValidation: { status: "pending", checks: [] } }));
const qaScript = path.join(__dirname, "record-browser-qa.js");
const qaMissing = spawnSync(process.execPath, [qaScript, qaHtml, `--validation=${qaValidation}`, "--checks=desktop,console"], { encoding: "utf8" });
assert.notEqual(qaMissing.status, 0, "缺浏览器验收项必须拒绝记录 passed");
const qaOldSignature = spawnSync(process.execPath, [qaScript, qaHtml, `--validation=${qaValidation}`, `--checks=${REQUIRED_CHECKS.join(",")}`], { encoding: "utf8" });
assert.notEqual(qaOldSignature.status, 0, "仅检查项名称不能登记通过");
assert.equal(JSON.parse(fs.readFileSync(qaValidation)).browserValidation.status, "pending");

console.log("PASS context-saving tools: extract/apply guards, atomic replace, whitelist derivation, secret scan, browser QA record");
