/* travel-guide-calendar: v2 */
(function initTravelGuideCalendar(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TravelGuideCalendar = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, function createTravelGuideCalendar() {
  "use strict";

  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const encoder = new TextEncoder();
  const byteLength = (value) => encoder.encode(value).length;
  const compactDate = (value) => String(value || "").replaceAll("-", "");
  const compactDateTime = (date, time) => compactDate(date) + "T" + String(time || "").replace(":", "") + "00";
  const escapeText = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/([,;])/g, "\\$1");
  const safeUidPart = (value) => String(value || "event").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "event";

  function addDays(date, amount) {
    if (!DATE.test(String(date || ""))) throw new Error("日历事件日期无效");
    const [year, month, day] = date.split("-").map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + amount));
    return [next.getUTCFullYear(), String(next.getUTCMonth() + 1).padStart(2, "0"), String(next.getUTCDate()).padStart(2, "0")].join("-");
  }

  function addMinutes(date, time, minutes) {
    if (!DATE.test(String(date || "")) || !TIME.test(String(time || ""))) throw new Error("日历事件时间无效");
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    const next = new Date(Date.UTC(year, month - 1, day, hour, minute + Math.max(1, Number(minutes) || 60)));
    return compactDateTime([next.getUTCFullYear(), String(next.getUTCMonth() + 1).padStart(2, "0"), String(next.getUTCDate()).padStart(2, "0")].join("-"), `${String(next.getUTCHours()).padStart(2, "0")}:${String(next.getUTCMinutes()).padStart(2, "0")}`);
  }

  function utcStamp(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error("日历生成时间无效");
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  function foldLine(line) {
    if (byteLength(line) <= 75) return line;
    const parts = [];
    let current = "";
    let currentBytes = 0;
    for (const character of line) {
      const characterBytes = byteLength(character);
      const limit = parts.length ? 74 : 75;
      if (current && currentBytes + characterBytes > limit) {
        parts.push(current);
        current = character;
        currentBytes = characterBytes;
      } else {
        current += character;
        currentBytes += characterBytes;
      }
    }
    if (current) parts.push(current);
    return parts.map((part, index) => index ? " " + part : part).join("\r\n");
  }

  function formatDescriptionSections(sections) {
    return (Array.isArray(sections) ? sections : []).map((section) => {
      const lines = (Array.isArray(section?.lines) ? section.lines : []).map((line) => String(line || "").trim()).filter(Boolean);
      const heading = `${String(section?.icon || "").trim()}${String(section?.title || "").trim()}`;
      return heading && lines.length ? [heading, ...lines].join("\n") : "";
    }).filter(Boolean).join("\n\n");
  }

  function buildIcs(events, options = {}) {
    const validEvents = (Array.isArray(events) ? events : []).filter((event) => DATE.test(String(event?.date || "")) && (event.allDay || TIME.test(String(event?.startTime || ""))));
    if (!validEvents.length) throw new Error("暂无可导出的有效行程");
    const stamp = utcStamp(options.generatedAt);
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Travel Guide Builder//Travel Itinerary//ZH-CN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH"
    ];
    if (options.calendarName) lines.push(`X-WR-CALNAME:${escapeText(options.calendarName)}`);
    validEvents.forEach((event, index) => {
      lines.push("BEGIN:VEVENT", `UID:${safeUidPart(event.id || index + 1)}-${compactDate(event.date)}@travel-guide.local`, `DTSTAMP:${stamp}`);
      if (event.allDay) {
        lines.push(`DTSTART;VALUE=DATE:${compactDate(event.date)}`, `DTEND;VALUE=DATE:${compactDate(addDays(event.date, 1))}`, "TRANSP:TRANSPARENT");
      } else {
        const end = event.endTime && TIME.test(event.endTime) ? compactDateTime(event.date, event.endTime) : addMinutes(event.date, event.startTime, event.stayMinutes);
        lines.push(`DTSTART:${compactDateTime(event.date, event.startTime)}`, `DTEND:${end}`);
      }
      lines.push(`SUMMARY:${escapeText(event.title || "旅行安排")}`);
      const description = event.descriptionSections ? formatDescriptionSections(event.descriptionSections) : event.description;
      if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
      if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.map(foldLine).join("\r\n") + "\r\n";
  }

  return { addDays, buildIcs, escapeText, foldLine, formatDescriptionSections, utcStamp };
});
