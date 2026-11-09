#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { crc32 } = require("node:zlib");
const { readUtf8Json, validateTripData, runPipelineValidation, isNonActionableSupplement } = require("./validate-trip-data.js");
const { GUIDE_DATA_VERSION, PAGE_TEMPLATE_VERSION, RECOMMENDATION_CATEGORIES, GUIDE_THEMES } = require("./shared-constants.js");
const { PUBLIC_PLACEHOLDERS, classifySupabaseKey } = require("./public-config.js");
const { readOption, readCsvOption } = require("./cli-options.js");
const { verifyTemplateLock } = require("./verify-template-lock.js");
const { validateGuideContract, formatResult } = require("./validate-guide-contract.js");
const { renderFlightRecords } = require("../assets/modules/15-flight-records.js");
const { scanElementBlock } = require("./html-fragment.js");
const { visibleNearbyDay } = require("./nearby-policy.js");
const { deliverArtifacts } = require("./render-artifacts.js");
const { xiaohongshuIdentity } = require("./xiaohongshu-identity.js");
const { READING_TOPICS, readingSelection, projectReadingReferences } = require("./supplementary-reading.js");

const skillRoot = path.resolve(__dirname, "..");
const GUIDE_ICONS = [192, 512].map(size => ({
  src: `assets/guide-icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png"
}));
const GUIDE_OUTPUT_ASSETS = Object.freeze(["assets/niumou-spritesheet.webp"]);
const { digest } = require("./qa-evidence.js");
const RENDER_USAGE = "Usage: node render-guide.js <trip-data.json> <guide.html> [--request=trip-request.json] [--brief=trip-brief.json] [--baseline=old-trip-data.json --allow-paths=path1,path2] [--baseline-html=old.html --frozen-modules=itinerary,route-map --freeze-action=fail|restore] [--allow-date-removal] [--map-config=private-map.json] [--supabase-config=private-supabase.json|--no-collaboration] [--public-source --public-collaboration]";

function parseRenderOptions(args = [], env = process.env, homeDirectory = os.homedir()) {
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const collaborationExplicitlyDisabled = args.includes("--no-collaboration");
  const defaultMapConfig = resolvePrivateConfigPath("baidu-map.local.json", env, homeDirectory);
  const defaultSupabaseConfig = resolvePrivateConfigPath("supabase.local.json", env, homeDirectory);
  return {
    args,
    input: positional[0],
    output: positional[1],
    requestPath: readOption(args, "request"),
    briefPath: readOption(args, "brief"),
    baselinePath: readOption(args, "baseline"),
    allowPaths: readCsvOption(args, "allow-paths"),
    baselineHtmlPath: readOption(args, "baseline-html"),
    frozenModules: readCsvOption(args, "frozen-modules"),
    freezeAction: readOption(args, "freeze-action") || "fail",
    allowDateRemoval: args.includes("--allow-date-removal"),
    collaborationExplicitlyDisabled,
    publicSource: args.includes("--public-source"),
    publicCollaboration: args.includes("--public-collaboration"),
    mapConfigPath: readOption(args, "map-config") || (fs.existsSync(defaultMapConfig) ? defaultMapConfig : ""),
    supabaseConfigPath: collaborationExplicitlyDisabled ? "" : readOption(args, "supabase-config") || (fs.existsSync(defaultSupabaseConfig) ? defaultSupabaseConfig : "")
  };
}
function resolveGuideIdentity(data, { baseline = null, baselineHtml = "", previousHtml = "" } = {}) {
  const fromHtml = html => html?.match(/<body\b[^>]*\bdata-guide-id=["']([A-Za-z0-9_-]{8,80})["']/i)?.[1];
  const legacy = meta => crypto.createHash("sha256").update(`${meta.title}|${meta.dates.join(",")}`).digest("hex").slice(0,12);
  const inherited = fromHtml(baselineHtml) || baseline?.meta?.guideId || (baseline?.meta ? legacy(baseline.meta) : null) || fromHtml(previousHtml);
  const explicit = data.meta.guideId;
  if (explicit && !/^[A-Za-z0-9_-]{8,80}$/.test(explicit)) throw new Error("meta.guideId 格式无效。");
  if (explicit && inherited && explicit !== inherited) throw new Error("攻略身份与基线/现有输出不一致；更新不能更换 guideId，新攻略请使用独立输出路径。");
  return explicit || inherited || legacy(data.meta);
}
function resolvePrivateConfigPath(filename, env = process.env, homeDirectory = os.homedir()) {
  const codexHome = env.CODEX_HOME || path.join(homeDirectory, ".codex");
  return path.join(codexHome, "private", "travel-guide-builder-v2", filename);
}
function dayWeatherPlaceId(day, data) {
  const locations = data.weather?.locations || [];
  const byId = new Map(data.places.map(place => [place.id, place]));
  // Same-city days bind by city. Transfer days use the final confirmed destination.
  const matchesCity = city => locations.filter(location => byId.get(location.placeId)?.city === city || location.name === city);
  const cityMatches = matchesCity(day.city);
  if (cityMatches.length === 1) return cityMatches[0].placeId;
  for (const id of [day.accommodation?.endPlaceId, ...day.items.map(item => item.placeId).reverse()]) {
    const place = byId.get(id);
    if (!place) continue;
    const matches = locations.filter(location => location.placeId === id || (byId.get(location.placeId)?.city === place.city && byId.get(location.placeId)?.country === place.country));
    if (matches.length === 1) return matches[0].placeId;
    if (matches.length > 1) return ''; // No silent choice between ambiguous locations.
  }
  return '';
}
// 读取本机自托管域名配置，用于隐私门禁移除指向自己 GitHub Pages 的来源
function readSelfHostsConfig(env = process.env, homeDirectory = os.homedir()) {
  const configPath = resolvePrivateConfigPath("github-self-hosts.local.json", env, homeDirectory);
  if (!fs.existsSync(configPath)) return [];
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!Array.isArray(config.selfHosts)) return [];
    return config.selfHosts.map((host) => {
      if (typeof host !== "string") return "";
      const value = host.trim().toLowerCase();
      if (!value) return "";
      try {
        return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? new URL(value).host.toLowerCase() : (/^[a-z0-9.-]+(?::\d+)?$/i.test(value) ? value : "");
      } catch {
        return "";
      }
    }).filter(Boolean);
  } catch { return []; }
}
// 隐私门禁：在渲染副本中移除自引用来源，不改写 trip-data.json 真相源。
function sanitizeSelfReferenceSources(data, selfHosts) {
  const sanitizedData = structuredClone(data);
  const hosts = new Set((Array.isArray(selfHosts) ? selfHosts : [])
    .filter((host) => typeof host === "string")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean));
  if (!hosts.size || !Array.isArray(sanitizedData.sources)) return { data: sanitizedData, removed: [], remapped: false };
  const urlHost = (value) => {
    try { return new URL(String(value || "")).host.toLowerCase(); }
    catch { return ""; }
  };
  const selfSourceIds = new Set(sanitizedData.sources.filter((source) => hosts.has(urlHost(source.url))).map((source) => Number(source.id)));
  if (!selfSourceIds.size) return { data: sanitizedData, removed: [], remapped: false };
  const ordered = [...sanitizedData.sources].sort((left, right) => Number(left.id) - Number(right.id));
  const idMap = new Map();
  let nextId = 1;
  sanitizedData.sources = [];
  for (const source of ordered) {
    if (selfSourceIds.has(Number(source.id))) continue;
    idMap.set(Number(source.id), nextId);
    sanitizedData.sources.push({ ...source, id: nextId });
    nextId += 1;
  }
  const newIdOrNull = (id) => (idMap.has(Number(id)) ? idMap.get(Number(id)) : null);
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === "object") {
      for (const key of Object.keys(node)) {
        if (key === "sourceIds" && Array.isArray(node[key])) {
          node[key] = node[key].map(newIdOrNull).filter((id) => id !== null);
        } else if (key === "sourceId" && Number.isInteger(node[key])) {
          if (idMap.has(node[key])) node[key] = idMap.get(node[key]);
          else delete node[key];
        } else {
          walk(node[key]);
        }
      }
    }
  };
  if (Array.isArray(sanitizedData.sourceIndex)) {
    sanitizedData.sourceIndex = sanitizedData.sourceIndex.filter((entry) => idMap.has(Number(entry?.sourceId)));
  }
  walk(sanitizedData);
  return { data: sanitizedData, removed: [...selfSourceIds], remapped: true };
}
function readMapConfig(configPath) {
  const empty = { baidu: { enabled: false, ak: "" }, google: { enabled: false, key: "" } };
  if (!configPath) return empty;
  const config = JSON.parse(fs.readFileSync(path.resolve(configPath), "utf8"));
  const baiduAk = typeof config.ak === "string" ? config.ak.trim() : "";
  const googleKey = typeof config.googleMapsApiKey === "string" ? config.googleMapsApiKey.trim() : "";
  if (!baiduAk && !googleKey) throw new Error("地图私有配置缺少百度 Browser AK 或 Google Maps Browser Key；不会写入报告或技能资产。");
  return { baidu: { enabled: Boolean(baiduAk), ak: baiduAk }, google: { enabled: Boolean(googleKey), key: googleKey } };
}

function readSupabaseConfig(configPath) {
  const empty = { enabled: false, projectUrl: "", publishableKey: "" };
  if (!configPath) return empty;
  const config = JSON.parse(fs.readFileSync(path.resolve(configPath), "utf8"));
  const extraFields = Object.keys(config).filter((key) => !["projectUrl", "publishableKey"].includes(key));
  const projectUrl = typeof config.projectUrl === "string" ? config.projectUrl.trim().replace(/\/+$/, "") : "";
  const publishableKey = typeof config.publishableKey === "string" ? config.publishableKey.trim() : "";
  const keyClass = classifySupabaseKey(publishableKey);
  if (extraFields.length || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(projectUrl) || keyClass !== "publishable") {
    const reason = keyClass === "secret" ? "检测到 secret/service_role key" : "只接受 sb_publishable_ 或旧版 anon JWT";
    throw new Error(`Supabase 私有配置格式无效；仅允许 projectUrl 和 publishableKey，${reason}。`);
  }
  return { enabled: true, projectUrl, publishableKey };
}

function htmlDeclaresCollaboration(html) {
  const bodyTag = String(html || "").match(/<body\b[^>]*>/i)?.[0] || "";
  const value = bodyTag.match(/\bdata-guide-features=["']([^"']*)["']/i)?.[1] || "";
  return value.split(/\s+/).includes("collaboration");
}

function assertCollaborationRetention(previousHtml, collaborationEnabled, explicitlyDisabled = false) {
  if (htmlDeclaresCollaboration(previousHtml) && !collaborationEnabled && !explicitlyDisabled) {
    throw new Error("协作能力防回退门禁：基线或现有输出含 collaboration，但本次未读取到 Supabase 可发布配置。请提供 --supabase-config，生成 CI 占位符源文件时使用 --public-source --public-collaboration，或在明确要求关闭时使用 --no-collaboration。");
  }
}

// 渲染器实际会输出的 data-guide-module 词表；冻结名单出现词表外的名称视为拼写错误
let moduleRegistryCache = null;
function getModuleRegistry() {
  if (!moduleRegistryCache) moduleRegistryCache = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "module-registry.json"), "utf8")).modules;
  return moduleRegistryCache;
}
const moduleTitle = (name) => getModuleRegistry().find((module) => module.name === name)?.title || "";
const getKnownModuleNames = () => getModuleRegistry().map((module) => module.name);

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const formatHeroDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value).replaceAll("-", ".") : "";
const heroDateRange = (dates, fallback = "日期待定", { explicitList = false } = {}) => {
  const known = (dates || []).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value))).sort();
  if (!known.length) return fallback;
  const start = formatHeroDate(known[0]);
  const end = formatHeroDate(known.at(-1));
  if (start === end) return start;
  // 非连续日期不显示首尾区间，避免被误读为连续行程；跨年时结束侧补全年份。
  if (explicitList) return `${start} 起的指定日期行程`;
  const startYear = known[0].slice(0, 4);
  return startYear === known.at(-1).slice(0, 4) ? `${start} — ${end.slice(5)}` : `${start} — ${end}`;
};
const list = (items, render) => Array.isArray(items) ? items.map(render).join("") : "";
const textList = (items) => `<ul>${list(items, (item) => `<li>${escapeHtml(typeof item === "string" ? item : item.text || item.name || "")}</li>`)}</ul>`;
const sourceLinks = (ids) => (ids || []).map((id) => `<a class="source-ref" href="#source-${id}" aria-label="查看来源 ${id}">[${id}]</a>`).join("");
const copy = (value) => `<button type="button" class="copy-target" data-copy="${escapeHtml(value)}">${escapeHtml(value)}</button>`;
const xiaohongshuSearchUrl = (keyword) => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(String(keyword || "").trim())}&source=web_explore_feed`;
const xiaohongshuSearchDeeplink = (keyword) => `xhsdiscover://search/result?keyword=${encodeURIComponent(String(keyword || "").trim())}&target_search=notes&source=deeplink`;
const xiaohongshuNoteDeeplink = (value) => {
  const noteId = xiaohongshuIdentity(value);
  return noteId ? `xhsdiscover://item/${noteId}` : "";
};
const xiaohongshuNoteAttrs = (source, keyword = "") => {
  const deeplink = source?.type === "xiaohongshu" ? xiaohongshuNoteDeeplink(source.url) : "";
  const term = keyword.trim() || source?.reading?.title || source?.title || "";
  return deeplink ? ` data-xhs-link data-xhs-keyword="${escapeHtml(term)}" data-xhs-deeplink="${escapeHtml(deeplink)}"` : "";
};
const xiaohongshuSearchLink = (keyword) => `<a href="${escapeHtml(xiaohongshuSearchUrl(keyword))}" data-xhs-link data-xhs-keyword="${escapeHtml(keyword)}" data-xhs-deeplink="${escapeHtml(xiaohongshuSearchDeeplink(keyword))}" target="_blank" rel="noopener noreferrer" aria-label="在小红书搜索 ${escapeHtml(keyword)}">小红书 ↗</a>`;
const money = (value) => Number.isFinite(Number(value)) ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value)) : "待核验";
const currencyChinese = (currency) => {
  const code = String(currency || "").trim().toUpperCase();
  if (!code) return "币种待核验";
  try {
    const name = new Intl.DisplayNames(["zh-CN"], { type: "currency" }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
};
const transportIcon = (mode) => {
  const value = String(mode || "").trim().toLowerCase().replace(/[\s-]/g, "");
  if (["car","drive","taxi","bus","自驾","开车","驾车","出租车","网约车","打车","包车","巴士","公交"].includes(value)) return "🚗";
  if (["plane","flight","飞机","航班"].includes(value)) return "✈️";
  if (["train","rail","highspeedrail","高铁","火车","列车","地铁","轨道交通"].includes(value)) return "🚄";
  if (["walk","步行","徒步"].includes(value)) return "🚶‍♀️";
  if (["bike","bicycle","骑行","自行车"].includes(value)) return "🚲";
  if (["ferry","boat","ship","渡轮","轮渡","坐船","船"].includes(value)) return "🚢";
  if (["cablecar","索道","缆车","空中缆车"].includes(value)) return "🚠";
  if (["mountainrail","funicular","登山铁路","缆索铁路","齿轨铁路"].includes(value)) return "🚞";
  if (["tram","有轨电车"].includes(value)) return "🚋";
  if (["monorail","单轨"].includes(value)) return "🚝";
  if (["minibus","小巴","双条车","吉普尼"].includes(value)) return "🚐";
  if (["rickshaw","人力车","三轮人力车"].includes(value)) return "🛺";
  return "➜";
};
const placeMapOf = (data) => new Map((data.places || []).map((place) => [place.id, place]));
const minutesText = (value) => Number.isInteger(value) ? (value >= 60 ? `${Math.floor(value / 60)} 小时${value % 60 ? ` ${value % 60} 分钟` : ""}` : `${value} 分钟`) : "待核验";
const displayTime = (item) => item.startTime && item.endTime ? `${item.startTime}–${item.endTime}` : item.timeText;
const googleMapsSearchUrl = (place) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([place.name, place.address].filter(Boolean).join(" "))}`;
const renderInformation = (items) => items.length === 1
  ? `<p class="slot-information">${escapeHtml(items[0])}</p>`
  : `<ol class="slot-information-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
const renderItemLinks = (links) => Array.isArray(links) && links.length
  ? `<p class="slot-links">${links.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`).join("<span aria-hidden=\"true\"> · </span>")}</p>`
  : "";
const renderItemReferenceImages = (images) => Array.isArray(images) && images.length
  ? `<div class="itinerary-reference-gallery" aria-label="行程参考图片">${images.map((item) => `<figure class="itinerary-reference-card"><button type="button" class="itinerary-reference-trigger" data-preview-image="${escapeHtml(item.src)}" aria-label="放大查看：${escapeHtml(item.title)}"><img class="guide-reference-image" src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt)}" loading="lazy"></button><figcaption><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.caption)}</span><small>点击图片放大</small></figcaption></figure>`).join("")}</div>`
  : "";
const renderItemNotes = (notes) => Array.isArray(notes) && notes.length
  ? `<aside class="slot-notes"><b>备注：</b>${notes.length === 1 ? `<span>${escapeHtml(notes[0])}</span>` : `<ol>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ol>`}</aside>`
  : "";

function dayRouteNodes(day) {
  const runs = [];
  let current = [];
  const push = (placeId, item = null, role = "place") => {
    if (!placeId) return;
    const node = { placeId, itemId: item?.id || "", mode: item?.transportMode || "", duration: item ? minutesText(item.travelMinutes) : "", role, item, arrivalItem: item };
    if (!current.length || current.at(-1).placeId !== placeId) current.push(node);
    else if (item) {
      const previous = current.at(-1);
      current[current.length - 1] = { ...previous, item, role, arrivalItem: previous.arrivalItem || item };
    }
  };
  push(day.accommodation?.startPlaceId, null, "start-accommodation");
  (day.items || []).forEach((item) => {
    if (item.breakGroundRoute && current.length) { runs.push(current); current = []; }
    push(item.placeId, item, item.type);
  });
  push(day.accommodation?.endPlaceId, null, "end-accommodation");
  if (current.length) runs.push(current);
  return runs.filter((run) => run.length);
}

function renderDayRoute(day, places) {
  const runs = dayRouteNodes(day).filter((run) => run.length > 1);
  if (!runs.length) return "";
  const renderNode = (node) => {
    const place = places.get(node.placeId);
    if (!place) return "";
    const label = place.localName && place.localName !== place.name ? place.name + " / " + place.localName : place.name;
    return '<span class="route-local-leg">' + copy(label) + "</span>";
  };
  const renderConnector = (node) => {
    const hasDuration = node.duration && node.duration !== "0 分钟";
    const hasTransport = Boolean(node.mode || hasDuration);
    const meta = hasTransport
      ? '<span class="route-segment-meta"><span class="route-transport-icon" aria-hidden="true">' + transportIcon(node.mode) + "</span>" + (hasDuration ? '<span class="route-duration">' + escapeHtml(node.duration) + "</span>" : "") + "</span>"
      : "";
    return '<span class="route-leg">' + meta + '<span class="route-arrow" aria-hidden="true">→</span></span>';
  };
  const output = runs.map((run) => run.map((node, index) => (index ? renderConnector(node) : "") + renderNode(node)).join("")).join('<span class="route-break" aria-label="地面路线断点">路线断点</span>');
  return '<div class="day-route-summary" data-day-route-summary>' + output + "</div>";
}

function navigationModes(mode) {
  // Each explicitly suggested mode gets its own point-to-point query. Never default to driving.
  const rules = [
    { mode: "driving", label: "驾车 / 打车", pattern: /出租车|打车|网约车|自驾|驾车|开车|包车|\b(?:car|drive|driving|taxi)\b/ig },
    { mode: "transit", label: "公交 / 地铁", pattern: /地铁|公交|巴士|大巴|机场快线|轨道|高铁|火车|列车|\b(?:AREX|bus|subway|metro|train|rail|transit)\b/ig },
    { mode: "walking", label: "步行", pattern: /步行|徒步|\b(?:walk|walking)\b/ig },
    { mode: "motorcycle", label: "摩托车", pattern: /摩托车|摩的|\b(?:motorcycle|motorbike)\b/ig },
    { mode: "tuktuk", label: "突突车", pattern: /突突车|嘟嘟车|\b(?:tuk[ -]?tuk)\b/ig },
    { mode: "ferry", label: "轮船 / 渡轮", pattern: /轮船|渡轮|水上巴士|\b(?:ferry|boat|water bus)\b/ig },
    { mode: "cablecar", label: "索道 / 缆车", pattern: /索道|空中缆车|观光缆车|\b(?:cable car|gondola lift|aerial tramway)\b/ig },
    { mode: "mountainrail", label: "登山铁路", pattern: /登山铁路|缆索铁路|齿轨铁路|登山缆车|\b(?:funicular|cog railway|rack railway)\b/ig },
    { mode: "tram", label: "有轨电车", pattern: /有轨电车|路面电车|\b(?:tram|streetcar)\b/ig },
    { mode: "monorail", label: "单轨", pattern: /单轨|跨座式轨道|\bmonorail\b/ig },
    { mode: "minibus", label: "地方小巴", pattern: /双条车|吉普尼|多尔穆什|马什鲁特卡|地方小巴|\b(?:songthaew|jeepney|dolmus|marshrutka|minibus)\b/ig },
    { mode: "rickshaw", label: "人力车", pattern: /人力车|三轮人力车|\b(?:rickshaw|pedicab)\b/ig },
    { mode: "bicycling", label: "骑行", pattern: /骑行|自行车|\b(?:bike|bicycle|bicycling)\b/ig }
  ];
  return rules.map((rule) => ({ ...rule, index: String(mode || "").search(rule.pattern) }))
    .filter((rule) => rule.index >= 0).sort((a, b) => a.index - b.index)
    .map(({ mode, label }) => ({ mode, label }));
}

const ROUTE_MODE_META = {
  driving: { label: "驾车", icon: "🚗", googleMode: "driving" },
  motorcycle: { label: "摩托车", icon: "🏍", googleMode: "" },
  tuktuk: { label: "突突车", icon: "🛺", googleMode: "" },
  walking: { label: "步行", icon: "🚶‍♀️", googleMode: "walking" },
  transit: { label: "公共交通", icon: "🚇", googleMode: "transit" },
  bus: { label: "公交", icon: "🚌", googleMode: "transit" },
  ferry: { label: "轮船", icon: "⛴️", googleMode: "" },
  cablecar: { label: "索道", icon: "🚠", googleMode: "" },
  mountainrail: { label: "登山铁路", icon: "🚞", googleMode: "" },
  tram: { label: "有轨电车", icon: "🚋", googleMode: "" },
  monorail: { label: "单轨", icon: "🚝", googleMode: "" },
  minibus: { label: "地方小巴", icon: "🚐", googleMode: "" },
  rickshaw: { label: "人力车", icon: "🛺", googleMode: "" },
  bicycling: { label: "骑行", icon: "🚲", googleMode: "bicycling" }
};

const routeClockMinutes = (value) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(value || "")
  ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
const routeNodeTime = (item, finalNode = false) => {
  if (!item) return "";
  if (finalNode && item.endTime) return item.endTime;
  if (item.startTime) return item.startTime;
  return "";
};
const compactMinutes = (minutes) => {
  if (!Number.isFinite(minutes)) return "";
  const hours = Math.floor(minutes / 60); const rest = minutes % 60;
  return hours ? `${hours}小时${rest ? `${rest}分` : ""}` : `${rest}分`;
};

function dayNavigationSegments(day, places) {
  const valid = (place) => place && place.navigationEnabled !== false
    && Number.isFinite(place.coordinates?.latitude) && Math.abs(place.coordinates.latitude) <= 90
    && Number.isFinite(place.coordinates?.longitude) && Math.abs(place.coordinates.longitude) <= 180;
  const coords = (place) => `${place.coordinates.latitude},${place.coordinates.longitude}`;
  return dayRouteNodes(day).flatMap((run, runIndex) => run.slice(1).map((node, index) => {
    const from = places.get(run[index].placeId); const to = places.get(node.placeId);
    const item = node.arrivalItem || node.item || (day.items || []).find(candidate => candidate.id === node.itemId);
    const originalModes = navigationModes(node.mode);
    const navigationMode = item?.navigationMode;
    const modes = navigationMode ? [{ mode: navigationMode }] : originalModes;
    // A query preference is not a change to the booked transport or a new travel-time estimate.
    const sameMode = originalModes.length === 1 && originalModes[0].mode === navigationMode;
    const duration = navigationMode && !sameMode ? "" : node.duration;
    const explicitOptions = Array.isArray(item?.navigationOptions) ? item.navigationOptions : [];
    // A slash-delimited transportMode records the itinerary fact, not a verified
    // comparison. Only navigationOptions may create multiple selectable durations.
    const knownDuration = Number.isInteger(item?.travelMinutes) && item.travelMinutes > 0 ? item.travelMinutes : null;
    const optionSeeds = explicitOptions.length ? explicitOptions : modes.length === 1 ? modes.map(({ mode }, modeIndex) => ({
      mode,
      durationMinutes: (!navigationMode || (originalModes.length === 1 && originalModes[0].mode === navigationMode)) ? knownDuration : null,
      recommended: modeIndex === 0
    })) : [];
    const options = valid(from) && valid(to) ? optionSeeds.map((option, optionIndex) => {
      const meta = ROUTE_MODE_META[option.mode];
      const query = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(coords(from))}&destination=${encodeURIComponent(coords(to))}`;
      const genericRouteModes = ["motorcycle", "tuktuk", "ferry", "cablecar", "mountainrail", "tram", "monorail", "minibus", "rickshaw"];
      const actionLabel = genericRouteModes.includes(option.mode) ? `查看${meta.label}路线` : `发起${meta.label}导航`;
      const routeLinkLabel = genericRouteModes.includes(option.mode) ? `${meta.label}路线` : `${meta.label}导航`;
      return { mode: option.mode, label: meta.label, icon: meta.icon, actionLabel, routeLinkLabel, durationMinutes: Number.isInteger(option.durationMinutes) ? option.durationMinutes : null,
        recommended: option.recommended === true || (!optionSeeds.some(candidate => candidate.recommended === true) && optionIndex === 0),
        url: query + (meta.googleMode ? `&travelmode=${meta.googleMode}` : "") };
    }) : [];
    const walking = options.some(({ mode }) => mode === "walking");
    const links = options.map(({ mode, routeLinkLabel, url }) => ({ mode, label: routeLinkLabel, url }));
    return { fromPlaceId: run[index].placeId, toPlaceId: node.placeId, from: from?.name || run[index].placeId,
      to: to?.name || node.placeId, fromPlace: from, toPlace: to, fromNode: run[index], toNode: node,
      transportMode: navigationMode ? ROUTE_MODE_META[navigationMode].label : node.mode, duration, durationMinutes: knownDuration, runIndex, walking, links, options,
      reason: !valid(from) || !valid(to) ? "地点坐标待核验，暂不生成导航。" : !optionSeeds.length ? "交通方式待核验或不支持独立地面查询。" : "" };
  }));
}

function renderDayNavigation(day, places, segments) {
  const hasCoordinates = (place) => place && Number.isFinite(place.coordinates?.latitude) && Math.abs(place.coordinates.latitude) <= 90
    && Number.isFinite(place.coordinates?.longitude) && Math.abs(place.coordinates.longitude) <= 180;
  const localDestinationUrl = (place) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${place.coordinates.latitude},${place.coordinates.longitude}`)}`;
  if (!segments.length) return "";
  const runs = [];
  segments.forEach((segment) => {
    if (!runs[segment.runIndex]) runs[segment.runIndex] = [segment.fromNode];
    runs[segment.runIndex].push(segment.toNode);
  });
  const connectedRuns = runs.filter(Boolean);
  const routeNodes = connectedRuns.flat();
  const knownMovement = segments.reduce((total, segment) => total + (Number.isInteger(segment.durationMinutes) ? segment.durationMinutes : 0), 0);
  const knownMovementText = knownMovement > 0 ? compactMinutes(knownMovement) : "暂无估算";
  const destination = segments.at(-1).to;
  // The execution card always uses the same three facts. Exact clock times stay on
  // the rail and in the detailed timeline; they must not switch this summary into
  // a second, competing presentation.
  const summary = `共 <b>${routeNodes.length} 个停靠点</b> · 已知移动 <b>${knownMovementText}</b> · 终点 <b>${escapeHtml(destination)}</b>`;
  let segmentIndex = 0;
  const rows = connectedRuns.map((run, runIndex) => run.map((node, index) => {
    const place = places.get(node.placeId); const item = node.item;
    const label = place?.name || node.placeId; const local = place?.localName && place.localName !== place.name ? place.localName : "";
    const mapUrl = place ? googleMapsSearchUrl(place) : "";
    const finalNode = index === run.length - 1 && runIndex === connectedRuns.length - 1;
    const nodeTimeValue = routeNodeTime(item, finalNode);
    const exactMinute = routeClockMinutes(nodeTimeValue);
    const timeLabel = nodeTimeValue || item?.timeText || "—";
    const currentSegment = index < run.length - 1 ? segments[segmentIndex++] : null;
    const stay = item?.stayMinutes > 0 ? `<span>停留 ${compactMinutes(item.stayMinutes)}</span>` : "";
    const endpoint = finalNode ? "<span>终点</span>" : "";
    const marker = index === 0 && runIndex === 0 ? "<mark>起点</mark>" : (endpoint ? "<mark>终点</mark>" : "");
    const needsLocalStart = index === 0 && runIndex === 0 && !day.accommodation?.startPlaceId;
    const localStart = needsLocalStart && hasCoordinates(place)
      ? `<a class="route-current-location-launch" href="${escapeHtml(localDestinationUrl(place))}" target="_blank" rel="noopener noreferrer" aria-label="到达后使用当前位置导航至${escapeHtml(label)}">到达后定位导航</a>`
      : needsLocalStart ? `<small class="route-current-location-hint">到达后请在地图中搜索此地点</small>` : "";
    let transfer = "";
    if (currentSegment) {
      const plannedDuration = Number.isInteger(currentSegment.durationMinutes)
        ? ` data-planned-duration="${currentSegment.durationMinutes}"` : "";
      const active = currentSegment.options.find(option => option.recommended) || currentSegment.options[0];
      if (active) {
        const interactive = currentSegment.options.length > 1;
        const chips = currentSegment.options.map((option) => {
          const selected = option === active; const text = `${option.icon} ${option.durationMinutes === null ? "时长待核验" : compactMinutes(option.durationMinutes)}`;
          const rec = option.recommended ? '<span class="route-timeline-rec" aria-hidden="true">荐</span>' : "";
          return interactive ? `<button type="button" class="route-timeline-mode${selected ? " is-active" : ""}${option.recommended ? " is-recommended" : ""}" data-route-mode-option data-navigation-mode="${option.mode}" data-mode-label="${escapeHtml(option.label)}" data-action-label="${escapeHtml(option.actionLabel)}"${option.durationMinutes === null ? "" : ` data-duration-minutes="${option.durationMinutes}"`} data-navigation-url="${escapeHtml(option.url)}" aria-pressed="${selected}" aria-label="选择${escapeHtml(option.label)}方案${option.durationMinutes === null ? "" : `，约 ${option.durationMinutes} 分钟`}">${text}${rec}</button>`
            : `<span class="route-timeline-mode is-active" data-navigation-mode="${option.mode}">${text}${rec}</span>`;
        }).join("");
        transfer = `<div class="route-timeline-transfer" data-navigation-segment${plannedDuration} data-from-place-id="${escapeHtml(currentSegment.fromPlaceId)}" data-to-place-id="${escapeHtml(currentSegment.toPlaceId)}" data-route-segment-index="${segmentIndex - 1}"${Number.isInteger(active.durationMinutes) ? ` data-default-duration="${active.durationMinutes}" data-selected-duration="${active.durationMinutes}"` : ""} data-selected-mode="${active.mode}">${chips}<a class="route-timeline-mode-launch" href="${escapeHtml(active.url)}" target="_blank" rel="noopener noreferrer" data-route-navigation-launch data-navigation-mode="${active.mode}" aria-label="${escapeHtml(active.actionLabel)}：在 Google Maps 中打开">${escapeHtml(active.actionLabel)}</a></div>`;
      } else transfer = `<div class="route-timeline-transfer" data-navigation-segment${plannedDuration}${Number.isInteger(currentSegment.durationMinutes) ? ` data-default-duration="${currentSegment.durationMinutes}" data-selected-duration="${currentSegment.durationMinutes}"` : ""}><span class="route-timeline-mode is-muted">➜ ${compactMinutes(currentSegment.durationMinutes)}</span><span class="route-timeline-mode-label">交通方式待核验</span><small>${escapeHtml(currentSegment.reason)}</small></div>`;
    }
    return `<li class="route-stop-row${finalNode ? " is-final" : ""}"><time class="route-stop-time"${exactMinute === null ? "" : ` data-initial-minutes="${exactMinute}" data-arrival-minutes="${routeClockMinutes(item?.startTime) ?? exactMinute}"`}>${escapeHtml(timeLabel)}</time><div class="route-stop-rail"><span>${index + 1}</span>${index < run.length - 1 ? "<i></i>" : ""}</div><div class="route-stop-body"><div class="route-stop-heading"><a class="route-place-link" href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}：在 Google Maps 中查看">${escapeHtml(label.replace(/（已确认）/g, ""))}</a>${local ? `<span>${escapeHtml(local)}</span>` : ""}<div class="route-stop-meta">${stay}${endpoint}${marker}</div></div>${localStart}${transfer}</div></li>`;
  }).join("")).join('<li class="route-timeline-break" aria-label="地面路线断点">路线断点</li>');
  return `<div class="route-timeline-summary" aria-live="polite">${summary}</div><div class="route-stop-timeline" data-day-route-summary><ol>${rows}</ol></div>`;
}

function calendarDescriptionSections(day, selectedItems, places, navigationSegments) {
  const accommodationPlace = places.get(day.accommodation?.endPlaceId) || places.get(day.accommodation?.startPlaceId);
  const routeNames = dayRouteNodes(day).map((run) => run.map((node) => places.get(node.placeId)?.name).filter(Boolean).join(" → "));
  const schedule = selectedItems.map((item) => `${displayTime(item)}｜${item.title}`);
  const sights = selectedItems.filter((item) => item.type === "place").map((item, index) => `${index + 1}. ${places.get(item.placeId)?.name || item.title}`);
  const transport = selectedItems.filter((item) => item.travelMinutes > 0).map((item) => `${item.transportMode}｜前往 ${item.title}｜${minutesText(item.travelMinutes)}`);
  (navigationSegments || []).filter(segment => segment.walking).forEach(segment => transport.push(`${segment.from} → ${segment.to}｜建议步行`));
  const links = [];
  (navigationSegments || []).forEach((segment) => segment.links.forEach((link) => links.push(`${segment.from} → ${segment.to}｜${link.label}查询`, link.url)));
  selectedItems.flatMap((item) => item.links || []).slice(0, 3).forEach((link) => links.push(link.label, link.url));
  const lodging = [day.accommodation?.label];
  if (accommodationPlace?.address) lodging.push(accommodationPlace.address, googleMapsSearchUrl(accommodationPlace));
  return [
    { icon: "📍", title: "路线", lines: routeNames.length ? [routeNames.join(" ｜路线断点｜ ")] : [] },
    { icon: "🗺", title: "行程", lines: schedule },
    { icon: "🏛", title: "景点", lines: sights },
    { icon: "🚇", title: "交通", lines: transport },
    { icon: "⚠️", title: "备注", lines: day.calendarNotes || [] },
    { icon: "🔗", title: "链接", lines: links },
    { icon: "🏨", title: "住宿", lines: lodging.filter(Boolean) }
  ].filter((section) => section.lines.length);
}

function renderHeroHub(data) {
  const hero = data.meta.hero || {};
  // Old data remains readable, but legacy prose cannot change the cover contract.
  const cover = hero.cover || {};
  const image = cover.src ? `<img class="hero-cover-image" src="${escapeHtml(cover.src)}" alt="${escapeHtml(cover.alt || '')}" fetchpriority="high">` : '';
  const facts = [
    ["日期", heroDateRange(data.meta.dates, data.meta.dateDisplay || "日期待定", { explicitList: data.meta.datePolicy === "explicit" })],
    ["目的地", data.meta.destination || "目的地待定"],
    ["天数", data.days?.length ? `${data.days.length} 天` : "天数待定"]
  ];
  const factsMarkup = `<dl class="hero-cover-facts" aria-label="旅程事实信息">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
  const theme = GUIDE_THEMES.find(([id]) => id === data.meta.theme) || GUIDE_THEMES.find(([id]) => id === "coast");
  const themeLauncher = `<button type="button" class="guide-theme-launcher" data-guide-theme-launcher aria-haspopup="dialog" aria-expanded="false" aria-controls="guide-theme-popover"><span data-guide-theme-current>${escapeHtml(theme[1])}</span><i class="guide-theme-ring" aria-hidden="true"></i></button>`;
  return `<header class="hero hero-hub hero-cover" data-guide-module="hero">${image}<div class="hero-cover-shade" aria-hidden="true"></div><div class="hero-cover-frame"><div class="hero-cover-header"><span>PERSONAL TRAVEL GUIDE</span>${themeLauncher}</div><div class="hero-cover-copy"><p class="hero-kicker">ITINERARY</p><h1>${escapeHtml(hero.title || data.meta.title)}</h1>${hero.subtitle || data.meta.subtitle ? `<p class="hero-subtitle">${escapeHtml(hero.subtitle || data.meta.subtitle)}</p>` : ''}</div><div class="hero-cover-footer">${factsMarkup}</div></div></header>`;
}

function renderThemePopover() {
  const descriptions = { rainforest: "自然与热带", coast: "海岛与滨海", terracotta: "古城与南欧", ink: "日本与都市", burgundy: "酒红与古典", midnight: "夜色与精品" };
  const options = GUIDE_THEMES.map(([id, label]) => `<button type="button" data-guide-theme="${id}" aria-pressed="false"><i aria-hidden="true"></i><span>${label}</span><small>${descriptions[id]}</small></button>`).join("");
  return `<div class="guide-theme-popover" id="guide-theme-popover" data-guide-theme-popover hidden><section class="guide-theme-dialog" role="dialog" aria-modal="false" aria-labelledby="guide-theme-title"><header><h2 id="guide-theme-title">选择手册配色</h2><button type="button" data-guide-theme-close aria-label="关闭配色选择">×</button></header><div class="guide-theme-picker" data-guide-theme-picker role="group" aria-label="选择攻略配色">${options}</div></section></div>`;
}

function renderArrival(data) {
  if (!data.features.arrivalDeparture) return "";
  const renderAirportKit = (index) => {
    const kit = (data.arrivalDeparture.airportKits || []).find(item => item.arrivalIndex === index);
    if (!kit?.cards?.length) return "";
    const kinds = [["sim", "电话卡"], ["exchange", "换汇"], ["transport", "前往下一站"]];
    const cards = kinds.map(([kind, title], number) => {
      const card = kit.cards.find(item => item.kind === kind);
      if (!card) return "";
      const ids = [...new Set(card.facts.flatMap(fact => fact.sourceIds))];
      const facts = card.facts.map(fact => `<div><dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}${fact.observedAt ? `<small>观察：${escapeHtml(fact.observedAt)}</small>` : ""}</dd></div>`).join("");
      return `<article class="airport-kit-card" data-airport-kit-kind="${kind}"><header><span class="airport-kit-number">0${number + 1}</span><h5>${title}</h5></header><p class="airport-kit-lead">${escapeHtml(card.lead)}</p><dl>${facts}</dl>${card.condition?.trim() ? `<p class="airport-kit-condition">${escapeHtml(card.condition)}</p>` : ""}${card.details?.trim() ? `<details><summary>使用细节</summary><p>${escapeHtml(card.details)}</p></details>` : ""}<footer><span>补充阅读</span>${sourceLinks(ids)}</footer></article>`;
    }).join("");
    return `<li class="airport-kit-host"><section class="airport-kit" aria-label="${escapeHtml(kit.airport)}落地三件套"><header class="airport-kit-heading"><h4>机场落地三件套</h4><p>${escapeHtml(kit.airport)} → ${escapeHtml(kit.nextStop)}</p></header><div class="airport-kit-grid">${cards}</div></section></li>`;
  };
  const renderSteps = (steps, arrival = false) => `<ol class="step-list">${list(steps, (step, index) => `<li class="card"><strong>${escapeHtml(step.when)}</strong><p>${escapeHtml(step.action)} ${sourceLinks(step.sourceIds)}</p>${step.reason?.trim() ? `<p><b>选择依据：</b>${escapeHtml(step.reason.trim())}</p>` : ""}${step.riskAlternative?.trim() ? `<p><b>异常时改走：</b>${escapeHtml(step.riskAlternative.trim())}</p>` : ""}</li>${arrival ? renderAirportKit(index) : ""}`)}</ol>`;
  const renderForms = (direction) => {
    const forms = (data.arrivalDeparture.forms || []).filter((form) => form.direction === direction);
    if (!forms.length) return "";
    const cards = forms.map((form) => `<article class="card arrival-form-guide"><h4>${escapeHtml(form.name)}</h4><p><b>适用：</b>${escapeHtml(form.appliesTo)}</p><p><b>填写／提交：</b>${escapeHtml(form.submission)}</p><dl>${form.fields.map((field) => `<div><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.guidance)}</dd></div>`).join("")}</dl><p class="arrival-form-source">${form.officialUrl ? `<a href="${escapeHtml(form.officialUrl)}" target="_blank" rel="noopener noreferrer">官方填写入口 ↗</a>` : ""}${sourceLinks(form.sourceIds)}</p></article>`).join("");
    return `<h4 class="arrival-form-heading">${direction === "arrival" ? "入境单据怎么填" : "离境单据怎么填"}</h4><div class="arrival-form-list">${cards}</div>`;
  };
  const renderApps = () => {
    const apps = data.arrivalDeparture.apps || [];
    if (!apps.length) return "";
    const rows = apps.map((app) => `<article class="arrival-app-card"><img src="${escapeHtml(app.logoSrc)}" alt="" loading="lazy"><div class="arrival-app-heading"><button type="button" class="arrival-app-copy" data-copy="${escapeHtml(app.name)}" aria-label="复制 APP 名称：${escapeHtml(app.name)}">${escapeHtml(app.name)}</button><span class="arrival-app-region">${escapeHtml(app.region)}</span></div><div class="arrival-app-content"><p class="arrival-app-purpose">${escapeHtml(app.purpose)}</p>${app.notice?.trim() ? `<small>${escapeHtml(app.notice.trim())}</small>` : ""}</div></article>`).join("");
    return `<section class="arrival-apps" aria-label="当地常用 APP"><h3>当地常用 APP</h3><div class="arrival-app-list">${rows}</div></section>`;
  };
  const flights = Array.isArray(data.arrivalDeparture.flights) ? data.arrivalDeparture.flights : [];
  const flightRecords = renderFlightRecords(flights);
  const experiences = (data.arrivalDeparture.experiences || []).map((item) => `<li class="arrival-experience"><strong>${escapeHtml(item.airport)}${item.terminal ? ` · ${escapeHtml(item.terminal)}` : ""}</strong><span>${escapeHtml(item.observedAt)}${item.arrivalWindow ? ` · ${escapeHtml(item.arrivalWindow)}` : ""}${item.visaType ? ` · ${escapeHtml(item.visaType)}` : ""}</span><p>${item.queueMinutes !== undefined ? `入境排队 ${item.queueMinutes} 分钟` : ""}${item.landingToExitMinutes !== undefined ? `${item.queueMinutes !== undefined ? "；" : ""}落地至出机场 ${item.landingToExitMinutes} 分钟` : ""}${item.detail ? `；${escapeHtml(item.detail)}` : ""} ${sourceLinks(item.sourceIds)}</p></li>`).join("");
  return `<section class="guide-section" data-guide-module="arrival" id="arrival" data-nav-label="到达/离开"><h2>${escapeHtml(moduleTitle("arrival"))}</h2>${flightRecords}<h3>到达</h3>${renderSteps(data.arrivalDeparture.arrival, true)}${renderForms("arrival")}<h3>离开</h3>${renderSteps(data.arrivalDeparture.departure)}${renderForms("departure")}${renderApps()}${experiences ? `<h3>相近条件的亲历记录</h3><ul class="arrival-experiences">${experiences}</ul>` : ""}</section>`;
}

function renderRoute(data, routeCss, baiduLoader, googleLoader, mapConfig) {
  const places = placeMapOf(data);
  const stops = data.route.stopIds.map((id) => places.get(id));
  const stopNames = stops.map((stop, index) => {
    const fullName = stop.localName && stop.localName !== stop.name ? `${stop.name} / ${stop.localName}` : stop.name;
    return `<li><button type="button" class="route-summary-stop copy-target" data-copy="${escapeHtml(fullName)}" title="${escapeHtml(fullName)}" aria-label="复制地点：${escapeHtml(stop.name)}"><span class="route-summary-index">${index + 1}</span><span>${escapeHtml(stop.name)}</span></button></li>`;
  }).join("");
  const summary = `<div class="route-summary"><div class="route-summary-head"><strong>全程 ${stops.length} 站</strong><span>点击地点可复制完整名称</span></div><ol class="route-summary-list">${stopNames}</ol></div>`;
  const routeOverview = `<section class="guide-section" data-guide-module="route-map" id="route-map-section" data-nav-label="路线总览"><h2>${escapeHtml(moduleTitle("route-map"))}</h2>${summary}</section>`;
  const explorationSegments = data.features.contextualExplore ? (data.explorationSegments || []) : [];
  const nearbyDays = data.features.nearbyExplore ? (data.nearbyDays || []) : [];
  const visibleNearbyDays = nearbyDays.filter(visibleNearbyDay);
  const roadByDay = new Map((data.dayRoadRoutes || []).map(item => [item.dayNumber, item.legs]));
  const recommendationById = new Map((data.recommendations || []).map((item) => [item.id, item]));
  const venueById = new Map((data.venueSuggestions || []).map((item) => [item.id, item]));
  const segmentViews = explorationSegments.map((segment) => ({
    key: `segment-${segment.id}`, kind: "exploration", dayNumber: segment.dayNumber,
    fromPlaceId: segment.fromPlaceId, toPlaceId: segment.toPlaceId,
    runs: [[{ placeId: segment.fromPlaceId }, { placeId: segment.toPlaceId }]],
    candidates: segment.candidates.map((candidate) => {
      const target = candidate.targetType === "recommendation" ? recommendationById.get(candidate.targetId) : venueById.get(candidate.targetId);
      return { ...candidate, placeId: target?.placeId || "" };
    })
  }));
  const mapData = {
    places: data.places.filter(place => place.coordinates),
    overview: null,
    days: data.days.map((day) => ({ key: `day-${day.dayNumber}`, dayNumber: day.dayNumber, date: day.date, label: day.date ? `D${day.dayNumber} · ${day.date.slice(5)}` : `Day ${day.dayNumber}`, runs: dayRouteNodes(day).map((run) => run.map(({ placeId, itemId, mode, duration, role }) => ({ placeId, itemId, mode, duration, role }))), roadLegs: roadByDay.get(day.dayNumber) || [], candidates: (visibleNearbyDays.find(item => item.dayNumber === day.dayNumber)?.candidates || []).map(candidate => { const target = candidate.targetType === "recommendation" ? recommendationById.get(candidate.targetId) : venueById.get(candidate.targetId); return {placeId: target?.placeId || "", name: target?.name || ""}; }) })),
    explorations: segmentViews
  };
  const segmentControls = explorationSegments.length ? `<div class="context-segment-controls" role="group" aria-label="探索某段行程">${explorationSegments.map((segment) => `<button type="button" data-map-view="segment-${escapeHtml(segment.id)}" aria-pressed="false">D${segment.dayNumber} · ${escapeHtml(places.get(segment.fromPlaceId)?.name || "起点")} → ${escapeHtml(places.get(segment.toPlaceId)?.name || "终点")}</button>`).join("")}</div>` : "";
  const candidatePanels = explorationSegments.map((segment) => `<div class="context-candidate-panel" data-candidate-panel="segment-${escapeHtml(segment.id)}" hidden><div class="context-candidate-list">${segment.candidates.map((candidate) => {
    const target = candidate.targetType === "recommendation" ? recommendationById.get(candidate.targetId) : venueById.get(candidate.targetId);
    const place = places.get(target?.placeId);
    if (!target || !place) return "";
    const source = data.sources.find((item) => item.id === target.image?.sourceId);
    const anchor = candidate.targetType === "recommendation" ? `recommendation-${target.id}` : `booking-venue-${target.id}`;
    const relation = { near_start: "起点附近", near_end: "终点附近", near_route: "途中候选", detour: "需要绕路" }[candidate.relation];
    const xhsAttrs = xiaohongshuNoteAttrs(source, place.name);
    return `<article class="context-candidate" data-candidate-place="${escapeHtml(place.id)}" data-lat="${place.coordinates.latitude}" data-lng="${place.coordinates.longitude}">${target.image ? `<img src="${escapeHtml(target.image.src)}" alt="${escapeHtml(target.image.alt)}" loading="lazy">` : ""}<div><b>${escapeHtml(place.name)}</b><small>${escapeHtml(relation)}</small><p>${escapeHtml(target.reason)}</p><a href="#${escapeHtml(anchor)}">查看详情</a>${source?.url ? `<a href="${escapeHtml(source.url)}"${xhsAttrs} target="_blank" rel="noopener noreferrer">原帖 · ${escapeHtml(source.author || source.title)}</a>` : ""}</div></article>`;
  }).join("")}</div></div>`).join("");
  const nearbyPolicies = nearbyDays.map(entry => ({ dayNumber: entry.dayNumber, status: entry.status || "legacy", dayType: entry.dayType || "", reason: entry.reason || "", candidateCount: entry.candidates.length }));
  const nearbyRouteRank = { along_route: 0, same_area: 1, detour: 3 };
  const nearbyRouteLabel = { along_route: "顺路", same_area: "同片区", detour: "需专程" };
  const orderedNearbyCandidates = (candidates) => [...candidates].sort((a, b) =>
    (nearbyRouteRank[a.routeFit] ?? 2) - (nearbyRouteRank[b.routeFit] ?? 2));
  const nearbyPanels = visibleNearbyDays.map(entry => `<div class="nearby-day-panel" data-nearby-panel="day-${entry.dayNumber}" hidden><div class="nearby-day-list">${orderedNearbyCandidates(entry.candidates).map(candidate => {
    const target = candidate.targetType === "recommendation" ? recommendationById.get(candidate.targetId) : venueById.get(candidate.targetId);
    const place = places.get(target?.placeId);
    const source = data.sources.find(item => item.id === target?.image?.sourceId);
    const xhsAttrs = xiaohongshuNoteAttrs(source, place?.name || "");
    if (!target || !place) return "";
    const anchor = candidate.targetType === "recommendation" ? `recommendation-${target.id}` : `booking-venue-${target.id}`;
    const window = entry.freeWindows?.[candidate.windowIndex];
    const timing = window ? `${window.startTime}–${window.endTime} · ${candidate.timing}` : candidate.timing;
    const location = [nearbyRouteLabel[candidate.routeFit], candidate.area].filter(Boolean).join(" · ");
    const shopPick = candidate.shopPick ? `<p><b>进店看</b> ${escapeHtml(candidate.shopPick)}</p>` : "";
    return `<article class="nearby-day-card" data-nearby-card="${escapeHtml(place.id)}"><button type="button" class="nearby-day-photo" data-preview-image="${escapeHtml(target.image.src)}" aria-label="放大查看：${escapeHtml(place.name)}"><img src="${escapeHtml(target.image.src)}" alt="${escapeHtml(target.image.alt)}" loading="lazy"></button><div><strong>${escapeHtml(place.name)}</strong>${location ? `<small>${escapeHtml(location)}</small>` : ""}${shopPick}${timing ? `<small>${escapeHtml(timing)}</small>` : ""}<p>${escapeHtml(candidate.whyNow)}</p><div class="nearby-day-actions"><button type="button" data-focus-nearby="${escapeHtml(place.id)}" data-day-number="${entry.dayNumber}">在地图上看</button><a href="${escapeHtml(googleMapsSearchUrl(place))}" target="_blank" rel="noopener noreferrer">导航 ↗</a><a href="#${escapeHtml(anchor)}">查看详情</a>${source?.url ? `<a href="${escapeHtml(source.url)}"${xhsAttrs} target="_blank" rel="noopener noreferrer">原帖 · ${escapeHtml(source.author || source.title)}</a>` : ""}</div></div></article>`;
  }).join("")}</div></div>`).join("");
  const isMainlandChina = (place) => place?.country === "中国" && !/(香港|澳门|台湾)/.test(`${place.city || ""} ${place.name || ""}`);
  const mapProvider = stops.length && stops.every(isMainlandChina) ? "baidu" : "google";
  const baiduConfig = mapProvider === "baidu" ? (mapConfig?.baidu || { enabled: false, ak: "" }) : { enabled: false, ak: "" };
  const googleConfig = mapProvider === "google" ? (mapConfig?.google || { enabled: false, key: "" }) : { enabled: false, key: "" };
  const baiduApiScript = mapProvider === "baidu" && baiduConfig.enabled ? `<script src="https://api.map.baidu.com/api?v=1.0&type=webgl&ak=${encodeURIComponent(baiduConfig.ak)}"><\/script>` : "";
  const googleApiScript = mapProvider === "google" && googleConfig.enabled ? `<script>window.gm_authFailure=function(){window.__guideGoogleAuthFailure=true};<\/script><script async src="https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleConfig.key)}&v=weekly&loading=async"><\/script>` : "";
  const nearbySwitch = visibleNearbyDays.length ? `<label class="nearby-day-switch" hidden><span>附近逛逛</span><input type="checkbox" data-nearby-switch aria-controls="nearby-day-panels"><span class="nearby-day-switch-track" aria-hidden="true"></span></label>` : "";
  const nearbyState = nearbyDays.length ? `<p data-nearby-status aria-live="polite" hidden></p><script type="application/json" data-nearby-policy>${safeJson(nearbyPolicies)}</script>` : "";
  const mapSection = `<section class="itinerary-explore" id="itinerary-explore" aria-label="当天地图与附近逛逛"><div class="itinerary-explore-head"><h3>当天地图</h3><button type="button" data-use-current-location>使用当前位置</button></div><p data-context-location-status aria-live="polite"></p>${segmentControls}<div class="nearby-day-bar">${nearbySwitch}<span class="nearby-day-legend"><i aria-hidden="true"></i>原计划 <i class="is-nearby" aria-hidden="true"></i>附近逛逛</span></div>${nearbyState}<div class="route-map-wrap"><div id="route-map-loading" class="route-map-loading is-visible"></div><div id="route-map-status" class="route-map-status">正在加载动态地图</div><div id="route-map-actions" class="route-map-actions" hidden><button type="button" data-retry-map>重试地图</button></div><div id="route-map" class="route-map" aria-label="逐日行程探索地图"></div></div><div id="nearby-day-panels">${nearbyPanels}</div>${candidatePanels}<style>${routeCss}</style>${baiduApiScript}${googleApiScript}<script>${baiduLoader}</script><script>${googleLoader}</script><script>
(function(){
  const data=${safeJson(mapData)};
  const mapProvider=${safeJson(mapProvider)};
  const baiduConfig=${safeJson(baiduConfig)};
  const googleConfig=${safeJson(googleConfig)};
  const status=document.getElementById("route-map-status");
  const overlay=document.getElementById("route-map-loading");
  const actions=document.getElementById("route-map-actions");
  const root=document.getElementById("route-map");
  const locationButton=document.querySelector("[data-use-current-location]");
  const locationStatus=document.querySelector("[data-context-location-status]");
  const nearbySwitch=document.querySelector("[data-nearby-switch]");
  const nearbyPolicies=${safeJson(nearbyPolicies)};
  const nearbyStates=new Map();
  let activeView='day-'+(document.querySelector('[data-day-tab][aria-selected="true"]')?.dataset.dayTab||data.days[0]?.dayNumber||1);
  const syncNearbyPanels=()=>{
    const key=activeView;
    const panels=[...document.querySelectorAll("[data-nearby-panel]")];
    const available=panels.some(panel=>panel.dataset.nearbyPanel===key);
    const visible=available&&nearbyStates.get(key)===true;
    if(nearbySwitch){nearbySwitch.closest("label").hidden=!available;nearbySwitch.disabled=!available;nearbySwitch.checked=visible;}
    panels.forEach(panel=>panel.hidden=!visible||panel.dataset.nearbyPanel!==key);
    const policy=nearbyPolicies.find(entry=>'day-'+entry.dayNumber===key);
    const note=document.querySelector("[data-nearby-status]");
    if(note){note.textContent=!available&&policy?.reason?policy.reason:"";note.hidden=!note.textContent;}
    document.dispatchEvent(new CustomEvent("guide:nearby-toggle",{detail:{visible,key}}));
  };
  nearbySwitch?.addEventListener("change",()=>{nearbyStates.set(activeView,nearbySwitch.checked);syncNearbyPanels();});
  syncNearbyPanels();
  document.querySelectorAll("[data-focus-nearby]").forEach(button=>button.addEventListener("click",()=>{activeView='day-'+button.dataset.dayNumber;nearbyStates.set(activeView,true);syncNearbyPanels();document.dispatchEvent(new CustomEvent("guide:focus-nearby",{detail:{placeId:button.dataset.focusNearby,dayNumber:Number(button.dataset.dayNumber)}}));root.scrollIntoView?.({block:"center",behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches?"auto":"smooth"});}));
  document.querySelectorAll(".nearby-day-photo img").forEach(image=>{
    const fallback=()=>{image.hidden=true;const button=image.closest("button");button.disabled=true;button.removeAttribute("data-preview-image");button.setAttribute("aria-label","图片暂不可用，请查看原帖");if(!button.querySelector("span")){const text=document.createElement("span");text.textContent="图片暂不可用";button.append(text);}};
    image.addEventListener("error",fallback,{once:true});if(image.complete&&!image.naturalWidth)fallback();
  });
  document.addEventListener("guide:map-view-change",event=>{activeView=event.detail?.key||activeView;syncNearbyPanels()});
  document.addEventListener("guide:day-change",event=>{activeView='day-'+event.detail?.dayNumber;document.querySelectorAll('[data-map-view]').forEach(button=>button.setAttribute('aria-pressed','false'));document.querySelectorAll('[data-candidate-panel]').forEach(panel=>panel.hidden=true);syncNearbyPanels()});
  document.querySelectorAll("[data-map-view]").forEach(button=>button.addEventListener("click",()=>{
    activeView=button.dataset.mapView;
    document.querySelectorAll("[data-map-view]").forEach(other=>other.setAttribute("aria-pressed",String(other===button)));
    document.querySelectorAll("[data-candidate-panel]").forEach(panel=>{panel.hidden=panel.dataset.candidatePanel!==button.dataset.mapView});
    syncNearbyPanels();
  }));
  locationButton?.addEventListener("click",()=>{
    if(!navigator.geolocation){ locationStatus.textContent="当前浏览器不支持定位；仍可按日期和路段选择。";return; }
    locationButton.disabled=true;
    locationStatus.textContent="正在获取当前位置…";
    navigator.geolocation.getCurrentPosition(({coords})=>{
      locationButton.disabled=false;
      locationStatus.textContent="已定位；候选地点按距当前位置的大致直线距离排序。";
      document.dispatchEvent(new CustomEvent("guide:current-location",{detail:{latitude:coords.latitude,longitude:coords.longitude}}));
      const placeById=new Map(data.places.map(place=>[place.id,place]));
      const distance=(card)=>{const place=placeById.get(card.dataset.nearbyCard);const lat=Number(place?.coordinates?.latitude??card.dataset.lat),lng=Number(place?.coordinates?.longitude??card.dataset.lng);return Number.isFinite(lat)&&Number.isFinite(lng)?Math.hypot((lat-coords.latitude)*111,(lng-coords.longitude)*111*Math.cos(coords.latitude*Math.PI/180)):Infinity};
      document.querySelectorAll("[data-candidate-panel] .context-candidate-list").forEach(list=>[...list.children].sort((a,b)=>distance(a)-distance(b)).forEach(card=>list.append(card)));
      document.querySelectorAll(".nearby-day-list").forEach(list=>[...list.children].sort((a,b)=>distance(a)-distance(b)).forEach(card=>list.append(card)));
      const segmentDistance=segment=>Math.min(...[segment.fromPlaceId,segment.toPlaceId].map(id=>{const place=placeById.get(id);return place?Math.hypot((place.coordinates.latitude-coords.latitude)*111,(place.coordinates.longitude-coords.longitude)*111*Math.cos(coords.latitude*Math.PI/180)):Infinity}));
      const nearest=[...(data.explorations||[])].sort((a,b)=>segmentDistance(a)-segmentDistance(b))[0];
      if(nearest) document.querySelector('[data-map-view="'+nearest.key+'"]')?.click();
    },()=>{locationButton.disabled=false;locationStatus.textContent="未取得位置；可继续按日期或 A→B 路段选择。";},{enableHighAccuracy:false,timeout:10000,maximumAge:60000});
  });
  const mapState={overlay:overlay,statusElement:status};
const baiduFailureText=(error)=>{
    const code=String(error&&error.message||"");
    if(code.includes("missing-ak")) return "未检测到百度 Browser AK，请检查本机私有配置。";
    if(code.includes("api-load")||code.includes("api-timeout")||code.includes("api-unavailable")) return "百度 JSAPI 未能加载：请检查网络、AK 状态与 Referer 白名单。";
    if(code.includes("tiles-timeout")) return "百度底图未在规定时间内响应：请检查网络或百度控制台的服务状态。";
    return "百度地图初始化异常：请检查 AK、Referer 白名单、网络与浏览器控制台。";
  };
  const startBaidu=async(attempt=1)=>{
    actions.hidden=true; root.replaceChildren(); overlay.classList.add("is-visible"); overlay.classList.remove("is-final-fallback"); status.textContent="正在加载百度地图（第 "+attempt+"/2 次）";
    try { await TravelBaiduRouteMap.start({ak:baiduConfig.ak,data:data,root:root,status:status,overlay:overlay,timeoutMs:9000,tileTimeoutMs:10000}); return; }
    catch(error){
      if(attempt<2){ status.textContent="百度地图首次加载受阻，正在进行一次诊断性重试"; return startBaidu(2); }
      root.replaceChildren(); overlay.classList.add("is-visible","is-final-fallback"); status.textContent=baiduFailureText(error); actions.hidden=false;
    }
  };
  const startGoogle=async()=>{
    actions.hidden=true; root.replaceChildren(); overlay.classList.add("is-visible"); overlay.classList.remove("is-final-fallback"); status.textContent="正在加载 Google 地图";
    try { await TravelGoogleRouteMap.start({data:data,root:root,status:status,overlay:overlay,timeoutMs:12000,tileTimeoutMs:10000}); }
    catch(error) { root.replaceChildren(); overlay.classList.add("is-visible","is-final-fallback"); status.textContent=window.__guideGoogleAuthFailure?"Google 地图授权失败：请检查 Browser Key 的网站来源白名单与 API 权限。":String(error&&error.message||"").includes("tiles-timeout")?"Google 底图未在规定时间内响应：请检查网络或地图服务状态。":"Google 地图未能加载：请检查 Maps JavaScript API、结算、网站白名单与网络。"; actions.hidden=false; }
  };
  actions.querySelector("[data-retry-map]").addEventListener("click",()=>mapProvider==="google"?startGoogle():startBaidu(1));
  const start=async function(){
    if(mapProvider==="google") {
      if(googleConfig.enabled&&googleConfig.key&&window.TravelGoogleRouteMap) return startGoogle();
      overlay.classList.add("is-final-fallback"); status.textContent="地图暂未配置，可使用各地点的导航链接。"; return;
    }
    if(baiduConfig.enabled&&baiduConfig.ak&&window.TravelBaiduRouteMap) return startBaidu(1);
    overlay.classList.add("is-final-fallback"); status.textContent="地图暂未配置，可使用各地点的导航链接。";
  };
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",start,{once:true}); else start();
})();
</script></section>`;
  return { routeOverview, mapSection };
}

function renderTravelDay(day, places, recommendations, sources, segments, hasMap, photographedPlaces) {
  const mapPlaces = new Set(dayRouteNodes(day).flat().map(node => node.placeId).filter(id => places.get(id)?.coordinates));
  const itemPlaces = new Set(day.items.map(item => item.placeId));
  const arrivals = new Map(segments.map(segment => [segment.toNode.arrivalItem?.id || segment.toNode.itemId, segment]));
  const occurrences = new Map();
  for (const item of day.items) if (item.placeId) occurrences.set(item.placeId, (occurrences.get(item.placeId) || 0) + 1);
  const directory = day.items.map((item, index) => {
    const action = occurrences.get(item.placeId) > 1 ? item.activity : "";
    const time = item.startTime || displayTime(item);
    return `<button type="button" data-travel-jump="${escapeHtml(item.id)}"><span>${index + 1}</span><small>${escapeHtml(time)}</small><b>${escapeHtml(item.title)}</b>${action ? `<em>${escapeHtml(action)}</em>` : ""}</button>`;
  }).join("");
  const cards = day.items.map(item => {
    const place = places.get(item.placeId);
    const recommendation = recommendations.get(item.placeId);
    const photos = photographedPlaces.has(item.placeId) ? []
      : item.photos?.length ? item.photos : recommendation?.image ? [recommendation.image] : [];
    if (item.placeId && photos.length) photographedPlaces.add(item.placeId);
    const photoSources = photos.map(photo => {
      const source = sources.find(entry => entry.id === photo.sourceId);
      if (!/^https?:\/\//i.test(source?.url || "")) return "";
      const label = source.type === "xiaohongshu" ? "小红书 ↗" : "图片出处 ↗";
      const credit = [photo.credit || source.author || source.title, photo.license || source.license].filter(Boolean).join(" · ");
      return `<a href="${escapeHtml(source.url)}"${xiaohongshuNoteAttrs(source, item.title)} target="_blank" rel="noopener noreferrer">${label}<small> ${escapeHtml(credit)}</small></a>`;
    });
    const slides = photos.map((photo, index) => `<figure class="sourced-recommendation-image"><button type="button" data-preview-image="${escapeHtml(photo.src)}" aria-label="放大查看：${escapeHtml(photo.alt)}"><img src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.alt)}" loading="lazy"></button><template data-travel-photo-credit>${photoSources[index]}</template></figure>`).join("");
    const controls = photos.length > 1 ? `<div class="travel-photo-controls"><button type="button" data-travel-photo-step="-1" disabled>上一张</button><span data-travel-photo-count aria-live="polite">1 / ${photos.length}</span><button type="button" data-travel-photo-step="1">下一张</button></div>` : "";
    const gallery = photos.length ? `<div data-travel-gallery aria-label="地点照片"><div class="travel-photo-track" data-travel-photo-track${controls ? ' tabindex="0" aria-label="滑动查看地点照片"' : ""}>${slides}</div>${controls}</div>` : "";
    const products = recommendation?.productPicks || [];
    const menu = recommendation?.menuItems || [];
    const isDetail = line => line && line.trim() !== item.activity?.trim() && !/^交通查询[：:]/.test(line.trim()) && !isNonActionableSupplement(line);
    const steps = (item.details || []).filter(isDetail);
    const notes = (item.notes || []).filter(isDetail);
    const description = recommendation?.reason === item.activity ? "" : recommendation?.reason;
    const detail = [...new Set([description, ...steps].filter(isDetail))];
    const picks = products.map(pick => `<li><strong>${escapeHtml(pick.name)}</strong> · ${escapeHtml(pick.reason)}${pick.where ? ` · ${escapeHtml(pick.where)}` : ""}${pick.priceObserved ? ` · ${escapeHtml(pick.priceObserved)}` : ""}${renderSourcedImage(pick.image, sources)} ${sourceLinks(pick.sourceIds)}</li>`).join("");
    const dishes = menu.map(dish => `<li><strong>${escapeHtml(dish.name)}</strong> · ${escapeHtml(dish.reason)}${dish.priceObserved ? ` · ${escapeHtml(dish.priceObserved)}` : ""} ${sourceLinks(dish.sourceIds)}</li>`).join("");
    const detailId = `travel-details-${escapeHtml(item.id)}`;
    const details = detail.length || picks || dishes || item.referenceImages?.length || notes.length
      ? `<div class="travel-stop-details" id="${detailId}" hidden>${detail.length ? renderInformation(detail) : ""}${picks ? `<ul>${picks}</ul>` : ""}${dishes ? `<ul>${dishes}</ul>` : ""}${renderItemReferenceImages(item.referenceImages)}${renderItemNotes(notes)}</div>` : "";
    const detailLabel = picks ? "购物清单" : item.type === "transport" || /机场|航站楼|airport/i.test(item.title) ? "操作步骤" : "详细介绍";
    const actions = [
      details ? `<button type="button" data-travel-detail-toggle aria-expanded="false" aria-controls="${detailId}">${detailLabel}</button>` : "",
      place?.navigationEnabled !== false && place?.coordinates ? `<a href="https://www.google.com/maps/dir/?api=1&amp;destination=${encodeURIComponent(`${place.coordinates.latitude},${place.coordinates.longitude}`)}" target="_blank" rel="noopener noreferrer">导航 ↗</a>` : "",
      hasMap && mapPlaces.has(item.placeId) ? `<button type="button" data-travel-map-place="${escapeHtml(item.placeId)}">地图定位</button>` : "",
      recommendation?.officialUrl && !(item.links || []).some(link => link.url === recommendation.officialUrl) ? `<a href="${escapeHtml(recommendation.officialUrl)}" target="_blank" rel="noopener noreferrer">官网 ↗</a>` : "",
      renderItemLinks(item.links),
      sourceLinks(item.sourceIds),
      photos.length ? `<span data-travel-photo-source${photoSources[0] ? "" : " hidden"}>${photoSources[0]}</span>` : ""
    ].filter(Boolean).join("");
    const segment = arrivals.get(item.id);
    const verified = (segment?.options || []).filter(option => Number.isFinite(option.durationMinutes));
    const transfer = verified.length ? `<div class="travel-transfer" aria-label="前往${escapeHtml(item.title)}">${verified.map(option => `<a class="travel-transfer-option${option.recommended ? " is-recommended" : ""}" href="${escapeHtml(option.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(option.actionLabel)}，${minutesText(option.durationMinutes)}${option.recommended ? "，推荐" : ""}">${ROUTE_MODE_META[option.mode].icon} ${ROUTE_MODE_META[option.mode].label} ${minutesText(option.durationMinutes)}${option.recommended ? " · 荐" : ""}</a>`).join("")}</div>` : "";
    return `${transfer}<article class="travel-stop" data-travel-item="${escapeHtml(item.id)}" data-travel-place="${escapeHtml(item.placeId || "")}" tabindex="-1"><header><small>${escapeHtml(displayTime(item))}</small><h4>${escapeHtml(item.title)}</h4></header>${gallery}<div class="travel-stop-copy">${item.activity ? `<p>${escapeHtml(item.activity)}</p>` : ""}${actions ? `<div class="travel-stop-actions">${actions}</div>` : ""}${details}</div></article>`;
  }).join("");
  const fallback = [...mapPlaces].map(id => itemPlaces.has(id)
    ? `<button type="button" data-travel-fallback-place="${escapeHtml(id)}">${escapeHtml(places.get(id).name)}</button>`
    : `<span>${escapeHtml(places.get(id).name)}</span>`).join("");
  return `<section data-travel-day hidden>${fallback ? `<nav class="travel-map-fallback" aria-label="停靠点定位">${fallback}</nav>` : ""}<div class="travel-day-layout"><nav class="travel-stop-directory" aria-label="当天地点">${directory}</nav><div class="travel-stop-list">${cards}</div></div></section>`;
}

function renderDays(data, collaborationEnabled = false, mapSection = "") {
  const places = placeMapOf(data);
  const venueSuggestionsById = new Map((data.venueSuggestions || []).map((item) => [item.id, item]));
  const recommendationsById = new Map((data.recommendations || []).filter((item) => item.id).map((item) => [item.id, item]));
  const placementsByAnchor = new Map((data.recommendationPlacements || []).map((item) => [item.anchorItemId, item]));
  const placementLabels = { en_route: "路上可买", lunch: "午餐附近", coffee: "景点附近咖啡", experience: "可增加体验", flexible: "当天备用" };
  const routeLabels = { on_route: "真正顺路", nearby: "附近", minor_detour: "短绕路", detour: "需要绕路" };
  const renderPlacement = (placement) => {
    if (!placement) return "";
    const entries = placement.entries.map((entry) => {
      const target = entry.targetType === "venueSuggestion" ? venueSuggestionsById.get(entry.targetId) : recommendationsById.get(entry.targetId);
      if (!target) return "";
      const place = target.placeId ? places.get(target.placeId) : null;
      const name = place ? copy(place.localName && place.localName !== place.name ? `${place.name} / ${place.localName}` : place.name) : copy(target.name);
      const kind = entry.targetType === "venueSuggestion" ? ({ cafe: "咖啡", restaurant: "餐饮", shop: "购物" }[target.kind] || "推荐") : target.category;
      const detail = entry.note || target.reason;
      const detailLink = entry.targetType === "venueSuggestion" ? `<a class="day-recommendation-detail-link" href="#booking-venue-${escapeHtml(target.id)}">查看候选详情</a>` : "";
      return `<li><span class="day-recommendation-route is-${escapeHtml(entry.routeRelation)}">${escapeHtml(routeLabels[entry.routeRelation])}</span><div><h5>${name} ${sourceLinks(target.sourceIds)}</h5><p>${escapeHtml(kind)}｜${escapeHtml(detail)}</p>${detailLink}</div></li>`;
    }).filter(Boolean).join("");
    return entries ? `<aside class="day-recommendation-placement" data-recommendation-placement="${escapeHtml(placement.id)}"><h4>${escapeHtml(placementLabels[placement.slot])}</h4><ul>${entries}</ul></aside>` : "";
  };
  const travelRecommendations = new Map([...(data.venueSuggestions || []), ...(data.recommendations || [])].filter(item => item.placeId).map(item => [item.placeId, item]));
  const photographedPlaces = new Set();
  const renderedAddressPlaceIds = new Set();
  const calendarMode = data.calendar?.mode === "timed" ? "timed" : "daily";
  const calendarEvents = [];
  const tabs = data.days.map((day, index) => {
    const weekday = day.date ? ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${day.date}T00:00:00Z`).getUTCDay()] : "";
    const label = day.date ? `${day.date.slice(5).replace("-", "/")} ${weekday}` : `D${day.dayNumber}`;
    return `<button type="button" role="tab" id="day-tab-${day.dayNumber}" data-day-tab="${day.dayNumber}" aria-controls="day-${day.dayNumber}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${escapeHtml(label)}</button>`;
  }).join("");
  const cards = data.days.map((day, dayIndex) => {
    const weatherPlaceId = dayWeatherPlaceId(day, data);
    const dateAttr = (day.date ? ` data-itinerary-date="${escapeHtml(day.date)}"` : "") + ` data-city="${escapeHtml(day.city)}" data-weather-place-id="${escapeHtml(weatherPlaceId)}"`;
    const visibleDate = day.date ? `<time datetime="${escapeHtml(day.date)}">${escapeHtml(day.date)}</time>` : "日期待定";

    const intensityScore = Number(day.intensity.score).toFixed(1);
    const slots = day.items.map((item) => {
      const place = item.placeId ? places.get(item.placeId) : null;
      const placeLabel = place ? copy(place.localName && place.localName !== place.name ? `${place.name} / ${place.localName}` : place.name) : escapeHtml(item.title);
      const normalizedStatus = ({ pending: "to_book", confirmed: "confirmed", verify: "verify", candidate: "candidate", cancelled: "cancelled" })[item.reservationStatus] || "";
      const statusLabels = { to_book: "待预订", confirmed: "已确认", verify: "临行核验", candidate: "候选", cancelled: "已取消" };
      // 未配置共同编辑时输出静态徽章：逐日条目的 reservationStatus 是行程事实，可操作的三态台账在“预定清单”。
      const status = !normalizedStatus ? "" : collaborationEnabled
        ? '<span class="execution-status-wrap"><button type="button" class="execution-status is-' + normalizedStatus + '" data-execution-status data-execution-id="' + escapeHtml(item.id) + '" data-execution-type="activity" data-booking-status="' + normalizedStatus + '" data-execution-note="" aria-label="编辑预订状态">' + statusLabels[normalizedStatus] + '</button><small class="execution-note" data-execution-note-for="' + escapeHtml(item.id) + '" hidden></small></span>'
        : '<span class="execution-status-wrap"><span class="execution-status is-' + normalizedStatus + '">' + statusLabels[normalizedStatus] + '</span></span>';
      const information = [item.activity, ...(item.details || [])].filter(Boolean);
      const showAddress = place?.address && !renderedAddressPlaceIds.has(place.id);
      if (showAddress) renderedAddressPlaceIds.add(place.id);
      const address = showAddress ? `<p class="slot-address"><b>地址：</b><a href="${escapeHtml(googleMapsSearchUrl(place))}" target="_blank" rel="noopener noreferrer">${escapeHtml(place.address)}</a></p>` : "";
      const metaParts = [escapeHtml(item.transportMode), item.travelMinutes > 0 ? `移动 ${minutesText(item.travelMinutes)}` : "", `停留 ${minutesText(item.stayMinutes)}`, item.breakGroundRoute ? "路线断点" : ""].filter(Boolean).join(" · ");
      const timeLabel = displayTime(item);
      const wideTimeClass = !item.startTime && timeLabel.length > 12 ? " is-wide-time" : "";
      return `<li class="slot execution-item${wideTimeClass}" data-item-id="${escapeHtml(item.id)}"${item.placeId ? ` data-place-id="${escapeHtml(item.placeId)}" role="button" aria-label="在地图上查看：${escapeHtml(item.title)}"` : ""} data-day-number="${day.dayNumber}" tabindex="0"><div class="slot-time">${escapeHtml(timeLabel)}</div><div class="slot-detail"><h4>${placeLabel} ${status} ${sourceLinks(item.sourceIds)}</h4>${renderInformation(information)}${address}${renderItemLinks(item.links)}${renderItemReferenceImages(item.referenceImages)}${renderItemNotes(item.notes)}<p class="meta">${metaParts}</p></div></li>${renderPlacement(placementsByAnchor.get(item.id))}`;
    }).join("");
    const navigationSegments = data.features.dayNavigation ? dayNavigationSegments(day, places) : [];
    const calendarItems = day.items.filter((item) => item.calendarHighlight).slice(0, 6);
    if (calendarMode === "daily" && day.date) {
      calendarEvents.push({
        id: `day-${day.dayNumber}`,
        date: day.date,
        allDay: true,
        title: `Day ${day.dayNumber} | ${day.city} · ${day.theme}`,
        descriptionSections: calendarDescriptionSections(day, calendarItems, places, navigationSegments),
        location: day.city
      });
    } else if (calendarMode === "timed" && day.date) {
      calendarItems.filter((item) => item.startTime).forEach((item) => {
        const place = item.placeId ? places.get(item.placeId) : null;
        calendarEvents.push({ id: item.id, date: day.date, allDay: false, startTime: item.startTime, endTime: item.endTime, stayMinutes: item.stayMinutes, title: `Day ${day.dayNumber} | ${item.title}`, descriptionSections: calendarDescriptionSections(day, [item], places, navigationSegments), location: place?.name || day.city });
      });
    }
    const overviewActions = `${data.features.dayMap ? `<button type="button" data-show-day-map="${day.dayNumber}">当天地图</button>` : ""}<p class="day-intensity" aria-label="行程强度 ${intensityScore} 星"><b>行程强度</b><strong>${intensityScore} 🌟</strong></p>`;
    const routeSummary = data.features.dayNavigation ? renderDayNavigation(day, places, navigationSegments) : renderDayRoute(day, places);
    const routeAvatar = day.routeNoteAvatar ? `<img class="day-route-note-avatar" src="${escapeHtml(day.routeNoteAvatar)}" alt="" aria-hidden="true">` : "";
    const routeNote = day.routeNote ? `<small class="day-route-heading-note" data-day-route-note>${routeAvatar}${escapeHtml(day.routeNote)}</small>` : "";
    const routeBlock = routeSummary ? `<section class="day-route-block${data.features.dayNavigation ? " route-timeline-card" : ""}" aria-label="当日路线">${data.features.dayNavigation ? "" : `<h4>当日路线${routeNote}</h4>`}${routeSummary}</section>` : "";
    const accommodationNote = day.accommodation.note?.trim() ? `；${escapeHtml(day.accommodation.note.trim())}` : "";
    const noteGroups = [["吃喝安排", day.food], ["风险", day.risks], ["替代方案", day.alternatives]]
      .filter(([, items]) => Array.isArray(items) && items.length)
      .map(([title, items]) => `<div><h4>${title}</h4>${textList(items)}</div>`).join("");
    const dayNotes = noteGroups ? `<div class="day-notes">${noteGroups}</div>` : "";
    const travelDay = renderTravelDay(day, places, travelRecommendations, data.sources, dayNavigationSegments(day, places), Boolean(mapSection), photographedPlaces);
    return `<article class="day card" role="tabpanel" id="day-${day.dayNumber}" aria-labelledby="day-tab-${day.dayNumber}" data-day-panel="${day.dayNumber}"${dateAttr}${day.kind ? ` data-kind="${escapeHtml(day.kind)}"` : ""}${dayIndex ? " hidden" : ""}><header class="day-overview"><div class="day-overview-top"><div class="day-label"><span>Day ${day.dayNumber}</span><small>${visibleDate}</small></div><span class="day-weather-badge" data-day-weather>天气待刷新</span><div class="day-overview-actions">${overviewActions}</div></div><h3>${escapeHtml(day.city)}｜${escapeHtml(day.theme)}</h3><p><b>住宿：</b>${escapeHtml(day.accommodation.label)}${accommodationNote}</p></header>${routeBlock}<section class="day-timeline-block" aria-label="详细时间线"><h4>详细时间线</h4><ol class="timeline">${slots}</ol></section>${dayNotes}<div>${sourceLinks(day.sourceIds)}</div>${travelDay}</article>`;
  }).join("");
  const calendarLabel = calendarMode === "daily" ? `导出全部 ${data.days.length} 天行程（ICS）` : "导出确定时间安排（ICS）";
  const calendar = data.features.calendarExport ? `<div class="itinerary-tools"><button type="button" data-calendar-export>${calendarLabel}</button><span data-calendar-status role="status" aria-live="polite">${calendarEvents.length ? "" : "暂无可导出的行程"}</span></div><script type="application/json" data-calendar-events data-calendar-mode="${calendarMode}">${safeJson(calendarEvents)}</script>` : "";
  return `<section class="guide-section" data-guide-module="itinerary" id="itinerary" data-nav-label="逐日行程"><h2>${escapeHtml(moduleTitle("itinerary"))}</h2>${calendar}<div class="itinerary-date-bar"><div class="itinerary-day-tabs" role="tablist" aria-label="选择行程日期" data-day-tabs>${tabs}</div><button class="travel-mobile-directory-button" type="button" data-travel-directory-open aria-haspopup="dialog" aria-controls="travel-directory-dialog">查看当天行程</button></div><dialog class="travel-directory-dialog" id="travel-directory-dialog" data-travel-directory-dialog aria-labelledby="travel-directory-title"><header><h3 id="travel-directory-title">当天行程</h3><button type="button" data-travel-directory-close aria-label="关闭当天行程">×</button></header><div data-travel-directory-list></div></dialog><h3 class="travel-day-title" data-travel-day-title hidden></h3>${mapSection}<div class="itinerary-day-panels" data-day-panels>${cards}</div></section>`;
}

function renderTransport(data) {
  const showVerification = data.transport.some((item) => typeof item.verification === "string" && item.verification.trim());
  const rows = data.transport.map((item) => `<tr><td data-label="出发地">${copy(item.from)}</td><td data-label="目的地">${copy(item.to)}</td><td data-label="出发窗口">${escapeHtml(item.departureWindow)}</td><td data-label="抵达窗口">${escapeHtml(item.arrivalWindow)}</td><td data-label="方式">${escapeHtml(item.mode)}</td><td data-label="参考时间">${escapeHtml(item.duration)} ${showVerification ? "" : sourceLinks(item.sourceIds)}</td><td data-label="参考费用">${escapeHtml(item.cost)}</td>${showVerification ? `<td data-label="特殊核验">${escapeHtml(item.verification || "")} ${sourceLinks(item.sourceIds)}</td>` : ""}</tr>`).join("");
  const verificationHead = showVerification ? "<th>特殊核验</th>" : "";
  const columns = showVerification ? 8 : 7;
  return `<section class="guide-section" data-guide-module="transport" id="transport" data-nav-label="交通"><h2>${escapeHtml(moduleTitle("transport"))}</h2><div class="table-wrap" data-mobile-cards><table><thead><tr><th>出发地</th><th>目的地</th><th>出发窗口</th><th>抵达窗口</th><th>方式</th><th>参考时间</th><th>参考费用</th>${verificationHead}</tr></thead><tbody>${rows || `<tr><td colspan="${columns}">待核验</td></tr>`}</tbody></table></div></section>`;
}

function renderBudget(data) {
  const budget = data.budget;
  const rows = budget.items.map((item) => `<tr><td data-label="项目">${escapeHtml(item.name)}</td><td data-label="估算">${money(item.min)}–${money(item.max)} ${escapeHtml(item.currency)}</td><td data-label="口径">${escapeHtml(item.note || "参考区间")} ${sourceLinks(item.sourceIds)}</td></tr>`).join("");
  const exchangeComparison = data.features.exchange && (budget.exchangeChannels || []).length ? `<article class="exchange-channel-card" data-exchange-comparison><h3>换 1000 元，实际能拿多少</h3><label>本次人民币总支出 <input type="number" min="0" step="1" value="1000" data-exchange-compare-amount> 元</label><div class="exchange-channel-list">${budget.exchangeChannels.map((channel) => `<div class="exchange-channel" data-exchange-channel data-currency="${escapeHtml(channel.currency)}" data-rate="${channel.rateLocalPerCny ?? ""}" data-fee-cny="${channel.feeCny ?? ""}" data-fee-percent="${channel.feePercent ?? ""}" data-fee-local="${channel.feeLocal ?? ""}"><strong>${escapeHtml(channel.name)}</strong><small>${escapeHtml(channel.kind.toUpperCase())} · ${escapeHtml(channel.observedAt)}${channel.condition ? ` · ${escapeHtml(channel.condition)}` : ""}</small><span data-exchange-channel-result>待比较</span>${sourceLinks(channel.sourceIds)}</div>`).join("")}</div></article>` : "";
  const expenses = data.features.expenseTracker ? `<article class="expense-tracker card" data-expense-tracker data-budget-min="${budget.total.min}" data-budget-max="${budget.total.max}" data-currency="${escapeHtml(budget.baseCurrency)}"><div class="expense-tracker__head"><div><h3>实际支出</h3><p>记录保存在当前浏览器。</p></div><button type="button" data-expense-export>导出 CSV</button></div><div class="expense-summary"><strong data-expense-total>0 ${escapeHtml(budget.baseCurrency)}</strong><span data-expense-compare>尚未记录支出</span></div><div class="expense-add"><input type="date" data-expense-date aria-label="支出日期"><input type="text" maxlength="60" data-expense-name placeholder="支出项目" aria-label="支出项目"><input type="number" min="0" step="0.01" data-expense-amount placeholder="金额" aria-label="支出金额"><button type="button" data-expense-add>添加</button></div><ol class="expense-list" data-expense-list></ol></article>` : "";
  const notes = Array.isArray(budget.notes) && budget.notes.length ? textList(budget.notes) : "";
  return `<section class="guide-section" data-guide-module="budget" id="budget" data-nav-label="预算"><h2>${escapeHtml(moduleTitle("budget"))}</h2><div class="table-wrap" data-mobile-cards><table><thead><tr><th>项目</th><th>估算</th><th>口径</th></tr></thead><tbody>${rows || '<tr><td colspan="3">待核验</td></tr>'}<tr><th data-label="项目">合计</th><th data-label="估算">${money(budget.total.min)}–${money(budget.total.max)} ${escapeHtml(budget.total.currency)}</th><td data-label="口径">${escapeHtml(data.meta.budgetBasis)}</td></tr></tbody></table></div>${notes}${exchangeComparison}${expenses}</section>`;
}

function renderExchangeDialog(data) {
  if (!data.features.exchange) return "";
  const budget = data.budget;
  const currencies = budget.targetCurrencies;
  const codes = [...new Set([...currencies.filter(code => code !== "USD" && code !== "CNY"), "USD", "CNY"])];
  const flags = { USD: "🇺🇸", CNY: "🇨🇳", LAK: "🇱🇦", VND: "🇻🇳", THB: "🇹🇭", JPY: "🇯🇵", KRW: "🇰🇷", EUR: "🇪🇺", GBP: "🇬🇧", CHF: "🇨🇭", SGD: "🇸🇬", MYR: "🇲🇾", IDR: "🇮🇩", AUD: "🇦🇺", CAD: "🇨🇦", HKD: "🇭🇰", TWD: "🇹🇼" };
  const choices = selected => codes.map(code => `<option value="${escapeHtml(code)}"${code === selected ? " selected" : ""}>${flags[code] || ""} ${escapeHtml(code)}</option>`).join("");
  return `<dialog class="guide-exchange-dialog" id="guide-exchange-dialog" data-exchange-dialog aria-labelledby="guide-exchange-title"><section class="guide-quickcalc" data-exchange-tool data-exchange-base="CNY" data-exchange-targets="${escapeHtml(currencies.join(","))}"><header class="guide-exchange-dialog__head"><h2 id="guide-exchange-title">汇率换算</h2><button type="button" data-exchange-dialog-close aria-label="关闭汇率换算">×</button></header><div class="guide-quickcalc__fields"><label class="guide-quickcalc__field"><span>金额</span><div class="guide-quickcalc__amount"><input type="text" inputmode="decimal" value="100" data-exchange-local-input aria-label="待换算金额"><select data-exchange-from aria-label="原币种">${choices(currencies[0])}</select></div></label><button class="guide-quickcalc__swap" type="button" data-exchange-swap aria-label="交换换算方向">⇅</button><label class="guide-quickcalc__field"><span>换算为</span><div class="guide-quickcalc__amount guide-quickcalc__amount--result"><input type="text" readonly data-exchange-input placeholder="—" aria-label="换算结果" aria-live="polite"><select data-exchange-to aria-label="目标币种">${choices("CNY")}</select></div></label></div><div class="guide-quickcalc__rate-values"><span data-exchange-rate-base></span><span data-exchange-rate-usd hidden></span></div><div class="guide-quickcalc__mnemonic" hidden><p data-exchange-mnemonic></p></div><p class="guide-quickcalc__status" data-exchange-status aria-live="polite" hidden></p><div class="guide-quickcalc__footer"><p class="guide-quickcalc__time" data-exchange-last-updated hidden></p><button type="button" data-exchange-refresh>刷新汇率 ↻</button></div></section></dialog>`;
}

function renderSourcedImage(image, sources = []) {
  if (!image) return "";
  const source = sources.find((entry) => entry.id === image.sourceId);
  const xhsAttrs = xiaohongshuNoteAttrs(source, image.alt || "");
  const attribution = source?.url ? `<a href="${escapeHtml(source.url)}"${xhsAttrs} target="_blank" rel="noopener noreferrer">图片：${escapeHtml(source.type === "xiaohongshu" ? `小红书 · ${source.author || source.title}` : source.title)} ↗</a>` : "";
  return `<figure class="sourced-recommendation-image"><button type="button" data-preview-image="${escapeHtml(image.src)}" aria-label="放大查看：${escapeHtml(image.alt)}"><img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" loading="lazy"></button><figcaption>${attribution}</figcaption></figure>`;
}

function renderRecommendations(data) {
  const notes = new Map((data.recommendationNotes || []).map((item) => [item.category, item]));
  const places = placeMapOf(data);
  const venuePlaceIds = new Set((data.venueSuggestions || []).map((item) => item.placeId).filter(Boolean));
  const visibleRecommendations = data.recommendations.filter((item) => item.category !== "餐饮指南" || !venuePlaceIds.has(item.placeId));
  const content = RECOMMENDATION_CATEGORIES.map((category) => {
    const note = notes.get(category);
    const categoryItems = visibleRecommendations.filter((item) => item.category === category);
    const recommendationCards = categoryItems.map((item) => {
      const place = item.placeId ? places.get(item.placeId) : null;
      const mapName = place || { name: item.name };
      const guidance = [["注意", item.limit], ["提示", item.executionAdvice]].filter(([, value]) => typeof value === "string" && value.trim()).map(([label, value]) => `<p><b>${label}：</b>${escapeHtml(value.trim())}</p>`).join("");
      const products = (item.productPicks || []).map((pick) => `<li><b>${escapeHtml(pick.name)}</b> · ${escapeHtml(pick.reason)}${pick.where ? ` · ${escapeHtml(pick.where)}` : ""}${pick.priceObserved ? ` · ${escapeHtml(pick.priceObserved)}` : ""}${renderSourcedImage(pick.image, data.sources)} ${sourceLinks(pick.sourceIds)}</li>`).join("");
      const menu = (item.menuItems || []).map((dish) => `<li><b>${escapeHtml(dish.name)}</b> · ${escapeHtml(dish.reason)}${dish.priceObserved ? ` · ${escapeHtml(dish.priceObserved)}` : ""} ${sourceLinks(dish.sourceIds)}</li>`).join("");
      return `<article class="recommendation-item guide-action-card" id="recommendation-${escapeHtml(item.id)}"${place ? ` data-place-id="${escapeHtml(place.id)}"` : ""}>${renderSourcedImage(item.image, data.sources)}<div class="recommendation-card-head"><h4>${escapeHtml(item.name)} ${sourceLinks(item.sourceIds)}</h4><span class="recommendation-route-tag">${escapeHtml(item.routeRelation)}</span></div><p class="recommendation-reason"><b>特色：</b>${escapeHtml(item.reason)}</p><p class="recommendation-fit"><b>安排：</b>${escapeHtml(item.travelerFit)}</p><div class="recommendation-facts"><span><b>适合：</b>${escapeHtml(item.timing)}</span><span><b>耗时：</b>${escapeHtml(item.duration)}</span>${item.reservation.trim() !== "—" ? `<span><b>预约：</b>${escapeHtml(item.reservation)}</span>` : ""}</div>${products ? `<ul class="product-picks">${products}</ul>` : ""}${menu ? `<ul class="venue-menu-items">${menu}</ul>` : ""}${guidance ? `<div class="recommendation-guidance">${guidance}</div>` : ""}<div class="booking-card-actions">${item.officialUrl ? `<a href="${escapeHtml(item.officialUrl)}" target="_blank" rel="noopener noreferrer">官网 ↗</a>` : ''}<a href="${escapeHtml(googleMapsSearchUrl(mapName))}" target="_blank" rel="noopener noreferrer">Google Maps ↗</a>${xiaohongshuSearchLink(item.name)}</div></article>`;
    }).join("");
    const venueCards = category === "餐饮指南" ? renderVenueSuggestionCards(data) : "";
    const count = categoryItems.length + (category === "餐饮指南" ? (data.venueSuggestions || []).length : 0);
    const moduleNote = note ? `<p class="recommendation-module-note"><b>整体备注：</b>${escapeHtml(note.text)} ${sourceLinks(note.sourceIds)}</p>` : "";
    return `<section class="recommendation-module"><h3><span>${category}</span><small>${count} 项</small></h3><div class="recommendation-list booking-ledger-grid">${recommendationCards + venueCards}</div>${moduleNote}</section>`;
  }).join("") + ((data.localKnowledge || []).length ? `<section class="recommendation-module local-knowledge-module"><h3><span>文化习俗</span><small>${(data.localKnowledge || []).length} 项</small></h3><div class="local-knowledge-grid">${(data.localKnowledge || []).map((item) => `<article class="local-knowledge-card"><span>${escapeHtml(item.category)}</span><h4>${escapeHtml(item.title)} ${sourceLinks(item.sourceIds)}</h4><p>${escapeHtml(item.guidance)}</p>${item.action ? `<p><b>建议做法：</b>${escapeHtml(item.action)}</p>` : ''}</article>`).join('')}</div></section>` : '');
  const total = visibleRecommendations.length + (data.venueSuggestions || []).length + (data.localKnowledge || []).length;
  return `<section class="booking-ledger-group booking-ledger-group--experience" data-guide-module="recommendations" id="recommendations" data-nav-label="当地体验"><div class="local-experience-heading"><h2>${escapeHtml(moduleTitle("recommendations"))}</h2><small>${total} 项</small></div><div class="recommendation-modules">${content}</div></section>`;
}

function renderWeather(data, weatherTemplate, rainPrayer) {
  if (!data.features.weather) return "";
  const places = placeMapOf(data);
  const locations = (data.weather.locations || []).map((location) => {
    const place = places.get(location.placeId);
    const label = location.label || (place ? (place.localName && place.localName !== place.name ? `${place.name} / ${place.localName}` : place.name) : "");
    return { name: location.name, label, latitude: location.latitude, longitude: location.longitude, ...(location.timezone ? { timezone: location.timezone } : {}) };
  });
  return weatherTemplate
    .replaceAll("__TRIP_START_DATE__", data.weather.startDate || "2099-12-31")
    .replaceAll("__TRIP_END_DATE__", data.weather.endDate || data.weather.startDate || "2099-12-31")
    .replaceAll("__WEATHER_LOCATIONS_JSON__", safeJson(locations))
    .replaceAll("__RAIN_PRAYER_SOURCE__", safeJson(rainPrayer));
}

function renderChecklist(data, weatherTemplate, rainPrayer, collaborationEnabled = false) {
  const items = data.checklist.map((item) => `<label class="guide-checklist-item"><input type="checkbox" data-check="${escapeHtml(item.id)}"><span>${escapeHtml(item.text)} ${sourceLinks(item.sourceIds)}</span></label>`).join("");
  const storageNote = collaborationEnabled
    ? "本地保存；加入共享行程后实时同步。"
    : "勾选状态仅保存在当前浏览器。";
  return `<section class="guide-section" data-guide-module="checklist" id="checklist" data-nav-label="核验清单"><h2>${escapeHtml(moduleTitle("checklist"))}</h2><div class="guide-checklist-shell" data-checklist="" data-editable="true"><div class="checklist-progress"><strong data-checklist-progress-count>0 / ${data.checklist.length}</strong><span data-checklist-progress-percent>0%</span><div><i data-checklist-progress-bar></i></div></div><div class="checklist-filters" role="group" aria-label="核验清单筛选"><button type="button" data-checklist-filter="all" aria-pressed="true">全部</button><button type="button" data-checklist-filter="open" aria-pressed="false">未完成</button><button type="button" data-checklist-filter="done" aria-pressed="false">已完成</button></div><div data-checklist-items>${items}</div>${renderWeather(data, weatherTemplate, rainPrayer)}<p class="local-note">${storageNote}</p></div></section>`;
}

function renderVenueSuggestionCards(data) {
  const suggestions = data.venueSuggestions || [];
  if (!suggestions.length) return "";
  const places = placeMapOf(data);
  const policies = { not_required: "不需要预定", recommended: "建议预定", required: "需要预定", verify: "预定规则待确认" };
  return suggestions.map((item) => {
    const place = places.get(item.placeId);
    const note = item.bookingNote?.trim() ? `<p class="venue-booking-note"><b>提醒：</b>${escapeHtml(item.bookingNote.trim())}</p>` : "";
    const address = [place.city, place.address || place.searchName].filter(Boolean).join(" · ");
    const menu = (item.menuItems || []).map((dish) => `<li><b>${escapeHtml(dish.name)}</b> · ${escapeHtml(dish.reason)}${dish.priceObserved ? ` · ${escapeHtml(dish.priceObserved)}` : ""} ${sourceLinks(dish.sourceIds)}</li>`).join("");
    return `<article class="venue-card guide-action-card" id="booking-venue-${escapeHtml(item.id)}" data-venue-id="${escapeHtml(item.id)}" data-place-id="${escapeHtml(place.id)}">${renderSourcedImage(item.image, data.sources)}<div class="venue-card-head"><h5>${escapeHtml(place.name)}</h5><span class="venue-policy is-${item.bookingPolicy}">${policies[item.bookingPolicy]}</span></div><p class="venue-timing">${escapeHtml(item.timing)}</p><p class="venue-reason">${escapeHtml(item.reason)}</p>${menu ? `<ul class="venue-menu-items">${menu}</ul>` : ""}${note}<div class="venue-card-footer"><span class="venue-address">${escapeHtml(address)}</span><div class="booking-card-actions"><a href="${escapeHtml(item.officialUrl)}" target="_blank" rel="noopener noreferrer">官网/预订 ↗</a><a href="${escapeHtml(googleMapsSearchUrl(place))}" target="_blank" rel="noopener noreferrer">Google Maps ↗</a>${xiaohongshuSearchLink(place.name)}</div></div></article>`;
  }).join("");
}

function renderBookingLedger(data, collaborationEnabled = false) {
  const places = placeMapOf(data);
  const entries = Array.isArray(data.bookingLedger) ? data.bookingLedger : [];
  const groups = [["活动与门票", "activity"], ["餐厅与用餐", "restaurant"]];
  const statusLabel = { confirmed: "已确认", to_book: "待预订", verify: "临行核验", candidate: "候选", cancelled: "已取消" };
  const card = (entry) => {
    const place = places.get(entry.placeId);
    const location = place ? `${place.name}${place.city ? `｜${place.city}` : ""}` : "地点待核验";
    const normalizedStatus = ({ pending: "to_book", confirmed: "confirmed", verify: "verify", candidate: "candidate", cancelled: "cancelled" })[entry.status] || "verify";
    const entityType = entry.category === "restaurant" ? "meal" : "activity";
    const status = statusLabel[normalizedStatus] || "临行核验";
    const localStatus = ({ to_book: "pending", confirmed: "confirmed", verify: "verify" })[normalizedStatus] || "verify";
    const localStatusLabel = { pending: "待预订", confirmed: "已预订", verify: "待核验" }[localStatus];
    const official = /^https?:\/\//i.test(String(entry.bookingUrl || "")) ? `<a href="${escapeHtml(entry.bookingUrl)}" target="_blank" rel="noopener noreferrer">官网/预订 ↗</a>` : "";
    const map = place ? `<a href="${escapeHtml(googleMapsSearchUrl(place))}" target="_blank" rel="noopener noreferrer">Google Maps ↗</a>` : "";
    const xhs = entry.category === "activity" ? xiaohongshuSearchLink(entry.title) : "";
    const control = collaborationEnabled
      ? '<button type="button" class="booking-status is-' + normalizedStatus + '" data-execution-status data-execution-id="booking:' + escapeHtml(entry.id) + '" data-execution-type="' + entityType + '" data-booking-status="' + normalizedStatus + '" data-execution-note="" aria-label="编辑预订状态">' + status + '</button><small class="execution-note" data-execution-note-for="booking:' + escapeHtml(entry.id) + '" hidden></small>'
      : '<button type="button" class="booking-status is-' + localStatus + '" data-booking-toggle data-local-booking="true" data-booking-id="' + escapeHtml(entry.id) + '" data-booking-initial-status="' + localStatus + '" aria-pressed="' + (localStatus === "confirmed" ? "true" : "false") + '">' + localStatusLabel + '</button>';
    return '<article class="booking-ledger-card guide-action-card">' + control + '<h4>' + escapeHtml(entry.title) + '</h4><p>' + escapeHtml(entry.when || "日期待核验") + '｜' + escapeHtml(location) + '</p><p class="booking-ledger-people">' + escapeHtml(entry.participants || "参加者待核验") + '</p><div class="booking-card-actions">' + official + map + xhs + '</div></article>';
  };
  const content = groups.map(([label, category]) => {
    const items = entries.filter((entry) => entry.category === category);
    if (category === "restaurant" && !items.length) return "";
    return `<section class="booking-ledger-group booking-ledger-group--${category}"><h3>${label}<small>${items.length} 项</small></h3><div class="booking-ledger-grid">${items.length ? items.map(card).join("") : "<p class=\"local-note\">暂无需汇总的预定项目。</p>"}</div></section>`;
  }).join("");
  const note = collaborationEnabled
    ? "点击状态可更新；加入共享行程后同步。"
    : "点击状态可更新，保存在当前浏览器。";
  const venuePlaceIds = new Set((data.venueSuggestions || []).map((item) => item.placeId).filter(Boolean));
  const recommendationCount = (data.recommendations || []).filter((item) => item.category !== "餐饮指南" || !venuePlaceIds.has(item.placeId)).length;
  const experienceCount = recommendationCount + (data.venueSuggestions || []).length + (data.localKnowledge || []).length;
  return `<section class="guide-section" data-guide-module="bookings" id="bookings" data-nav-label="预定清单"><h2>${escapeHtml(moduleTitle("bookings"))}</h2><p class="local-note">${note}</p><div class="booking-ledger-summary"><span>活动与门票 ${entries.filter((entry) => entry.category === "activity").length} 项</span><span>餐厅与用餐 ${entries.filter((entry) => entry.category === "restaurant").length} 项</span><span>当地体验 ${experienceCount} 项</span></div>${content}${renderRecommendations(data)}</section>`;
}
function renderSources(data, selection) {
  const { sources, numbers } = selection;
  const renderItem = (source) => {
    const title = escapeHtml(source.reading.title);
    const xhsAttrs = xiaohongshuNoteAttrs(source);
    const link = /^https?:\/\//i.test(String(source.url || "")) ? `<a href="${escapeHtml(source.url)}"${xhsAttrs} target="_blank" rel="noopener noreferrer">${title}</a>` : title;
    const number = numbers.get(source.id);
    return `<li value="${number}" id="source-${number}">${link}<p>${escapeHtml(source.reading.value)}</p></li>`;
  };
  const groups = READING_TOPICS.map((topic, index) => {
    const items = sources.filter(source => source.reading.topic === topic);
    return items.length ? `<section class="source-group" data-source-group="reading-${index}"><h3>${topic}<small>${items.length} 项</small></h3><ol class="source-list">${items.map(renderItem).join("")}</ol></section>` : "";
  }).join("");
  return `<section class="guide-section" data-guide-module="sources" id="sources" data-nav-label="补充阅读"${sources.length ? "" : " hidden"}><h2>${escapeHtml(moduleTitle("sources"))}</h2><div class="source-groups">${groups}</div></section>`;
}

// Give each guide a stable variation of the base route icon by tinting its PNG palette.
function tintGuideIcon(template, identity) {
  const png = fs.readFileSync(path.join(skillRoot, template));
  const color = [16, 52, 68].map((base, index) => base + parseInt(identity.slice(index * 2, index * 2 + 2), 16) % 50);
  for (let offset = 8; offset + 12 <= png.length;) {
    const size = png.readUInt32BE(offset);
    const start = offset + 8;
    const end = start + size;
    if (png.toString("ascii", offset + 4, start) === "PLTE") {
      for (let pixel = start; pixel < end; pixel += 3) {
        const weight = Math.max(0, Math.min(1, (200 - png[pixel]) / 183));
        [17, 74, 90].forEach((base, channel) => {
          png[pixel + channel] = Math.max(0, Math.min(255, Math.round(png[pixel + channel] + (color[channel] - base) * weight)));
        });
      }
      png.writeUInt32BE(crc32(png.subarray(offset + 4, end)), end);
      return png;
    }
    offset = end + 4;
  }
  throw new Error(`桌面图标模板缺少 PNG 调色板：${template}`);
}

function guideInstallAssets(meta, output) {
  const page = path.basename(output);
  const file = `guide-${digest(page).slice(0, 16)}.webmanifest`;
  const shortName = [...meta.destination.trim()].slice(0, 9).join("") + "攻略";
  const identity = digest(meta.guideId).slice(0, 24);
  const icons = GUIDE_ICONS.map(icon => ({ ...icon, src: icon.src.replace("guide-icon-", `guide-${identity}-`) }));
  const manifest = {
    id: `./?guide=${identity}`,
    name: meta.title, short_name: shortName, lang: "zh-CN",
    start_url: `./${encodeURIComponent(page)}`, scope: "./", display: "standalone",
    icons
  };
  const head = `<link rel="manifest" href="${file}"><link rel="apple-touch-icon" href="${icons[0].src}"><link rel="icon" type="image/png" sizes="${icons[1].sizes}" href="${icons[1].src}"><meta name="apple-mobile-web-app-title" content="${escapeHtml(shortName)}">`;
  const files = Object.fromEntries(icons.map((icon, index) => [icon.src, tintGuideIcon(GUIDE_ICONS[index].src, identity)]));
  files[file] = JSON.stringify(manifest, null, 2) + "\n";
  return { files, head };
}

function renderSearch(data, selection) {
  const index = data.features.sourceIndex ? selection.index : [];
  const sourceIndex = data.features.sourceIndex ? `<script id="travel-source-index" type="application/json">${safeJson(index)}</script>` : "";
  const advancedDisabled = data.features.sourceIndex ? "" : ' disabled title="本攻略暂无补充阅读"';
  const searchIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg>';
  const todayIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.2 20 4l-6.7 16-2.2-6.9L4 12.2Z"></path></svg>';
  const exchangeAction = data.features.exchange ? '<button id="guide-exchange-trigger" class="guide-floating-action" type="button" data-floating-action="exchange" aria-label="汇率换算" aria-haspopup="dialog" aria-controls="guide-exchange-dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M15.5 8.5c-.7-.8-1.8-1.2-3.2-1.2-1.7 0-2.8.8-2.8 2s1 1.8 2.7 2.1l1.4.3c1.6.3 2.4.9 2.4 2s-1.2 2-3 2c-1.4 0-2.7-.5-3.5-1.5M12 5.8v12.4"></path></svg><span>汇率</span></button>' : '';
  const homeScreenAction = '<button type="button" class="guide-floating-action" data-floating-action="home-screen" data-guide-home-screen aria-haspopup="dialog" aria-controls="guide-home-screen-dialog" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2.5" width="14" height="19" rx="2"></rect><path d="M12 7v7m-3.5-3.5h7"></path></svg><span>添加到手机桌面</span></button>';
  const homeScreenDialog = '<dialog id="guide-home-screen-dialog" class="guide-home-screen-dialog" data-guide-home-screen-dialog aria-labelledby="guide-home-screen-title"><h2 id="guide-home-screen-title">添加到手机桌面</h2><p data-guide-home-screen-help></p><form method="dialog"><button type="submit" data-guide-home-screen-close>关闭</button></form></dialog>';
  return `<div class="guide-floating-tools" data-guide-floating-tools><div id="guide-floating-actions" class="guide-floating-actions" data-guide-floating-actions aria-label="攻略快捷操作" aria-hidden="true" inert><button type="button" class="guide-floating-action" data-floating-action="travel-mode" data-travel-toggle hidden><span aria-hidden="true">↔</span><span data-travel-mode-label>进入出行模式</span></button><button id="guide-today-trigger" class="guide-floating-action guide-today-trigger" type="button" data-floating-action="today" data-day-jump="" aria-label="返回今日行程" hidden>${todayIcon}<span>今天</span></button>${exchangeAction}<button id="guide-search-trigger" class="guide-floating-action guide-search-trigger" type="button" data-floating-action="search" aria-label="搜索攻略" aria-controls="guide-search-panel" aria-expanded="false">${searchIcon}<span>搜索</span></button>${homeScreenAction}</div><button class="guide-floating-toggle" type="button" data-guide-floating-toggle aria-label="打开快捷操作" aria-controls="guide-floating-actions" aria-expanded="false"><span aria-hidden="true" data-guide-floating-toggle-icon>•••</span></button></div><aside id="guide-search-panel" class="guide-search-panel" hidden aria-labelledby="guide-search-title"><div class="guide-search-head"><strong id="guide-search-title">搜索攻略</strong><button id="guide-search-close" class="guide-search-close" type="button" aria-label="关闭搜索">×</button></div><form id="guide-search-form" class="guide-search-form" role="search"><input id="guide-search-input" type="search" autocomplete="off" placeholder="输入关键词" aria-label="搜索攻略关键词"><button id="guide-search-clear" class="guide-search-clear" type="button">清空</button><button class="guide-search-submit" type="submit">搜索</button><button id="guide-search-advanced" class="guide-search-advanced" type="button"${advancedDisabled}>高级搜索</button></form><div class="guide-search-navigation"><button id="guide-search-prev" type="button" disabled>上一个</button><span id="guide-search-count">0 / 0</span><button id="guide-search-next" type="button" disabled>下一个</button></div><div id="guide-search-results" class="guide-search-results" aria-live="polite"><p class="guide-search-hint"><span>普通搜索精确匹配攻略正文；</span><span>高级搜索模糊匹配补充阅读。</span></p></div></aside>${homeScreenDialog}${sourceIndex}`;
}

function renderHtml(data, mapConfig = { baidu: { enabled: false, ak: "" }, google: { enabled: false, key: "" } }, supabaseConfig = { enabled: false, projectUrl: "", publishableKey: "" }, { publicSource = false, contentSha256 = "", installHead = "" } = {}) {
  const reading = readingSelection(data);
  // Keep research records in the input JSON; expose only curated reading in HTML/search.
  data = { ...data, features: { ...data.features, sourceIndex: Boolean(data.features.sourceIndex && reading.sources.length) } };
  const readAsset = (segments) => {
    const file = path.join(skillRoot, ...segments);
    if (!fs.existsSync(file)) {
      console.error(`缺少资产文件 ${file}`);
      process.exit(1);
    }
    return fs.readFileSync(file, "utf8");
  };
  const interactionCss = readAsset(["assets", "travel-guide-interactions.css"]);
  const guideShellCss = readAsset(["assets", "guide-shell.css"]);
  const calendarJs = readAsset(["assets", "ics-calendar.js"]);
  const interactionJs = readAsset(["assets", "travel-guide-interactions.js"]);
  const collaborationJs = supabaseConfig.enabled ? readAsset(["assets", "supabase-execution-sync.js"]) : "";
  const routeCss = readAsset(["assets", "route-map.css"]);
  const baiduLoader = readAsset(["assets", "baidu-route-map.js"]);
  const googleLoader = readAsset(["assets", "google-route-map.js"]);
  const weatherTemplate = readAsset(["assets", "weather-card.html"]);
  const rainPrayer = readAsset(["assets", "rain-prayer.html"]);
  const features = [data.features.arrivalDeparture && "arrival", data.features.arrivalDeparture && "flight-records", data.features.exchange && "exchange", data.features.weather && "weather-refresh", data.features.sourceIndex && "source-index", "day-tabs", "travel-mode", data.features.dayMap && "day-map", data.features.contextualExplore && "contextual-explore", data.features.nearbyExplore && "nearby-explore", data.features.dayNavigation && "day-navigation", data.features.calendarExport && "calendar-export", data.features.expenseTracker && "expense-tracker", "booking-ledger", supabaseConfig.enabled && "collaboration"].filter(Boolean).join(" ");
  const dateAttrs = data.meta.dates.length ? (data.meta.datePolicy === "explicit" ? ` data-trip-date-policy="explicit-list" data-trip-dates="${data.meta.dates.join(",")}"` : ` data-trip-start="${data.meta.dates[0]}" data-trip-end="${data.meta.dates.at(-1)}"`) : "";
  const init = `TravelGuideInteractions.initGuidePage({exchange:${Boolean(data.features.exchange)},weather:${Boolean(data.features.weather)},dayTabs:true,execution:true,calendar:${Boolean(data.features.calendarExport)},expenses:${Boolean(data.features.expenseTracker)},flights:${Boolean(data.features.arrivalDeparture)},themes:true});`;
  const guideId = data.meta.guideId || resolveGuideIdentity(data);
  const collaborationInit = supabaseConfig.enabled ? `<script data-guide-collaboration-runtime>${collaborationJs}</script><script data-guide-collaboration-init>(()=>{const config=${safeJson({ projectUrl: supabaseConfig.projectUrl, publishableKey: supabaseConfig.publishableKey, guideId })};const ready=TravelGuideCollaboration.init(config);TravelGuideFlightCollaboration.init(config,ready);})();</script>` : "";
  const theme = GUIDE_THEMES.some(([id]) => id === data.meta.theme) ? data.meta.theme : "coast";
  const footer = `<footer class="guide-footer"><div><strong>${escapeHtml(data.meta.title)}</strong><p>${escapeHtml(data.meta.destination)} · ${escapeHtml(data.meta.dateDisplay || '')}</p></div></footer>`;
  const contentMeta = /^[a-f0-9]{64}$/.test(contentSha256) ? `<meta name="guide-content-sha256" content="${contentSha256}">` : "";
  const routeSections = renderRoute(data, routeCss, baiduLoader, googleLoader, mapConfig);
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="guide-build" content="${publicSource ? PUBLIC_PLACEHOLDERS.buildSha : "local"}"><meta name="guide-template-version" content="${PAGE_TEMPLATE_VERSION}">${contentMeta}${installHead}<link rel="preload" as="image" href="assets/niumou-spritesheet.webp" type="image/webp"><title>${escapeHtml(data.meta.title)}</title><style>${guideShellCss}\n${interactionCss}</style></head><body class="guide-page" data-guide-mode="full" data-guide-version="${GUIDE_DATA_VERSION}" data-guide-template-version="${PAGE_TEMPLATE_VERSION}" data-guide-id="${guideId}" data-guide-theme="${theme}" data-guide-default-theme="${theme}" data-guide-features="${features}"${dateAttrs}>${renderHeroHub(data)}<nav class="quick-nav" data-quick-nav aria-label="页面快速导航"></nav><main>${renderArrival(data)}${routeSections.routeOverview}${renderDays(data, supabaseConfig.enabled, routeSections.mapSection)}${renderTransport(data)}${renderBudget(data)}${renderChecklist(data, weatherTemplate, rainPrayer, supabaseConfig.enabled)}${renderBookingLedger(data, supabaseConfig.enabled)}${renderSources(data, reading)}</main>${renderSearch(data, reading)}${renderExchangeDialog(data)}${renderThemePopover()}${footer}<script>${calendarJs}</script><script>${interactionJs}</script><script>${init}</script>${collaborationInit}</body></html>`;
  return projectReadingReferences(html, reading.numbers);
}

/* 门禁3：baseline HTML 的模板版本必须与当前 PAGE_TEMPLATE_VERSION 一致。
   只认 <body> 开标签上的属性，防止 head 注释、meta 或正文文本里的同名字符串伪造版本。
   不一致说明基线由旧模板或变体渲染器生成，继续增量渲染会让全部模块漂移。 */
function assertBaselineTemplateVersion(baselineHtml, baselineLabel) {
  const bodyTag = baselineHtml.match(/<body\b[^>]*>/i);
  const version = bodyTag && bodyTag[0].match(/data-guide-template-version="([^"]*)"/);
  if (!version) throw new Error(`门禁3：${baselineLabel} 的 <body> 标签缺少 data-guide-template-version，无法确认基线模板版本，停止增量渲染。`);
  if (version[1] !== PAGE_TEMPLATE_VERSION) {
    throw new Error(`门禁3：基线 HTML 模板版本 ${version[1]} 与当前渲染器模板版本 ${PAGE_TEMPLATE_VERSION} 不一致。禁止用不一致的模板做增量渲染；请先按“模板升级”流程显式升级并用新模板重建基线。`);
  }
  return version[1];
}

/* 门禁2：按 data-guide-module 锚点提取完整模块片段。
   用标签配对扫描而非简单正则，确保内嵌 <script type="application/json"> 数据块一并包含。 */
function extractModuleFragment(html, moduleName) {
  const result = scanElementBlock(html, "data-guide-module", moduleName);
  if (result.error) throw new Error(`门禁2：${result.error}，无法提取模块片段。`);
  return result.fragment;
}

/* 折叠连续空白后取哈希，做确定性片段比较。 */
function normalizeFragment(fragment) {
  return fragment.replace(/\s+/g, " ").trim();
}
const hashFragment = (fragment) => crypto.createHash("sha256").update(normalizeFragment(fragment), "utf8").digest("hex");

/* 门禁2：逐个比对冻结模块。返回 { passed, modules, finalHtml }。
   基线中不存在的新增模块不参与冻结校验；漂移模块按 freezeAction 拦截或用基线片段整段还原。 */
function checkFrozenModules(newHtml, baselineHtml, moduleNames, action) {
  const modules = {};
  let finalHtml = newHtml;
  let passed = true;
  moduleNames.forEach((name) => {
    const baselineFragment = extractModuleFragment(baselineHtml, name);
    if (baselineFragment === null) { modules[name] = { status: "added" }; return; }
    const newFragment = extractModuleFragment(finalHtml, name);
    if (newFragment === null) {
      modules[name] = { status: "drifted-blocked", reason: "新渲染结果缺少该模块" };
      passed = false;
      return;
    }
    const baselineHash = hashFragment(baselineFragment);
    const newHash = hashFragment(newFragment);
    if (baselineHash === newHash) {
      modules[name] = { status: "equal", hash: newHash.slice(0, 12) };
      return;
    }
    if (action === "restore") {
      const position = finalHtml.indexOf(newFragment);
      if (position < 0) {
        modules[name] = { status: "drifted-blocked", reason: "无法定位新片段进行还原" };
        passed = false;
        return;
      }
      finalHtml = finalHtml.slice(0, position) + baselineFragment + finalHtml.slice(position + newFragment.length);
      modules[name] = { status: "drifted-restored", baselineHash: baselineHash.slice(0, 12), driftedHash: newHash.slice(0, 12), note: "该模块已还原为基线片段，不再对应当前 trip-data.json；若属误冻结请移出 --frozen-modules 后重渲，若属误改请同步回滚 JSON，避免页面与真相源脱节" };
      return;
    }
    modules[name] = { status: "drifted-blocked", baselineHash: baselineHash.slice(0, 12), driftedHash: newHash.slice(0, 12) };
    passed = false;
  });
  return { passed, modules, finalHtml };
}

function finish(cliArgs = process.argv.slice(2)) {
  const options = parseRenderOptions(cliArgs);
  const {
    args, input, output, requestPath, briefPath, baselinePath, allowPaths, baselineHtmlPath,
    frozenModules, freezeAction, allowDateRemoval, collaborationExplicitlyDisabled,
    publicSource, publicCollaboration, mapConfigPath, supabaseConfigPath
  } = options;
  const knownModuleNames = getKnownModuleNames();
  let optionError = "";
  if (!input || !output) optionError = RENDER_USAGE;
  else if (!["fail", "restore"].includes(freezeAction)) optionError = "--freeze-action 只支持 fail 或 restore。";
  else if (frozenModules.length && !baselineHtmlPath) optionError = "使用 --frozen-modules 时必须同时提供 --baseline-html=<旧HTML>，否则无法比对冻结模块。";
  else {
    const unknownModules = frozenModules.filter((name) => !knownModuleNames.includes(name));
    if (unknownModules.length) optionError = `--frozen-modules 含未知模块名：${unknownModules.join("、")}。拼错的冻结模块会静默失效；合法模块名为 ${knownModuleNames.join("、")}。`;
  }
  if (!optionError && allowDateRemoval && !baselineHtmlPath) optionError = "--allow-date-removal 只能与 --baseline-html 一起使用。";
  if (!optionError && publicCollaboration && collaborationExplicitlyDisabled) optionError = "--public-collaboration 与 --no-collaboration 互斥。";
  if (!optionError && publicCollaboration && !publicSource) optionError = "--public-collaboration 只能与 --public-source 一起使用。";
  if (!optionError && publicSource && (readOption(args, "map-config") || readOption(args, "supabase-config"))) optionError = "--public-source 使用 CI 占位符，不得同时传入私有地图/Supabase 配置。";
  if (optionError) { console.error(optionError); process.exit(2); }

  verifyTemplateLock(skillRoot);
  const reportPath = path.resolve(output.replace(/\.html?$/i, "") + ".validation.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  let data; let request = null; let brief = null; let baseline = null;
  let baselineHtml = null;
  let previousHtml = "";
  let contentResult = { valid: false, failures: [], warnings: [], summary: {} };
  let requestResult = { valid: true, failures: [], warnings: [], summary: { stage: "not-provided" } };
  let briefResult = { valid: true, failures: [], warnings: [], summary: { stage: "not-provided" } };
  let frozenModulesReport = { status: "not-provided", action: freezeAction, modules: {} };
  let mapConfig = { baidu: { enabled: false, ak: "" }, google: { enabled: false, key: "" } };
  let supabaseConfig = { enabled: false, projectUrl: "", publishableKey: "" };
  let setupFailure = null;
  try {
    data = readUtf8Json(path.resolve(input));
    request = requestPath ? readUtf8Json(path.resolve(requestPath)) : null;
    brief = briefPath ? readUtf8Json(path.resolve(briefPath)) : null;
    baseline = baselinePath ? readUtf8Json(path.resolve(baselinePath)) : null;
    mapConfig = publicSource
      ? { baidu: { enabled: true, ak: PUBLIC_PLACEHOLDERS.baiduAk }, google: { enabled: true, key: PUBLIC_PLACEHOLDERS.googleKey } }
      : readMapConfig(mapConfigPath);
    supabaseConfig = publicSource && publicCollaboration
      ? { enabled: true, projectUrl: PUBLIC_PLACEHOLDERS.supabaseProjectUrl, publishableKey: PUBLIC_PLACEHOLDERS.supabasePublishableKey }
      : publicSource ? { enabled: false, projectUrl: "", publishableKey: "" } : readSupabaseConfig(supabaseConfigPath);
    if (baselineHtmlPath) baselineHtml = fs.readFileSync(path.resolve(baselineHtmlPath), "utf8");
    if (fs.existsSync(path.resolve(output))) previousHtml = fs.readFileSync(path.resolve(output), "utf8");
    assertCollaborationRetention(baselineHtml || previousHtml, supabaseConfig.enabled, collaborationExplicitlyDisabled);
    // DOM 冻结只能比较同版模板；仅做数据连续性核对时允许跨模板版本。
    if (baselineHtml && frozenModules.length) assertBaselineTemplateVersion(baselineHtml, path.basename(path.resolve(baselineHtmlPath)));
  } catch (error) {
    setupFailure = error.message;
  }
  if (!setupFailure) {
    try {
      const outcome = runPipelineValidation(data, { stage: "content", request, brief, baseline, allowPaths: allowPaths.length ? allowPaths : null, allowDateRemoval });
      contentResult = outcome.result;
      requestResult = outcome.requestValidation;
      briefResult = outcome.briefValidation;
    } catch (error) {
      contentResult = { valid: false, failures: [error.message], warnings: [], summary: {} };
    }
  } else {
    contentResult = { valid: false, failures: [setupFailure], warnings: [], summary: {} };
  }
  const contentContinuity = {
    status: baseline && baselineHtml && allowPaths.length ? "enforced" : "not-provided",
    inputPath: path.resolve(input),
    inputSha256: data ? digest(fs.readFileSync(path.resolve(input))) : "",
    baselinePath: baselinePath ? path.resolve(baselinePath) : "",
    baselineDataSha256: baselinePath && baseline ? digest(fs.readFileSync(path.resolve(baselinePath))) : "",
    baselineHtmlSha256: baselineHtml ? digest(baselineHtml) : "",
    allowPaths
  };
  const report = { generatedAt: new Date().toISOString(), input: path.basename(path.resolve(input)), output: path.basename(path.resolve(output)), contentContinuity, requestValidation: requestResult, briefValidation: briefResult, dataValidation: contentResult, htmlValidation: { valid: false, output: "未执行" }, frozenModules: frozenModulesReport, browserValidation: { status: "pending", checks: [] } };
  if (!contentResult.valid) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.error(`${setupFailure ? "渲染前置门禁未通过（trip-data.json 尚未进入校验）" : "trip-data.json 未通过"}，停止渲染：\n- ` + contentResult.failures.join("\n- "));
    process.exit(1);
  }
  // 隐私门禁只处理渲染副本；清理后再校验，防止产生空引用或错引用页面。
  const selfHosts = readSelfHostsConfig();
  const sanitizeResult = sanitizeSelfReferenceSources(data, selfHosts);
  const renderData = sanitizeResult.data;
  if (sanitizeResult.removed.length) {
    const sanitizedBaseline = baseline ? sanitizeSelfReferenceSources(baseline, selfHosts).data : null;
    const sanitizedValidation = validateTripData(renderData, { stage: "content", baseline: sanitizedBaseline,
      allowPaths: allowPaths.length ? allowPaths : null, allowDateRemoval });
    if (!sanitizedValidation.valid) {
      report.dataValidation = sanitizedValidation;
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
      console.error("隐私门禁移除自引用来源后数据失效，请为受影响内容补充外部来源后重试：\n- " + sanitizedValidation.failures.join("\n- "));
      process.exit(1);
    }
    console.log(`隐私门禁：已从渲染副本移除 ${sanitizeResult.removed.length} 条自引用来源并重排剩余来源编号。`);
  }
  const identityWasMissing = !data.meta.guideId;
  const guideId = resolveGuideIdentity(data, {baseline, baselineHtml, previousHtml});
  renderData.meta.guideId = guideId;
  const canonicalContentHash = value => digest(JSON.stringify({ ...value, meta: { ...value.meta, guideId } }));
  report.contentContinuity.inputContentSha256 = canonicalContentHash(data);
  report.contentContinuity.baselineContentSha256 = baseline ? canonicalContentHash(baseline) : "";
  const install = guideInstallAssets(renderData.meta, output);
  const renderedHtml = renderHtml(renderData, mapConfig, supabaseConfig, {
    publicSource, contentSha256: report.contentContinuity.inputContentSha256, installHead: install.head
  });
  // 门禁2：冻结模块比对（fail 拦截 / restore 还原）
  let finalHtml = renderedHtml;
  if (frozenModules.length) {
    const freezeOutcome = checkFrozenModules(renderedHtml, baselineHtml, frozenModules, freezeAction);
    frozenModulesReport = { status: "enforced", action: freezeAction, modules: freezeOutcome.modules };
    report.frozenModules = frozenModulesReport;
    if (!freezeOutcome.passed) {
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
      const drifted = Object.entries(freezeOutcome.modules).filter(([, value]) => value.status === "drifted-blocked").map(([name]) => name);
      console.error(`门禁2：冻结模块 ${drifted.join("、")} 相对基线发生漂移，已拦截交付。请修正数据或模板后重渲；仅在用户明确授权时改用 --freeze-action=restore 自动还原基线片段。`);
      process.exit(1);
    }
    if (Object.values(freezeOutcome.modules).some(v => v.status === "drifted-restored")) {
      throw new Error("冻结还原仅用于诊断；请回滚对应 JSON 后重新渲染，未覆盖原成品。");
    }
    finalHtml = freezeOutcome.finalHtml;
    Object.entries(freezeOutcome.modules).filter(([, value]) => value.status === "drifted-restored").forEach(([name]) => {
      console.warn(`门禁2：冻结模块 ${name} 漂移已按 --freeze-action=restore 用基线片段整段还原。注意：该模块不再对应当前 trip-data.json——属误冻结请移出 --frozen-modules 后重渲，属误改请同步回滚 JSON，不得带着脱节状态交付。`);
    });
  } else if (baselineHtml) {
    console.warn("提示：已提供 --baseline-html 但未声明 --frozen-modules，门禁2 冻结模块校验被跳过；增量任务应显式列出全部冻结模块。");
    frozenModulesReport = { status: "baseline-provided-no-frozen-modules", action: freezeAction, modules: {} };
    report.frozenModules = frozenModulesReport;
  }
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });

  const hasDates = renderData.meta.dates.length > 0;
  const validation = validateGuideContract(finalHtml, {
    full: true,
    expectedDatesOption: hasDates ? renderData.meta.dates.join(",") : "",
    baselineHtml: hasDates && baselineHtmlPath ? (baselineHtml || "") : "",
    allowDateRemoval: hasDates && baselineHtmlPath ? allowDateRemoval : false,
    fileLabel: path.basename(path.resolve(output))
  });
  report.htmlValidation = { valid: validation.valid, htmlSha256: digest(finalHtml), expectedDates: renderData.meta.dates, output: formatResult(validation, { full: true, fileLabel: path.basename(path.resolve(output)) }) };
  if (!report.htmlValidation.valid) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.error("HTML 已生成但未通过契约：\n" + report.htmlValidation.output);
    process.exit(1);
  }
  try {
    report.artifactValidation = { valid: true };
    deliverArtifacts({ inputPath: input, outputPath: output, html: finalHtml, skillRoot, runtimeAssets: GUIDE_OUTPUT_ASSETS, generatedAssets: install.files, reportPath, report });
  } catch (error) {
    report.artifactValidation = { valid: false, error: error.message };
    report.htmlValidation.valid = false;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.error(error.message);
    process.exit(1);
  }
  console.log(`已生成 ${path.resolve(output)}\n验证报告 ${reportPath}`);
  // Persist only after validation succeeds; future retitles/date changes reuse this identity.
  if (identityWasMissing) {
    const persistedData = structuredClone(data);
    persistedData.meta.guideId = guideId;
    fs.writeFileSync(path.resolve(input), JSON.stringify(persistedData, null, 2) + "\n", "utf8");
  }
}

if (require.main === module) finish();

module.exports = { resolveGuideIdentity, renderHeroHub, xiaohongshuSearchUrl, assertBaselineTemplateVersion, extractModuleFragment, normalizeFragment, checkFrozenModules, dayRouteNodes, renderDayRoute, resolvePrivateConfigPath, readSelfHostsConfig, sanitizeSelfReferenceSources, parseRenderOptions, readSupabaseConfig, htmlDeclaresCollaboration, assertCollaborationRetention, navigationModes, dayNavigationSegments, renderDayNavigation, calendarDescriptionSections, dayWeatherPlaceId };
