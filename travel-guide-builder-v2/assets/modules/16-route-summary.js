/* ── 16  route summary ── */
function initRouteSummary(options = {}) {
  const root = options.root || document;
  const modeNames = { driving: "驾车", motorcycle: "摩托车", tuktuk: "突突车", walking: "步行", transit: "公共交通", bus: "公交", ferry: "轮船", cablecar: "索道", mountainrail: "登山铁路", tram: "有轨电车", monorail: "单轨", minibus: "地方小巴", rickshaw: "人力车", bicycling: "骑行" };
  const formatClock = (minutes) => {
    const value = ((minutes % 1440) + 1440) % 1440;
    const days = Math.floor(minutes / 1440);
    return (days > 0 ? `+${days}天 ` : days < 0 ? `${days}天 ` : "") + String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(value % 60).padStart(2, "0");
  };
  const formatDuration = (minutes) => {
    const hours = Math.floor(minutes / 60); const rest = minutes % 60;
    return hours ? hours + "小时" + (rest ? rest + "分" : "") : rest + "分";
  };
  const cards = [...root.querySelectorAll(".route-timeline-card")];
  cards.forEach((card) => {
    if (card.dataset.routeSummaryReady === "true") return;
    card.dataset.routeSummaryReady = "true";
    const rows = [...card.querySelectorAll(".route-stop-row")];
    const segments = [...card.querySelectorAll(".route-timeline-transfer[data-route-segment-index]")];
    const summary = card.querySelector(".route-timeline-summary");
    const baseTimes = rows.map((row) => Number(row.querySelector(".route-stop-time")?.dataset.initialMinutes));
    const supportsRecalculation = rows.length > 1 && segments.length === rows.length - 1
      && baseTimes.every(Number.isFinite) && segments.every((segment) => Number.isFinite(Number(segment.dataset.defaultDuration)));
    const updateTimeline = () => {
      if (!supportsRecalculation || !summary) return;
      rows.forEach((row, index) => {
        const time = row.querySelector(".route-stop-time");
        time.textContent = formatClock(baseTimes[index]);
        let estimate = row.querySelector(".route-arrival-estimate");
        if (!estimate) { const cell = document.createElement("div"); cell.className = "route-time-cell"; time.replaceWith(cell); cell.append(time); estimate = document.createElement("small"); estimate.className = "route-arrival-estimate"; cell.append(estimate); }
        const previous = segments[index - 1];
        const delta = previous ? Number(previous.dataset.selectedDuration) - Number(previous.dataset.defaultDuration) : 0;
        estimate.hidden = !delta;
        estimate.textContent = delta ? `预计 ${formatClock(Number(time.dataset.arrivalMinutes ?? baseTimes[index]) + delta)}（${delta > 0 ? "晚于" : "早于"}计划 ${Math.abs(delta)} 分）` : "";
      });
      const knownMovement = segments.reduce((total, segment) => {
        const duration = Number(segment.dataset.selectedDuration);
        return total + (Number.isFinite(duration) ? duration : 0);
      }, 0);
      const destination = rows.at(-1)?.querySelector(".route-place-link")?.textContent.trim() || "终点";
      const strong = (value) => { const node = document.createElement("b"); node.textContent = value; return node; };
      summary.replaceChildren(
        document.createTextNode("共 "), strong(rows.length + " 个停靠点"),
        document.createTextNode(" · 已知移动 "), strong(formatDuration(knownMovement)),
        document.createTextNode(" · 终点 "), strong(destination)
      );
    };
    card.addEventListener("click", (event) => {
      const option = event.target.closest("[data-route-mode-option]");
      if (!option || !card.contains(option)) return;
      const segment = option.closest(".route-timeline-transfer");
      segment.querySelectorAll("[data-route-mode-option]").forEach((item) => {
        const selected = item === option;
        item.classList.toggle("is-active", selected);
        item.setAttribute("aria-pressed", String(selected));
      });
      if (option.dataset.durationMinutes) segment.dataset.selectedDuration = option.dataset.durationMinutes;
      segment.dataset.selectedMode = option.dataset.navigationMode;
      const launcher = segment.querySelector("[data-route-navigation-launch]");
      if (launcher) {
        const label = modeNames[option.dataset.navigationMode] || "路线";
        launcher.href = option.dataset.navigationUrl;
        launcher.dataset.navigationMode = option.dataset.navigationMode;
        launcher.textContent = option.dataset.actionLabel || ("发起" + label + "导航");
        launcher.setAttribute("aria-label", launcher.textContent + "：在 Google Maps 中打开");
      }
      updateTimeline();
    });
    updateTimeline();
  });
  return { cards };
}
