/* ── 19  travel mode ── */
const travelModeInstances = new WeakMap();
function initTravelMode(root, dayTabs) {
  const existing = travelModeInstances.get(root);
  if (existing) return existing;
  const itinerary = root.querySelector("#itinerary");
  const toggle = root.querySelector("[data-travel-toggle]");
  const title = itinerary?.querySelector("[data-travel-day-title]");
  if (!dayTabs || !toggle || !title) return null;

  const map = itinerary.querySelector("#itinerary-explore");
  const directoryButton = itinerary.querySelector("[data-travel-directory-open]");
  const directoryDialog = itinerary.querySelector("[data-travel-directory-dialog]");
  const directoryList = directoryDialog?.querySelector("[data-travel-directory-list]");
  const closeDirectory = (focus = false) => {
    if (!directoryDialog?.open) return;
    directoryDialog.close();
    directoryList.replaceChildren();
    if (focus) directoryButton.focus({ preventScroll: true });
  };
  const key = "guide-travel-mode:" + (root.body.dataset.guideId || global.location.pathname);
  let saved = {};
  try { saved = JSON.parse(global.sessionStorage.getItem(key)) || {}; } catch (_) {}
  const days = saved.days && typeof saved.days === "object" ? saved.days : {};
  const photoPages = saved.photos && typeof saved.photos === "object" ? saved.photos : {};
  let overviewScroll = Number.isFinite(saved.overviewScroll) ? saved.overviewScroll : 0;
  let panel = itinerary.querySelector("[data-day-panel]:not([hidden])");
  if (!panel) return null;
  let activeCard = null;
  let destination = null;
  let frame = 0;
  let jumpTimer;
  const isTravel = () => root.body.dataset.travelView === "travel";
  const dayKey = () => panel.dataset.itineraryDate || panel.dataset.dayPanel;
  const cards = () => [...panel.querySelectorAll("[data-travel-item]")];
  const save = () => {
    try { global.sessionStorage.setItem(key, JSON.stringify({ mode: isTravel() ? "travel" : "overview", date: dayKey(), days, photos: photoPages, overviewScroll })); } catch (_) {}
  };
  const reduced = () => global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const scrollToElement = (element, smooth = true) => {
    element?.scrollIntoView?.({ block: "start", behavior: smooth && !reduced() ? "smooth" : "auto" });
  };
  const highlight = card => {
    activeCard?.classList.remove("is-travel-selected");
    activeCard = card;
    activeCard?.classList.add("is-travel-selected");
    panel.querySelectorAll("[data-travel-jump]").forEach(button => {
      if (button.dataset.travelJump === card?.dataset.travelItem) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
  };
  const capture = () => {
    if (!panel) return;
    if (!isTravel()) { overviewScroll = global.scrollY; return; }
    days[dayKey()] = { itemId: activeCard?.dataset.travelItem, offset: activeCard?.getBoundingClientRect().top, atTop: global.scrollY < 8 };
    cards().forEach(card => {
      const gallery = card.querySelector("[data-travel-photo-track]")?._travelGallery;
      if (gallery) photoPages[card.dataset.travelItem] = gallery.index();
    });
  };
  const jump = (card, focus = false, smooth = true) => {
    if (!card) return;
    highlight(card);
    destination = card;
    global.clearTimeout(jumpTimer);
    if (focus) card.focus({ preventScroll: true });
    scrollToElement(card, smooth);
    jumpTimer = global.setTimeout(() => { destination = null; }, 1000);
  };
  const restore = () => {
    const position = days[dayKey()];
    const target = cards().find(card => card.dataset.travelItem === position?.itemId);
    highlight(target || cards()[0]);
    global.scrollTo?.(0, !position?.atTop && target && Number.isFinite(position?.offset)
      ? global.scrollY + target.getBoundingClientRect().top - position.offset : 0);
  };
  const updateDay = () => {
    title.textContent = panel.querySelector(".day-overview h3")?.textContent || "";
    cards().forEach(card => {
      const index = photoPages[card.dataset.travelItem];
      if (Number.isInteger(index)) card.querySelector("[data-travel-photo-track]")?._travelGallery?.show(index);
    });
    const hasMapPoints = panel.querySelector(".travel-map-fallback");
    const nearby = map?.querySelector(`[data-nearby-panel="day-${panel.dataset.dayPanel}"]`);
    if (map) map.classList.toggle("travel-map-empty", !hasMapPoints && !nearby);
  };
  const onDayChange = (event) => {
    const next = [...itinerary.querySelectorAll("[data-day-panel]")].find(day => Number(day.dataset.dayPanel) === event.detail.dayNumber);
    if (!next || next === panel) return;
    closeDirectory();
    panel = next;
    destination = null;
    if (isTravel()) {
      updateDay();
      if (event.detail.restorePosition !== false) restore();
    }
    save();
  };
  const setMode = (travel, restorePosition = true) => {
    if (travel === isTravel()) return;
    capture();
    closeDirectory();
    destination = null;
    root.body.dataset.travelView = travel ? "travel" : "overview";
    title.hidden = !travel;
    itinerary.querySelectorAll("[data-travel-day]").forEach(day => { day.hidden = !travel; });
    toggle.querySelector("[data-travel-mode-label]").textContent = travel ? "返回概览" : "进入出行模式";
    if (travel) updateDay();
    if (restorePosition) {
      if (travel) restore();
      else global.scrollTo?.(0, overviewScroll);
    }
    root.dispatchEvent(new CustomEvent("guide:floating-actions-close"));
    save();
  };
  const selectDay = (number) => dayTabs.openDay(number, false, { scroll: false, restorePosition: false });
  const focusMap = () => scrollToElement(map);
  const locatePlace = (id, focus) => {
    const candidates = cards().filter(card => card.dataset.travelPlace === id);
    const target = candidates.includes(activeCard) ? activeCard : candidates[0];
    jump(target, focus);
    return Boolean(target);
  };
  const onMapMarker = (event) => {
    if (isTravel() && event.detail?.key === "day-" + panel.dataset.dayPanel && locatePlace(event.detail.placeId, true)) event.preventDefault();
  };
  const onClick = (event) => {
    const button = event.target.closest?.("button");
    if (!button) return;
    if (button === toggle) {
      setMode(!isTravel());
      const focusTarget = isTravel() ? itinerary.querySelector('[data-day-tab][aria-selected="true"]') : root.querySelector("[data-guide-floating-toggle]");
      focusTarget?.focus({ preventScroll: true });
    } else if (button.dataset.showDayMap && map) {
      event.preventDefault();
      selectDay(button.dataset.showDayMap);
      setMode(true, false);
      focusMap();
    } else if (button === directoryButton && directoryList && !directoryDialog.open) {
      const directory = panel.querySelector(".travel-stop-directory")?.cloneNode(true);
      if (!directory) return;
      directory.classList.replace("travel-stop-directory", "travel-directory-items");
      directoryList.replaceChildren(directory);
      directoryDialog.showModal();
      const current = directory.querySelector("[aria-current]") || directory.querySelector("button");
      if (current) {
        directoryList.scrollTop = current.getBoundingClientRect().top - directoryList.getBoundingClientRect().top;
        current.focus({ preventScroll: true });
      }
    } else if (button.hasAttribute("data-travel-directory-close")) {
      closeDirectory(true);
    } else if (button.dataset.travelJump) {
      const target = cards().find(card => card.dataset.travelItem === button.dataset.travelJump);
      const fromDirectory = Boolean(directoryDialog?.open);
      closeDirectory();
      jump(target, true, !fromDirectory);
    } else if (button.hasAttribute("data-travel-detail-toggle")) {
      const detail = root.getElementById(button.getAttribute("aria-controls"));
      if (!detail) return;
      detail.hidden = !detail.hidden;
      button.setAttribute("aria-expanded", String(!detail.hidden));
    } else if (button.dataset.travelFallbackPlace) {
      locatePlace(button.dataset.travelFallbackPlace, true);
    } else if (button.dataset.travelMapPlace) {
      highlight(button.closest("[data-travel-item]"));
      root.dispatchEvent(new CustomEvent("guide:focus-place", {
        detail: { placeId: button.dataset.travelMapPlace, dayNumber: Number(panel.dataset.dayPanel) }
      }));
      focusMap();
    }
  };
  const clearSearchTarget = () => itinerary.querySelector(".is-travel-search-hit")?.classList.remove("is-travel-search-hit");
  const revealSearchHit = mark => {
    clearSearchTarget();
    if (!isTravel()) return mark;
    const item = mark.closest("[data-item-id]");
    const day = item?.closest("[data-day-panel]");
    if (day) {
      selectDay(day.dataset.dayPanel);
      const card = cards().find(node => node.dataset.travelItem === item.dataset.itemId);
      if (card) {
        clearSearchTarget();
        card.classList.add("is-travel-search-hit");
        jump(card);
        return card;
      }
    }
    if (!mark.closest("#itinerary-explore")) setMode(false, false);
    return mark;
  };
  const revealHash = () => {
    if (!isTravel() || !global.location.hash) return;
    const id = global.location.hash.slice(1);
    if (/^day-\d+$/.test(id) || id === "itinerary" || id === "itinerary-explore") return;
    const target = root.getElementById(id);
    if (target?.closest("main,header,footer")) {
      setMode(false, false);
      scrollToElement(target, false);
    }
  };
  const onScroll = () => {
    if (!isTravel() || frame || destination || directoryDialog?.open) return;
    frame = global.requestAnimationFrame(() => {
      frame = 0;
      if (!isTravel() || destination || directoryDialog?.open) return;
      const boundary = itinerary.querySelector("[data-day-tabs]").getBoundingClientRect().bottom + 40;
      const visible = cards().filter(card => card.getBoundingClientRect().top <= boundary);
      highlight(visible.at(-1) || cards()[0]);
    });
  };

  root.addEventListener("guide:before-day-change", () => { if (isTravel()) capture(); });
  directoryDialog?.addEventListener("cancel", event => { event.preventDefault(); closeDirectory(true); });
  directoryDialog?.addEventListener("click", event => { if (event.target === directoryDialog) closeDirectory(true); });
  root.addEventListener("guide:day-change", onDayChange);
  root.addEventListener("guide:map-marker-select", onMapMarker);
  root.addEventListener("click", onClick, true);
  global.addEventListener("hashchange", revealHash);
  global.addEventListener("popstate", revealHash);
  global.addEventListener("scroll", onScroll, { passive: true });
  global.addEventListener("wheel", () => { if (!directoryDialog?.open) destination = null; }, { passive: true });
  global.addEventListener("touchmove", () => { if (!directoryDialog?.open) destination = null; }, { passive: true });
  global.addEventListener("pagehide", () => { capture(); save(); });
  toggle.hidden = false;
  if (saved.mode === "travel" && (!global.location.hash || /^#day-\d+$/.test(global.location.hash))) {
    const remembered = [...itinerary.querySelectorAll("[data-day-panel]")].find(day =>
      (day.dataset.itineraryDate || day.dataset.dayPanel) === saved.date);
    if (remembered && !global.location.hash) selectDay(remembered.dataset.dayPanel);
    const rememberedOverview = overviewScroll;
    setMode(true);
    overviewScroll = rememberedOverview;
    save();
  }
  const api = { revealSearchHit, clearSearchTarget, revealOverview: () => setMode(false, false) };
  travelModeInstances.set(root, api);
  return api;
}
