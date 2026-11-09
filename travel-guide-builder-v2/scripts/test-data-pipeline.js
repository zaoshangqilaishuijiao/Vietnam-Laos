#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { PAGE_TEMPLATE_VERSION } = require("./shared-constants.js");

const skillRoot = path.resolve(__dirname, "..");
const validator = path.join(skillRoot, "scripts", "validate-trip-data.js");
const renderer = path.join(skillRoot, "scripts", "render-guide.js");
const summarizer = path.join(skillRoot, "scripts", "summarize-trip-brief.js");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "travel-guide-v2-"));
const features = { arrivalDeparture: false, exchange: false, weather: false, sourceIndex: true, dayMap: true, dayNavigation: true, calendarExport: true, expenseTracker: true };
const meta = { title: "测试城市执行攻略", subtitle: "2.0 回归", destination: "测试城市", origin: "上海", datePolicy: "fixed", dates: ["2026-09-01"], dateDisplay: "2026年9月1日", travelers: { count: 1, profiles: ["成人"] }, budgetBasis: "单人 CNY", theme: "ink", routeSummary: "中央车站 → 城市公园", hero: { title: "城园初行", subtitle: "从中央车站出发，经城市街区步行前往城市公园，以轻量城市漫步收束。", cover: { src: "images/cover.jpg", alt: "测试城市封面" } } };
const requirements = { mustVisit: ["城市公园"], avoid: [], preferences: ["步行"], constraints: [], assumptions: [], openQuestions: [] };
const researchPlan = { xiaohongshuTarget: 10, arrivalDepartureTarget: 0, officialTopics: ["交通"] };
const sources = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, type: "xiaohongshu", scope: "general", title: `测试笔记 ${index + 1}`, url: `https://www.xiaohongshu.com/explore/test-note-${index + 1}`, topics: ["城市"], cities: ["测试城市"], verificationStatus: "游客经验", reading: { topic: "景点与文化", title: `城市参观指南 ${index + 1}`, value: `补充展览背景与建筑细节 ${index + 1}` } }));
const audit = { status: "completed", xiaohongshuRequiredCount: 10, xiaohongshuReadCount: 10, arrivalDepartureRequiredCount: 0, arrivalDepartureReadCount: 0, xiaohongshuShortfallReason: "", arrivalDepartureShortfallReason: "不适用" };

const request = { schemaVersion: "2.0", stage: "request", meta, features, requirements, researchPlan };
const brief = { schemaVersion: "2.0", stage: "brief", meta, features, requirements, researchPlan, route: { summary: meta.routeSummary, stops: [{ name: "中央车站" }, { name: "城市公园" }] }, dayOutline: [{ dayNumber: 1, date: "2026-09-01", city: "测试城市", theme: "抵达与城市漫步" }], researchSources: sources.map(({ verificationStatus, ...source }) => source), researchAudit: audit, confirmation: { status: "skipped", note: "测试明确模拟用户已授权直接做完网页、无需中途确认。" } };
const content = {
  schemaVersion: "2.0", stage: "content", meta, features,
  calendar: { mode: "daily" },
  places: [
    { id: "central-station", name: "中央车站", localName: "Central Station", searchName: "Central Station", city: "测试城市", country: "测试国", address: "中心路1号", coordinates: { latitude: 31.23, longitude: 121.47 }, verificationStatus: "已核验", sourceIds: [1] },
    { id: "city-park", name: "城市公园", localName: "City Park", searchName: "City Park", city: "测试城市", country: "测试国", address: "公园路1号", coordinates: { latitude: 31.24, longitude: 121.49 }, verificationStatus: "已核验", sourceIds: [1] }
  ],
  route: { stopIds: ["central-station", "city-park"], legs: [{ fromPlaceId: "central-station", toPlaceId: "city-park", mode: "walk", duration: "30分钟", durationMinutes: 30, color: "#2563a8", breakGroundRoute: false, sourceIds: [2] }] },
  days: [{ dayNumber: 1, date: "2026-09-01", city: "测试城市", theme: "抵达与城市漫步", kind: "arrival", intensity: { score: 3.0 }, accommodation: { label: "中央车站附近住宿", startPlaceId: "central-station", endPlaceId: "central-station", status: "checkin", note: "待入住" }, items: [
    { id: "d1-station", type: "place", placeId: "central-station", title: "中央车站", activity: "抵达并寄存行李", details: [], notes: ["核验寄存柜营业时间"], links: [{ label: "车站官网", url: "https://www.12306.cn/index/" }], referenceImages: [{ src: "images/station-locker.png", title: "寄存柜路线参考", alt: "中央车站寄存柜路线示意图", caption: "仅作经验参考，以现场指示为准。" }], calendarHighlight: true, startTime: "09:00", endTime: "10:00", timeText: "", travelMinutes: 0, stayMinutes: 60, transportMode: "walk", breakGroundRoute: false, reservationStatus: "none", sourceIds: [3] },
    { id: "d1-park", type: "place", placeId: "city-park", title: "城市公园", activity: "步行游览", details: ["参观湖边步道", "根据体力决定是否登高"], notes: [], links: [], calendarHighlight: true, startTime: "10:30", endTime: "12:00", timeText: "", travelMinutes: 30, stayMinutes: 90, transportMode: "步行", breakGroundRoute: false, reservationStatus: "none", sourceIds: [4] }
  ], food: ["午餐在公园东门的本地面食店"], risks: ["公园 11:30 停止入园；当前计划 10:30 抵达，晚于 11:30 时删除公园段。"], alternatives: ["若公园因活动封闭，改去城市博物馆，步行增加 15 分钟。"], calendarNotes: ["公园 11:30 停止入园。"], sourceIds: [5] }],
  transport: [{ from: "中央车站", to: "城市公园", departureWindow: "10:00", arrivalWindow: "10:30", mode: "步行", duration: "30分钟", cost: "0 CNY", verification: "9 月 1 日东门施工；改走南门会增加 10 分钟。", sourceIds: [6] }],
  budget: { baseCurrency: "CNY", targetCurrencies: [], items: [{ name: "住宿", min: 400, max: 600, currency: "CNY", note: "一晚", sourceIds: [7] }], total: { min: 400, max: 600, currency: "CNY" }, notes: ["不含购物"] },
  recommendations: [
    { id: "sight", category: "景点指南", name: "城市博物馆", reason: "理解城市历史", travelerFit: "适合城市文化偏好", timing: "下午", routeRelation: "市中心", duration: "2小时", reservation: "建议预约", limit: "周一闭馆；本次若调整到周一则不能加入。", executionAdvice: "若 16:00 后抵达，只看一层常设展。", officialUrl: "https://www.louvre.fr/", sourceIds: [9] },
    { id: "experience", category: "当地体验", name: "社区散步", reason: "观察当地生活", travelerFit: "适合步行偏好", timing: "下午", routeRelation: "公园附近", duration: "1小时", reservation: "无需预约", limit: "仅周六 08:00–13:00 开放。", executionAdvice: "若 11:30 后抵达，放弃市集并返回原路线。", sourceIds: [8] },
    { id: "food", category: "餐饮指南", name: "本地面食", reason: "地方代表性", travelerFit: "适合简洁午餐", timing: "午餐", routeRelation: "真正顺路", duration: "1小时", reservation: "无需预约", executionAdvice: "现场等位超过 30 分钟，改去同街的河畔面馆。", sourceIds: [10] }
  ],
  recommendationNotes: [
    { category: "景点指南", text: "本次周一不安排博物馆；三处市立馆当日均闭馆。", sourceIds: [9] }
  ],
  localKnowledge: [
    { id: "culture", category: "文化特点", title: "城市生活节奏", guidance: "公共空间重视秩序", action: "按当地时段安排行程", dayNumbers: [], placeIds: [], sourceIds: [1] },
    { id: "etiquette", category: "会客礼仪", title: "先问候再沟通", guidance: "进入店铺先向工作人员问候", action: "使用当地常用问候语", dayNumbers: [], placeIds: [], sourceIds: [1] },
    { id: "taboo", category: "文化禁忌", title: "尊重安静空间", guidance: "宗教场所与安静空间降低音量", action: "拍照前查看现场标识", dayNumbers: [], placeIds: [], sourceIds: [1] }
  ],
  bookingLedger: [{ id: "museum-ticket", category: "activity", title: "城市公园预约", when: "09/01 上午", participants: "1 人", status: "pending", placeId: "city-park", bookingUrl: "https://example.invalid/booking", sourceIds: [4] }],
  checklist: [{ id: "ticket", category: "交通与预约", text: "核验车票", sourceIds: [1] }],
  weather: { enabled: false, startDate: "", endDate: "", locations: [] },
  arrivalDeparture: null, sources, sourceIndex: sources.map((source) => ({ sourceId: source.id, title: source.title, cities: source.cities, tags: ["城市", "步行", "交通", "车站", "路线", "餐饮", "住宿", "预约", "天气", "避坑"], searchHints: ["中央车站寄存", "公园步行路线"] })), researchAudit: audit
};

/* 供其他回归测试复用本文件的完整有效内容夹具，避免依赖 outputs/ 下的私人攻略。 */
const fixtureOutArg = process.argv.find((arg) => arg.startsWith("--write-content-fixture="));
function writeFixtureImages(directory) {
  fs.mkdirSync(path.join(directory, 'images'), { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
  for (const image of ['cover.jpg', 'station-locker.png', 'avatar.jpg']) fs.writeFileSync(path.join(directory, 'images', image), png);
}
if (fixtureOutArg) {
  const fixturePath = path.resolve(fixtureOutArg.slice("--write-content-fixture=".length));
  writeFixtureImages(path.dirname(fixturePath));
  fs.writeFileSync(fixturePath, JSON.stringify(content, null, 2) + "\n", "utf8");
  process.exit(0);
}

const write = (name, data) => { const file = path.join(temp, name); fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); return file; };
writeFixtureImages(temp);
const requestFile = write("trip-request.json", request); const briefFile = write("trip-brief.json", brief); const dataFile = write("trip-data.json", content); const htmlFile = path.join(temp, "guide.html");
const run = (args, expect = 0) => { if (args[0] === renderer && !args.some(arg => arg.startsWith("--supabase-config=")) && !args.includes("--public-source")) args = [...args, "--no-collaboration"]; const result = spawnSync(process.execPath, args, { encoding: "utf8" }); if (result.status !== expect) throw new Error(`${args.join(" ")}\n${result.stdout}\n${result.stderr}`); return result; };

run([validator, requestFile, "--stage=request"]);
run([validator, briefFile, "--stage=brief", `--request=${requestFile}`]);
const briefSummary = run([summarizer, briefFile, `--request=${requestFile}`]).stdout;
["## 基础方案预览", "已记录总授权", "将默认继续生成详细内容和网页。", "当天地图", "分段导航", "日历导出", "实际支出"].forEach((marker) => { if (!briefSummary.includes(marker)) throw new Error(`基础方案预览缺少 ${marker}`); });
if (briefSummary.includes("请回复“确认/继续”")) throw new Error("总授权状态仍要求用户重复确认");
run([validator, dataFile, "--stage=content", `--brief=${briefFile}`]);
const missingCultureCard = structuredClone(content);
missingCultureCard.localKnowledge.pop();
run([validator, write("missing-culture-card.json", missingCultureCard), "--stage=content"]);
const omittedCulture = structuredClone(content); omittedCulture.localKnowledge = []; omittedCulture.meta.cultureNote = "本次城市短途无特殊文化事项";
run([validator, write("omitted-culture.json", omittedCulture), "--stage=content"]);
const genericTravelerFit = structuredClone(content);
genericTravelerFit.recommendations[0].travelerFit = "适合在主线完成后仍有时间，再补充目的地辨识度的旅行者。";
const genericTravelerFitResult = run([validator, write("generic-traveler-fit.json", genericTravelerFit), "--stage=content"], 1);
if (!`${genericTravelerFitResult.stdout}${genericTravelerFitResult.stderr}`.includes("不提供取舍依据的通用套话")) throw new Error("未拦截不提供加入、替换或放弃依据的 travelerFit 套话");
const repeatedTravelerFit = structuredClone(content);
repeatedTravelerFit.recommendations[1].travelerFit = repeatedTravelerFit.recommendations[0].travelerFit;
const repeatedTravelerFitResult = run([validator, write("repeated-traveler-fit.json", repeatedTravelerFit), "--stage=content"], 1);
if (!`${repeatedTravelerFitResult.stdout}${repeatedTravelerFitResult.stderr}`.includes("具体取舍依据")) throw new Error("未拦截跨推荐卡复制的 travelerFit 文案");
const missingHeroCopy = structuredClone(content); delete missingHeroCopy.meta.hero.title;
const missingHeroCopyResult = run([validator, write("missing-hero-copy.json", missingHeroCopy), "--stage=content"], 1);
if (!`${missingHeroCopyResult.stdout}${missingHeroCopyResult.stderr}`.includes("meta.hero.title")) throw new Error("未拦截缺失的封面编辑标题");
const generatedTemplate = JSON.parse(fs.readFileSync(path.join(skillRoot, "assets/data/trip-data.template.json"), "utf8"));
if (Object.prototype.hasOwnProperty.call(generatedTemplate.meta.hero, "footerNote")) throw new Error("新模板不得继续生成已废弃的 hero.footerNote");
for (const [field, value] of [["title", "短"], ["title", "长".repeat(17)], ["subtitle", "短".repeat(11)], ["subtitle", "长".repeat(101)]]) {
  const invalidHero = structuredClone(content);
  invalidHero.meta.hero[field] = value;
  const result = run([validator, write(`invalid-hero-${field}-${value.length}.json`, invalidHero), "--stage=content"], 1);
  if (!`${result.stdout}${result.stderr}`.includes(`meta.hero.${field}`)) throw new Error(`未拦截不合规的 meta.hero.${field} 长度`);
}
run([renderer, dataFile, htmlFile, `--request=${requestFile}`, `--brief=${briefFile}`]);
const html = fs.readFileSync(htmlFile, "utf8");
if (!html.includes('href="assets/niumou-spritesheet.webp"')) throw new Error("生成页面缺少牛哞组合菜单素材引用");
if (!fs.existsSync(path.join(temp, "assets/niumou-spritesheet.webp"))) throw new Error("渲染器未同步牛哞组合菜单素材");
const malformedSourceIndexFile = path.join(temp, "malformed-source-index.html");
fs.writeFileSync(malformedSourceIndexFile, html.replace(/(<script id="travel-source-index"[^>]*>)[\s\S]*?(<\/script>)/, "$1{invalid json$2"), "utf8");
const malformedSourceIndexResult = run([path.join(skillRoot, "scripts/validate-guide-contract.js"), malformedSourceIndexFile, "--full", "--expected-start=2026-09-01", "--expected-end=2026-09-01"], 1);
if (!`${malformedSourceIndexResult.stdout}${malformedSourceIndexResult.stderr}`.includes("资料来源索引 JSON 无法解析")) throw new Error("损坏的资料来源索引 JSON 未被明确拦截");
if (!/<body\b[^>]*data-guide-theme="ink"[^>]*data-guide-default-theme="ink"/i.test(html)) throw new Error('攻略默认主题未从 meta.theme 写入首帧页面');
const defaultThemeContent = structuredClone(content); delete defaultThemeContent.meta.theme;
const defaultThemeFile = path.join(temp, 'default-theme.html');
run([renderer, write('default-theme.json', defaultThemeContent), defaultThemeFile]);
if (!/<body\b[^>]*data-guide-theme="coast"[^>]*data-guide-default-theme="coast"/i.test(fs.readFileSync(defaultThemeFile, 'utf8'))) throw new Error('省略 meta.theme 时未使用海岸蓝默认主题');
const invalidThemeContent = structuredClone(content); invalidThemeContent.meta.theme = 'fixed-blue';
run([validator, write('invalid-theme.json', invalidThemeContent), '--stage=content'], 1);
if (html.includes('data-guide-module="destination-kit"') || html.includes('id="destination-kit"')) throw new Error('已移除的目的地手册模块仍被渲染');
const legacyDestinationKit = structuredClone(content);
legacyDestinationKit.destinationKit = { entries: [] };
const legacyDestinationKitResult = run([validator, write('legacy-destination-kit.json', legacyDestinationKit), '--stage=content'], 1);
if (!`${legacyDestinationKitResult.stdout}${legacyDestinationKitResult.stderr}`.includes('包含未定义的字段 "destinationKit"')) throw new Error('旧 destinationKit 字段未被数据契约拦截');
// Optional shops are suggestions, not bookings or executable map stops.
const { JSDOM } = require('jsdom');
const { extractModuleFragment } = require('./render-guide.js');
const groupedSourcesContent = structuredClone(content);
[
  { type: 'local', title: '用户行程表', topics: ['行程基线'] },
  { type: 'official', title: '官方铁路信息', topics: ['铁路', '交通'] },
  { type: 'official', title: '官方博物馆票务', topics: ['票务', '预约'] },
  { type: 'official', title: '官方餐厅门店', topics: ['餐饮', '营业时间'] },
  { type: 'official', title: '官方文化礼仪', topics: ['文化', '问候'] },
  { type: 'official', title: '官方天气数据', topics: ['天气', '气候'] }
].forEach((source, index) => groupedSourcesContent.sources.push({ id: 11 + index, scope: 'general', url: source.type === 'local' ? '' : `https://example.invalid/source-${11 + index}`, cities: ['测试城市'], verificationStatus: '测试核验', ...source }));
const groupedSourcesFile = path.join(temp, 'grouped-sources.html');
run([renderer, write('grouped-sources.json', groupedSourcesContent), groupedSourcesFile]);
const groupedSourcesDocument = new JSDOM(fs.readFileSync(groupedSourcesFile, 'utf8')).window.document;
const displayedSourceGroups = [...groupedSourcesDocument.querySelectorAll('#sources [data-source-group]')].map((group) => group.dataset.sourceGroup).join('|');
if (displayedSourceGroups !== 'reading-0') throw new Error(`补充阅读未按阅读用途展示：${displayedSourceGroups}`);
if (groupedSourcesDocument.querySelector('#source-11') || groupedSourcesDocument.querySelector('#sources')?.textContent.includes('官方铁路信息')) throw new Error('未入选核验来源泄露到补充阅读');
const recommendationDocument = new JSDOM(html).window.document;
const recommendationModules = [...recommendationDocument.querySelectorAll('.recommendation-module')];
const recommendationCards = [...recommendationDocument.querySelectorAll('.recommendation-item.guide-action-card')];
if (recommendationModules.length !== 4 || recommendationCards.length !== content.recommendations.length) throw new Error('推荐四分组未完整渲染');
if (recommendationModules.slice(0,3).some((module) => !module.querySelector('.recommendation-list.booking-ledger-grid'))) throw new Error('推荐分类未复用预定清单响应式网格');
for (const card of recommendationCards) {
  const labels = [...card.querySelectorAll('.booking-card-actions a')].map((link) => link.textContent.trim()).join('|');
  if (!labels.endsWith('Google Maps ↗|小红书 ↗') || !card.querySelector('.recommendation-route-tag') || !card.querySelector('.recommendation-guidance') || !card.querySelector('.recommendation-fit')) throw new Error('推荐卡交互或信息层级未统一');
  if (card.querySelector('h4 .copy-target')) throw new Error('推荐卡不应继续把标题作为复制交互');
}
const firstRecommendation = recommendationCards[0];
if (new URL(firstRecommendation.querySelectorAll('.booking-card-actions a')[1].href).searchParams.get('query') !== content.recommendations[0].name) throw new Error('推荐地图入口未使用地点名称');
if (new URL(firstRecommendation.querySelectorAll('.booking-card-actions a')[2].href).searchParams.get('keyword') !== content.recommendations[0].name) throw new Error('推荐小红书入口未使用地点名称');
if (!firstRecommendation.querySelector('[data-xhs-link][data-xhs-deeplink^="xhsdiscover://search/result?"]')) throw new Error('推荐小红书入口缺少移动端 App Deeplink');
if (firstRecommendation.querySelector('[data-xhs-link]').dataset.xhsKeyword !== content.recommendations[0].name || firstRecommendation.querySelector('[data-xhs-link]').dataset.xhsDeeplink.includes('mode=')) throw new Error('推荐小红书入口未保留关键词或仍包含非公开 Deeplink 参数');
const directXhsSource = recommendationDocument.querySelector('#sources a[data-xhs-link]');
if (!directXhsSource?.dataset.xhsDeeplink.startsWith('xhsdiscover://item/')) throw new Error('具体小红书笔记缺少移动端 App Deeplink');
if (directXhsSource.dataset.xhsDeeplink !== 'xhsdiscover://item/test-note-1' || !directXhsSource.dataset.xhsKeyword?.trim()) throw new Error('原帖ID被截断或缺少具体搜索词');
if (recommendationDocument.querySelector('.local-knowledge-module h3 span')?.textContent !== '文化习俗' || recommendationDocument.querySelectorAll('.local-knowledge-module .local-knowledge-card').length !== 3) throw new Error('文化习俗模块未固定渲染三张卡片');
if ([...recommendationDocument.querySelectorAll('.local-knowledge-card > span')].map((item) => item.textContent).join('|') !== '文化特点|会客礼仪|文化禁忌') throw new Error('文化习俗卡片分类或顺序不正确');
if (recommendationDocument.querySelector('[data-local-knowledge-placement]')) throw new Error('文化习俗卡片不应重复投影到逐日时间线');
if (recommendationDocument.querySelectorAll('[data-guide-theme-picker] [data-guide-theme]').length !== 6 || !recommendationDocument.querySelector('[data-guide-theme-launcher]') || !recommendationDocument.querySelector('[data-guide-theme-popover]')) throw new Error('封面主题入口或六套语义配色浮层未固化');
if (!recommendationDocument.querySelector('#bookings > #recommendations[data-nav-label="当地体验"]')) throw new Error('当地体验未作为预定清单下方的独立快捷导航模块');
const highlightsContent = structuredClone(content);
const hubContent = structuredClone(content);
hubContent.meta.hero = { ...content.meta.hero, title: '旅行 <手册>', budgetLabel: '预算待确认', stages: [{ label: '城市 & 河畔', summary: '公园与艺术', dayNumbers: [1] }] };
const hubFile = path.join(temp, 'hero-hub.html');
run([renderer, write('hero-hub.json', hubContent), hubFile]);
const hubHtml = fs.readFileSync(hubFile, 'utf8'), hubDoc = new JSDOM(hubHtml).window.document;
if (hubDoc.querySelector('.hero-hub h1')?.textContent !== '旅行 <手册>' || hubDoc.querySelector('.hero-stage, .hero-actions, .hero-footer')) throw new Error('默认首屏不得保留旧入口');
if (hubDoc.querySelector('.hero-highlights, .hero-hub .hero-meta') || hubDoc.querySelector('.hero-hub').textContent.includes(content.meta.routeSummary)) throw new Error('新首屏不应重复长路线或标签');
if (!hubDoc.querySelector('.hero-cover-image') || hubDoc.querySelectorAll('.hero-hub button').length !== 1 || !hubDoc.querySelector('[data-guide-theme-launcher]')) throw new Error('首屏必须包含封面图且只保留主题入口');
if (hubDoc.querySelector('.hero-hub a, [data-resume-day], .hero-cover-credit, .hero-execution-link') || /查看行程|图片[：:]/.test(hubDoc.querySelector('.hero-hub').textContent)) throw new Error('封面不得生成行程入口或图片来源');
if (hubDoc.querySelector('.hero-kicker')?.textContent !== 'ITINERARY' || !hubDoc.querySelector('.hero-subtitle')) throw new Error('封面眉题或路线摘要不完整');
if (hubDoc.querySelector('.hero-hub').querySelector('.hero-facts, .hero-roast, .hero-roast-list, aside')) throw new Error('行程事实或短评不得进入封面');
if (!hubDoc.querySelector('.hero-cover-header + .hero-cover-copy') || !hubDoc.querySelector('.hero-cover-copy + .hero-cover-footer')) throw new Error('封面顺序必须为页眉、标题摘要、页脚');
const bubblesContent = structuredClone(hubContent);
bubblesContent.meta.hero.showLinks = false;
const bubblesFile = path.join(temp, 'hero-bubbles.html');
run([renderer, write('hero-bubbles.json', bubblesContent), bubblesFile]);
const bubblesHtml = fs.readFileSync(bubblesFile, 'utf8'), bubblesDoc = new JSDOM(bubblesHtml).window.document;
if (bubblesDoc.querySelector('.hero-actions, .hero-stage-grid, .hero-footer, .hero-section-label')) throw new Error('关闭首屏入口必须移除所有导航组与占位');
if (bubblesDoc.querySelector('.hero-hub').querySelector('.hero-facts, .hero-roast, .hero-roast-list, aside')) throw new Error('封面不得生成事实行或短评');
if (!bubblesDoc.querySelector('[data-quick-nav]')) throw new Error('封面精简后必须保留正文导航');
for (const name of ['itinerary','budget','bookings','route-map']) if (extractModuleFragment(bubblesHtml,name) !== extractModuleFragment(hubHtml,name)) throw new Error('多气泡影响了正文');
for (const legacyField of ['roast', 'roasts', 'footerNote']) {
  const bad = structuredClone(hubContent); bad.meta.hero[legacyField] = legacyField === 'roasts' ? [{label:'城市',text:'旧短评'}] : '旧短评或事实行';
  const result = run([validator, write(`removed-${legacyField}.json`, bad), '--stage=content'], 1);
  if (!`${result.stdout}${result.stderr}`.includes(`未定义的字段 "${legacyField}"`)) throw new Error(`已删除的 ${legacyField} 字段未被数据契约拦截`);
}
const badHeroLinks = structuredClone(hubContent); badHeroLinks.meta.hero.showLinks = 'false';
run([validator, write('bad-hero-links.json',badHeroLinks), '--stage=content'],1);
for (const moduleName of ['itinerary','budget','bookings','route-map']) if (extractModuleFragment(html,moduleName) !== extractModuleFragment(hubHtml,moduleName)) throw new Error('首屏入口影响了其他模块');
for (const mutate of [d=>{d.meta.hero.stages[0].dayNumbers=[999];},d=>{d.meta.hero.stages[0].dayNumbers=[];},d=>{d.meta.hero.stages[0].dayNumbers=[1,1];},d=>{d.meta.hero.title='';},d=>{d.meta.hero.stages[0].summary=12;}]) {
  const bad = structuredClone(hubContent); mutate(bad); run([validator, write('bad-hub.json',bad), '--stage=content'],1);
}
highlightsContent.meta.highlights = ['城市艺术', '山湖 <备选> & 咖啡'];
const highlightsFile = path.join(temp, 'hero-highlights.html');
run([renderer, write('hero-highlights.json', highlightsContent), highlightsFile]);
const highlightsHtml = fs.readFileSync(highlightsFile, 'utf8');
const highlightsDoc = new JSDOM(highlightsHtml).window.document;
if (highlightsDoc.querySelector('.hero-highlights, .hero-meta, .hero-actions, .hero-footer')) throw new Error('旧关键词与入口字段不得改变默认首屏');
const defaultHero = new JSDOM(html).window.document.querySelector('.hero-hub');
if (!defaultHero || defaultHero.querySelector('h1').textContent !== content.meta.hero.title || defaultHero.querySelector('.hero-kicker').textContent !== 'ITINERARY' || !defaultHero.querySelector('.hero-cover-frame')) throw new Error('默认封面结构不完整');
const minimalHero = structuredClone(content);
minimalHero.meta.hero = { ...content.meta.hero };
const minimalHeroFile = path.join(temp, 'hero-minimal.html');
run([renderer, write('hero-minimal.json', minimalHero), minimalHeroFile]);
const minimalHeroDoc = new JSDOM(fs.readFileSync(minimalHeroFile, 'utf8')).window.document;
if (minimalHeroDoc.querySelector('.hero-hub h1').textContent !== content.meta.hero.title || minimalHeroDoc.querySelector('.hero-roast, .hero-facts')) throw new Error('新首屏不应要求废弃字段或显示旧短评');
const legacyLinks = structuredClone(bubblesContent); legacyLinks.meta.hero.showLinks = true;
const legacyLinksFile = path.join(temp, 'hero-legacy-links.html');
run([renderer, write('hero-legacy-links.json', legacyLinks), legacyLinksFile]);
if (new JSDOM(fs.readFileSync(legacyLinksFile, 'utf8')).window.document.querySelector('.hero-hub a')) throw new Error('showLinks=true 不得恢复已废弃的首屏入口');
for (const field of ['credit', 'creditUrl', 'showCredit']) {
  const bad = structuredClone(content); bad.meta.hero.cover[field] = field === 'showCredit' ? false : 'https://example.com/credit';
  const result = run([validator, write(`removed-cover-${field}.json`, bad), '--stage=content'], 1);
  if (!`${result.stdout}${result.stderr}`.includes(`未定义的字段 "${field}"`)) throw new Error(`已删除的封面字段 ${field} 未被数据契约拦截`);
}
const removedResume = structuredClone(content); removedResume.meta.hero.showResume = false;
const removedResumeResult = run([validator, write('removed-show-resume.json', removedResume), '--stage=content'], 1);
if (!`${removedResumeResult.stdout}${removedResumeResult.stderr}`.includes('未定义的字段 "showResume"')) throw new Error('已删除的 showResume 字段未被数据契约拦截');
const alteredHero = bubblesHtml.replace('<p class="hero-kicker">', '<button type="button">违规入口</button><p class="hero-kicker">');
const alteredHeroFile = path.join(temp, 'hero-invalid.html'); fs.writeFileSync(alteredHeroFile, alteredHero);
const invalidHeroResult = run([path.join(skillRoot, 'scripts/validate-guide-contract.js'), alteredHeroFile, '--full'], 1);
if (!invalidHeroResult.stdout.includes('首屏') && !invalidHeroResult.stderr.includes('首屏')) throw new Error('未拦截首屏结构漂移');
const forbiddenHeroExtras = bubblesHtml.replace(
  '<div class="hero-cover-footer">',
  '<div class="hero-cover-footer"><a class="hero-execution-link" data-resume-day href="#day-1">查看行程</a><span class="hero-cover-credit">图片：测试来源</span>'
);
const forbiddenHeroExtrasFile = path.join(temp, 'hero-forbidden-extras.html');
fs.writeFileSync(forbiddenHeroExtrasFile, forbiddenHeroExtras);
const forbiddenHeroExtrasResult = run([path.join(skillRoot, 'scripts/validate-guide-contract.js'), forbiddenHeroExtrasFile, '--full'], 1);
if (!`${forbiddenHeroExtrasResult.stdout}${forbiddenHeroExtrasResult.stderr}`.includes('不得生成行程入口或图片来源')) throw new Error('未拦截封面行程入口或图片来源');
for (const name of ['budget','itinerary','bookings','route-map']) if (extractModuleFragment(html,name) !== extractModuleFragment(highlightsHtml,name)) throw new Error('首屏关键词不应影响其他模块');
for (const bad of ['not-an-array', [''], [42], ['a'.repeat(25)], ['重复','重复'], ['重复',' 重复 '], Array.from({length:9}, (_,i)=>String(i))]) {
  const invalid = structuredClone(content); invalid.meta.highlights = bad;
  run([validator, write('bad-highlights.json', invalid), '--stage=content'], 1);
}
const withVenues = structuredClone(content);
withVenues.places.push({ ...content.places[0], id: 'optional-cafe', name: '测试咖啡 <备选>', usage: 'suggestion', coordinates: null, navigationEnabled: false });
withVenues.venueSuggestions = [{ id: 'optional-cafe', kind: 'cafe', placeId: 'optional-cafe', reason: '休息 & 甜点', timing: '午后备选', bookingPolicy: 'not_required', bookingNote: '外带无需预约；参加店内工作坊则需单独预约约 60 分钟。', officialUrl: 'https://www.shakespeareandcompany.com/cafe', checkedAt: '2026-08-27', sourceIds: [1] }];
const venueHtmlFile = path.join(temp, 'venues.html');
run([renderer, write('venues.json', withVenues), venueHtmlFile]);
const venueHtml = fs.readFileSync(venueHtmlFile, 'utf8');
const venueDocument = new JSDOM(venueHtml).window.document;
const venueCard = venueDocument.querySelector('.venue-card');
if (!venueCard || venueDocument.querySelectorAll('.venue-card').length !== 1) throw new Error('未生成店铺小卡片');
if (venueCard.querySelector('[data-booking-toggle], [data-execution-status]')) throw new Error('候选店不得冒充真实预订');
if (venueCard.querySelector('.venue-policy')?.textContent !== '不需要预定') throw new Error('未显示无需预定规则');
if (!venueCard.textContent.includes('测试咖啡 <备选>') || venueCard.querySelectorAll('.booking-card-actions').length !== 1 || venueCard.querySelectorAll('.booking-card-actions a').length !== 3) throw new Error('店铺应使用统一操作区显示官网、地图与小红书入口');
if ([...venueCard.querySelectorAll('.booking-card-actions a')].map((link) => link.textContent.trim()).join('|') !== '官网/预订 ↗|Google Maps ↗|小红书 ↗') throw new Error('候选店操作顺序或文案未与预订卡统一');
if (venueCard.querySelector('h5 a, .venue-links, a[href^="#source-"]') || venueCard.textContent.includes('核验')) throw new Error('候选店名不应隐藏地图交互或保留核验行');
const bookingCard = new JSDOM(html).window.document.querySelector('.booking-ledger-card');
if (!bookingCard?.querySelector('.booking-card-actions') || [...bookingCard.querySelectorAll('.booking-card-actions a')].map((link) => link.textContent.trim()).join('|') !== '官网/预订 ↗|Google Maps ↗|小红书 ↗') throw new Error('活动门票卡未使用统一的官网、地图与小红书操作区');
const bookingXhs = [...bookingCard.querySelectorAll('.booking-card-actions a')].find((link) => link.textContent.includes('小红书'));
if (!bookingXhs || new URL(bookingXhs.href).searchParams.get('keyword') !== content.bookingLedger[0].title) throw new Error('活动门票小红书入口未使用具体项目标题');
if (!venueCard.querySelector('.venue-booking-note')) throw new Error('特殊提醒必须保留');
for (const blank of [undefined, '', '   ']) {
  const withoutNote = structuredClone(withVenues); withoutNote.venueSuggestions[0].bookingNote = blank;
  const noNoteHtmlFile = path.join(temp, 'venue-no-note.html');
  run([renderer, write('venue-no-note.json', withoutNote), noNoteHtmlFile]);
  const noNoteDocument = new JSDOM(fs.readFileSync(noNoteHtmlFile,'utf8')).window.document;
  if (noNoteDocument.querySelector('.venue-booking-note') || noNoteDocument.querySelector('.venue-card').textContent.includes('undefined')) throw new Error('无特殊提醒时不能保留空行或标签');
}
const venueMapLink = [...venueCard.querySelectorAll('.booking-card-actions a')].find((link) => link.textContent.includes('Google Maps'));
if (!venueMapLink || new URL(venueMapLink.href).searchParams.get('query') !== '测试咖啡 <备选> 中心路1号') throw new Error('候选店地图操作必须包括正确名称和地址');
if (venueMapLink.target !== '_blank' || venueMapLink.rel !== 'noopener noreferrer') throw new Error('候选店地图外链缺少安全属性');
const cityVenues = structuredClone(withVenues);
cityVenues.places.push({ ...cityVenues.places[2], id: 'other-city', city: '另一城市 & 河畔' });
cityVenues.places.push({ ...cityVenues.places[2], id: 'same-city-shop' });
cityVenues.venueSuggestions.push({ ...cityVenues.venueSuggestions[0], id: 'other-city', placeId: 'other-city' });
cityVenues.venueSuggestions.push({ ...cityVenues.venueSuggestions[0], id: 'same-city-shop', placeId: 'same-city-shop', kind: 'shop' });
const cityHtmlFile = path.join(temp, 'venue-cities.html');
run([renderer, write('venue-cities.json', cityVenues), cityHtmlFile]);
const cityDocument = new JSDOM(fs.readFileSync(cityHtmlFile, 'utf8')).window.document;
const localExperienceDining = cityDocument.querySelector('#recommendations .recommendation-module:nth-child(3) .booking-ledger-grid');
if (!localExperienceDining || localExperienceDining.querySelectorAll('.venue-card').length !== 3 || cityDocument.querySelector('[data-venue-city], [data-venue-kind]')) throw new Error('候选场所应以扁平卡片进入当地体验餐饮分组');
for (const moduleName of ['route-map', 'itinerary', 'transport', 'budget']) {
  if (extractModuleFragment(html, moduleName) !== extractModuleFragment(venueHtml, moduleName)) throw new Error(`店铺推荐意外改变 ${moduleName}`);
}
if (new JSDOM(html).window.document.querySelector('.venue-card')) throw new Error('未提供推荐时不应展示空卡片');
const badVenueCases = [
  d => { d.venueSuggestions[0].kind = 'unknown'; },
  d => { d.venueSuggestions[0].bookingNote = 123; },
  d => { d.venueSuggestions[0].bookingPolicy = 'confirmed'; },
  d => { d.venueSuggestions[0].officialUrl = 'javascript:alert(1)'; },
  d => { d.venueSuggestions[0].sourceIds = [999]; },
  d => { d.venueSuggestions[0].placeId = 'missing'; },
  d => { d.venueSuggestions.push(structuredClone(d.venueSuggestions[0])); },
  d => { d.places[0].coordinates = null; },
  d => { delete d.places[2].navigationEnabled; },
  d => { d.days[0].items[0].placeId = 'optional-cafe'; },
  d => { d.route.stopIds.push('optional-cafe'); }
];
badVenueCases.forEach((mutate, index) => {
  const invalid = structuredClone(withVenues); mutate(invalid);
  run([validator, write(`bad-venue-${index}.json`, invalid), '--stage=content'], 1);
});
if (html.includes('TravelGuideCollaboration.init(')) throw new Error('本地渲染不应自动启用私有协作配置');
const collaborationConfig = path.join(temp, 'supabase.local.json');
fs.writeFileSync(collaborationConfig, JSON.stringify({ projectUrl: 'https://example-project.supabase.co', publishableKey: 'sb_publishable_test' }));
const collaborationHtmlFile = path.join(temp, 'collaboration.html');
run([renderer, dataFile, collaborationHtmlFile, `--supabase-config=${collaborationConfig}`]);
const collaborationHtml = fs.readFileSync(collaborationHtmlFile, 'utf8');
['collaboration', 'data-guide-collaboration-runtime', 'data-guide-collaboration-init', 'TravelGuideCollaboration.init(', 'TravelGuideFlightCollaboration.init(', '编辑行程'].forEach(marker => {
  if (!collaborationHtml.includes(marker)) throw new Error(`协作渲染缺少 ${marker}`);
});
const publicSourceFile = path.join(temp, 'public-source.html');
run([renderer, dataFile, publicSourceFile, '--public-source', '--public-collaboration']);
const publicSourceHtml = fs.readFileSync(publicSourceFile, 'utf8');
['__GOOGLE_MAPS_BROWSER_KEY__', '__SUPABASE_PROJECT_REF__', '__SUPABASE_PUBLISHABLE_KEY__', 'collaboration'].forEach(marker => {
  if (!publicSourceHtml.includes(marker)) throw new Error(`公开源 HTML 缺少 ${marker}`);
});
if (/AIza[0-9A-Za-z_-]{20,}|sb_publishable_[0-9A-Za-z_-]{8,}/.test(publicSourceHtml)) throw new Error('公开源 HTML 不得含真实 Browser/Publishable Key');

const bothNavigationFields = structuredClone(content);
const singleNavigation = structuredClone(content);
singleNavigation.days[0].items[1].navigationOptions = [{mode:'walking',durationMinutes:30,recommended:true}];
run([validator, write('valid-single-navigation.json', singleNavigation), '--stage=content']);
const emptyNavigation = structuredClone(singleNavigation);
emptyNavigation.days[0].items[1].navigationOptions = [];
run([validator, write('bad-empty-navigation.json', emptyNavigation), '--stage=content'], 1);
const variedNavigation = structuredClone(singleNavigation);
variedNavigation.days[0].items[1].navigationOptions.push(...['driving','transit','ferry','tram','bicycling'].map((mode,index)=>({mode,durationMinutes:10+index,recommended:false})));
run([validator, write('valid-varied-navigation.json', variedNavigation), '--stage=content']);
bothNavigationFields.days[0].items[1].navigationMode = 'walking';
bothNavigationFields.days[0].items[1].navigationOptions = [
  {mode:'walking',durationMinutes:30,recommended:true},
  {mode:'driving',durationMinutes:10,recommended:false}
];
const bothResult = run([validator, write('bad-navigation-both.json', bothNavigationFields), '--stage=content'], 1);
if (!`${bothResult.stdout}${bothResult.stderr}`.includes('不得同时设置')) throw new Error('未拦截 navigationMode/navigationOptions 双重语义');
const mismatchedNavigationDuration = structuredClone(content);
mismatchedNavigationDuration.days[0].items[1].navigationOptions = [
  {mode:'walking',durationMinutes:25,recommended:true},
  {mode:'driving',durationMinutes:10,recommended:false}
];
const mismatchResult = run([validator, write('bad-navigation-duration.json', mismatchedNavigationDuration), '--stage=content'], 1);
if (!`${mismatchResult.stdout}${mismatchResult.stderr}`.includes('travelMinutes 一致')) throw new Error('未拦截推荐耗时与时间线基线不一致');
const specialNavigationModes = structuredClone(content);
specialNavigationModes.days[0].items[1].navigationOptions = [
  {mode:'cablecar',durationMinutes:30,recommended:true},
  {mode:'monorail',durationMinutes:35,recommended:false},
  {mode:'minibus',durationMinutes:40,recommended:false},
  {mode:'walking',durationMinutes:55,recommended:false}
];
run([validator, write('valid-special-navigation.json', specialNavigationModes), '--stage=content']);
for (const marker of ['data-day-route-summary', 'route-timeline-card', 'route-stop-row', 'route-place-link', 'data-route-navigation-launch']) {
  if (!html.includes(marker)) throw new Error(`分段导航缺少 ${marker}`);
}
const routeCard = new JSDOM(html).window.document.querySelector('.route-timeline-card');
if (!routeCard || routeCard.nextElementSibling?.classList.contains('day-timeline-block') !== true) throw new Error('执行汇总卡必须紧接在详细时间线之前');
if (routeCard.querySelector('.route-stop-row')?.querySelector('.route-stop-rail') === null) throw new Error('执行汇总卡必须使用编号轨道，而非普通路线文字');
if (routeCard.querySelector('.route-timeline-summary')?.textContent.replace(/\s+/g, ' ').trim() !== '共 3 个停靠点 · 已知移动 30分 · 终点 中央车站') throw new Error('执行汇总卡必须使用停靠点、已知移动和终点三事实摘要');
if (html.includes('&amp;waypoints=')) throw new Error('不应继续生成全天多途经点链接');
if (!html.includes('travelmode=walking')) throw new Error('步行路线应提供可直接发起的查询链接');
if (html.includes('>分段导航<') || html.includes('class="day-route-summary"')) throw new Error('导航应并入当日路线，不再重复渲染两套路线');
["data-guide-version=\"2.0\"", `data-guide-template-version="${PAGE_TEMPLATE_VERSION}"`, "route-summary-list", "route-summary-stop", "google-tiles-timeout", "data-place-id=\"city-park\"", "data-day-tabs", "data-day-tab=\"1\"", "data-day-panel=\"1\"", "guide:day-change", "is-entering-forward", "data-calendar-mode=\"daily\"", "travel-guide-calendar: v2", "DTSTART;VALUE=DATE", "DTEND;VALUE=DATE", "DTSTAMP", "descriptionSections", "当天地图", "day-overview-actions", "行程强度</b><strong>3.0 🌟", "data-mobile-cards", "recommendation-modules", "recommendation-module-note", "整体备注：", "slot-notes", "slot-information-list", "车站官网", "google.com/maps/search", "data-expense-tracker", "data-checklist-progress-count", "data-day-route-summary", "route-timeline-summary", "route-timeline-mode", "🚶‍♀️", "30 分钟", "data-booking-toggle", 'data-booking-id="museum-ticket"', "城市公园预约"].forEach((marker) => { if (!html.includes(marker)) throw new Error(`渲染结果缺少 ${marker}`); });
if (/data-map-view="day-\d+"/.test(html)) throw new Error("地图不得重复输出日期选择按钮");
if (html.includes('href="#day-navigation-1"') || html.includes('data-day-navigation')) throw new Error('逐日卡不应再输出重复的当天导航入口');
// 2.38.2：未配置协作时逐日条目的 reservationStatus 是静态徽章，不得渲染无监听的交互按钮
if (/<button[^>]*data-execution-status/.test(html)) throw new Error("未配置协作时逐日条目不得输出预订状态按钮");
// 配置协作后状态按钮恢复可交互
const statusContent = structuredClone(content);
statusContent.days[0].items[0].reservationStatus = "confirmed";
const statusFile = write('status-badge.json', statusContent);
const statusHtmlFile = path.join(temp, 'status-badge.html');
run([renderer, statusFile, statusHtmlFile, `--request=${requestFile}`, `--brief=${briefFile}`, '--no-collaboration']);
if (!/<span class="execution-status is-confirmed">已确认<\/span>/.test(fs.readFileSync(statusHtmlFile, 'utf8'))) throw new Error("本地模式应输出静态状态徽章");
run([renderer, statusFile, statusHtmlFile, `--request=${requestFile}`, `--brief=${briefFile}`, '--supabase-config=' + path.join(temp, 'supabase.local.json')]);
const statusCollabHtml = fs.readFileSync(statusHtmlFile, 'utf8');
if (!/<button type="button" class="execution-status is-confirmed"[^>]*data-execution-status/.test(statusCollabHtml)) throw new Error("协作模式应输出可交互状态按钮");
// 2.38.2：未配置协作时核验清单保存说明不得提及"编辑行程/实时同步"
const checklistNote = html.match(/<p class="local-note">([^<]*)<\/p>/)?.[1] || "";
if (checklistNote.includes("编辑行程") || checklistNote.includes("实时同步")) throw new Error("未配置协作时清单说明不得提示实时同步");
if (!checklistNote.includes("仅保存在当前浏览器")) throw new Error("清单说明应保留本地保存表述");
// 配置协作后清单说明必须提示实时同步
const collabContent = structuredClone(content);
const collabFile = write('collab-note.json', collabContent);
const collabHtmlFile = path.join(temp, 'collab-note.html');
run([renderer, collabFile, collabHtmlFile, `--request=${requestFile}`, `--brief=${briefFile}`, '--supabase-config=nonexistent', '--no-collaboration']);
const collabNoteResult = run([renderer, collabFile, collabHtmlFile, `--request=${requestFile}`, `--brief=${briefFile}`, '--supabase-config=' + write('supabase.local.json', { projectUrl: 'https://example-project.supabase.co', publishableKey: 'sb_publishable_test_key_0000000000000000000000' })]);
const collabHtml = fs.readFileSync(collabHtmlFile, 'utf8');
const collabChecklistNote = collabHtml.match(/<p class="local-note">([^<]*)<\/p>/)?.[1] || "";
if (!collabChecklistNote.includes("实时同步")) throw new Error("启用协作时清单说明应提示实时同步");
const referenceDocument = new JSDOM(html).window.document;
const referenceCard = referenceDocument.querySelector('.itinerary-reference-card');
if (!referenceCard || referenceCard.querySelector('[data-preview-image]')?.dataset.previewImage !== 'images/station-locker.png' || referenceCard.querySelector('img')?.alt !== '中央车站寄存柜路线示意图') throw new Error('行程参考图片未按节点渲染或缺少预览/替代文本');
if (!referenceCard.textContent.includes('寄存柜路线参考') || !referenceCard.textContent.includes('仅作经验参考')) throw new Error('行程参考图片缺少标题或用途说明');
const badReferenceImage = structuredClone(content); badReferenceImage.days[0].items[0].referenceImages[0].src = '../private.png';
const badReferenceImageResult = run([validator, write('bad-reference-image.json', badReferenceImage), '--stage=content'], 1);
if (!`${badReferenceImageResult.stdout}${badReferenceImageResult.stderr}`.includes('referenceImages')) throw new Error('未拦截不安全的行程参考图片路径');
if (/行程强度[：:]/u.test(html.replace(/<[^>]+>/g, ""))) throw new Error("行程强度文案仍包含冒号");
if (/guide-itinerary-cycle|data-filter(?:\s|=|>)/i.test(html)) throw new Error("渲染结果仍包含旧日期循环或分类筛选交互");
const calendarPayload = html.match(/<script type="application\/json" data-calendar-events[^>]*>([\s\S]*?)<\/script>/)?.[1];
const calendarEvents = JSON.parse(calendarPayload || "[]");
if (calendarEvents.length !== content.days.length || calendarEvents.some((event) => event.allDay !== true)) throw new Error("默认日历必须按旅行日生成全天事件");
if (calendarEvents.some((event) => !/^Day \d+ \| /.test(event.title) || event.location !== "测试城市" || !Array.isArray(event.descriptionSections))) throw new Error("日历摘要、核心地点或结构化 DESCRIPTION 不符合契约");

const conflict = structuredClone(content); conflict.days[0].items[1].startTime = "10:20";
// An all-flight/single-stop day keeps its timeline but has no empty route section or dead anchor.
if (html.includes('data-day-route-note')) throw new Error('未设置路线说明时不应生成备注');
const withRouteNote = structuredClone(content);
withRouteNote.days[0].routeNote = '出行说明 <仅本行程> & 保留原路线';
withRouteNote.features.dayNavigation = false;
const routeNoteHtmlFile = path.join(temp, 'route-note.html');
run([renderer, write('route-note.json', withRouteNote), routeNoteHtmlFile]);
const routeNoteHtml = fs.readFileSync(routeNoteHtmlFile, 'utf8');
if (!routeNoteHtml.includes('<h4>当日路线<small class="day-route-heading-note" data-day-route-note>出行说明 &lt;仅本行程&gt; &amp; 保留原路线</small></h4>')) throw new Error('路线说明应安全转义并位于标题后');
const badRouteNote = structuredClone(content); badRouteNote.days[0].routeNote = 42;
const avatarContent = structuredClone(withRouteNote);
avatarContent.days[0].routeNoteAvatar = 'images/avatar.jpg';
const avatarHtmlFile = path.join(temp, 'route-avatar.html');
run([renderer, write('route-avatar.json', avatarContent), avatarHtmlFile]);
const avatarHtml = fs.readFileSync(avatarHtmlFile, 'utf8');
if (!avatarHtml.includes('data-day-route-note><img class="day-route-note-avatar" src="images/avatar.jpg" alt="" aria-hidden="true">出行说明')) throw new Error('头像应在说明文字前');
if (!/\.day-route-note-avatar\s*\{[^}]*width: 1em;[^}]*height: 1em;/.test(avatarHtml)) throw new Error('头像应与文字同尺寸');
for (const invalidPath of ['https://host.test/a.jpg', '../a.jpg', '/tmp/a.jpg', 'a.svg']) {
  const badAvatar = structuredClone(avatarContent); badAvatar.days[0].routeNoteAvatar = invalidPath;
  const badAvatarResult = run([validator, write('bad-avatar.json', badAvatar), '--stage=content'], 1);
  if (!`${badAvatarResult.stdout}${badAvatarResult.stderr}`.includes('routeNoteAvatar')) throw new Error('未拦截不安全头像路径');
}
const orphanAvatar = structuredClone(avatarContent); delete orphanAvatar.days[0].routeNote;
run([validator, write('orphan-avatar.json', orphanAvatar), '--stage=content'], 1);
const badRouteNoteResult = run([validator, write('bad-route-note.json', badRouteNote), '--stage=content'], 1);
if (!`${badRouteNoteResult.stdout}${badRouteNoteResult.stderr}`.includes('routeNote')) throw new Error('未拦截非文本路线说明');
const disconnected = structuredClone(content);
disconnected.days[0].routeNote = '没有路线时不展示此说明';
disconnected.days[0].routeNoteAvatar = 'images/avatar.jpg';
disconnected.days[0].accommodation.startPlaceId = "";
disconnected.days[0].accommodation.endPlaceId = "";
disconnected.days[0].items.forEach(item => { item.breakGroundRoute = true; });
const disconnectedFile = write("disconnected.json", disconnected);
const disconnectedHtmlFile = path.join(temp, "disconnected.html");
run([renderer, disconnectedFile, disconnectedHtmlFile]);
const disconnectedHtml = fs.readFileSync(disconnectedHtmlFile, "utf8");
if (disconnectedHtml.includes('data-day-route-note')) throw new Error('无路线时不应展示说明');
if (disconnectedHtml.includes('src="images/avatar.jpg"')) throw new Error('无路线时不应展示头像');
if (disconnectedHtml.includes('<section class="day-route-block"') || disconnectedHtml.includes('当天导航不可用：')) throw new Error('无路段日仍显示空路线');
if (!disconnectedHtml.includes('data-item-id="d1-station"') || !disconnectedHtml.includes('data-item-id="d1-park"')) throw new Error('隐藏空路线不应删除时间线地点');
const badAnchorFile = path.join(temp, "disconnected-bad-anchor.html");
fs.writeFileSync(badAnchorFile, disconnectedHtml.replace('<div class="day-overview-actions">', '<div class="day-overview-actions"><a href="#day-navigation-1">当天导航</a>'));
const badAnchorResult = run([path.join(skillRoot, 'scripts/validate-guide-contract.js'), badAnchorFile, '--full'], 1);
if (!`${badAnchorResult.stdout}${badAnchorResult.stderr}`.includes('不得输出重复的当天导航入口')) throw new Error('未拦截重复的当天导航入口');
const conflictFile = write("conflict.json", conflict);
const conflictResult = run([validator, conflictFile, "--stage=content"], 1);
if (!conflictResult.stderr.includes("时间条目冲突") && !conflictResult.stdout.includes("时间条目冲突")) throw new Error("未识别逐日时间冲突");

const invalidIntensity = structuredClone(content); invalidIntensity.days[0].intensity.score = 3.2;
const duplicateTimeText = structuredClone(content); duplicateTimeText.days[0].items[0].startTime = ''; duplicateTimeText.days[0].items[0].endTime = ''; duplicateTimeText.days[0].items[0].timeText = duplicateTimeText.days[0].items[0].title;
const duplicateTimeTextResult = run([validator, write('duplicate-time-text.json', duplicateTimeText), '--stage=content'], 1);
if (!`${duplicateTimeTextResult.stdout}${duplicateTimeTextResult.stderr}`.includes('不得重复 title')) throw new Error('未拦截把标题复制进 timeText 的错误数据');
const oversizedTimeText = structuredClone(content); oversizedTimeText.days[0].items[0].startTime = ''; oversizedTimeText.days[0].items[0].endTime = ''; oversizedTimeText.days[0].items[0].timeText = '这是超过二十四个字符的弹性时间说明并且错误包含完整路线与活动正文';
const oversizedTimeTextResult = run([validator, write('oversized-time-text.json', oversizedTimeText), '--stage=content'], 1);
if (!`${oversizedTimeTextResult.stdout}${oversizedTimeTextResult.stderr}`.includes('不得超过 24 个字符')) throw new Error('未拦截过长的 timeText');
const wideTimeText = structuredClone(content); wideTimeText.days[0].items[0].startTime = ''; wideTimeText.days[0].items[0].endTime = ''; wideTimeText.days[0].items[0].timeText = '白天 · 视天气与运行状态调整';
const wideTimeHtmlFile = path.join(temp, 'wide-time.html');
run([renderer, write('wide-time.json', wideTimeText), wideTimeHtmlFile]);
if (!new JSDOM(fs.readFileSync(wideTimeHtmlFile, 'utf8')).window.document.querySelector('[data-item-id="d1-station"].is-wide-time')) throw new Error('合法长时间标签应自动改为整行显示');
const invalidNavigation = structuredClone(content); invalidNavigation.days[0].items[1].navigationMode = 'flying';
const invalidNavigationResult = run([validator, write('invalid-navigation-mode.json', invalidNavigation), '--stage=content'], 1);
if (!`${invalidNavigationResult.stdout}${invalidNavigationResult.stderr}`.includes('navigationMode')) throw new Error('未拦截非法导航偏好');
const invalidNavigationOptions = structuredClone(content);
invalidNavigationOptions.days[0].items[1].navigationOptions = [
  {mode:'driving',durationMinutes:20,recommended:true},
  {mode:'walking',durationMinutes:35,recommended:true}
];
const invalidNavigationOptionsResult = run([validator, write('invalid-navigation-options.json', invalidNavigationOptions), '--stage=content'], 1);
if (!`${invalidNavigationOptionsResult.stdout}${invalidNavigationOptionsResult.stderr}`.includes('只能标记 1 个推荐方案')) throw new Error('未拦截多个推荐交通方案');
const invalidIntensityResult = run([validator, write("invalid-intensity.json", invalidIntensity), "--stage=content"], 1);
if (!`${invalidIntensityResult.stdout}${invalidIntensityResult.stderr}`.includes("0.5 递增")) throw new Error("未拦截无效强度评分");

const optionalSupplements = structuredClone(content);
delete optionalSupplements.days[0].food;
delete optionalSupplements.days[0].risks;
delete optionalSupplements.days[0].alternatives;
delete optionalSupplements.days[0].calendarNotes;
delete optionalSupplements.days[0].items[0].notes;
delete optionalSupplements.days[0].accommodation.note;
delete optionalSupplements.transport[0].verification;
delete optionalSupplements.budget.notes;
optionalSupplements.recommendations.forEach((item) => { delete item.limit; delete item.executionAdvice; });
delete optionalSupplements.recommendationNotes;
const optionalSupplementsHtmlFile = path.join(temp, "optional-supplements.html");
run([renderer, write("optional-supplements.json", optionalSupplements), optionalSupplementsHtmlFile]);
const optionalSupplementsDocument = new JSDOM(fs.readFileSync(optionalSupplementsHtmlFile, "utf8")).window.document;
if (optionalSupplementsDocument.querySelector(".day-notes")) throw new Error("空的逐日补充说明不应渲染容器");
if (optionalSupplementsDocument.querySelector(".recommendation-guidance, .recommendation-module-note")) throw new Error("空的推荐补充说明不应渲染标签或容器");
if ([...optionalSupplementsDocument.querySelectorAll("#transport th")].some((cell) => cell.textContent.includes("核验"))) throw new Error("没有特殊核验信息时不应渲染交通核验列");
if (optionalSupplementsDocument.querySelector("#day-1 .day-overview")?.textContent.includes("；")) throw new Error("没有住宿备注时不应保留分隔符");

const withoutSightCategory = structuredClone(optionalSupplements);
withoutSightCategory.recommendations = withoutSightCategory.recommendations.filter((item) => item.category !== "景点指南");
const withoutSightHtmlFile = path.join(temp, "without-sight-category.html");
run([renderer, write("without-sight-category.json", withoutSightCategory), withoutSightHtmlFile]);
const withoutSightDocument = new JSDOM(fs.readFileSync(withoutSightHtmlFile, "utf8")).window.document;
const emptySightModule = [...withoutSightDocument.querySelectorAll(".recommendation-module")].find((module) => module.querySelector("h3 span")?.textContent === "景点指南");
if (!emptySightModule || emptySightModule.querySelector(".recommendation-item") || /暂无|不适用|待核验/.test(emptySightModule.textContent)) throw new Error("固定推荐模块在没有有效内容时应保留空列表且不生成填充文字");

for (const [pathLabel, mutate] of [
  ["逐日风险", (data) => { data.days[0].risks = ["下雨要带伞"]; }],
  ["逐日替代", (data) => { data.days[0].alternatives = ["下雨改室内活动"]; }],
  ["时间空话", (data) => { data.days[0].risks = ["时间要看赶不赶得上"]; }],
  ["门票常识", (data) => { data.days[0].risks = ["进去要买门票"]; }],
  ["交通核验", (data) => { data.transport[0].verification = "以运营商公告为准"; }],
  ["推荐执行", (data) => { data.recommendations[0].executionAdvice = "排队时错峰"; }],
  ["整体备注", (data) => { data.recommendationNotes = [{ category: "景点指南", text: "出门前看天气", sourceIds: [9] }]; }]
]) {
  const generic = structuredClone(optionalSupplements); mutate(generic);
  const genericResult = run([validator, write(`generic-${pathLabel}.json`, generic), "--stage=content"], 1);
  if (!`${genericResult.stdout}${genericResult.stderr}`.includes("不改变本次行程判断或行动")) throw new Error(`未拦截${pathLabel}中的通用提示`);
}

const disabledSourceIndex = structuredClone(content); disabledSourceIndex.features.sourceIndex = false;
run([validator, write("disabled-source-index.json", disabledSourceIndex), "--stage=content"]);

const missingIndexedSource = structuredClone(content); missingIndexedSource.sourceIndex.pop();
run([validator, write("missing-indexed-source.json", missingIndexedSource), "--stage=content"]);

const placeholder = structuredClone(content); placeholder.days[0].items[0].links = [{ label: "占位链接", url: "https://www.example.com/x" }];
const placeholderResult = run([validator, write("placeholder.json", placeholder), "--stage=content"], 1);
if (!`${placeholderResult.stdout}${placeholderResult.stderr}`.includes("示例域名")) throw new Error("未拦截 www 子域示例域名");

const sandwich = structuredClone(content);
sandwich.days[0].items.splice(1, 0, { id: "d1-note", type: "note", placeId: "", title: "备用提醒", activity: "视情况执行", details: [], notes: [], links: [], calendarHighlight: false, startTime: "", endTime: "", timeText: "上午备用", travelMinutes: 0, stayMinutes: 0, transportMode: "walk", breakGroundRoute: false, reservationStatus: "none", sourceIds: [1] });
sandwich.days[0].items[2].startTime = "09:30"; sandwich.days[0].items[2].endTime = "11:30";
const sandwichResult = run([validator, write("sandwich-overlap.json", sandwich), "--stage=content"], 1);
if (!`${sandwichResult.stdout}${sandwichResult.stderr}`.includes("时间条目冲突")) throw new Error("未识别夹无时间条目的时间重叠");

console.log("通过：2.0 结构化流水线、执行联动标记与时间冲突门禁");
