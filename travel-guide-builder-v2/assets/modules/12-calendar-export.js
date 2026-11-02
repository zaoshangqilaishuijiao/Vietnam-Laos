/* ── 12  calendar export ── */
function initCalendarExport(options = {}) {
  const root = options.root || document;
  const button = root.querySelector("[data-calendar-export]");
  const status = root.querySelector("[data-calendar-status]");
  const events = readJsonIndex("[data-calendar-events]", root);
  if (!button || !Array.isArray(events)) return;
  if (button.dataset.calendarReady === "true") return button._calendarController || null;
  const validEvents = events.filter((event) => event?.date && (event.allDay || event.startTime));
  const mode = root.querySelector("[data-calendar-events]")?.dataset.calendarMode
    || (validEvents.length && validEvents.every(event => event.allDay) ? "daily" : "timed");
  const exportCalendar = () => {
    if (!validEvents.length) { if (status) status.textContent = "暂无可导出的行程"; return; }
    if (!global.TravelGuideCalendar?.buildIcs) { if (status) status.textContent = "日历组件暂不可用"; return; }
    let calendarText = "";
    try { calendarText = global.TravelGuideCalendar.buildIcs(validEvents, { calendarName: document.title }); }
    catch (_error) { if (status) status.textContent = "日历生成失败，请稍后重试"; return; }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([calendarText], { type: "text/calendar;charset=utf-8" }));
    link.download = options.filename || "travel-itinerary.ics";
    document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    if (status) status.textContent = mode === "daily"
      ? `已生成 ${new Set(validEvents.map(event => event.date)).size} 天行程的 ICS 文件`
      : `已生成 ${validEvents.length} 项安排的 ICS 文件`;
  };
  button.addEventListener("click", exportCalendar);
  const api = Object.freeze({ export: exportCalendar });
  button.dataset.calendarReady = "true";
  button._calendarController = api;
  return api;
}
