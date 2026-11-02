#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");

// 1. 所有参考资源必须能从 SKILL.md 沿 Markdown 链接到达。
const referenceRoot = path.join(root, "references");
const referenceFiles = walk(referenceRoot).filter((file) => /\.(?:md|json)$/i.test(file));
const seen = new Set();
const queue = [path.join(root, "SKILL.md")];
while (queue.length) {
  const file = queue.shift();
  const key = path.resolve(file);
  if (seen.has(key) || !fs.existsSync(key)) continue;
  seen.add(key);
  const source = fs.readFileSync(key, "utf8");
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)#]+\.(?:md|json))(?:#[^)]+)?\)/gi)) {
    const target = path.resolve(path.dirname(key), match[1]);
    if (target.startsWith(root + path.sep)) queue.push(target);
  }
}
const unreachable = referenceFiles.filter((file) => !seen.has(path.resolve(file))).map(relative);
assert.deepStrictEqual(unreachable, [], "存在未路由参考资源：" + unreachable.join("、"));

// 2. 新增测试必须进入统一测试入口。
const TEST_HELPERS = ["test-env.js"]; // 环境依赖辅助模块（非可运行测试），无需进入统一测试入口
const testRunner = read("scripts/test-skill.js");
const testFiles = fs.readdirSync(path.join(root, "scripts"))
  .filter((name) => /^test-.*\.js$/i.test(name) && name !== "test-skill.js" && !TEST_HELPERS.includes(name));
const missingTests = testFiles.filter((name) => !testRunner.includes(`"${name}"`));
assert.deepStrictEqual(missingTests, [], "存在未进入 test-skill.js 的测试：" + missingTests.join("、"));
assert.ok(testRunner.includes('TRAVEL_GUIDE_REQUIRE_JSDOM: "1"') && read("scripts/test-env.js").includes('process.env.TRAVEL_GUIDE_REQUIRE_JSDOM === "1"'), "全量回归必须在 jsdom 缺失时失败");
const interactionCombiner = read("scripts/combine-interactions-modules.js");
assert.ok(interactionCombiner.includes("readdirSync(modulesDir)") && interactionCombiner.includes("模块编号不连续"), "交互模块组合器必须自动发现模块并校验连续编号");

// 3. 模块注册表是章节顺序、标题和必选状态的机器侧唯一来源。
const registry = JSON.parse(read("references/module-registry.json")).modules;
assert.ok(registry.length > 0, "module-registry.json 为空");
assert.strictEqual(new Set(registry.map((item) => item.name)).size, registry.length, "模块名重复");
assert.ok(registry.every((item) => typeof item.required === "boolean" && typeof item.navigable === "boolean"), "模块缺少 required/navigable");
const renderer = read("scripts/render-guide.js");
const validator = read("scripts/validate-guide-contract.js");
assert.ok(renderer.includes("getModuleRegistry") && renderer.includes("moduleTitle") && renderer.includes("module-registry.json"), "渲染器未惰性读取章节注册表");
assert.ok(validator.includes("getModuleRegistry") && validator.includes("module-registry.json"), "校验器未惰性读取章节注册表");
for (const module of registry.filter((item) => item.title)) {
  const accessor = `moduleTitle("${module.name}")`;
  assert.ok(renderer.includes(accessor), "渲染器未使用注册表标题：" + module.name);
}
assert.ok(read("references/content-modules.md").includes("[module-registry.json](module-registry.json)"), "内容模块文档未指向章节注册表");

// 4. 研究配额的人类规则只在研究文档维护，运行时镜像由共享常量统一。
const constants = require("./shared-constants.js");
assert.strictEqual(JSON.parse(read("references/trip-data.schema.json")).properties.schemaVersion.const, constants.GUIDE_DATA_VERSION, "JSON Schema 与共享数据契约版本不一致");
const research = read("references/research-and-sources.md");
assert.ok(research.includes(`必须读取 ${constants.XHS_GENERAL_REQUIRED_COUNT} 篇`), "常规研究配额与共享常量不一致");
assert.ok(research.includes(`建议读取 ${constants.XHS_ARRIVAL_DEPARTURE_REQUIRED_COUNT} 篇`), "到达/离开配额与共享常量不一致");
const duplicatedQuotaDocs = fs.readdirSync(referenceRoot)
  .filter((name) => name.endsWith(".md") && name !== "research-and-sources.md")
  .filter((name) => /常规[^\n]{0,30}10\s*篇|(?:跨境|到达[^\n]{0,8}离开)[^\n]{0,30}3\s*篇/u.test(read("references/" + name)));
assert.deepStrictEqual(duplicatedQuotaDocs, [], "研究配额在非权威文档重复：" + duplicatedQuotaDocs.join("、"));

// 5. SQL 迁移按文件名连续排序，并同时进入唯一迁移说明、模板锁和契约测试。
const migrations = fs.readdirSync(path.join(root, "supabase")).filter((name) => /^\d{3}_.*\.sql$/i.test(name)).sort();
migrations.forEach((name, index) => assert.strictEqual(Number(name.slice(0, 3)), index + 1, "迁移编号不连续：" + name));
const migrationDoc = read("references/supabase-collaboration.md");
let lastMigrationIndex = -1;
for (const name of migrations) {
  const index = migrationDoc.indexOf(name);
  assert.ok(index > lastMigrationIndex, "迁移文档缺失或顺序错误：" + name);
  lastMigrationIndex = index;
}
const lock = JSON.parse(read("assets/page-template.lock.json"));
const collaborationTest = read("scripts/test-collaboration-contract.js");
for (const name of migrations) {
  assert.ok(lock.files["supabase/" + name], "模板锁遗漏迁移：" + name);
  assert.ok(collaborationTest.includes(name), "协作契约测试遗漏迁移：" + name);
}

// 6. 模板锁覆盖全部生成资产；地图只保留当前百度/Google 运行时及通用状态样式。
const assetFiles = walk(path.join(root, "assets"))
  .map(relative)
  .filter((name) => name !== "assets/page-template.lock.json");
const unlockedAssets = assetFiles.filter((name) => !lock.files[name]);
assert.deepStrictEqual(unlockedAssets, [], "模板锁遗漏资产：" + unlockedAssets.join("、"));
const publishing = read("references/web-output-and-publishing.md");
assert.ok(!/Leaflet JavaScript|地图瓦片.*多源降级/u.test(publishing), "发布规则仍保留旧 Leaflet 双源真相");
assert.ok(!/tile-loader\.js|loadLeaflet|startLeaflet|window\.L/.test(renderer), "渲染器仍引用旧 Leaflet 运行时");
assert.ok(fs.existsSync(path.join(root, "assets", "route-map.css")), "缺少当前地图通用状态样式");
assert.ok(!fs.existsSync(path.join(root, "assets", "leaflet-route-map")), "已停用 Leaflet 目录不得继续保留在运行资产中");

console.log(`PASS structure integrity（references=${referenceFiles.length}, tests=${testFiles.length}, migrations=${migrations.length}, assets=${assetFiles.length}）`);
