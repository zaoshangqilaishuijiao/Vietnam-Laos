#!/usr/bin/env node
const assert = require("assert");
const path = require("path");

const { addDays, buildIcs } = require(path.join(__dirname, "..", "assets", "ics-calendar.js"));

const generatedAt = new Date("2026-08-14T01:02:03Z");
const daily = buildIcs([{
  id: "day-1",
  date: "2026-12-31",
  allDay: true,
  title: "Day 1 | 米兰经典城市轴线与运河",
  descriptionSections: [
    { icon: "📍", title: "路线", lines: ["米兰 → 米兰大教堂 → 运河区"] },
    { icon: "🗺", title: "行程", lines: ["09:00｜米兰大教堂", "14:00｜运河区"] },
    { icon: "⚠️", title: "备注", lines: ["提前预约,雨天备选室内行程"] },
    { icon: "🔗", title: "链接", lines: ["当天导航", "https://maps.example.org/day-1"] }
  ],
  location: "米兰"
}], { calendarName: "旅行攻略", generatedAt });

assert.ok(daily.startsWith("BEGIN:VCALENDAR\r\n"), "ICS 必须直接以 BEGIN:VCALENDAR 开始，不得带 BOM");
assert.ok(daily.endsWith("END:VCALENDAR\r\n"), "ICS 必须以 CRLF 结尾");
assert.ok(daily.includes("DTSTAMP:20260814T010203Z\r\n"), "VEVENT 必须包含 UTC DTSTAMP");
assert.ok(daily.includes("DTSTART;VALUE=DATE:20261231\r\n"), "全天事件 DTSTART 必须为 DATE");
assert.ok(daily.includes("DTEND;VALUE=DATE:20270101\r\n"), "全天事件 DTEND 必须是次日且为 DATE");
assert.ok(!daily.includes("DURATION:P1D"), "全天事件统一使用显式 DTEND");
const unfoldedDaily = daily.replace(/\r\n /g, "");
assert.ok(unfoldedDaily.includes("SUMMARY:Day 1 | 米兰经典城市轴线与运河"), "SUMMARY 只能保存简短标题");
assert.ok(unfoldedDaily.includes("LOCATION:米兰"), "LOCATION 只能保存核心地名");
assert.ok(unfoldedDaily.includes("DESCRIPTION:📍路线\\n米兰 → 米兰大教堂 → 运河区\\n\\n🗺行程"), "DESCRIPTION 必须使用单换行与空行分段");
assert.ok(unfoldedDaily.includes("提前预约\\,雨天备选室内行程"), "DESCRIPTION 中的英文逗号必须转义");
daily.split("\r\n").filter(Boolean).forEach((line) => assert.ok(Buffer.byteLength(line, "utf8") <= 75, `ICS 物理行超过 75 字节：${line}`));
assert.ok(daily.split("\r\n").some((line) => line.startsWith(" ")), "长中文内容必须产生折行续行");
assert.strictEqual(addDays("2028-02-28", 1), "2028-02-29", "日期推进必须支持闰年");

const timed = buildIcs([{
  id: "late-event",
  date: "2026-09-01",
  allDay: false,
  startTime: "23:30",
  stayMinutes: 90,
  title: "夜间交通",
  description: "跨午夜抵达"
}], { generatedAt });
assert.ok(timed.includes("DTSTART:20260901T233000\r\n"), "定时事件必须包含开始时间");
assert.ok(timed.includes("DTEND:20260902T010000\r\n"), "推算结束时间必须正确跨日");
assert.throws(() => buildIcs([], { generatedAt }), /暂无可导出/, "空事件集合必须拒绝导出");

console.log("PASS RFC 5545 calendar export, UTF-8 folding, all-day and timed events");
