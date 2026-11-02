/* ── 03  search ── */
function initSearch(options = {}) {
  const root = options.root || document;
  const selectors = Object.assign({
    trigger: "#guide-search-trigger", panel: "#guide-search-panel", close: "#guide-search-close",
    clear: "#guide-search-clear", form: "#guide-search-form", input: "#guide-search-input",
    results: "#guide-search-results", previous: "#guide-search-prev", next: "#guide-search-next",
    count: "#guide-search-count", advanced: "#guide-search-advanced", index: "#travel-source-index"
  }, options.selectors || {});
  const el = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => [key, root.querySelector(selector)]));
  if (!el.trigger || !el.panel || !el.form || !el.input || !el.results || el.trigger.dataset.searchReady === "true") return;
  const sourceIndex = options.sourceIndex || readJsonIndex(selectors.index, root);
  let hits = [];
  let current = -1;
  let inputTimer = null;
  const setNavigation = () => {
    if (el.count) el.count.textContent = hits.length ? `${current + 1} / ${hits.length}` : "0 / 0";
    if (el.previous) el.previous.disabled = !hits.length;
    if (el.next) el.next.disabled = !hits.length;
  };
  const clearMarks = () => {
    const parents = new Set();
    root.querySelectorAll("mark.guide-search-hit").forEach((mark) => {
      if (mark.parentNode) parents.add(mark.parentNode);
      mark.replaceWith(document.createTextNode(mark.textContent || ""));
    });
    parents.forEach((parent) => parent.normalize?.());
    hits = []; current = -1;
    setNavigation();
  };
  const focus = (index) => {
    if (!hits.length) return;
    current = (index + hits.length) % hits.length;
    hits.forEach((mark, i) => mark.classList.toggle("is-current", i === current));
    setNavigation();
    const panel = hits[current].closest("[data-day-panel]");
    if (panel?.hidden) root.querySelector(`[data-day-tab="${panel.dataset.dayPanel}"]`)?.click();
    hits[current].scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
  };
  const markBody = (query) => {
    clearMarks();
    const term = text(query).toLowerCase();
    if (!term) return 0;
    const walker = root.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT, { acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !text(node.nodeValue)) return NodeFilter.FILTER_REJECT;
      if (parent.closest("#guide-search-panel,[data-guide-floating-tools],#sources,[data-guide-module='sources'],script,style,input,textarea,select,template,dialog:not([open])")) return NodeFilter.FILTER_REJECT;
      const hiddenAncestor = parent.closest("[hidden],[aria-hidden='true']");
      if (hiddenAncestor && !hiddenAncestor.hasAttribute("data-day-panel")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }});
    const nodes = []; let node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach((node) => {
      const source = node.nodeValue || "";
      const lower = source.toLowerCase();
      let cursor = 0; let changed = false; const fragment = document.createDocumentFragment();
      while (cursor < source.length) {
        const found = lower.indexOf(term, cursor);
        if (found < 0) { fragment.append(document.createTextNode(source.slice(cursor))); break; }
        if (found > cursor) fragment.append(document.createTextNode(source.slice(cursor, found)));
        const mark = document.createElement("mark");
        mark.className = "guide-search-hit";
        mark.textContent = source.slice(found, found + term.length);
        fragment.append(mark); hits.push(mark); changed = true; cursor = found + term.length;
      }
      if (changed) node.replaceWith(fragment);
    });
    if (hits.length) focus(0);
    return hits.length;
  };
  const sourceMatches = (query) => {
    const terms = chineseTerms(query);
    return sourceIndex.map((item) => {
      const sourceId = item.sourceId ?? item.number;
      const title = normalize(item.title);
      const cities = normalize([...(item.cities || []), item.city, item.place].join(" "));
      const tags = normalize((item.tags || []).join(" "));
      const searchHints = normalize((item.searchHints || []).join(" "));
      const score = terms.reduce((total, term) => total + (title.includes(term) ? 5 : 0) + (searchHints.includes(term) ? 4 : 0) + (cities.includes(term) ? 3 : 0) + (tags.includes(term) ? 2 : 0), 0);
      return { ...item, sourceId, score };
    }).filter((item) => Number.isInteger(Number(item.sourceId)) && item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
  };
  const showDefault = () => {
    el.results.innerHTML = '<p class="guide-search-hint"><span>普通搜索精确匹配攻略正文；</span><span>高级搜索模糊匹配资料来源。</span></p>';
  };
  const renderBody = () => {
    const query = text(el.input.value);
    if (!query) { clearMarks(); showDefault(); return; }
    const count = markBody(query);
    if (count) { el.results.innerHTML = `<p class="guide-search-hint">正文命中 ${count} 处，已定位首个结果。</p>`; return; }
    el.results.innerHTML = `<p class="guide-search-empty">攻略正文未找到"${escapeHtml(query)}"。可点击"高级搜索"查询资料来源。</p>`;
  };
  const renderSources = () => {
    const query = text(el.input.value);
    clearMarks();
    if (!query) { showDefault(); return; }
    if (!sourceIndex.length) { el.results.innerHTML = '<p class="guide-search-empty">本攻略未建立可用的资料来源索引。</p>'; return; }
    const matches = sourceMatches(query);
    el.results.innerHTML = matches.length
      ? `<p class="guide-search-hint">资料来源中找到 ${matches.length} 条相关笔记。</p>${matches.map((item) => `<article class="guide-search-result"><strong>[${escapeHtml(item.sourceId)}] ${escapeHtml(item.title)}</strong><small>${escapeHtml([...(item.cities || []), ...(item.tags || [])].join(" · "))}</small><small class="guide-search-result-hints">线索：${escapeHtml((item.searchHints || []).slice(0, 3).join(" · "))}</small><a href="#source-${escapeHtml(item.sourceId)}">查看资料来源</a></article>`).join("")}`
      : `<p class="guide-search-empty">资料来源中未找到"${escapeHtml(query)}"。</p>`;
  };
  const isMobileViewport = global.matchMedia?.("(max-width: 760px)")?.matches || Number(global.navigator?.maxTouchPoints || 0) > 0;
  const shouldAutoFocus = options.autoFocus ?? !isMobileViewport;
  const open = () => { root.dispatchEvent(new CustomEvent("guide:floating-actions-close")); el.panel.hidden = false; root.body?.classList.add("guide-search-open"); el.trigger.setAttribute("aria-expanded", "true"); if (!text(el.input.value)) showDefault(); if (shouldAutoFocus) el.input.focus(); };
  const close = () => { global.clearTimeout(inputTimer); clearMarks(); el.panel.hidden = true; root.body?.classList.remove("guide-search-open"); el.trigger.setAttribute("aria-expanded", "false"); (root.querySelector("[data-guide-floating-toggle]") || el.trigger).focus(); };
  const clear = () => { global.clearTimeout(inputTimer); el.input.value = ""; clearMarks(); showDefault(); el.input.focus(); };
  if (el.advanced && !sourceIndex.length) { el.advanced.disabled = true; el.advanced.title = "本攻略未建立资料来源索引"; }
  setNavigation();
  showDefault();
  el.trigger.addEventListener("click", () => el.panel.hidden ? open() : close());
  el.close?.addEventListener("click", close); el.clear?.addEventListener("click", clear);
  el.form.addEventListener("submit", (event) => { event.preventDefault(); global.clearTimeout(inputTimer); renderBody(); });
  el.advanced?.addEventListener("click", renderSources);
  el.input.addEventListener("input", () => { global.clearTimeout(inputTimer); inputTimer = global.setTimeout(renderBody, 120); });
  el.results.addEventListener("click", (event) => { if (event.target.closest('a[href^="#source-"]')) global.setTimeout(close, 0); });
  el.previous?.addEventListener("click", () => focus(current - 1)); el.next?.addEventListener("click", () => focus(current + 1));
  el.trigger.dataset.searchReady = "true";
  root.addEventListener("keydown", (event) => {
    const active = document.activeElement;
    const editing = /input|textarea|select/i.test(active?.tagName || "") || Boolean(active?.isContentEditable);
    if (event.key === "/" && !editing) { event.preventDefault(); open(); }
    if (event.key === "Escape" && !el.panel.hidden) close();
  });
  return Object.freeze({ open, close, clear, search: renderBody, advancedSearch: renderSources });
}
