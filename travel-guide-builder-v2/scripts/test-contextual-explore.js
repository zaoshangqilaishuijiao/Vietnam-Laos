#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { validateTripData } = require("./validate-trip-data.js");
const { collectLocalAssetReferences } = require("./build-public-guide.js");

const root = path.resolve(__dirname, "..");
const node = process.execPath;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "travel-contextual-explore-"));
const input = path.join(temp, "trip-data.json");
const output = path.join(temp, "public", "index.html");
const fixture = spawnSync(node, [path.join(root, "scripts/test-data-pipeline.js"), `--write-content-fixture=${input}`], { encoding: "utf8" });
if (fixture.status !== 0) throw Error(fixture.stderr);
const data = JSON.parse(fs.readFileSync(input, "utf8"));
data.features.contextualExplore = true;
data.features.exchange = true;
data.budget.targetCurrencies = ["LAK"];
data.budget.exchangeChannels = [{ id: "atm-1", name: "测试 ATM", kind: "atm", currency: "LAK", observedAt: "2026-08-20", rateLocalPerCny: 2900, feeCny: 10, feePercent: 0, feeLocal: 0, sourceIds: [1] }];
data.sources[0].author = "测试作者";
data.places.push(
  { id: "market", name: "手工市集", localName: "Craft Market", searchName: "Craft Market", city: "测试城市", country: "测试国", usage: "suggestion", coordinates: { latitude: 31.235, longitude: 121.48 }, verificationStatus: "已核实", sourceIds: [1] },
  { id: "noodles", name: "面馆", localName: "Noodles", searchName: "Noodles", city: "测试城市", country: "测试国", usage: "suggestion", coordinates: { latitude: 31.238, longitude: 121.485 }, verificationStatus: "已核实", sourceIds: [1] }
);
for (const [index, placeId, file] of [[0, "city-park", "park.png"], [1, "market", "market.png"], [2, "noodles", "noodles.png"]]) {
  data.recommendations[index].placeId = placeId;
  data.recommendations[index].image = { src: `images/${file}`, alt: `${placeId} 实景`, sourceId: 1 };
}
data.recommendations[1].productPicks = [{ name: "手工冰箱贴", reason: "本地手工纹样", where: "手工市集北侧", image: { src: "images/magnet.png", alt: "手工冰箱贴", sourceId: 1 }, sourceIds: [1] }];
data.explorationSegments = [{ id: "station-park", dayNumber: 1, fromPlaceId: "central-station", toPlaceId: "city-park", candidates: [{ targetType: "recommendation", targetId: "experience", relation: "near_route", sourceIds: [1] }, { targetType: "recommendation", targetId: "food", relation: "near_end", sourceIds: [1] }] }];
const valid = validateTripData(data, { stage: "content" });
assert.equal(valid.valid, true, valid.failures.join("\n"));
const noImage = structuredClone(data);
delete noImage.recommendations[1].image;
assert.ok(validateTripData(noImage, { stage: "content" }).failures.some((failure) => failure.includes("必须提供已核实的地点图片")));
const badSegment = structuredClone(data);
badSegment.explorationSegments[0].candidates[0].targetId = "missing";
assert.ok(validateTripData(badSegment, { stage: "content" }).failures.some((failure) => failure.includes("核实坐标")));
fs.mkdirSync(path.join(temp, "images"), { recursive: true });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
for (const name of ["park", "market", "noodles", "magnet"]) fs.writeFileSync(path.join(temp, "images", `${name}.png`), png);
fs.writeFileSync(input, JSON.stringify(data, null, 2));
const rendered = spawnSync(node, [path.join(root, "scripts/render-guide.js"), input, output, "--no-collaboration"], { encoding: "utf8" });
assert.equal(rendered.status, 0, `${rendered.stdout}\n${rendered.stderr}`);
const html = fs.readFileSync(output, "utf8");
assert.match(html, /data-guide-module="route-map"[^>]*>[\s\S]*?<h2>路线总览<\/h2>/);
assert.ok(!/data-map-view="all"/.test(html), "不得恢复整程地图控件");
assert.match(html, /id="itinerary-explore"/);
assert.match(html, /data-map-view="segment-station-park"/);
assert.match(html, /手工冰箱贴/);
assert.match(html, /图片：小红书 · 测试作者/);
assert.match(html, /换 1000 元，实际能拿多少/);
assert.match(html, /id="guide-exchange-trigger"[^>]*data-floating-action="exchange"/);
assert.match(html, /data-exchange-dialog[^>]*>[\s\S]*?data-exchange-local-input/);
assert.match(html, /data-exchange-rate-usd/);
assert.match(html, /data-exchange-mnemonic/);
assert.equal((html.match(/<section class="guide-quickcalc" data-exchange-tool/g) || []).length, 1, "生成页只能有一个汇率换算组件");
const budgetStart = html.indexOf('id="budget"');
assert.ok(budgetStart >= 0);
assert.ok(!html.slice(budgetStart, html.indexOf('</section>', budgetStart)).includes('data-exchange-tool'), "预算正文不能重复放置汇率卡");
assert.ok(fs.existsSync(path.join(temp, "public/images/magnet.png")));
assert.ok(collectLocalAssetReferences(html).has("images/magnet.png"), "发布白名单必须收录推荐图片");
const { requireJsdom } = require("./test-env.js");
const JSDOM = requireJsdom();
if (JSDOM) {
  const generated = new JSDOM(html);
  const generatedDoc = generated.window.document;
  assert.equal(generatedDoc.querySelector('[data-exchange-local-input]').value, '100');
  assert.equal(generatedDoc.querySelector('[data-exchange-input]').readOnly, true);
  const from = generatedDoc.querySelector('[data-exchange-from]'), to = generatedDoc.querySelector('[data-exchange-to]');
  assert.deepEqual([...from.options].map(option => option.value), ['LAK', 'USD', 'CNY']);
  assert.equal(from.value, 'LAK'); assert.equal(to.value, 'CNY');
  assert.ok(generatedDoc.querySelector('[data-exchange-swap][aria-label]'));
  generated.window.close();
  const dom = new JSDOM(`<!doctype html><body><article data-exchange-tool data-exchange-base="CNY" data-exchange-targets="LAK"><button data-exchange-refresh></button><span data-exchange-status></span><input data-exchange-input value="100"><span data-exchange-rate="LAK"></span><span data-exchange-result="LAK"></span></article><article data-exchange-comparison><input data-exchange-compare-amount value="1000"><div data-exchange-channel data-currency="LAK" data-rate="2900" data-fee-cny="10" data-fee-percent="0" data-fee-local="0"><span data-exchange-channel-result></span></div><div data-exchange-channel data-currency="LAK" data-rate="2900" data-fee-cny="" data-fee-percent="0" data-fee-local="0"><span data-exchange-channel-result></span></div><select data-exchange-reverse-currency><option value="LAK">LAK</option></select><input data-exchange-reverse-input value="2900"><span data-exchange-reverse-result></span></article>`, { runScripts: "outside-only", url: "http://127.0.0.1/" });
  dom.window.eval(fs.readFileSync(path.join(root, "assets/travel-guide-interactions.js"), "utf8"));
  const controller = dom.window.TravelGuideInteractions.initExchange({ root: dom.window.document, fetchImpl: async () => ({ ok: true, json: async () => ({ rates: { LAK: 2900 }, date: "2026-08-20" }) }) });
  const results = [...dom.window.document.querySelectorAll('[data-exchange-channel-result]')].map((node) => node.textContent);
  assert.match(results[0], /2,871,000 LAK/);
  assert.equal(results[1], "数据不足，无法比较");
  controller.destroy();
}
console.log("PASS contextual exploration: data contract, image copying, day/segment map, exchange comparison");
