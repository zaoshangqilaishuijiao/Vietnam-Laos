#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { ASSET_SENTINELS } = require("./shared-constants.js");

const validator = path.join(__dirname, "validate-guide-contract.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "travel-full-contract-"));
const titles = {
  arrival: "到达 / 离开",
  "route-map": "路线总览",
  itinerary: "逐日行程",
  transport: "城际与市内交通",
  budget: "预算与汇率",
  recommendations: "当地体验",
  checklist: "出发前核验清单",
  bookings: "预定清单",
  sources: "资料来源"
};

function module(name, body = "") {
  const label = name === "route-map" ? "路线总览" : titles[name];
  return `<section data-guide-module="${name}" id="${name}" data-nav-label="${label}"><h2>${titles[name]}</h2>${body}</section>`;
}

const SENTINEL = Object.fromEntries(ASSET_SENTINELS.map(({ file, marker }) => [file, marker]));

const tenNotes = Array.from({length:10}, (_,i) => `<a href="https://www.xiaohongshu.com/explore/note-${i}">笔记</a>`).join("");
function page({ xhsInside = tenNotes, xhsOutside = "", readCount = 10, parallelStatus = false, bindStatus = true, withDates = true, checklistBody = "", arrivalBody = "", features = "" } = {}) {
  const bindings = bindStatus
    ? "const mapOptions = { overlay: document.getElementById('route-map-loading'), statusElement: document.getElementById('route-map-status') };"
    : "const mapOptions = { overlay: document.getElementById('route-map-loading') };";
  const dateAttributes = withDates ? ' data-trip-start="2026-09-25" data-trip-end="2026-09-25"' : "";
  const itinerary = withDates
    ? '<article class="day" data-itinerary-date="2026-09-25"><time datetime="2026-09-25">2026-09-25</time></article>'
    : '<article class="day"><p>日期待定</p></article>';
  return `<!doctype html><html><head><link rel="preload" as="image" href="assets/niumou-spritesheet.webp" type="image/webp"></head><body data-guide-mode="full" data-guide-features="${features || (arrivalBody ? "arrival flight-records" : "")}"${dateAttributes}>
<style>/* ${SENTINEL["assets/travel-guide-interactions.css"]} */ /* ${SENTINEL["assets/route-map.css"]} */ .card { min-width: 0; }</style>
<nav class="quick-nav" data-quick-nav aria-label="页面快速导航"></nav>
<div data-guide-floating-tools><div id="guide-floating-actions" data-guide-floating-actions><button id="guide-today-trigger" type="button" data-floating-action="today" data-day-jump="" hidden>今天</button><button id="guide-search-trigger" type="button" data-floating-action="search">搜索</button></div><button type="button" data-guide-floating-toggle>•••</button></div><div id="guide-search-panel"><button id="guide-search-close"></button><form id="guide-search-form"><input id="guide-search-input"><button id="guide-search-clear"></button></form><button id="guide-search-prev"></button><span id="guide-search-count"></span><button id="guide-search-next"></button><div id="guide-search-results"></div></div>
<section data-guide-module="hero"><h1>测试行程 <a href="#source-1">[1]</a></h1></section>
${arrivalBody ? module("arrival", arrivalBody) : ""}
${module("route-map")}
${module("itinerary", `<div id="itinerary-explore"><div id="route-map-loading"></div><div id="route-map-status" hidden></div>${parallelStatus ? '<div id="map-status"></div>' : ""}</div>${itinerary}`)}
${module("transport")}${module("budget")}
${module("checklist", checklistBody || '<div data-checklist="" data-editable="true"><div data-checklist-items></div></div>')}
${module("bookings", '<div class="booking-ledger-summary"></div>')}${module("recommendations")}
${module("sources", `<div data-source-group="xiaohongshu" data-xhs-required-count="10" data-xhs-read-count="${readCount}"><p data-xhs-shortfall-reason>当前测试未读取足量笔记。</p>${xhsInside}</div>${xhsOutside}<ol><li value="1" id="source-1">测试来源</li></ol>`)}
<script>/* ${SENTINEL["assets/ics-calendar.js"]} */ TravelGuideCalendar.buildIcs([]); /* ${SENTINEL["assets/travel-guide-interactions.js"]} */ /* travel-baidu-route-map: v1 */ /* travel-google-route-map: v1 */ ${bindings} TravelGuideInteractions.initGuidePage({flights:${arrivalBody ? "true" : "false"}});</script>
</body></html>`;
}

function run(name, html, expectedStatus, expectedText = "", args = ["--full", "--expected-start=2026-09-25", "--expected-end=2026-09-25"]) {
  const file = path.join(tempDir, `${name}.html`);
  fs.writeFileSync(file, html, "utf8");
  const result = spawnSync(process.execPath, [validator, file, ...args], { encoding: "utf8" });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.status !== expectedStatus || (expectedText && !output.includes(expectedText))) throw new Error(`${name} failed\n${output}`);
  console.log(`PASS ${name}`);
}

try {
  run("valid-xhs-in-group", page(), 0, "完整攻略");
  run("valid-split-xhs-groups", page({ xhsOutside: '<a href="https://www.xiaohongshu.com/explore/arrival">到达专项</a>' }), 0, "完整攻略");
  run("reject-nine-even-with-shortfall", page({readCount:9,xhsInside:tenNotes.replace(/<a[^>]+>笔记<\/a>/, "")}), 1, "必须至少读取 10 篇");
  run("reject-same-note-query-variants", page({readCount:10,xhsInside:Array.from({length:10},(_,i)=>`<a href="https://www.xiaohongshu.com/explore/same-note?x=${i}">笔记</a>`).join("")}), 1, "笔记 ID");
  run("valid-structural-without-dates", page({ withDates: false }), 0, "完整攻略", ["--full"]);
  run("reject-xhs-outside-group", page({ readCount: 1, xhsInside: "", xhsOutside: '<a href="https://www.xiaohongshu.com/explore/outside-group">笔记</a>' }), 1, "仅发现 0 个");
  run("reject-parallel-map-status", page({ parallelStatus: true }), 1, "不得保留平行的 #map-status");
  const flightShell = '<button data-flight-manage>录入凭证</button><div data-flight-list></div><div data-flight-editor><form data-flight-form><input data-flight-file><input data-flight-link></form></div><span data-flight-status></span><dialog data-flight-viewer></dialog><script type="application/json" data-flight-seed>[]<\/script>';
  run("valid-flight-records-empty", page({ arrivalBody: '<article data-flight-records>' + flightShell + '</article>' }), 0, "完整攻略");
  run("valid-flight-records-existing", page({ arrivalBody: '<article data-flight-records><button data-flight-manage>管理凭证</button><div data-flight-list><article data-flight-card><button data-flight-view="f1">查看图片</button></article></div><div data-flight-editor><form data-flight-form><input data-flight-file><input data-flight-link></form></div><span data-flight-status></span><dialog data-flight-viewer></dialog><script type="application/json" data-flight-seed>[]<\/script></article>' }), 0, "完整攻略");
  run("reject-flight-card-with-outer-link", page({ arrivalBody: '<article data-flight-records><button data-flight-manage>管理凭证</button><div data-flight-list><article data-flight-card><a data-flight-link-view href="https://tickets.invalid">打开购票链接</a></article></div><div data-flight-editor><form data-flight-form><input data-flight-file><input data-flight-link></form></div><span data-flight-status></span><dialog data-flight-viewer></dialog><script type="application/json" data-flight-seed>[]<\/script></article>' }), 1, "外层");
  run("reject-checklist-after-weather-card", page({
    checklistBody: `<div data-checklist><div data-checklist-items></div><section class="guide-weather-card" data-weather-card data-weather-start-date="2026-09-25" data-weather-end-date="2026-09-25" data-rain-threshold="80"><div data-weather-grid></div><script type="application/json" data-weather-locations>[]<\/script><script type="application/json" data-rain-prayer-source>{}<\/script></section><div data-check="test">违规核验项</div></div>`
  }), 1, "天气卡之后不得再出现核验事项"),
  run("reject-invalid-weather-json", page({
    features: "weather-refresh",
    checklistBody: `<div data-checklist><div data-checklist-items></div><section data-weather-card><button data-weather-refresh></button><div data-weather-grid></div><script type="application/json" data-weather-locations>{invalid json<\/script><script type="application/json" data-rain-prayer-source>{}<\/script><div data-rain-prayer-modal></div></section></div>`
  }), 1, "天气地点 JSON 无法解析"),
  // 双引擎适配器不再依赖 TileLoader 的 overlay/statusElement 参数。
  console.log("Full contract validator smoke tests passed.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
