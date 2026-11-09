/* ── 18  orchestrator ── */
const floatingActionsInstances = new WeakMap();
const niumouFloatingToggleInstances = new WeakMap();

function initNiumouFloatingToggle(options = {}) {
  const root = options.root || document;
  if (niumouFloatingToggleInstances.has(root)) return niumouFloatingToggleInstances.get(root);
  const dock = root.querySelector("[data-guide-floating-tools]");
  const toggle = root.querySelector("[data-guide-floating-toggle]");
  const fallbackIcon = toggle?.querySelector("[data-guide-floating-toggle-icon]");
  if (!dock || !toggle || !fallbackIcon) return null;

  const view = root.defaultView || globalThis;
  const spriteUrl = options.spriteUrl || "assets/niumou-spritesheet.webp";
  const viewport = root.createElement("span");
  const sprite = root.createElement("span");
  const openMark = root.createElement("span");
  viewport.className = "guide-niumou-viewport";
  sprite.className = "guide-niumou-sprite";
  openMark.className = "guide-niumou-open-mark";
  openMark.setAttribute("aria-hidden", "true");
  openMark.textContent = "×";
  sprite.style.backgroundImage = `url(${JSON.stringify(spriteUrl)})`;
  viewport.append(sprite);
  toggle.append(viewport, openMark);
  fallbackIcon.classList.add("guide-niumou-fallback-icon");

  const reduceMotion = view.matchMedia?.("(prefers-reduced-motion: reduce)") || { matches: false };
  const idleFrames = [0, 1, 2, 3, 4, 5];
  const idleDurations = [1680, 660, 660, 840, 840, 1920];
  const waveFrames = [24, 25, 26, 27, 24, 25, 26, 27];
  const waveDurations = [140, 140, 140, 280, 140, 140, 140, 320];
  const runFrames = [56, 57, 58, 59, 60, 61];
  const runDurations = [120, 120, 120, 120, 120, 220];
  let timer = 0;
  let scrollStopTimer = 0;
  let scrollFrame = 0;
  let runToken = 0;
  let idleIndex = 0;
  let mode = "idle";
  let lastScrollY = view.scrollY || 0;
  let destroyed = false;

  const setFrame = (frame) => {
    const column = frame % 8;
    const row = Math.floor(frame / 8);
    sprite.style.backgroundPosition = `${column * 100 / 7}% ${row * 100 / 10}%`;
  };
  const cancelAnimation = () => {
    runToken += 1;
    view.clearTimeout(timer);
  };
  const scheduleIdle = () => {
    cancelAnimation();
    mode = "idle";
    toggle.dataset.niumouState = dock.dataset.open === "true" ? "open" : "idle";
    if (reduceMotion.matches || root.hidden || dock.dataset.open === "true") {
      setFrame(0);
      return;
    }
    const token = runToken;
    const step = () => {
      if (token !== runToken || destroyed || root.hidden || dock.dataset.open === "true") return;
      setFrame(idleFrames[idleIndex]);
      const duration = idleDurations[idleIndex];
      idleIndex = (idleIndex + 1) % idleFrames.length;
      timer = view.setTimeout(step, duration);
    };
    step();
  };
  const playWave = () => {
    cancelAnimation();
    mode = "wave";
    toggle.dataset.niumouState = "open";
    if (reduceMotion.matches || root.hidden) {
      setFrame(0);
      return;
    }
    const token = runToken;
    let index = 0;
    const step = () => {
      if (token !== runToken || destroyed || root.hidden) return;
      if (index >= waveFrames.length) {
        setFrame(0);
        return;
      }
      setFrame(waveFrames[index]);
      timer = view.setTimeout(step, waveDurations[index]);
      index += 1;
    };
    step();
  };
  const startRunning = () => {
    if (mode === "running" || reduceMotion.matches || root.hidden || dock.dataset.open === "true" || toggle.dataset.niumouReady !== "true") return;
    cancelAnimation();
    mode = "running";
    toggle.dataset.niumouState = "running";
    const token = runToken;
    let index = 0;
    const step = () => {
      if (token !== runToken || destroyed || mode !== "running" || root.hidden || dock.dataset.open === "true") return;
      setFrame(runFrames[index]);
      const duration = runDurations[index];
      index = (index + 1) % runFrames.length;
      timer = view.setTimeout(step, duration);
    };
    step();
  };
  const stopRunning = () => { if (mode === "running") scheduleIdle(); };
  const syncMenuState = () => {
    view.clearTimeout(scrollStopTimer);
    if (dock.dataset.open === "true") playWave(); else scheduleIdle();
  };
  const handleScroll = () => {
    if (scrollFrame) return;
    scrollFrame = view.requestAnimationFrame(() => {
      scrollFrame = 0;
      const nextScrollY = view.scrollY || 0;
      const moved = Math.abs(nextScrollY - lastScrollY);
      lastScrollY = nextScrollY;
      if (moved < 2 || reduceMotion.matches || dock.dataset.open === "true") return;
      startRunning();
      view.clearTimeout(scrollStopTimer);
      scrollStopTimer = view.setTimeout(stopRunning, 220);
    });
  };
  const handleVisibility = () => {
    view.clearTimeout(scrollStopTimer);
    scheduleIdle();
  };

  const preload = new view.Image();
  const handleLoad = () => {
    if (destroyed) return;
    toggle.dataset.niumouReady = "true";
    toggle.classList.add("guide-niumou-ready");
    root.body?.classList.add("guide-niumou-enabled");
    setFrame(0);
    syncMenuState();
  };
  const handleError = () => {
    viewport.remove();
    openMark.remove();
    fallbackIcon.classList.remove("guide-niumou-fallback-icon");
  };
  preload.addEventListener("load", handleLoad, { once: true });
  preload.addEventListener("error", handleError, { once: true });
  preload.src = spriteUrl;

  const observer = new MutationObserver(syncMenuState);
  observer.observe(dock, { attributes: true, attributeFilter: ["data-open"] });
  view.addEventListener("scroll", handleScroll, { passive: true });
  root.addEventListener("visibilitychange", handleVisibility);
  reduceMotion.addEventListener?.("change", syncMenuState);

  const api = Object.freeze({
    destroy() {
      destroyed = true;
      cancelAnimation();
      view.clearTimeout(scrollStopTimer);
      if (scrollFrame) view.cancelAnimationFrame(scrollFrame);
      observer.disconnect();
      view.removeEventListener("scroll", handleScroll);
      root.removeEventListener("visibilitychange", handleVisibility);
      reduceMotion.removeEventListener?.("change", syncMenuState);
      preload.removeEventListener("load", handleLoad);
      preload.removeEventListener("error", handleError);
      viewport.remove();
      openMark.remove();
      fallbackIcon.classList.remove("guide-niumou-fallback-icon");
      toggle.classList.remove("guide-niumou-ready");
      delete toggle.dataset.niumouReady;
      delete toggle.dataset.niumouState;
      root.body?.classList.remove("guide-niumou-enabled");
      niumouFloatingToggleInstances.delete(root);
    }
  });
  niumouFloatingToggleInstances.set(root, api);
  return api;
}

function initFloatingActions(options = {}) {
  const root = options.root || document;
  if (floatingActionsInstances.has(root)) return floatingActionsInstances.get(root);
  const dock = root.querySelector("[data-guide-floating-tools]");
  const actions = root.querySelector("[data-guide-floating-actions]");
  const toggle = root.querySelector("[data-guide-floating-toggle]");
  const toggleIcon = toggle?.querySelector("[data-guide-floating-toggle-icon]");
  const todayAction = root.querySelector('[data-floating-action="today"]');
  if (!dock || !actions || !toggle) return null;
  const orderExchangeAction = () => {
    const edit = actions.querySelector('[data-floating-action="edit"]');
    const exchange = actions.querySelector('[data-floating-action="exchange"]');
    if (edit && exchange && edit.nextElementSibling !== exchange) edit.after(exchange);
  };

  const refreshToday = () => {
  const localToday = new Date().toLocaleDateString("sv-SE");
  const todayPanel = [...root.querySelectorAll("[data-day-panel][data-itinerary-date]")]
    .find((panel) => panel.dataset.itineraryDate === localToday);
  if (todayAction) {
    todayAction.hidden = !todayPanel;
    if (todayPanel) {
      todayAction.dataset.dayJump = todayPanel.dataset.dayPanel || "";
      const dayLabel = todayPanel.dataset.dayPanel ? `，第 ${todayPanel.dataset.dayPanel} 天` : "";
      todayAction.setAttribute("aria-label", `返回今日行程${dayLabel}`);
    } else {
      todayAction.removeAttribute("data-day-jump");
    }
  }

  };

  let open = false;
  let hoverOpenTimer = 0;
  let hoverCloseTimer = 0;
  const finePointer = globalThis.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches === true;
  const visibleActions = () => [...actions.querySelectorAll("button:not([hidden])")];
  const syncFocusable = () => visibleActions().forEach((button) => { button.tabIndex = open ? 0 : -1; });
  const setOpen = (next, config = {}) => {
    refreshToday();
    open = Boolean(next);
    dock.dataset.open = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "关闭快捷工具" : "打开快捷工具");
    actions.setAttribute("aria-hidden", String(!open));
    if (open) actions.removeAttribute("inert"); else actions.setAttribute("inert", "");
    if (toggleIcon) toggleIcon.textContent = open ? "×" : "•••";
    syncFocusable();
    if (open && config.focus) (visibleActions()[0] || toggle).focus();
  };
  const clearHoverTimers = () => {
    globalThis.clearTimeout(hoverOpenTimer);
    globalThis.clearTimeout(hoverCloseTimer);
  };
  const closeFromEvent = () => setOpen(false);
  const onToggleClick = () => setOpen(!open);
  const onToggleKeydown = (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    setOpen(true, { focus: true });
  };
  const onActionsClick = (event) => { if (event.target.closest("button")) setOpen(false); };
  const onDocumentClick = (event) => { if (open && !dock.contains(event.target)) setOpen(false); };
  const onDocumentKeydown = (event) => {
    if (event.key !== "Escape" || !open) return;
    setOpen(false);
    toggle.focus();
  };
  const onPointerEnter = () => {
    if (!finePointer) return;
    clearHoverTimers();
    hoverOpenTimer = globalThis.setTimeout(() => setOpen(true), 140);
  };
  const onPointerLeave = () => {
    if (!finePointer) return;
    clearHoverTimers();
    hoverCloseTimer = globalThis.setTimeout(() => {
      if (!dock.contains(root.activeElement)) setOpen(false);
    }, 260);
  };
  const onFocusOut = () => {
    globalThis.setTimeout(() => { if (!dock.contains(root.activeElement)) setOpen(false); }, 0);
  };

  const onResume = () => { refreshToday(); syncFocusable(); };
  const view = root.defaultView || globalThis;
  root.addEventListener("visibilitychange", onResume);
  view.addEventListener("pageshow", onResume);
  toggle.addEventListener("click", onToggleClick);
  toggle.addEventListener("keydown", onToggleKeydown);
  actions.addEventListener("click", onActionsClick);
  dock.addEventListener("pointerenter", onPointerEnter);
  dock.addEventListener("pointerleave", onPointerLeave);
  dock.addEventListener("focusout", onFocusOut);
  root.addEventListener("click", onDocumentClick);
  root.addEventListener("keydown", onDocumentKeydown);
  root.addEventListener("guide:floating-actions-close", closeFromEvent);
  const observer = new MutationObserver(() => { orderExchangeAction(); syncFocusable(); });
  observer.observe(actions, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  orderExchangeAction();
  setOpen(false);

  const api = Object.freeze({
    isOpen: () => open,
    setOpen,
    destroy() {
      clearHoverTimers();
      root.removeEventListener("visibilitychange", onResume);
      view.removeEventListener("pageshow", onResume);
      observer.disconnect();
      toggle.removeEventListener("click", onToggleClick);
      toggle.removeEventListener("keydown", onToggleKeydown);
      actions.removeEventListener("click", onActionsClick);
      dock.removeEventListener("pointerenter", onPointerEnter);
      dock.removeEventListener("pointerleave", onPointerLeave);
      dock.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("click", onDocumentClick);
      root.removeEventListener("keydown", onDocumentKeydown);
      root.removeEventListener("guide:floating-actions-close", closeFromEvent);
      floatingActionsInstances.delete(root);
    }
  });
  floatingActionsInstances.set(root, api);
  return api;
}

function initGuidePage(options = {}) {
  const root = options.root || document;
  const active = { errors: [] };
  const initialize = (name, start) => {
    try { return start(); } catch (error) {
      active.errors.push({ module: name, message: String(error.message || error) });
      root.dispatchEvent(new CustomEvent("guide:module-error", { detail: { module: name } }));
      let notice = root.querySelector("[data-guide-module-warning]");
      if (!notice) { notice = document.createElement("p"); notice.dataset.guideModuleWarning = ""; notice.setAttribute("role", "status"); (root.body || root).append(notice); }
      notice.textContent = "部分工具暂不可用，行程正文仍可查看；请刷新后重试。";
      return null;
    }
  };
  if (options.sources !== false) active.sources = initialize("sources", () => initSourceLinks({ root, revealOverview: () => active.travel?.revealOverview(), ...(options.sourceOptions || {}) }));
  if (options.search !== false) active.search = initialize("search", () => initSearch({ root, revealHit: hit => active.travel?.revealSearchHit(hit) || hit, clearReveal: () => active.travel?.clearSearchTarget(), ...(options.searchOptions || {}) }));
  if (options.copy !== false) active.copy = initialize("copy", () => initCopyControls({ root, ...(options.copyOptions || {}) }));
  if (options.checklist !== false) active.checklist = initialize("checklist", () => initChecklist({ root, editable: true, ...(options.checklistOptions || {}) }));
  if (options.preview !== false) active.preview = initialize("preview", () => initImagePreview({ root, ...(options.previewOptions || {}) }));
  if (options.navigation !== false) active.navigation = initialize("navigation", () => initQuickNav({ root, ...(options.navigationOptions || {}) }));
  if (options.exchange) active.exchange = initialize("exchange", () => initExchange({ root, ...(options.exchange === true ? {} : options.exchange) }));
  if (options.weather) active.weather = initialize("weather", () => initWeatherForecast({ root, ...(options.weather === true ? {} : options.weather) }));
  if (options.dayTabs) active.dayTabs = initialize("dayTabs", () => initDayTabs({ root, ...(options.dayTabs === true ? {} : options.dayTabs) }));
  if (active.dayTabs) active.travel = initialize("travel", () => initTravelMode(root, active.dayTabs));
  if (options.execution) active.execution = initialize("execution", () => initExecutionLinks({ root, ...(options.execution === true ? {} : options.execution) }));
  if (options.calendar) active.calendar = initialize("calendar", () => initCalendarExport({ root, ...(options.calendar === true ? {} : options.calendar) }));
  if (options.expenses) active.expenses = initialize("expenses", () => initExpenseTracker({ root, ...(options.expenses === true ? {} : options.expenses) }));
  if (options.bookings !== false) active.bookings = initialize("bookings", () => initBookingLedger({ root }));
  if (options.flights) active.flights = initialize("flights", () => initFlightRecords({ root, ...(options.flights === true ? {} : options.flights) }));
  if (options.routeSummary !== false) active.routeSummary = initialize("routeSummary", () => initRouteSummary({ root, ...(options.routeSummaryOptions || {}) }));
  if (options.themes !== false) active.themes = initialize("themes", () => initThemeSwitcher({ root, ...(options.themeOptions || {}) }));
  if (options.floatingActions !== false) initialize("homeScreen", () => initHomeScreen(root));
  if (options.floatingActions !== false) active.floatingActions = initialize("floatingActions", () => initFloatingActions({ root, ...(options.floatingActionOptions || {}) }));
  if (options.floatingActions !== false && options.niumou !== false) active.niumou = initialize("niumou", () => initNiumouFloatingToggle({ root, ...(options.niumouOptions || {}) }));
  return active;
}

global.TravelGuideInteractions = Object.freeze({
  initSourceLinks, initSearch, initToast, initCopyControls, initChecklist,
  initImagePreview, initExchange, initWeatherForecast, initQuickNav, initDayTabs,
  initExecutionLinks, initCalendarExport, initExpenseTracker, initBookingLedger,
  initFlightRecords, recognizeFlightTicket, sanitizeFlightRecord, safeFlightDetailUrl,
  initRouteSummary, initThemeSwitcher, initFloatingActions, initNiumouFloatingToggle, initGuidePage, readJsonIndex
});
