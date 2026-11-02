/* ── 09  quick nav ── */
function initQuickNav(options = {}) {
  const root = options.root || document;
  const nav = options.nav || root.querySelector(options.selector || "[data-quick-nav], .quick-nav");
  if (!nav || nav.dataset.quickNavReady === "true") return;
  const sectionSelector = options.sectionSelector || "[data-nav-label][id]";
  const sections = [...root.querySelectorAll(sectionSelector)].filter((section) => !section.hidden && section.dataset.navHidden !== "true");
  const autoBuild = nav.hasAttribute("data-quick-nav") && nav.dataset.navManual !== "true";
  if (autoBuild) {
    const fragment = document.createDocumentFragment();
    sections.forEach((section) => {
      const label = text(section.dataset.navLabel);
      if (!label) return;
      const link = document.createElement("a");
      link.href = "#" + encodeURIComponent(section.id);
      link.textContent = label;
      fragment.append(link);
    });
    nav.replaceChildren(fragment);
  }
  const targetFor = (link) => {
    const id = decodeURIComponent((link.getAttribute("href") || "").slice(1));
    return id ? document.getElementById(id) : null;
  };
  const pairs = [...nav.querySelectorAll('a[href^="#"]')].map((link) => ({ link, target: targetFor(link) })).filter((item) => item.target);
  if (!pairs.length) { nav.hidden = true; return; }
  nav.hidden = false;
  nav.dataset.quickNavReady = "true";
  const reduceMotion = global.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  let activeTarget = null;
  let scheduled = null;
  const clock = () => global.performance?.now?.() || Date.now();
  let pointerGesture = null;
  let suppressPointerClickUntil = 0;
  let manualNavUntil = 0;
  let autoRevealUntil = 0;
  let lastPointerLink = null;
  let lastPointerClickAt = 0;
  const onNavPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointerGesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
  };
  const onNavPointerMove = (event) => {
    if (!pointerGesture || pointerGesture.id !== event.pointerId) return;
    const dx = Math.abs(event.clientX - pointerGesture.x);
    const dy = Math.abs(event.clientY - pointerGesture.y);
    if (dx > 8 && dx > dy) {
      pointerGesture.dragged = true;
      suppressPointerClickUntil = clock() + 450;
      manualNavUntil = clock() + 300;
    }
  };
  const finishNavPointer = () => {
    if (pointerGesture?.dragged) {
      suppressPointerClickUntil = clock() + 450;
      manualNavUntil = clock() + 300;
    }
    pointerGesture = null;
  };
  const onNavClickCapture = (event) => {
    const link = event.target.closest?.('a[href^="#"]');
    if (!link || !nav.contains(link)) return;
    const time = clock();
    const repeatedPointerClick = event.detail > 0 && lastPointerLink === link && time - lastPointerClickAt < 320;
    if (time < suppressPointerClickUntil || repeatedPointerClick) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    if (event.detail > 0) { lastPointerLink = link; lastPointerClickAt = time; }
  };
  const onNavWheel = () => { manualNavUntil = clock() + 300; };
  const onNavScroll = () => { if (clock() >= autoRevealUntil) manualNavUntil = clock() + 300; };
  const reveal = (link) => {
    if (pointerGesture?.dragged || clock() < manualNavUntil) return;
    const left = Math.max(0, link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2);
    autoRevealUntil = clock() + 700;
    if (typeof nav.scrollTo === "function") nav.scrollTo({ left, behavior: reduceMotion ? "auto" : "smooth" });
    else nav.scrollLeft = left;
  };
  const activate = (target, revealLink = true) => {
    if (!target || activeTarget === target) return;
    activeTarget = target;
    pairs.forEach((item) => {
      const active = item.target === target;
      item.link.classList.toggle("is-active", active);
      if (active) {
        item.link.setAttribute("aria-current", "location");
        if (revealLink) reveal(item.link);
      } else item.link.removeAttribute("aria-current");
    });
  };
  const updateOffset = () => {
    const top = Number.parseFloat(global.getComputedStyle?.(nav).top) || 0;
    const offset = Math.ceil(nav.getBoundingClientRect().height + top + 12);
    document.documentElement.style.setProperty("--guide-nav-offset", offset + "px");
  };
  const selectCurrent = () => {
    scheduled = null;
    const top = Number.parseFloat(global.getComputedStyle?.(nav).top) || 0;
    const activationLine = top + nav.getBoundingClientRect().height + 16;
    let current = pairs[0];
    pairs.forEach((item) => { if (item.target.getBoundingClientRect().top <= activationLine) current = item; });
    activate(current.target);
  };
  const schedule = () => {
    if (scheduled !== null) return;
    scheduled = global.requestAnimationFrame ? global.requestAnimationFrame(selectCurrent) : global.setTimeout(selectCurrent, 16);
  };
  const onHashChange = () => {
    const id = decodeURIComponent(global.location.hash.slice(1));
    const pair = pairs.find((item) => item.target.id === id);
    if (pair) activate(pair.target);
    else schedule();
  };
  const onClick = (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || !nav.contains(link)) return;
    const pair = pairs.find((item) => item.link === link);
    if (pair) activate(pair.target);
  };
  nav.addEventListener("click", onNavClickCapture, true);
  nav.addEventListener("click", onClick);
  nav.addEventListener("pointerdown", onNavPointerDown);
  nav.addEventListener("pointermove", onNavPointerMove);
  nav.addEventListener("pointerup", finishNavPointer);
  nav.addEventListener("pointercancel", finishNavPointer);
  nav.addEventListener("wheel", onNavWheel, { passive: true });
  nav.addEventListener("scroll", onNavScroll, { passive: true });
  global.addEventListener("scroll", schedule, { passive: true });
  global.addEventListener("resize", schedule);
  global.addEventListener("hashchange", onHashChange);
  const resizeObserver = global.ResizeObserver ? new global.ResizeObserver(() => { updateOffset(); schedule(); }) : null;
  resizeObserver?.observe(nav);
  updateOffset();
  onHashChange();
  schedule();
  return () => {
    nav.removeEventListener("click", onNavClickCapture, true);
    nav.removeEventListener("click", onClick);
    nav.removeEventListener("pointerdown", onNavPointerDown);
    nav.removeEventListener("pointermove", onNavPointerMove);
    nav.removeEventListener("pointerup", finishNavPointer);
    nav.removeEventListener("pointercancel", finishNavPointer);
    nav.removeEventListener("wheel", onNavWheel);
    nav.removeEventListener("scroll", onNavScroll);
    global.removeEventListener("scroll", schedule);
    global.removeEventListener("resize", schedule);
    global.removeEventListener("hashchange", onHashChange);
    resizeObserver?.disconnect();
    if (scheduled !== null) { if (global.cancelAnimationFrame) global.cancelAnimationFrame(scheduled); else global.clearTimeout(scheduled); }
  };
}
