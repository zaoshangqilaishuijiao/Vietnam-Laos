#!/usr/bin/env node
const path = require("path");
const { readUtf8Json, validateTripData } = require("./validate-trip-data.js");
const { readOption } = require("./cli-options.js");

function buildTripBriefSummary(data, { request = null } = {}) {
  const validation = validateTripData(data, { stage: "brief", request });
  if (!validation.valid) throw new Error("trip-brief.json 未通过：\n- " + validation.failures.join("\n- "));

  const values = (items) => items.length ? items.join("、") : "无";
  const enabled = Object.entries(data.features).filter(([, value]) => value).map(([key]) => ({
    arrivalDeparture: "到达/离开",
    exchange: "汇率",
    weather: "天气刷新",
    sourceIndex: "高级来源搜索",
    dayMap: "当天地图",
    dayNavigation: "分段导航",
    calendarExport: "日历导出",
    expenseTracker: "实际支出"
  }[key] || key));

  return [
    "## 基础方案预览",
    "",
    `- 行程：${data.meta.origin} → ${data.meta.destination}`,
    `- 日期：${data.meta.dates.length ? data.meta.dates.join("、") : data.meta.datePolicy === "season" ? "季节待定" : "日期待定"}`,
    `- 人数与画像：${data.meta.travelers.count} 人${data.meta.travelers.profiles.length ? `（${data.meta.travelers.profiles.join("、")}）` : ""}`,
    `- 一句话路线：${data.route.summary}`,
    `- 有序停靠点：${data.route.stops.map((stop) => typeof stop === "string" ? stop : stop.name).join(" → ")}`,
    `- 预算口径：${data.meta.budgetBasis}`,
    `- 必去：${values(data.requirements.mustVisit)}`,
    `- 避开：${values(data.requirements.avoid)}`,
    `- 偏好：${values(data.requirements.preferences)}`,
    `- 关键限制：${values(data.requirements.constraints)}`,
    `- 启用模块：${values(enabled)}`,
    "",
    "### 每日骨架",
    "",
    ...data.dayOutline.map((day) => `- Day ${day.dayNumber}${day.date ? `（${day.date}）` : ""}：${day.city}｜${day.theme}`),
    "",
    `- 当前假设：${values(data.requirements.assumptions)}`,
    `- 待确认项：${values(data.requirements.openQuestions)}`,
    `- 研究完成情况：常规小红书 ${data.researchAudit.xiaohongshuReadCount} / ${data.researchPlan.xiaohongshuTarget} 篇；到达/离开专项 ${data.researchAudit.arrivalDepartureReadCount} / ${data.researchPlan.arrivalDepartureTarget} 篇；官方核验主题：${values(data.researchPlan.officialTopics)}`,
    "",
    data.confirmation.status === "pending" ? "已按你的要求暂停；请回复“确认/继续”，或直接指出需要调整的日期、路线、节奏和预算口径。" : data.confirmation.status === "skipped" ? `已记录总授权：${data.confirmation.note}；将默认继续生成详细内容和网页。` : `已确认：${data.confirmation.note}；将继续生成详细内容和网页。`
  ].join("\n");
}

function main(args = process.argv.slice(2), io = console) {
  const input = args.find((arg) => !arg.startsWith("--"));
  if (!input) {
    io.error("Usage: node summarize-trip-brief.js <trip-brief.json> [--request=trip-request.json]");
    return 2;
  }
  const requestPath = readOption(args, "request");
  try {
    const data = readUtf8Json(path.resolve(input));
    const request = requestPath ? readUtf8Json(path.resolve(requestPath)) : null;
    io.log(buildTripBriefSummary(data, { request }));
    return 0;
  } catch (error) {
    io.error(error.message);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { buildTripBriefSummary, main };
