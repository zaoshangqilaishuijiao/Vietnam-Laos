const assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
async function check(provider) {
  const dom = new JSDOM('<div id="map"></div><button data-day-tab="1" aria-selected="true"></button><input data-nearby-switch type="checkbox"><div data-nearby-panel="day-1"><article data-nearby-card="c"></article></div>', { runScripts: 'outside-only', url: 'http://127.0.0.1:8766/' });
  const w = dom.window;
  let ready, pans = 0, clears = 0, fits = 0;
  class MapMock {
    constructor() { this.events = {}; }
    fitBounds() { fits++; } setViewport() { fits++; }
    panTo() { pans++; } centerAndZoom() { pans++; }
    enableScrollWheelZoom() {} getZoom() { return 13; }
    addOverlay() {} removeOverlay() {} clearOverlays() { clears++; }
    addEventListener(name, callback) { this.events[name] = callback; if (name === 'tilesloaded') ready = callback; }
    openInfoWindow() {} closeInfoWindow() {}
  }
  class Marker { addListener() {} addEventListener() {} setMap() {} setIcon() {} setTitle() {} }
  class Bounds { extend() {} }
  class Info { close() {} setContent() {} open() {} }
  w.google = { maps: { Map: MapMock, Marker, LatLngBounds: Bounds, InfoWindow: Info, SymbolPath: { CIRCLE: 0 }, event: { addListenerOnce(_map, name, callback) { if (name === 'tilesloaded') ready = callback; return {}; }, removeListener() {} } } };
  w.BMapGL = { Map: MapMock, Marker, Point: class { constructor(lng, lat) { this.lng = lng; this.lat = lat; } }, Size: class {}, InfoWindow: Info };
  const data = { places: ['a', 'b', 'c'].map((id, i) => ({ id, name: id, coordinates: { latitude: 31 + i * .001, longitude: 121 } })), days: [{ key: 'day-1', dayNumber: 1, runs: [[{ placeId: 'a' }, { placeId: 'b' }]], candidates: [{ placeId: 'c' }] }] };
  w.eval(fs.readFileSync(path.join(__dirname, `../assets/${provider}-route-map.js`), 'utf8'));
  const api = provider === 'google' ? w.TravelGoogleRouteMap : w.TravelBaiduRouteMap;
  const start = () => api.start({ data, root: w.document.querySelector('#map') });
  const emit = (name, detail) => w.document.dispatchEvent(new w.CustomEvent(name, { detail }));
  const pending = start();
  // Before even JSAPI has resolved, not just after tiles listener registration.
  emit('guide:focus-nearby', { dayNumber: 1, placeId: 'c' });
  await new Promise(resolve => setImmediate(resolve));
  ready();
  const controller = await pending;
  assert.ok(pans > 0, provider + ': loading click replayed');
  assert.ok(w.document.querySelector('[data-nearby-card]').classList.contains('is-active'));
  const baseline = { fits, clears };
  for (const visible of [false, true, false]) emit('guide:nearby-toggle', { key: 'day-1', visible });
  assert.deepEqual({ fits, clears }, baseline, provider + ': toggle preserves formal overlays and viewport');
  controller.destroy();
  const before = pans;
  emit('guide:focus-nearby', { dayNumber: 1, placeId: 'c' });
  assert.equal(pans, before, 'destroy removes listeners');
  const rebuilt = start();
  emit('guide:focus-nearby', { dayNumber: 1, placeId: 'c' });
  await new Promise(resolve => setImmediate(resolve)); ready();
  (await rebuilt).destroy();
  dom.window.close();
}
(async () => { await check('google'); await check('baidu'); console.log('PASS queued map intent, incremental candidates and destroy/rebuild for both engines'); })().catch(error => { console.error(error); process.exitCode = 1; });
