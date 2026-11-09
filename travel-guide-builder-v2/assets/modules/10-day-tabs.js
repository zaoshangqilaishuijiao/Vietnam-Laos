/* ── 10  day tabs ── */
const dayTabsInstances = new WeakMap();
function initDayTabs(options = {}) {
  const root = options.root || document;
  const existing = dayTabsInstances.get(root);
  if (existing) return existing;
  const tabs = [...root.querySelectorAll(options.tabSelector || "[data-day-tab]")];
  const panels = [...root.querySelectorAll(options.panelSelector || "[data-day-panel]")];
  if (!tabs.length || tabs.length !== panels.length) return;
  const reduceMotion = global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const listeners = [];
  let activeIndex = Math.max(0, tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true"));
  let transitionToken = 0;
  const clearAnimation = (panel) => panel.classList.remove("is-entering-forward", "is-entering-backward");
  const select = (requestedIndex, settings = {}) => {
    const nextIndex = Math.min(tabs.length - 1, Math.max(0, Number(requestedIndex) || 0));
    const previousIndex = activeIndex;
    if (nextIndex !== previousIndex) root.dispatchEvent(new CustomEvent("guide:before-day-change"));
    const direction = nextIndex >= previousIndex ? "forward" : "backward";
    const targetTab = tabs[nextIndex];
    const targetPanel = panels[nextIndex];
    transitionToken += 1;
    const token = transitionToken;
    tabs.forEach((tab, index) => {
      const selected = index === nextIndex;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel, index) => {
      clearAnimation(panel);
      panel.hidden = index !== nextIndex;
      panel.setAttribute("aria-hidden", String(index !== nextIndex));
    });
    activeIndex = nextIndex;
    if (nextIndex !== previousIndex && !reduceMotion) {
      targetPanel.classList.add(`is-entering-${direction}`);
      const finish = () => { if (token === transitionToken) clearAnimation(targetPanel); };
      targetPanel.addEventListener("animationend", finish, { once: true });
      global.setTimeout(finish, 320);
    }
    if (settings.scroll !== false) targetTab.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest", inline: "center" });
    if (settings.focus) targetTab.focus({ preventScroll: true });
    if (settings.emit !== false) root.dispatchEvent(new CustomEvent("guide:day-change", { detail: { dayNumber: Number(targetTab.dataset.dayTab) || nextIndex + 1, date: targetPanel.dataset.itineraryDate || "", restorePosition: settings.restorePosition } }));
  };
  tabs.forEach((tab, index) => {
    const onClick = () => {
      select(index);
      if (/^#day-\d+$/.test(global.location.hash)) {
        try { global.history.replaceState(null, '', `#day-${tab.dataset.dayTab}`); } catch (_) { /* Local file history may be restricted. */ }
      }
    };
    const onKeyDown = (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabs.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      select(nextIndex, { focus: true });
      if (/^#day-\d+$/.test(global.location.hash)) {
        try { global.history.replaceState(null, '', `#day-${tabs[nextIndex].dataset.dayTab}`); } catch (_) { /* Selection does not depend on history support. */ }
      }
    };
    tab.addEventListener("click", onClick);
    tab.addEventListener("keydown", onKeyDown);
    listeners.push([tab, "click", onClick], [tab, "keydown", onKeyDown]);
  });
  select(activeIndex, { emit: false, scroll: false });
  const openDay = (dayNumber, focus = false, settings = {}) => {
    const index = tabs.findIndex(tab => Number(tab.dataset.dayTab) === Number(dayNumber));
    if (index < 0) return false;
    select(index, { focus, scroll: false, restorePosition: settings.restorePosition });
    const anchor = root.querySelector('[data-day-tabs]') || tabs[index];
    if (settings.scroll !== false) anchor.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    return true;
  };
  const onDayJump = event => {
    const control = event.target.closest?.('[data-day-jump]');
    if (!control || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || control.target === '_blank') return;
    if (!openDay(control.dataset.dayJump, true)) return;
    event.preventDefault();
    const hash = `#day-${Number(control.dataset.dayJump)}`;
    if (global.location.hash !== hash) {
      try { global.history.pushState(null, '', hash); } catch (_) { /* Selection still works without history access. */ }
    }
  };
  const onDayHash = () => {
    const match = /^#day-(\d+)$/.exec(global.location.hash);
    if (match) openDay(match[1]);
  };
  root.addEventListener('click', onDayJump);
  global.addEventListener('hashchange', onDayHash);
  global.addEventListener('popstate', onDayHash);
  listeners.push([root, 'click', onDayJump], [global, 'hashchange', onDayHash], [global, 'popstate', onDayHash]);
  onDayHash();
  const api = {
    select, openDay,
    destroy() {
      listeners.forEach(([node, type, listener]) => node.removeEventListener(type, listener));
      if (dayTabsInstances.get(root) === api) dayTabsInstances.delete(root);
    }
  };
  dayTabsInstances.set(root, api);
  return api;
}
