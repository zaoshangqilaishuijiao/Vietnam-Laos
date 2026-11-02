#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { renderHeroHub } = require('./render-guide');
const { PAGE_TEMPLATE_VERSION } = require('./shared-constants');
const css = fs.readFileSync(path.join(__dirname, '../assets/guide-shell.css'), 'utf8');

const data = {
  meta: {
    title: 'oo & Boss Zhu 的欧洲之旅', destination: '法国 · 瑞士 · 意大利 · 西班牙',
    dates: Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 8, 24 + i)).toISOString().slice(0, 10)),
    dateDisplay: '日期待定', travelers: { count: 2 }, theme: 'burgundy', hero: { title: '山湖入秋', subtitle: '从少女峰与高山湖泊出发，经提契诺和意大利北部，以巴黎收束紧凑的秋日山水路线。', kicker: '不能改写', cover: { src: 'images/cover.jpg', alt: '欧洲城市封面' } }
  },
  days: Array.from({ length: 14 }, (_, i) => ({ dayNumber: i + 1 }))
};
const cover = input => new JSDOM(renderHeroHub(input)).window.document.querySelector('header');
const check = input => {
  const header = cover(input);
  assert.ok(header.classList.contains('hero-cover'));
  assert.deepEqual(Array.from(header.children, n => n.className), ['hero-cover-image', 'hero-cover-shade', 'hero-cover-frame']);
  assert.ok(header.querySelector('.hero-cover-header + .hero-cover-copy'));
  assert.ok(header.querySelector('.hero-cover-copy + .hero-cover-footer'));
  assert.equal(header.querySelector('.hero-facts, .hero-roast, .hero-roast-list, aside'), null);
  assert.equal(header.querySelector('input, .hero-meta, .hero-highlights'), null);
  assert.equal(header.querySelector('a, [data-resume-day], .hero-cover-credit, .hero-execution-link'), null);
  assert.equal(header.querySelectorAll('button').length, 1);
  assert.ok(header.querySelector('[data-guide-theme-launcher][aria-controls="guide-theme-popover"]'));
  assert.equal(header.querySelector('[data-guide-theme-current]').textContent, input.meta.theme === 'burgundy' ? '勃艮第' : '海岸蓝');
  assert.doesNotMatch(header.querySelector('.hero-cover-header').textContent, /法国|瑞士|意大利|西班牙/);
  assert.equal(header.querySelector('.hero-cover-image').getAttribute('src'), input.meta.hero?.cover?.src || null);
  return header;
};
assert.equal(check(data).querySelector('.hero-kicker').textContent, 'ITINERARY');
assert.equal(check(data).querySelector('h1').textContent, '山湖入秋');
assert.ok(check(data).querySelector('.hero-subtitle').textContent.includes('以巴黎收束'));
assert.deepEqual(Array.from(check(data).querySelectorAll('.hero-cover-facts dt'), node => node.textContent), ['日期', '目的地', '天数']);
assert.match(check(data).querySelector('.hero-cover-facts').textContent, /2026\.09\.24 — 10\.07/);
assert.match(check(data).querySelector('.hero-cover-facts').textContent, /14 天/);
assert.doesNotMatch(check(data).textContent, /路线、预订与现场判断/);
assert.doesNotMatch(check(data).textContent, /查看行程|图片[：:]/);
assert.match(css, /\.hero-kicker\s*\{[^}]*font-size:\s*11px;[^}]*letter-spacing:\s*\.2em;/s);
assert.match(css, /\.hero-hub h1\s*\{[^}]*font-size:\s*clamp\(56px,\s*8vw,\s*112px\);[^}]*line-height:\s*\.92;[^}]*letter-spacing:\s*-\.07em;/s);
assert.match(css, /\.hero-subtitle\s*\{[^}]*max-width:\s*650px;[^}]*font-size:\s*17px;[^}]*line-height:\s*1\.9;/s);
assert.match(css, /\.hero-cover\s*\{[^}]*height:\s*100vh;[^}]*height:\s*100svh;[^}]*height:\s*100dvh;[^}]*min-height:\s*100vh;[^}]*min-height:\s*100svh;[^}]*min-height:\s*100dvh;/s);
assert.match(css, /@media \(max-width:\s*560px\)\s*\{[^}]*\.hero-hub h1\s*\{\s*font-size:\s*clamp\(34px,\s*10\.8vw,\s*46px\);\s*line-height:\s*\.96;/s);
const single = structuredClone(data); single.meta.dates = ['2026-09-24']; single.days = [{}];
const escaped = structuredClone(data); escaped.meta.hero.title = '<标题> & 旅行'; escaped.meta.hero.subtitle = '<路线> & 收束';
assert.equal(check(escaped).querySelector('h1').textContent, '<标题> & 旅行');
assert.equal(check(escaped).querySelector('.hero-subtitle').textContent, '<路线> & 收束');
assert.equal(check(escaped).querySelector('.hero-cover-image').getAttribute('alt'), '欧洲城市封面');

// 2.38.2 封面日期区间修复：跨年补全年份、非连续日期不显示连续区间
const crossYear = structuredClone(data);
crossYear.meta.dates = ['2026-12-28', '2026-12-29', '2027-01-03'];
crossYear.meta.datePolicy = 'fixed';
crossYear.days = [{}, {}, {}];
assert.match(check(crossYear).querySelector('.hero-cover-facts').textContent, /2026\.12\.28 — 2027\.01\.03/);
const explicitDates = structuredClone(data);
explicitDates.meta.dates = ['2026-09-24', '2026-10-07'];
explicitDates.meta.datePolicy = 'explicit';
explicitDates.meta.dateDisplay = '';
explicitDates.days = [{}, {}];
assert.match(check(explicitDates).querySelector('.hero-cover-facts').textContent, /指定日期行程/);
assert.doesNotMatch(check(explicitDates).querySelector('.hero-cover-facts').textContent, /09\.24 — 10\.07/);

const outputDir = process.argv.find(arg => arg.startsWith('--preview-dir='))?.slice('--preview-dir='.length);
if (outputDir) {
  const dir = path.resolve(outputDir);
  fs.mkdirSync(dir, { recursive: true });
  const previews = { index: data, single, 'long-content': escaped };
  const long = structuredClone(data); long.meta.hero.title = '同行伙伴的城市、山湖与海岸慢游手册';
  long.meta.hero.subtitle = '从第一站出发，依次经过山湖、城市与海岸，最后在终点收束。'.repeat(3);
  previews['long-content'] = long;
  for (const [name, input] of Object.entries(previews)) {
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>首页模板 ${PAGE_TEMPLATE_VERSION} · 本地验收</title><style>${css}</style></head><body class="guide-page">${renderHeroHub(input)}</body></html>`;
    fs.writeFileSync(path.join(dir, name + '.html'), html);
  }
  console.log('Preview: ' + dir);
}
console.log('PASS fixed hero structure, editorial typography, legacy-field hiding and text escaping');
