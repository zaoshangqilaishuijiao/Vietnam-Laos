#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { TextDecoder, isDeepStrictEqual } = require("util");

const { DAY_MS, parseIsoDate } = require("./date-utils.js");
const { XHS_GENERAL_REQUIRED_COUNT, XHS_ARRIVAL_DEPARTURE_REQUIRED_COUNT, GUIDE_DATA_VERSION, RECOMMENDATION_CATEGORIES, LOCAL_KNOWLEDGE_CATEGORIES, GUIDE_THEMES } = require("./shared-constants.js");
const { readOption, readCsvOption } = require("./cli-options.js");
const { safeFlightDetailUrl, sanitizeFlightAirport } = require("./flight-record-rules.js");
const { validateStructure } = require("./schema-validator.js");
const { legacyNearbyDay, validateNearbyPolicy } = require("./nearby-policy.js");

const DATE_POLICIES = new Set(["fixed", "explicit", "season", "undated"]);
const { validateXiaohongshuIdentities } = require("./xiaohongshu-identity.js");
const SOURCE_TYPES = new Set(["xiaohongshu", "official", "local", "other"]);
const DAY_KINDS = new Set(["arrival", "city", "daytrip", "transfer", "mountain", "flex", "departure"]);
const ITEM_TYPES = new Set(["place", "transport", "reservation", "note"]);
const RESERVATION_STATUSES = new Set(["none", "pending", "confirmed", "verify"]);
const ACCOMMODATION_STATUSES = new Set(["stay", "checkin", "checkout", "transfer", "none"]);
const CALENDAR_MODES = new Set(["daily", "timed"]);
const FEATURE_KEYS = ["arrivalDeparture", "exchange", "weather", "sourceIndex", "dayMap", "dayNavigation", "calendarExport", "expenseTracker"];
const EXACT_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const FLEXIBLE_TIME_MAX_LENGTH = 24;
const GENERIC_TRAVELER_FIT_PATTERNS = [
  /主线完成后仍有时间.*补充目的地辨识度/,
  /适合想(?:要)?(?:进一步|深度)?体验(?:当地|目的地).*(?:人|旅行者)/
];
const NON_ACTIONABLE_SUPPLEMENT_PATTERNS = [
  /^下雨(?:时)?(?:记得|要|需)?带伞$/,
  /^(?:出发|出门)(?:前)?(?:记得|要|需)?(?:查看|看|确认|留意)(?:一下)?天气(?:预报)?$/,
  /^(?:临近)?出发(?:前)?(?:查看|核验|确认|留意)天气(?:预报)?$/,
  /^(?:注意|留意)(?:行程)?时间(?:安排)?(?:避免(?:迟到|赶不上))?$/,
  /^(?:根据|视)现场(?:情况|条件)?(?:灵活)?调整$/,
  /^灵活调整(?:行程|路线|时间|安排)?$/,
  /^合理安排(?:行程|时间)?$/,
  /^以(?:现场|实际|运营商公告)(?:情况)?为准$/,
  /^(?:景点|入场|进入|进去|进门)?(?:需要|需|要)(?:提前)?(?:购买|买)门票$/,
  /^(?:时间)?(?:要|需)?看(?:看)?赶不赶得上$/,
  /^(?:注意|查看|确认)(?:一下)?(?:时间)?(?:是否|能否)?赶得上$/,
  /^(?:不需要|无需)预(?:约|定)(?:外带)?$/,
  /^排队(?:时)?(?:建议)?错峰$/,
  /^(?:下雨|雨天)(?:时)?(?:改|改为|替换为?|改走)?(?:室内活动)?$/,
  /^(?:开放状态和交通接驳|天气与现场条件|营业时间和排队情况)在出发前核验$/,
  /^当天确认道路$/
];

function normalizeSupplement(value) {
  return String(value || "").trim().replace(/[\s，。；：、,.!?！？;:（）()]/g, "");
}

function isNonActionableSupplement(value) {
  const normalized = normalizeSupplement(value);
  return normalized.length > 0 && NON_ACTIONABLE_SUPPLEMENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function readUtf8Json(file) {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file));
  if (source.charCodeAt(0) === 0xfeff) throw new Error("文件不得包含 UTF-8 BOM");
  return JSON.parse(source);
}

function decodeRoadEndpoints(encoded) {
  let index = 0, lat = 0, lng = 0;
  const points = [];
  const read = () => {
    let value = 0, shift = 0, byte;
    do {
      if (index >= encoded.length) throw new Error("折线不完整");
      byte = encoded.charCodeAt(index++) - 63;
      value |= (byte & 31) << shift; shift += 5;
      if (shift > 30) throw new Error("折线编码异常");
    } while (byte >= 32);
    return value & 1 ? ~(value >> 1) : value >> 1;
  };
  while (index < encoded.length) {
    lat += read(); lng += read();
    if (Math.abs(lat) > 9000000 || Math.abs(lng) > 18000000) throw new Error("折线坐标越界");
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  if (points.length < 2) throw new Error("折线不足两个坐标");
  return { first: points[0], last: points.at(-1) };
}

/* 门禁1 工具：深度对比新旧数据，输出全部变化路径。
   数组按下标对齐；长度变化记为 <path>.length；对象增删键记为 <path>.<key>。
   顶层键无前导点（如 arrivalDeparture、days[0].items[1].title）。 */
function diffJsonPaths(newValue, oldValue, prefix = "", changes = []) {
  const join = (segment) => prefix ? `${prefix}${segment.startsWith("[") ? "" : "."}${segment}` : segment;
  const sameType = Array.isArray(newValue) === Array.isArray(oldValue)
    && newValue !== null && oldValue !== null
    && typeof newValue === typeof oldValue;
  if (!sameType) {
    if (JSON.stringify(newValue) !== JSON.stringify(oldValue)) changes.push(prefix || "$");
    return changes;
  }
  if (Array.isArray(newValue)) {
    if (newValue.length !== oldValue.length) changes.push(join("length"));
    const max = Math.max(newValue.length, oldValue.length);
    for (let index = 0; index < max; index += 1) {
      if (index >= newValue.length || index >= oldValue.length) { changes.push(join(`[${index}]`)); continue; }
      diffJsonPaths(newValue[index], oldValue[index], join(`[${index}]`), changes);
    }
    return changes;
  }
  if (typeof newValue === "object") {
    const keys = new Set([...Object.keys(newValue), ...Object.keys(oldValue)]);
    keys.forEach((key) => {
      if (!(key in newValue) || !(key in oldValue)) { changes.push(join(key)); return; }
      diffJsonPaths(newValue[key], oldValue[key], join(key), changes);
    });
    return changes;
  }
  if (newValue !== oldValue) changes.push(prefix || "$");
  return changes;
}

/* 门禁1 工具：白名单按“精确匹配或父路径前缀”覆盖变化路径。
   例如 allow=arrivalDeparture 覆盖 arrivalDeparture.arrival[0].when。 */
function isPathCovered(changePath, allowPaths) {
  return allowPaths.some((allowed) => changePath === allowed
    || changePath.startsWith(allowed + ".")
    || changePath.startsWith(allowed + "["));
}

function findUncoveredFlightDates(flights, includedDates, excludedDates) {
  const covered = new Set([...(includedDates || []), ...(excludedDates || [])]);
  const uncovered = [];
  (flights || []).forEach((flight, index) => {
    ["departureDate", "arrivalDate"].forEach((field) => {
      const date = flight?.[field];
      if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && !covered.has(date)) {
        uncovered.push({ index, field, date });
      }
    });
  });
  return uncovered;
}

function validateTripData(data, options = {}) {
  const failures = [];
  const warnings = [];
  const fail = (message) => failures.push(message);
  const warn = (message) => warnings.push(message);
  const stage = options.stage || data?.stage;
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  const string = (value) => typeof value === "string" && value.trim().length > 0;
  const array = (value) => Array.isArray(value);
  const validDate = (value) => parseIsoDate(value) !== null;
  const unique = (items) => new Set(items).size === items.length;
  const requireArray = (value, label) => { if (!array(value)) fail(`${label} 必须是数组。`); return array(value) ? value : []; };
  const requireString = (value, label) => { if (!string(value)) fail(`${label} 必须是非空字符串。`); };
  const checkSupplement = (value, label) => {
    if (isNonActionableSupplement(value)) fail(`${label} 是不改变本次行程判断或行动的通用提示；请补充具体触发条件、影响与动作，或直接删除。`);
  };
  const optionalSupplement = (value, label) => {
    if (value === undefined) return;
    if (typeof value !== "string") { fail(`${label} 必须是文本。`); return; }
    if (!value.trim()) return;
    checkSupplement(value, label);
  };
  const dateList = requireArray(data?.meta?.dates, "meta.dates");
  const dateExclusions = requireArray(data?.meta?.dateExclusions ?? [], "meta.dateExclusions");

  if (!object(data)) return { valid: false, failures: ["JSON 根节点必须是对象。"], warnings, summary: {} };

  // Schema 前置结构校验：快速拦截缺少顶层键或类型错误，按阶段判断必填字段
  const schemaErrors = validateStructure(data, stage);
  schemaErrors.forEach((msg) => fail(msg));

  const templateMarkers = [
    { label: "示例前缀", test: (value) => /示例[:：]/.test(value) },
    { label: "模板标题", test: (value) => value.includes("待填写旅行攻略") },
    { label: "示例域名", test: (value) => /(?:^|\/\/|\.)example\.(?:com|org|net|edu|io)(?:[\/:?#]|$)/i.test(value) },
    { label: "示例标识", test: (value) => /(?:^|[^a-z0-9])example[-_\s][a-z0-9-]+/i.test(value) }
  ];
  const scanTemplateMarkers = (value, label = "$") => {
    if (typeof value === "string") {
      templateMarkers.forEach((marker) => {
        if (marker.test(value)) fail(`${label} 仍包含${marker.label}，请替换或删除模板占位内容。`);
      });
      return;
    }
    if (Array.isArray(value)) value.forEach((item, index) => scanTemplateMarkers(item, `${label}[${index}]`));
    else if (object(value)) Object.entries(value).forEach(([key, item]) => scanTemplateMarkers(item, `${label}.${key}`));
  };
  scanTemplateMarkers(data);

  if (data.schemaVersion !== GUIDE_DATA_VERSION) fail(`schemaVersion 必须为 "${GUIDE_DATA_VERSION}"。`);
  if (!new Set(["request", "brief", "content"]).has(stage)) fail("stage 必须为 request、brief 或 content。");
  if (data.stage !== stage) fail(`文件 stage=${data.stage || "缺失"} 与校验阶段 ${stage || "缺失"} 不一致。`);
  if (!object(data.meta)) fail("缺少 meta 对象。");
  requireString(data?.meta?.title, "meta.title");
  if (data?.meta?.guideId !== undefined && !/^[A-Za-z0-9_-]{8,80}$/.test(data.meta.guideId)) fail("meta.guideId 必须为8–160位字母、数字、下划线或连字符。");
  requireString(data?.meta?.destination, "meta.destination");
  requireString(data?.meta?.origin, "meta.origin");
  requireString(data?.meta?.budgetBasis, "meta.budgetBasis");
  const guideThemeIds = GUIDE_THEMES.map(([id]) => id);
  if (data?.meta?.theme !== undefined && !guideThemeIds.includes(data.meta.theme)) fail(`meta.theme 必须为 ${guideThemeIds.join("、")} 之一；省略时默认使用 coast。`);
  if (stage === "content" && !object(data?.meta?.hero)) fail("完整攻略必须提供 meta.hero 图片封面配置。 ");
  if (data?.meta?.hero !== undefined) {
    const hero = data.meta.hero;
    if (!object(hero)) fail("meta.hero 必须是对象。");
    for (const key of ["title", "budgetLabel"]) if (hero?.[key] !== undefined) requireString(hero[key], `meta.hero.${key}`);
    for (const key of ["subtitle", "kicker"]) if (hero?.[key] !== undefined) requireString(hero[key], `meta.hero.${key}`);
    if (stage === "content") {
      requireString(hero?.title, "meta.hero.title");
      requireString(hero?.subtitle, "meta.hero.subtitle");
      if (string(hero?.title) && ([...hero.title.trim()].length < 2 || [...hero.title.trim()].length > 16)) fail("meta.hero.title 必须为2–16个字符的封面短标题。");
      if (string(hero?.subtitle) && ([...hero.subtitle.trim()].length < 12 || [...hero.subtitle.trim()].length > 100)) fail("meta.hero.subtitle 必须为12–100个字符的一句话路线摘要。");
      if (string(hero?.title) && hero.title.trim() === String(data.meta.title || "").trim()) fail("meta.hero.title 必须是独立的封面编辑短标题，不能直接重复 meta.title。");
      if (string(hero?.subtitle) && /[\r\n]/.test(hero.subtitle)) fail("meta.hero.subtitle 必须是一句话路线摘要，不能包含换行。");
      if (string(hero?.title) && !/^\p{Script=Han}{4}$/u.test(hero.title.trim())) warnings.push("meta.hero.title 建议优先使用四个汉字；不能自然成立时可保留更合适的精炼标题。");
    }
    if (stage === "content" && !object(hero.cover)) fail("meta.hero.cover 必须提供封面图片。 ");
    if (hero.cover !== undefined) {
      if (!object(hero.cover)) fail("meta.hero.cover 必须是对象。 ");
      else {
        ["src", "alt"].forEach((key) => requireString(hero.cover[key], `meta.hero.cover.${key}`));
        if (string(hero.cover.alt) && [...hero.cover.alt.trim()].length > 160) fail("meta.hero.cover.alt 最多160个字符。");
        if (string(hero.cover.src) && !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(hero.cover.src)) fail("meta.hero.cover.src 必须为安全的相对图片路径。 ");
      }
    }
    if (hero?.showLinks !== undefined && typeof hero.showLinks !== 'boolean') fail('meta.hero.showLinks 必须为布尔值。');
    const stages = hero?.stages === undefined ? [] : requireArray(hero.stages, "meta.hero.stages");
    if (hero?.stages !== undefined && (!stages.length || stages.length > 6)) fail("meta.hero.stages 必须为1–6个目的地入口。");
    stages.forEach((entry, index) => {
      const label = `meta.hero.stages[${index}]`;
      requireString(entry?.label, `${label}.label`); requireString(entry?.summary, `${label}.summary`);
      const nums = requireArray(entry?.dayNumbers, `${label}.dayNumbers`);
      if (!nums.length || !unique(nums) || nums.some((n,i) => !Number.isInteger(n) || n < 1 || (i > 0 && n <= nums[i-1]))) fail(`${label}.dayNumbers 必须为递增且不重复的日编号。`);
      if (stage === "content" && nums.some(n => !(data.days || []).some(day => day.dayNumber === n))) fail(`${label} 引用了不存在的行程日。`);
    });
  }
  if (data?.meta?.highlights !== undefined) {
    const highlights = requireArray(data.meta.highlights, "meta.highlights");
    if (highlights.length > 8) fail("meta.highlights 最多8项。");
    highlights.forEach((item, index) => {
      if (!string(item) || [...item.trim()].length > 24) fail(`meta.highlights[${index}] 必须为1–24字的短关键词。`);
    });
    if (!unique(highlights.map(item => typeof item === "string" ? item.trim() : item))) fail("meta.highlights 不得重复。");
  }
  if (!DATE_POLICIES.has(data?.meta?.datePolicy)) fail("meta.datePolicy 必须是 fixed、explicit、season 或 undated。");
  if (!dateList.every(validDate)) fail("meta.dates 必须全部是有效 YYYY-MM-DD。");
  if (!unique(dateList)) fail("meta.dates 不得重复。");
  if (dateList.join(",") !== [...dateList].sort().join(",")) fail("meta.dates 必须按时间升序排列。");
  if (data?.meta?.datePolicy === "fixed" && dateList.some((date, index) => index > 0 && (new Date(date + "T00:00:00Z") - new Date(dateList[index - 1] + "T00:00:00Z")) !== DAY_MS)) fail("fixed 日期策略的 meta.dates 必须是连续自然日；非连续行程使用 explicit。 ");
  if (["fixed", "explicit"].includes(data?.meta?.datePolicy) && !dateList.length) fail("明确日期策略必须提供 meta.dates。");
  if (["season", "undated"].includes(data?.meta?.datePolicy) && dateList.length) fail("season/undated 不应填写精确 meta.dates。");
  const excludedDateValues = [];
  dateExclusions.forEach((entry, index) => {
    const label = `meta.dateExclusions[${index}]`;
    if (!object(entry)) { fail(`${label} 必须是对象。`); return; }
    if (!validDate(entry.date)) fail(`${label}.date 必须为有效 YYYY-MM-DD。`);
    else excludedDateValues.push(entry.date);
    if (!["arrival", "departure", "transfer", "other"].includes(entry.scope)) fail(`${label}.scope 无效。`);
    requireString(entry.reason, `${label}.reason`);
  });
  if (!unique(excludedDateValues)) fail("meta.dateExclusions 日期不得重复。");
  const overlappingExcludedDates = excludedDateValues.filter((date) => dateList.includes(date));
  if (overlappingExcludedDates.length) fail(`meta.dateExclusions 不得与 meta.dates 重叠：${overlappingExcludedDates.join("、")}。`);
  if (!object(data?.meta?.travelers) || !Number.isInteger(data?.meta?.travelers?.count) || data.meta.travelers.count < 1) fail("meta.travelers.count 必须是正整数。");
  if (!array(data?.meta?.travelers?.profiles)) fail("meta.travelers.profiles 必须是数组。");
  if (!object(data.features)) fail("缺少 features 对象。");
  FEATURE_KEYS.forEach((key) => {
    if (typeof data?.features?.[key] !== "boolean") fail(`features.${key} 必须是布尔值。`);
  });
  if (data?.features?.contextualExplore !== undefined && typeof data.features.contextualExplore !== "boolean") fail("features.contextualExplore 必须是布尔值。");
  if (data?.features?.nearbyExplore !== undefined && typeof data.features.nearbyExplore !== "boolean") fail("features.nearbyExplore 必须是布尔值。");
  Object.keys(data?.features || {}).filter((key) => !FEATURE_KEYS.includes(key) && key !== "contextualExplore" && key !== "nearbyExplore").forEach((key) => {
    warn(`features.${key} 是未知功能键，校验器与渲染器只识别 ${FEATURE_KEYS.join("/")}；拼错的开关会被静默忽略。`);
  });

  // Decision coverage can supplement arrival/departure research, never waive the general ten-note minimum.
  const decisionCoverageComplete = (audit, sources) => {
    const required = ["路线节奏", "交通", "住宿", "预算", "预约", "安全", ...(data?.features?.arrivalDeparture ? ["入境"] : [])];
    const entries = Array.isArray(audit?.decisionCoverage) ? audit.decisionCoverage : [];
    return required.every(topic => entries.some(entry => entry.topic === topic && entry.status === "verified"
      && Array.isArray(entry.sourceIds) && entry.sourceIds.length > 0
      && entry.sourceIds.every(id => sources.some(source => source.id === id))
      && (!["交通", "预约", "安全", "入境"].includes(topic) || entry.sourceIds.some(id => sources.some(source => source.id === id && source.type === "official")))));
  };
  if (["request", "brief"].includes(stage)) {
    if (!object(data.requirements)) fail(`${stage} 缺少 requirements 对象。`);
    ["mustVisit", "avoid", "preferences", "constraints", "assumptions", "openQuestions"].forEach((key) => requireArray(data?.requirements?.[key], `requirements.${key}`));
    if (!object(data.researchPlan)) fail(`${stage} 缺少 researchPlan 对象。`);
    if (data?.researchPlan?.xiaohongshuTarget !== XHS_GENERAL_REQUIRED_COUNT) fail(`researchPlan.xiaohongshuTarget 必须为 ${XHS_GENERAL_REQUIRED_COUNT}。`);
    const arrivalTarget = data?.features?.arrivalDeparture ? XHS_ARRIVAL_DEPARTURE_REQUIRED_COUNT : 0;
    if (data?.researchPlan?.arrivalDepartureTarget !== arrivalTarget) fail(`researchPlan.arrivalDepartureTarget 必须为 ${arrivalTarget}。`);
    requireArray(data?.researchPlan?.officialTopics, "researchPlan.officialTopics");
  }

  if (stage === "brief") {
    if (!object(data.route)) fail("brief 缺少 route 对象。");
    requireString(data?.route?.summary, "route.summary");
    const stops = requireArray(data?.route?.stops, "route.stops");
    if (!stops.length) fail("brief.route.stops 至少需要一个有序停靠点。 ");
    stops.forEach((stop, index) => {
      if (object(stop)) requireString(stop.name, `route.stops[${index}].name`);
      else if (!string(stop)) fail(`route.stops[${index}] 必须是地点名称或对象。`);
    });
    const dayOutline = requireArray(data.dayOutline, "dayOutline");
    if (!dayOutline.length) fail("brief.dayOutline 至少需要一天的基础骨架。 ");
    dayOutline.forEach((day, index) => {
      if (!object(day)) { fail(`dayOutline[${index}] 必须是对象。`); return; }
      if (day.dayNumber !== index + 1) fail(`dayOutline[${index}].dayNumber 必须为 ${index + 1}。`);
      if (dateList.length && day.date !== dateList[index]) fail(`dayOutline[${index}].date 与 meta.dates 不一致。`);
      if (!dateList.length && day.date !== null && day.date !== "") fail(`无明确日期时 dayOutline[${index}].date 必须为空或 null。`);
      requireString(day.city, `dayOutline[${index}].city`);
      requireString(day.theme, `dayOutline[${index}].theme`);
    });
    if (dateList.length && dayOutline.length !== dateList.length) fail(`dayOutline 数量 ${dayOutline.length} 与 meta.dates 数量 ${dateList.length} 不一致。`);
    const researchSources = requireArray(data.researchSources, "researchSources");
    const researchUrls = [];
    researchSources.forEach((source, index) => {
      if (!object(source)) { fail(`researchSources[${index}] 必须是对象。`); return; }
      if (!Number.isInteger(source.id) || source.id < 1) fail(`researchSources[${index}].id 必须是正整数。`);
      if (!SOURCE_TYPES.has(source.type)) fail(`researchSources[${index}].type 无效。`);
      requireString(source.title, `researchSources[${index}].title`);
      if (!string(source.url) && source.type !== "local") fail(`researchSources[${index}].url 必须是原始链接。`);
      if (string(source.url) && !/^https?:\/\//i.test(source.url)) fail(`researchSources[${index}].url 必须是 http(s) 原始链接。`);
      if (string(source.url)) researchUrls.push(source.url.replace(/[),.;]+$/, ""));
      if (source.type === "xiaohongshu" && !/^https?:\/\/(?:www\.)?(?:xiaohongshu\.com|xhslink\.com)(?:\/|$)/i.test(source.url || "")) fail(`researchSources[${index}] 必须保存小红书原始笔记链接。`);
      if (!["general", "arrival-departure"].includes(source.scope || "general")) fail(`researchSources[${index}].scope 无效。`);
      requireArray(source.topics, `researchSources[${index}].topics`);
      requireArray(source.cities, `researchSources[${index}].cities`);
    });
    if (!unique(researchSources.map((source) => source?.id))) fail("researchSources.id 必须唯一。 ");
    const briefIdentityError = validateXiaohongshuIdentities(researchSources);
    if (briefIdentityError) fail(briefIdentityError);
    if (!unique(researchUrls)) fail("researchSources 原始链接必须去重。 ");
    if (researchSources.some((source, index) => source?.id !== index + 1)) fail("researchSources.id 必须按数组顺序从 1 连续递增。 ");
    if (!object(data.researchAudit)) fail("brief 缺少 researchAudit 对象。 ");
    if (data?.researchAudit?.status !== "completed") fail("研究尚未完成或已受阻，必须提示用户并暂停，不能生成基础方案。 ");
    const generalXhs = researchSources.filter((source) => source?.type === "xiaohongshu" && (source.scope || "general") === "general").length;
    const arrivalXhs = researchSources.filter((source) => source?.type === "xiaohongshu" && source.scope === "arrival-departure").length;
    if (data?.researchAudit?.xiaohongshuRequiredCount !== XHS_GENERAL_REQUIRED_COUNT || data?.researchAudit?.xiaohongshuReadCount !== generalXhs) fail("brief.researchAudit 的常规小红书数量与 researchSources 不一致。 ");
    if (generalXhs < XHS_GENERAL_REQUIRED_COUNT) fail(`必须实际读取至少 ${XHS_GENERAL_REQUIRED_COUNT} 篇去重的小红书攻略；未登录时提醒用户登录，补齐前不得完成研究或生成完整攻略。`);
    const requiredArrival = data?.features?.arrivalDeparture ? XHS_ARRIVAL_DEPARTURE_REQUIRED_COUNT : 0;
    if (data?.researchAudit?.arrivalDepartureRequiredCount !== requiredArrival || data?.researchAudit?.arrivalDepartureReadCount !== arrivalXhs) fail("brief.researchAudit 的到达/离开数量与 researchSources 不一致。 ");
    if (arrivalXhs < requiredArrival && (!decisionCoverageComplete(data.researchAudit, researchSources) || !string(data.researchAudit?.arrivalDepartureShortfallReason))) fail("到达/离开证据未覆盖，需补充官方核验。 ");
    if (!object(data.confirmation)) fail("brief 缺少 confirmation 对象。 ");
    if (!["pending", "confirmed", "skipped"].includes(data?.confirmation?.status)) fail("confirmation.status 必须是 pending、confirmed 或 skipped。 ");
    if (["confirmed", "skipped"].includes(data?.confirmation?.status) && !string(data?.confirmation?.note)) fail("确认或跳过确认时必须在 confirmation.note 记录用户决定。 ");
  }

  if (stage === "content") {
    requireString(data?.meta?.dateDisplay, "meta.dateDisplay");
    requireString(data?.meta?.routeSummary, "meta.routeSummary");
    const sourceList = requireArray(data.sources, "sources");
    const sourceIds = [];
    sourceList.forEach((source, index) => {
      if (!object(source)) { fail(`sources[${index}] 必须是对象。`); return; }
      if (!Number.isInteger(source.id) || source.id < 1) fail(`sources[${index}].id 必须是正整数。`);
      else sourceIds.push(source.id);
      if (!SOURCE_TYPES.has(source.type)) fail(`sources[${index}].type 无效。`);
      requireString(source.title, `sources[${index}].title`);
      if (!string(source.url) && source.type !== "local") fail(`sources[${index}].url 必须是原始链接。`);
      if (string(source.url) && !/^https?:\/\//i.test(source.url)) fail(`sources[${index}].url 必须是 http(s) 原始链接。`);
      if (source.type === "xiaohongshu" && !/^https?:\/\/(?:www\.)?(?:xiaohongshu\.com|xhslink\.com)(?:\/|$)/i.test(source.url || "")) fail(`sources[${index}] 必须保存小红书原始笔记链接。`);
      if (!new Set(["general", "arrival-departure"]).has(source.scope || "general")) fail(`sources[${index}].scope 无效。`);
      requireArray(source.topics, `sources[${index}].topics`);
      requireArray(source.cities, `sources[${index}].cities`);
      requireString(source.verificationStatus, `sources[${index}].verificationStatus`);
    });
    if (!unique(sourceIds)) fail("sources.id 必须唯一。");
    const sourceIdSet = new Set(sourceIds);
    const usedSourceIds = new Set();
    if (sourceIds.some((id, index) => id !== index + 1)) fail("sources.id 必须按数组顺序从 1 连续递增。 ");
    const checkRefs = (refs, label) => requireArray(refs, label).forEach((id) => {
      if (!Number.isInteger(id) || !sourceIdSet.has(id)) fail(`${label} 引用了不存在的来源 ID：${id}。`);
      else usedSourceIds.add(id);
    });
    const richRecommendations = data.features.contextualExplore === true || data.features.nearbyExplore === true;
    // A baseline preserves legacy research during copy-only edits, not new venues
    // or changed evidence. Nearby targets still undergo their independent checks.
    // Full contextual upgrades/new guides stay strict; every nearby target is also
    // checked independently below, even when its recommendation predates this update.
    const baseline = options.baseline;
    const legacyNearbyUpdate = data.features.nearbyExplore === true
      && data.features.contextualExplore !== true
      && baseline?.features?.contextualExplore !== true
      && string(data.meta?.guideId) && data.meta.guideId === baseline?.meta?.guideId;
    const preservedLegacy = [];
    // Citation numbers are labels. Match the complete source evidence before
    // comparing legacy records so pruning an unused source can renumber safely.
    const sourceEvidence = ({ id, ...evidence }) => evidence;
    const sourcesByUrl = new Map();
    sourceList.forEach(source => {
      const entries = sourcesByUrl.get(source.url) || [];
      entries.push(source); sourcesByUrl.set(source.url, entries);
    });
    const baselineSourceIds = new Map((baseline?.sources || []).map(source => {
      const matches = (sourcesByUrl.get(source.url) || []).filter(current =>
        isDeepStrictEqual(sourceEvidence(source), sourceEvidence(current)));
      return [source.id, matches.length === 1 ? matches[0].id : `unmatched-source:${source.id}`];
    }));
    const alignBaselineRefs = value => {
      if (Array.isArray(value)) return value.map(alignBaselineRefs);
      if (!object(value)) return value;
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
        key === "sourceId" ? (baselineSourceIds.get(child) ?? `unmatched-source:${child}`)
          : key === "sourceIds" && Array.isArray(child)
            ? child.map(id => baselineSourceIds.get(id) ?? `unmatched-source:${id}`)
            : alignBaselineRefs(child)]));
    };
    const baselineRecords = new Map(["recommendations", "venueSuggestions"].map(key => [key,
      new Map((baseline?.[key] || []).map(item => [item?.id, alignBaselineRefs(item)]))]));
    const baselinePlaces = new Map((baseline?.places || []).map(place => [place?.id, alignBaselineRefs(place)]));
    const baselineSources = new Map((baseline?.sources || []).map(source => [baselineSourceIds.get(source.id),
      { ...source, id: baselineSourceIds.get(source.id) }]));
    const currentPlaces = new Map((data.places || []).map(place => [place?.id, place]));
    const currentSources = new Map(sourceList.map(source => [source?.id, source]));
    const unchangedSources = (...nodes) => {
      const refs = new Set();
      const walk = node => {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!object(node)) return;
        if (Number.isInteger(node.sourceId)) refs.add(node.sourceId);
        if (Array.isArray(node.sourceIds)) node.sourceIds.filter(Number.isInteger).forEach(id => refs.add(id));
        Object.values(node).forEach(walk);
      };
      nodes.forEach(walk);
      return [...refs].every(id => isDeepStrictEqual(currentSources.get(id), baselineSources.get(id)));
    };
    const unchangedLegacyRecord = (module, item) => {
      if (!legacyNearbyUpdate || !string(item?.id)) return false;
      const old = baselineRecords.get(module)?.get(item.id);
      const displayCopy = module === "recommendations"
        ? new Set(["reason", "travelerFit", "timing", "routeRelation", "duration", "reservation", "limit", "executionAdvice"])
        : new Set();
      const evidence = record => Object.fromEntries(Object.entries(record).filter(([key]) => !displayCopy.has(key)));
      if (!old || !isDeepStrictEqual(evidence(old), evidence(item))) return false;
      const place = currentPlaces.get(item.placeId);
      if (item.placeId && !isDeepStrictEqual(place, baselinePlaces.get(item.placeId))) return false;
      return unchangedSources(item, place);
    };
    const checkSourcedImage = (image, label, required = false, requireXhs = richRecommendations) => {
      if (image === undefined) { if (required) fail(`${label} 必须提供已核实的地点图片。`); return; }
      if (!object(image)) { fail(`${label} 必须是对象。`); return; }
      requireString(image.src, `${label}.src`);
      requireString(image.alt, `${label}.alt`);
      if (string(image.src) && !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(image.src)) fail(`${label}.src 必须是安全的相对图片路径。`);
      const source = sourceList.find((entry) => entry.id === image.sourceId);
      if (!source) fail(`${label}.sourceId 必须对应已读取的原始来源。`);
      else {
        checkRefs([image.sourceId], `${label}.sourceId`);
        if (requireXhs && source.type !== "xiaohongshu") fail(`${label} 在现场探索模式下必须对应已阅读的小红书笔记。`);
        if (source.type === "xiaohongshu" && !string(source.author)) fail(`${label} 使用小红书图片时，sources[${image.sourceId - 1}].author 必须记录作者。`);
      }
    };

    const places = requireArray(data.places, "places");
    if (!places.length) fail("完整攻略至少需要一个 places 地点。");
    const placeIds = [];
    places.forEach((place, index) => {
      if (!object(place)) { fail(`places[${index}] 必须是对象。`); return; }
      ["id", "name", "localName", "searchName", "city", "country", "verificationStatus"].forEach((key) => requireString(place[key], `places[${index}].${key}`));
      if (string(place.id)) placeIds.push(place.id);
      if (place.usage !== undefined && !["itinerary", "suggestion"].includes(place.usage)) fail(`places[${index}].usage 无效。`);
      const unlocatedSuggestion = place.usage === "suggestion" && place.coordinates === null && place.navigationEnabled === false;
      if (!unlocatedSuggestion && (!object(place.coordinates) || !Number.isFinite(place.coordinates.latitude) || place.coordinates.latitude < -90 || place.coordinates.latitude > 90 || !Number.isFinite(place.coordinates.longitude) || place.coordinates.longitude < -180 || place.coordinates.longitude > 180)) fail(`places[${index}].coordinates 无效。`);
      checkRefs(place.sourceIds, `places[${index}].sourceIds`);
    });
    if (!unique(placeIds)) fail("places.id 必须唯一。");
    const placeIdSet = new Set(placeIds);
    const suggestionOnlyIds = new Set(places.filter(place => place.usage === "suggestion").map(place => place.id));
    const executionPlaceIds = [...(data.route?.stopIds || []), ...(data.route?.legs || []).flatMap(leg => [leg.fromPlaceId, leg.toPlaceId]), ...(data.days || []).flatMap(day => [day.accommodation?.startPlaceId, day.accommodation?.endPlaceId, ...(day.items || []).map(item => item.placeId)]), ...(data.weather?.locations || []).map(item => item.placeId), ...(data.bookingLedger || []).map(item => item.placeId)];
    if (executionPlaceIds.some(id => suggestionOnlyIds.has(id))) fail("仅供推荐的地点须先完成路线坐标核验并移除 suggestion 标记，才能加入执行行程。");
    if (data.venueSuggestions !== undefined) {
      const suggestions = requireArray(data.venueSuggestions, "venueSuggestions");
      const venueIds = [], venuePlaces = [];
      suggestions.forEach((item, index) => {
        const label = `venueSuggestions[${index}]`;
        ["id", "kind", "placeId", "reason", "timing", "bookingPolicy", "officialUrl", "checkedAt"].forEach(key => requireString(item?.[key], `${label}.${key}`));
        if (item?.bookingNote !== undefined) optionalSupplement(item.bookingNote, `${label}.bookingNote`);
        venueIds.push(item?.id); venuePlaces.push(item?.placeId);
        if (!placeIdSet.has(item?.placeId)) fail(`${label}.placeId 不存在。`);
        if (!["cafe", "shop", "restaurant"].includes(item?.kind)) fail(`${label}.kind 无效。`);
        if (!["not_required", "recommended", "required", "verify"].includes(item?.bookingPolicy)) fail(`${label}.bookingPolicy 无效。`);
        if (!/^https?:\/\//i.test(item?.officialUrl || "")) fail(`${label}.officialUrl 必须为 http(s) URL。`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(item?.checkedAt || "")) fail(`${label}.checkedAt 必须为日期。`);
        if (!Array.isArray(item?.sourceIds) || !item.sourceIds.length) fail(`${label}.sourceIds 不能为空。`);
        checkRefs(item?.sourceIds, `${label}.sourceIds`);
        const legacy = unchangedLegacyRecord("venueSuggestions", item);
        if (legacy && richRecommendations && !item?.image) preservedLegacy.push(`${label}.image`);
        checkSourcedImage(item?.image, `${label}.image`, richRecommendations && !legacy, richRecommendations && !legacy);
        requireArray(item?.menuItems ?? [], `${label}.menuItems`).forEach((menu, menuIndex) => {
          const menuLabel = `${label}.menuItems[${menuIndex}]`;
          requireString(menu?.name, `${menuLabel}.name`);
          requireString(menu?.reason, `${menuLabel}.reason`);
          checkRefs(menu?.sourceIds, `${menuLabel}.sourceIds`);
        });
      });
      if (!unique(venueIds) || !unique(venuePlaces)) fail("venueSuggestions 的 id 和 placeId 必须唯一。");
    }
    const stopIds = requireArray(data?.route?.stopIds, "route.stopIds");
    if (!stopIds.length) fail("route.stopIds 至少需要一个地点引用。");
    if (!unique(stopIds)) fail("route.stopIds 不得重复。");
    stopIds.forEach((id, index) => { if (!placeIdSet.has(id)) fail(`route.stopIds[${index}] 引用了不存在的 placeId：${id}。`); });
    const legs = requireArray(data?.route?.legs, "route.legs");
    if (legs.length !== Math.max(0, stopIds.length - 1)) fail(`route.legs 数量必须为相邻停靠点数量 ${Math.max(0, stopIds.length - 1)}。`);
    legs.forEach((leg, index) => {
      if (!object(leg)) { fail(`route.legs[${index}] 必须是对象。`); return; }
      if (!placeIdSet.has(leg.fromPlaceId) || !placeIdSet.has(leg.toPlaceId)) fail(`route.legs[${index}] 的 fromPlaceId/toPlaceId 必须指向 places。`);
      requireString(leg.mode, `route.legs[${index}].mode`);
      requireString(leg.duration, `route.legs[${index}].duration`);
      checkRefs(leg.sourceIds, `route.legs[${index}].sourceIds`);
    });
    for (let index = 0; index < Math.min(legs.length, Math.max(0, stopIds.length - 1)); index += 1) {
      if (legs[index]?.fromPlaceId !== stopIds[index] || legs[index]?.toPlaceId !== stopIds[index + 1]) fail(`route.legs[${index}] 未连接相邻行程停靠点。`);
    }

    const days = requireArray(data.days, "days");
    if (!days.length) fail("完整攻略至少需要一个 days 项。");
    const itemIds = [];
    const toMinutes = (value) => { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; };
    days.forEach((day, index) => {
      if (!object(day)) { fail(`days[${index}] 必须是对象。`); return; }
      if (day.dayNumber !== index + 1) fail(`days[${index}].dayNumber 必须为 ${index + 1}。`);
      if (dateList.length && day.date !== dateList[index]) fail(`days[${index}].date 与 meta.dates 不一致。`);
      if (!dateList.length && day.date !== null && day.date !== "") fail(`无明确日期时 days[${index}].date 必须为空或 null。`);
      requireString(day.city, `days[${index}].city`);
      requireString(day.theme, `days[${index}].theme`);
      if (day.routeNote !== undefined) optionalSupplement(day.routeNote, `days[${index}].routeNote`);
      if (day.routeNoteAvatar !== undefined) {
        if (typeof day.routeNoteAvatar !== "string" || !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(day.routeNoteAvatar)) fail(`days[${index}].routeNoteAvatar 必须为安全的相对图片路径。`);
        if (!string(day.routeNote)) fail(`days[${index}].routeNoteAvatar 需要同时设置 routeNote。`);
      }
      if (day.kind !== undefined && day.kind !== null && day.kind !== "" && !DAY_KINDS.has(day.kind)) fail(`days[${index}].kind 无效：${day.kind}；仅允许 ${[...DAY_KINDS].join("/")}。`);
      if (!object(day.intensity)) fail(`days[${index}].intensity 必须是对象。`);
      else if (!Number.isFinite(day.intensity.score) || day.intensity.score < 0 || day.intensity.score > 5 || !Number.isInteger(day.intensity.score * 2)) fail(`days[${index}].intensity.score 必须为 0–5 之间、按 0.5 递增的数字。`);
      const accommodation = day.accommodation;
      if (!object(accommodation)) fail(`days[${index}].accommodation 必须是对象。`);
      else {
        requireString(accommodation.label, `days[${index}].accommodation.label`);
        optionalSupplement(accommodation.note, `days[${index}].accommodation.note`);
        if (!ACCOMMODATION_STATUSES.has(accommodation.status)) fail(`days[${index}].accommodation.status 无效。`);
        ["startPlaceId", "endPlaceId"].forEach((key) => {
          if (accommodation[key] && !placeIdSet.has(accommodation[key])) fail(`days[${index}].accommodation.${key} 引用了不存在的 placeId。`);
        });
      }
      const items = requireArray(day.items, `days[${index}].items`);
      if (!items.length) fail(`days[${index}].items 不能为空。`);
      let previousTimed = null;
      items.forEach((item, itemIndex) => {
        const label = `days[${index}].items[${itemIndex}]`;
        if (!object(item)) { fail(`${label} 必须是对象。`); return; }
        requireString(item.id, `${label}.id`);
        if (string(item.id)) itemIds.push(item.id);
        if (!ITEM_TYPES.has(item.type)) fail(`${label}.type 无效。`);
        requireString(item.title, `${label}.title`);
        requireString(item.activity, `${label}.activity`);
        if (typeof item.calendarHighlight !== "boolean") fail(`${label}.calendarHighlight 必须是布尔值。`);
        requireArray(item.details ?? [], `${label}.details`).forEach((value, detailIndex) => requireString(value, `${label}.details[${detailIndex}]`));
        requireArray(item.notes ?? [], `${label}.notes`).forEach((value, noteIndex) => {
          requireString(value, `${label}.notes[${noteIndex}]`);
          checkSupplement(value, `${label}.notes[${noteIndex}]`);
        });
        requireArray(item.links ?? [], `${label}.links`).forEach((link, linkIndex) => {
          requireString(link?.label, `${label}.links[${linkIndex}].label`);
          requireString(link?.url, `${label}.links[${linkIndex}].url`);
          if (string(link?.url) && !/^https?:\/\//i.test(link.url)) fail(`${label}.links[${linkIndex}].url 必须是可直接打开的 http(s) 链接。`);
        });
        const referenceImages = requireArray(item.referenceImages ?? [], `${label}.referenceImages`);
        if (referenceImages.length > 4) fail(`${label}.referenceImages 最多包含 4 张图片。`);
        referenceImages.forEach((image, imageIndex) => {
          const imageLabel = `${label}.referenceImages[${imageIndex}]`;
          if (!object(image)) { fail(`${imageLabel} 必须是对象。`); return; }
          ["src", "title", "alt", "caption"].forEach((key) => requireString(image[key], `${imageLabel}.${key}`));
          if (string(image.src) && !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(image.src)) fail(`${imageLabel}.src 必须为安全的相对图片路径。`);
          if (string(image.title) && image.title.trim().length > 40) fail(`${imageLabel}.title 不得超过 40 个字符。`);
          if (string(image.alt) && image.alt.trim().length > 160) fail(`${imageLabel}.alt 不得超过 160 个字符。`);
          if (string(image.caption) && image.caption.trim().length > 120) fail(`${imageLabel}.caption 不得超过 120 个字符。`);
        });
        requireString(item.transportMode, `${label}.transportMode`);
        if (item.navigationMode !== undefined && !["driving", "motorcycle", "tuktuk", "walking", "transit", "bus", "ferry", "cablecar", "mountainrail", "tram", "monorail", "minibus", "rickshaw", "bicycling"].includes(item.navigationMode)) fail(`${label}.navigationMode 必须是受支持的出行方式。`);
        if (item.navigationMode !== undefined && item.navigationOptions !== undefined) fail(`${label}.navigationMode 与 navigationOptions 不得同时设置；单一偏好使用 navigationMode，多方案对比使用 navigationOptions。`);
        if (item.navigationOptions !== undefined) {
          const options = requireArray(item.navigationOptions, `${label}.navigationOptions`);
          if (options.length < 2 || options.length > 5) fail(`${label}.navigationOptions 必须包含 2–5 种已核验交通方案。`);
          const seenModes = new Set(); let recommendedCount = 0;
          options.forEach((option, optionIndex) => {
            const optionLabel = `${label}.navigationOptions[${optionIndex}]`;
            if (!object(option)) { fail(`${optionLabel} 必须是对象。`); return; }
            if (!["driving", "motorcycle", "tuktuk", "walking", "transit", "bus", "ferry", "cablecar", "mountainrail", "tram", "monorail", "minibus", "rickshaw", "bicycling"].includes(option.mode)) fail(`${optionLabel}.mode 无效。`);
            if (seenModes.has(option.mode)) fail(`${label}.navigationOptions 的交通方式不得重复。`);
            seenModes.add(option.mode);
            if (!Number.isInteger(option.durationMinutes) || option.durationMinutes <= 0) fail(`${optionLabel}.durationMinutes 必须是正整数。`);
            if (typeof option.recommended !== "boolean") fail(`${optionLabel}.recommended 必须是布尔值。`);
            if (option.recommended === true) recommendedCount += 1;
          });
          if (recommendedCount !== 1) fail(`${label}.navigationOptions 必须且只能标记 1 个推荐方案。`);
          const recommended = options.find((option) => option?.recommended === true);
          if (recommended && Number.isInteger(item.travelMinutes) && recommended.durationMinutes !== item.travelMinutes) fail(`${label}.navigationOptions 的推荐耗时必须与 travelMinutes 一致，以保持详细时间线和切换重算基线一致。`);
        }
        if (item.placeId && !placeIdSet.has(item.placeId)) fail(`${label}.placeId 引用了不存在的地点。`);
        if (["place", "reservation"].includes(item.type) && !item.placeId) fail(`${label}.type=${item.type} 时必须提供 placeId。`);
        if (!Number.isInteger(item.travelMinutes) || item.travelMinutes < 0) fail(`${label}.travelMinutes 必须是非负整数。`);
        if (!Number.isInteger(item.stayMinutes) || item.stayMinutes < 0) fail(`${label}.stayMinutes 必须是非负整数。`);
        if (typeof item.breakGroundRoute !== "boolean") fail(`${label}.breakGroundRoute 必须是布尔值。`);
        if (!RESERVATION_STATUSES.has(item.reservationStatus)) fail(`${label}.reservationStatus 无效。`);
        const hasStart = string(item.startTime); const hasEnd = string(item.endTime);
        if (hasStart !== hasEnd) fail(`${label}.startTime/endTime 必须同时填写或同时留空。`);
        if (hasStart && (!EXACT_TIME.test(item.startTime) || !EXACT_TIME.test(item.endTime))) fail(`${label} 的确定时间必须为 HH:MM。`);
        if (!hasStart && !string(item.timeText)) fail(`${label} 未提供确定时间时必须填写 timeText。`);
        if (!hasStart && string(item.timeText) && item.timeText.trim().length > FLEXIBLE_TIME_MAX_LENGTH) fail(`${label}.timeText 只能填写简短时间窗口，不得超过 ${FLEXIBLE_TIME_MAX_LENGTH} 个字符；路线与活动内容应放入 title/activity。`);
        if (!hasStart && string(item.timeText) && item.timeText.trim() === String(item.title || "").trim()) fail(`${label}.timeText 不得重复 title；请填写“上午”“抵达后”等简短时间窗口。`);
        if (hasStart && EXACT_TIME.test(item.startTime) && EXACT_TIME.test(item.endTime)) {
          const start = toMinutes(item.startTime); const end = toMinutes(item.endTime);
          if (end <= start) fail(`${label}.endTime 必须晚于 startTime。`);
          if (previousTimed && previousTimed.end + item.travelMinutes > start) fail(`${label} 与上一确定时间条目冲突：上一项结束加移动时间晚于本项开始。`);
          previousTimed = { end, label };
        }
        // 无精确时间的条目只跳过自身比较，不重置链条，避免夹心重叠漏检。
        checkRefs(item.sourceIds, `${label}.sourceIds`);
      });
      ["food", "risks", "alternatives"].forEach((key) => {
        requireArray(day[key] ?? [], `days[${index}].${key}`).forEach((value, valueIndex) => {
          requireString(value, `days[${index}].${key}[${valueIndex}]`);
          if (key !== "food") checkSupplement(value, `days[${index}].${key}[${valueIndex}]`);
        });
      });
      const calendarNotes = requireArray(day.calendarNotes ?? [], `days[${index}].calendarNotes`);
      if (calendarNotes.length > 3) fail(`days[${index}].calendarNotes 最多保留 3 条关键提醒。`);
      calendarNotes.forEach((note, noteIndex) => {
        requireString(note, `days[${index}].calendarNotes[${noteIndex}]`);
        checkSupplement(note, `days[${index}].calendarNotes[${noteIndex}]`);
      });
      if (data?.features?.calendarExport) {
        const highlighted = items.filter((item) => item?.calendarHighlight).length;
        if (!highlighted || highlighted > 6) fail(`days[${index}] 启用日历导出时必须选择 1–6 个 calendarHighlight 主要条目。`);
      }
      checkRefs(day.sourceIds, `days[${index}].sourceIds`);
    });
    if (!unique(itemIds)) fail("days[].items[].id 必须在全攻略中唯一。");
    if (dateList.length && days.length !== dateList.length) fail(`days 数量 ${days.length} 与 meta.dates 数量 ${dateList.length} 不一致。`);

    const transportItems = requireArray(data.transport, "transport");
    if (!transportItems.length) fail("完整攻略的 transport 不能为空；至少提供一项市内或城际交通。 ");
    transportItems.forEach((item, index) => {
      ["from", "to", "departureWindow", "arrivalWindow", "mode", "duration", "cost"].forEach((key) => requireString(item?.[key], `transport[${index}].${key}`));
      optionalSupplement(item?.verification, `transport[${index}].verification`);
      checkRefs(item?.sourceIds, `transport[${index}].sourceIds`);
    });
    if (!object(data.budget)) fail("缺少 budget 对象。");
    requireString(data?.budget?.baseCurrency, "budget.baseCurrency");
    if (data?.budget?.baseCurrency !== "CNY") fail("budget.baseCurrency 必须固定为 CNY。");
    const targets = requireArray(data?.budget?.targetCurrencies, "budget.targetCurrencies");
    if (data?.features?.exchange && !targets.length) fail("启用 exchange 时 budget.targetCurrencies 不能为空。");
    targets.forEach((currency) => { if (!/^[A-Z]{3}$/.test(String(currency))) fail(`budget.targetCurrencies 必须是三位 ISO 货币代码：${currency}。`); });
    const budgetItems = requireArray(data?.budget?.items, "budget.items");
    if (!budgetItems.length) fail("budget.items 不能为空；至少提供一个预算分项。 ");
    if (targets.includes("CNY")) fail("budget.targetCurrencies 不应重复包含基准币 CNY。");
    let minSum = 0; let maxSum = 0;
    budgetItems.forEach((item, index) => {
      requireString(item?.name, `budget.items[${index}].name`);
      requireString(item?.currency, `budget.items[${index}].currency`);
      checkRefs(item?.sourceIds, `budget.items[${index}].sourceIds`);
      if (item?.currency !== "CNY") fail(`budget.items[${index}].currency 必须为 CNY；当地货币原价写入 note。`);
      if (!Number.isFinite(item?.min) || !Number.isFinite(item?.max) || item.min < 0 || item.max < item.min) fail(`budget.items[${index}] 金额区间无效。`);
      else { minSum += item.min; maxSum += item.max; }
    });
    const total = data?.budget?.total;
    if (!object(total) || !Number.isFinite(total.min) || !Number.isFinite(total.max) || total.min < 0 || total.max < total.min) fail("budget.total 金额区间无效。");
    else {
      if (budgetItems.length && (Math.abs(total.min - minSum) > 0.01 || Math.abs(total.max - maxSum) > 0.01)) fail("budget.total 必须等于 budget.items 区间合计。");
      requireString(total.currency, "budget.total.currency");
      if (total.currency !== "CNY") fail("budget.total.currency 必须为 CNY。");
    }
    requireArray(data?.budget?.notes ?? [], "budget.notes").forEach((note, noteIndex) => {
      requireString(note, `budget.notes[${noteIndex}]`);
      checkSupplement(note, `budget.notes[${noteIndex}]`);
    });
    const exchangeChannels = requireArray(data?.budget?.exchangeChannels ?? [], "budget.exchangeChannels");
    const budgetEvidence = budget => ({ ...budget, notes: undefined,
      items: (budget.items || []).map(({ note, ...item }) => item) });
    const unchangedLegacyBudget = legacyNearbyUpdate && baseline.features.exchange === data.features.exchange
      && isDeepStrictEqual(budgetEvidence(data.budget), budgetEvidence(alignBaselineRefs(baseline.budget))) && unchangedSources(data.budget);
    if (richRecommendations && data.features.exchange && !exchangeChannels.length) {
      if (unchangedLegacyBudget) preservedLegacy.push("budget.exchangeChannels");
      else fail("启用现场探索和汇率时，应提供具名换汇渠道；确无可核实数据时关闭换汇对比，不填猜测值。");
    }
    const channelIds = [];
    exchangeChannels.forEach((channel, index) => {
      const label = `budget.exchangeChannels[${index}]`;
      ["id", "name", "kind", "currency", "observedAt"].forEach((key) => requireString(channel?.[key], `${label}.${key}`));
      if (string(channel?.id)) channelIds.push(channel.id);
      if (!["atm", "counter", "bank"].includes(channel?.kind)) fail(`${label}.kind 无效。`);
      if (!targets.includes(channel?.currency)) fail(`${label}.currency 必须属于 budget.targetCurrencies。`);
      if (!validDate(channel?.observedAt)) fail(`${label}.observedAt 必须是有效日期。`);
      if (channel?.placeId && !placeIdSet.has(channel.placeId)) fail(`${label}.placeId 引用了不存在的地点。`);
      ["rateLocalPerCny", "feeCny", "feePercent", "feeLocal"].forEach((key) => {
        if (channel?.[key] !== undefined && (!Number.isFinite(channel[key]) || channel[key] < 0)) fail(`${label}.${key} 必须是非负数字。`);
      });
      if (channel?.rateLocalPerCny === 0 || channel?.feePercent > 100) fail(`${label} 的汇率或费率无效。`);
      checkRefs(channel?.sourceIds, `${label}.sourceIds`);
      if (!Array.isArray(channel?.sourceIds) || !channel.sourceIds.length) fail(`${label}.sourceIds 不能为空。`);
      if (!channel?.sourceIds?.some((id) => sourceList.some((source) => source.id === id && source.type === "xiaohongshu"))) fail(`${label} 至少需要一篇已读取的小红书观察来源。`);
    });
    if (!unique(channelIds)) fail("budget.exchangeChannels[].id 必须唯一。");

    const recommendations = requireArray(data.recommendations, "recommendations");
    recommendations.forEach((item, index) => {
      const legacy = unchangedLegacyRecord("recommendations", item);
      ["id", "category", "name", "reason", "travelerFit", "timing", "routeRelation", "duration", "reservation"].forEach((key) => requireString(item?.[key], `recommendations[${index}].${key}`));
      optionalSupplement(item?.limit, `recommendations[${index}].limit`);
      optionalSupplement(item?.executionAdvice, `recommendations[${index}].executionAdvice`);
      if (!RECOMMENDATION_CATEGORIES.includes(item?.category)) fail(`recommendations[${index}].category 无效。`);
      if (GENERIC_TRAVELER_FIT_PATTERNS.some((pattern) => pattern.test(String(item?.travelerFit || "")))) fail(`recommendations[${index}].travelerFit 使用了不提供取舍依据的通用套话。`);
      if (item?.placeId !== undefined && !placeIdSet.has(item.placeId)) fail(`recommendations[${index}].placeId 引用了不存在的地点。`);
      if (richRecommendations && !placeIdSet.has(item?.placeId)) {
        if (legacy) preservedLegacy.push(`recommendations[${index}].placeId`);
        else fail(`recommendations[${index}].placeId 在现场探索模式下必须指向地点库。`);
      }
      if (item?.officialUrl !== undefined && !/^https:\/\//i.test(String(item.officialUrl))) fail(`recommendations[${index}].officialUrl 必须是 https 链接。`);
      checkRefs(item?.sourceIds, `recommendations[${index}].sourceIds`);
      if (legacy && richRecommendations && item?.placeId && !item.image) preservedLegacy.push(`recommendations[${index}].image`);
      checkSourcedImage(item?.image, `recommendations[${index}].image`, richRecommendations && Boolean(item?.placeId) && !legacy, richRecommendations && !legacy);
      requireArray(item?.productPicks ?? [], `recommendations[${index}].productPicks`).forEach((pick, pickIndex) => {
        const label = `recommendations[${index}].productPicks[${pickIndex}]`;
        requireString(pick?.name, `${label}.name`);
        requireString(pick?.reason, `${label}.reason`);
        checkSourcedImage(pick?.image, `${label}.image`, true);
        checkRefs(pick?.sourceIds, `${label}.sourceIds`);
        if (!pick?.sourceIds?.some((id) => sourceList.some((source) => source.id === id && source.type === "xiaohongshu"))) fail(`${label} 必须有具体小红书笔记来源。`);
      });
      requireArray(item?.menuItems ?? [], `recommendations[${index}].menuItems`).forEach((menu, menuIndex) => {
        const label = `recommendations[${index}].menuItems[${menuIndex}]`;
        requireString(menu?.name, `${label}.name`);
        requireString(menu?.reason, `${label}.reason`);
        checkRefs(menu?.sourceIds, `${label}.sourceIds`);
      });
    });
    const travelerFitOwners = new Map();
    recommendations.forEach((item, index) => {
      const normalized = String(item?.travelerFit || "").trim().replace(/\s+/g, "");
      if (!normalized) return;
      if (travelerFitOwners.has(normalized)) fail(`recommendations[${index}].travelerFit 与 recommendations[${travelerFitOwners.get(normalized)}].travelerFit 完全重复，需改为该地点对应的具体取舍依据。`);
      else travelerFitOwners.set(normalized, index);
    });
    const recommendationIds = recommendations.map((item) => item?.id).filter(Boolean);
    if (!unique(recommendationIds)) fail("recommendations[].id 必须唯一。 ");
    const explorationSegments = requireArray(data.explorationSegments ?? [], "explorationSegments");
    if (data.features.contextualExplore === true && !explorationSegments.length) fail("启用 contextualExplore 时至少提供一段 A→B 探索路段。");
    const explorationIds = [];
    explorationSegments.forEach((segment, index) => {
      const label = `explorationSegments[${index}]`;
      requireString(segment?.id, `${label}.id`);
      if (string(segment?.id)) explorationIds.push(segment.id);
      if (!days.some((day) => day.dayNumber === segment?.dayNumber)) fail(`${label}.dayNumber 必须指向已有行程日。`);
      for (const key of ["fromPlaceId", "toPlaceId"]) if (!placeIdSet.has(segment?.[key])) fail(`${label}.${key} 必须指向已有地点。`);
      if (segment?.fromPlaceId === segment?.toPlaceId) fail(`${label} 的起终点不能相同。`);
      const candidates = requireArray(segment?.candidates, `${label}.candidates`);
      if (!candidates.length || candidates.length > 5) fail(`${label}.candidates 必须有 1–5 项。`);
      candidates.forEach((candidate, candidateIndex) => {
        const cLabel = `${label}.candidates[${candidateIndex}]`;
        const target = candidate?.targetType === "recommendation"
          ? recommendations.find((item) => item.id === candidate?.targetId)
          : (data.venueSuggestions || []).find((item) => item.id === candidate?.targetId);
        if (!target || !target.placeId || !places.find((place) => place.id === target.placeId)?.coordinates) fail(`${cLabel} 必须指向具有核实坐标的推荐地点。`);
        if (!["near_start", "near_end", "near_route", "detour"].includes(candidate?.relation)) fail(`${cLabel}.relation 无效。`);
        if (candidate?.detourMinutes !== undefined && (!Number.isInteger(candidate.detourMinutes) || candidate.detourMinutes < 0)) fail(`${cLabel}.detourMinutes 必须是非负整数。`);
        checkRefs(candidate?.sourceIds ?? [], `${cLabel}.sourceIds`);
      });
    });
    if (!unique(explorationIds)) fail("explorationSegments[].id 必须唯一。");
    if (preservedLegacy.length) warn(`旧攻略增量兼容：仅保留与同攻略基线及关联地点、来源一致的旧内容（${preservedLegacy.join("、")}）；新增/修改内容与逐日候选仍完整核验。`);
    const nearbyDays = requireArray(data.nearbyDays ?? [], "nearbyDays");
    const roadDays = requireArray(data.dayRoadRoutes ?? [], "dayRoadRoutes");
    if (data.features.nearbyExplore === true) {
      if (data.features.dayMap !== true) fail("附近逛逛需要启用当天地图。");
      if (nearbyDays.length !== days.length) fail("nearbyDays 必须为每个行程日恰好提供一组逐日记录；合理不显示日也须记录原因。");
    }
    const nearbyDayNumbers = [];
    nearbyDays.forEach((entry, index) => {
      const label = `nearbyDays[${index}]`;
      if (!days.some(day => day.dayNumber === entry?.dayNumber)) fail(`${label}.dayNumber 必须指向已有行程日。`);
      nearbyDayNumbers.push(entry?.dayNumber);
      const candidates = requireArray(entry?.candidates, `${label}.candidates`);
      validateNearbyPolicy(entry, label, places, fail, days.find(day => day.dayNumber === entry?.dayNumber));
      const candidatePlaces = [];
      const formalDay = days.find(day => day.dayNumber === entry?.dayNumber);
      const formalPlaceIds = new Set([formalDay?.accommodation?.startPlaceId, formalDay?.accommodation?.endPlaceId, ...(formalDay?.items || []).map(item => item.placeId)].filter(Boolean));
      const destinationCities = new Set([formalDay?.city, ...places.filter(place => formalPlaceIds.has(place.id)).map(place => place.city)].filter(Boolean));
      candidates.forEach((candidate, candidateIndex) => {
        const cLabel = `${label}.candidates[${candidateIndex}]`;
        const target = candidate?.targetType === "recommendation"
          ? recommendations.find(item => item.id === candidate?.targetId)
          : candidate?.targetType === "venueSuggestion"
            ? (data.venueSuggestions || []).find(item => item.id === candidate?.targetId) : null;
        const place = places.find(item => item.id === target?.placeId);
        if (!place?.coordinates) fail(`${cLabel} 必须引用有核实坐标的现有推荐地点。`);
        else { candidatePlaces.push(place.id); if (formalPlaceIds.has(place.id)) fail(`${cLabel} 已在正式行程中，不得作为附近逛逛重复展示。`); }
        if (!legacyNearbyDay(entry)) {
          if (place && !destinationCities.has(place.city)) fail(`${cLabel} 候选城市必须属于当天确定目的地；不顺路可以推荐，但不能混入其他城市。`);
          if (candidate?.windowIndex !== undefined) {
            const window = Number.isInteger(candidate.windowIndex) ? entry.freeWindows?.[candidate.windowIndex] : null;
            if (!window) fail(`${cLabel}.windowIndex 填写时必须引用当天已记录的自由窗口；不绑定窗口时请省略。`);
            else if (place && place.city !== window.city) fail(`${cLabel} 候选城市必须与所属自由窗口和确定目的地一致。`);
          }
          requireString(candidate?.timing, `${cLabel}.timing`);
        }
        requireString(candidate?.whyNow, `${cLabel}.whyNow`);
        if (string(candidate?.whyNow)) checkSupplement(candidate.whyNow, `${cLabel}.whyNow`);
        if (!target?.image) fail(`${cLabel} 必须引用配有可追溯图片的推荐。`);
        if (target?.image && !sourceList.some(source => source.id === target.image.sourceId && source.type === "xiaohongshu" && string(source.author) && string(source.url))) fail(`${cLabel} 图片来源必须是带作者和原帖链接的小红书笔记。`);
      });
      if (!unique(candidatePlaces)) fail(`${label}.candidates 不得重复同一地点。`);
    });
    if (!unique(nearbyDayNumbers)) fail("nearbyDays[].dayNumber 必须唯一。");
    const roadDayNumbers = [];
    roadDays.forEach((entry, index) => {
      const label = `dayRoadRoutes[${index}]`;
      const day = days.find(item => item.dayNumber === entry?.dayNumber);
      if (!day) fail(`${label}.dayNumber 必须指向已有行程日。`);
      roadDayNumbers.push(entry?.dayNumber);
      const legs = requireArray(entry?.legs, `${label}.legs`);
      const requiredPairs = [];
      if (day) {
        let last = day.accommodation?.startPlaceId || "";
        (day.items || []).forEach(item => {
          if (item.breakGroundRoute) last = "";
          if (item.placeId && last && item.placeId !== last) requiredPairs.push(`${last}\u2192${item.placeId}`);
          if (item.placeId) last = item.placeId;
        });
        const end = day.accommodation?.endPlaceId;
        if (end && last && end !== last) requiredPairs.push(`${last}\u2192${end}`);
      }
      const suppliedPairs = [];
      legs.forEach((leg, legIndex) => {
        const lLabel = `${label}.legs[${legIndex}]`;
        if (!placeIdSet.has(leg?.fromPlaceId) || !placeIdSet.has(leg?.toPlaceId)) fail(`${lLabel} 起终点必须引用地点库。`);
        if (!string(leg?.encodedPolyline) || leg.encodedPolyline.length < 8 || leg.encodedPolyline.length > 100000 || !/^[?-~]+$/.test(leg.encodedPolyline)) fail(`${lLabel}.encodedPolyline 必须是有效的预生成道路折线。`);
        else {
          try {
            const ends = decodeRoadEndpoints(leg.encodedPolyline);
            const from = places.find(place => place.id === leg.fromPlaceId)?.coordinates;
            const to = places.find(place => place.id === leg.toPlaceId)?.coordinates;
            const near = (a, b) => Math.hypot(a.latitude - b.latitude, (a.longitude - b.longitude) * Math.cos(b.latitude * Math.PI / 180)) < .05;
            if (from && !near(ends.first, from) || to && !near(ends.last, to)) fail(`${lLabel}.encodedPolyline 起终点与正式地点不匹配。`);
          } catch (error) { fail(`${lLabel}.encodedPolyline 无法解码：${error.message}。`); }
        }
        if (!["google-routes", "baidu-routes", "verified-road"].includes(leg?.provider)) fail(`${lLabel}.provider 无效。`);
        suppliedPairs.push(`${leg?.fromPlaceId}\u2192${leg?.toPlaceId}`);
      });
      // Missing legs are allowed. Supplied legs must remain an ordered subsequence,
      // never bridging a flight/ferry, an unknown hotel or an omitted formal stop.
      let lastPair = -1;
      for (const pair of suppliedPairs) {
        const position = requiredPairs.indexOf(pair, lastPair + 1);
        if (position < 0) fail(`${label}.legs 只能按正式行程顺序提供已核实路段；不得跨越 breakGroundRoute 断点或跳过正式停靠点。`);
        else lastPair = position;
      }
    });
    if (!unique(roadDayNumbers)) fail("dayRoadRoutes[].dayNumber 必须唯一。");
    if (data.recommendationPlacements !== undefined) {
      const placements = requireArray(data.recommendationPlacements, "recommendationPlacements");
      const placementIds = [];
      const venueIds = new Set((data.venueSuggestions || []).map((item) => item.id));
      const recommendationIdSet = new Set(recommendationIds);
      placements.forEach((placement, index) => {
        const label = `recommendationPlacements[${index}]`;
        requireString(placement?.id, `${label}.id`);
        if (placement?.id) placementIds.push(placement.id);
        if (!Number.isInteger(placement?.dayNumber) || placement.dayNumber < 1 || placement.dayNumber > days.length) fail(`${label}.dayNumber 必须指向已有行程日。`);
        requireString(placement?.anchorItemId, `${label}.anchorItemId`);
        if (!itemIds.includes(placement?.anchorItemId)) fail(`${label}.anchorItemId 必须指向已有时间线条目。`);
        if (!["en_route", "lunch", "coffee", "experience", "flexible"].includes(placement?.slot)) fail(`${label}.slot 无效。`);
        const entries = requireArray(placement?.entries, `${label}.entries`);
        if (!entries.length || entries.length > 2) fail(`${label}.entries 必须包含 1–2 项。`);
        entries.forEach((entry, entryIndex) => {
          const entryLabel = `${label}.entries[${entryIndex}]`;
          if (!["venueSuggestion", "recommendation"].includes(entry?.targetType)) fail(`${entryLabel}.targetType 无效。`);
          requireString(entry?.targetId, `${entryLabel}.targetId`);
          const exists = entry?.targetType === "venueSuggestion" ? venueIds.has(entry?.targetId) : recommendationIdSet.has(entry?.targetId);
          if (!exists) fail(`${entryLabel}.targetId 未找到对应推荐。`);
          if (!["on_route", "nearby", "minor_detour", "detour"].includes(entry?.routeRelation)) fail(`${entryLabel}.routeRelation 无效。`);
          if (entry?.note !== undefined) optionalSupplement(entry.note, `${entryLabel}.note`);
        });
      });
      if (!unique(placementIds)) fail("recommendationPlacements[].id 必须唯一。 ");
    }
    const recommendationNotes = requireArray(data.recommendationNotes ?? [], "recommendationNotes");
    RECOMMENDATION_CATEGORIES.forEach((category) => {
      const matches = recommendationNotes.filter((item) => item?.category === category);
      if (matches.length > 1) fail(`recommendationNotes 最多包含一条“${category}”整体备注。`);
    });
    recommendationNotes.forEach((item, index) => {
      if (!RECOMMENDATION_CATEGORIES.includes(item?.category)) fail(`recommendationNotes[${index}].category 无效。`);
      requireString(item?.text, `recommendationNotes[${index}].text`);
      checkSupplement(item?.text, `recommendationNotes[${index}].text`);
      const hasCategoryContent = recommendations.some((recommendation) => recommendation?.category === item?.category)
        || (item?.category === "餐饮指南" && requireArray(data.venueSuggestions ?? [], "venueSuggestions").length > 0);
      if (!hasCategoryContent) fail(`recommendationNotes[${index}] 没有对应推荐内容，应直接删除。`);
      checkRefs(item?.sourceIds, `recommendationNotes[${index}].sourceIds`);
    });
    const localKnowledge = requireArray(data.localKnowledge, "localKnowledge");
    if (!localKnowledge.length && !string(data.meta?.cultureNote)) fail("文化习俗不适用时请用 meta.cultureNote 简述原因。");
    const knowledgeIds = [];
    localKnowledge.forEach((item, index) => {
      const label = `localKnowledge[${index}]`;
      ["id", "category", "title", "guidance"].forEach((key) => requireString(item?.[key], `${label}.${key}`));
      if (!LOCAL_KNOWLEDGE_CATEGORIES.includes(item?.category)) fail(`${label}.category 无效。`);
      if (item?.action !== undefined) requireString(item.action, `${label}.action`);
      const dayNumbers = requireArray(item?.dayNumbers ?? [], `${label}.dayNumbers`);
      const placeIds = requireArray(item?.placeIds ?? [], `${label}.placeIds`);
      dayNumbers.forEach((dayNumber) => { if (!Number.isInteger(dayNumber) || !days.some((day) => day.dayNumber === dayNumber)) fail(`${label}.dayNumbers 引用了不存在的行程日。`); });
      placeIds.forEach((placeId) => { if (!string(placeId) || !placeIdSet.has(placeId)) fail(`${label}.placeIds 引用了不存在的地点。`); });
      checkRefs(item?.sourceIds, `${label}.sourceIds`);
      if (string(item?.id)) knowledgeIds.push(item.id);
    });
    LOCAL_KNOWLEDGE_CATEGORIES.forEach((category) => {
      if (localKnowledge.filter((item) => item?.category === category).length > 1) fail(`localKnowledge 每类最多包含一张“${category}”卡片。`);
    });
    if (!unique(knowledgeIds)) fail("localKnowledge[].id 必须唯一。 ");
    const checklistIds = [];
    const checklist = requireArray(data.checklist, "checklist");
    if (!checklist.length) fail("checklist 不能为空。 ");
    checklist.forEach((item, index) => {
      requireString(item?.id, `checklist[${index}].id`);
      requireString(item?.category, `checklist[${index}].category`);
      requireString(item?.text, `checklist[${index}].text`);
      checkSupplement(item?.text, `checklist[${index}].text`);
      if (string(item?.id)) checklistIds.push(item.id);
      checkRefs(item?.sourceIds, `checklist[${index}].sourceIds`);
    });
    if (!unique(checklistIds)) fail("checklist.id 必须唯一。");
    if (data.bookingLedger !== undefined) {
      const bookingIds = [];
      const bookings = requireArray(data.bookingLedger, "bookingLedger");
      bookings.forEach((item, index) => {
        ["id", "category", "title", "when", "participants", "status"].forEach((key) => requireString(item?.[key], `bookingLedger[${index}].${key}`));
        if (!["activity", "restaurant"].includes(item?.category)) fail(`bookingLedger[${index}].category 仅支持 activity 或 restaurant。`);
        if (!["confirmed", "pending", "verify"].includes(item?.status)) fail(`bookingLedger[${index}].status 仅支持 confirmed、pending 或 verify。`);
        if (item?.placeId) { requireString(item.placeId, `bookingLedger[${index}].placeId`); if (!placeIdSet.has(item.placeId)) fail(`bookingLedger[${index}].placeId 不存在。`); }
        if (item?.bookingUrl && !/^https?:\/\//i.test(item.bookingUrl)) fail(`bookingLedger[${index}].bookingUrl 必须为 http(s) URL。`);
        checkRefs(item?.sourceIds, `bookingLedger[${index}].sourceIds`);
        if (string(item?.id)) bookingIds.push(item.id);
      });
      if (!unique(bookingIds)) fail("bookingLedger.id 必须唯一，同一预定事实不得重复记录。");
    }

    if (!object(data.weather)) fail("缺少 weather 对象。");
    if (Boolean(data?.weather?.enabled) !== Boolean(data?.features?.weather)) fail("weather.enabled 必须与 features.weather 一致。");
    const weatherLocations = requireArray(data?.weather?.locations, "weather.locations");
    if (data?.features?.weather && !weatherLocations.length) fail("启用 weather 时必须提供 weather.locations。");
    if (data?.features?.weather && (!validDate(data?.weather?.startDate) || !validDate(data?.weather?.endDate))) fail("启用 weather 时必须提供有效的 weather.startDate 与 weather.endDate。 ");
    if (data?.features?.weather && !dateList.length) fail("无明确日期时不得启用实时天气刷新；常年气候写入 checklist。 ");
    weatherLocations.forEach((location, index) => {
      requireString(location?.name, `weather.locations[${index}].name`);
      requireString(location?.placeId, `weather.locations[${index}].placeId`);
      if (string(location?.placeId) && !placeIdSet.has(location.placeId)) fail(`weather.locations[${index}].placeId 不存在。`);
      if (!Number.isFinite(location?.latitude) || location.latitude < -90 || location.latitude > 90 || !Number.isFinite(location?.longitude) || location.longitude < -180 || location.longitude > 180) fail(`weather.locations[${index}] 坐标无效。`);
      const canonical = places.find((place) => place.id === location?.placeId);
      if (canonical && (Math.abs(canonical.coordinates.latitude - location.latitude) > 0.000001 || Math.abs(canonical.coordinates.longitude - location.longitude) > 0.000001)) fail(`weather.locations[${index}] 坐标必须与 places 中的地点一致。`);
    });
    if (data?.features?.weather && dateList.length && (data?.weather?.startDate !== dateList[0] || data?.weather?.endDate !== dateList.at(-1))) fail("weather 起止日期必须与 meta.dates 首尾一致。");
    if (data?.features?.calendarExport && !dateList.length) fail("无明确日期时不得启用 calendarExport。");
    if (data?.calendar !== undefined && !object(data.calendar)) fail("calendar 必须是对象。");
    if (data?.calendar?.mode !== undefined && !CALENDAR_MODES.has(data.calendar.mode)) fail("calendar.mode 必须是 daily 或 timed。");
    if (data?.features?.calendarExport && data?.calendar?.mode === "timed" && !days.some((day) => day.items.some((item) => string(item.startTime)))) fail("calendar.mode=timed 时至少需要一项确定开始时间。");

    const audit = data.researchAudit;
    if (!object(audit)) fail("缺少 researchAudit 对象。");
    if (audit?.status !== "completed") fail("研究尚未完成或已受阻，必须暂停，不能生成详细内容或 HTML。 ");
    if (audit?.xiaohongshuRequiredCount !== XHS_GENERAL_REQUIRED_COUNT) fail(`researchAudit.xiaohongshuRequiredCount 必须为 ${XHS_GENERAL_REQUIRED_COUNT}。`);
    const xhsSources = sourceList.filter((source) => source.type === "xiaohongshu");
    if (xhsSources.length && !data?.features?.sourceIndex) fail("完整攻略包含已读取的小红书来源时必须启用 sourceIndex，以保证高级搜索可定位资料来源。");
    const contentIdentityError = validateXiaohongshuIdentities(sourceList);
    if (contentIdentityError) fail(contentIdentityError);
    const xhsUrls = xhsSources.map((source) => String(source.url || "").replace(/[),.;]+$/, ""));
    if (!unique(xhsUrls)) fail("小红书来源链接必须去重。 ");
    const generalXhs = xhsSources.filter((source) => (source.scope || "general") === "general").length;
    if (audit?.xiaohongshuReadCount !== generalXhs) fail("researchAudit.xiaohongshuReadCount 必须等于一般小红书来源数量。");
    if (generalXhs < XHS_GENERAL_REQUIRED_COUNT) fail(`必须实际读取至少 ${XHS_GENERAL_REQUIRED_COUNT} 篇去重的小红书攻略；未登录时提醒用户登录，补齐前不得完成研究或生成完整攻略。`);
    const arrivalRequired = data?.features?.arrivalDeparture ? XHS_ARRIVAL_DEPARTURE_REQUIRED_COUNT : 0;
    const arrivalXhs = xhsSources.filter((source) => source.scope === "arrival-departure").length;
    if (audit?.arrivalDepartureRequiredCount !== arrivalRequired) fail(`researchAudit.arrivalDepartureRequiredCount 必须为 ${arrivalRequired}。`);
    if (audit?.arrivalDepartureReadCount !== arrivalXhs) fail("researchAudit.arrivalDepartureReadCount 必须等于到达/离开小红书来源数量。");
    if (arrivalXhs < arrivalRequired && (!decisionCoverageComplete(audit, sourceList) || !string(audit?.arrivalDepartureShortfallReason))) fail("到达/离开证据未覆盖，需补充官方核验。 ");

    if (data?.features?.arrivalDeparture) {
      if (!object(data.arrivalDeparture)) fail("启用 arrivalDeparture 时缺少 arrivalDeparture 对象。");
      const kitAnchors = new Set();
      requireArray(data.arrivalDeparture?.airportKits ?? [], "arrivalDeparture.airportKits").forEach((kit, index) => {
        const label = `arrivalDeparture.airportKits[${index}]`;
        if (!Number.isInteger(kit?.arrivalIndex) || !data.arrivalDeparture?.arrival?.[kit.arrivalIndex]) fail(`${label}.arrivalIndex 必须指向实际到达节点。`);
        if (kitAnchors.has(kit?.arrivalIndex)) fail(`${label} 同一到达节点不得重复添加三件套。`);
        kitAnchors.add(kit?.arrivalIndex);
        for (const field of ["airport", "nextStop"]) requireString(kit?.[field], `${label}.${field}`);
        const kinds = new Set();
        const cards = requireArray(kit?.cards, `${label}.cards`);
        if (!cards.length || cards.length > 3) fail(`${label}.cards 只收录有内容的三类卡片。`);
        cards.forEach((card, cardIndex) => {
          const name = `${label}.cards[${cardIndex}]`;
          if (!["sim", "exchange", "transport"].includes(card?.kind) || kinds.has(card?.kind)) fail(`${name}.kind 无效或重复。`);
          kinds.add(card?.kind);
          requireString(card?.lead, `${name}.lead`);
          optionalSupplement(card?.lead, `${name}.lead`);
          for (const field of ["condition", "details"]) if (card?.[field] !== undefined) optionalSupplement(card[field], `${name}.${field}`);
          const facts = requireArray(card?.facts, `${name}.facts`);
          if (!facts.length) fail(`${name}.facts 不得为空，不生成占位卡。`);
          facts.forEach((fact, factIndex) => {
            const factLabel = `${name}.facts[${factIndex}]`;
            for (const field of ["label", "value"]) requireString(fact?.[field], `${factLabel}.${field}`);
            optionalSupplement(fact?.value, `${factLabel}.value`);
            if (fact?.observedAt !== undefined && !validDate(fact.observedAt)) fail(`${factLabel}.observedAt 必须为有效观察日期。`);
            checkRefs(fact?.sourceIds, `${factLabel}.sourceIds`);
            if (!fact?.sourceIds?.length || fact.sourceIds.some(id => !sourceList.some(s => s.id === id && s.type === "xiaohongshu"))) fail(`${factLabel} 必须引用实际读取的小红书来源。`);
          });
        });
      });
      const appIds = new Set();
      requireArray(data?.arrivalDeparture?.apps ?? [], "arrivalDeparture.apps").forEach((app, index) => {
        const label = `arrivalDeparture.apps[${index}]`;
        for (const field of ["id", "name", "region", "logoSrc", "purpose"]) requireString(app?.[field], `${label}.${field}`);
        if (string(app?.id)) {
          if (appIds.has(app.id)) fail(`${label}.id 重复，不得把同一 APP 拆成多张卡。`);
          appIds.add(app.id);
        }
        if (string(app?.logoSrc) && !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(app.logoSrc)) fail(`${label}.logoSrc 必须是安全的本地相对图片路径。`);
        if (app?.officialUrl !== undefined && !/^https:\/\/[^\s]+$/i.test(app.officialUrl)) fail(`${label}.officialUrl 必须是核实过的 HTTPS 官方页面。`);
        if (app?.notice !== undefined) optionalSupplement(app.notice, `${label}.notice`);
        checkRefs(app?.sourceIds, `${label}.sourceIds`);
        if (!app?.sourceIds?.some(id => sourceList.some(source => source.id === id && source.type === "official"))) fail(`${label}.sourceIds 必须包含 APP 官方页面或开发者发布的应用商店条目。`);
      });
      requireArray(data?.arrivalDeparture?.forms ?? [], "arrivalDeparture.forms").forEach((form, index) => {
        const label = `arrivalDeparture.forms[${index}]`;
        if (!["arrival", "departure"].includes(form?.direction)) fail(`${label}.direction 无效。`);
        for (const field of ["name", "appliesTo", "submission"]) requireString(form?.[field], `${label}.${field}`);
        if (form?.officialUrl !== undefined && !/^https:\/\/[^\s]+$/i.test(form.officialUrl)) fail(`${label}.officialUrl 必须是 HTTPS 官方入口。`);
        const fields = requireArray(form?.fields, `${label}.fields`);
        if (!fields.length) fail(`${label}.fields 至少填写一个经核实的单据字段。`);
        fields.forEach((field, fieldIndex) => {
          requireString(field?.label, `${label}.fields[${fieldIndex}].label`);
          requireString(field?.guidance, `${label}.fields[${fieldIndex}].guidance`);
        });
        checkRefs(form?.sourceIds, `${label}.sourceIds`);
        if (!form?.sourceIds?.some(id => sourceList.some(source => source.id === id && source.type === "official"))) fail(`${label}.sourceIds 必须包含实际核查的官方来源。`);
      });
      requireArray(data?.arrivalDeparture?.experiences ?? [], "arrivalDeparture.experiences").forEach((experience, index) => {
        const label = `arrivalDeparture.experiences[${index}]`;
        if (!["arrival", "departure"].includes(experience?.direction)) fail(`${label}.direction 无效。`);
        requireString(experience?.airport, `${label}.airport`);
        if (!validDate(experience?.observedAt)) fail(`${label}.observedAt 必须是有效日期。`);
        for (const key of ["queueMinutes", "landingToExitMinutes"]) if (experience?.[key] !== undefined && (!Number.isInteger(experience[key]) || experience[key] < 0)) fail(`${label}.${key} 必须是非负整数。`);
        checkRefs(experience?.sourceIds, `${label}.sourceIds`);
        if (experience?.queueMinutes === undefined && experience?.landingToExitMinutes === undefined) fail(`${label} 至少记录一个实测耗时。`);
        if (!experience?.sourceIds?.some((id) => sourceList.some((source) => source.id === id && source.type === "xiaohongshu"))) fail(`${label} 必须有亲历小红书笔记来源。`);
      });
      ["arrival", "departure"].forEach((key) => {
        const steps = requireArray(data?.arrivalDeparture?.[key], `arrivalDeparture.${key}`);
        if (!steps.length) fail(`arrivalDeparture.${key} 不能为空。`);
        steps.forEach((step, index) => {
          ["when", "action"].forEach((field) => requireString(step?.[field], `arrivalDeparture.${key}[${index}].${field}`));
          optionalSupplement(step?.reason, `arrivalDeparture.${key}[${index}].reason`);
          optionalSupplement(step?.riskAlternative, `arrivalDeparture.${key}[${index}].riskAlternative`);
          checkRefs(step?.sourceIds, `arrivalDeparture.${key}[${index}].sourceIds`);
        });
      });
      const flights = requireArray(data?.arrivalDeparture?.flights, "arrivalDeparture.flights");
      const flightIds = new Set();
      flights.forEach((flight, index) => {
        ["flightNumber", "airline", "departureDate", "departureTime", "arrivalDate", "arrivalTime", "departureCode", "departureAirport", "arrivalCode", "arrivalAirport"].forEach((field) => {
          if (flight?.[field] !== undefined) requireString(flight[field], `arrivalDeparture.flights[${index}].${field}`);
        });
        const flightPath = `arrivalDeparture.flights[${index}]`;
        if (flight?.id) { if (flightIds.has(flight.id)) fail(`${flightPath}.id 重复。`); flightIds.add(flight.id); }
        if (flight?.detailUrl && !safeFlightDetailUrl(flight.detailUrl)) fail(`${flightPath}.detailUrl 仅支持不含敏感参数的 HTTPS。`);
        if (flight?.durationMinutes !== undefined && (!Number.isInteger(flight.durationMinutes) || flight.durationMinutes < 1 || flight.durationMinutes > 2880)) fail(`${flightPath}.durationMinutes 必须为1–2880的整数。`);
        if (flight?.connection !== undefined) {
          const connection = flight.connection;
          if (!connection || typeof connection !== "object" || Array.isArray(connection)) fail(`${flightPath}.connection 必须为明确中转信息对象。`);
          else {
            if (Object.keys(connection).some(key => !["airportCode", "airport", "durationMinutes"].includes(key))) fail(`${flightPath}.connection 仅允许机场与停留时长，不得保存原文或敏感信息。`);
            if (connection.airportCode !== undefined && !/^[A-Z]{3}$/.test(connection.airportCode)) fail(`${flightPath}.connection.airportCode 必须为机场三字码。`);
            if (connection.airport !== undefined && (typeof connection.airport !== "string" || sanitizeFlightAirport(connection.airport) !== connection.airport.trim())) fail(`${flightPath}.connection.airport 必须为不含敏感信息的机场名称。`);
            if (connection.durationMinutes !== undefined && (!Number.isInteger(connection.durationMinutes) || connection.durationMinutes < 1 || connection.durationMinutes > 10080)) fail(`${flightPath}.connection.durationMinutes 必须为1–10080的整数。`);
          }
        }
        ["seat", "gate", "baggageClaim"].forEach(field => {
          if (flight?.[field] !== undefined && !/^[A-Z0-9 -]{1,12}$/.test(flight[field])) fail(`${flightPath}.${field} 必须为大写简短执行编号。`);
        });
        if (flight?.flightNumber !== undefined && !/^[A-Z0-9]{2}[0-9]{3,4}$/.test(flight.flightNumber)) fail(`${flightPath}.flightNumber 格式无效。`);
        ["departureTime", "arrivalTime"].forEach(field => {
          if (flight?.[field] !== undefined && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(flight[field])) fail(`${flightPath}.${field} 必须为有效HH:mm时间。`);
        });
        ["departureDate", "arrivalDate"].forEach(field => {
          if (flight?.[field] !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(flight[field]) || !Number.isFinite(Date.parse(flight[field])) || new Date(flight[field]).toISOString().slice(0,10) !== flight[field])) fail(`${flightPath}.${field} 必须为有效日期。`);
        });
        ["passengerName", "passport", "identityNumber", "orderNumber", "ticketNumber", "pnr", "qrCode", "barcode", "rawOcr"].forEach((field) => {
          if (Object.prototype.hasOwnProperty.call(flight || {}, field)) fail(`arrivalDeparture.flights[${index}] 不得包含敏感字段 ${field}。`);
        });
      });
      findUncoveredFlightDates(flights, dateList, excludedDateValues).forEach(({ index, field, date }) => {
        fail(`arrivalDeparture.flights[${index}].${field}=${date} 未纳入 meta.dates，也未在 meta.dateExclusions 中记录用户确认的排除原因。`);
      });
    }
    if (data?.features?.sourceIndex) {
      const sourceIndex = requireArray(data.sourceIndex, "sourceIndex");
      if (!sourceIndex.length) fail("启用 sourceIndex 时 sourceIndex 不能为空。");
      const indexedSourceIds = [];
      sourceIndex.forEach((item, index) => {
        if (!sourceIdSet.has(item?.sourceId)) fail(`sourceIndex[${index}].sourceId 不存在。`);
        if (Number.isInteger(item?.sourceId)) indexedSourceIds.push(item.sourceId);
        requireString(item?.title, `sourceIndex[${index}].title`);
        requireArray(item?.cities, `sourceIndex[${index}].cities`);
        const tags = requireArray(item?.tags, `sourceIndex[${index}].tags`);
        const searchHints = requireArray(item?.searchHints, `sourceIndex[${index}].searchHints`);
        const source = sourceList.find((entry) => entry.id === item?.sourceId);
        const isXiaohongshu = source?.type === "xiaohongshu";
        const minimumTagCount = isXiaohongshu ? 10 : 3;
        const minimumHintCount = isXiaohongshu ? 2 : 1;
        tags.forEach((tag, tagIndex) => requireString(tag, `sourceIndex[${index}].tags[${tagIndex}]`));
        searchHints.forEach((hint, hintIndex) => requireString(hint, `sourceIndex[${index}].searchHints[${hintIndex}]`));
        if (tags.length < minimumTagCount || (isXiaohongshu && tags.length > 20)) fail(`sourceIndex[${index}] 的${isXiaohongshu ? "小红书" : "资料来源"}标签数量必须为 ${minimumTagCount}${isXiaohongshu ? "–20" : " 条以上"}且去重。`);
        if (new Set(tags.map((tag) => tag.trim().toLocaleLowerCase())).size !== tags.length) fail(`sourceIndex[${index}].tags 必须去重。`);
        if (searchHints.length < minimumHintCount || (isXiaohongshu && searchHints.length > 6)) fail(`sourceIndex[${index}].searchHints 必须包含 ${minimumHintCount}${isXiaohongshu ? "–6" : " 条以上"}可搜索提示词。`);
        if (new Set(searchHints.map((hint) => hint.trim().toLocaleLowerCase())).size !== searchHints.length) fail(`sourceIndex[${index}].searchHints 必须去重。`);
      });
      if (!unique(indexedSourceIds)) fail("sourceIndex.sourceId 必须唯一。 ");
      xhsSources.forEach((source) => {
        if (!indexedSourceIds.includes(source.id)) fail(`小红书来源 ${source.id} 缺少 sourceIndex，无法通过高级搜索定位。`);
      });
    }
    sourceIds.filter((id) => !usedSourceIds.has(id)).forEach((id) => warn(`来源 ${id} 未被正文内容引用，仅可作为资料索引。`));
  }

  if (options.brief && stage === "content") {
    const brief = options.brief;
    if (!["confirmed", "skipped"].includes(brief?.confirmation?.status)) fail("trip-brief 尚未确认，且未记录总授权，禁止进入内容研究与写作。 ");
    if (brief?.confirmation?.status === "skipped" && !string(brief?.confirmation?.note)) fail("自动继续必须在 confirmation.note 记录触发总授权的用户指令。 ");
    ["destination", "origin", "datePolicy", "budgetBasis"].forEach((key) => {
      if (brief?.meta?.[key] !== data?.meta?.[key]) fail(`content.meta.${key} 与 brief 不一致。`);
    });
    if (JSON.stringify(brief?.meta?.dates || []) !== JSON.stringify(data?.meta?.dates || [])) fail("content.meta.dates 与 brief 不一致。");
    if (JSON.stringify(brief?.meta?.dateExclusions || []) !== JSON.stringify(data?.meta?.dateExclusions || [])) fail("content.meta.dateExclusions 与 brief 不一致。");
    if (brief?.meta?.travelers?.count !== data?.meta?.travelers?.count) fail("content 旅行人数与 brief 不一致。");
    const briefStops = (brief?.route?.stops || []).map((stop) => typeof stop === "string" ? stop : stop.name);
    const contentPlaceMap = new Map((data?.places || []).map((place) => [place.id, place]));
    const contentStops = (data?.route?.stopIds || []).map((id) => contentPlaceMap.get(id)?.name || "");
    if (JSON.stringify(briefStops) !== JSON.stringify(contentStops)) fail("content 路线停靠点顺序与 brief 不一致。");
    const outline = brief?.dayOutline || [];
    if (outline.length !== (data?.days || []).length) fail("content.days 数量与 brief.dayOutline 不一致。 ");
    outline.forEach((plannedDay, index) => {
      const contentDay = data?.days?.[index];
      if (plannedDay?.date !== contentDay?.date || plannedDay?.city !== contentDay?.city || plannedDay?.theme !== contentDay?.theme) fail(`content.days[${index}] 与已确认的 dayOutline 不一致。`);
    });
    Object.keys(brief?.features || {}).forEach((key) => {
      if (brief.features[key] !== data?.features?.[key]) fail(`content.features.${key} 与 brief 不一致。`);
    });
    (brief?.researchSources || []).forEach((source) => {
      const contentSource = (data?.sources || []).find((item) => item.id === source.id);
      if (!contentSource || contentSource.type !== source.type || contentSource.url !== source.url) fail(`content.sources 缺少 brief 已使用的研究来源 ${source.id}。`);
    });
  }

  if (options.request && stage === "brief") {
    const request = options.request;
    ["destination", "origin", "datePolicy", "budgetBasis"].forEach((key) => {
      if (request?.meta?.[key] !== data?.meta?.[key]) fail(`brief.meta.${key} 与 request 不一致。`);
    });
    if (JSON.stringify(request?.meta?.dates || []) !== JSON.stringify(data?.meta?.dates || [])) fail("brief.meta.dates 与 request 不一致。");
    if (JSON.stringify(request?.meta?.dateExclusions || []) !== JSON.stringify(data?.meta?.dateExclusions || [])) fail("brief.meta.dateExclusions 与 request 不一致。");
    if (request?.meta?.travelers?.count !== data?.meta?.travelers?.count || JSON.stringify(request?.meta?.travelers?.profiles || []) !== JSON.stringify(data?.meta?.travelers?.profiles || [])) fail("brief 旅行人数或画像与 request 不一致。");
    ["mustVisit", "avoid", "preferences", "constraints"].forEach((key) => {
      if (JSON.stringify(request?.requirements?.[key] || []) !== JSON.stringify(data?.requirements?.[key] || [])) fail(`brief.requirements.${key} 与需求基线不一致。`);
    });
    Object.keys(request?.features || {}).forEach((key) => {
      if (request.features[key] !== data?.features?.[key]) fail(`brief.features.${key} 与 request 不一致。`);
    });
    if (JSON.stringify(request?.researchPlan || {}) !== JSON.stringify(data?.researchPlan || {})) fail("brief.researchPlan 与 request 不一致。");
  }

  if (options.baseline && stage === "content") {
    if (options.baseline.meta?.guideId && data.meta?.guideId !== options.baseline.meta.guideId) fail("增量更新不得更换或删除 meta.guideId。");
    const oldDates = options.baseline?.meta?.dates || [];
    const newDateSet = new Set(data?.meta?.dates || []);
    const removed = oldDates.filter((date) => !newDateSet.has(date));
    if (removed.length && !options.allowDateRemoval) fail(`相对旧 JSON 删除了日期：${removed.join("、")}。`);
    if (!Array.isArray(options.allowPaths) || !options.allowPaths.length) {
      fail("提供 --baseline 时必须显式声明 --allow-paths=<本次允许变更的JSON路径白名单>；未声明时禁止任何改动。");
    } else {
      const violations = diffJsonPaths(data, options.baseline).filter((changePath) => !isPathCovered(changePath, options.allowPaths));
      violations.forEach((changePath) => fail(`冻结门禁：${changePath} 相对基线发生变更，但不在 --allow-paths 白名单内。`));
    }
  }
  if (!options.baseline && Array.isArray(options.allowPaths) && options.allowPaths.length) {
    warn("--allow-paths 仅在与 --baseline 同时提供时生效；当前未提供基线。");
  }
  if (!options.baseline && options.allowDateRemoval) {
    warn("--allow-date-removal 仅在与 --baseline 同时提供时生效；当前未提供基线。");
  }
  if (options.baseline && stage !== "content") {
    warn(`--baseline 仅在 content 阶段执行冻结 diff；当前阶段为 ${stage}，基线未被比对。`);
  }

  return {
    valid: failures.length === 0,
    failures,
    warnings,
    summary: {
      stage,
      dates: dateList.length,
      days: Array.isArray(data?.days) ? data.days.length : 0,
      routeStops: Array.isArray(data?.route?.stopIds) ? data.route.stopIds.length : 0,
      sources: Array.isArray(data?.sources) ? data.sources.length : 0
    }
  };
}

function parseCli(argv) {
  const args = argv.slice(2);
  const file = args.find((arg) => !arg.startsWith("--"));
  const allowPaths = readCsvOption(args, "allow-paths");
  return { file, stage: readOption(args, "stage"), request: readOption(args, "request"), brief: readOption(args, "brief"), baseline: readOption(args, "baseline"), allowPaths, report: readOption(args, "report"), allowDateRemoval: args.includes("--allow-date-removal") };
}

/* 流水线统一门禁：先校验 request 自身，再校验 brief（含与 request 的一致性），
   最后校验目标阶段数据（含与上游的一致性）。任一上游不合法时提前返回并附阶段前缀，
   CLI 与 render-guide.js 共用，避免两处维护同一套优先级逻辑。 */
function runPipelineValidation(data, options = {}) {
  const request = options.request || null;
  const brief = options.brief || null;
  const requestResult = request ? validateTripData(request, { stage: "request" }) : null;
  const briefResult = brief ? validateTripData(brief, { stage: "brief", request }) : null;
  let result;
  if (requestResult && !requestResult.valid) {
    result = { valid: false, failures: requestResult.failures.map((item) => `request: ${item}`), warnings: requestResult.warnings, summary: {} };
  } else if (briefResult && !briefResult.valid) {
    result = { valid: false, failures: briefResult.failures.map((item) => `brief: ${item}`), warnings: briefResult.warnings, summary: {} };
  } else {
    result = validateTripData(data, { stage: options.stage, request, brief, baseline: options.baseline || null, allowPaths: options.allowPaths || null, allowDateRemoval: Boolean(options.allowDateRemoval) });
  }
  return {
    result,
    requestValidation: requestResult || { valid: true, failures: [], warnings: [], summary: { stage: "not-provided" } },
    briefValidation: briefResult || { valid: true, failures: [], warnings: [], summary: { stage: "not-provided" } }
  };
}

if (require.main === module) {
  const cli = parseCli(process.argv);
  if (!cli.file) {
    console.error("Usage: node validate-trip-data.js <json-file> --stage=request|brief|content [--request=trip-request.json] [--brief=trip-brief.json] [--baseline=old.json --allow-paths=path1,path2] [--allow-date-removal] [--report=report.json]");
    process.exit(2);
  }
  let result;
  try {
    const data = readUtf8Json(path.resolve(cli.file));
    const request = cli.request ? readUtf8Json(path.resolve(cli.request)) : null;
    const brief = cli.brief ? readUtf8Json(path.resolve(cli.brief)) : null;
    const baseline = cli.baseline ? readUtf8Json(path.resolve(cli.baseline)) : null;
    result = runPipelineValidation(data, { stage: cli.stage || data.stage, request, brief, baseline, allowPaths: cli.allowPaths.length ? cli.allowPaths : null, allowDateRemoval: cli.allowDateRemoval }).result;
  } catch (error) {
    result = { valid: false, failures: [error.message], warnings: [], summary: {} };
  }
  if (cli.report) fs.writeFileSync(path.resolve(cli.report), JSON.stringify(result, null, 2) + "\n", "utf8");
  if (!result.valid) {
    console.error("结构化行程未通过：\n- " + result.failures.join("\n- "));
    process.exit(1);
  }
  result.warnings.forEach((warning) => console.warn("提示：" + warning));
  console.log(`通过：${path.basename(cli.file)}（${result.summary.stage}，${result.summary.days} 天，${result.summary.sources} 个来源）`);
}

module.exports = { readUtf8Json, validateTripData, runPipelineValidation, diffJsonPaths, isPathCovered, findUncoveredFlightDates, isNonActionableSupplement };
