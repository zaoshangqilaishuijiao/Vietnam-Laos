#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const { requireJsdom } = require("./test-env.js");
const JSDOM = requireJsdom();
if (!JSDOM) {
  console.log("SKIP: jsdom 未安装，DOM 测试跳过（安装提示见上方 stderr）。");
  process.exit(0);
}

const root = path.resolve(__dirname, "..");
const baiduSource = fs.readFileSync(path.join(root, "assets", "baidu-route-map.js"), "utf8");
const googleSource = fs.readFileSync(path.join(root, "assets", "google-route-map.js"), "utf8");

const data = {
  places: [
    { id: "a", name: "起点", localName: "Start", coordinates: { latitude: 22.54, longitude: 114.06 } },
    { id: "b", name: "终点", localName: "End", coordinates: { latitude: 22.55, longitude: 114.08 } },
    { id: "c", name: "候选店", coordinates: { latitude: 22.545, longitude: 114.07 } }
  ],
  overview: null,
  days: [1,2].map(number => ({ key: `day-${number}`, dayNumber: number, runs: [[{ placeId: "a" }, { placeId: "b", mode: "walk", duration: "30分钟" }]], roadLegs: number === 1 ? [{fromPlaceId:"a",toPlaceId:"b",encodedPolyline:"_p~iF~ps|U_ulLnnqC_mqNvxq`@"}] : [], candidates: [{ placeId: "c" }] }))
};

function dom() {
  return new JSDOM('<!doctype html><body><div id=overlay class=is-visible></div><div id=status></div><div id=map></div><input type=checkbox data-nearby-switch><button data-day-tab=1 aria-selected=true></button><button data-day-tab=2 aria-selected=false></button><article class=day><span data-place-id=a></span><span data-place-id=b></span></article><div data-nearby-panel="day-1"><article data-nearby-card="c"></article></div><div data-nearby-panel="day-2"><article data-nearby-card="c"></article></div></body>', { runScripts: "outside-only", url: "http://127.0.0.1/" });
}

async function testBaidu() {
  const page = dom(); const { window } = page; const overlays = [];
  let constructions = 0;
  let scrollBehavior = "";
  window.matchMedia = () => ({ matches: true });
  window.document.querySelector('[data-place-id="a"]').scrollIntoView = (options) => { scrollBehavior = options.behavior; };
  class MapMock {
    constructor() { this.zoom = 12; this.events = {}; constructions++; }
    enableScrollWheelZoom() {}
    addOverlay(value) { overlays.push(value); }
    clearOverlays() { overlays.length = 0; }
    removeOverlay(overlay) { const i = overlays.indexOf(overlay); if (i >= 0) overlays.splice(i, 1); }
    setViewport() { queueMicrotask(() => this.events.tilesloaded?.()); }
    centerAndZoom() {}
    getZoom() { return this.zoom; }
    addEventListener(name, callback) { this.events[name] = callback; }
    openInfoWindow() {}
  }
  class Point { constructor(lng, lat) { this.lng = lng; this.lat = lat; } }
  class Marker { constructor() { this.events = {}; } setTitle(value) { this.title = value; } addEventListener(name, callback) { this.events[name] = callback; } dispatchEvent(name) { this.events[name]?.(); } }
  class Label { setStyle() {} show() {} hide() {} }
  class Polyline {}
  class Size {}
  class InfoWindow {}
  window.BMAP_COORD_WGS84 = 1;
  window.BMapGL = { Map: MapMock, Point, Marker, Label, Polyline, Size, InfoWindow };
  window.eval(baiduSource);
  const result = await window.TravelBaiduRouteMap.start({
    data, root: window.document.getElementById("map"), status: window.document.getElementById("status"),
    overlay: window.document.getElementById("overlay"), tileTimeoutMs: 100
  });
  if (result.provider !== "baidu") throw new Error("百度适配器 provider 错误");
  if (overlays.filter((item) => item instanceof Marker).length !== 2) throw new Error("百度 Marker 数量错误");
  if (overlays.filter((item) => item instanceof Polyline).length !== 2) throw new Error("百度道路描边与主线数量错误");
  overlays.find((item) => item instanceof Marker)?.dispatchEvent("click");
  if (scrollBehavior !== "auto") throw new Error("百度 Marker 定位未遵循减少动效偏好");
  if (window.document.getElementById("overlay").classList.contains("is-visible")) throw new Error("百度加载完成后遮罩未移除");
  assert.strictEqual(await window.TravelBaiduRouteMap.start({ data, root: window.document.getElementById("map") }), result);
  const toggle = window.document.querySelector('[data-nearby-switch]');
  toggle.checked = true;
  window.document.dispatchEvent(new window.CustomEvent('guide:nearby-toggle', { detail: { visible: true, key: 'day-1' } }));
  assert.equal(overlays.filter(item => item instanceof Marker).length, 3);
  const cards = [...window.document.querySelectorAll('[data-nearby-card]')];
  cards.forEach(card => card.scrollIntoView = options => { scrollBehavior = options.behavior; });
  window.document.dispatchEvent(new window.CustomEvent('guide:focus-nearby', { detail: { placeId: 'c', dayNumber: 1 } }));
  assert.equal(cards[0].classList.contains('is-active'), true, '卡片聚焦不应依赖地图 SDK 的模拟 click');
  overlays.find(item => item.title === '候选店').dispatchEvent('click');
  assert.equal(cards[0].classList.contains('is-active'), true); assert.equal(cards[1].classList.contains('is-active'), false); assert.equal(scrollBehavior, 'auto');
  window.document.dispatchEvent(new window.CustomEvent('guide:day-change', { detail: { dayNumber: 2 } }));
  assert.equal(overlays.filter(item => item instanceof Polyline).length, 0, '缺道路时不得画直线');
  assert.match(window.document.getElementById('status').textContent, /尚未核实/);
  overlays.find(item => item.title === '候选店').dispatchEvent('click');
  assert.equal(cards[0].classList.contains('is-active'), false); assert.equal(cards[1].classList.contains('is-active'), true);
  toggle.checked = false;
  window.document.dispatchEvent(new window.CustomEvent('guide:nearby-toggle', { detail: { visible: false, key: 'day-2' } }));
  assert.equal(overlays.filter(item => item instanceof Marker).length, 2);
  assert.equal(constructions, 1);
  result.destroy();
  await window.TravelBaiduRouteMap.start({ data, root: window.document.getElementById('map'), status: window.document.getElementById('status') });
  assert.equal(constructions, 2, 'destroy 后应可重新初始化');
  page.window.close();
}

async function testGoogle() {
  const page = dom(); const { window } = page; const markers = []; const lines = [];
  let constructions=0;const eventHandlers={};
  let scrollBehavior = "";
  window.matchMedia = () => ({ matches: true });
  window.document.querySelector('[data-place-id="a"]').scrollIntoView = (options) => { scrollBehavior = options.behavior; };
  class MapMock {
    constructor(_root, options) { this.zoom = 12; this.options = options; constructions++; }
    fitBounds() {}
    setCenter() {}
    getZoom() { return this.zoom; }
    panTo() {}
  }
  class Marker { constructor(options) { this.options = options; this.listeners = {}; markers.push(this); } addListener(name, callback) { this.listeners[name] = callback; } setVisible(value) { this.visible=value; } setMap(value) { this.map=value; } setIcon(value) { this.icon=value; } }
  class Polyline { constructor(options) { this.options = options; lines.push(this); } setMap(value) { this.map=value; } }
  class LatLngBounds { extend() {} getCenter() { return { lat: 22.545, lng: 114.07 }; } }
  class InfoWindow { open() {} close() {} setContent() {} }
  const event = {
    addListener(_target,name,callback){eventHandlers[name]=callback;return {}},
    addListenerOnce(_target, name, callback) { if (name === "tilesloaded" || name === "idle") queueMicrotask(callback); return {}; },
    removeListener() {}
  };
  window.google = { maps: { Map: MapMock, Marker, Polyline, LatLngBounds, InfoWindow, SymbolPath: { CIRCLE: 0 }, event } };
  window.eval(googleSource);
  const result = await window.TravelGoogleRouteMap.start({
    data, root: window.document.getElementById("map"), status: window.document.getElementById("status"),
    overlay: window.document.getElementById("overlay"), timeoutMs: 100, tileTimeoutMs: 100
  });
  if (!result.map.options.styles?.length || result.map.options.clickableIcons !== false) throw Error("Google 地图应使用安静浅色底图");
  if (result.provider !== "google") throw new Error("Google 适配器 provider 错误");
  if (markers.filter((item) => item.options.title && item.options.map).length !== 2) throw new Error("Google Marker 数量错误");
  if (lines.length !== 2) throw new Error("Google 道路描边与主线数量错误");
  markers.find((item) => item.options.title)?.listeners.click?.();
  if (scrollBehavior !== "auto") throw new Error("Google Marker 定位未遵循减少动效偏好");
  const hiddenDay=window.document.querySelector('.day'); hiddenDay.dataset.dayPanel="3"; hiddenDay.hidden=true;
  const dayTab=window.document.createElement('button');dayTab.dataset.dayTab="3";dayTab.onclick=()=>{hiddenDay.hidden=false};window.document.body.append(dayTab);
  markers.find(item=>item.options.title)?.listeners.click?.();
  if(hiddenDay.hidden)throw Error("地图点击必须先打开隐藏日期");

  if (window.document.getElementById("overlay").classList.contains("is-visible")) throw new Error("Google 加载完成后遮罩未移除");
  assert.strictEqual(await window.TravelGoogleRouteMap.start({ data, root: window.document.getElementById("map") }), result);
  const toggle = window.document.querySelector('[data-nearby-switch]'); toggle.checked = true;
  window.document.dispatchEvent(new window.CustomEvent('guide:nearby-toggle', { detail: { visible: true, key: 'day-1' } }));
  const cards = [...window.document.querySelectorAll('[data-nearby-card]')];
  cards.forEach(card => card.scrollIntoView = options => { scrollBehavior = options.behavior; });
  markers.find(item => item.options.title === '候选店' && item.map).listeners.click();
  assert.equal(cards[0].classList.contains('is-active'), true); assert.equal(cards[1].classList.contains('is-active'), false); assert.equal(scrollBehavior, 'auto');
  window.document.dispatchEvent(new window.CustomEvent('guide:day-change', { detail: { dayNumber: 2 } }));
  assert.equal(lines.filter(line => line.map !== null).length, 0, '缺道路时不得画直线');
  assert.match(window.document.getElementById('status').textContent, /尚未核实/);
  markers.findLast(item => item.options.title === '候选店' && item.map).listeners.click();
  assert.equal(cards[0].classList.contains('is-active'), false); assert.equal(cards[1].classList.contains('is-active'), true);
  toggle.checked = false;
  window.document.dispatchEvent(new window.CustomEvent('guide:nearby-toggle', { detail: { visible: false, key: 'day-2' } }));
  assert.equal(markers.filter(item => item.options.title === '候选店' && item.map).length, 0);
  for(let i=0;i<30;i++)window.document.dispatchEvent(new window.CustomEvent('guide:day-change',{detail:{dayNumber:i%2+1}}));
  if(constructions!==1)throw Error("切日不得重建地图实例");
  result.destroy();
  await window.TravelGoogleRouteMap.start({ data, root: window.document.getElementById('map'), status: window.document.getElementById('status') });
  assert.equal(constructions, 2, 'destroy 后应可重新初始化');
  page.window.close();
}

Promise.all([testBaidu(), testGoogle()])
  .then(() => console.log("PASS Baidu/Google map runtime smoke"))
  .catch((error) => { console.error(error.stack || error.message); process.exit(1); });
