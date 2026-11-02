#!/usr/bin/env node
/* 增量防误伤三道门禁回归：
   门禁1 validate-trip-data.js --baseline + --allow-paths JSON 级冻结 diff
   门禁2 render-guide.js --baseline-html + --frozen-modules 冻结模块哈希校验（fail/restore）
   门禁3 render-guide.js 基线 HTML 模板版本一致性 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const skillRoot = path.resolve(__dirname, "..");
const validator = path.join(skillRoot, "scripts", "validate-trip-data.js");
const renderer = path.join(skillRoot, "scripts", "render-guide.js");
const { extractModuleFragment, normalizeFragment, checkFrozenModules, assertBaselineTemplateVersion } = require("./render-guide.js");
const { scanElementBlock } = require("./html-fragment.js");
const { diffJsonPaths, isPathCovered } = require("./validate-trip-data.js");
const { PAGE_TEMPLATE_VERSION } = require("./shared-constants.js");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "travel-guide-v2-gates-"));
fs.mkdirSync(path.join(temp, 'images'));
fs.writeFileSync(path.join(temp, 'images/cover.jpg'), Buffer.from('synthetic image fixture'));

const features = { arrivalDeparture: false, exchange: false, weather: false, sourceIndex: true, dayMap: true, dayNavigation: true, calendarExport: true, expenseTracker: true };
const meta = { title: "门禁测试攻略", subtitle: "增量防误伤", destination: "测试城市", origin: "上海", datePolicy: "fixed", dates: ["2026-09-01"], dateDisplay: "2026年9月1日", travelers: { count: 1, profiles: ["成人"] }, budgetBasis: "单人 CNY", theme: "ink", routeSummary: "中央车站 → 城市公园", hero: { title: "城园初行", subtitle: "从中央车站出发，经城市街区步行前往城市公园，以轻量城市漫步收束。", cover: { src: "images/cover.jpg", alt: "测试城市封面" } } };
const sources = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, type: "xiaohongshu", scope: "general", title: `测试笔记 ${index + 1}`, url: `https://www.xiaohongshu.com/explore/test-note-${index + 1}`, topics: ["城市"], cities: ["测试城市"], verificationStatus: "游客经验" }));
const audit = { status: "completed", xiaohongshuRequiredCount: 10, xiaohongshuReadCount: 10, arrivalDepartureRequiredCount: 0, arrivalDepartureReadCount: 0, xiaohongshuShortfallReason: "", arrivalDepartureShortfallReason: "不适用" };
const content = {
  schemaVersion: "2.0", stage: "content", meta, features,
  calendar: { mode: "daily" },
  places: [
    { id: "central-station", name: "中央车站", localName: "Central Station", searchName: "Central Station", city: "测试城市", country: "测试国", address: "中心路1号", coordinates: { latitude: 31.23, longitude: 121.47 }, verificationStatus: "已核验", sourceIds: [1] },
    { id: "city-park", name: "城市公园", localName: "City Park", searchName: "City Park", city: "测试城市", country: "测试国", address: "公园路1号", coordinates: { latitude: 31.24, longitude: 121.49 }, verificationStatus: "已核验", sourceIds: [1] }
  ],
  route: { stopIds: ["central-station", "city-park"], legs: [{ fromPlaceId: "central-station", toPlaceId: "city-park", mode: "walk", duration: "30分钟", durationMinutes: 30, color: "#2563a8", breakGroundRoute: false, sourceIds: [2] }] },
  days: [{ dayNumber: 1, date: "2026-09-01", city: "测试城市", theme: "抵达与城市漫步", kind: "arrival", intensity: { score: 3.0 }, accommodation: { label: "中央车站附近住宿", startPlaceId: "central-station", endPlaceId: "central-station", status: "checkin", note: "待入住" }, items: [
    { id: "d1-station", type: "place", placeId: "central-station", title: "中央车站", activity: "抵达并寄存行李", details: [], notes: [], links: [], calendarHighlight: true, startTime: "09:00", endTime: "10:00", timeText: "", travelMinutes: 0, stayMinutes: 60, transportMode: "walk", breakGroundRoute: false, reservationStatus: "none", sourceIds: [3] },
    { id: "d1-park", type: "place", placeId: "city-park", title: "城市公园", activity: "步行游览", details: [], notes: [], links: [], calendarHighlight: true, startTime: "10:30", endTime: "12:00", timeText: "", travelMinutes: 30, stayMinutes: 90, transportMode: "walk", breakGroundRoute: false, reservationStatus: "none", sourceIds: [4] }
  ], food: ["午餐在公园东门的本地面食店"], risks: ["公园 11:30 停止入园；晚于该时间抵达时删除公园段。"], alternatives: ["若公园因活动封闭，改去城市博物馆，步行增加 15 分钟。"], calendarNotes: ["公园 11:30 停止入园。"], sourceIds: [5] }],
  transport: [{ from: "中央车站", to: "城市公园", departureWindow: "10:00", arrivalWindow: "10:30", mode: "步行", duration: "30分钟", cost: "0 CNY", verification: "9 月 1 日东门施工；改走南门会增加 10 分钟。", sourceIds: [6] }],
  budget: { baseCurrency: "CNY", targetCurrencies: [], items: [{ name: "住宿", min: 400, max: 600, currency: "CNY", note: "一晚", sourceIds: [7] }], total: { min: 400, max: 600, currency: "CNY" }, notes: ["不含购物"] },
  recommendations: [
    { id: "sight", category: "景点指南", name: "城市博物馆", reason: "理解城市历史", travelerFit: "适合文化偏好", timing: "下午", routeRelation: "市中心", duration: "2小时", reservation: "建议预约", limit: "周一闭馆；本次若调整到周一则不能加入。", executionAdvice: "若 16:00 后抵达，只看一层常设展。", sourceIds: [9] },
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
  bookingLedger: [],
  checklist: [{ id: "ticket", category: "交通与预约", text: "核验车票", sourceIds: [1] }],
  weather: { enabled: false, startDate: "", endDate: "", locations: [] },
  arrivalDeparture: null, sources, sourceIndex: sources.map((source) => ({ sourceId: source.id, title: source.title, cities: source.cities, tags: ["城市", "步行", "交通", "车站", "路线", "餐饮", "住宿", "预约", "天气", "避坑"], searchHints: ["城市交通路线", "景点执行提醒"] })), researchAudit: audit
};

const write = (name, data) => { const file = path.join(temp, name); fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2), "utf8"); return file; };
const run = (args, expect = 0) => { const result = spawnSync(process.execPath, args, { encoding: "utf8" }); if (result.status !== expect) throw new Error(`期望退出码 ${expect}，实际 ${result.status}\n${args.join(" ")}\n${result.stdout}\n${result.stderr}`); return result; };
const combined = (result) => `${result.stdout || ""}${result.stderr || ""}`;

/* ---------- 门禁1 单元：深度 diff 与白名单 ---------- */
const diffChanges = diffJsonPaths({ a: 1, b: { c: [1, 3, 5] }, e: true }, { a: 1, b: { c: [1, 2] } });
["b.c.length", "b.c[1]", "b.c[2]", "e"].forEach((p) => { if (!diffChanges.includes(p)) throw new Error(`diffJsonPaths 缺少 ${p}`); });
if (diffChanges.includes("a")) throw new Error("diffJsonPaths 误报未变化路径");
if (!isPathCovered("b.c[1]", ["b"]) || !isPathCovered("days", ["days"]) || !isPathCovered("days[0].items", ["days"])) throw new Error("isPathCovered 父路径覆盖失败");
if (isPathCovered("daysX", ["days"]) || isPathCovered("days[0]", ["day"])) throw new Error("isPathCovered 出现前缀误匹配");

/* ---------- 基线制品 ---------- */
const baselineJson = write("baseline-trip-data.json", content);
const baselineHtmlFile = path.join(temp, "baseline-guide.html");
run([renderer, baselineJson, baselineHtmlFile]);
// Rendering a legacy input pins its existing identity; further fixture edits retain it.
content.meta.guideId = JSON.parse(fs.readFileSync(baselineJson, "utf8")).meta.guideId;
const baselineHtml = fs.readFileSync(baselineHtmlFile, "utf8");

/* ---------- 门禁1 端到端 ---------- */
// 1a 提供 baseline 但未声明 allow-paths → 拦截
const noAllow = run([validator, baselineJson, "--stage=content", `--baseline=${baselineJson}`], 1);
if (!combined(noAllow).includes("--allow-paths")) throw new Error("未声明白名单时未要求 --allow-paths");
// 1b 白名单外路径被改 → 拦截并列出路径
const stray = structuredClone(content); stray.days[0].items[0].title = "中央车站（被误改）";
const strayFile = write("stray.json", stray);
const strayResult = run([validator, strayFile, "--stage=content", `--baseline=${baselineJson}`, "--allow-paths=checklist"], 1);
if (!combined(strayResult).includes("days[0].items[0].title")) throw new Error("越界路径未被逐条列出");
// 1c 白名单内变更 → 放行
const allowed = structuredClone(content); allowed.checklist[0].text = "核验车票与班次";
const allowedFile = write("allowed.json", allowed);
run([validator, allowedFile, "--stage=content", `--baseline=${baselineJson}`, "--allow-paths=checklist"]);

/* ---------- 门禁2 端到端 ---------- */
// 2a 合法增量：白名单内改 checklist，冻结 itinerary/route-map → equal 通过
const incrHtml = path.join(temp, "incr.html");
run([renderer, allowedFile, incrHtml, `--baseline=${baselineJson}`, "--allow-paths=checklist", `--baseline-html=${baselineHtmlFile}`, "--frozen-modules=itinerary,route-map"]);
const incrReport = JSON.parse(fs.readFileSync(path.join(temp, "incr.validation.json"), "utf8"));
if (incrReport.frozenModules.status !== "enforced") throw new Error("验证报告缺少 frozenModules enforced 明细");
if (incrReport.frozenModules.modules.itinerary.status !== "equal" || incrReport.frozenModules.modules["route-map"].status !== "equal") throw new Error("未漂移的冻结模块应标记 equal");
// 2b 构造漂移基线（模拟变体渲染器改写了逐日行程，但模板版本属性未变）
const driftedBaseline = write("drifted-baseline.html", baselineHtml.replace("逐日行程</h2>", "逐日行程</h2><p>变体注入内容</p>"));
const blockedOut = path.join(temp, "blocked.html");
const blocked = run([renderer, baselineJson, blockedOut, `--baseline-html=${driftedBaseline}`, "--frozen-modules=itinerary"], 1);
if (!combined(blocked).includes("门禁2")) throw new Error("漂移未被门禁2 拦截");
if (fs.existsSync(blockedOut)) throw new Error("门禁2 拦截时不应写出交付 HTML");
const blockedReport = JSON.parse(fs.readFileSync(path.join(temp, "blocked.validation.json"), "utf8"));
if (blockedReport.frozenModules.modules.itinerary.status !== "drifted-blocked") throw new Error("报告应记录 drifted-blocked");
// 2c 授权 restore：整段还原基线片段，其余模块保持新渲染
const restoredOut = path.join(temp, "restored.html");
run([renderer, baselineJson, restoredOut, `--baseline-html=${driftedBaseline}`, "--frozen-modules=itinerary", "--freeze-action=restore"], 1);
if (fs.existsSync(restoredOut)) throw new Error("脱节还原不应写出成品");
// 2d 基线中不存在的新增模块不受冻结约束
const addedCheck = checkFrozenModules(baselineHtml.replace("</main>", '<section data-guide-module="arrival"><h2>到达 / 离开</h2></section></main>'), baselineHtml, ["itinerary", "arrival"], "fail");
if (!addedCheck.passed || addedCheck.modules.arrival.status !== "added") throw new Error("新增模块应标记 added 且不阻断");

/* ---------- 门禁3 端到端 ---------- */
// 3a 基线模板版本落后 → 拦截
const staleVersion = "0." + PAGE_TEMPLATE_VERSION.replace(/\./g, "");
const oldVersionBaseline = write("old-version-baseline.html", baselineHtml.replace(`data-guide-template-version="${PAGE_TEMPLATE_VERSION}"`, `data-guide-template-version="${staleVersion}"`));
const g3a = run([renderer, baselineJson, path.join(temp, "g3a.html"), `--baseline-html=${oldVersionBaseline}`, "--frozen-modules=itinerary"], 1);
if (!combined(g3a).includes("门禁3")) throw new Error("模板版本不一致未被门禁3 拦截");
// 3b 基线缺少模板版本属性 → 拦截
const noVersionBaseline = write("no-version-baseline.html", baselineHtml.replace(/ data-guide-template-version="[^"]*"/, ""));
const g3b = run([renderer, baselineJson, path.join(temp, "g3b.html"), `--baseline-html=${noVersionBaseline}`, "--frozen-modules=itinerary"], 1);
if (!combined(g3b).includes("门禁3")) throw new Error("缺失模板版本属性未被门禁3 拦截");
// 3b+ 模板升级只做 JSON 内容连续性比较，不把旧版 DOM 冻结到新版。
const crossVersionOut = path.join(temp, "cross-version.html");
run([renderer, allowedFile, crossVersionOut, `--baseline=${baselineJson}`, "--allow-paths=checklist", `--baseline-html=${oldVersionBaseline}`]);
const crossVersionReport = JSON.parse(fs.readFileSync(path.join(temp, "cross-version.validation.json"), "utf8"));
if (crossVersionReport.contentContinuity.status !== "enforced" || !crossVersionReport.contentContinuity.baselineDataSha256 || !crossVersionReport.contentContinuity.baselineHtmlSha256) throw new Error("跨模板升级缺少内容连续性证明");
if (!fs.readFileSync(crossVersionOut, "utf8").includes(`<meta name="guide-content-sha256" content="${crossVersionReport.contentContinuity.inputContentSha256}">`)) throw new Error("网页未携带与本次 JSON 对应的内容指纹");
if (crossVersionReport.frozenModules.status === "enforced") throw new Error("跨模板升级不得冻结旧版 DOM");
// 3c frozen-modules 未配 baseline-html → 参数错误
const g3c = spawnSync(process.execPath, [renderer, baselineJson, path.join(temp, "g3c.html"), "--frozen-modules=itinerary"], { encoding: "utf8" });
if (g3c.status !== 2 || !combined(g3c).includes("--baseline-html")) throw new Error("缺少 --baseline-html 时应报参数错误");

/* ---------- 边界补充 ---------- */
// 4a --allow-paths 无 --baseline：仅告警，不拦截
const warnOnly = run([validator, baselineJson, "--stage=content", "--allow-paths=checklist"]);
if (!combined(warnOnly).includes("仅在与 --baseline 同时提供时生效")) throw new Error("无基线时应对 allow-paths 输出告警");
// 4b 新渲染结果缺少冻结模块（restore 模式同样判漂移，不静默通过）
const htmlWithoutItinerary = baselineHtml.replace(extractModuleFragment(baselineHtml, "itinerary"), "");
const missingModule = checkFrozenModules(htmlWithoutItinerary, baselineHtml, ["itinerary"], "restore");
if (missingModule.passed || missingModule.modules.itinerary.status !== "drifted-blocked") throw new Error("缺少冻结模块应判 drifted-blocked");
// 4c 模块名含正则特殊字符：不误匹配、不崩溃
if (extractModuleFragment(baselineHtml, "itin.rary") !== null) throw new Error("含点号的模块名不得误匹配");
if (extractModuleFragment(baselineHtml, "itinerary(") !== null) throw new Error("非法模块名应安全返回 null");
// 4d head 伪造版本属性无法欺骗门禁3（只认 body 标签属性）
const spoofed = `<!doctype html><html><head><!-- data-guide-template-version="${PAGE_TEMPLATE_VERSION}" --></head><body data-guide-template-version="9.9.9"></body></html>`;
let spoofBlocked = false;
try { assertBaselineTemplateVersion(spoofed, "spoofed.html"); } catch (error) { spoofBlocked = /门禁3/.test(error.message); }
if (!spoofBlocked) throw new Error("head 伪造版本属性必须被门禁3 拦截");
assertBaselineTemplateVersion(baselineHtml, "baseline.html"); // 正常基线应放行
// 4e restore 还原项必须携带“与 JSON 脱节”告警 note
const restoreNote = checkFrozenModules(baselineHtml.replace("逐日行程</h2>", "逐日行程</h2><p>新渲染差异</p>"), baselineHtml, ["itinerary"], "restore");
if (restoreNote.modules.itinerary.status !== "drifted-restored" || !/不再对应当前 trip-data\.json/.test(restoreNote.modules.itinerary.note || "")) throw new Error("restore 报告必须标注与真相源脱节");
// 4f 未知功能键触发告警（不拦截）
const unknownFeature = structuredClone(content); unknownFeature.features.itineraryFilter = false;
const unknownFeatureResult = run([validator, write("unknown-feature.json", unknownFeature), "--stage=content"]);
if (!combined(unknownFeatureResult).includes("未知功能键")) throw new Error("未知功能键应被告警");
// 4g 冻结模块名拼错必须以退出码2拒绝，防止保护静默失效
const typo = spawnSync(process.execPath, [renderer, baselineJson, path.join(temp, "typo.html"), `--baseline-html=${baselineHtmlFile}`, "--frozen-modules=itinrrary"], { encoding: "utf8" });
if (typo.status !== 2 || !combined(typo).includes("未知模块名")) throw new Error("拼错的冻结模块名必须以退出码2拒绝");
// 4h --allow-date-removal 缺少 --baseline-html 时以退出码2拒绝
const dateRemoval = spawnSync(process.execPath, [renderer, baselineJson, path.join(temp, "date-removal.html"), "--allow-date-removal"], { encoding: "utf8" });
if (dateRemoval.status !== 2 || !combined(dateRemoval).includes("--allow-date-removal 只能与 --baseline-html 一起使用")) throw new Error("--allow-date-removal 参数组合未前置校验");

console.log("通过：增量防误伤三道门禁（JSON 冻结 diff、冻结模块校验与还原、模板版本一致性）");
