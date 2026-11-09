/* ── 11  execution links ── */
function initExecutionLinks(options = {}) {
  const root = options.root || document;
  const focus = (item) => {
    const placeId = item.dataset.placeId;
    if (!placeId) return;
    root.dispatchEvent(new CustomEvent("guide:focus-place", { detail: { placeId, dayNumber: Number(item.dataset.dayNumber) || null } }));
  };
  root.querySelectorAll(".execution-item[data-place-id]").forEach((item) => {
    if (item.dataset.executionReady === "true") return;
    item.dataset.executionReady = "true";
    item.addEventListener("click", (event) => { if (!event.target.closest("a,button,input")) focus(item); });
    item.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || event.target !== item) return;
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focus(item); }
    });
  });
  root.querySelectorAll("[data-show-day-map]").forEach((button) => {
    if (button.dataset.dayMapReady === "true") return;
    button.dataset.dayMapReady = "true";
    button.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      const control = root.querySelector(`[data-day-tab="${CSS.escape(button.dataset.showDayMap)}"]`);
      control?.click();
      root.querySelector("#itinerary-explore")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    });
  });
}
