#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseOptions, selectPlaces, renderYaml, exportMap } = require('./export-pinbook-map.js');

const place = (id, latitude, country = '老挝') => ({ id, name: id, city: '万象', country,
  coordinates: latitude === null ? null : { latitude, longitude: 102.6 }, verificationStatus: '已核验' });
const data = {
  meta: { title: '测试攻略' },
  places: [place('hotel', 17.9), place('museum', 17.91), place('cafe', 17.92),
    place('shop', 17.93), place('unused', 17.94), place('no-coords', null), place('hidden', 17.95)],
  days: [
    { dayNumber: 1, items: [{ placeId: 'museum' }], accommodation: { startPlaceId: 'hotel', endPlaceId: 'hotel' } },
    { dayNumber: 2, items: [{ placeId: 'museum' }], accommodation: { startPlaceId: 'hotel' } }
  ],
  recommendations: [
    { id: 'cafe-rec', placeId: 'cafe', category: '餐饮指南', reason: '下午休息' },
    { id: 'shop-rec', placeId: 'shop', category: '当地体验', reason: '可以买手工艺品' },
    { id: 'missing-rec', placeId: 'no-coords', category: '景点指南', reason: '待核坐标' },
    { id: 'hidden-rec', placeId: 'hidden', category: '景点指南', reason: '未采用' }
  ],
  venueSuggestions: [{ id: 'cafe-venue', placeId: 'cafe', kind: 'cafe' }],
  nearbyDays: [
    { dayNumber: 1, status: 'show', candidates: [{ targetType: 'recommendation', targetId: 'cafe-rec', whyNow: '午后正好休息' }] },
    { dayNumber: 2, status: 'show', candidates: [{ targetType: 'venueSuggestion', targetId: 'cafe-venue', whyNow: '返程前休息' }] },
    { dayNumber: 3, status: 'hide-no-free-window', candidates: [{ targetType: 'recommendation', targetId: 'hidden-rec' }] }
  ]
};
const ids = scope => selectPlaces(data, { scope }).selected.map(item => item.id);
assert.deepEqual(ids('itinerary'), ['hotel', 'museum']);
assert.deepEqual(ids('nearby'), ['hotel', 'museum', 'cafe']);
assert.deepEqual(ids('recommended'), ['hotel', 'museum', 'cafe', 'shop', 'hidden']);
assert.deepEqual(ids('all'), ['hotel', 'museum', 'cafe', 'shop', 'unused', 'hidden']);
assert.deepEqual(selectPlaces(data, { scope: 'recommended' }).skipped.map(item => item.id), ['no-coords']);
assert.deepEqual(selectPlaces(data, { scope: 'nearby', limit: '2' }).selected.map(item => item.id), ['hotel', 'museum']);
assert.deepEqual(selectPlaces(data, { scope: 'nearby', country: '越南' }).selected, []);
assert.throws(() => parseOptions(['--input=in.json', '--output=out', '--scope=unknown']), /scope/);

const yaml = renderYaml(data, selectPlaces(data, { scope: 'all' }).selected);
assert.equal((yaml.match(/^  - id: "cafe"$/gm) || []).length, 1, '跨日、跨推荐类型的同一地点只生成一个图钉');
assert.match(yaml, /layer: itinerary/);
assert.match(yaml, /layer: nearby/);
assert.match(yaml, /layer: recommended/);
assert.match(yaml, /layer: other/);
assert.match(yaml, /正式行程 D1、D2/);
assert.match(yaml, /附近逛逛 D1、D2/);
assert.match(yaml, /午后正好休息/);
assert.match(yaml, /icon: places-hotel/);
assert.match(yaml, /icon: places-cafe/);
assert.doesNotMatch(yaml, /photo:/, '本地图片不能被伪装成 Pinbook 远端 URL');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-guide-pinbook-test-'));
const input = path.join(temp, 'trip-data.json');
fs.writeFileSync(input, JSON.stringify(data));
const built = exportMap({ input, output: path.join(temp, 'my-maps'), scope: 'nearby' });
assert.equal(built.count, 3);
assert.match(fs.readFileSync(built.kmlPath, 'utf8'), /<Placemark>/);
assert.doesNotMatch(fs.readFileSync(built.kmlPath, 'utf8'), /<name>unused<\/name>/);
console.log('PASS Pinbook 地点范围、去重、图层与缺坐标规则');
