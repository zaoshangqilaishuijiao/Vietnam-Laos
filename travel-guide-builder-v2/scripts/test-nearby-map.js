#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateTripData } = require("./validate-trip-data.js");
const { validateGuideContract } = require("./validate-guide-contract.js");
const { requireJsdom } = require("./test-env.js");
const { scanElementBlock } = require("./html-fragment.js");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "travel-nearby-map-"));
const input = path.join(temp, "trip-data.json");
const output = path.join(temp, "public", "index.html");
const fixture = spawnSync(process.execPath, [path.join(root, "scripts/test-data-pipeline.js"), `--write-content-fixture=${input}`], { encoding: "utf8" });
assert.equal(fixture.status, 0, fixture.stderr);
const data = JSON.parse(fs.readFileSync(input, "utf8"));
const encode = points => {
  let lastLat = 0, lastLng = 0, result = "";
  const value = number => {
    let n = number < 0 ? ~(number << 1) : number << 1;
    while (n >= 32) { result += String.fromCharCode((32 | (n & 31)) + 63); n >>= 5; }
    result += String.fromCharCode(n + 63);
  };
  for (const [lat, lng] of points) {
    const a = Math.round(lat * 1e5), b = Math.round(lng * 1e5);
    value(a - lastLat); value(b - lastLng); lastLat = a; lastLng = b;
  }
  return result;
};
data.features.nearbyExplore = true;
data.sources[7].author = "测试作者";
const candidates = [];
fs.mkdirSync(path.join(temp, "images"), { recursive: true });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
data.meta.hero.cover.src = "images/test-cover.png";
for (const name of ["test-cover", "station-locker"]) fs.writeFileSync(path.join(temp, "images", `${name}.png`), png);
for (let index = 0; index < 5; index += 1) {
  const placeId = `nearby-${index + 1}`, targetId = `nearby-rec-${index + 1}`;
  data.places.push({ id: placeId, name: `附近地点${index + 1}`, localName: `Nearby ${index + 1}`, searchName: `Nearby ${index + 1}`, city: "测试城市", country: "测试国", usage: "suggestion", coordinates: { latitude: 31.232 + index * .001, longitude: 121.472 + index * .001 }, verificationStatus: "已核实", sourceIds: [8] });
  data.recommendations.push({ ...structuredClone(data.recommendations[1]), id: targetId, name: `附近地点${index + 1}`, placeId, travelerFit: `适合第${index + 1}处短暂休息`, image: { src: `images/nearby-${index + 1}.png`, alt: `附近地点${index + 1}`, sourceId: 8 }, sourceIds: [8] });
  candidates.push({ targetType: "recommendation", targetId, whyNow: `午后经过附近时可在第${index + 1}处短暂休息`, windowIndex: 0, timing: "下午可短停，与其他候选择一" });
  fs.writeFileSync(path.join(temp, "images", `nearby-${index + 1}.png`), png);
}
for (const [index, placeId] of [[0, "city-park"], [1, "nearby-1"], [2, "nearby-2"]]) {
  data.recommendations[index].placeId = placeId;
  data.recommendations[index].image = { src: `images/base-${index}.png`, alt: `已核实地点 ${index}`, sourceId: 8 };
  fs.writeFileSync(path.join(temp, "images", `base-${index}.png`), png);
}
data.nearbyDays = [{ dayNumber: 1, status: "show", dayType: "ordinary", reason: "午间完成抵达后仍有完整下午，保留五处供选择，不需全部前往。", readyAt: "12:30", freeWindows: [{ startTime: "13:00", endTime: "17:00", city: "测试城市", anchorPlaceId: "city-park", bufferMinutes: 30, basis: "已完成进城并另扣除三十分钟寄存行李和返程缓冲。" }], candidates }];
data.dayRoadRoutes = [{ dayNumber: 1, legs: [
  { fromPlaceId: "central-station", toPlaceId: "city-park", provider: "google-routes", encodedPolyline: encode([[31.23,121.47],[31.235,121.482],[31.24,121.49]]) },
  { fromPlaceId: "city-park", toPlaceId: "central-station", provider: "google-routes", encodedPolyline: encode([[31.24,121.49],[31.235,121.482],[31.23,121.47]]) }
] }];
const valid = value => { const result = validateTripData(value, { stage: "content" }); assert.equal(result.valid, true, result.failures.join("\n")); };
const invalid = (mutate, pattern, base = data) => { const value = structuredClone(base); mutate(value); const result = validateTripData(value, { stage: "content" }); assert.equal(result.valid, false); assert.ok(result.failures.some(failure => pattern.test(failure)), result.failures.join("\n")); };
valid(data);
for (const count of [3, 4]) { const value = structuredClone(data); value.nearbyDays[0].candidates.length = count; valid(value); }
invalid(value => value.nearbyDays[0].candidates.length = 2, /普通日必须有 3–5/);
invalid(value => value.nearbyDays[0].candidates.push(candidates[0]), /普通日必须有 3–5/);
for (const count of [1, 2, 3]) { const value = structuredClone(data); Object.assign(value.nearbyDays[0], { dayType: "transit", reason: "几乎全天持续转场，只在目的地短暂停留；保留少量就近备选。" }); value.nearbyDays[0].candidates.length = count; valid(value); }
invalid(value => { value.nearbyDays[0].dayType = "transit"; value.nearbyDays[0].candidates.length = 4; }, /真正交通日必须有 1–3/);
invalid(value => value.nearbyDays[0].reason = "", /reason/);
invalid(value => delete value.nearbyDays[0].status, /必须声明 status/);
const valueFirst = structuredClone(data);
valueFirst.nearbyDays[0].freeWindows = [];
valueFirst.nearbyDays[0].reason = "本地特色值得选择，原行程没有空隙也可调整普通游览；不自动修改已订安排。";
for (const candidate of valueFirst.nearbyDays[0].candidates) {
  delete candidate.windowIndex;
  candidate.whyNow = "本地独特工艺符合手作兴趣，值得专程前往，不以顺路为条件。";
  candidate.area = "同城另一片区，需另行乘车";
  candidate.timing = "可替换普通漫步；需预约时先确认，不影响已订交通";
}
Object.assign(valueFirst.places.find(place => place.id === "nearby-1").coordinates, { latitude: 31.5, longitude: 121.8 });
valueFirst.recommendations.find(rec => rec.id === "nearby-rec-1").duration = "约 90 分钟，交通另计";
const untouchedValueFirst = structuredClone(valueFirst);
valid(valueFirst);
assert.deepEqual(valueFirst, untouchedValueFirst, "校验推荐不能自动重排行程、补窗口或修改事实");
const unboundWithWindows = structuredClone(data);
delete unboundWithWindows.nearbyDays[0].candidates[0].windowIndex;
valid(unboundWithWindows);
const anotherDestination = structuredClone(valueFirst);
anotherDestination.places.find(place => place.id === "city-park").city = "第二目的地";
anotherDestination.places.find(place => place.id === "nearby-1").city = "第二目的地";
valid(anotherDestination);
invalid(value => value.nearbyDays[0].freeWindows = [], /windowIndex/);
invalid(value => delete value.nearbyDays[0].freeWindows, /freeWindows/, valueFirst);
invalid(value => value.nearbyDays[0].candidates[0].windowIndex = 0, /windowIndex/, valueFirst);
invalid(value => value.places.find(place => place.id === "nearby-1").city = "未安排的城市", /候选城市/, valueFirst);
invalid(value => delete value.recommendations.find(rec => rec.id === "nearby-rec-1").image, /图片/, valueFirst);
invalid(value => value.sources[7].author = "", /作者/, valueFirst);
invalid(value => value.sources[7].url = "", /原帖|url/, valueFirst);
invalid(value => delete value.places.find(place => place.id === "nearby-1").coordinates, /坐标|coordinates/, valueFirst);
invalid(value => value.nearbyDays[0].freeWindows[0].anchorPlaceId = "unknown-hotel", /已确定/);
invalid(value => value.nearbyDays[0].freeWindows[0].city = "另一城市", /锚点城市一致/);
invalid(value => value.places.find(place => place.id === "nearby-1").city = "另一城市", /候选城市/);
invalid(value => value.nearbyDays[0].freeWindows[0].endTime = "12:59", /递增/);
invalid(value => value.nearbyDays[0].freeWindows[0].bufferMinutes = -1, /缓冲分钟/);
invalid(value => value.nearbyDays[0].freeWindows.push(value.nearbyDays[0].freeWindows[0]), /重叠/);
invalid(value => value.nearbyDays[0].readyAt = "14:00", /不能早于/);
invalid(value => value.nearbyDays[0].leaveAt = "16:00", /不能晚于/);
invalid(value => Object.assign(value.nearbyDays[0].freeWindows[0], { startTime: '09:00', endTime: '09:30' }), /确定行程.*d1-station/);
const flexible = structuredClone(data);
Object.assign(flexible.days[0].items[0], { startTime: '', endTime: '', timeText: '上午可调整' });
Object.assign(flexible.nearbyDays[0], { readyAt: '08:00' });
Object.assign(flexible.nearbyDays[0].freeWindows[0], { startTime: '09:00', endTime: '09:30' });
valid(flexible);
invalid(value => value.nearbyDays[0].candidates[0].windowIndex = 9, /windowIndex/);
invalid(value => delete value.nearbyDays[0].candidates[0].timing, /timing/);
invalid(value => value.nearbyDays[0].candidates[1] = value.nearbyDays[0].candidates[0], /不得重复/);
invalid(value => value.nearbyDays[0].candidates[0].targetId = "sight", /已在正式行程/);
invalid(value => value.nearbyDays[0].status = "research-pending", /研究未完成/);
const hidden = (status, extra = {}) => ({ dayNumber: 1, status, dayType: "ordinary", reason: "抵离缓冲后没有安全可用的自由时间，先休息或赶车。", freeWindows: [], candidates: [], ...extra });
for (const entry of [hidden("hide-late-arrival", { readyAt: "22:01" }), hidden("hide-early-departure", { leaveAt: "11:59" }), hidden("hide-no-free-window", { readyAt: "21:30" })]) { const value = structuredClone(data); value.nearbyDays = [entry]; valid(value); }
invalid(value => value.nearbyDays = [hidden("hide-late-arrival", { readyAt: "22:00" })], /22:00 后/);
invalid(value => value.nearbyDays = [hidden("hide-early-departure", { leaveAt: "12:00" })], /12:00 前/);
invalid(value => value.nearbyDays = [hidden("hide-no-free-window", { candidates: [candidates[0]] })], /0 个候选/);
const legacy = structuredClone(data); legacy.nearbyDays = [{ dayNumber: 1, candidates }]; valid(legacy);
const legacyShort = structuredClone(legacy); legacyShort.nearbyDays[0].candidates = candidates.slice(0, 4);
assert.ok(validateTripData(legacyShort, { stage: "content" }).failures.some(failure => failure.includes("旧版记录必须有 5–10")));
const oldPlain = structuredClone(data); delete oldPlain.features.nearbyExplore; delete oldPlain.nearbyDays; delete oldPlain.dayRoadRoutes; valid(oldPlain);
const missingRoad = structuredClone(data);
missingRoad.dayRoadRoutes[0].legs.pop();
valid(missingRoad);
const noRoad = structuredClone(data); delete noRoad.dayRoadRoutes; valid(noRoad);
invalid(value => value.dayRoadRoutes[0].legs.reverse(), /正式行程顺序/);
invalid(value => value.days[0].items[1].breakGroundRoute = true, /breakGroundRoute/);
const wrongRoad = structuredClone(data);
wrongRoad.dayRoadRoutes[0].legs[0].encodedPolyline = encode([[40, 116], [40.01, 116.01]]);
assert.ok(validateTripData(wrongRoad, { stage: "content" }).failures.some(failure => failure.includes("起终点与正式地点不匹配")));
const render = (value, name) => {
  const file = path.join(temp, `${name}.json`), page = path.join(temp, name, "index.html");
  fs.mkdirSync(path.dirname(page), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  const rendered = spawnSync(process.execPath, [path.join(root, "scripts/render-guide.js"), file, page, "--no-collaboration", "--public-source"], { encoding: "utf8" });
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  return { html: fs.readFileSync(page, "utf8"), page };
};
const { html } = render(data, "ordinary");
assert.match(html, /data-calendar-status role="status" aria-live="polite"><\/span>/, "有事件时导出栏初始只显示按钮，不重复计数");
const plainHtml = render(oldPlain, "plain").html;
assert.equal(scanElementBlock(html, "data-day-panel", "1").fragment, scanElementBlock(plainHtml, "data-day-panel", "1").fragment, "候选开关不得修改正式时间线或交通选择");
const calendarData = page => [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find(match => /\bdata-calendar-events\b/.test(match[1]))?.[2];
assert.equal(calendarData(html), calendarData(plainHtml), "附近候选不能改写 ICS 事件");
const valueFirstHtml = render(valueFirst, "value-first").html;
assert.equal((valueFirstHtml.match(/data-nearby-card=/g) || []).length, 5, "不绑定窗口的专程推荐必须完整渲染");
assert.equal(scanElementBlock(valueFirstHtml, "data-day-panel", "1").fragment, scanElementBlock(plainHtml, "data-day-panel", "1").fragment, "有专程候选也不自动重排正式日程");
assert.equal(calendarData(valueFirstHtml), calendarData(plainHtml), "无窗口候选不得改变 ICS 事件");
assert.ok(!valueFirstHtml.includes("undefined" + "</small>"), "无窗口时不得输出无效时间提示");
assert.match(html, /data-nearby-switch/);
assert.match(html, /data-nearby-panel="day-1"/);
assert.equal((html.match(/data-nearby-card=/g) || []).length, 5);
assert.match(html, /roadLegs/);
assert.match(html, /data-guide-features="[^"]*nearby-explore/);
assert.ok(fs.existsSync(path.join(temp, "ordinary/images/nearby-1.png")), "候选图片必须复制到输出目录供发布白名单收录");
assert.match(render(legacy, "legacy").html, /data-nearby-card=/);
const hiddenData = structuredClone(data); hiddenData.nearbyDays = [hidden("hide-early-departure", { leaveAt: "10:00" })];
const allHidden = render(hiddenData, "all-hidden").html;
assert.ok(!/<input\b[^>]*data-nearby-switch/.test(allHidden));
assert.ok(!/<div\b[^>]*data-nearby-panel=/.test(allHidden));
assert.match(allHidden, /data-guide-features="[^"]*nearby-explore/);
assert.equal(validateGuideContract(html.replace('data-nearby-card="nearby-1"', 'data-removed-card="nearby-1"'), { full: true }).valid, false);
const mixed = structuredClone(data);
mixed.meta.dates = ["2026-09-01", "2026-09-02", "2026-09-03"];
mixed.days = mixed.meta.dates.map((date, index) => ({ ...structuredClone(data.days[0]), dayNumber: index + 1, date, items: data.days[0].items.map(item => ({ ...structuredClone(item), id: `d${index + 1}-${item.placeId}` })) }));
mixed.nearbyDays = [structuredClone(data.nearbyDays[0]), { ...hidden("hide-late-arrival", { readyAt: "22:30" }), dayNumber: 2 }, { ...structuredClone(data.nearbyDays[0]), dayNumber: 3, candidates: candidates.slice(0, 3) }];
mixed.nearbyDays[2].freeWindows = [];
mixed.nearbyDays[2].candidates = valueFirst.nearbyDays[0].candidates.slice(0, 3);
delete mixed.dayRoadRoutes;
valid(mixed);
const mixedPage = render(mixed, "mixed");
const china = structuredClone(mixed); china.places.forEach(place => place.country = "中国");
const chinaPage = render(china, "china");
assert.match(chinaPage.html, /const mapProvider="baidu"/);
const JSDOM = requireJsdom();
if (JSDOM) {
  const dom = new JSDOM(mixedPage.html, { runScripts: "outside-only", url: "http://127.0.0.1:8766/" });
  const { window } = dom, { document } = window;
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.navigator.geolocation = { getCurrentPosition(_ok, reject) { reject(); } };
  const runtime = [...document.querySelectorAll("script")].find(script => script.textContent.includes("const syncNearbyPanels="));
  window.eval(runtime.textContent);
  window.eval(fs.readFileSync(path.join(root, "assets/travel-guide-interactions.js"), "utf8"));
  const controller = window.TravelGuideInteractions.initDayTabs({ root: document });
  assert.strictEqual(window.TravelGuideInteractions.initDayTabs({ root: document }), controller);
  const toggle = document.querySelector("[data-nearby-switch]");
  const setToggle = value => { toggle.checked = value; toggle.dispatchEvent(new window.Event("change")); };
  const panel = number => document.querySelector(`[data-nearby-panel="day-${number}"]`);
  setToggle(true); assert.equal(panel(1).hidden, false);
  document.querySelector('[data-day-tab="2"]').click();
  assert.equal(toggle.closest("label").hidden, true); assert.equal(toggle.disabled, true); assert.equal(toggle.checked, false);
  assert.match(document.querySelector("[data-nearby-status]").textContent, /没有安全可用/);
  document.querySelector('[data-day-tab="3"]').click();
  assert.equal(toggle.closest("label").hidden, false); assert.equal(toggle.checked, false); assert.equal(panel(3).hidden, true);
  setToggle(true); assert.equal(panel(3).hidden, false);
  document.querySelector('[data-day-tab="1"]').click(); assert.equal(toggle.checked, true); assert.equal(panel(1).hidden, false); assert.equal(panel(3).hidden, true);
  document.querySelector('[data-day-tab="1"]').dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
  assert.equal(document.querySelector('[data-day-tab="3"]').getAttribute("aria-selected"), "true");
  document.querySelector('[data-use-current-location]').click(); assert.match(document.querySelector('[data-context-location-status]').textContent, /未取得位置/);
  window.navigator.geolocation.getCurrentPosition = ok => ok({ coords: data.places.find(place => place.id === 'nearby-5').coordinates });
  document.querySelector('[data-use-current-location]').click();
  assert.equal(panel(1).querySelector('[data-nearby-card]').dataset.nearbyCard, 'nearby-5');
  assert.match(document.querySelector('[data-context-location-status]').textContent, /按距当前位置/);
  const image = panel(3).querySelector("img"); image.dispatchEvent(new window.Event("error"));
  assert.equal(image.hidden, true); assert.equal(image.closest("button").disabled, true); assert.match(image.closest("button").textContent, /图片暂不可用/);
  controller.destroy(); assert.notStrictEqual(window.TravelGuideInteractions.initDayTabs({ root: document }), controller);
  dom.window.close();
}
const preview = process.argv.find(arg => arg.startsWith("--write-preview-dir="));
if (preview) { const target = path.resolve(preview.slice("--write-preview-dir=".length)); fs.mkdirSync(target, { recursive: true }); fs.cpSync(path.dirname(mixedPage.page), target, { recursive: true }); fs.cpSync(path.join(temp, "images"), path.join(target, "images"), { recursive: true }); fs.cpSync(path.dirname(chinaPage.page), path.join(target, "china"), { recursive: true }); fs.cpSync(path.join(temp, "images"), path.join(target, "china", "images"), { recursive: true }); console.log(`本地合成测试页：${path.join(target, "index.html")}`); }
console.log("PASS value-first/unbound candidates, evidence and destination gates, legacy compatibility, partial roads, hidden days, deterministic rendering and per-day controls");
