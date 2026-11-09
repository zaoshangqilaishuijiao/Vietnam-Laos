#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateTripData } = require("./validate-trip-data.js");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "guide-arrival-forms-"));
const input = path.join(temp, "trip-data.json");
const output = path.join(temp, "rendered", "guide.html");
const run = (args) => spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
const fixture = run(["scripts/test-data-pipeline.js", `--write-content-fixture=${input}`]);
assert.equal(fixture.status, 0, fixture.stderr);
const template = JSON.parse(fs.readFileSync(path.join(root, "assets/data/trip-data.template.json"), "utf8"));
for (const direction of ["arrival", "departure"]) {
  assert.ok(!Object.hasOwn(template.arrivalDeparture[direction][0], "reason"));
  assert.ok(!Object.hasOwn(template.arrivalDeparture[direction][0], "riskAlternative"));
}
const data = JSON.parse(fs.readFileSync(input, "utf8"));
data.features.arrivalDeparture = true;
for (let id = 11; id <= 13; id++) {
  const title = `到离测试笔记 ${id}`;
  data.sources.push({ id, type: "xiaohongshu", scope: "arrival-departure", title, author: "测试作者", url: `https://www.xiaohongshu.com/explore/arrival-note-${id}`, topics: ["入境"], cities: ["测试城市"], verificationStatus: "已阅读" });
  data.sourceIndex.push({ sourceId: id, title, cities: ["测试城市"], tags: ["入境", "机场", "签证", "申报", "单据", "通关", "交通", "行李", "住宿", "时间"], searchHints: ["单据字段来源", "机场填写入口"] });
}
data.sources.push({ id: 14, type: "official", scope: "arrival-departure", title: "测试主管机关表格", url: "https://authority.invalid/form", topics: ["入境"], cities: ["测试城市"], verificationStatus: "已核对原表" });
data.sources.push({ id: 15, type: "official", scope: "arrival-departure", title: "测试 APP 官方页面", url: "https://apps.invalid/company", topics: ["交通"], cities: ["测试城市"], verificationStatus: "已核对官方页面与 Logo" });
data.researchAudit.arrivalDepartureRequiredCount = 3;
data.researchAudit.arrivalDepartureReadCount = 3;
data.researchAudit.arrivalDepartureShortfallReason = "";
data.arrivalDeparture = {
  arrival: [{ when: "抵达后", action: "按已确认的口岸流程通关。", sourceIds: [14] }],
  departure: [{ when: "离境时", action: "前往已确认的离境口岸。", sourceIds: [14] }],
  forms: [{ direction: "arrival", name: "测试入境单据", appliesTo: "本次测试证件与口岸", submission: "在官方入口提交", officialUrl: "https://authority.invalid/form", fields: [{ label: "测试字段", guidance: "按证件对应栏位填写，不保存实际号码。" }], sourceIds: [14] }],
  apps: [{ id: "test-ride", name: "测试叫车", region: "测试城市", logoSrc: "images/test-app.png", purpose: "在测试机场叫车进城", notice: "需要当地手机号", officialUrl: "https://apps.invalid/download", sourceIds: [15] }, { id: "test-rail", name: "测试铁路", region: "另一个地区", logoSrc: "images/test-app.png", purpose: "查询并购买铁路车票", sourceIds: [15] }],
  flights: [], experiences: []
};
const valid = validateTripData(data);
assert.equal(valid.valid, true, valid.failures.join("\n"));
// Airport kit is optional for existing data; new facts must retain XHS evidence.
data.arrivalDeparture.airportKits = [{ arrivalIndex: 0, airport: '测试机场', nextStop: '测试酒店', cards: [
  { kind: 'transport', lead: '乘机场快线至酒店所在站', facts: [{ label: '票价', value: '测试线路票价 20 当地币', observedAt: '2026-08-01', sourceIds: [13] }] },
  { kind: 'sim', lead: '在到达大厅运营商柜台买卡', facts: [{ label: '套餐', value: '测试套餐 7 天 10GB', sourceIds: [11] }], details: '测试机场柜台在 2 号出口旁，含短信的套餐另有报价。' },
  { kind: 'exchange', lead: '使用到达大厅银行柜台', facts: [{ label: '位置', value: '测试银行位于 1 号出口左侧', sourceIds: [12] }] }
] }];
assert.equal(validateTripData(data).valid, true, validateTripData(data).failures.join('\n'));
for (const change of [
  d => { d.arrivalDeparture.airportKits[0].arrivalIndex = 9; },
  d => { d.arrivalDeparture.airportKits[0].cards[0].facts[0].sourceIds = [14]; },
  d => { d.arrivalDeparture.airportKits[0].cards[0].facts = []; },
  d => { d.arrivalDeparture.airportKits[0].cards[0].kind = 'sim'; }
]) { const invalid = structuredClone(data); change(invalid); assert.equal(validateTripData(invalid).valid, false); }
const withoutOfficial = structuredClone(data);
withoutOfficial.arrivalDeparture.forms[0].sourceIds = [11];
assert.match(validateTripData(withoutOfficial).failures.join("\n"), /必须包含实际核查的官方来源/);
const withoutFields = structuredClone(data);
withoutFields.arrivalDeparture.forms[0].fields = [];
assert.match(validateTripData(withoutFields).failures.join("\n"), /至少填写一个经核实的单据字段/);
const appWithoutOfficialSource = structuredClone(data);
appWithoutOfficialSource.arrivalDeparture.apps[0].sourceIds = [11];
assert.match(validateTripData(appWithoutOfficialSource).failures.join("\n"), /必须包含 APP 官方页面/);
const appWithUnsafeLogo = structuredClone(data);
appWithUnsafeLogo.arrivalDeparture.apps[0].logoSrc = "../secret.png";
assert.match(validateTripData(appWithUnsafeLogo).failures.join("\n"), /安全的本地相对图片路径/);
const appWithHttpLink = structuredClone(data);
appWithHttpLink.arrivalDeparture.apps[0].officialUrl = "http://apps.invalid/download";
assert.match(validateTripData(appWithHttpLink).failures.join("\n"), /HTTPS 官方页面/);
const duplicateApp = structuredClone(data);
duplicateApp.arrivalDeparture.apps.push({ ...duplicateApp.arrivalDeparture.apps[0] });
assert.match(validateTripData(duplicateApp).failures.join("\n"), /id 重复/);
fs.copyFileSync(path.join(temp, "images/station-locker.png"), path.join(temp, "images/test-app.png"));
fs.writeFileSync(input, JSON.stringify(data), "utf8");
const rendered = run(["scripts/render-guide.js", input, output, "--no-collaboration"]);
assert.equal(rendered.status, 0, rendered.stderr);
const html = fs.readFileSync(output, "utf8");
assert.match(html, /入境单据怎么填/);
assert.match(html, /测试字段/);
assert.match(html, /官方填写入口/);
assert.match(html, /<button[^>]*class="arrival-app-copy"[^>]*data-copy="测试叫车"/);
assert.match(html, /src="images\/test-app.png"/);
assert.match(html, /需要当地手机号/);
assert.doesNotMatch(html, /https:\/\/apps\.invalid\/download|下载 APP/);
assert.equal(fs.existsSync(path.join(temp, "rendered/images/test-app.png")), true);
assert.doesNotMatch(html, /<b>选择依据：<\/b>|<b>异常时改走：<\/b>/);
// Exercise the real copy controller against the rendered card, rather than
// inferring its click boundary from generated class names alone.
(async () => {
  const { JSDOM } = require("jsdom");
  const parsed = new JSDOM(html);
  const kit = parsed.window.document.querySelector('.airport-kit-host');
  assert.ok(kit.previousElementSibling.textContent.includes('抵达后'));
  assert.deepEqual([...kit.querySelectorAll('[data-airport-kit-kind]')].map(n => n.dataset.airportKitKind), ['sim', 'exchange', 'transport']);
  assert.equal(kit.querySelectorAll('details').length, 1, 'Only substantive optional details get an expander');
  assert.ok(kit.textContent.includes('2026-08-01'));
  assert.equal(kit.querySelectorAll('.source-ref').length, 0, '机场核验事实保留正文，但无补充阅读价值的证据不生成重复角标');
  assert.equal(kit.querySelector('footer'), null, '不留下空的来源页脚或标题');
  const renderedApps = [...parsed.window.document.querySelectorAll('.arrival-app-list > .arrival-app-card')];
  assert.deepEqual(renderedApps.map(card => card.querySelector('[data-copy]').dataset.copy), ['测试叫车', '测试铁路']);
  assert.deepEqual(renderedApps.map(card => card.querySelector('.arrival-app-region').textContent), ['测试城市', '另一个地区']);
  assert.equal(parsed.window.document.querySelectorAll('.arrival-apps h4').length, 0, 'Region must be inline metadata, not a large repeated section heading');
  assert.equal(renderedApps[1].querySelector('.arrival-app-content small'), null, 'No empty notice placeholder');
  const cardHtml = parsed.window.document.querySelector(".arrival-app-card").outerHTML;
  parsed.window.close();
  const dom = new JSDOM(`<!doctype html><body>${cardHtml}</body>`, { runScripts: "outside-only", url: "https://guide.invalid/" });
  try {
    const copied = [], notices = [];
    Object.defineProperty(dom.window, "isSecureContext", { value: true });
    Object.defineProperty(dom.window.navigator, "clipboard", { value: { writeText: async value => { copied.push(value); } } });
    dom.window.eval(fs.readFileSync(path.join(root, "assets/travel-guide-interactions.js"), "utf8"));
    const doc = dom.window.document, card = doc.querySelector(".arrival-app-card"), button = card.querySelector("button");
    const init = () => dom.window.TravelGuideInteractions.initCopyControls({ root: doc, toast: value => notices.push(value) });
    init(); init();
    assert.equal(button.textContent.trim(), data.arrivalDeparture.apps[0].name);
    assert.equal(card.querySelectorAll("[data-copy]").length, 1);
    assert.equal(card.querySelector(".arrival-app-copy-hint"), null);
    assert.ok(!card.textContent.includes("复制名称"));
    button.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(copied, ["测试叫车"]);
    assert.deepEqual(notices, ["已复制"]);
    for (const element of [card.querySelector("p"), card.querySelector("small"), card.querySelector("img"), card]) {
      assert.ok(!element.closest("button,[data-copy]"), "Descriptive content must not be inside a copy trigger");
      assert.ok(!element.classList.contains("copyable-name"), "Description must not look clickable");
      element.click();
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(copied, ["测试叫车"], "Description, logo and card background must not copy");
    for (const key of ["Enter", " "]) button.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(copied, ["测试叫车", "测试叫车", "测试叫车"]);
    console.log("PASS 到离单据与 APP 卡片、官方来源、仅名称复制、说明不复制、键盘与幂等、无下载按钮");
  } finally { dom.window.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
