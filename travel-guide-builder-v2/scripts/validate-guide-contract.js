#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { TextDecoder } = require("util");
const { ISO_DATE, DAY_MS, parseIsoDate, buildDateRange: buildRange } = require("./date-utils.js");
const { XHS_GENERAL_REQUIRED_COUNT, GUIDE_DATA_VERSION, PAGE_TEMPLATE_VERSION, ASSET_SENTINELS, GUIDE_THEMES } = require("./shared-constants.js");
const { readOption } = require("./cli-options.js");
const { scanElementBlock } = require("./html-fragment.js");
const { xiaohongshuIdentity } = require("./xiaohongshu-identity.js");
const { HIDDEN_STATUSES } = require("./nearby-policy.js");
let moduleRegistryCache = null;
function getModuleRegistry() {
  if (!moduleRegistryCache) moduleRegistryCache = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "references", "module-registry.json"), "utf8")).modules;
  return moduleRegistryCache;
}

/* 进程内可复用的 HTML 契约校验核心。
   render-guide.js 直接以内存中的 HTML 字符串调用本函数，避免子进程启动与整文件重读；
   CLI 入口（require.main === module）只负责解析参数、读文件并格式化输出。
   options: { full, expectedStartOption, expectedEndOption, expectedDatesOption, baselineHtml, allowDateRemoval, fileLabel }
   返回 { valid, failures, expectedDates, itineraryDates } */
function validateGuideContract(source, options = {}) {
  const {
    full = false,
    expectedStartOption = "",
    expectedEndOption = "",
    expectedDatesOption = "",
    baselineHtml = "",
    allowDateRemoval = false,
    fileLabel = "guide.html"
  } = options;

  const failures = [];

  /* 哨兵自对账（P1-6）：校验器内置期望与本 skill 资产首行哨兵不一致时直接报错，
     防止改资产忘升版导致校验器静默过期。assetSentinelPairs 复用同一套期望值。 */
  const EXPECTED_ASSET_SENTINELS = ASSET_SENTINELS.map(({ file, marker }) => ({ file: path.join(__dirname, "..", file), marker }));
  EXPECTED_ASSET_SENTINELS.forEach(({ file, marker }) => {
    let firstLine = "";
    try {
      firstLine = fs.readFileSync(file, "utf8").split("\n", 1)[0];
    } catch (error) {
      failures.push(`缺少资产文件 ${file}：${error.message}`);
      return;
    }
    if (!firstLine.includes(marker)) failures.push(`资产哨兵过期：${path.basename(file)} 首行为“${firstLine.trim()}”，期望包含“${marker}”；修改资产后必须同步升级哨兵版本。`);
  });

  if (source.includes("�")) failures.push("发现替换字符 �。");
  const commonMojibake = ["锟斤拷", "烫烫烫", "屯屯屯", "Ã¤", "Ã©", "â€™", "â€œ", "ðŸ"];
  commonMojibake.filter((fragment) => source.includes(fragment)).forEach((fragment) => failures.push(`发现常见乱码片段：${fragment}`));
  const nonScripts = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  if (/\\u[0-9a-f]{4}/i.test(nonScripts)) failures.push("发现可见的 \\uXXXX 转义残留。");

  const markup = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  if (/示例[:：]|example\.com|待填写旅行攻略/i.test(markup)) failures.push("最终 HTML 仍包含模板占位内容。");
  const readAttribute = (tag, name) => tag.match(new RegExp("\\b" + name + "\\s*=\\s*([\\\"'])(.*?)\\1", "i"))?.[2]?.trim() || "";
  const extractElementBlock = (html, attributeName, attributeValue) => {
    const result = scanElementBlock(html, attributeName, attributeValue);
    if (result.error) failures.push(`HTML 元素块无法提取：${result.error}。`);
    return result.fragment || "";
  };
  const buildDateRange = (start, end, label) => {
    const range = buildRange(start, end);
    if (range.error) failures.push(label + range.error);
    return range.dates;
  };
  const parseDateList = (value, label) => {
    if (!value) return [];
    const dates = value.split(",").map((item) => item.trim()).filter(Boolean);
    const invalid = dates.filter((date) => !parseIsoDate(date));
    if (invalid.length) failures.push(label + "包含无效日期：" + invalid.join("、"));
    return dates.filter((date) => parseIsoDate(date));
  };
  const extractItineraryDates = (html) => {
    const clean = html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
    const openings = [...clean.matchAll(/<(?:section|article)\b[^>]*>/gi)].filter((match) => readAttribute(match[0], "class").split(/\s+/).includes("day"));
    return openings.map((match, index) => {
      const openTag = match[0];
      const nextIndex = openings[index + 1]?.index ?? clean.length;
      const segment = clean.slice(match.index, nextIndex);
      const metadataDate = readAttribute(openTag, "data-itinerary-date") || readAttribute(openTag, "data-date");
      const visibleIso = segment.match(/<time\b[^>]*datetime\s*=\s*(["'])(\d{4}-\d{2}-\d{2})\1/i)?.[2]
        || segment.match(/<small\b[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/small>/i)?.[1]
        || "";
      return { date: metadataDate || visibleIso, metadataDate, visibleIso };
    });
  };
  const compareDateLists = (actual, expected, label) => {
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const missing = expected.filter((date) => !actualSet.has(date));
    const extra = actual.filter((date) => !expectedSet.has(date));
    if (missing.length) failures.push(label + "缺少日期：" + missing.join("、"));
    if (extra.length) failures.push(label + "存在额外日期：" + extra.join("、"));
    if (!missing.length && !extra.length && actual.join(",") !== expected.join(",")) failures.push(label + "日期顺序不正确。");
  };

  const pageStart = source.match(/\bdata-trip-start\s*=\s*(["'])(\d{4}-\d{2}-\d{2})\1/i)?.[2] || "";
  const pageEnd = source.match(/\bdata-trip-end\s*=\s*(["'])(\d{4}-\d{2}-\d{2})\1/i)?.[2] || "";
  const pageDatesRaw = source.match(/\bdata-trip-dates\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim() || "";
  const pageDatePolicy = source.match(/\bdata-trip-date-policy\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim() || "";
  const hasExpectedDateOptions = Boolean(expectedDatesOption || expectedStartOption || expectedEndOption);
  const pageDeclaresDates = Boolean(pageStart || pageEnd || pageDatesRaw);
  const hasDateValidationInput = hasExpectedDateOptions || pageDeclaresDates;
  if ((expectedStartOption && !expectedEndOption) || (!expectedStartOption && expectedEndOption)) failures.push("--expected-start 与 --expected-end 必须同时提供。");
  if (expectedDatesOption && (expectedStartOption || expectedEndOption)) failures.push("--expected-dates 不能与 --expected-start/--expected-end 同时使用。");
  if (full && pageDeclaresDates && !hasExpectedDateOptions) failures.push("页面声明了日期基线，必须从用户或主资料传入 --expected-start/--expected-end 或 --expected-dates，不能只依赖页面自报日期。");
  if (full && hasExpectedDateOptions && !pageDatesRaw && !(pageStart && pageEnd)) failures.push("完整攻略已传入预期日期，但缺少页面日期基线：连续行程使用 data-trip-start/data-trip-end，非连续行程使用 data-trip-dates。");
  if (pageDatesRaw && pageDatePolicy !== "explicit-list") failures.push('使用 data-trip-dates 时必须声明 data-trip-date-policy="explicit-list"。');
  if ((pageStart && !pageEnd) || (!pageStart && pageEnd)) failures.push("data-trip-start 与 data-trip-end 必须同时存在。");

  let expectedDates = [];
  if (expectedDatesOption) expectedDates = parseDateList(expectedDatesOption, "--expected-dates");
  else if (expectedStartOption && expectedEndOption) expectedDates = buildDateRange(expectedStartOption, expectedEndOption, "预期行程");
  else if (pageDatesRaw) expectedDates = parseDateList(pageDatesRaw, "data-trip-dates");
  else if (pageStart && pageEnd) expectedDates = buildDateRange(pageStart, pageEnd, "页面行程");

  const pageDeclaredDates = pageDatesRaw ? parseDateList(pageDatesRaw, "data-trip-dates") : (pageStart && pageEnd ? buildDateRange(pageStart, pageEnd, "页面行程") : []);
  if (expectedDates.length && pageDeclaredDates.length) compareDateLists(pageDeclaredDates, expectedDates, "页面日期基线与权威日期清单不一致：");

  const itineraryEntries = extractItineraryDates(source);
  const itineraryDates = itineraryEntries.map((entry) => entry.date).filter(Boolean);
  if (hasDateValidationInput) {
    const undatedCards = itineraryEntries.filter((entry) => !entry.date).length;
    if (undatedCards) failures.push("逐日行程中有 " + undatedCards + " 张卡片缺少可识别日期。");
    if (full) {
      const missingMetadata = itineraryEntries.filter((entry) => !entry.metadataDate).length;
      if (missingMetadata) failures.push("完整攻略中有 " + missingMetadata + " 张行程卡缺少 data-itinerary-date。");
    }
    itineraryEntries.forEach((entry) => {
      if (entry.metadataDate && !parseIsoDate(entry.metadataDate)) failures.push("行程卡包含无效 data-itinerary-date：" + entry.metadataDate);
      if (entry.metadataDate && entry.visibleIso && entry.metadataDate !== entry.visibleIso) failures.push("行程卡机器日期与可见日期不一致：" + entry.metadataDate + " / " + entry.visibleIso);
    });
    const duplicateDates = [...new Set(itineraryDates.filter((date, index) => itineraryDates.indexOf(date) !== index))];
    if (duplicateDates.length) failures.push("逐日行程存在重复日期：" + duplicateDates.join("、"));
    if (expectedDates.length) compareDateLists(itineraryDates, expectedDates, "逐日行程与权威日期清单不一致：");
  }

  if (baselineHtml) {
    if (!hasDateValidationInput) failures.push("使用 --baseline-html 时必须同时提供权威日期或页面日期基线。");
    const baselineDates = extractItineraryDates(baselineHtml).map((entry) => entry.date).filter(Boolean);
    if (!baselineDates.length) failures.push("旧版页面未提取到逐日日期，无法执行日期缩减门禁。");
    const currentSet = new Set(itineraryDates);
    const removedDates = baselineDates.filter((date) => !currentSet.has(date));
    if (removedDates.length && !allowDateRemoval) failures.push("新版相对旧版删除了日期：" + removedDates.join("、") + "。仅在用户明确授权后使用 --allow-date-removal。");
  } else if (allowDateRemoval) failures.push("--allow-date-removal 只能与 --baseline-html 一起使用。");
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const stack = [];
  for (const match of markup.matchAll(/<\/?([a-z][\w:-]*)(?:\s[^<>]*?)?\s*\/?>/gi)) {
    const raw = match[0];
    const tag = match[1].toLowerCase();
    if (raw.startsWith("</")) {
      const open = stack.pop();
      if (open !== tag) { failures.push(`HTML 标签闭合异常：期望 ${open || "无"}，实际 ${tag}`); break; }
    } else if (!voidTags.has(tag) && !raw.endsWith("/>")) stack.push(tag);
  }
  if (stack.length) failures.push(`HTML 标签未闭合：${stack.at(-1)}`);

  for (const match of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = match[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/(['"])(?:\\.|(?!\1)[\s\S])*\1/g, "");
    let depth = 0;
    for (const char of css) { if (char === "{") depth++; if (char === "}") depth--; if (depth < 0) break; }
    if (depth !== 0) { failures.push("CSS 花括号未闭合。"); break; }
  }

  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1];
    if (/type\s*=\s*["'][^"']*json[^"']*["']/i.test(attributes)) {
      try { JSON.parse(match[2]); } catch (error) { failures.push(`application/json 数据无效：${error.message}`); }
      continue;
    }
    if (/type\s*=\s*["']module["']/i.test(attributes)) { failures.push("内嵌 module 脚本不在当前校验范围，请改用 IIFE 或单独校验。"); continue; }
    try { new Function(match[2]); } catch (error) { failures.push(`内嵌 JavaScript 语法错误：${error.message}`); }
  }

  if (full) {
    const moduleRegistry = getModuleRegistry();
    const runtimeChecklistBlock = extractElementBlock(markup, "data-guide-module", "checklist");
    const checklistContainers = (markup.match(/data-checklist\s*=/gi) || []).length;
    if (checklistContainers !== 1) failures.push(`完整攻略必须只有一个 data-checklist 容器，当前为 ${checklistContainers} 个。`);
    if (/guide-checklist-tools|data-checklist-toggle|data-checklist-edit|data-checklist-add-button/i.test(runtimeChecklistBlock)) failures.push("清单工具栏不得由页面 HTML 预置，必须交给共享交互脚本生成。");
    if (/https?:\/\/[^"'<>]*leaflet[^"'<>]*\.css[^>]*\bintegrity\s*=/i.test(source)) failures.push("Leaflet CSS 不得使用未经字节核验的 integrity；无法核验时删除该属性。");
    if (!/\.card\s*\{[^}]*min-width\s*:\s*0/i.test(source) && /\.grid-2|\.grid|\.recommend-grid/i.test(source)) failures.push("响应式卡片缺少 min-width:0，可能被宽表格撑出手机视口。");
    if (!/data-guide-mode\s*=\s*["']full["']/i.test(source)) failures.push('完整攻略缺少 data-guide-mode="full"。');
    const missingEmbeddedSentinels = EXPECTED_ASSET_SENTINELS.filter(({ marker }) => !source.includes(marker));
    if (missingEmbeddedSentinels.length) failures.push(`完整攻略缺少内嵌公共资产哨兵：${missingEmbeddedSentinels.map(({ marker }) => marker).join(" / ")}`);
    const initCount = (source.match(/TravelGuideInteractions\.initGuidePage\s*\(/g) || []).length;
    if (initCount !== 1) failures.push(`完整攻略必须且只能调用一次 initGuidePage()，当前为 ${initCount} 次。`);
    const requiredSearchIds = ["guide-floating-actions", "guide-today-trigger", "guide-search-trigger", "guide-search-panel", "guide-search-form", "guide-search-input", "guide-search-results", "guide-search-close", "guide-search-clear", "guide-search-prev", "guide-search-next", "guide-search-count"];
    requiredSearchIds.forEach((id) => {
      if (!new RegExp(`id\\s*=\\s*["']${id}["']`, "i").test(source)) failures.push(`完整攻略缺少搜索 DOM：#${id}`);
    });
    if ((source.match(/data-guide-floating-tools(?:\s|=|>)/gi) || []).length !== 1) failures.push("完整攻略必须只有一个右下角组合工具容器。");
    if ((source.match(/data-guide-floating-toggle(?:\s|=|>)/gi) || []).length !== 1) failures.push("完整攻略必须只有一个组合工具开关。");
    if (!/<link\b(?=[^>]*\brel\s*=\s*["']preload["'])(?=[^>]*\bas\s*=\s*["']image["'])(?=[^>]*\bhref\s*=\s*["']assets\/niumou-spritesheet\.webp["'])[^>]*>/i.test(source)) failures.push("完整攻略缺少牛哞组合菜单素材预加载声明。");
    if (!/id\s*=\s*["']guide-today-trigger["'][^>]*data-floating-action\s*=\s*["']today["'][^>]*data-day-jump/i.test(source)) failures.push("组合工具缺少可由日期模块接管的“今天”入口。");

    const sourceLinks = new Set([...source.matchAll(/href\s*=\s*["']#source-(\d+)["']/gi)].map((match) => match[1]));
    const sourceIds = new Set([...source.matchAll(/id\s*=\s*["']source-(\d+)["']/gi)].map((match) => match[1]));
    sourceLinks.forEach((id) => { if (!sourceIds.has(id)) failures.push(`来源链接 #source-${id} 缺少对应锚点。`); });
    const orderedSourceIds = [...sourceIds].map(Number).sort((left, right) => left - right);
    if (orderedSourceIds.some((id, index) => id !== index + 1)) failures.push("资料来源锚点必须从 1 连续递增。");
    for (const match of source.matchAll(/<li\b(?=[^>]*\bid\s*=\s*["']source-(\d+)["'])[^>]*>/gi)) {
      const id = Number(match[1]);
      const value = Number(readAttribute(match[0], "value"));
      if (value !== id) failures.push(`资料来源 source-${id} 的显示编号必须为 ${id}。`);
    }
    const sourcesBlock = extractElementBlock(markup, "data-guide-module", "sources");
    const xhsGroup = extractElementBlock(sourcesBlock, "data-source-group", "xiaohongshu");
    if (!xhsGroup) failures.push('资料来源缺少 data-source-group="xiaohongshu" 分组。');
    else {
      const xhsGroupOpenTag = xhsGroup.match(/^<[^>]+>/i)?.[0] || "";
      const requiredCount = Number(readAttribute(xhsGroupOpenTag, "data-xhs-required-count"));
      const readCount = Number(readAttribute(xhsGroupOpenTag, "data-xhs-read-count"));
      if (requiredCount !== XHS_GENERAL_REQUIRED_COUNT) failures.push(`小红书来源分组必须声明 data-xhs-required-count="${XHS_GENERAL_REQUIRED_COUNT}"。`);
      if (!Number.isInteger(readCount) || readCount < 0) failures.push("小红书来源分组的 data-xhs-read-count 必须是非负整数。");
      const xhsLinks = new Set([...xhsGroup.matchAll(/https?:\/\/(?:www\.)?(?:xiaohongshu\.com|xhslink\.com)(?:[^\s"'<>]*)/gi)].map((match) => match[0].replace(/[),.;]+$/, "")));
      const noteIds = [...xhsLinks].map(xiaohongshuIdentity);
      if (noteIds.some(id => !id) || new Set(noteIds).size !== xhsLinks.size) failures.push("小红书笔记 ID 必须可识别且去重，分享参数不能重复计数。");
      if (Number.isInteger(readCount) && readCount >= 0 && xhsLinks.size !== readCount) failures.push(`小红书实际读取数声明为 ${readCount}，但资料来源中仅发现 ${xhsLinks.size} 个去重原始链接。`);
      if (readCount < XHS_GENERAL_REQUIRED_COUNT || xhsLinks.size < XHS_GENERAL_REQUIRED_COUNT) failures.push(`完整攻略必须至少读取 ${XHS_GENERAL_REQUIRED_COUNT} 篇去重的小红书攻略，不可用不足原因或替代来源豁免。`);
    }

    ["route-map-loading", "route-map-status"].forEach((id) => {
      const count = (markup.match(new RegExp(`\\bid\\s*=\\s*["']${id}["']`, "gi")) || []).length;
      if (count !== 1) failures.push(`动态地图必须且只能有一个 #${id} 状态容器，当前为 ${count} 个。`);
    });
    if (/\bid\s*=\s*["']map-status["']/i.test(markup)) failures.push("动态地图不得保留平行的 #map-status 状态容器。");
    const modules = new Set([...source.matchAll(/data-guide-module\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1].trim()));
    const required = moduleRegistry.filter((module) => module.required).map((module) => module.name);
    required.filter((name) => !modules.has(name)).forEach((name) => failures.push(`完整攻略缺少内容模块：${name}`));
    ["visa", "safety", "weather"].filter((name) => modules.has(name)).forEach((name) => failures.push(`模块 ${name} 应合并到 checklist，不应单独存在。`));

    const requiredMainTitles = Object.fromEntries(moduleRegistry.filter((module) => module.title).map((module) => [module.name, module.title]));
    Object.entries(requiredMainTitles).forEach(([module, expectedTitle]) => {
      if (!modules.has(module)) return;
      const section = extractElementBlock(markup, "data-guide-module", module);
      const h2 = section.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || "";
      const actualTitle = h2.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!actualTitle) failures.push(`模块 ${module} 缺少主章节 <h2>。`);
      else if (actualTitle !== expectedTitle) failures.push(`模块 ${module} 的主章节标题必须为“${expectedTitle}”，当前为“${actualTitle}”。`);
    });

    const readNavAttribute = (attributes, name) => attributes.match(new RegExp("\\b" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i"))?.[2]?.trim() || "";
    const moduleElements = [...markup.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)].map((match) => ({
      attributes: match[2],
      module: readNavAttribute(match[2], "data-guide-module"),
      id: readNavAttribute(match[2], "id"),
      navLabel: readNavAttribute(match[2], "data-nav-label")
    })).filter((item) => item.module);
    const actualModuleOrder = moduleElements.map((item) => item.module);
    const expectedModuleOrder = moduleRegistry.filter((module) => module.required || modules.has(module.name)).map((module) => module.name);
    if (JSON.stringify(actualModuleOrder) !== JSON.stringify(expectedModuleOrder)) failures.push(`主章节顺序必须固定为 ${expectedModuleOrder.join(" → ")}。`);
    const navMatch = source.match(/<nav\b([^>]*\bdata-quick-nav\b[^>]*)>([\s\S]*?)<\/nav>/i);
    if (!navMatch) failures.push("完整攻略缺少 data-quick-nav 导航容器。");
    else {
      if (!/\bclass\s*=\s*["'][^"']*\bquick-nav\b[^"']*["']/i.test(navMatch[1])) failures.push("data-quick-nav 容器缺少 quick-nav 样式类。");
      if (/<a\b/i.test(navMatch[2])) failures.push("新攻略不得在导航容器内维护固定链接；应由实际章节自动生成。");
    }
    const navigableModules = moduleElements.filter((item) => item.module !== "hero" && !/\bhidden\b/i.test(item.attributes) && !/data-nav-hidden\s*=\s*["']true["']/i.test(item.attributes));
    navigableModules.forEach((item) => {
      if (!item.id) failures.push("导航模块 " + item.module + " 缺少唯一 id。");
      if (!item.navLabel) failures.push("导航模块 " + item.module + " 缺少 data-nav-label。");
    });
    const navIds = navigableModules.map((item) => item.id).filter(Boolean);
    if (new Set(navIds).size !== navIds.length) failures.push("导航模块存在重复 id。");
    const navLabels = navigableModules.map((item) => item.navLabel).filter(Boolean);
    if (new Set(navLabels).size !== navLabels.length) failures.push("导航模块存在重复 data-nav-label。");
    const directNavInitCount = (source.match(/(?:TravelGuideInteractions|api)\.initQuickNav\s*\(/g) || []).length;
    if (directNavInitCount) failures.push("完整攻略不得单独调用 initQuickNav()；导航由 initGuidePage() 默认初始化。");
    const featureMatch = source.match(/data-guide-features\s*=\s*["']([^"']*)["']/i);
    const features = new Set((featureMatch?.[1] || "").split(/\s+/).filter(Boolean));
    const isV2 = new RegExp(`data-guide-version\\s*=\\s*["']${GUIDE_DATA_VERSION.replaceAll(".", "\\.")}["']`, "i").test(source);
    if (isV2) {
      const activeTheme = source.match(/<body\b[^>]*\bdata-guide-theme=["']([^"']+)["']/i)?.[1] || "";
      const defaultTheme = source.match(/<body\b[^>]*\bdata-guide-default-theme=["']([^"']+)["']/i)?.[1] || "";
      const allowedThemes = GUIDE_THEMES.map(([id]) => id);
      if (!allowedThemes.includes(activeTheme) || activeTheme !== defaultTheme) failures.push(`页面必须以同一有效语义主题初始化 data-guide-theme 与 data-guide-default-theme：${allowedThemes.join("、")}。`);
      const heroBlock = extractElementBlock(markup, 'data-guide-module', 'hero');
      const heroWithoutThemeLauncher = heroBlock.replace(/<button\b[^>]*data-guide-theme-launcher[^>]*>[\s\S]*?<\/button>/i, '');
      if (!/^<header\b/i.test(heroBlock) || !/\bhero-cover\b/i.test(heroBlock) || !/\bhero-cover-frame\b/i.test(heroBlock)
        || !/<img\b[^>]*class="hero-cover-image"[^>]*>/i.test(heroBlock) || !/<h1\b[^>]*>[^<]+<\/h1>/i.test(heroBlock)
        || !/<p\b[^>]*class="hero-kicker"[^>]*>\s*ITINERARY\s*<\/p>/i.test(heroBlock)
        || !/<p\b[^>]*class="hero-subtitle"[^>]*>[^<]+<\/p>/i.test(heroBlock)
        || !/\bhero-cover-header\b/i.test(heroBlock) || !/\bhero-cover-footer\b/i.test(heroBlock)
        || !/<button\b[^>]*data-guide-theme-launcher[^>]*aria-controls=["']guide-theme-popover["']/i.test(heroBlock)
        || /<(?:button|input|a)\b/i.test(heroWithoutThemeLauncher)
        || /data-resume-day|hero-execution-link|hero-cover-credit|图片[：:]/i.test(heroBlock)) failures.push('首屏必须使用统一图片封面，只保留主题入口、ITINERARY、主标题、路线摘要与底部事实；不得生成行程入口或图片来源。');
      if (!/data-guide-theme-popover/i.test(source) || !/data-guide-theme-picker/i.test(source) || (source.match(/data-guide-theme=["'](?:rainforest|coast|terracotta|ink|burgundy|midnight)["']/g) || []).length < 6) failures.push('页面缺少非模态六主题调色盘。');
      if (/\bhero-(?:facts|roast|roast-list|roast-label)\b/i.test(heroBlock) || /<aside\b/i.test(heroBlock)) failures.push('首屏不得显示额外的行程事实或目的地短评。');
    }
    if (isV2 && !new RegExp(`data-guide-template-version\\s*=\\s*["']${PAGE_TEMPLATE_VERSION.replaceAll(".", "\\.")}["']`, "i").test(source)) failures.push(`2.0 页面缺少固定模板版本 ${PAGE_TEMPLATE_VERSION}。`);
    if (features.has("collaboration")) {
      if (!/data-guide-collaboration-runtime/i.test(source) || !/data-guide-collaboration-init/i.test(source)) failures.push("已声明 collaboration，但缺少协作运行时或初始化脚本。");
      if (!/TravelGuideCollaboration\.init\s*\(/.test(source) || !/TravelGuideFlightCollaboration\.init\s*\(/.test(source)) failures.push("已声明 collaboration，但协作初始化不完整。");
      if (!/编辑行程/.test(source)) failures.push("已声明 collaboration，但缺少“编辑行程”入口文案。");
    }
    if (modules.has("arrival") && !features.has("arrival")) failures.push("存在 arrival 模块但未声明 arrival 功能。");
    if (modules.has("arrival") && !features.has("flight-records")) failures.push("存在 arrival 模块但未声明 flight-records 功能。");
    if (features.has("flight-records")) {
      const arrivalBlock = extractElementBlock(markup, "data-guide-module", "arrival");
      const roots = (arrivalBlock.match(/data-flight-records(?:\s|=|>)/gi) || []).length;
      if (!modules.has("arrival")) failures.push("已声明 flight-records，但缺少 arrival 内容模块。");
      if (roots !== 1) failures.push(`到达/离开模块必须且只能有一个机票记录组件，当前为 ${roots} 个。`);
      ["data-flight-list", "data-flight-manage", "data-flight-editor", "data-flight-form", "data-flight-file", "data-flight-link", "data-flight-status", "data-flight-viewer"].forEach((marker) => {
        if (!new RegExp(marker, "i").test(arrivalBlock)) failures.push(`机票记录组件缺少 ${marker}。`);
      });
      if (!/data-flight-seed/i.test(source)) failures.push("机票记录组件缺少 data-flight-seed。");
      const cardCount = (arrivalBlock.match(/data-flight-card(?:\s|=|>)/gi) || []).length;
      for (const ticket of arrivalBlock.matchAll(/<article\b[^>]*data-flight-card(?:\s|>)[\s\S]*?<\/article>/gi)) {
        if (/data-flight-link-view|打开购票链接/.test(ticket[0])) failures.push("机票卡片外层不得显示打开购票链接，链接只放在管理区。");
        if (/添加机票凭证|data-flight-manage|data-flight-new/.test(ticket[0])) failures.push("机票卡内不得出现新增或管理入口。");
      }
      if (/data-flight-(?:new|select|delete)(?:\s|=|>)/i.test(arrivalBlock)) failures.push("机票管理区不得提供逐份凭证列表、新增或删除入口。");
      if (cardCount && !/>\s*管理凭证\s*</i.test(arrivalBlock)) failures.push("已有机票时管理入口必须显示“管理凭证”。");
      if (!/>\s*(?:录入凭证|管理凭证)\s*</i.test(arrivalBlock)) failures.push("机票顶部入口只能显示“录入凭证”或“管理凭证”。");
      if (/data-flight-field|flight-core-grid/.test(arrivalBlock)) failures.push("机票录入表单不得包含手工航班字段。");
      if (cardCount && /class=["'][^"']*flight-empty/.test(arrivalBlock)) failures.push("已有卡片时不得显示机票空状态。");
      if (!/flights\s*:\s*true/i.test(source)) failures.push("已声明 flight-records，但 initGuidePage() 未启用 flights。");
    }
    if (/data-exchange-tool/i.test(markup) && !features.has("exchange")) failures.push("存在汇率组件但未声明 exchange 功能。");
    if (/id\s*=\s*["']travel-source-index["']/i.test(source) && !features.has("source-index")) failures.push("存在资料索引但未声明 source-index 功能。");
    if (/data-weather-card/i.test(markup) && !features.has("weather-refresh")) failures.push("存在天气卡但未声明 weather-refresh 功能。");
    if (features.has("arrival") && !modules.has("arrival")) failures.push("已声明 arrival，但缺少 arrival 内容模块。");
    if (features.has("exchange")) {
      const tool = source.match(/<[^>]+data-exchange-tool[^>]*>/i)?.[0] || "";
      if (!tool) failures.push("已声明 exchange，但缺少 data-exchange-tool。");
      if (!/data-exchange-targets\s*=\s*["'][^"']+["']/i.test(tool)) failures.push("汇率组件缺少显式 data-exchange-targets。");
      if (!/id\s*=\s*["']guide-exchange-trigger["'][^>]*data-floating-action\s*=\s*["']exchange["']/i.test(source)) failures.push("汇率换算缺少牛哞菜单入口。");
      if (!/data-exchange-dialog(?:\s|=|>)/i.test(markup)) failures.push("汇率换算缺少独立弹窗。");
      for (const field of ["data-exchange-local-input", "data-exchange-input", "data-exchange-rate-base", "data-exchange-rate-usd", "data-exchange-mnemonic"]) {
        if (!source.includes(field)) failures.push(`汇率换算缺少 ${field}。`);
      }
      const budgetBlock = extractElementBlock(markup, "id", "budget");
      if (budgetBlock && /data-exchange-tool/i.test(budgetBlock)) failures.push("汇率换算不得重复出现在预算正文。");
    }
    if (features.has("source-index") && !/<script\b[^>]*id\s*=\s*["']travel-source-index["'][^>]*type\s*=\s*["']application\/json["']/i.test(source) && !/<script\b[^>]*type\s*=\s*["']application\/json["'][^>]*id\s*=\s*["']travel-source-index["']/i.test(source)) failures.push("已声明 source-index，但缺少 application/json 资料索引。");
    if (features.has("source-index")) {
      const advancedButton = source.match(/<button\b[^>]*id\s*=\s*["']guide-search-advanced["'][^>]*>/i)?.[0] || "";
      if (!advancedButton) failures.push("已声明 source-index，但缺少 #guide-search-advanced 按钮。");
      else if (/\bdisabled\b/i.test(advancedButton)) failures.push("已声明 source-index 时，高级搜索按钮不得禁用。");
      const indexScript = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find((match) => /id\s*=\s*["']travel-source-index["']/i.test(match[1]));
      if (indexScript) {
        try {
          const items = JSON.parse(indexScript[2]);
          if (!Array.isArray(items) || !items.length) failures.push("资料来源索引必须是非空数组。");
          else items.forEach((item, index) => {
            if (!Number.isInteger(item?.sourceId)) failures.push(`资料来源索引 ${index + 1} 缺少整数 sourceId。`);
            if (!String(item?.title || "").trim()) failures.push(`资料来源索引 ${index + 1} 缺少 title。`);
            if (!Array.isArray(item?.cities) || !Array.isArray(item?.tags)) failures.push(`资料来源索引 ${index + 1} 的 cities/tags 必须是数组。`);
            if (Number.isInteger(item?.sourceId) && !sourceIds.has(String(item.sourceId))) failures.push(`资料来源索引 ${index + 1} 指向不存在的 #source-${item.sourceId}。`);
          });
        } catch (_error) { failures.push("资料来源索引 JSON 无法解析。"); }
      }
    }
    if (isV2) {
      if (!features.has("day-tabs")) failures.push("2.0 完整攻略必须声明 day-tabs。");
      if (features.has("itinerary-filter") || /data-filter(?:\s|=|>)/i.test(markup)) failures.push("2.0 逐日行程不得保留分类筛选；统一使用日期 Tab 单卡切换。");
      const dayTabTags = [...markup.matchAll(/<button\b[^>]*\bdata-day-tab\s*=\s*["']\d+["'][^>]*>/gi)].map((match) => match[0]);
      const dayPanelTags = [...markup.matchAll(/<article\b[^>]*\bdata-day-panel\s*=\s*["']\d+["'][^>]*>/gi)].map((match) => match[0]);
      const intensityBlocks = [...markup.matchAll(/<p\b[^>]*\bclass\s*=\s*["'][^"']*\bday-intensity\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)].map((match) => match[1]);
      const overviewActionGroups = [...markup.matchAll(/<div\b[^>]*\bclass\s*=\s*["'][^"']*\bday-overview-actions\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)].map((match) => match[1]);
      if (!/data-day-tabs(?:\s|=|>)/i.test(markup) || !dayTabTags.length) failures.push("2.0 逐日行程缺少日期 Tab 容器或按钮。");
      if (dayTabTags.length !== dayPanelTags.length || dayPanelTags.length !== itineraryEntries.length) failures.push(`日期 Tab、日程面板与日期卡数量必须一致，当前为 ${dayTabTags.length}/${dayPanelTags.length}/${itineraryEntries.length}。`);
      if (intensityBlocks.length !== dayPanelTags.length) failures.push(`每张逐日卡必须有一个 🌟 强度提示，当前为 ${intensityBlocks.length}/${dayPanelTags.length}。`);
      intensityBlocks.forEach((block, index) => {
        const score = Number(block.match(/([0-5](?:\.0|\.5))\s*🌟/)?.[1]);
        if (!Number.isFinite(score) || score < 0 || score > 5 || !Number.isInteger(score * 2)) failures.push(`第 ${index + 1} 个行程强度必须按 N.N 🌟 显示，范围 0–5、步长 0.5。`);
      });
      if (intensityBlocks.some((block) => /行程强度\s*[：:]/u.test(block.replace(/<[^>]+>/g, "")))) failures.push("行程强度文案不得保留冒号；应显示为“行程强度 2.5 🌟”。");
      if (overviewActionGroups.length !== dayPanelTags.length || overviewActionGroups.some((group) => !/data-show-day-map/i.test(group) || !/day-intensity/i.test(group))) failures.push("每张逐日卡的当天地图和行程强度必须位于日期摘要区同一组。");
      for (const panel of markup.matchAll(/<article\b[^>]*\bdata-day-panel\s*=\s*["']\d+["'][^>]*>([\s\S]*?)<\/article>/gi)) {
        const body = panel[1];
        const navigation = /\bdata-day-navigation(?:\s|=|>)/i.test(body);
        const action = /href=["']#day-navigation-\d+["']/i.test(body);
        if (navigation || action) failures.push("逐日卡不得输出重复的当天导航入口；请仅保留时间线内分段导航。");
        if (features.has("day-navigation") && /\bdata-day-route-summary(?:\s|=|>)/i.test(body) && !/\bdata-navigation-segment(?:\s|=|>)/i.test(body)) failures.push("没有可连接路段时不得显示当日路线空壳。");
      }
      if (!source.includes(".day-overview-actions {")) failures.push("逐日卡缺少日期摘要操作组样式。 ");
      if (dayPanelTags.filter((tag) => !/\bhidden\b/i.test(tag)).length !== 1) failures.push("2.0 逐日行程初始状态必须且只能显示一张日程卡。");
      if (/data-day-(?:prev|next|progress)/i.test(markup) || /class\s*=\s*["'][^"']*day-(?:prev|next|progress)[^"']*["']/i.test(markup)) failures.push("2.0 逐日行程不得输出上一天、下一天或数字进度控件。");
      if (!features.has("day-map")) failures.push("2.0 完整攻略必须声明 day-map。");
      if (/data-map-view\s*=\s*["']all["']/i.test(markup)) failures.push("逐日现场地图不得恢复整程地图控件。");
      if (!/id\s*=\s*["']itinerary-explore["']/i.test(markup)) failures.push("逐日行程缺少共用的现场探索地图。");
      if (/data-map-view\s*=\s*["']day-\d+["']/i.test(markup) || /class\s*=\s*["'][^"']*route-map-views/i.test(markup)) failures.push("每日地图不得重复输出日期选择；请复用逐日行程日期 Tab。");
      if (features.has("contextual-explore") && !/data-map-view\s*=\s*["']segment-[^"']+["']/i.test(markup)) failures.push("已启用现场探索但缺少 A→B 路段入口。");
      if (features.has("nearby-explore")) {
        const policyScript = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match => /\bdata-nearby-policy\b/.test(match[1]));
        if (policyScript.length !== 1 || !/type\s*=\s*["']application\/json["']/i.test(policyScript[0]?.[1] || "")) failures.push("附近逛逛必须有唯一的 application/json 逐日策略记录。");
        else try {
          const policies = JSON.parse(policyScript[0][2]);
          if (!Array.isArray(policies)) throw Error("逐日策略不是数组");
          const dayNumbers = dayPanelTags.map(tag => Number(readAttribute(tag, "data-day-panel")));
          const policyDays = policies.map(entry => entry?.dayNumber);
          if (policies.length !== dayNumbers.length || new Set(policyDays).size !== policyDays.length || dayNumbers.some(day => !policyDays.includes(day))) failures.push("附近逛逛逐日策略必须与全部行程日一一对应，包括不显示日。");
          let visibleDays = 0, cardCount = 0;
          for (const entry of policies) {
            const panel = extractElementBlock(markup, "data-nearby-panel", `day-${entry.dayNumber}`);
            const count = (panel.match(/\bdata-nearby-card\s*=/g) || []).length;
            const visible = ["show", "legacy"].includes(entry.status);
            if (visible) {
              visibleDays++;
              const min = entry.status === "legacy" ? 5 : entry.dayType === "transit" ? 1 : 3;
              const max = entry.status === "legacy" ? 10 : entry.dayType === "transit" ? 3 : 5;
              if (entry.status === "show" && !["ordinary", "transit"].includes(entry.dayType)) failures.push("附近逛逛显示日缺少普通日/交通日类别。");
              if (!Number.isInteger(entry.candidateCount) || count !== entry.candidateCount || count < min || count > max || !/\bdata-focus-nearby\s*=/.test(panel)) failures.push(`附近逛逛 D${entry.dayNumber} 候选卡与逐日数量策略不一致。`);
            } else if (!HIDDEN_STATUSES.has(entry.status) || !String(entry.reason || "").trim() || entry.candidateCount !== 0 || panel) failures.push(`附近逛逛 D${entry.dayNumber} 不显示原因或状态无效；研究未完成不得交付。`);
            cardCount += count;
          }
          if ((markup.match(/\bdata-nearby-panel\s*=/g) || []).length !== visibleDays || (markup.match(/\bdata-nearby-card\s*=/g) || []).length !== cardCount) failures.push("附近逛逛存在未对应逐日策略的面板或卡片。");
          if ((markup.match(/\bdata-nearby-switch(?:\s|=|>)/g) || []).length !== (visibleDays ? 1 : 0)) failures.push("附近逛逛开关只在至少一天有可展示候选时生成；全部不显示时不能输出空开关。");
        } catch (error) { failures.push(`附近逛逛逐日策略无法读取：${error.message}`); }
      }
      if (!/class\s*=\s*["'][^"']*execution-item[^"']*["'][^>]*data-place-id/i.test(markup)) failures.push("2.0 逐日条目缺少 data-place-id 地图联动标记。");
      if (!/class\s*=\s*["'][^"']*route-summary-list[^"']*["']/i.test(markup) || !/class\s*=\s*["'][^"']*route-summary-stop[^"']*["']/i.test(markup)) failures.push("2.0 路线总览必须使用紧凑站点步进条，禁止输出整段长链接。");
      if (!/data-checklist-progress-count/i.test(markup) || !/data-checklist-filter/i.test(markup)) failures.push("2.0 核验清单缺少进度或筛选控件。");
      if (features.has("calendar-export")) {
        if (!source.includes("travel-guide-calendar: v2") || !source.includes("TravelGuideCalendar.buildIcs")) failures.push("日历导出必须复用公共 RFC 5545 生成器。");
        const calendarScript = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find((match) => /data-calendar-events/i.test(match[1]));
        if (!/data-calendar-export/i.test(markup) || !calendarScript || !/type\s*=\s*["']application\/json["']/i.test(calendarScript?.[1] || "")) failures.push("已声明 calendar-export，但缺少按钮或 application/json 事件数据。");
        else {
          const mode = readAttribute(`<script ${calendarScript[1]}>`, "data-calendar-mode");
          if (!new Set(["daily", "timed"]).has(mode)) failures.push("日历事件数据必须声明 data-calendar-mode=daily 或 timed。");
          try {
            const events = JSON.parse(calendarScript[2]);
            if (!Array.isArray(events)) failures.push("日历事件数据必须是数组。");
            else if (mode === "daily" && (events.length !== dayPanelTags.length || events.some((event) => event?.allDay !== true))) failures.push("daily 日历必须为每个旅行日生成一个全天事件。");
            else if (mode === "timed" && events.some((event) => event?.allDay || !event?.startTime)) failures.push("timed 日历只能包含有明确开始时间的非全天事件。");
            if (events.some((event) => !/^Day \d+ \| /u.test(String(event?.title || "")))) failures.push("日历 SUMMARY 必须使用简短的 Day N | 标题格式。");
            if (events.some((event) => !String(event?.location || "").trim() || /https?:\/\//i.test(String(event.location)))) failures.push("日历 LOCATION 只能保存核心地名，不得放链接或详细地址。");
            if (events.some((event) => !Array.isArray(event?.descriptionSections) || !event.descriptionSections.length)) failures.push("日历 DESCRIPTION 必须使用结构化 descriptionSections。");
          } catch (_error) { failures.push("日历事件 JSON 无法解析。"); }
        }
      }
      if ((markup.match(/data-mobile-cards(?:\s|=|>)/gi) || []).length < 2) failures.push("2.0 交通与预算表必须启用窄屏卡片转换。");
      if (features.has("expense-tracker") && !/data-expense-tracker/i.test(markup)) failures.push("已声明 expense-tracker，但缺少实际支出组件。");
      if (/当天导航不可用：暂无两个可连接地点/u.test(markup)) failures.push("没有可连接路段时应省略当日路线，不展示无意义的空状态。");
      for (const match of markup.matchAll(/<a\b[^>]*\bdata-navigation-mode\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
        try {
          const url = new URL(readAttribute(match[0], "href").replace(/&amp;/g, "&"));
          if (url.hostname !== "www.google.com" || url.pathname !== "/maps/dir/" || url.searchParams.get("api") !== "1"
            || !["driving", "transit", "walking", "bicycling"].includes(match[1])
            || url.searchParams.get("travelmode") !== match[1] || url.searchParams.has("waypoints")
            || !url.searchParams.get("origin") || !url.searchParams.get("destination")) failures.push("分段导航必须使用相邻起终点和显式交通方式，禁止途经点。");
        } catch (_error) { failures.push("分段导航 URL 无效。"); }
      }
      const classValues = [...markup.matchAll(/\bclass\s*=\s*["']([^"']*)["']/gi)].map((match) => match[1].split(/\s+/));
      const recommendationModules = classValues.filter((classes) => classes.includes("recommendation-module")).length;
      const recommendationNotes = classValues.filter((classes) => classes.includes("recommendation-module-note")).length;
      const localKnowledgeModules = classValues.filter((classes) => classes.includes("local-knowledge-module")).length;
      if (recommendationModules !== 3 + localKnowledgeModules || recommendationNotes > 3 || localKnowledgeModules > 1) failures.push(`推荐章节必须保留三类推荐，文化习俗按适用性出现；整体备注仅按有效内容出现。当前模块/备注/文化习俗为 ${recommendationModules}/${recommendationNotes}/${localKnowledgeModules}。`);
      if (/<div\b[^>]*class\s*=\s*["'][^"']*\bday-notes\b[^"']*["'][^>]*>\s*<\/div>/i.test(markup)) failures.push("逐日补充说明为空时必须省略整个 day-notes 容器。");
      if (/<div\b[^>]*class\s*=\s*["'][^"']*\brecommendation-guidance\b[^"']*["'][^>]*>\s*<\/div>/i.test(markup)) failures.push("推荐限制与现场执行均为空时必须省略提示容器。");
    }
    const checklistBlock = extractElementBlock(source, "data-guide-module", "checklist");
    if (features.has("weather-refresh")) {
      if (!/data-weather-refresh/i.test(checklistBlock)) failures.push("已声明 weather-refresh，但核验清单内缺少刷新按钮。");
      if (!/data-weather-card/i.test(checklistBlock) || !/data-weather-grid/i.test(checklistBlock)) failures.push("天气刷新缺少通用天气卡或结果网格。");
      if (!/data-weather-start-date\s*=\s*["']\d{4}-\d{2}-\d{2}["']/i.test(checklistBlock)) failures.push("天气卡缺少有效 data-weather-start-date。");
      if (!/data-weather-end-date\s*=\s*["']\d{4}-\d{2}-\d{2}["']/i.test(checklistBlock)) failures.push("天气卡缺少有效 data-weather-end-date。");
      if (!/data-rain-threshold\s*=\s*["']80["']/i.test(checklistBlock)) failures.push("天气彩蛋阈值必须为 80%。");
      if (!/data-weather-locations/i.test(checklistBlock)) failures.push("天气卡缺少 application/json 地点配置。");
      const weatherDataScript = [...checklistBlock.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find((match) => /data-weather-locations/i.test(match[1]));
      if (weatherDataScript) {
        try {
          const locations = JSON.parse(weatherDataScript[2]);
          if (!Array.isArray(locations) || !locations.length) failures.push("天气地点配置必须是非空数组。");
          else locations.forEach((location, index) => {
            const latitude = Number(location?.latitude);
            const longitude = Number(location?.longitude);
            if (!String(location?.name || "").trim()) failures.push(`天气地点 ${index + 1} 缺少 name。`);
            if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) failures.push(`天气地点 ${index + 1} 的 latitude 无效。`);
            if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) failures.push(`天气地点 ${index + 1} 的 longitude 无效。`);
          });
        } catch (_error) { failures.push("天气地点 JSON 无法解析。"); }
      }
      if (!/data-rain-prayer-source/i.test(checklistBlock) || !/data-rain-prayer-modal/i.test(checklistBlock)) failures.push("天气卡缺少内嵌求雨彩蛋。");
      ["__TRIP_START_DATE__", "__TRIP_END_DATE__", "__WEATHER_LOCATIONS_JSON__", "__RAIN_PRAYER_SOURCE__"].filter((marker) => source.includes(marker)).forEach((marker) => failures.push("天气模板占位符尚未替换：" + marker));
    }
    const itemsIndex = checklistBlock.search(/data-checklist-items/i);
    const weatherIndex = checklistBlock.search(/(?:data-weather-card|guide-weather-card|data-weather-refresh)/i);
    if (weatherIndex >= 0 && (itemsIndex < 0 || itemsIndex > weatherIndex)) failures.push("天气卡必须位于全部核验事项之后。");
    if (weatherIndex >= 0 && /data-check(?:\s|=)/i.test(checklistBlock.slice(weatherIndex))) failures.push("天气卡之后不得再出现核验事项。");
    if (!/data-checklist(?:\s|=|>)/i.test(source) || !/data-checklist-items/i.test(source)) failures.push("核验清单缺少可编辑 DOM 契约。");
  }

  return { valid: failures.length === 0, failures, expectedDates, itineraryDates };
}

/* 统一输出格式：CLI 与 render-guide 进程内调用共用，保证报告文案一致。 */
function formatResult(result, { full = false, fileLabel = "guide.html" } = {}) {
  const { valid, failures, expectedDates, itineraryDates } = result;
  if (!valid) return `未通过 ${fileLabel}：\n- ${failures.join("\n- ")}`;
  const lines = [];
  if (expectedDates.length) lines.push(`日期验收：${expectedDates[0]} → ${expectedDates.at(-1)}，预期 ${expectedDates.length} 天，实际 ${itineraryDates.length} 张行程卡`);
  lines.push(`通过：${fileLabel}${full ? "（完整攻略）" : "（局部验收）"}`);
  return lines.join("\n");
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith("--"));
  const full = args.includes("--full");
  const expectedStartOption = readOption(args, "expected-start");
  const expectedEndOption = readOption(args, "expected-end");
  const expectedDatesOption = readOption(args, "expected-dates");
  const baselineHtmlOption = readOption(args, "baseline-html");
  const allowDateRemoval = args.includes("--allow-date-removal");
  if (!file) {
    console.error("Usage: node validate-guide-contract.js <html-file> [--full] [--expected-start=YYYY-MM-DD --expected-end=YYYY-MM-DD | --expected-dates=YYYY-MM-DD,...] [--baseline-html=old.html] [--allow-date-removal]");
    process.exit(2);
  }
  let source = "";
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file));
  } catch (error) {
    console.error(`未通过 ${path.basename(file)}：\n- UTF-8 读取失败：${error.message}`);
    process.exit(1);
  }
  let baselineHtml = "";
  if (baselineHtmlOption) {
    try {
      baselineHtml = fs.readFileSync(path.resolve(baselineHtmlOption), "utf8");
    } catch (error) {
      console.error(`未通过 ${path.basename(file)}：\n- 读取旧版页面失败：${error.message}`);
      process.exit(1);
    }
  }
  const result = validateGuideContract(source, { full, expectedStartOption, expectedEndOption, expectedDatesOption, baselineHtml, allowDateRemoval, fileLabel: path.basename(file) });
  console.log(formatResult(result, { full, fileLabel: path.basename(file) }));
  if (!result.valid) process.exit(1);
}

module.exports = { validateGuideContract, formatResult };
