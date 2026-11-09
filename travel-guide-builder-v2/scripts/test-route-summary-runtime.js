#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const runtime = fs.readFileSync(path.join(__dirname, "..", "assets", "travel-guide-interactions.js"), "utf8");
const dom = new JSDOM(`<!doctype html><body><section class="route-timeline-card">
  <div class="route-timeline-summary"></div>
  <ol>
    <li class="route-stop-row"><time class="route-stop-time" data-initial-minutes="540">09:00</time><a class="route-place-link">起点</a></li>
    <li class="route-stop-row is-final"><time class="route-stop-time" data-initial-minutes="600">10:00</time><a class="route-place-link">&lt;img data-audit-xss src=x&gt;</a></li>
  </ol>
  <div class="route-timeline-transfer" data-route-segment-index="0" data-default-duration="20" data-selected-duration="20" data-selected-mode="driving">
    <button data-route-mode-option data-navigation-mode="driving" data-duration-minutes="20" data-navigation-url="https://maps.example/drive" aria-pressed="true" class="is-active">🚗 20分<span class="route-timeline-rec">荐</span></button>
    <button data-route-mode-option data-navigation-mode="walking" data-duration-minutes="35" data-navigation-url="https://maps.example/walk" aria-pressed="false">🚶‍♀️ 35分</button>
    <button data-route-mode-option data-navigation-mode="tuktuk" data-action-label="查看突突车路线" data-duration-minutes="25" data-navigation-url="https://maps.example/tuktuk" aria-pressed="false">🛺 25分</button>
    <a data-route-navigation-launch href="https://maps.example/drive">发起驾车导航</a>
  </div>
</section></body>`, { runScripts: "outside-only", url: "https://example.test/" });
dom.window.eval(runtime);
dom.window.TravelGuideInteractions.initRouteSummary();
assert.equal(dom.window.document.querySelector("[data-audit-xss]"), null, "地点文本不得通过 innerHTML 重新变成 DOM");
const walking = dom.window.document.querySelector('[data-navigation-mode="walking"]');
walking.click();
assert.equal(dom.window.document.querySelectorAll(".route-timeline-rec").length, 1, "推荐角标不得随选择移动");
assert.equal(walking.getAttribute("aria-pressed"), "true");
assert.equal(dom.window.document.querySelector(".route-stop-row.is-final .route-stop-time").textContent, "10:00");
assert.match(dom.window.document.querySelector(".route-stop-row.is-final .route-arrival-estimate").textContent, /10:15.*晚于计划 15/);
const summaryText = dom.window.document.querySelector(".route-timeline-summary").textContent;
assert(summaryText.includes("共 2 个停靠点 · 已知移动 35分 · 终点 <img data-audit-xss src=x>"));
assert(!summaryText.includes("全程"), "切换交通方案后也必须保持三事实摘要");
const launcher = dom.window.document.querySelector("[data-route-navigation-launch]");
assert.equal(launcher.textContent, "发起步行导航");
assert.equal(launcher.href, "https://maps.example/walk");
const tuktuk = dom.window.document.querySelector('[data-navigation-mode="tuktuk"]');
tuktuk.click();
assert.equal(launcher.textContent, "查看突突车路线");
assert.equal(launcher.href, "https://maps.example/tuktuk");
assert.equal(dom.window.document.querySelector("[data-audit-xss]"), null, "切换后仍不得注入 DOM");
const flexible = new JSDOM(`<!doctype html><body><section class="route-timeline-card"><div class="route-timeline-summary">原汇总</div><ol>
<li class="route-stop-row"><time class="route-stop-time" data-initial-minutes="540">09:00</time><a class="route-place-link">起点</a></li>
<li class="route-stop-row"><time class="route-stop-time">上午</time><a class="route-place-link">终点</a></li></ol>
<div class="route-timeline-transfer" data-route-segment-index="0" data-default-duration="20" data-selected-duration="20"><button data-route-mode-option data-navigation-mode="walking" data-duration-minutes="35" data-navigation-url="https://maps.example/walk">步行</button><a data-route-navigation-launch></a></div>
<div class="route-timeline-transfer" data-default-duration="7" data-selected-duration="7"></div></section></body>`,{runScripts:'outside-only',url:'https://example.test/'});
flexible.window.eval(runtime);flexible.window.TravelGuideInteractions.initRouteSummary();
flexible.window.document.querySelector('button').click();
assert.match(flexible.window.document.querySelector('.route-timeline-summary').textContent,/已知移动 42分/,'sum includes known non-navigable legs even with flexible clock text');
assert.equal(flexible.window.document.querySelectorAll('time')[1].textContent,'上午');
assert.equal(flexible.window.document.querySelector('.route-arrival-estimate'),null,'never infer arrival times from flexible text');
assert.equal(flexible.window.document.querySelector('[data-route-navigation-launch]').href,'https://maps.example/walk');
dom.window.close();flexible.window.close();
// Exercise generated markup, not only hand-authored DOM: query preference != a new duration.
const { dayNavigationSegments, renderDayNavigation } = require('./render-guide.js');
const places = new Map(['a','b','c'].map((id,index)=>[id,{id,name:id,coordinates:{latitude:18+index/100,longitude:103}}]));
const planned = {dayNumber:1,items:[
  {id:'a',placeId:'a',startTime:'09:00'},
  {id:'b',placeId:'b',startTime:'09:40',transportMode:'地铁 / 步行',travelMinutes:25,navigationMode:'driving'},
  {id:'c',placeId:'c',startTime:'10:30',transportMode:'驾车',travelMinutes:20,navigationOptions:[
    {mode:'driving',durationMinutes:20,recommended:true},{mode:'walking',durationMinutes:35,recommended:false}
  ]}
]};
const plannedBefore=JSON.stringify(planned);
const generated=new JSDOM('<section class="route-timeline-card">'+renderDayNavigation(planned,places,dayNavigationSegments(planned,places))+'</section>',{runScripts:'outside-only',url:'https://example.test/'});
const doc=generated.window.document;
const preferenceTransfer=doc.querySelector('[data-route-segment-index="0"]');
assert.equal(preferenceTransfer.dataset.plannedDuration,'25');
assert.equal(preferenceTransfer.dataset.defaultDuration,undefined,'do not relabel the plan as an estimate for the preferred driving mode');
assert.match(preferenceTransfer.querySelector('.route-timeline-mode').textContent,/时长待核验/);
const summaryBefore=doc.querySelector('.route-timeline-summary').textContent;
generated.window.eval(runtime);generated.window.TravelGuideInteractions.initRouteSummary();
assert.equal(doc.querySelector('.route-timeline-summary').textContent,summaryBefore);
assert.match(summaryBefore,/已知移动 45分/);
doc.querySelector('button[data-navigation-mode="walking"]').click();
assert.match(doc.querySelector('.route-timeline-summary').textContent,/已知移动 1小时/,'retain 25 planned minutes and combine with the selected verified 35-minute option');
assert.equal(doc.querySelector('.route-arrival-estimate'),null,'query-only durations must not enable arrival recalculation');
assert.equal(JSON.stringify(planned),plannedBefore);
generated.window.close();
console.log("PASS route summary mode switching, time recalculation, recommendation badge, navigation launcher");
