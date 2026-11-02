/* ── 15  flight records ── */
const FLIGHT_OCR_MODULE_URL = "https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm";
const FLIGHT_OCR_WASM_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/";
const FLIGHT_IMAGE_DB = "travel-guide-flight-assets-v1";
const FLIGHT_OCR_TIMEOUT_MS = 45000;
let flightOcrPromise = null;

const flightText = value => String(value == null ? "" : value).trim();
const flightEscape = value => typeof escapeHtml === "function"
  ? escapeHtml(value)
  : flightText(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const FLIGHT_SENSITIVE = /姓名|乘机人|旅客|证件|护照|订单|票号|二维码|条[形]?码|\b(?:PNR|PASSENGER|PASSPORT|TICKET\s*(?:NO|NUMBER)|BOOKING\s*REF)\b/i;
const flightId = () => `f-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function sanitizeFlightRecord(item = {}, index = 0) {
  const clean = (value, max = 80) => {
    const result = flightText(value);
    return result.length <= max && !FLIGHT_SENSITIVE.test(result) ? result : "";
  };
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(flightText(value)) ? flightText(value) : "";
  const time = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(flightText(value)) ? flightText(value) : "";
  const short = value => /^[A-Z0-9 -]{1,12}$/i.test(flightText(value)) ? flightText(value).toUpperCase() : "";
  const number = normalizeFlightNumber(item.flightNumber);
  return {
    id: clean(item.id) || `flight-${index + 1}`,
    groupId: clean(item.groupId) || clean(item.imageKey) || clean(item.id) || `flight-${index + 1}`,
    shared: item.shared === true,
    legLabel: /^(去程|返程)$/.test(item.legLabel) ? item.legLabel : "",
    flightNumber: /^[A-Z0-9]{2}\d{3,4}$/.test(number) ? number : "",
    airline: clean(item.airline),
    departureDate: date(item.departureDate), arrivalDate: date(item.arrivalDate),
    dateHint: /^\d{2}-\d{2}$/.test(item.dateHint) ? item.dateHint : "",
    departureTime: time(item.departureTime), arrivalTime: time(item.arrivalTime),
    departureCode: /^[A-Z]{3}$/i.test(item.departureCode) ? item.departureCode.toUpperCase() : "",
    departureAirport: clean(item.departureAirport), departureTerminal: short(item.departureTerminal),
    arrivalCode: /^[A-Z]{3}$/i.test(item.arrivalCode) ? item.arrivalCode.toUpperCase() : "",
    arrivalAirport: clean(item.arrivalAirport), arrivalTerminal: short(item.arrivalTerminal),
    durationMinutes: Number.isInteger(item.durationMinutes) && item.durationMinutes > 0 && item.durationMinutes <= 2880 ? item.durationMinutes : null,
    seat: short(item.seat), gate: short(item.gate), baggageClaim: short(item.baggageClaim),
    connection: item.connection && typeof item.connection === "object" && !Array.isArray(item.connection) ? {
      airportCode: /^[A-Z]{3}$/i.test(item.connection.airportCode) ? item.connection.airportCode.toUpperCase() : "",
      airport: clean(item.connection.airport),
      durationMinutes: Number.isInteger(item.connection.durationMinutes) && item.connection.durationMinutes > 0 && item.connection.durationMinutes <= 10080 ? item.connection.durationMinutes : null
    } : null,
    detailUrl: safeFlightDetailUrl(item.detailUrl),
    // 旧版原图不自动视为已脱敏；记录仍留在管理入口，可重新上传。
    imageKey: clean(item.imageKey, 180), imageRedacted: item.imageRedacted === true
  };
}

function renderFlightConnection(connection) {
  if (!connection) return "";
  const airport = [connection.airportCode, connection.airport].filter(Boolean).join(" ") || "中转机场待核验";
  const minutes = connection.durationMinutes;
  const duration = minutes ? `停留${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}小时` : ""}${minutes % 60 ? `${minutes % 60}分` : ""}` : "停留时长待核验";
  return `<p class="flight-connection-note" data-flight-connection><strong>中转提醒</strong><span>${flightEscape(airport)} · ${duration}</span></p>`;
}

function renderFlightTicket(raw, index = 0, options = {}) {
  const item = sanitizeFlightRecord(raw, index);
  const hasImage = item.imageKey && item.imageRedacted;
  if (!hasImage && !item.detailUrl && !(item.shared && item.flightNumber && item.airline && item.departureAirport && item.arrivalAirport)) return "";
  const e = flightEscape;
  const date = item.departureDate || (item.dateHint ? `${item.dateHint}（年份待核验）` : "日期待核验");
  const dates = item.arrivalDate && item.arrivalDate !== item.departureDate ? `${date} → ${item.arrivalDate}` : date;
  const airport = (code, name, terminal) => [code, name, terminal && !name.includes(terminal) ? terminal : ""].filter(Boolean).join(" ") || "机场待核验";
  const duration = item.durationMinutes ? `${Math.floor(item.durationMinutes / 60)}小时${item.durationMinutes % 60 ? `${item.durationMinutes % 60}分` : ""}` : "";
  const extras = [["座位", item.seat], ["登机口", item.gate], ["行李提取转盘", item.baggageClaim]].filter(([,value]) => value);
  const actions = options.showActions !== false && hasImage ? `<div class="flight-ticket-actions"><button type="button" class="flight-view" data-flight-view="${e(item.id)}">查看图片</button></div>` : "";
  return `<article class="flight-ticket-card" data-flight-card><header><b>${e(item.legLabel || `第 ${index + 1} 程`)}</b><span class="flight-date">${e(dates)}</span></header><div class="flight-airline"><div class="flight-identity"><span class="flight-airline-name">${e(item.airline || "航司待核验")}</span><strong class="flight-number">${e(item.flightNumber || "航班待核验")}</strong></div>${duration ? `<span class="flight-duration">${e(duration)}</span>` : ""}</div>${extras.length ? `<div class="flight-extras">${extras.map(([label,value]) => `<span class="flight-extra"><span class="flight-extra-label" title="${label}">${label === "行李提取转盘" ? "转盘" : label}</span> <strong>${e(value)}</strong></span>`).join("")}</div>` : ""}<div class="flight-route"><div><strong>${e(item.departureTime || "--:--")}</strong><span>${e(airport(item.departureCode,item.departureAirport,item.departureTerminal))}</span></div><span class="flight-route-line" aria-hidden="true">→</span><div><strong>${e(item.arrivalTime || "--:--")}</strong><span>${e(airport(item.arrivalCode,item.arrivalAirport,item.arrivalTerminal))}</span></div></div>${actions}${renderFlightConnection(item.connection)}</article>`;
}

function renderFlightManageLink(records = []) {
  const url = records.map(item => safeFlightDetailUrl(item.detailUrl)).find(Boolean);
  return url ? `<a class="flight-view" data-flight-link-view href="${flightEscape(url)}" target="_blank" rel="noopener noreferrer">打开购票链接</a>` : "";
}

function renderFlightRecords(flights = []) {
  const records = flights.map((item, index) => sanitizeFlightRecord({ ...item, imageKey: "", imageRedacted: false }, index));
  const cards = records.map(renderFlightTicket).join("");
  const seed = JSON.stringify(records).replace(/</g, "\\u003c");
  return `<article class="flight-records" data-flight-records><div class="flight-records-head"><h3>已购机票</h3><button type="button" class="flight-action" data-flight-manage aria-expanded="false" aria-controls="flight-records-editor">${records.length ? "管理凭证" : "录入凭证"}</button></div><div class="flight-records-list" data-flight-list>${cards || (!records.length ? '<p class="flight-empty">尚未录入机票凭证</p>' : '')}</div><div class="flight-records-editor" id="flight-records-editor" data-flight-editor hidden><div class="flight-source-actions" data-flight-source-actions>${renderFlightManageLink(records)}</div><p class="flight-replace-hint">保存新的图片或链接后，将覆盖当前全部机票记录。</p><form data-flight-form><div class="flight-source-row"><label class="flight-upload-action">上传机票图片<input type="file" accept="image/jpeg,image/png,image/webp" data-flight-file></label><span data-flight-image-label>未选择图片</span><label class="flight-link-field">购票软件链接<input type="url" inputmode="url" placeholder="https://…" data-flight-link></label></div><div class="flight-redaction" data-flight-redaction hidden><p>图片仅在本机处理。请拖动遮盖姓名、证件、订单号、票号、PNR、二维码及条码；确认后才识别、保存，不自动保证脱敏完整。</p><canvas data-flight-redact-canvas aria-label="拖动以遮盖图片中的敏感信息"></canvas><div class="flight-form-actions"><button type="button" data-flight-redact-all>遮盖整图</button><button type="button" data-flight-redact-confirm>已完成脱敏，识别此图</button></div></div><div class="flight-form-actions"><button type="button" data-flight-cancel>取消</button><button type="submit">保存凭证</button></div></form></div><p class="flight-records-status" data-flight-status role="status" aria-live="polite"></p><dialog class="flight-viewer" data-flight-viewer><div><img data-flight-view-image alt="脱敏后的机票图片"><button type="button" data-flight-view-close>关闭</button></div></dialog><script type="application/json" data-flight-seed>${seed}<\/script></article>`;
}

function normalizeFlightNumber(value) {
  return flightText(value).toUpperCase().replace(/\s+/g, "");
}

function safeFlightDetailUrl(value) {
  const raw = flightText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    // Inspect paths, nested parameters and SPA fragments as well as query keys.
    let decoded = raw;
    for (let i = 0; i < 3; i++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; }
    if (/%[0-9a-f]{2}|[\s\\]/i.test(decoded) || /pnr|passenger|passport|ticket[-_ ]?(?:no|number)|order[-_ ]?(?:id|no|number)|booking[-_ ]?(?:ref|reference)|姓名|证件|订单|票号|乘机人/i.test(decoded)) return "";
    return url.href;
  } catch (_error) { return ""; }
}

function flightOcrRows(items = []) {
  return items.map((item) => {
    const poly = Array.isArray(item?.poly) ? item.poly : [];
    const xs = poly.map((point) => Number(point?.[0])).filter(Number.isFinite);
    const ys = poly.map((point) => Number(point?.[1])).filter(Number.isFinite);
    return {
      text: flightText(item?.text),
      score: Number(item?.score || 0),
      x: xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0,
      y: ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0,
      height: ys.length ? Math.max(...ys) - Math.min(...ys) : 0
    };
  }).filter((item) => item.text && item.score >= 0.45 && !FLIGHT_SENSITIVE.test(item.text));
}

function parseFlightSegment(rows = []) {
  const joined = rows.map((item) => item.text).join("\n");
  const fields = {};
  const flightNumber = joined.toUpperCase().match(/\b(?=[A-Z0-9]{5,7}\b)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{2}\s?\d{3,4}\b/)?.[0];
  if (flightNumber) fields.flightNumber = normalizeFlightNumber(flightNumber);
  const airlineRow = rows.find((item) => fields.flightNumber && normalizeFlightNumber(item.text).includes(fields.flightNumber))
    || rows.find((item) => /(?:航空|AIRLINES?|AIRWAYS?)/i.test(item.text));
  if (airlineRow) {
    const beforeNumber = fields.flightNumber ? airlineRow.text.split(new RegExp(fields.flightNumber, "i"))[0] : airlineRow.text;
    const airline = beforeNumber.replace(/[^\p{L}·]+/gu, " ").trim();
    if (airline) fields.airline = airline;
  }
  const fullDates = [...joined.matchAll(/\b(20\d{2})[年\/.-](\d{1,2})[月\/.-](\d{1,2})日?/g)];
  const formatDate = match => `${match[1]}-${String(match[2]).padStart(2,"0")}-${String(match[3]).padStart(2,"0")}`;
  if (fullDates.length) {
    fields.departureDate = formatDate(fullDates[0]);
    if (fullDates[1]) fields.arrivalDate = formatDate(fullDates[1]);
    else {
      const dayOffset = joined.match(/\+\s*(\d)\s*(?:天|日)|次日/);
      if (dayOffset) {
        const date = new Date(fields.departureDate + "T00:00:00Z");
        date.setUTCDate(date.getUTCDate() + Number(dayOffset[1] || 1));
        fields.arrivalDate = date.toISOString().slice(0,10);
      }
    }
  }
  else {
    const shortDate = joined.match(/\b(\d{1,2})月(\d{1,2})日/);
    if (shortDate) fields.dateHint = `${String(shortDate[1]).padStart(2, "0")}-${String(shortDate[2]).padStart(2, "0")}`;
  }
  const times = rows.flatMap((row) => [...row.text.matchAll(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g)]
    .map((match) => ({ ...row, time: match[0].padStart(5, "0") })))
    .sort((a, b) => (b.height - a.height) || (a.y - b.y)).slice(0, 2).sort((a, b) => a.y - b.y || a.x - b.x);
  if (times[0]) fields.departureTime = times[0].time;
  if (times[1]) fields.arrivalTime = times[1].time;
  const airportRows = rows.map((row) => {
    if (row === airlineRow || /航空|airlines?|airways?|航班|flight|座位|登机口|转盘|duration/i.test(row.text) || /\b[A-Z0-9]{2}\s?\d{3,4}\b/i.test(row.text)) return null;
    const code = row.text.toUpperCase().match(/\b[A-Z]{3}\b/)?.[0];
    if (!code) return null;
    if (!/机场|airport|aerodrome|出发|到达|departure|arrival/i.test(row.text) && !/^\s*[A-Z]{3}(?:\s+T\d+)?\s*$/i.test(row.text)) return null;
    const airport = row.text.replace(new RegExp(`\\b${code}\\b`, "i"), "").replace(/[>›|]+/g, " ").trim();
    return { ...row, code, airport };
  }).filter(Boolean).sort((a, b) => a.y - b.y);
  if (airportRows[0]) {
    fields.departureCode = airportRows[0].code;
    fields.departureAirport = airportRows[0].airport;
  }
  if (airportRows[1]) {
    fields.arrivalCode = airportRows[1].code;
    fields.arrivalAirport = airportRows[1].airport;
  }
  fields.legLabel = joined.match(/去程|返程/)?.[0] || "";
  const durationRow = rows.find(row => /(?:飞行|飞行时长|航程|duration)/i.test(row.text) && !/中转|停留/.test(row.text));
  const duration = durationRow?.text.match(/(?:(\d{1,2})\s*(?:小时|h))\s*(?:(\d{1,2})\s*(?:分钟?|m))?/i);
  if (duration) fields.durationMinutes = Number(duration[1]) * 60 + Number(duration[2] || 0);
  for (const [key,pattern] of [
    ["seat", /(?:座位(?:号)?|seat)\s*[:：]?\s*([0-9]{1,3}[A-Z])\b/i],
    ["gate", /(?:登机口|gate)\s*[:：]?\s*([A-Z]?\d{1,3}[A-Z]?)\b/i],
    ["baggageClaim", /(?:行李(?:提取)?转盘|baggage\s*claim|carousel)\s*[:：]?\s*([A-Z]?\d{1,3})\b/i]
  ]) fields[key] = joined.match(pattern)?.[1] || "";
  return fields;
}

function parseFlightConnection(text) {
  if (!/(?:中转|转机|\blayover\b|\btransit\b)/i.test(text) || /直飞|无需|无须|不需|无中转|非中转|0\s*次中转|建议|至少|最少|可能|须知|注意|如需|nonstop|no\s+(?:layover|transit)/i.test(text)) return null;
  // 仅提取明确中转行的白名单字段，不持久化备注原文或自动计算两地时差。
  const airportCode = text.match(/\b[A-Z]{3}\b/)?.[0] || "";
  const airport = text.replace(/中转|转机|停留|机场[:：]/g, " ").match(/[\u4e00-\u9fff]{2,24}机场/)?.[0] || "";
  const timeText = text.split(/中转|转机|\blayover\b|\btransit\b/i).at(-1);
  const hours = timeText.match(/(\d{1,3})\s*(?:小时|hours?|hrs?|h)(?![a-z])/i);
  const mins = timeText.match(/(\d{1,2})\s*(?:分钟?|minutes?|mins?|m)(?![a-z])/i);
  const durationMinutes = (hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0);
  if (!airportCode && !airport && !durationMinutes && !/^\s*(?:中转|转机|layover|transit)\s*$/i.test(text)) return null;
  return { airportCode, airport, durationMinutes: durationMinutes > 0 && durationMinutes <= 10080 ? durationMinutes : null };
}

function flightOcrCandidates(items = []) {
  const rows = flightOcrRows(items);
  const connections = rows.map(row => ({ row, connection: parseFlightConnection(row.text) })).filter(item => item.connection);
  const segmentRows = rows.filter(row => !connections.some(item => item.row === row));
  const anchors = rows.map((row) => ({
    row,
    number: normalizeFlightNumber(row.text.match(/\b(?=[A-Z0-9]{5,7}\b)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{2}\s?\d{3,4}\b/i)?.[0])
  })).filter((item) => item.number).sort((a, b) => a.row.y - b.row.y);
  const uniqueAnchors = anchors.filter((item, index) => !index || item.number !== anchors[index - 1].number || Math.abs(item.row.y - anchors[index - 1].row.y) > 80);
  if (uniqueAnchors.length <= 1) {
    const parsed = parseFlightSegment(segmentRows);
    if (connections.length === 1) parsed.connection = connections[0].connection;
    return Object.keys(parsed).length ? [parsed] : [];
  }
  return uniqueAnchors.map((anchor, index) => {
    const previousY = index ? uniqueAnchors[index - 1].row.y : rows[0]?.y || 0;
    const nextY = index + 1 < uniqueAnchors.length ? uniqueAnchors[index + 1].row.y : rows.at(-1)?.y || anchor.row.y;
    const before = connections.filter(item => item.row.y > previousY && item.row.y < anchor.row.y);
    const after = connections.filter(item => item.row.y > anchor.row.y && (index + 1 === uniqueAnchors.length || item.row.y < nextY));
    const start = index ? (before.length === 1 ? before[0].row.y : (previousY + anchor.row.y) / 2) : -Infinity;
    const end = after.length === 1 ? after[0].row.y : index + 1 < uniqueAnchors.length ? (anchor.row.y + nextY) / 2 : Infinity;
    const parsed = parseFlightSegment(segmentRows.filter((row) => row.y >= start && row.y < end));
    if (after.length === 1) parsed.connection = after[0].connection;
    parsed.flightNumber = anchor.number;
    return parsed;
  }).filter((item) => item.flightNumber);
}

function flightOcrFields(items = []) {
  return flightOcrCandidates(items)[0] || {};
}

async function recognizeFlightTicket(file, options = {}) {
  if (global.location?.protocol === "file:") throw new Error("图片识别需要通过 HTTP 或 HTTPS 页面访问");
  if (!flightOcrPromise) {
    flightOcrPromise = import(FLIGHT_OCR_MODULE_URL).then(({ PaddleOCR }) => PaddleOCR.create({
      lang: "ch",
      ocrVersion: "PP-OCRv5",
      worker: false,
      ortOptions: { backend: "wasm", wasmPaths: FLIGHT_OCR_WASM_URL, numThreads: 2, simd: true }
    })).catch((error) => { flightOcrPromise = null; throw error; });
  }
  options.onStatus?.("正在本机识别，请稍候…");
  const ocr = await flightOcrPromise;
  let timer = 0;
  const timeout = new Promise((_, reject) => { timer = global.setTimeout(() => reject(new Error("图片识别超时，请重试或仅保存脱敏图片。")), FLIGHT_OCR_TIMEOUT_MS); });
  const [result] = await Promise.race([ocr.predict(file, { textRecScoreThresh: 0.45 }), timeout]).finally(() => global.clearTimeout(timer));
  return flightOcrCandidates(result?.items || []);
}

function openFlightImageDb() {
  return new Promise((resolve, reject) => {
    const request = global.indexedDB.open(FLIGHT_IMAGE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("images")) request.result.createObjectStore("images");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地图片存储"));
  });
}

async function putFlightImage(key, blob) {
  const db = await openFlightImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").put(blob, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error("图片保存失败")); };
  });
}

async function getFlightImage(key) {
  const db = await openFlightImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readonly");
    const request = tx.objectStore("images").get(key);
    request.onsuccess = () => { db.close(); resolve(request.result || null); };
    request.onerror = () => { db.close(); reject(request.error || new Error("图片读取失败")); };
  });
}

async function deleteFlightImage(key) {
  const db = await openFlightImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error("图片删除失败")); };
  });
}

function initFlightRecords(options = {}) {
  const root = options.root || document;
  const card = root.querySelector("[data-flight-records]");
  if (!card || card.dataset.flightReady === "true") return;
  const guideId = root.body?.dataset?.guideId || global.location?.pathname || "guide";
  const storageKey = `travel-guide-flight-records:${guideId}`;
  const seed = readJsonIndex("[data-flight-seed]", root);
  const query = selector => card.querySelector(selector);
  const list = query("[data-flight-list]"), manage = query("[data-flight-manage]");
  const editor = query("[data-flight-editor]"), form = query("[data-flight-form]");
  const fileInput = query("[data-flight-file]"), linkInput = query("[data-flight-link]");
  const sourceActions = query("[data-flight-source-actions]");
  const viewer = query("[data-flight-viewer]"), viewerImage = query("[data-flight-view-image]");
  const redaction = query("[data-flight-redaction]"), canvas = query("[data-flight-redact-canvas]");
  const recognize = options.recognize || recognizeFlightTicket;
  const images = options.imageStore || { put: putFlightImage, get: getFlightImage, delete: deleteFlightImage };
  let items = [], pendingBlob = null, candidates = [], epoch = 0;
  let loading = false, saving = false, needsRedaction = false, viewerUrl = "", drag = null;
  const setStatus = (message, kind = "") => {
    query("[data-flight-status]").textContent = message;
    query("[data-flight-status]").dataset.state = kind;
  };
  let stored;
  try { stored = global.localStorage.getItem(storageKey); } catch (_) {}
  try { items = (stored !== null && stored !== undefined ? JSON.parse(stored) : seed || []).map(sanitizeFlightRecord); }
  catch (_) { items = Array.isArray(seed) ? seed.map(sanitizeFlightRecord) : []; }
  const persist = next => {
    try { global.localStorage.setItem(storageKey, JSON.stringify(next)); return true; }
    catch (_) { setStatus("保存失败，本次修改尚未写入浏览器。", "error"); return false; }
  };
  const clearPending = () => {
    epoch++; pendingBlob = null; candidates = []; loading = false; needsRedaction = false;
    fileInput.value = ""; redaction.hidden = true; canvas.width = 0; canvas.height = 0;
    query("[data-flight-image-label]").textContent = "未选择图片";
    query("[data-flight-preview]")?.remove();
  };
  const fill = () => {
    clearPending();
    const item = items[0];
    linkInput.value = "";
    if (item?.imageKey && !item.imageRedacted) setStatus("旧图片尚未确认脱敏，请重新上传后确认；原有记录未删除。", "info");
    else if (item && !item.imageKey && !item.detailUrl) setStatus("此航段尚无凭证，请补充图片或链接。", "info");
    else setStatus("");
  };
  const render = () => {
    list.innerHTML = items.map(renderFlightTicket).join("") || (!items.length ? '<p class="flight-empty">尚未录入机票凭证</p>' : "");
    manage.textContent = items.length ? "管理凭证" : "录入凭证";
    sourceActions.innerHTML = renderFlightManageLink(items);
  };
  const openEditor = open => {
    if (saving) return;
    editor.hidden = !open; manage.setAttribute("aria-expanded", String(open));
    if (open) { fill(); render(); }
    else clearPending();
  };
  manage.addEventListener("click", () => openEditor(editor.hidden));
  query("[data-flight-cancel]").addEventListener("click", () => { if (!saving) { openEditor(false); setStatus(""); } });
  linkInput.addEventListener("input", () => {
    if (linkInput.value && !safeFlightDetailUrl(linkInput.value)) setStatus("仅支持不含登录凭据或敏感订单参数的 HTTPS 链接。", "error");
  });
  fileInput.addEventListener("change", async () => {
    if (saving) return;
    const file = fileInput.files?.[0];
    if (!file) return;
    clearPending();
    if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setStatus("请选择不超过 10MB 的 JPEG、PNG 或 WebP 图片。", "error"); return;
    }
    needsRedaction = true; loading = true;
    const ticket = epoch;
    const url = global.URL.createObjectURL(file);
    const img = new global.Image();
    try {
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error("图片读取失败")); img.src = url; });
      if (ticket !== epoch) return;
      if (!img.naturalWidth || img.naturalWidth * img.naturalHeight > 40000000) throw new Error("图片像素过大，请先裁剪");
      const ratio = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * ratio); canvas.height = Math.round(img.naturalHeight * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("当前浏览器不支持图片脱敏");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      redaction.hidden = false;
      query("[data-flight-image-label]").textContent = "图片待脱敏确认（尚未保存）";
      setStatus("请遮盖敏感信息后确认。识别不会上传图片，首次使用需下载识别组件。", "info");
    } catch (error) { if (ticket === epoch) { needsRedaction = false; setStatus(error.message, "error"); } }
    finally { global.URL.revokeObjectURL(url); img.src = ""; if (ticket === epoch) loading = false; }
  });
  const point = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)) };
  };
  canvas.addEventListener("pointerdown", event => {
    if (loading || saving || !needsRedaction) return;
    drag = point(event); canvas.setPointerCapture?.(event.pointerId); event.preventDefault();
  });
  canvas.addEventListener("pointerup", event => {
    if (!drag) return;
    const end = point(event), ctx = canvas.getContext("2d");
    ctx.fillStyle = "#123b45";
    ctx.fillRect(Math.min(drag.x,end.x), Math.min(drag.y,end.y), Math.max(8,Math.abs(end.x-drag.x)), Math.max(8,Math.abs(end.y-drag.y)));
    drag = null;
  });
  canvas.addEventListener("pointercancel", () => { drag = null; });
  query("[data-flight-redact-all]").addEventListener("click", () => {
    if (loading || saving || !needsRedaction) return;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#123b45"; ctx.fillRect(0,0,canvas.width,canvas.height);
  });
  query("[data-flight-redact-confirm]").addEventListener("click", async () => {
    if (loading || saving || !needsRedaction || !canvas.width) return;
    loading = true;
    const ticket = epoch;
    try {
      const blob = await new Promise((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("脱敏图片生成失败")), "image/png"));
      if (ticket !== epoch) return;
      // 只将重新编码、经用户确认的像素交给 OCR 和持久化，不保留原始文件或其元数据。
      pendingBlob = blob; needsRedaction = false; redaction.hidden = true; canvas.width = 0; canvas.height = 0;
      const recognized = await recognize(blob, { onStatus: message => { if (ticket === epoch) setStatus(message, "loading"); } });
      if (ticket !== epoch) return;
      candidates = recognized.map(sanitizeFlightRecord);
      setStatus(candidates.length ? `识别到 ${candidates.length} 个航段；保存前请核对下方预览。` : "未识别到航段；仍可保存脱敏图片，未知信息不自动补写。", "info");
    } catch (error) { if (ticket === epoch) { candidates = []; setStatus("识别未完成，可保存已确认脱敏的图片或改用链接。", "info"); } }
    finally {
      if (ticket === epoch) {
        loading = false;
        query("[data-flight-image-label]").textContent = pendingBlob ? "脱敏图片已就绪（尚未保存）" : "图片未就绪";
        let preview = query("[data-flight-preview]");
        if (!preview) { preview = root.createElement ? root.createElement("div") : document.createElement("div"); preview.dataset.flightPreview = ""; form.append(preview); }
        preview.innerHTML = candidates.map((item,i) => renderFlightTicket({...item, detailUrl:"", imageKey:"preview", imageRedacted:true}, i, { showActions: false })).join("");
      }
    }
  });
  const cleanup = async (previous, next) => {
    const retained = new Set(next.map(item => item.imageKey).filter(Boolean));
    for (const key of new Set(previous.map(item => item.imageKey).filter(Boolean))) {
      if (!retained.has(key)) await images.delete(key);
    }
  };
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (loading || saving || needsRedaction) { setStatus("请先完成图片脱敏确认与识别。", "info"); return; }
    const detailUrl = safeFlightDetailUrl(linkInput.value);
    if (linkInput.value && !detailUrl) { setStatus("仅支持不含登录凭据或敏感订单参数的 HTTPS 链接。", "error"); return; }
    const previous = items, group = flightId();
    if (!pendingBlob && !detailUrl) {
      setStatus("请上传并确认脱敏图片，或填写购票软件链接。", "error"); return;
    }
    saving = true;
    let newImageKey = "";
    try {
      let additions;
      if (pendingBlob) {
        newImageKey = `${guideId}:${flightId()}`;
        await images.put(newImageKey, pendingBlob);
        additions = (candidates.length ? candidates : [{}]).map((item,index) => sanitizeFlightRecord({
          ...item, id: flightId(), groupId: group, detailUrl, imageKey: newImageKey, imageRedacted: true
        }, index));
      } else {
        additions = [sanitizeFlightRecord({ id:flightId(), groupId:group, detailUrl })];
      }
      const next = additions;
      if (!persist(next)) { if (newImageKey) await images.delete(newImageKey); return; }
      items = next; clearPending(); editor.hidden = true; manage.setAttribute("aria-expanded","false");
      query("[data-flight-preview]")?.remove(); render(); setStatus(previous.length ? "新凭证已保存，并覆盖旧记录。" : "凭证已保存在当前浏览器。", "success");
      // 只发送已清洗的航班执行信息；imageKey 与图片像素始终留在本机。
      document.dispatchEvent(new CustomEvent("guide:flight-records-save", { detail: { records: items.map(item => ({ ...sanitizeFlightRecord(item), imageKey: "", imageRedacted: false })) } }));
      try { await cleanup(previous, next); } catch (_) { setStatus("凭证已保存；旧图片清理失败，请检查浏览器存储。", "error"); }
    } catch (_) { setStatus("图片无法保存到当前浏览器，本次修改未完成。", "error"); }
    finally { saving = false; }
  });
  const closeViewer = () => {
    if (viewer.open && typeof viewer.close === "function") viewer.close(); else viewer.removeAttribute("open");
    viewerImage.removeAttribute("src");
    if (viewerUrl) global.URL.revokeObjectURL(viewerUrl);
    viewerUrl = "";
  };
  list.addEventListener("click", async event => {
    const button = event.target.closest("[data-flight-view]");
    if (!button) return;
    const item = items.find(entry => entry.id === button.dataset.flightView);
    if (!item?.imageKey || !item.imageRedacted) return;
    try {
      const blob = await images.get(item.imageKey);
      if (!blob) throw new Error("图片不存在");
      closeViewer(); viewerUrl = global.URL.createObjectURL(blob); viewerImage.src = viewerUrl;
      if (typeof viewer.showModal === "function") viewer.showModal(); else viewer.setAttribute("open","");
    } catch (_) { setStatus("图片暂时无法读取，请从管理凭证重新上传。","error"); }
  });
  query("[data-flight-view-close]").addEventListener("click", closeViewer);
  viewer.addEventListener("click", event => { if (event.target === viewer) closeViewer(); });
  viewer.addEventListener("cancel", closeViewer);
  viewer.addEventListener("close", () => { viewerImage.removeAttribute("src"); if(viewerUrl)global.URL.revokeObjectURL(viewerUrl); viewerUrl=""; });
  document.addEventListener("guide:flight-records-remote", event => {
    const records = Array.isArray(event.detail?.records) ? event.detail.records : [];
    const local = new Map(items.map(item => [item.id, item]));
    const remoteIds = new Set(records.map(record => record.id));
    const localOnly = items.filter(item => item.shared !== true && !remoteIds.has(item.id));
    items = records.map((record, index) => {
      const previous = local.get(record.id) || {};
      return sanitizeFlightRecord({ ...record, shared: true, imageKey: previous.imageKey || "", imageRedacted: previous.imageRedacted === true }, index);
    }).concat(localOnly);
    if (!persist(items)) { render(); return; }
    render();
    setStatus(localOnly.length ? `已收到其他设备保存的航班信息；${localOnly.length} 条本机未同步记录已保留。` : "已收到其他设备保存的航班信息；机票图片仍仅在原设备。", "success");
  });
  document.addEventListener("guide:flight-records-sync-status", event => {
    setStatus(event.detail?.message || "", event.detail?.state || "");
  });
  card.dataset.flightReady = "true";
  render();
  return { render, openEditor, flightOcrFields, flightOcrCandidates };
}

if (typeof module === "object" && module.exports) {
  module.exports = { renderFlightRecords, renderFlightTicket, sanitizeFlightRecord, safeFlightDetailUrl, flightOcrCandidates };
}
