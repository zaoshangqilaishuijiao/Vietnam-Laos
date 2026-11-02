#!/usr/bin/env node
/**
 * DOM 冒烟测试：覆盖 travel-guide-interactions.js 的初始化函数。
 * 每个函数构造最小 HTML fixture，验证 init 不抛异常且返回预期类型。
 * 依赖 jsdom（devDependency）。
 */

const { requireJsdom } = require("./test-env.js");
const JSDOM = requireJsdom();
if (!JSDOM) {
  console.log("SKIP: jsdom 未安装，DOM 测试跳过（安装提示见上方 stderr）。");
  process.exit(0);
}
const fs = require("fs");
const path = require("path");

const INTERACTIONS_SRC = fs.readFileSync(
  path.resolve(__dirname, "../assets/travel-guide-interactions.js"), "utf8"
);

let passed = 0;
let failed = 0;
const failures = [];

function makeDom(html = "<!DOCTYPE html><html><head></head><body></body></html>") {
  const dom = new JSDOM(html, {
    url: "http://localhost/guide.html",
    pretendToBeVisual: true,
    runScripts: "outside-only"
  });
  return dom;
}

function loadInteractions(dom) {
  dom.window.eval(INTERACTIONS_SRC);
  return dom.window.TravelGuideInteractions;
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    failures.push({ name, error: error.message });
    console.log(`  ✗ ${name} — ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "assertion failed");
}

/* ── 1. initSourceLinks ── */
test("initSourceLinks: 无链接时不抛异常", () => {
  const dom = makeDom();
  const api = loadInteractions(dom);
  api.initSourceLinks({ root: dom.window.document });
  dom.window.close();
});

test("initSourceLinks: 有 source 链接时绑定事件", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body>
    <a href="#source-1">ref</a>
    <div id="source-1">source text</div>
  </body></html>`);
  const api = loadInteractions(dom);
  const doc = dom.window.document;
  dom.window.matchMedia = () => ({ matches: true });
  let scrolls = 0, behavior = "";
  doc.querySelector("#source-1").scrollIntoView = (options) => { scrolls++; behavior = options.behavior; };
  const first = api.initSourceLinks({ root: doc });
  assert(api.initSourceLinks({ root: doc }) === first, "repeat init should reuse source controller");
  doc.querySelector('a[href="#source-1"]').click();
  assert(scrolls === 1, "repeat init must not duplicate source scroll handlers");
  assert(behavior === "auto", "reduced motion should disable smooth source scrolling");
  dom.window.close();
});

test("initSourceLinks: 手机端小红书链接优先唤起 App", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body>
    <a href="https://www.xiaohongshu.com/search_result?keyword=巴黎" data-xhs-link data-xhs-deeplink="xhsdiscover://search/result?keyword=%E5%B7%B4%E9%BB%8E">小红书</a>
  </body></html>`);
  const api = loadInteractions(dom);
  const navigations = [];
  const controller = api.initSourceLinks({
    root: dom.window.document,
    isMobile: () => true,
    navigate: (url) => navigations.push(url)
  });
  const event = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
  dom.window.document.querySelector("[data-xhs-link]").dispatchEvent(event);
  assert(event.defaultPrevented, "mobile Xiaohongshu link should use controlled navigation");
  assert(navigations[0]?.startsWith("xhsdiscover://search/result"), "mobile Xiaohongshu link should try the official app deeplink first");
  assert(navigations.length === 1, "mobile Xiaohongshu link must not auto-fallback to an unstable web route");
  controller.destroy();
  dom.window.close();
});

test("initSourceLinks: 小红书唤起失败时给出可执行反馈", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body>
    <a href="https://www.xiaohongshu.com/search_result?keyword=巴黎" data-xhs-link data-xhs-keyword="巴黎" data-xhs-deeplink="xhsdiscover://search/result?keyword=%E5%B7%B4%E9%BB%8E">小红书</a>
  </body></html>`);
  const api = loadInteractions(dom);
  let message = "";
  const controller = api.initSourceLinks({
    root: dom.window.document,
    isMobile: () => true,
    navigate: () => { throw new Error("unsupported scheme"); },
    toast: (value) => { message = value; }
  });
  dom.window.document.querySelector("[data-xhs-link]").click();
  assert(message.includes("未能唤起小红书") && message.includes("巴黎"), "failed app launch should explain how to continue");
  controller.destroy();
  dom.window.close();
});

/* ── 2. initSearch ── */
test("initSearch: 无 DOM 元素时返回 undefined", () => {
  const dom = makeDom();
  const api = loadInteractions(dom);
  const result = api.initSearch({ root: dom.window.document });
  assert(result === undefined, "should return undefined when elements missing");
  dom.window.close();
});

test("initSearch: 有完整搜索 DOM 时返回 API", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body>
    <button id="guide-search-trigger"></button>
    <div id="guide-search-panel" hidden>
      <button id="guide-search-close"></button>
      <form id="guide-search-form"><input id="guide-search-input"></form>
      <button id="guide-search-clear"></button>
      <div id="guide-search-results"></div>
      <button id="guide-search-prev"></button>
      <button id="guide-search-next"></button>
      <span id="guide-search-count"></span>
    </div>
  </body></html>`);
  const api = loadInteractions(dom);
  const result = api.initSearch({ root: dom.window.document });
  assert(result && typeof result.open === "function", "should return search API");
  dom.window.close();
});

/* ── 3. initToast ── */
test("initToast: 返回 toast 函数", () => {
  const dom = makeDom();
  const api = loadInteractions(dom);
  const toast = api.initToast({ root: dom.window.document });
  assert(typeof toast === "function", "should return a function");
  toast("测试消息");
  dom.window.close();
});

/* ── 4. initCopyControls ── */
test("initCopyControls: 无 [data-copy] 时返回 undefined", () => {
  const dom = makeDom();
  const api = loadInteractions(dom);
  const result = api.initCopyControls({ root: dom.window.document });
  assert(result === undefined, "should return undefined");
  dom.window.close();
});

test("initCopyControls: 有 [data-copy] 时绑定", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body>
    <span data-copy="测试文本">复制</span>
  </body></html>`);
  const api = loadInteractions(dom);
  api.initCopyControls({ root: dom.window.document });
  dom.window.close();
});

/* ── 5. initChecklist ── */
test("initChecklist: 无容器时返回 undefined", () => {
  const dom = makeDom();
  const api = loadInteractions(dom);
  const result = api.initChecklist({ root: dom.window.document });
  assert(result === undefined, "should return undefined");
  dom.window.close();
});

test("initChecklist: 有容器时返回 refresh", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body>
    <div data-checklist="test-scope">
      <label><input type="checkbox" data-check="c1"> 项目1</label>
    </div>
  </body></html>`);
  const api = loadInteractions(dom);
  const result = api.initChecklist({ root: dom.window.document, editable: true });
  assert(result && typeof result.refresh === "function", "should return refresh API");
  dom.window.close();
});

/* ── 6. initImagePreview ── */
test("initImagePreview: 无图片时返回 undefined", () => {
  const dom = makeDom();
  const api = loadInteractions(dom);
  const result = api.initImagePreview({ root: dom.window.document });
  assert(result === undefined, "should return undefined");
  dom.window.close();
});

test("initImagePreview: 有图片时绑定预览", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body>
    <img src="test.jpg" alt="test" data-preview-image="test.jpg">
  </body></html>`);
  const api = loadInteractions(dom);
  api.initImagePreview({ root: dom.window.document });
  const dialog = dom.window.document.querySelector("dialog");
  assert(dialog !== null, "should create dialog element");
  dom.window.close();
});

/* ── 7. initExchange ── */
test("initExchange: 无卡片时返回 undefined", () => {
  const dom = makeDom();
  const api = loadInteractions(dom);
  const result = api.initExchange({ root: dom.window.document });
  assert(result === undefined, "should return undefined");
  dom.window.close();
});

test("initExchange: 有完整卡片时返回 API", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body>
    <div data-exchange-tool data-exchange-base="CNY" data-exchange-targets="EUR,USD">
      <button data-exchange-refresh>刷新</button>
      <span data-exchange-status></span>
      <input data-exchange-input value="100">
      <span data-exchange-last-updated></span>
      <span data-exchange-rate="EUR"></span>
      <span data-exchange-result="EUR"></span>
    </div>
  </body></html>`);
  const api = loadInteractions(dom);
  let fetches = 0;
  const input = dom.window.document.querySelector("[data-exchange-input]");
  const result = api.initExchange({ root: dom.window.document, fetchImpl: () => { fetches++; return Promise.reject(new Error("mock")); } });
  assert(result && typeof result.refresh === "function", "should return exchange API");
  assert(api.initExchange({ root: dom.window.document }) === result, "repeat init should reuse exchange controller");
  assert(fetches === 0, "exchange rates must not refresh during initialization");
  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert(fetches === 1, "Enter in the amount field should refresh exchange rates");
  result.destroy();
  assert(api.initExchange({ root: dom.window.document, fetchImpl: () => Promise.reject(new Error("mock")) }) !== result, "destroy should allow exchange reinitialization");
  dom.window.setTimeout(() => dom.window.close(), 0);
});

/* ── 8. initWeatherForecast ── */
test("initWeatherForecast: 无卡片时返回 undefined", () => {
  const dom = makeDom();
  const api = loadInteractions(dom);
  const result = api.initWeatherForecast({ root: dom.window.document });
  assert(result === undefined, "should return undefined");
  dom.window.close();
});

test("initWeatherForecast: 有卡片时返回 API", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body>
    <div data-weather-card data-weather-start-date="2026-09-20" data-weather-end-date="2026-09-22" data-weather-enabled="true">
      <button data-weather-refresh>刷新天气</button>
      <span data-weather-status></span>
      <div data-weather-grid></div>
      <span data-weather-data-kind></span>
      <span data-weather-updated-at></span>
      <script type="application/json" data-weather-locations>[{"name":"巴黎","placeId":"p1","latitude":48.85,"longitude":2.35}]</script>
    </div>
  </body></html>`);
  const api = loadInteractions(dom);
  const result = api.initWeatherForecast({ root: dom.window.document });
  assert(result && typeof result.refresh === "function", "should return weather API");
  dom.window.close();
});

/* ── 9. initQuickNav ── */
test("initQuickNav: 无 nav 时返回 undefined", () => {
  const dom = makeDom();
  const api = loadInteractions(dom);
  const result = api.initQuickNav({ root: dom.window.document });
  assert(result === undefined, "should return undefined");
  dom.window.close();
});

test("initQuickNav: 有 nav 和 section 时绑定", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body>
    <nav data-quick-nav><a href="#sec1">Section 1</a></nav>
    <section id="sec1" data-nav-label="Section 1">Content</section>
  </body></html>`);
  const api = loadInteractions(dom);
  const result = api.initQuickNav({ root: dom.window.document });
  assert(typeof result === "function", "should return destroy function");
  result(); // cleanup
  dom.window.close();
});

/* ── 10. initDayTabs ── */
test("initDayTabs: 无 tab 时返回 undefined", () => {
  const dom = makeDom();
  const api = loadInteractions(dom);
  const result = api.initDayTabs({ root: dom.window.document });
  assert(result === undefined, "should return undefined");
  dom.window.close();
});

test("initDayTabs: 有 tab/panel 时返回 select API", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body>
    <button data-day-tab="1" aria-selected="true">Day 1</button>
    <button data-day-tab="2">Day 2</button>
    <div data-day-panel="1">Panel 1</div>
    <div data-day-panel="2" hidden>Panel 2</div>
  </body></html>`);
  const api = loadInteractions(dom);
  const result = api.initDayTabs({ root: dom.window.document });
  assert(result && typeof result.select === "function", "should return select API");
  dom.window.close();
});

test("initDayTabs: 首屏入口、深链接、历史恢复与销毁", () => {
  const dom = makeDom(`<a href="#day-2" data-day-jump="2"><span>瑞士</span></a><a href="#day-99" data-day-jump="99">未知</a><div data-day-tabs><button data-day-tab="1" aria-selected="true">一</button><button data-day-tab="2">二</button></div><article id="day-1" data-day-panel="1"></article><article id="day-2" data-day-panel="2" hidden></article>`);
  const win = dom.window, doc = win.document;
  let selected = 0, scrolls = 0;
  doc.addEventListener('guide:day-change', e => { selected = e.detail.dayNumber; });
  doc.querySelector('[data-day-tabs]').scrollIntoView = () => { scrolls++; };
  const api = loadInteractions(dom);
  const tabs = api.initDayTabs({ root: doc });
  assert(api.initDayTabs({ root: doc }) === tabs, '重复初始化必须复用同一个 Tab 实例，不能重复绑定监听');
  doc.querySelector('a span').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  assert(selected === 2 && !doc.querySelector('#day-2').hidden && doc.querySelector('#day-1').hidden, '入口应切换且仅显示目标日');
  assert(win.location.hash === '#day-2' && doc.activeElement.dataset.dayTab === '2' && scrolls > 0, '应更新地址、焦点与滚动');
  doc.querySelector('[data-day-tab="1"]').click();
  assert(win.location.hash === '#day-1', '深链接状态下日期点击应更新地址');
  doc.querySelector('[data-day-tab="1"]').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert(win.location.hash === '#day-2' && !doc.querySelector('#day-2').hidden, '键盘切换应同步地址和活动日');
  win.history.replaceState(null, '', '#day-2'); win.dispatchEvent(new win.PopStateEvent('popstate'));
  assert(!doc.querySelector('#day-2').hidden, '历史恢复应揭示目标日');
  win.history.replaceState(null, '', '#day-99'); win.dispatchEvent(new win.HashChangeEvent('hashchange'));
  assert(!doc.querySelector('#day-2').hidden, '未知日期不应改变当前日');
  win.history.replaceState(null, '', '#day-1'); win.dispatchEvent(new win.HashChangeEvent('hashchange'));
  const modified = new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
  doc.querySelector('a').dispatchEvent(modified);
  assert(!modified.defaultPrevented && !doc.querySelector('#day-1').hidden, '修饰点击保留原生行为');
  tabs.destroy();
  win.history.replaceState(null, '', '#day-2'); win.dispatchEvent(new win.HashChangeEvent('hashchange'));
  assert(!doc.querySelector('#day-1').hidden, '销毁应移除监听');
  api.initDayTabs({ root: doc });
  assert(!doc.querySelector('#day-2').hidden, '首载深链接应直接显示对应日');
  dom.window.close();
});

/* ── 11. initExecutionLinks ── */
test("initExecutionLinks: 无元素时不抛异常", () => {
  const dom = makeDom();
  const api = loadInteractions(dom);
  api.initExecutionLinks({ root: dom.window.document });
  dom.window.close();
});

test("initExecutionLinks: 有 execution-item 时绑定", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body>
    <div class="execution-item" data-place-id="p1">Place</div>
  </body></html>`);
  const api = loadInteractions(dom);
  api.initExecutionLinks({ root: dom.window.document });
  dom.window.close();
});

/* ── 12. initCalendarExport ── */
test("initCalendarExport: 无按钮时返回 undefined", () => {
  const dom = makeDom();
  const api = loadInteractions(dom);
  const result = api.initCalendarExport({ root: dom.window.document });
  assert(result === undefined, "should return undefined");
  dom.window.close();
});

test("initCalendarExport: 有按钮和事件数据时返回 API", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body>
    <button data-calendar-export>导出</button>
    <span data-calendar-status></span>
    <script type="application/json" data-calendar-events>[{"date":"2026-09-20","allDay":true,"title":"Test"}]</script>
  </body></html>`);
  const api = loadInteractions(dom);
  const result = api.initCalendarExport({ root: dom.window.document });
  assert(result && typeof result.export === "function", "should return export API");
  assert(api.initCalendarExport({ root: dom.window.document }) === result, "repeat init should reuse calendar controller");
  dom.window.close();
});

/* ── 13. initExpenseTracker ── */
test("initCalendarExport: daily/timed 结果单位、下载和错误状态", () => {
  for (const mode of ["daily", "timed"]) {
    const events = [
      { date: "2026-09-20", allDay: mode === "daily", startTime: "09:00", title: "原计划一" },
      { date: mode === "daily" ? "2026-09-21" : "2026-09-20", allDay: mode === "daily", startTime: "14:00", title: "原计划二" }
    ];
    const dom = makeDom(`<!DOCTYPE html><html><head></head><body>
      <button data-calendar-export>导出</button><span data-calendar-status role="status" aria-live="polite"></span>
      <script type="application/json" data-calendar-events data-calendar-mode="${mode}">${JSON.stringify(events)}</script>
    </body></html>`);
    const api = loadInteractions(dom);
    const win = dom.window, status = win.document.querySelector("[data-calendar-status]");
    let downloads = 0, received;
    win.URL.createObjectURL = () => "blob:calendar-test";
    win.URL.revokeObjectURL = () => {};
    win.HTMLAnchorElement.prototype.click = () => { downloads++; };
    win.TravelGuideCalendar = { buildIcs: value => { received = value; return "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"; } };
    const controller = api.initCalendarExport({ root: win.document });
    assert(status.textContent === "", "初始不能重复按钮范围与计数");
    controller.export();
    assert(downloads === 1, "一次操作只生成一次下载");
    assert(JSON.stringify(received) === JSON.stringify(events), "结果文案不能改写日历事件");
    assert(status.textContent === (mode === "daily" ? "已生成 2 天行程的 ICS 文件" : "已生成 2 项安排的 ICS 文件"), "按导出模式使用正确单位");
    win.TravelGuideCalendar.buildIcs = () => { throw Error("fixture"); };
    controller.export();
    assert(downloads === 1 && status.textContent.includes("生成失败"), "失败不得新增下载或保留成功提示");
    delete win.TravelGuideCalendar;
    controller.export();
    assert(status.textContent.includes("组件暂不可用"), "组件缺失仍有明确反馈");
    dom.window.close();
  }
});

test("initExpenseTracker: 无卡片时返回 undefined", () => {
  const dom = makeDom();
  const api = loadInteractions(dom);
  const result = api.initExpenseTracker({ root: dom.window.document });
  assert(result === undefined, "should return undefined");
  dom.window.close();
});

test("initExpenseTracker: 有卡片时返回 render API", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body data-guide-id="test">
    <div data-expense-tracker data-currency="CNY" data-budget-max="10000">
      <input data-expense-date>
      <input data-expense-name>
      <input data-expense-amount>
      <button data-expense-add>添加</button>
      <ul data-expense-list></ul>
      <span data-expense-total></span>
      <span data-expense-compare></span>
    </div>
  </body></html>`);
  const api = loadInteractions(dom);
  const result = api.initExpenseTracker({ root: dom.window.document });
  assert(result && typeof result.render === "function", "should return render API");
  assert(result.escapeCsvCell("=1+1") === '"\'=1+1"', "CSV formula markers must be neutralized");
  assert(result.escapeCsvCell("普通项目") === '"普通项目"', "ordinary CSV text must remain unchanged");
  dom.window.close();
});

/* ── 14. initBookingLedger ── */
test("initBookingLedger: 无按钮时返回 refresh API", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body data-guide-id="test"></body></html>`);
  const api = loadInteractions(dom);
  const result = api.initBookingLedger({ root: dom.window.document });
  assert(result && typeof result.refresh === "function", "should return refresh API");
  dom.window.close();
});

test("initBookingLedger: 有 toggle 按钮时绑定", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body data-guide-id="test">
    <button data-booking-toggle data-local-booking="true" data-booking-id="b1">预订</button>
  </body></html>`);
  const api = loadInteractions(dom);
  const result = api.initBookingLedger({ root: dom.window.document });
  assert(result && typeof result.refresh === "function", "should return refresh API");
  dom.window.close();
});

/* ── 15. initFlightRecords ── */
function flightFixture(seed = []) {
  const { renderFlightRecords } = require("../assets/modules/15-flight-records.js");
  return `<!DOCTYPE html><html><head></head><body data-guide-id="flight-test" data-trip-start="2026-11-27">${renderFlightRecords(seed)}</body></html>`;
}

test("initFlightRecords: 无组件时返回 undefined", () => {
  const dom = makeDom();
  const api = loadInteractions(dom);
  assert(api.initFlightRecords({ root: dom.window.document }) === undefined, "should return undefined");
  dom.window.close();
});

test("initFlightRecords: 仅链接录入、不编造航班且切换为管理", () => {
  const dom = makeDom(flightFixture());
  let opened = "";
  dom.window.open = (url) => { opened = url; };
  const api = loadInteractions(dom);
  const result = api.initFlightRecords({ root: dom.window.document });
  const doc = dom.window.document;
  assert(!doc.querySelector('[data-flight-field]'), "no manual flight fields");
  doc.querySelector("[data-flight-link]").value = "https://example.com/ticket";
  doc.querySelector("[data-flight-form]").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  const ticket = doc.querySelector("[data-flight-card]");
  assert(ticket && ticket.textContent.includes("航班待核验"), "link-only ticket must not invent flight data");
  assert(!ticket.textContent.includes("座位") && !ticket.textContent.includes("行李"), "extra fields must not render");
  assert(doc.querySelector("[data-flight-manage]").textContent === "管理凭证", "existing ticket should switch action label");
  const view = doc.querySelector("[data-flight-link-view]");
  assert(view && view.href === "https://example.com/ticket" && view.target === "_blank", "link opens separately in new tab");
  const stored = dom.window.localStorage.getItem("travel-guide-flight-records:flight-test") || "";
  assert(stored.includes("https://example.com/ticket") && !stored.includes("data:image"), "storage should contain link, not image data");
  assert(result && typeof result.openEditor === "function", "should return API");
  dom.window.close();
});

test("initFlightRecords: 种子机票直接显示修改入口", () => {
  const seed = [{ id:"seed-1", flightNumber:"MU2852", airline:"东方航空", departureDate:"2026-08-01", departureTime:"20:30", arrivalDate:"2026-08-01", arrivalTime:"22:15", departureAirport:"北京大兴", arrivalAirport:"常州奔牛", detailUrl:"https://example.com/order" }];
  const dom = makeDom(flightFixture(seed));
  const api = loadInteractions(dom);
  api.initFlightRecords({ root: dom.window.document });
  const doc = dom.window.document;
  assert(doc.querySelector("[data-flight-list]").textContent.includes("MU2852"), "seed ticket should render");
  assert(doc.querySelector("[data-flight-manage]").textContent === "管理凭证", "seed ticket should not prompt add");
  dom.window.close();
});

test("initFlightRecords: 远端航班更新保留未同步的本机航段", () => {
  const localOnly = { id:"local-only", flightNumber:"MU2852", airline:"东方航空", departureAirport:"北京大兴", arrivalAirport:"常州奔牛", detailUrl:"https://example.com/local" };
  const remote = { id:"remote-1", flightNumber:"CA1234", airline:"中国国航", departureAirport:"上海虹桥", arrivalAirport:"北京首都" };
  const dom = makeDom(flightFixture());
  dom.window.localStorage.setItem("travel-guide-flight-records:flight-test", JSON.stringify([localOnly]));
  const api = loadInteractions(dom);
  api.initFlightRecords({ root: dom.window.document });
  dom.window.document.dispatchEvent(new dom.window.CustomEvent("guide:flight-records-remote", { detail: { records: [remote] } }));
  const cards = dom.window.document.querySelectorAll("[data-flight-card]");
  assert(cards.length === 2, "remote update must not silently discard a local-only flight");
  assert(dom.window.document.body.textContent.includes("本机未同步记录已保留"), "retained local-only flight must be disclosed");
  dom.window.close();
});

test("initFlightRecords: 多航段 OCR 拆分且丢弃敏感文本", () => {
  const dom = makeDom(flightFixture());
  const api = loadInteractions(dom);
  const result = api.initFlightRecords({ root: dom.window.document });
  const row = (text, y, height = 20) => ({ text, score:.99, poly:[[0,y],[220,y],[220,y+height],[0,y+height]] });
  const candidates = result.flightOcrCandidates([
    row("11月27日 深圳 → 曼谷", 0), row("南方航空 CZ8075", 45), row("SZX 深圳宝安机场 T3", 70),
    row("BKK 素万那普机场 T1", 90), row("09:00", 110, 40), row("11:10", 125, 40),
    row("11月29日 曼谷 → 深圳", 200), row("南方航空 CZ8324", 245), row("BKK 素万那普机场 T1", 270),
    row("SZX 深圳宝安机场 T3", 290), row("19:15", 310, 40), row("22:50", 325, 40),
    row("张三 票号 123456789 二维码", 380)
  ]);
  assert(candidates.length === 2, "OCR should split two flight segments");
  assert(candidates[0].flightNumber === "CZ8075" && candidates[1].flightNumber === "CZ8324", "flight numbers should stay in their segment");
  assert(candidates[0].departureTime === "09:00" && candidates[1].arrivalTime === "22:50", "times should stay in their segment");
  assert(!JSON.stringify(candidates).includes("123456789"), "sensitive OCR text must be discarded");
  dom.window.close();
});
/* ── 15. initFloatingActions ── */
test("initFloatingActions: 组合菜单、今日跳转、键盘关闭与幂等", () => {
  const today = new Date().toLocaleDateString("sv-SE");
  const dom = makeDom(`<!DOCTYPE html><html><body>
    <div data-guide-floating-tools><div data-guide-floating-actions aria-hidden="true" inert>
      <button data-floating-action="today" data-day-jump="" hidden>今天</button>
      <button id="guide-search-trigger" data-floating-action="search">搜索</button>
    </div><button data-guide-floating-toggle aria-expanded="false"><span data-guide-floating-toggle-icon>•••</span></button></div>
    <div data-day-tabs><button data-day-tab="1" aria-selected="true">第一天</button><button data-day-tab="2" aria-selected="false">第二天</button></div>
    <article data-day-panel="1" data-itinerary-date="2026-01-01"></article><article data-day-panel="2" data-itinerary-date="${today}" hidden></article>
  </body></html>`);
  const api = loadInteractions(dom); const doc = dom.window.document;
  doc.querySelectorAll("[data-day-tab]").forEach((node) => { node.scrollIntoView = () => {}; });
  doc.querySelector("[data-day-tabs]").scrollIntoView = () => {};
  api.initDayTabs({ root: doc });
  const first = api.initFloatingActions({ root: doc });
  const toggle = doc.querySelector("[data-guide-floating-toggle]");
  const actions = doc.querySelector("[data-guide-floating-actions]");
  const todayAction = doc.querySelector('[data-floating-action="today"]');
  assert(!todayAction.hidden && todayAction.dataset.dayJump === "2", "today action should target the exact local date");
  toggle.click();
  assert(first.isOpen() && toggle.getAttribute("aria-expanded") === "true" && actions.getAttribute("aria-hidden") === "false", "toggle should open the combined menu");
  assert(doc.querySelector("[data-guide-floating-toggle-icon]").textContent === "×", "open menu should expose a close affordance");
  todayAction.click();
  assert(!first.isOpen() && !doc.querySelector('[data-day-panel="2"]').hidden, "today action should select the matching day and close the menu");
  toggle.click();
  doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert(!first.isOpen() && doc.activeElement === toggle, "Escape should close and restore focus");
  assert(api.initFloatingActions({ root: doc }) === first, "repeat init should reuse controller");
  first.destroy();
  dom.window.close();
});

test("initFloatingActions: 行程日期不含今天时隐藏今日入口", () => {
  const dom = makeDom(`<!DOCTYPE html><html><body><div data-guide-floating-tools><div data-guide-floating-actions><button data-floating-action="today" data-day-jump="">今天</button><button data-floating-action="search">搜索</button></div><button data-guide-floating-toggle><span data-guide-floating-toggle-icon>•••</span></button></div><article data-day-panel="1" data-itinerary-date="2000-01-01"></article></body></html>`);
  const api = loadInteractions(dom); const doc = dom.window.document;
  const controller = api.initFloatingActions({ root: doc });
  assert(doc.querySelector('[data-floating-action="today"]').hidden, "today action must not jump to a nearest or stale date");
  controller.destroy(); dom.window.close();
});

test("initNiumouFloatingToggle: 素材加载、滚动跑动、减少动效与销毁", () => {
  const create = (reduced) => {
    const dom = makeDom(`<!DOCTYPE html><html><body><div data-guide-floating-tools data-open="false"><div data-guide-floating-actions></div><button data-guide-floating-toggle><span data-guide-floating-toggle-icon>•••</span></button></div></body></html>`);
    const { window } = dom;
    window.matchMedia = () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} });
    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 0 });
    window.requestAnimationFrame = (callback) => { callback(); return 1; };
    window.cancelAnimationFrame = () => {};
    window.Image = class ImmediateImage extends window.EventTarget {
      set src(value) { this.currentSrc = value; this.dispatchEvent(new window.Event("load")); }
    };
    return dom;
  };

  const dom = create(false); const doc = dom.window.document; const api = loadInteractions(dom);
  const first = api.initNiumouFloatingToggle({ root: doc });
  const toggle = doc.querySelector("[data-guide-floating-toggle]");
  const sprite = doc.querySelector(".guide-niumou-sprite");
  assert(toggle.dataset.niumouReady === "true" && doc.body.classList.contains("guide-niumou-enabled"), "loaded Niumou should replace the fallback entry");
  dom.window.scrollY = 120;
  dom.window.dispatchEvent(new dom.window.Event("scroll"));
  assert(toggle.dataset.niumouState === "running" && /0% 70%/.test(sprite.style.backgroundPosition), "page scroll should start the original running frames");
  assert(api.initNiumouFloatingToggle({ root: doc }) === first, "repeat init should reuse Niumou controller");
  first.destroy();
  assert(!toggle.classList.contains("guide-niumou-ready") && !doc.querySelector(".guide-niumou-viewport"), "destroy should restore the fallback entry");
  dom.window.close();

  const reducedDom = create(true); const reducedDoc = reducedDom.window.document; const reducedApi = loadInteractions(reducedDom);
  const reducedController = reducedApi.initNiumouFloatingToggle({ root: reducedDoc });
  const reducedToggle = reducedDoc.querySelector("[data-guide-floating-toggle]");
  reducedDom.window.scrollY = 120;
  reducedDom.window.dispatchEvent(new reducedDom.window.Event("scroll"));
  assert(reducedToggle.dataset.niumouState === "idle", "reduced motion should keep Niumou static while scrolling");
  reducedController.destroy(); reducedDom.window.close();
});

/* ── 16. initGuidePage (orchestrator) ── */
test("initGuidePage: 空页面不抛异常", () => {
  const dom = makeDom();
  const api = loadInteractions(dom);
  const result = api.initGuidePage({ root: dom.window.document });
  assert(typeof result === "object", "should return active modules object");
  dom.window.close();
});

test("initThemeSwitcher: 六主题切换、持久化与幂等", () => {
  const labels = {rainforest:'雨林绿',coast:'海岸蓝',terracotta:'暖陶土',ink:'墨色',burgundy:'勃艮第',midnight:'午夜紫'};
  const buttons = Object.entries(labels).map(([id,label]) => `<button data-guide-theme="${id}" aria-pressed="false"><span>${label}</span></button>`).join("");
  const dom = makeDom(`<!DOCTYPE html><html><body data-guide-id="theme-test"><button data-guide-theme-launcher aria-expanded="false"><span data-guide-theme-current></span></button><div data-guide-theme-popover hidden><button data-guide-theme-close>×</button><div data-guide-theme-picker>${buttons}</div></div><main></main></body></html>`);
  const api = loadInteractions(dom); const doc = dom.window.document;
  const first = api.initThemeSwitcher({ root: doc });
  assert(doc.body.dataset.guideTheme === "coast", "should apply default coast theme");
  assert(doc.querySelector('[data-guide-theme-current]').textContent === '海岸蓝', "should sync launcher label");
  doc.querySelector('[data-guide-theme-launcher]').click();
  assert(!doc.querySelector('[data-guide-theme-popover]').hidden && doc.querySelector('[data-guide-theme-launcher]').getAttribute('aria-expanded') === 'true', "should open compact popover");
  doc.querySelector('[data-guide-theme="terracotta"]').click();
  assert(doc.body.dataset.guideTheme === "terracotta", "should switch theme");
  assert(doc.querySelector('[data-guide-theme-current]').textContent === '暖陶土', "should update launcher label after switching");
  assert(dom.window.localStorage.getItem("travel-guide-theme:theme-test") === "terracotta", "should persist by guide id");
  doc.querySelector('main').click();
  assert(doc.querySelector('[data-guide-theme-popover]').hidden, "outside click should close popover");
  first.setOpen(true);
  doc.querySelector('[data-guide-theme-close]').click();
  assert(doc.querySelector('[data-guide-theme-popover]').hidden && doc.activeElement === doc.querySelector('[data-guide-theme-launcher]'), "close button should restore focus to launcher");
  first.setOpen(true);
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  assert(doc.querySelector('[data-guide-theme-popover]').hidden, "Escape should close popover");
  assert(api.initThemeSwitcher({ root: doc }) === first, "repeat init should reuse controller");
  first.destroy();
  assert(api.initThemeSwitcher({ root: doc }) !== first, "destroy should allow reinit");
  dom.window.close();
});

/* ── readJsonIndex helper ── */
test("readJsonIndex: 解析 JSON script 标签", () => {
  const dom = makeDom(`<!DOCTYPE html><html><head></head><body>
    <script type="application/json" data-test-index>[1,2,3]</script>
  </body></html>`);
  const api = loadInteractions(dom);
  const result = api.readJsonIndex("[data-test-index]", dom.window.document);
  assert(Array.isArray(result) && result.length === 3, "should parse JSON array");
  dom.window.close();
});

test("readJsonIndex: 无标签时返回空数组", () => {
  const dom = makeDom();
  const api = loadInteractions(dom);
  const result = api.readJsonIndex("[data-missing]", dom.window.document);
  assert(Array.isArray(result) && result.length === 0, "should return empty array");
  dom.window.close();
});

/* ── 汇总 ── */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  failures.forEach(({ name, error }) => console.log(`  ✗ ${name}: ${error}`));
  process.exit(1);
}
