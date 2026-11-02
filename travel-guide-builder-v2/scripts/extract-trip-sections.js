#!/usr/bin/env node
/**
 * extract-trip-sections.js — 增量修改的上下文节约工具。
 * 提取 trip-data.json 的指定天或顶层模块片段供 AI 阅读；--apply 把修改后的片段安全写回。
 * 设计目标：改一处行程不需要把 150KB 全量 JSON 读进上下文。
 *
 * 用法：
 *   提取：node extract-trip-sections.js <trip-data.json> [--days=1,3] [--items=itemId1,itemId2] [--module=transport,budget]
 *   写回：node extract-trip-sections.js <trip-data.json> --days=3 --patch-file=patch.json --apply
 *
 * 写回安全边界：
 *   - --days=N 时 patch.days 只允许包含 dayNumber=N 的天；--items 时只允许合并声明的 item ID，同天其他条目保持不变；
 *   - --module 只允许写回声明的模块；--module=days 被禁止（days 必须走 --days 逐日边界）；
 *   - 未声明 --days/--module 的 patch 拒绝执行（防止把提取阶段的 _dayNumbers 误当 patch）；
 *   - 先写临时文件 → 校验（结构一致性 + JSON 可解析）→ 原子替换原文件；任一步失败原文件保持不变。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { readOption, readCsvOption } = require("./cli-options.js");
const { validateTripData } = require("./validate-trip-data.js");

const MODULE_KEYS = ["meta", "features", "calendar", "arrivalDeparture", "places", "route", "days", "nearbyDays", "transport", "budget", "recommendations", "recommendationNotes", "venueSuggestions", "recommendationPlacements", "localKnowledge", "checklist", "bookingLedger", "weather", "researchAudit", "sources", "sourceIndex"];
const PATCHABLE_MODULES = MODULE_KEYS.filter((key) => key !== "days");
const PATCH_META_KEYS = new Set(["_dayNumbers"]);
const USAGE = "Usage: node extract-trip-sections.js <trip-data.json> [--days=1,3] [--items=id1,id2] [--module=transport] [--patch-file=patch.json --apply]";

function parseArgs(args) {
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const days = readCsvOption(args, "days");
  const modules = readCsvOption(args, "module");
  const items = readCsvOption(args, "items");
  const patchFile = readOption(args, "patch-file");
  const apply = args.includes("--apply");
  const out = readOption(args, "out");
  return { file: positional[0], days, modules, items, patchFile, apply, out, usage: positional.length !== 1 };
}

function selectDays(data, daySpecs) {
  if (!daySpecs) return [];
  const wanted = new Set();
  daySpecs.forEach((spec) => {
    const range = spec.match(/^(\d+)-(\d+)$/);
    if (range) {
      for (let n = Number(range[1]); n <= Number(range[2]); n += 1) wanted.add(n);
    } else wanted.add(Number(spec));
  });
  return data.days.filter((day) => wanted.has(Number(day.dayNumber)));
}

function filterItems(day, itemIds) {
  if (!itemIds) return day;
  const ids = new Set(itemIds.map((value) => value.trim()).filter(Boolean));
  return { ...day, items: (day.items || []).filter((item) => ids.has(item.id)) };
}

function extractSections(data, options) {
  const result = {};
  const selectedDays = selectDays(data, options.days);
  if (selectedDays.length) {
    result.days = selectedDays.map((day) => filterItems(day, options.items));
    result._dayNumbers = selectedDays.map((day) => day.dayNumber);
  }
  (options.modules || []).forEach((key) => {
    if (key === "days") throw new Error("days 不支持 --module 提取；请使用 --days=<N> 逐日提取，以保留逐日写回边界。");
    if (!MODULE_KEYS.includes(key)) throw new Error(`未知模块：${key}。合法模块：${PATCHABLE_MODULES.join(", ")}`);
    result[key] = data[key];
  });
  return result;
}

function stripPatchMeta(patch) {
  const clean = {};
  for (const key of Object.keys(patch)) {
    if (!PATCH_META_KEYS.has(key)) clean[key] = patch[key];
  }
  return clean;
}

/* 计算写回范围声明：patch 里的 days 由 dayNumber 决定，模块由键名决定。 */
function patchScope(patch) {
  const dayNumbers = Array.isArray(patch.days) ? patch.days.map((day) => Number(day?.dayNumber)) : [];
  const modules = Object.keys(patch).filter((key) => key !== "days");
  return { dayNumbers, modules };
}

function applyPatch(data, patch, options = {}) {
  const clean = stripPatchMeta(patch);
  const scope = patchScope(clean);
  if (!scope.dayNumbers.length && !scope.modules.length) throw new Error("patch 为空或只含元数据；拒绝执行。");
  const declaredDaySet = options.days ? new Set(selectDays(data, options.days).map((day) => Number(day.dayNumber))) : null;
  const declaredModules = options.modules && options.modules.length ? new Set(options.modules) : null;
  if (declaredModules && declaredModules.has("days")) throw new Error("--module=days 被禁止；days 写回必须使用 --days=<N> 逐日边界。");
  const next = structuredClone(data);
  const touched = [];

  /* days：只允许 patch 声明范围内且命令声明范围内的天。 */
  if (Array.isArray(clean.days)) {
    if (declaredModules && !declaredModules.has("days") && !declaredDaySet) throw new Error("patch 含 days，但命令未声明 --days=<N>；逐日写回必须声明范围。");
    if (!declaredDaySet) throw new Error("patch 含 days 但未声明 --days=<N>；拒绝越权写回。");
    const byNumber = new Map(next.days.map((day) => [Number(day.dayNumber), day]));
    clean.days.forEach((incoming, index) => {
      const dayNumber = Number(incoming?.dayNumber);
      if (!Number.isInteger(dayNumber)) throw new Error(`patch.days[${index}] 缺少有效 dayNumber。`);
      if (!declaredDaySet.has(dayNumber)) throw new Error(`patch.days[${index}] 的 dayNumber=${dayNumber} 超出 --days 声明范围；拒绝越权写回。`);
      const existing = byNumber.get(dayNumber);
      if (!existing) throw new Error(`patch.days[${index}] 的 dayNumber=${dayNumber} 不存在于当前数据。`);
      const isItemScoped = Array.isArray(options.items) && options.items.length > 0;
      if (isItemScoped) {
        /* --items 场景：按稳定 ID 合并条目，绝不用筛选后的数组替换完整 items；不做全字段守卫（patch 是提取片段的子集）。 */
        const declaredIds = new Set(options.items.map((value) => value.trim()).filter(Boolean));
        const extractedIds = new Set((existing.items || []).filter((item) => declaredIds.has(item.id)).map((item) => item.id));
        const patchItems = incoming.items || [];
        const patchIds = new Set(patchItems.map((item) => item.id));
        for (const item of patchItems) {
          if (!extractedIds.has(item.id)) throw new Error(`patch.days[${index}].items 含未提取的条目 ${item.id}；--items 写回只允许修改提取过的条目。`);
        }
        if (Array.isArray(existing.items) && existing.items.length) {
          const missing = [...extractedIds].filter((id) => !patchIds.has(id));
          if (missing.length) throw new Error(`patch.days[${index}].items 缺少已提取条目 ${missing.join("、")}；--items 写回不得删除同天其他行程。`);
        }
        existing.items = (existing.items || []).map((item) => patchIds.has(item.id) ? patchItems.find((candidate) => candidate.id === item.id) : item);
      } else {
        const before = Object.keys(existing).sort().join(",");
        const after = Object.keys(incoming).sort().join(",");
        if (before !== after) throw new Error(`day ${dayNumber} 的顶层字段集合不一致（${before} → ${after}）；--apply 只允许修改字段值，不允许增删顶层字段。`);
        for (const key of Object.keys(incoming)) existing[key] = incoming[key];
      }
      touched.push(`days[dayNumber=${dayNumber}]${isItemScoped ? "（按条目合并）" : ""}`);
    });
  }

  /* 非 days 模块：必须声明 --module 且只允许声明过的模块。 */
  scope.modules.forEach((key) => {
    if (!PATCHABLE_MODULES.includes(key)) throw new Error(`patch 含不可写回模块：${key}。`);
    if (!declaredModules || !declaredModules.has(key)) throw new Error(`patch 写入 ${key} 超出 --module 声明范围；模块写回必须通过 --module=<名称> 显式声明。`);
    if (declaredModules.has("days")) throw new Error("--module=days 被禁止；days 写回必须使用 --days=<N>。");
    next[key] = clean[key];
    touched.push(key);
  });

  return { next, touched };
}

/* 写回前校验：字段集合守卫已在 applyPatch 内；这里做整体 JSON 完整性 + 可选结构抽查。 */
function validateResult(next, previous) {
  JSON.parse(JSON.stringify(next));
  const before = Object.keys(previous).sort().join(",");
  const after = Object.keys(next).sort().join(",");
  const newlyAdded = Object.keys(next).filter(key => !Object.prototype.hasOwnProperty.call(previous, key));
  const removed = Object.keys(previous).filter(key => !Object.prototype.hasOwnProperty.call(next, key));
  if (before !== after && (removed.length || newlyAdded.some(key => key !== "nearbyDays"))) throw new Error(`写回后顶层键集合变化（${before} → ${after}）；拒绝落盘。`);
  if (Array.isArray(previous.days) !== Array.isArray(next.days) || (Array.isArray(next.days) && next.days.length !== previous.days.length)) {
    throw new Error("写回后天数变化；--apply 不允许增删天。");
  }
}

function main(cliArgs = process.argv.slice(2)) {
  const options = parseArgs(cliArgs);
  if (options.usage || !options.file) { console.error(USAGE); process.exit(2); }
  const file = path.resolve(options.file);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));

  if (!options.apply) {
    const sections = extractSections(data, options);
    if (!Object.keys(sections).length) { console.error(USAGE); process.exit(2); }
    const text = JSON.stringify(sections, null, 2);
    if (options.out) { fs.writeFileSync(path.resolve(options.out), text + "\n", "utf8"); console.log(`已写出 ${path.resolve(options.out)}（${(text.length / 1024).toFixed(1)}K）`); }
    else process.stdout.write(text);
    return;
  }

  if (!options.patchFile) { console.error("--apply 需要 --patch-file=<修改后的片段 JSON>"); process.exit(2); }
  const patch = JSON.parse(fs.readFileSync(path.resolve(options.patchFile), "utf8"));
  const { next, touched } = applyPatch(data, patch, options);
  validateResult(next, data);
  const allowPaths = [...(options.modules || []), ...selectDays(data, options.days).map(day => `days[${data.days.indexOf(day)}]`)];
  const contentValidation = validateTripData(next, { stage: "content", baseline: data, allowPaths });
  if (!contentValidation.valid) {
    console.error(`内容校验失败，原文件未改动：\n- ${contentValidation.failures.join("\n- ")}`);
    process.exit(1);
  }
  /* 原子替换：先写同目录临时文件，再 rename，任一步失败原文件保持不变。 */
  const tempFile = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tempFile, JSON.stringify(next, null, 2) + "\n", "utf8");
    fs.renameSync(tempFile, file);
  } catch (error) {
    try { fs.unlinkSync(tempFile); } catch (_error) {}
    console.error(`写回失败，原文件未改动：${error.message}`);
    process.exit(1);
  }
  console.log(`已写回 ${path.basename(file)}：${touched.join("、")}。请立即运行 validate-trip-data.js --stage=content 确认。`);
}

if (require.main === module) main();

module.exports = { MODULE_KEYS, PATCHABLE_MODULES, parseArgs, extractSections, applyPatch, selectDays, filterItems, validateResult };
