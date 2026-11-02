#!/usr/bin/env node
const assert = require('node:assert/strict');
const { navigationModes, dayNavigationSegments, renderDayNavigation, renderDayRoute, calendarDescriptionSections } = require('./render-guide.js');
const modes = (s) => navigationModes(s).map((x) => x.mode);
assert.deepEqual(modes('AREX / 机场巴士'), ['transit']);
assert.deepEqual(modes('地铁 / 出租车'), ['transit', 'driving']);
assert.deepEqual(modes('出租车 / 步行'), ['driving', 'walking']);
assert.deepEqual(modes('公交'), ['transit']);
assert.deepEqual(modes('bus / walking'), ['transit', 'walking']);
assert.deepEqual(modes('突突车 / 渡轮'), ['tuktuk', 'ferry']);
assert.deepEqual(modes('摩托车 / 步行'), ['motorcycle', 'walking']);
assert.deepEqual(modes('长江索道 / 单轨'), ['cablecar', 'monorail']);
assert.deepEqual(modes('齿轨铁路 / 有轨电车'), ['mountainrail', 'tram']);
assert.deepEqual(modes('双条车 / 人力车'), ['minibus', 'rickshaw']);
assert.deepEqual(modes('飞机'), []);
assert.deepEqual(modes('待核验'), []);
const places = new Map(['airport', 'station', 'hotel', 'street', 'park', 'last'].map((id, i) => [id, { id, name: id, country: '韩国', coordinates: { latitude: 37 + i / 100, longitude: 127 } }]));
const day = { dayNumber: 1, accommodation: { startPlaceId: '', endPlaceId: 'hotel', label: 'hotel' }, items: [
  { placeId: 'airport', transportMode: '飞机', breakGroundRoute: true },
  { placeId: 'station', transportMode: 'AREX' },
  { placeId: 'hotel', transportMode: '地铁 / 出租车' },
  { placeId: 'hotel', transportMode: '步行' },
  { placeId: 'street', transportMode: '步行' },
  { placeId: 'park', transportMode: '飞机', breakGroundRoute: true },
  { placeId: 'last', transportMode: '公交' },
  { placeId: 'hotel', transportMode: '出租车' }
] };
let segments = dayNavigationSegments(day, places);
assert.deepEqual(segments.map(s => [s.from, s.to]), [['airport','station'],['station','hotel'],['hotel','street'],['park','last'],['last','hotel']]);
for (const segment of segments) for (const link of segment.links) {
  const url = new URL(link.url);
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('travelmode'), link.mode === 'bus' ? 'transit' : link.mode);
  assert(!url.searchParams.has('waypoints'));
  assert(url.searchParams.get('origin') && url.searchParams.get('destination'));
}
const html = renderDayNavigation(day, places, segments);
assert(html.includes('data-navigation-mode="transit"'));
const sections = calendarDescriptionSections(day, [], places, segments);
assert(sections.find(s => s.title === '路线').lines[0].startsWith('airport → station'));
assert(sections.find(s => s.title === '路线').lines[0].includes('路线断点'));
assert.equal(sections.find(s => s.title === '链接').lines.filter(l => l.startsWith('https://')).length, 4);
assert(html.includes('route-stop-row'));
assert(html.includes('route-timeline-summary'));
assert(html.includes('共 <b>7 个停靠点</b> · 已知移动 <b>暂无估算</b> · 终点 <b>hotel</b>'));
assert(html.includes('到达后定位导航'), '无住宿起点时应提供基于当前位置的导航入口');
assert(!html.includes('🚇 0分') && !html.includes('🚶‍♀️ 0分'), '未估算时长不得伪装为 0 分');
assert(html.includes('route-place-link'));
assert(html.includes('data-day-route-summary'));
assert(html.includes('路线断点'));
const isolatedDay = {dayNumber:1,items:[{placeId:'airport'}, {placeId:'hotel',breakGroundRoute:true}, {placeId:'street',transportMode:'步行',travelMinutes:15}]};
const isolatedHtml = renderDayNavigation(isolatedDay, places, dayNavigationSegments(isolatedDay,places));
assert(!isolatedHtml.includes('data-route-isolated'));
assert(!isolatedHtml.includes('data-copy="airport"'));
assert(!isolatedHtml.includes('路线断点'), 'no dangling boundary before first connected run');
assert(isolatedHtml.includes('15分'));
for (const emptyDay of [
  {dayNumber:1,items:[]},
  {dayNumber:1,items:[{placeId:'airport'}]},
  {dayNumber:1,items:[{placeId:'airport'},{placeId:'hotel',breakGroundRoute:true}]},
  {dayNumber:1,items:[{placeId:'hotel'},{placeId:'hotel',transportMode:'步行'}]}
]) {
  assert.equal(renderDayNavigation(emptyDay, places, dayNavigationSegments(emptyDay,places)), '');
  assert.equal(renderDayRoute(emptyDay, places), '');
}
assert(html.includes('travelmode=walking'));
assert(html.includes('data-navigation-mode="walking"'));
assert(sections.find(s => s.title === '交通').lines.some(l => l.includes('建议步行')));
const walkOnly = dayNavigationSegments({items:[{placeId:'hotel'},{placeId:'street',transportMode:'步行'}]}, places);
assert.equal(walkOnly[0].walking, true);
assert.deepEqual(walkOnly[0].links.map(link => link.mode), ['walking']);
assert.equal(walkOnly[0].reason, '');
const walkHtml = renderDayNavigation(day, places, walkOnly);
assert(walkHtml.includes('route-place-link'));
assert(walkHtml.includes('发起步行导航'));
const mixed = dayNavigationSegments({items:[{placeId:'hotel'},{placeId:'street',transportMode:'出租车 / 步行'}]}, places);
assert.equal(mixed[0].walking, false, '无独立方案时不得把混合描述推断为可导航的步行方案');
assert.deepEqual(mixed[0].links, [], '普通混合交通描述不得伪造多方案导航');
assert(mixed[0].reason.includes('交通方式待核验'));
places.get('station').navigationEnabled = false;
segments = dayNavigationSegments(day, places);
assert.equal(segments[0].links.length, 0);
assert.equal(segments[1].links.length, 0);
assert(!segments.some(s => s.from === 'airport' && s.to === 'hotel'), 'must not bridge disabled/missing stops');
places.get('last').coordinates.latitude = NaN;
assert.equal(dayNavigationSegments(day, places).at(-1).links.length, 0);
assert.deepEqual(dayNavigationSegments({ items: [], accommodation: {} }, places), []);
const unknown = dayNavigationSegments({items:[{placeId:'hotel'},{placeId:'street',transportMode:'未知'}]}, places);
assert.equal(unknown[0].links.length, 0);
assert(unknown[0].reason.includes('交通方式待核验'));
console.log('PASS segmented navigation: explicit modes, route timeline, all runs, endpoints, gaps, calendar');
const preferenceDay = {items:[{id:'origin',placeId:'hotel'},{id:'destination',placeId:'street',transportMode:'地铁 / 步行',travelMinutes:25,navigationMode:'driving'}]};
const preferred = dayNavigationSegments(preferenceDay, places);
assert.equal(preferred[0].walking, false);
assert.equal(preferred[0].transportMode, '驾车');
assert.equal(preferred[0].duration, '', 'do not relabel transit duration as driving duration');
assert.deepEqual(preferred[0].links.map(l=>l.mode), ['driving']);
assert.equal(preferred[0].links[0].label, '驾车导航');
assert.equal(preferenceDay.items[1].transportMode, '地铁 / 步行');
preferenceDay.items[1].navigationMode = 'walking';
const preferredWalk = dayNavigationSegments(preferenceDay, places);
assert.equal(preferredWalk[0].walking, true);
assert.equal(preferredWalk[0].links.length, 1);
assert.equal(preferredWalk[0].links[0].mode, 'walking');
preferenceDay.items[1].breakGroundRoute = true;
assert.equal(dayNavigationSegments(preferenceDay, places).length, 0, 'query preferences must not bridge flights');

const comparisonDay = {dayNumber:1,items:[
  {id:'origin',placeId:'hotel',startTime:'09:00',stayMinutes:20},
  {id:'destination',placeId:'street',startTime:'09:40',stayMinutes:30,transportMode:'驾车',travelMinutes:20,navigationOptions:[
    {mode:'driving',durationMinutes:20,recommended:true},
    {mode:'motorcycle',durationMinutes:12,recommended:false},
    {mode:'tuktuk',durationMinutes:16,recommended:false},
    {mode:'ferry',durationMinutes:25,recommended:false},
    {mode:'walking',durationMinutes:35,recommended:false}
  ]}
]};
const comparisonSegments = dayNavigationSegments(comparisonDay, places);
assert.deepEqual(comparisonSegments[0].options.map(option => option.mode), ['driving','motorcycle','tuktuk','ferry','walking']);
assert.equal(new URL(comparisonSegments[0].options[1].url).searchParams.has('travelmode'), false, 'do not fabricate unsupported Google motorcycle mode');
assert.equal(new URL(comparisonSegments[0].options[2].url).searchParams.has('travelmode'), false, 'do not fabricate unsupported Google tuktuk mode');
assert.equal(new URL(comparisonSegments[0].options[3].url).searchParams.has('travelmode'), false, 'do not fabricate unsupported Google ferry mode');
const comparisonHtml = renderDayNavigation(comparisonDay, places, comparisonSegments);
['🚗','🏍','🛺','⛴️','🚶‍♀️','data-route-mode-option','route-timeline-rec','发起驾车导航','data-action-label="查看突突车路线"','data-initial-minutes="540"'].forEach(marker => assert(comparisonHtml.includes(marker), marker));
assert(comparisonHtml.includes('共 <b>2 个停靠点</b> · 已知移动 <b>20分</b> · 终点 <b>street</b>'), '精确时间不应切换路线汇总的三事实结构');
assert.equal((comparisonHtml.match(/route-timeline-rec/g) || []).length, 1, 'recommended badge is data-owned');

const cablecarDay = {dayNumber:1,items:[
  {id:'origin',placeId:'hotel',startTime:'09:00',stayMinutes:20},
  {id:'destination',placeId:'street',startTime:'09:35',stayMinutes:30,transportMode:'长江索道',travelMinutes:15,navigationOptions:[
    {mode:'cablecar',durationMinutes:15,recommended:true},
    {mode:'walking',durationMinutes:50,recommended:false},
    {mode:'monorail',durationMinutes:28,recommended:false},
    {mode:'minibus',durationMinutes:24,recommended:false},
    {mode:'rickshaw',durationMinutes:35,recommended:false}
  ]}
]};
const cablecarSegments = dayNavigationSegments(cablecarDay, places);
assert.deepEqual(cablecarSegments[0].options.map(option => option.mode), ['cablecar','walking','monorail','minibus','rickshaw']);
assert(cablecarSegments[0].options.every(option => option.mode === 'walking' || !new URL(option.url).searchParams.has('travelmode')), 'special local modes must not fabricate Google travelmode');
const cablecarHtml = renderDayNavigation(cablecarDay, places, cablecarSegments);
['🚠','🚝','🚐','查看索道路线'].forEach(marker => assert(cablecarHtml.includes(marker), marker));

const repeatedPlaceDay = {dayNumber:1,items:[
  {id:'a',placeId:'hotel',startTime:'09:00',endTime:'09:30',transportMode:'walk',travelMinutes:0},
  {id:'b-arrival',placeId:'street',startTime:'10:00',endTime:'10:30',transportMode:'公交',travelMinutes:30},
  {id:'b-activity',placeId:'street',startTime:'10:30',endTime:'11:30',transportMode:'步行',travelMinutes:0,stayMinutes:60}
]};
const repeatedSegments = dayNavigationSegments(repeatedPlaceDay, places);
assert.equal(repeatedSegments.length, 1);
assert.equal(repeatedSegments[0].transportMode, '公交', '连续同地点活动不得覆盖首次抵达的交通方式');
assert.equal(repeatedSegments[0].durationMinutes, 30, '连续同地点活动不得覆盖入站耗时');
assert.equal(repeatedSegments[0].toNode.item.id, 'b-activity', '节点显示可使用后续活动时间');

const flexibleDay = {dayNumber:1,items:[
  {id:'origin',placeId:'hotel',startTime:'09:00',endTime:'09:30',transportMode:'walk',travelMinutes:0},
  {id:'flexible',placeId:'street',startTime:'',endTime:'',timeText:'大约 10:30 前',transportMode:'步行',travelMinutes:30}
]};
const flexibleHtml = renderDayNavigation(flexibleDay, places, dayNavigationSegments(flexibleDay, places));
assert(flexibleHtml.includes('大约 10:30 前'), '弹性时间保留原文展示');
assert(!flexibleHtml.includes('data-initial-minutes="630"'), '弹性 timeText 不得升格为确定时间');
assert(!flexibleHtml.includes('预计 <b>10:30</b>'), '弹性 timeText 不得进入到达时间重算');
