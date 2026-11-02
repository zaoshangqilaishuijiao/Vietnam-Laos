#!/usr/bin/env node
// Export existing place coordinates to Pinbook; never calls a remote API.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const quote = value => JSON.stringify(String(value)); // JSON strings are valid YAML scalars.
function parseOptions(args) {
  const options = {};
  for (const arg of args) {
    const match = /^--(input|output|country|limit|scope)=(.*)$/.exec(arg);
    if (!match) throw Error(`未知参数：${arg}`);
    options[match[1]] = match[2];
  }
  if (!options.input || !options.output) throw Error('用法：node scripts/export-pinbook-map.js --input=trip-data.json --output=outputs/my-map [--country=老挝] [--limit=6] [--scope=itinerary|nearby|recommended|all]');
  if (options.scope && !['itinerary', 'nearby', 'recommended', 'all'].includes(options.scope)) throw Error('--scope 仅支持 itinerary、nearby、recommended 或 all');
  if (options.limit !== undefined && (!/^\d+$/.test(options.limit) || Number(options.limit) < 1)) throw Error('--limit 必须是正整数');
  return options;
}
function validCoordinates(place) {
  const { latitude, longitude } = place.coordinates || {};
  return typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}
function collectPlaceUses(data) {
  const uses = new Map();
  const record = (id, role, dayNumber, detail) => {
    if (!id) return;
    if (!uses.has(id)) uses.set(id, { roles: new Set(), days: { itinerary: new Set(), nearby: new Set() }, reasons: { nearby: '', recommended: '' }, icon: '' });
    const use = uses.get(id);
    use.roles.add(role);
    if (Number.isInteger(dayNumber) && use.days[role]) use.days[role].add(dayNumber);
    if (detail?.reason && use.reasons[role] === '') use.reasons[role] = detail.reason;
    if (detail?.icon && !use.icon) use.icon = detail.icon;
  };
  const recommendations = new Map((data.recommendations || []).map(item => [item.id, item]));
  const venues = new Map((data.venueSuggestions || []).map(item => [item.id, item]));
  const iconForTarget = target => {
    if (target?.kind === 'cafe') return 'places-cafe';
    if (target?.kind === 'restaurant' || target?.category === '餐饮指南') return 'places-restaurant';
    if (target?.kind === 'shop') return 'places-shop';
    if (target?.category === '景点指南') return 'places-viewpoint';
    return '';
  };
  for (const day of data.days || []) {
    for (const item of day.items || []) record(item.placeId, 'itinerary', day.dayNumber);
    record(day.accommodation?.startPlaceId, 'itinerary', day.dayNumber);
    record(day.accommodation?.endPlaceId, 'itinerary', day.dayNumber, { icon: 'places-hotel' });
  }
  // Venue kind identifies a specific cafe/restaurant/shop more precisely than a broad recommendation category.
  for (const target of [...venues.values(), ...recommendations.values()]) {
    record(target.placeId, 'recommended', null, { reason: target.reason, icon: iconForTarget(target) });
  }
  for (const day of data.nearbyDays || []) {
    if (day.status && day.status !== 'show') continue;
    for (const candidate of day.candidates || []) {
      const target = candidate.targetType === 'recommendation' ? recommendations.get(candidate.targetId)
        : candidate.targetType === 'venueSuggestion' ? venues.get(candidate.targetId) : null;
      if (target) record(target.placeId, 'nearby', day.dayNumber, { reason: candidate.whyNow, icon: iconForTarget(target) });
    }
  }
  return uses;
}
function selectPlaces(data, options) {
  const uses = collectPlaceUses(data);
  const scope = options.scope || 'itinerary';
  const included = place => {
    const roles = uses.get(place.id)?.roles;
    return scope === 'all' || roles?.has('itinerary') ||
      (scope === 'nearby' && roles?.has('nearby')) ||
      (scope === 'recommended' && (roles?.has('nearby') || roles?.has('recommended')));
  };
  const seen = new Set();
  const candidates = (data.places || []).filter(place => {
    if (!included(place) || (options.country && place.country !== options.country) || seen.has(place.id)) return false;
    seen.add(place.id);
    return true;
  });
  const skipped = candidates.filter(place => !validCoordinates(place));
  const selected = candidates.filter(validCoordinates).slice(0, options.limit ? Number(options.limit) : undefined);
  return { selected, skipped };
}
function renderYaml(data, places) {
  const uses = collectPlaceUses(data);
  const styles = {
    itinerary: { title: '正式行程', color: 'teal-600' },
    nearby: { title: '附近逛逛', color: 'orange-600' },
    recommended: { title: '其他推荐', color: 'blue-600' },
    other: { title: '地点库其他地点', color: 'gray-600' }
  };
  const roleOf = place => ['itinerary', 'nearby', 'recommended'].find(role => uses.get(place.id)?.roles.has(role)) || 'other';
  const layerNames = Object.keys(styles).filter(role => places.some(place => roleOf(place) === role));
  const lines = [
    'map:', `  title: ${quote(data.meta?.title || '旅行地点')}`, '  description: "从旅行攻略地点库导出；请在 Google My Maps 中核验点位。"', '',
    'layers:', ...layerNames.flatMap(role => [`  - id: ${role}`, `    title: ${quote(styles[role].title)}`]), '', 'pins:'
  ];
  for (const place of places) {
    const role = roleOf(place);
    const use = uses.get(place.id);
    const days = type => [...(use?.days[type] || [])].sort((a, b) => a - b).map(day => `D${day}`).join('、');
    const description = [place.city, place.country, place.localName && place.localName !== place.name ? place.localName : '',
      days('itinerary') && `正式行程 ${days('itinerary')}`, days('nearby') && `附近逛逛 ${days('nearby')}`,
      role === 'nearby' || role === 'recommended' ? use?.reasons[role] : '', place.verificationStatus || ''].filter(Boolean).join(' · ');
    lines.push(`  - id: ${quote(place.id)}`, `    title: ${quote(place.name || place.searchName || place.id)}`,
      `    coords: [${place.coordinates.latitude}, ${place.coordinates.longitude}]`, `    layer: ${role}`,
      `    color: ${styles[role].color}`, `    icon: ${use?.icon || 'shapes-pin'}`);
    if (description) lines.push(`    description: ${quote(description)}`);
  }
  return `${lines.join('\n')}\n`;
}
function exportMap(options) {
  const input = path.resolve(options.input);
  const output = path.resolve(options.output);
  const data = JSON.parse(fs.readFileSync(input, 'utf8'));
  const { selected, skipped } = selectPlaces(data, options);
  if (!selected.length) throw Error('没有符合条件且带有效坐标的地点，未生成地图');
  if (input === path.join(output, 'index.yaml') || input.startsWith(`${output}${path.sep}`)) throw Error('输出目录不能包含输入文件');
  fs.mkdirSync(output, { recursive: true });
  const configPath = path.join(output, 'index.yaml');
  fs.writeFileSync(configPath, renderYaml(data, selected));
  const bin = path.join(root, 'tools/pinbook/node_modules/pinbook/bin/pinbook.js');
  if (!fs.existsSync(bin)) throw Error('Pinbook 未安装：先在 tools/pinbook 运行 pnpm install');
  const result = spawnSync(process.execPath, [bin, 'build', configPath], { cwd: output, encoding: 'utf8' });
  if (result.status !== 0) throw Error(`Pinbook 构建失败：${result.stderr || result.stdout}`);
  const kmlPath = path.join(output, '.pinbook/map.kml');
  console.log(`已导出 ${selected.length} 个地点：${configPath}\nKML：${kmlPath}`);
  if (skipped.length) console.log(`跳过 ${skipped.length} 个无有效坐标地点：${skipped.map(place => place.id).join('、')}`);
  return { configPath, kmlPath, count: selected.length, skipped: skipped.map(place => place.id) };
}
if (require.main === module) {
  try { exportMap(parseOptions(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { parseOptions, collectPlaceUses, selectPlaces, renderYaml, exportMap };
