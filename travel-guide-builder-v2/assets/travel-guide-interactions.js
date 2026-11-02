/* travel-guide-interactions: v46 */
(function initTravelGuideInteractions(global) {
  "use strict";



const text = (value) => String(value || "").trim();
const normalize = (value) => text(value).toLowerCase().replace(/\s+/g, " ");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const prefersReducedMotion = () => global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

const chineseTerms = (query) => {
  const normalized = normalize(query);
  const segments = normalized.match(/[\u4e00-\u9fff]+/g) || [];
  const pairs = segments.flatMap((segment) => [...segment].map((_, index) => segment.slice(index, index + 2)).filter((item) => item.length === 2));
  return [...new Set(normalized.split(" ").filter(Boolean).concat(segments, pairs))].sort((a, b) => b.length - a.length);
};


function readJsonIndex(selector, root = document) {
  const script = root.querySelector(selector);
  if (!script) return [];
  try { return JSON.parse(script.textContent || "[]"); } catch (error) { global.console?.warn?.(`旅行攻略数据索引解析失败：${selector}`, error); return []; }
}

const sourceLinkInstances = new WeakMap();
function initSourceLinks(options = {}) {
  const root = options.root || document;
  const existing = sourceLinkInstances.get(root);
  if (existing) return existing;
  const ownerDocument = root.nodeType === 9 ? root : (root.ownerDocument || document);
  const activeClass = options.activeClass || "source-flash";
  const duration = options.duration || 2000;
  const isMobile = options.isMobile || (() => global.navigator?.userAgentData?.mobile === true
    || /Android|iPhone|iPad|iPod|Mobile/i.test(global.navigator?.userAgent || "")
    || (global.navigator?.maxTouchPoints > 1 && /Macintosh/i.test(global.navigator?.userAgent || ""))
    || global.matchMedia?.("(pointer: coarse)")?.matches === true);
  const navigate = options.navigate || ((url) => global.location.assign(url));
  const isPageVisible = options.isPageVisible || (() => ownerDocument.visibilityState !== "hidden");
  const xhsFailureDelay = Number(options.xhsFailureDelay) || 1400;
  const toast = options.toast || initToast({ root: ownerDocument });
  let active = null;
  let timer = null;
  let xhsTimer = null;
  const clearXhsTimer = () => { global.clearTimeout(xhsTimer); xhsTimer = null; };
  const reportXhsFailure = (keyword) => {
    clearXhsTimer();
    ownerDocument.dispatchEvent(new CustomEvent("guide:xhs-open-failed", { detail: { keyword } }));
  };
  const onVisibilityChange = () => { if (!isPageVisible()) clearXhsTimer(); };
  const onXhsOpenFailed = async (event) => {
    const keyword = text(event.detail?.keyword);
    let copied = false;
    if (keyword) {
      try {
        if (global.navigator?.clipboard && global.isSecureContext) { await global.navigator.clipboard.writeText(keyword); copied = true; }
        else copied = Boolean(fallbackCopy(keyword, ownerDocument));
      } catch (_copyUnavailable) { copied = false; }
    }
    toast(copied ? `未能唤起小红书；“${keyword}”已复制` : `未能唤起小红书，请在 App 内搜索“${keyword || "该地点"}”`);
  };
  ownerDocument.addEventListener("visibilitychange", onVisibilityChange);
  ownerDocument.addEventListener("guide:xhs-open-failed", onXhsOpenFailed);
  const onClick = (event) => {
    const link = event.target.closest('a[href^="#source-"]');
    if (link) {
      const target = root.querySelector(link.getAttribute("href"));
      if (!target) return;
      event.preventDefault();
      if (active === target) {
        global.clearTimeout(timer);
        target.classList.remove(activeClass);
        active = null;
        return;
      }
      active?.classList.remove(activeClass);
      global.clearTimeout(timer);
      target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
      target.classList.add(activeClass);
      active = target;
      timer = global.setTimeout(() => {
        target.classList.remove(activeClass);
        if (active === target) active = null;
      }, duration);
      return;
    }
    const xhsLink = event.target.closest("a[data-xhs-link][data-xhs-deeplink]");
    if (!xhsLink || event.defaultPrevented || !isMobile()) return;
    const deeplink = xhsLink.dataset.xhsDeeplink;
    if (!deeplink) return;
    event.preventDefault();
    const keyword = xhsLink.dataset.xhsKeyword || "";
    clearXhsTimer();
    try {
      navigate(deeplink);
    } catch {
      reportXhsFailure(keyword);
      return;
    }
    xhsTimer = global.setTimeout(() => { if (isPageVisible()) reportXhsFailure(keyword); }, xhsFailureDelay);
  };
  root.addEventListener("click", onClick);
  const api = Object.freeze({
    destroy() {
      root.removeEventListener("click", onClick);
      global.clearTimeout(timer);
      clearXhsTimer();
      ownerDocument.removeEventListener("visibilitychange", onVisibilityChange);
      ownerDocument.removeEventListener("guide:xhs-open-failed", onXhsOpenFailed);
      active?.classList.remove(activeClass);
      active = null;
      if (sourceLinkInstances.get(root) === api) sourceLinkInstances.delete(root);
    }
  });
  sourceLinkInstances.set(root, api);
  return api;
}

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

function initToast(options = {}) {
  const root = options.root || document;
  const element = options.element || root.querySelector(options.selector || "#guide-toast") || (() => {
    const node = root.createElement("div");
    node.id = "guide-toast";
    node.className = "guide-toast";
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    root.body.append(node);
    return node;
  })();
  let timer = null;
  return (message) => {
    element.textContent = message;
    element.classList.add("is-visible");
    global.clearTimeout(timer);
    timer = global.setTimeout(() => element.classList.remove("is-visible"), options.duration || 1600);
  };
}

function fallbackCopy(value, root = document) {
  const input = root.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  root.body.append(input);
  input.select();
  const copied = root.execCommand?.("copy");
  input.remove();
  return copied;
}

function initCopyControls(options = {}) {
  const root = options.root || document;
  const selector = options.selector || "[data-copy], .copy-target";
  const nodes = [...root.querySelectorAll(selector)];
  if (!nodes.length) return;
  const toast = options.toast || initToast({ root });
  const ignored = new Set(options.ignore || []);
  nodes.forEach((node) => {
    if (node.dataset.copyReady === "true" || node.dataset.copyIgnore === "true") return;
    const getValue = () => text(node.dataset.copy || node.textContent).replace(/[：:]$/, "");
    const copy = async () => {
      const value = getValue();
      if (!value || ignored.has(value)) return;
      try {
        if (navigator.clipboard && global.isSecureContext) await navigator.clipboard.writeText(value);
        else if (!fallbackCopy(value, root)) throw new Error("copy unavailable");
        toast(options.successText || "已复制");
      } catch (_error) {
        if (fallbackCopy(value, root)) toast(options.successText || "已复制");
        else toast(options.failureText || "复制失败，请长按复制");
      }
    };
    if (!/^(button|a|input|textarea|select)$/i.test(node.tagName)) {
      node.tabIndex = 0;
      node.setAttribute("role", "button");
    }
    node.classList.add("copyable-name");
    node.dataset.copyReady = "true";
    node.addEventListener("click", copy);
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); copy(); }
    });
  });
}

function initChecklist(options = {}) {
  const root = options.root || document;
  const container = options.container || root.querySelector(options.containerSelector || "[data-checklist]");
  if (!container) return;
  const selector = options.selector || 'input[type="checkbox"][data-check]';
  const scope = options.storageKey || container.dataset?.checklist || root.body?.dataset.guideId || location.pathname;
  const editable = options.editable ?? container.dataset?.editable === "true";
  const storage = (suffix, fallback) => {
    const key = `travel-guide-check:${scope}:${suffix}`;
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch (_error) { return fallback; }
  };
  const save = (suffix, value) => { try { localStorage.setItem(`travel-guide-check:${scope}:${suffix}`, JSON.stringify(value)); } catch (_error) {} };
  const getLine = (input) => input.closest(options.itemSelector || "label,li,.check-item") || input.parentElement;
  const getText = (line) => line?.querySelector("[data-check-label], span") || null;
  const activeFilter = () => container.dataset.checklistActiveFilter || "all";
  const bind = (input) => {
    const id = input.dataset.check || input.id;
    if (!id || input.dataset.checkReady === "true") return;
    const line = getLine(input);
    const label = getText(line);
    const stateKey = `state:${id}`;
    const savedState = storage(stateKey, null);
    if (savedState !== null) input.checked = savedState === true;
    const apply = () => line?.classList.toggle("is-complete", input.checked);
    const savedText = storage(`text:${id}`, "");
    if (label && savedText) label.textContent = savedText;
    apply();
    input.dataset.checkReady = "true";
    input.addEventListener("change", () => { apply(); save(stateKey, input.checked); refreshProgress(); });
    if (editable && label) {
      label.dataset.checkLabel = "true";
      label.addEventListener("blur", () => save(`text:${id}`, text(label.textContent)), true);
    }
  };
  const list = container.querySelector("[data-checklist-items]") || container;
  const weatherCard = container.querySelector("[data-weather-card], .guide-weather-card");
  const insertBeforeWeather = (line) => {
    if (!weatherCard || !list.contains(weatherCard)) { list.append(line); return; }
    let anchor = weatherCard;
    while (anchor.parentElement && anchor.parentElement !== list) anchor = anchor.parentElement;
    list.insertBefore(line, anchor);
  };
  const refreshProgress = () => {
    const inputs = [...list.querySelectorAll(selector)];
    const done = inputs.filter((input) => input.checked).length;
    const percent = inputs.length ? Math.round(done / inputs.length * 100) : 0;
    const count = container.querySelector("[data-checklist-progress-count]");
    const percentNode = container.querySelector("[data-checklist-progress-percent]");
    const bar = container.querySelector("[data-checklist-progress-bar]");
    if (count) count.textContent = `${done} / ${inputs.length}`;
    if (percentNode) percentNode.textContent = `${percent}%`;
    if (bar) bar.style.width = `${percent}%`;
    inputs.forEach((input) => {
      const line = getLine(input);
      if (line) line.hidden = activeFilter() === "done" ? !input.checked : activeFilter() === "open" ? input.checked : false;
    });
  };
  const customItems = () => { const items = storage("custom", []); return Array.isArray(items) ? items : []; };
  const saveCustom = (items) => save("custom", items);
  const renderCustom = (item) => {
    const line = root.createElement("label");
    line.className = "guide-checklist-item is-custom";
    const input = root.createElement("input");
    input.type = "checkbox";
    input.dataset.check = item.id;
    const label = root.createElement("span");
    label.dataset.checkLabel = "true";
    label.textContent = item.text;
    const remove = root.createElement("button");
    remove.type = "button";
    remove.className = "guide-checklist-remove";
    remove.textContent = "删除";
    remove.setAttribute("aria-label", `删除确认项：${item.text}`);
    remove.addEventListener("click", () => {
      line.remove();
      saveCustom(customItems().filter((entry) => entry.id !== item.id));
      try {
        localStorage.removeItem(`travel-guide-check:${scope}:state:${item.id}`);
        localStorage.removeItem(`travel-guide-check:${scope}:text:${item.id}`);
      } catch (_error) {}
      refreshProgress();
      root.dispatchEvent(new CustomEvent("guide:checklist-custom-remove", { detail: { id: item.id } }));
    });
    line.append(input, label, remove);
    insertBeforeWeather(line);
    bind(input);
  };
  container.querySelectorAll(selector).forEach(bind);
  const filters = [...container.querySelectorAll("[data-checklist-filter]")];
  filters.forEach((button) => {
    if (button.dataset.checklistFilterReady === "true") return;
    button.dataset.checklistFilterReady = "true";
    button.addEventListener("click", () => {
      container.dataset.checklistActiveFilter = button.dataset.checklistFilter || "all";
      filters.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      refreshProgress();
    });
  });
  if (container.dataset.checklistRefreshBound !== "true") {
    container.addEventListener("guide:checklist-refresh", refreshProgress);
    container.dataset.checklistRefreshBound = "true";
  }
  refreshProgress();
  if (!editable || container.dataset.checklistReady === "true") return { refresh: refreshProgress };
  container.dataset.checklistReady = "true";
  customItems().filter((item) => item?.id && item?.text).forEach(renderCustom);
  const tools = root.createElement("div");
  tools.className = "guide-checklist-tools";
  tools.innerHTML = '<button type="button" data-checklist-toggle>编辑清单</button><div class="guide-checklist-add"><input type="text" maxlength="240" placeholder="添加确认项"><button type="button" data-checklist-add>添加</button></div>';
  container.prepend(tools);
  const toggle = tools.querySelector("[data-checklist-toggle]");
  const addBox = tools.querySelector(".guide-checklist-add");
  const addInput = addBox.querySelector("input");
  const add = () => {
    const value = text(addInput.value);
    if (!value) return;
    const item = { id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: value };
    saveCustom([...customItems(), item]);
    renderCustom(item);
    root.dispatchEvent(new CustomEvent("guide:checklist-custom-add", { detail: { item } }));
    addInput.value = "";
    addInput.focus();
    refreshProgress();
  };
  const setEditing = (active) => {
    container.classList.toggle("is-editing", active);
    toggle.textContent = active ? "完成编辑" : "编辑清单";
    container.querySelectorAll("[data-check-label]").forEach((label) => {
      const custom = Boolean(label.closest(".guide-checklist-item.is-custom"));
      label.contentEditable = String(active && custom);
    });
  };
  toggle.addEventListener("click", () => setEditing(!container.classList.contains("is-editing")));
  tools.querySelector("[data-checklist-add]").addEventListener("click", add);
  addInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); add(); } });
  refreshProgress();
  return { refresh: refreshProgress };
}

function initImagePreview(options = {}) {
  const root = options.root || document;
  const selector = options.selector || ".gallery img, [data-preview-image]";
  const triggers = [...root.querySelectorAll(selector)];
  if (!triggers.length) return;
  let dialog = options.dialog || root.querySelector(options.dialogSelector || "#imageDialog");
  if (!dialog) {
    dialog = root.createElement("dialog");
    dialog.className = "travel-image-dialog";
    dialog.innerHTML = '<button type="button" aria-label="关闭图片预览">×</button><img alt="">';
    root.body.append(dialog);
  }
  const image = dialog.querySelector("img");
  const closeButton = dialog.querySelector("button");
  if (!image || !closeButton) return;
  const close = dialog._travelPreviewClose || (() => {
    dialog.close?.();
    dialog.removeAttribute("open");
    dialog._travelLastFocus?.focus?.();
    dialog._travelLastFocus = null;
  });
  dialog._travelPreviewClose = close;
  triggers.forEach((trigger) => {
    if (trigger.dataset.previewReady === "true") return;
    const open = () => {
      dialog._travelLastFocus = root.activeElement;
      image.src = trigger.currentSrc || trigger.dataset.previewImage || trigger.src;
      image.alt = trigger.alt || "图片预览";
      if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    };
    trigger.tabIndex = trigger.tabIndex >= 0 ? trigger.tabIndex : 0;
    trigger.dataset.previewReady = "true";
    trigger.addEventListener("click", open);
    trigger.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
  });
  if (dialog.dataset.previewDialogReady !== "true") {
    closeButton.addEventListener("click", close);
    dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    dialog.dataset.previewDialogReady = "true";
  }
  return { close };
}

function initExchange(options = {}) {
  const root = options.root || document;
  const card = options.card || root.querySelector(options.cardSelector || '[data-exchange-tool], .exchange-tool-card, .exchange-card');
  if (!card) return;
  if (card.dataset.exchangeReady === "true") return card._exchangeController || null;
  const refreshButton = card.querySelector('[data-exchange-refresh], .exchange-refresh');
  const status = card.querySelector('[data-exchange-status], .exchange-status');
  const input = card.querySelector('[data-exchange-input], #exchange-amount');
  const lastUpdated = card.querySelector('[data-exchange-last-updated]');
  const localInput = card.querySelector('[data-exchange-local-input]');
  const currencyButtons = [...card.querySelectorAll('[data-exchange-currency]')];
  const localLabel = card.querySelector('[data-exchange-local-label]');
  const rateBase = card.querySelector('[data-exchange-rate-base]');
  const rateUsd = card.querySelector('[data-exchange-rate-usd]');
  const mnemonic = card.querySelector('[data-exchange-mnemonic]');
  const mnemonicExample = card.querySelector('[data-exchange-mnemonic-example]');
  const dialog = root.querySelector('[data-exchange-dialog]');
  const dialogTrigger = root.querySelector('[data-floating-action="exchange"]');
  const dialogClose = dialog?.querySelector('[data-exchange-dialog-close]');
  const comparison = root.querySelector('[data-exchange-comparison]');
  const compareAmount = comparison?.querySelector('[data-exchange-compare-amount]');
  const reverseAmount = comparison?.querySelector('[data-exchange-reverse-input]');
  const reverseCurrency = comparison?.querySelector('[data-exchange-reverse-currency]');
  const reverseResult = comparison?.querySelector('[data-exchange-reverse-result]');
  if (!refreshButton || !input) return;
  const writeStatus = (message, visible = true) => {
    if (!status) return;
    status.textContent = message;
    if (localInput) status.hidden = !visible;
  };
  const base = text(card.dataset.exchangeBase || options.base || 'CNY').toUpperCase();
  const configuredTargets = Array.isArray(options.targets) ? options.targets.join(',') : (card.dataset.exchangeTargets || options.targets || '');
  const targets = [...new Set(text(configuredTargets).split(',').map((item) => text(item).toUpperCase()).filter((item) => item && item !== base))];
  if (!targets.length) { refreshButton.disabled = true; writeStatus('请先配置目的地货币'); return; }
  const targetList = targets.join(',');
  const defaultEndpoint = `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;
  // Frankfurter v1 is retained only for non-CNY bases; do not present it as a CNY fallback.
  const fallbackEndpoint = base === "CNY" ? "" : `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(targetList)}`;
  const endpoints = [...new Set([card.dataset.exchangeEndpoint, options.endpoint, defaultEndpoint, fallbackEndpoint].filter(Boolean))];
  const fetchImpl = options.fetchImpl || global.fetch?.bind(global);
  let rates = null;
  let selectedCurrency = currencyButtons.find((button) => button.getAttribute('aria-pressed') === 'true')?.dataset.exchangeCurrency || targets[0];
  let lastEdited = localInput ? 'local' : 'cny';
  const format = (value) => Number.isFinite(value) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(value) : '—';
  const rateFormat = (value) => Number.isFinite(value) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value) : '—';
  const integerFormat = (value) => Number.isFinite(value) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value) : '—';
  const stamp = (date) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  const validAmount = (field) => field && field.value !== '' && Number.isFinite(Number(field.value)) && Number(field.value) >= 0;
  const updateMnemonic = () => {
    if (!mnemonic) return;
    const quote = Number(rates?.[selectedCurrency]);
    if (!(quote > 0)) {
      mnemonic.textContent = '刷新汇率后生成';
      if (mnemonicExample) { mnemonicExample.textContent = ''; mnemonicExample.hidden = true; }
      return;
    }
    let unit = 1;
    while (unit / quote < 2 && unit < 1000000000) unit *= 10;
    const factor = Math.round(unit / quote * 10) / 10;
    const factorText = rateFormat(factor);
    mnemonic.textContent = unit === 1 ? `当地金额 × ${factorText} ≈ 人民币` : `当地金额 ÷ ${integerFormat(unit)} × ${factorText} ≈ 人民币`;
    if (mnemonicExample) {
      mnemonicExample.textContent = unit > 1 ? `整${unit === 10000 ? '万' : integerFormat(unit)}标价：去掉 ${String(unit).length - 1} 个 0，再乘 ${factorText}` : '';
      mnemonicExample.hidden = unit === 1;
    }
  };
  const updateRateLabels = () => {
    targets.forEach((currency) => {
      const node = card.querySelector(`[data-exchange-rate="${currency}"]`);
      if (!node) return;
      const quote = rates?.[currency];
      node.textContent = Number.isFinite(quote) && quote > 0 ? `1 ${base} ≈ ${format(quote)} ${currency}` : '待刷新';
    });
    if (rateBase) {
      const quote = Number(rates?.[selectedCurrency]);
      rateBase.textContent = quote > 0 ? `1 ${base} ≈ ${rateFormat(quote)} ${selectedCurrency}` : '刷新后获取参考汇率';
      const usdQuote = Number(rates?.USD);
      const localPerUsd = quote > 0 && usdQuote > 0 && selectedCurrency !== 'USD' ? quote / usdQuote : null;
      if (rateUsd) {
        rateUsd.hidden = !localPerUsd;
        rateUsd.textContent = localPerUsd ? `1 USD ≈ ${integerFormat(localPerUsd)} ${selectedCurrency}` : '';
      }
      if (localLabel) {
        const name = currencyButtons.find((button) => button.dataset.exchangeCurrency === selectedCurrency)?.textContent?.trim().replace(/\s+/g, ' ') || selectedCurrency;
        localLabel.textContent = `当地货币 · ${name}`;
      }
      updateMnemonic();
    }
  };
  const updateResults = () => {
    const value = Number(input.value);
    targets.forEach((currency) => {
      const node = card.querySelector(`[data-exchange-result="${currency}"]`);
      if (!node) return;
      if (!rates) { node.textContent = '请先刷新汇率'; return; }
      if (!Number.isFinite(value) || value < 0) { node.textContent = '请输入有效金额'; return; }
      const converted = value * Number(rates[currency]);
      node.textContent = Number.isFinite(converted) ? `${format(converted)} ${currency}` : '暂无法换算';
    });
    if (reverseResult) {
      const value = Number(reverseAmount?.value);
      const quote = Number(rates?.[reverseCurrency?.value]);
      reverseResult.textContent = Number.isFinite(value) && value >= 0 && quote > 0 ? `约 ${format(value / quote)} CNY（中间价）` : '刷新汇率后换算成人民币';
    }
    if (localInput) {
      const quote = Number(rates?.[selectedCurrency]);
      if (!(quote > 0)) { if (lastEdited === 'local') input.value = ''; else localInput.value = ''; }
      else if (lastEdited === 'local') input.value = validAmount(localInput) ? (Number(localInput.value) / quote).toFixed(2) : '';
      else {
        const wholeUnits = ['VND', 'LAK', 'JPY', 'KRW', 'IDR'].includes(selectedCurrency);
        localInput.value = validAmount(input) ? (wholeUnits ? String(Math.round(Number(input.value) * quote)) : (Number(input.value) * quote).toFixed(2)) : '';
      }
    }
  };
  const updateChannelComparison = () => {
    const amount = Number(compareAmount?.value);
    comparison?.querySelectorAll('[data-exchange-channel]').forEach((channel) => {
      const output = channel.querySelector('[data-exchange-channel-result]');
      const fields = ['rate', 'feeCny', 'feePercent', 'feeLocal'];
      if (!Number.isFinite(amount) || amount < 0 || fields.some((key) => channel.dataset[key] === '')) { output.textContent = '数据不足，无法比较'; return; }
      const rate = Number(channel.dataset.rate), feeCny = Number(channel.dataset.feeCny), feePercent = Number(channel.dataset.feePercent), feeLocal = Number(channel.dataset.feeLocal);
      const net = (amount - feeCny - amount * feePercent / 100) * rate - feeLocal;
      output.textContent = rate > 0 && net >= 0 ? `约 ${format(net)} ${channel.dataset.currency}` : '数据不足，无法比较';
    });
  };
  const readRates = (payload) => {
    if (payload?.rates && typeof payload.rates === 'object') {
      const parsed = Object.fromEntries(Object.entries(payload.rates).map(([key, value]) => [String(key).toUpperCase(), Number(value)]));
      parsed[base] = 1;
      return parsed;
    }
    return null;
  };
  const request = async (endpoint) => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? global.setTimeout(() => controller.abort(), 12000) : null;
    try {
      const response = await fetchImpl(endpoint, { headers: { Accept: 'application/json' }, cache: 'no-store', mode: 'cors', signal: controller?.signal });
      if (!response.ok) throw new Error(`exchange request failed: ${response.status}`);
      const payload = await response.json();
      const nextRates = readRates(payload);
      if (!nextRates || targets.some((currency) => !Number.isFinite(nextRates[currency]) || nextRates[currency] <= 0)) throw new Error('exchange response incomplete');
      return { rates: nextRates, date: payload.time_last_update_utc || payload.date || '', endpoint };
    } finally {
      if (timer) global.clearTimeout(timer);
    }
  };
  const refresh = async () => {
    if (!fetchImpl) { writeStatus('当前环境无法请求汇率，请稍后重试'); return; }
    refreshButton.disabled = true;
    card.classList.add('is-loading');
    writeStatus('正在获取当前汇率…');
    let result = null;
    for (const endpoint of endpoints) {
      try { result = await request(endpoint); break; } catch (_error) { /* try the next public source */ }
    }
    if (result) {
      rates = result.rates;
      updateRateLabels();
      updateResults();
      if (lastUpdated) {
        lastUpdated.textContent = `更新时间：${stamp(new Date())}${result.date ? `；数据日期：${result.date}` : ''}`;
        lastUpdated.hidden = false;
      }
      writeStatus('已更新；数据仅作中间价参考。', !localInput);
    } else {
      updateRateLabels();
      updateResults();
      writeStatus(global.location?.protocol === 'file:' ? '本地 file:// 可能限制跨域请求，请用本地 HTTP 打开后刷新' : '汇率接口暂时不可用，请稍后再次点击"刷新汇率"。');
    }
    refreshButton.disabled = false;
    card.classList.remove('is-loading');
  };
  const onInput = () => { lastEdited = 'cny'; updateResults(); };
  const onLocalInput = () => { lastEdited = 'local'; updateResults(); };
  const onCurrencyClick = (event) => {
    const next = event.currentTarget.dataset.exchangeCurrency;
    if (!targets.includes(next) || next === selectedCurrency) return;
    const previousQuote = Number(rates?.[selectedCurrency]);
    if (lastEdited === 'local' && previousQuote > 0 && validAmount(localInput)) input.value = (Number(localInput.value) / previousQuote).toFixed(2);
    selectedCurrency = next;
    lastEdited = 'cny';
    currencyButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.exchangeCurrency === next)));
    updateRateLabels();
    updateResults();
  };
  const onRefreshClick = () => refresh();
  const onInputKeyDown = (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!refreshButton.disabled) refresh();
  };
  const onDialogOpen = () => {
    const View = root.defaultView || globalThis;
    root.dispatchEvent(new View.CustomEvent('guide:floating-actions-close'));
    if (typeof dialog?.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog?.setAttribute('open', '');
    localInput?.focus({ preventScroll: true });
  };
  const onDialogCloseClick = () => {
    if (typeof dialog?.close === 'function' && dialog.open) dialog.close();
    else { dialog?.removeAttribute('open'); root.querySelector('[data-guide-floating-toggle]')?.focus({ preventScroll: true }); }
  };
  const onDialogBackdropClick = (event) => { if (event.target === dialog) onDialogCloseClick(); };
  const onDialogClosed = () => root.querySelector('[data-guide-floating-toggle]')?.focus({ preventScroll: true });
  input.addEventListener('input', onInput);
  localInput?.addEventListener('input', onLocalInput);
  currencyButtons.forEach((button) => button.addEventListener('click', onCurrencyClick));
  compareAmount?.addEventListener('input', updateChannelComparison);
  reverseAmount?.addEventListener('input', onInput);
  reverseCurrency?.addEventListener('change', onInput);
  if (!localInput) input.addEventListener('keydown', onInputKeyDown);
  refreshButton.addEventListener('click', onRefreshClick);
  dialogTrigger?.addEventListener('click', onDialogOpen);
  dialogClose?.addEventListener('click', onDialogCloseClick);
  dialog?.addEventListener('click', onDialogBackdropClick);
  dialog?.addEventListener('close', onDialogClosed);
  updateRateLabels();
  updateResults();
  updateChannelComparison();
  const api = Object.freeze({
    refresh,
    update: updateResults,
    destroy() {
      input.removeEventListener('input', onInput);
      localInput?.removeEventListener('input', onLocalInput);
      currencyButtons.forEach((button) => button.removeEventListener('click', onCurrencyClick));
      compareAmount?.removeEventListener('input', updateChannelComparison);
      reverseAmount?.removeEventListener('input', onInput);
      reverseCurrency?.removeEventListener('change', onInput);
      if (!localInput) input.removeEventListener('keydown', onInputKeyDown);
      refreshButton.removeEventListener('click', onRefreshClick);
      dialogTrigger?.removeEventListener('click', onDialogOpen);
      dialogClose?.removeEventListener('click', onDialogCloseClick);
      dialog?.removeEventListener('click', onDialogBackdropClick);
      dialog?.removeEventListener('close', onDialogClosed);
      delete card.dataset.exchangeReady;
      delete card._exchangeController;
    }
  });
  card.dataset.exchangeReady = "true";
  card._exchangeController = api;
  return api;
}

function initWeatherForecast(options = {}) {
  const root = options.root || document;
  const card = options.card || root.querySelector(options.cardSelector || "[data-weather-card]");
  if (!card || card.dataset.weatherReady === "true") return;
  const refreshButton = card.querySelector("[data-weather-refresh]");
  const status = card.querySelector("[data-weather-status]");
  const grid = card.querySelector("[data-weather-grid]");
  const dataKind = card.querySelector("[data-weather-data-kind]");
  const updatedAt = card.querySelector("[data-weather-updated-at]");
  const easterEgg = card.querySelector("[data-rain-easter-egg]");
  if (!refreshButton || !status || !grid) return;
  const locations = options.locations || readJsonIndex("[data-weather-locations]", card);
  const startDate = text(options.startDate || card.dataset.weatherStartDate);
  const endDate = text(options.endDate || card.dataset.weatherEndDate);
  const days = Math.min(7, Math.max(1, Number(options.days || card.dataset.weatherDays || 7)));
  const threshold = Number(options.rainThreshold || card.dataset.rainThreshold || 80);
  const fetchImpl = options.fetchImpl || global.fetch?.bind(global);
  const weatherText = { 0: "晴", 1: "大致晴朗", 2: "多云", 3: "阴", 45: "雾", 48: "雾凇", 51: "毛毛雨", 53: "毛毛雨", 55: "强毛毛雨", 61: "小雨", 63: "中雨", 65: "大雨", 80: "阵雨", 81: "阵雨", 82: "强阵雨", 95: "雷暴", 96: "雷暴伴冰雹", 99: "强雷暴伴冰雹" };
  const format = (value, digits = 0) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
  const dateOnly = (date) => new Date(date + "T00:00:00");
  const formatDate = (date) => date ? date.slice(5).replace("-", "/") : "—";
  const localIsoDate = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  const addDays = (date, amount) => { const next = dateOnly(date); next.setDate(next.getDate() + amount); return localIsoDate(next); };
  const weatherCacheKey = `travel-guide-weather-summary:v2:${location.pathname}:${startDate}:${endDate}:${JSON.stringify(locations.map(item => [item.placeId, item.name, item.latitude, item.longitude]))}`;
  const locationKey = item => item.placeId || item.name;
  const rowsForLocation = (rows, item) => rows[locationKey(item)] || (locations.filter(other => other.name === item.name).length === 1 ? rows[item.name] : null);
  const applyDayWeather = (summary) => {
    root.querySelectorAll("[data-itinerary-date]").forEach((day) => {
      const badge = day.querySelector("[data-day-weather]");
      if (!badge) return;
      const matches = locations.filter(item => day.dataset.weatherPlaceId
        ? item.placeId === day.dataset.weatherPlaceId
        : item.name === day.dataset.city);
      const selected = matches.length === 1 ? matches[0] : (!day.dataset.city && !day.dataset.weatherPlaceId && locations.length === 1 ? locations[0] : null);
      const row = selected ? summary?.[locationKey(selected)]?.[day.dataset.itineraryDate] : null;
      badge.textContent = row ? `${row.weather} · 降雨 ${row.chance}% · ${row.min}–${row.max}°C` : "天气待刷新";
      badge.title = selected ? `天气地点：${selected.name}` : '尚未匹配当天预报地点';
      badge.setAttribute('aria-label', selected ? `${selected.name}：${badge.textContent}` : badge.textContent);
      badge.classList.toggle("is-risk", Boolean(row && row.chance >= threshold));
    });
  };
  const syncDayWeather = (rowsByLocation) => {
    const summary = Object.fromEntries(locations.map(item => [locationKey(item), Object.fromEntries(
      (rowsForLocation(rowsByLocation, item) || []).map(row => [row.date, { weather: row.weather, chance: Math.round(Number(row.chance) || 0), min: Math.round(Number(row.min)), max: Math.round(Number(row.max)) }])
    )]));
    applyDayWeather(summary);
    try { sessionStorage.setItem(weatherCacheKey, JSON.stringify(summary)); } catch (_error) {}
  };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tripStart = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? dateOnly(startDate) : null;
  const tripEnd = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? dateOnly(endDate) : (tripStart ? dateOnly(addDays(startDate, days - 1)) : null);
  const daysUntilStart = tripStart ? Math.round((tripStart - today) / 86400000) : 0;
  const withinForecastWindow = !tripStart || (daysUntilStart <= 7 && (!tripEnd || today <= tripEnd));
  const enabled = options.enabled ?? (card.dataset.weatherEnabled === "true" || (card.dataset.weatherEnabled !== "false" && withinForecastWindow));
  const tagHtml = (row) => {
    const items = [];
    if (row.rain >= 10 || row.hours >= 5 || /雷暴/.test(row.weather)) items.push(["室内备选", "risk"]);
    else if (row.rain >= 3 || row.hours >= 2 || row.chance >= 50) items.push(["带雨具", "warn"]);
    else items.push(["户外可行", "good"]);
    if (row.gust >= 40) items.push(["船班核验", "risk"]);
    if (row.feel >= 35 && row.uv >= 8) items.push(["高温防晒", "warn"]);
    else if (row.uv >= 8) items.push(["防晒", "warn"]);
    return items.map(([label, kind]) => '<span class="guide-weather-chip ' + kind + '">' + label + "</span>").join("");
  };
  const render = (rowsByLocation) => {
    grid.innerHTML = locations.map((location) => {
      const rows = rowsForLocation(rowsByLocation, location);
      if (!rows) return '<article class="guide-weather-location is-error"><h4>' + escapeHtml(location.name) + "<small>" + escapeHtml(location.label || "") + '</small></h4><p class="guide-weather-location-error">该地点暂时获取失败，请稍后重试。</p></article>';
      const body = rows.map((row) => '<tr><td>' + formatDate(row.date) + '</td><td class="weather">' + escapeHtml(row.weather) + "<br>" + format(row.min) + "–" + format(row.max) + '°C</td><td class="metric">最高约 ' + format(row.feel) + '°C</td><td class="metric">' + format(row.rain, 1) + " mm · " + format(row.hours) + " 小时<br>降雨 " + format(row.chance) + '%</td><td class="metric">' + format(row.gust) + " km/h · UV " + format(row.uv) + "<br>日落 " + escapeHtml(row.sunset || "待核验") + '</td><td class="key">' + tagHtml(row) + "</td></tr>").join("");
      return '<article class="guide-weather-location"><h4>' + escapeHtml(location.name) + "<small>" + escapeHtml(location.label || "") + '</small></h4><div class="guide-weather-table-wrap"><table class="guide-weather-table"><thead><tr><th>日期</th><th>天气 / 温度</th><th>体感</th><th>雨量 / 雨时</th><th>阵风 / UV / 日落</th><th>关键提示</th></tr></thead><tbody>' + body + "</tbody></table></div></article>";
    }).join("");
    if (easterEgg) easterEgg.hidden = !Object.values(rowsByLocation).some((rows) => rows?.some((row) => Number(row.chance) >= threshold));
    syncDayWeather(rowsByLocation);
  };
  const requestWithRetry = async (url, opts, maxAttempts = 3) => {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? global.setTimeout(() => controller.abort(), 12000) : null;
      try {
        const response = await fetchImpl(url, { ...opts, signal: controller?.signal });
        if (response.ok) return response;
        if (response.status >= 400 && response.status < 500) throw new Error("HTTP " + response.status);
        if (attempt === maxAttempts - 1) throw new Error("HTTP " + response.status);
      } catch (error) {
        if (attempt === maxAttempts - 1) throw error;
      } finally { if (timer) global.clearTimeout(timer); }
      await new Promise((resolve) => global.setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  };
  const requestLocation = async (location) => {
    if (!fetchImpl) throw new Error("fetch unavailable");
    const todayIso = localIsoDate(new Date());
    const queryStart = tripStart && today > tripStart ? todayIso : (startDate || todayIso);
    const plannedEnd = addDays(queryStart, days - 1);
    const queryEnd = tripEnd && dateOnly(plannedEnd) > tripEnd ? localIsoDate(tripEnd) : plannedEnd;
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: location.latitude, longitude: location.longitude,
      daily: "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_sum,precipitation_hours,precipitation_probability_max,wind_gusts_10m_max,uv_index_max,sunset",
      timezone: location.timezone || options.timezone || "auto", start_date: queryStart, end_date: queryEnd
    });
    const response = await requestWithRetry(url, { cache: "no-store", headers: { Accept: "application/json" } });
    const daily = (await response.json()).daily;
    if (!daily?.time?.length) throw new Error(location.name + " weather response empty");
    return [locationKey(location), daily.time.map((date, index) => ({
      date, weather: weatherText[daily.weather_code[index]] || "待核验",
      min: daily.temperature_2m_min[index], max: daily.temperature_2m_max[index], feel: daily.apparent_temperature_max[index],
      rain: daily.precipitation_sum[index] || 0, hours: daily.precipitation_hours[index] || 0,
      chance: daily.precipitation_probability_max[index] || 0, gust: daily.wind_gusts_10m_max[index] || 0,
      uv: daily.uv_index_max[index] || 0, sunset: (daily.sunset[index] || "").slice(11, 16)
    }))];
  };
  const refresh = async () => {
    refreshButton.disabled = true;
    card.classList.add("is-loading");
    refreshButton.textContent = "正在刷新…";
    status.textContent = "正在获取 " + locations.map((item) => item.name).join("、") + " 的体感、雨量、阵风、UV 与日落…";
    try {
      if (!locations.length) throw new Error("weather locations missing");
      const settled = await Promise.allSettled(locations.map(requestLocation));
      const successes = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
      if (!successes.length) throw new Error("all weather requests failed");
      const rows = Object.fromEntries(successes);
      const failedCount = settled.length - successes.length;
      render(rows);
      if (dataKind) { dataKind.textContent = failedCount ? "部分刷新成功" : "已刷新：Open‑Meteo 预报"; dataKind.classList.remove("is-waiting"); }
      status.textContent = failedCount
        ? "已显示 " + successes.length + " 个地点，" + failedCount + " 个地点暂时获取失败；官方公告优先。"
        : "天气已刷新。关键标签用于快速调整节奏；灾害预警、海况、道路及交通仍以官方公告为准。";
      if (updatedAt) updatedAt.innerHTML = "<strong>更新时间：</strong>" + new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date());
    } catch (_error) {
      status.textContent = global.location?.protocol === "file:" ? "本地 file:// 可能限制天气请求，请用本地 HTTP 打开后重试；正文不受影响。" : "暂无法获取天气，请稍后重试，并以官方公告为准。";
    } finally {
      refreshButton.disabled = false;
      card.classList.remove("is-loading");
      refreshButton.textContent = "刷新天气";
    }
  };
  const modal = card.querySelector("[data-rain-prayer-modal]");
  const frame = card.querySelector("[data-rain-prayer-frame]");
  const closeButton = card.querySelector("[data-rain-prayer-close]");
  const openButton = card.querySelector("[data-rain-prayer-open]");
  const prayerSource = readJsonIndex("[data-rain-prayer-source]", card);
  let prayerLastFocus = null;
  const closePrayer = () => { if (!modal || !frame) return; modal.hidden = true; frame.srcdoc = ""; root.body.style.overflow = ""; prayerLastFocus?.focus?.(); prayerLastFocus = null; };
  openButton?.addEventListener("click", (event) => {
    event.preventDefault();
    if (!modal || !frame || typeof prayerSource !== "string") return;
    prayerLastFocus = root.activeElement;
    closeButton.hidden = true;
    frame.srcdoc = prayerSource;
    modal.hidden = false;
    root.body.style.overflow = "hidden";
    const panel = modal.querySelector(".guide-rain-prayer-panel");
    if (panel && !panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
    panel?.focus?.({ preventScroll: true });
  });
  closeButton?.addEventListener("click", closePrayer);
  root.addEventListener("keydown", (event) => { if (event.key === "Escape" && modal && !modal.hidden) closePrayer(); });
  global.addEventListener("message", (event) => {
    if (frame && event.source === frame.contentWindow && event.data?.type === "rain-prayer-complete") closeButton.hidden = false;
  });
  card.dataset.weatherReady = "true";
  refreshButton.disabled = !enabled;
  refreshButton.textContent = enabled ? "刷新天气" : "T-7 开启";
  refreshButton.title = enabled ? "手动刷新天气" : "将在行程开始前 7 天开放天气刷新";
  refreshButton.setAttribute("aria-label", refreshButton.title);

  try { applyDayWeather(JSON.parse(sessionStorage.getItem(weatherCacheKey) || "null")); } catch (_error) {}

  if (!enabled && dataKind) dataKind.textContent = "预测窗口尚未开启";
  status.textContent = enabled ? '点击刷新查看预报。' : options.disabledText || "出发前 7 天开放预报。";
  refreshButton.addEventListener("click", refresh);
  return { refresh, render };
}

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
    if (settings.emit !== false) root.dispatchEvent(new CustomEvent("guide:day-change", { detail: { dayNumber: Number(targetTab.dataset.dayTab) || nextIndex + 1, date: targetPanel.dataset.itineraryDate || "" } }));
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
  const openDay = (dayNumber, focus = false) => {
    const index = tabs.findIndex(tab => Number(tab.dataset.dayTab) === Number(dayNumber));
    if (index < 0) return false;
    select(index, { focus, scroll: false });
    const anchor = root.querySelector('[data-day-tabs]') || tabs[index];
    anchor.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
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
    select,
    destroy() {
      listeners.forEach(([node, type, listener]) => node.removeEventListener(type, listener));
      if (dayTabsInstances.get(root) === api) dayTabsInstances.delete(root);
    }
  };
  dayTabsInstances.set(root, api);
  return api;
}

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
    item.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focus(item); } });
  });
  root.querySelectorAll("[data-show-day-map]").forEach((button) => {
    if (button.dataset.dayMapReady === "true") return;
    button.dataset.dayMapReady = "true";
    button.addEventListener("click", () => {
      const control = root.querySelector(`[data-day-tab="${CSS.escape(button.dataset.showDayMap)}"]`);
      control?.click();
      root.querySelector("#itinerary-explore")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    });
  });
}

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

function initExpenseTracker(options = {}) {
  const root = options.root || document;
  const card = root.querySelector("[data-expense-tracker]");
  if (!card || card.dataset.expenseReady === "true") return;
  const fields = { date: card.querySelector("[data-expense-date]"), name: card.querySelector("[data-expense-name]"), amount: card.querySelector("[data-expense-amount]") };
  const list = card.querySelector("[data-expense-list]");
  const totalNode = card.querySelector("[data-expense-total]");
  const compareNode = card.querySelector("[data-expense-compare]");
  const currency = card.dataset.currency || "CNY";
  const budgetMax = Number(card.dataset.budgetMax) || 0;
  const storageKey = `travel-guide-expenses:${root.body?.dataset?.guideId || location.pathname}`;
  let recoveryWarning = "";
  let storageWritable = true;
  const notice = document.createElement("p"); notice.setAttribute("role", "status"); card.append(notice);
  const load = () => {
    let raw;
    try {
      raw = localStorage.getItem(storageKey);
      const value = JSON.parse(raw || "[]");
      if (!Array.isArray(value) || value.some(item => !item?.id || !Number.isFinite(Number(item.amount)))) throw Error("invalid expense data");
      return value;
    } catch (_error) {
      recoveryWarning = "原支出记录未能恢复，已保留原始内容；本次记录请及时导出。";
      storageWritable = false;
      if (raw) { try { localStorage.setItem(storageKey + ":recovery:" + Date.now(), raw); } catch (_) {} }
      return [];
    }
  };
  const save = (items) => {
    if (!storageWritable) return;
    try { localStorage.setItem(storageKey, JSON.stringify(items)); }
    catch (_error) { recoveryWarning = "浏览器无法保存，当前记录请及时导出。"; }
  };
  const csvCell = (value) => {
    const raw = String(value == null ? "" : value);
    const safe = /^[=+\-@]/.test(raw.trimStart()) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  let items = load().filter((item) => item?.id && Number.isFinite(Number(item.amount)));
  const render = () => {
    notice.textContent = recoveryWarning; notice.hidden = !recoveryWarning;
    const total = items.reduce((sum, item) => sum + Number(item.amount), 0);
    totalNode.textContent = `${total.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${currency}`;
    compareNode.textContent = budgetMax ? `占计划预算上限 ${Math.round(total / budgetMax * 100)}%` : "已记录实际支出";
    list.innerHTML = items.map((item) => `<li><time>${escapeHtml(item.date || "未填日期")}</time><span>${escapeHtml(item.name)}</span><strong>${Number(item.amount).toLocaleString("zh-CN")} ${escapeHtml(currency)}</strong><button type="button" data-expense-remove="${escapeHtml(item.id)}">删除</button></li>`).join("");
  };
  card.querySelector("[data-expense-add]")?.addEventListener("click", () => {
    const name = text(fields.name?.value); const amount = Number(fields.amount?.value);
    if (!name || !Number.isFinite(amount) || amount <= 0) return;
    items.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, date: fields.date?.value || "", name, amount });
    save(items); render(); fields.name.value = ""; fields.amount.value = ""; fields.name.focus();
  });
  list?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-expense-remove]"); if (!button) return;
    items = items.filter((item) => item.id !== button.dataset.expenseRemove); save(items); render();
  });
  card.querySelector("[data-expense-export]")?.addEventListener("click", () => {
    const csv = ["日期,项目,金额,币种", ...items.map((item) => [item.date, item.name, item.amount, currency].map(csvCell).join(","))].join("\r\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })); link.download = "travel-expenses.csv"; link.click(); global.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  card.dataset.expenseReady = "true"; render();
  return { render, escapeCsvCell: csvCell };
}

function initBookingLedger({ root = document } = {}) {
  const storagePrefix = `travel-guide-bookings:${root.body?.dataset?.guideId || location.pathname}:`;
  const labels = { confirmed: "已预订", pending: "待预订", verify: "待核验" };
  root.querySelectorAll('[data-booking-toggle][data-local-booking="true"]').forEach((button) => {
    if (button.dataset.bookingReady === "true") return;
    const key = button.dataset.bookingId; if (!key) return;
    const apply = (status) => { button.classList.remove("is-confirmed", "is-pending", "is-verify"); button.classList.add(`is-${status}`); button.dataset.bookingStatus = status; button.textContent = labels[status] || labels.verify; button.setAttribute("aria-pressed", String(status === "confirmed")); };
    let status = button.dataset.bookingInitialStatus || "verify";
    try { status = localStorage.getItem(storagePrefix + key) || status; } catch (_error) {}
    apply(status);
    button.addEventListener("click", () => { const current = button.dataset.bookingStatus || status; status = current === "confirmed" ? "pending" : current === "pending" ? "verify" : "confirmed"; apply(status); try { localStorage.setItem(storagePrefix + key, status); } catch (_error) {} });
    button.dataset.bookingReady = "true";
  });
  return { refresh: () => initBookingLedger({ root }) };
}

const FLIGHT_OCR_MODULE_URL = "https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm";
const FLIGHT_OCR_WASM_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/";
const FLIGHT_IMAGE_DB = "travel-guide-flight-assets-v1";
const FLIGHT_OCR_TIMEOUT_MS = 45000;
let flightOcrPromise = null;

const flightText = value => String(value == null ? "" : value).trim();
const flightEscape = value => typeof escapeHtml === "function"
  ? escapeHtml(value)
  : flightText(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const FLIGHT_SENSITIVE = /姓名|乘机人|旅客|证件|护照|订单|票号|二维码|条[形]?码|\b(?:PNR|PASSENGER|PASSPORT|TICKET\s*(?:NO|NUMBER)|BOOKING\s*REF)\b/i;
const flightId = () => `f-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function sanitizeFlightRecord(item = {}, index = 0) {
  const clean = (value, max = 80) => {
    const result = flightText(value);
    return result.length <= max && !FLIGHT_SENSITIVE.test(result) ? result : "";
  };
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(flightText(value)) ? flightText(value) : "";
  const time = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(flightText(value)) ? flightText(value) : "";
  const short = value => /^[A-Z0-9 -]{1,12}$/i.test(flightText(value)) ? flightText(value).toUpperCase() : "";
  const number = normalizeFlightNumber(item.flightNumber);
  return {
    id: clean(item.id) || `flight-${index + 1}`,
    groupId: clean(item.groupId) || clean(item.imageKey) || clean(item.id) || `flight-${index + 1}`,
    shared: item.shared === true,
    legLabel: /^(去程|返程)$/.test(item.legLabel) ? item.legLabel : "",
    flightNumber: /^[A-Z0-9]{2}\d{3,4}$/.test(number) ? number : "",
    airline: clean(item.airline),
    departureDate: date(item.departureDate), arrivalDate: date(item.arrivalDate),
    dateHint: /^\d{2}-\d{2}$/.test(item.dateHint) ? item.dateHint : "",
    departureTime: time(item.departureTime), arrivalTime: time(item.arrivalTime),
    departureCode: /^[A-Z]{3}$/i.test(item.departureCode) ? item.departureCode.toUpperCase() : "",
    departureAirport: clean(item.departureAirport), departureTerminal: short(item.departureTerminal),
    arrivalCode: /^[A-Z]{3}$/i.test(item.arrivalCode) ? item.arrivalCode.toUpperCase() : "",
    arrivalAirport: clean(item.arrivalAirport), arrivalTerminal: short(item.arrivalTerminal),
    durationMinutes: Number.isInteger(item.durationMinutes) && item.durationMinutes > 0 && item.durationMinutes <= 2880 ? item.durationMinutes : null,
    seat: short(item.seat), gate: short(item.gate), baggageClaim: short(item.baggageClaim),
    connection: item.connection && typeof item.connection === "object" && !Array.isArray(item.connection) ? {
      airportCode: /^[A-Z]{3}$/i.test(item.connection.airportCode) ? item.connection.airportCode.toUpperCase() : "",
      airport: clean(item.connection.airport),
      durationMinutes: Number.isInteger(item.connection.durationMinutes) && item.connection.durationMinutes > 0 && item.connection.durationMinutes <= 10080 ? item.connection.durationMinutes : null
    } : null,
    detailUrl: safeFlightDetailUrl(item.detailUrl),
    // 旧版原图不自动视为已脱敏；记录仍留在管理入口，可重新上传。
    imageKey: clean(item.imageKey, 180), imageRedacted: item.imageRedacted === true
  };
}

function renderFlightConnection(connection) {
  if (!connection) return "";
  const airport = [connection.airportCode, connection.airport].filter(Boolean).join(" ") || "中转机场待核验";
  const minutes = connection.durationMinutes;
  const duration = minutes ? `停留${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}小时` : ""}${minutes % 60 ? `${minutes % 60}分` : ""}` : "停留时长待核验";
  return `<p class="flight-connection-note" data-flight-connection><strong>中转提醒</strong><span>${flightEscape(airport)} · ${duration}</span></p>`;
}

function renderFlightTicket(raw, index = 0, options = {}) {
  const item = sanitizeFlightRecord(raw, index);
  const hasImage = item.imageKey && item.imageRedacted;
  if (!hasImage && !item.detailUrl && !(item.shared && item.flightNumber && item.airline && item.departureAirport && item.arrivalAirport)) return "";
  const e = flightEscape;
  const date = item.departureDate || (item.dateHint ? `${item.dateHint}（年份待核验）` : "日期待核验");
  const dates = item.arrivalDate && item.arrivalDate !== item.departureDate ? `${date} → ${item.arrivalDate}` : date;
  const airport = (code, name, terminal) => [code, name, terminal && !name.includes(terminal) ? terminal : ""].filter(Boolean).join(" ") || "机场待核验";
  const duration = item.durationMinutes ? `${Math.floor(item.durationMinutes / 60)}小时${item.durationMinutes % 60 ? `${item.durationMinutes % 60}分` : ""}` : "";
  const extras = [["座位", item.seat], ["登机口", item.gate], ["行李提取转盘", item.baggageClaim]].filter(([,value]) => value);
  const actions = options.showActions !== false && hasImage ? `<div class="flight-ticket-actions"><button type="button" class="flight-view" data-flight-view="${e(item.id)}">查看图片</button></div>` : "";
  return `<article class="flight-ticket-card" data-flight-card><header><b>${e(item.legLabel || `第 ${index + 1} 程`)}</b><span class="flight-date">${e(dates)}</span></header><div class="flight-airline"><div class="flight-identity"><span class="flight-airline-name">${e(item.airline || "航司待核验")}</span><strong class="flight-number">${e(item.flightNumber || "航班待核验")}</strong></div>${duration ? `<span class="flight-duration">${e(duration)}</span>` : ""}</div>${extras.length ? `<div class="flight-extras">${extras.map(([label,value]) => `<span class="flight-extra"><span class="flight-extra-label" title="${label}">${label === "行李提取转盘" ? "转盘" : label}</span> <strong>${e(value)}</strong></span>`).join("")}</div>` : ""}<div class="flight-route"><div><strong>${e(item.departureTime || "--:--")}</strong><span>${e(airport(item.departureCode,item.departureAirport,item.departureTerminal))}</span></div><span class="flight-route-line" aria-hidden="true">→</span><div><strong>${e(item.arrivalTime || "--:--")}</strong><span>${e(airport(item.arrivalCode,item.arrivalAirport,item.arrivalTerminal))}</span></div></div>${actions}${renderFlightConnection(item.connection)}</article>`;
}

function renderFlightManageLink(records = []) {
  const url = records.map(item => safeFlightDetailUrl(item.detailUrl)).find(Boolean);
  return url ? `<a class="flight-view" data-flight-link-view href="${flightEscape(url)}" target="_blank" rel="noopener noreferrer">打开购票链接</a>` : "";
}

function renderFlightRecords(flights = []) {
  const records = flights.map((item, index) => sanitizeFlightRecord({ ...item, imageKey: "", imageRedacted: false }, index));
  const cards = records.map(renderFlightTicket).join("");
  const seed = JSON.stringify(records).replace(/</g, "\\u003c");
  return `<article class="flight-records" data-flight-records><div class="flight-records-head"><h3>已购机票</h3><button type="button" class="flight-action" data-flight-manage aria-expanded="false" aria-controls="flight-records-editor">${records.length ? "管理凭证" : "录入凭证"}</button></div><div class="flight-records-list" data-flight-list>${cards || (!records.length ? '<p class="flight-empty">尚未录入机票凭证</p>' : '')}</div><div class="flight-records-editor" id="flight-records-editor" data-flight-editor hidden><div class="flight-source-actions" data-flight-source-actions>${renderFlightManageLink(records)}</div><p class="flight-replace-hint">保存新的图片或链接后，将覆盖当前全部机票记录。</p><form data-flight-form><div class="flight-source-row"><label class="flight-upload-action">上传机票图片<input type="file" accept="image/jpeg,image/png,image/webp" data-flight-file></label><span data-flight-image-label>未选择图片</span><label class="flight-link-field">购票软件链接<input type="url" inputmode="url" placeholder="https://…" data-flight-link></label></div><div class="flight-redaction" data-flight-redaction hidden><p>图片仅在本机处理。请拖动遮盖姓名、证件、订单号、票号、PNR、二维码及条码；确认后才识别、保存，不自动保证脱敏完整。</p><canvas data-flight-redact-canvas aria-label="拖动以遮盖图片中的敏感信息"></canvas><div class="flight-form-actions"><button type="button" data-flight-redact-all>遮盖整图</button><button type="button" data-flight-redact-confirm>已完成脱敏，识别此图</button></div></div><div class="flight-form-actions"><button type="button" data-flight-cancel>取消</button><button type="submit">保存凭证</button></div></form></div><p class="flight-records-status" data-flight-status role="status" aria-live="polite"></p><dialog class="flight-viewer" data-flight-viewer><div><img data-flight-view-image alt="脱敏后的机票图片"><button type="button" data-flight-view-close>关闭</button></div></dialog><script type="application/json" data-flight-seed>${seed}<\/script></article>`;
}

function normalizeFlightNumber(value) {
  return flightText(value).toUpperCase().replace(/\s+/g, "");
}

function safeFlightDetailUrl(value) {
  const raw = flightText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    // Inspect paths, nested parameters and SPA fragments as well as query keys.
    let decoded = raw;
    for (let i = 0; i < 3; i++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; }
    if (/%[0-9a-f]{2}|[\s\\]/i.test(decoded) || /pnr|passenger|passport|ticket[-_ ]?(?:no|number)|order[-_ ]?(?:id|no|number)|booking[-_ ]?(?:ref|reference)|姓名|证件|订单|票号|乘机人/i.test(decoded)) return "";
    return url.href;
  } catch (_error) { return ""; }
}

function flightOcrRows(items = []) {
  return items.map((item) => {
    const poly = Array.isArray(item?.poly) ? item.poly : [];
    const xs = poly.map((point) => Number(point?.[0])).filter(Number.isFinite);
    const ys = poly.map((point) => Number(point?.[1])).filter(Number.isFinite);
    return {
      text: flightText(item?.text),
      score: Number(item?.score || 0),
      x: xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0,
      y: ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0,
      height: ys.length ? Math.max(...ys) - Math.min(...ys) : 0
    };
  }).filter((item) => item.text && item.score >= 0.45 && !FLIGHT_SENSITIVE.test(item.text));
}

function parseFlightSegment(rows = []) {
  const joined = rows.map((item) => item.text).join("\n");
  const fields = {};
  const flightNumber = joined.toUpperCase().match(/\b(?=[A-Z0-9]{5,7}\b)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{2}\s?\d{3,4}\b/)?.[0];
  if (flightNumber) fields.flightNumber = normalizeFlightNumber(flightNumber);
  const airlineRow = rows.find((item) => fields.flightNumber && normalizeFlightNumber(item.text).includes(fields.flightNumber))
    || rows.find((item) => /(?:航空|AIRLINES?|AIRWAYS?)/i.test(item.text));
  if (airlineRow) {
    const beforeNumber = fields.flightNumber ? airlineRow.text.split(new RegExp(fields.flightNumber, "i"))[0] : airlineRow.text;
    const airline = beforeNumber.replace(/[^\p{L}·]+/gu, " ").trim();
    if (airline) fields.airline = airline;
  }
  const fullDates = [...joined.matchAll(/\b(20\d{2})[年\/.-](\d{1,2})[月\/.-](\d{1,2})日?/g)];
  const formatDate = match => `${match[1]}-${String(match[2]).padStart(2,"0")}-${String(match[3]).padStart(2,"0")}`;
  if (fullDates.length) {
    fields.departureDate = formatDate(fullDates[0]);
    if (fullDates[1]) fields.arrivalDate = formatDate(fullDates[1]);
    else {
      const dayOffset = joined.match(/\+\s*(\d)\s*(?:天|日)|次日/);
      if (dayOffset) {
        const date = new Date(fields.departureDate + "T00:00:00Z");
        date.setUTCDate(date.getUTCDate() + Number(dayOffset[1] || 1));
        fields.arrivalDate = date.toISOString().slice(0,10);
      }
    }
  }
  else {
    const shortDate = joined.match(/\b(\d{1,2})月(\d{1,2})日/);
    if (shortDate) fields.dateHint = `${String(shortDate[1]).padStart(2, "0")}-${String(shortDate[2]).padStart(2, "0")}`;
  }
  const times = rows.flatMap((row) => [...row.text.matchAll(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g)]
    .map((match) => ({ ...row, time: match[0].padStart(5, "0") })))
    .sort((a, b) => (b.height - a.height) || (a.y - b.y)).slice(0, 2).sort((a, b) => a.y - b.y || a.x - b.x);
  if (times[0]) fields.departureTime = times[0].time;
  if (times[1]) fields.arrivalTime = times[1].time;
  const airportRows = rows.map((row) => {
    if (row === airlineRow || /航空|airlines?|airways?|航班|flight|座位|登机口|转盘|duration/i.test(row.text) || /\b[A-Z0-9]{2}\s?\d{3,4}\b/i.test(row.text)) return null;
    const code = row.text.toUpperCase().match(/\b[A-Z]{3}\b/)?.[0];
    if (!code) return null;
    if (!/机场|airport|aerodrome|出发|到达|departure|arrival/i.test(row.text) && !/^\s*[A-Z]{3}(?:\s+T\d+)?\s*$/i.test(row.text)) return null;
    const airport = row.text.replace(new RegExp(`\\b${code}\\b`, "i"), "").replace(/[>›|]+/g, " ").trim();
    return { ...row, code, airport };
  }).filter(Boolean).sort((a, b) => a.y - b.y);
  if (airportRows[0]) {
    fields.departureCode = airportRows[0].code;
    fields.departureAirport = airportRows[0].airport;
  }
  if (airportRows[1]) {
    fields.arrivalCode = airportRows[1].code;
    fields.arrivalAirport = airportRows[1].airport;
  }
  fields.legLabel = joined.match(/去程|返程/)?.[0] || "";
  const durationRow = rows.find(row => /(?:飞行|飞行时长|航程|duration)/i.test(row.text) && !/中转|停留/.test(row.text));
  const duration = durationRow?.text.match(/(?:(\d{1,2})\s*(?:小时|h))\s*(?:(\d{1,2})\s*(?:分钟?|m))?/i);
  if (duration) fields.durationMinutes = Number(duration[1]) * 60 + Number(duration[2] || 0);
  for (const [key,pattern] of [
    ["seat", /(?:座位(?:号)?|seat)\s*[:：]?\s*([0-9]{1,3}[A-Z])\b/i],
    ["gate", /(?:登机口|gate)\s*[:：]?\s*([A-Z]?\d{1,3}[A-Z]?)\b/i],
    ["baggageClaim", /(?:行李(?:提取)?转盘|baggage\s*claim|carousel)\s*[:：]?\s*([A-Z]?\d{1,3})\b/i]
  ]) fields[key] = joined.match(pattern)?.[1] || "";
  return fields;
}

function parseFlightConnection(text) {
  if (!/(?:中转|转机|\blayover\b|\btransit\b)/i.test(text) || /直飞|无需|无须|不需|无中转|非中转|0\s*次中转|建议|至少|最少|可能|须知|注意|如需|nonstop|no\s+(?:layover|transit)/i.test(text)) return null;
  // 仅提取明确中转行的白名单字段，不持久化备注原文或自动计算两地时差。
  const airportCode = text.match(/\b[A-Z]{3}\b/)?.[0] || "";
  const airport = text.replace(/中转|转机|停留|机场[:：]/g, " ").match(/[\u4e00-\u9fff]{2,24}机场/)?.[0] || "";
  const timeText = text.split(/中转|转机|\blayover\b|\btransit\b/i).at(-1);
  const hours = timeText.match(/(\d{1,3})\s*(?:小时|hours?|hrs?|h)(?![a-z])/i);
  const mins = timeText.match(/(\d{1,2})\s*(?:分钟?|minutes?|mins?|m)(?![a-z])/i);
  const durationMinutes = (hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0);
  if (!airportCode && !airport && !durationMinutes && !/^\s*(?:中转|转机|layover|transit)\s*$/i.test(text)) return null;
  return { airportCode, airport, durationMinutes: durationMinutes > 0 && durationMinutes <= 10080 ? durationMinutes : null };
}

function flightOcrCandidates(items = []) {
  const rows = flightOcrRows(items);
  const connections = rows.map(row => ({ row, connection: parseFlightConnection(row.text) })).filter(item => item.connection);
  const segmentRows = rows.filter(row => !connections.some(item => item.row === row));
  const anchors = rows.map((row) => ({
    row,
    number: normalizeFlightNumber(row.text.match(/\b(?=[A-Z0-9]{5,7}\b)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{2}\s?\d{3,4}\b/i)?.[0])
  })).filter((item) => item.number).sort((a, b) => a.row.y - b.row.y);
  const uniqueAnchors = anchors.filter((item, index) => !index || item.number !== anchors[index - 1].number || Math.abs(item.row.y - anchors[index - 1].row.y) > 80);
  if (uniqueAnchors.length <= 1) {
    const parsed = parseFlightSegment(segmentRows);
    if (connections.length === 1) parsed.connection = connections[0].connection;
    return Object.keys(parsed).length ? [parsed] : [];
  }
  return uniqueAnchors.map((anchor, index) => {
    const previousY = index ? uniqueAnchors[index - 1].row.y : rows[0]?.y || 0;
    const nextY = index + 1 < uniqueAnchors.length ? uniqueAnchors[index + 1].row.y : rows.at(-1)?.y || anchor.row.y;
    const before = connections.filter(item => item.row.y > previousY && item.row.y < anchor.row.y);
    const after = connections.filter(item => item.row.y > anchor.row.y && (index + 1 === uniqueAnchors.length || item.row.y < nextY));
    const start = index ? (before.length === 1 ? before[0].row.y : (previousY + anchor.row.y) / 2) : -Infinity;
    const end = after.length === 1 ? after[0].row.y : index + 1 < uniqueAnchors.length ? (anchor.row.y + nextY) / 2 : Infinity;
    const parsed = parseFlightSegment(segmentRows.filter((row) => row.y >= start && row.y < end));
    if (after.length === 1) parsed.connection = after[0].connection;
    parsed.flightNumber = anchor.number;
    return parsed;
  }).filter((item) => item.flightNumber);
}

function flightOcrFields(items = []) {
  return flightOcrCandidates(items)[0] || {};
}

async function recognizeFlightTicket(file, options = {}) {
  if (global.location?.protocol === "file:") throw new Error("图片识别需要通过 HTTP 或 HTTPS 页面访问");
  if (!flightOcrPromise) {
    flightOcrPromise = import(FLIGHT_OCR_MODULE_URL).then(({ PaddleOCR }) => PaddleOCR.create({
      lang: "ch",
      ocrVersion: "PP-OCRv5",
      worker: false,
      ortOptions: { backend: "wasm", wasmPaths: FLIGHT_OCR_WASM_URL, numThreads: 2, simd: true }
    })).catch((error) => { flightOcrPromise = null; throw error; });
  }
  options.onStatus?.("正在本机识别，请稍候…");
  const ocr = await flightOcrPromise;
  let timer = 0;
  const timeout = new Promise((_, reject) => { timer = global.setTimeout(() => reject(new Error("图片识别超时，请重试或仅保存脱敏图片。")), FLIGHT_OCR_TIMEOUT_MS); });
  const [result] = await Promise.race([ocr.predict(file, { textRecScoreThresh: 0.45 }), timeout]).finally(() => global.clearTimeout(timer));
  return flightOcrCandidates(result?.items || []);
}

function openFlightImageDb() {
  return new Promise((resolve, reject) => {
    const request = global.indexedDB.open(FLIGHT_IMAGE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("images")) request.result.createObjectStore("images");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地图片存储"));
  });
}

async function putFlightImage(key, blob) {
  const db = await openFlightImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").put(blob, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error("图片保存失败")); };
  });
}

async function getFlightImage(key) {
  const db = await openFlightImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readonly");
    const request = tx.objectStore("images").get(key);
    request.onsuccess = () => { db.close(); resolve(request.result || null); };
    request.onerror = () => { db.close(); reject(request.error || new Error("图片读取失败")); };
  });
}

async function deleteFlightImage(key) {
  const db = await openFlightImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error("图片删除失败")); };
  });
}

function initFlightRecords(options = {}) {
  const root = options.root || document;
  const card = root.querySelector("[data-flight-records]");
  if (!card || card.dataset.flightReady === "true") return;
  const guideId = root.body?.dataset?.guideId || global.location?.pathname || "guide";
  const storageKey = `travel-guide-flight-records:${guideId}`;
  const seed = readJsonIndex("[data-flight-seed]", root);
  const query = selector => card.querySelector(selector);
  const list = query("[data-flight-list]"), manage = query("[data-flight-manage]");
  const editor = query("[data-flight-editor]"), form = query("[data-flight-form]");
  const fileInput = query("[data-flight-file]"), linkInput = query("[data-flight-link]");
  const sourceActions = query("[data-flight-source-actions]");
  const viewer = query("[data-flight-viewer]"), viewerImage = query("[data-flight-view-image]");
  const redaction = query("[data-flight-redaction]"), canvas = query("[data-flight-redact-canvas]");
  const recognize = options.recognize || recognizeFlightTicket;
  const images = options.imageStore || { put: putFlightImage, get: getFlightImage, delete: deleteFlightImage };
  let items = [], pendingBlob = null, candidates = [], epoch = 0;
  let loading = false, saving = false, needsRedaction = false, viewerUrl = "", drag = null;
  const setStatus = (message, kind = "") => {
    query("[data-flight-status]").textContent = message;
    query("[data-flight-status]").dataset.state = kind;
  };
  let stored;
  try { stored = global.localStorage.getItem(storageKey); } catch (_) {}
  try { items = (stored !== null && stored !== undefined ? JSON.parse(stored) : seed || []).map(sanitizeFlightRecord); }
  catch (_) { items = Array.isArray(seed) ? seed.map(sanitizeFlightRecord) : []; }
  const persist = next => {
    try { global.localStorage.setItem(storageKey, JSON.stringify(next)); return true; }
    catch (_) { setStatus("保存失败，本次修改尚未写入浏览器。", "error"); return false; }
  };
  const clearPending = () => {
    epoch++; pendingBlob = null; candidates = []; loading = false; needsRedaction = false;
    fileInput.value = ""; redaction.hidden = true; canvas.width = 0; canvas.height = 0;
    query("[data-flight-image-label]").textContent = "未选择图片";
    query("[data-flight-preview]")?.remove();
  };
  const fill = () => {
    clearPending();
    const item = items[0];
    linkInput.value = "";
    if (item?.imageKey && !item.imageRedacted) setStatus("旧图片尚未确认脱敏，请重新上传后确认；原有记录未删除。", "info");
    else if (item && !item.imageKey && !item.detailUrl) setStatus("此航段尚无凭证，请补充图片或链接。", "info");
    else setStatus("");
  };
  const render = () => {
    list.innerHTML = items.map(renderFlightTicket).join("") || (!items.length ? '<p class="flight-empty">尚未录入机票凭证</p>' : "");
    manage.textContent = items.length ? "管理凭证" : "录入凭证";
    sourceActions.innerHTML = renderFlightManageLink(items);
  };
  const openEditor = open => {
    if (saving) return;
    editor.hidden = !open; manage.setAttribute("aria-expanded", String(open));
    if (open) { fill(); render(); }
    else clearPending();
  };
  manage.addEventListener("click", () => openEditor(editor.hidden));
  query("[data-flight-cancel]").addEventListener("click", () => { if (!saving) { openEditor(false); setStatus(""); } });
  linkInput.addEventListener("input", () => {
    if (linkInput.value && !safeFlightDetailUrl(linkInput.value)) setStatus("仅支持不含登录凭据或敏感订单参数的 HTTPS 链接。", "error");
  });
  fileInput.addEventListener("change", async () => {
    if (saving) return;
    const file = fileInput.files?.[0];
    if (!file) return;
    clearPending();
    if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setStatus("请选择不超过 10MB 的 JPEG、PNG 或 WebP 图片。", "error"); return;
    }
    needsRedaction = true; loading = true;
    const ticket = epoch;
    const url = global.URL.createObjectURL(file);
    const img = new global.Image();
    try {
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error("图片读取失败")); img.src = url; });
      if (ticket !== epoch) return;
      if (!img.naturalWidth || img.naturalWidth * img.naturalHeight > 40000000) throw new Error("图片像素过大，请先裁剪");
      const ratio = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * ratio); canvas.height = Math.round(img.naturalHeight * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("当前浏览器不支持图片脱敏");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      redaction.hidden = false;
      query("[data-flight-image-label]").textContent = "图片待脱敏确认（尚未保存）";
      setStatus("请遮盖敏感信息后确认。识别不会上传图片，首次使用需下载识别组件。", "info");
    } catch (error) { if (ticket === epoch) { needsRedaction = false; setStatus(error.message, "error"); } }
    finally { global.URL.revokeObjectURL(url); img.src = ""; if (ticket === epoch) loading = false; }
  });
  const point = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)) };
  };
  canvas.addEventListener("pointerdown", event => {
    if (loading || saving || !needsRedaction) return;
    drag = point(event); canvas.setPointerCapture?.(event.pointerId); event.preventDefault();
  });
  canvas.addEventListener("pointerup", event => {
    if (!drag) return;
    const end = point(event), ctx = canvas.getContext("2d");
    ctx.fillStyle = "#123b45";
    ctx.fillRect(Math.min(drag.x,end.x), Math.min(drag.y,end.y), Math.max(8,Math.abs(end.x-drag.x)), Math.max(8,Math.abs(end.y-drag.y)));
    drag = null;
  });
  canvas.addEventListener("pointercancel", () => { drag = null; });
  query("[data-flight-redact-all]").addEventListener("click", () => {
    if (loading || saving || !needsRedaction) return;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#123b45"; ctx.fillRect(0,0,canvas.width,canvas.height);
  });
  query("[data-flight-redact-confirm]").addEventListener("click", async () => {
    if (loading || saving || !needsRedaction || !canvas.width) return;
    loading = true;
    const ticket = epoch;
    try {
      const blob = await new Promise((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("脱敏图片生成失败")), "image/png"));
      if (ticket !== epoch) return;
      // 只将重新编码、经用户确认的像素交给 OCR 和持久化，不保留原始文件或其元数据。
      pendingBlob = blob; needsRedaction = false; redaction.hidden = true; canvas.width = 0; canvas.height = 0;
      const recognized = await recognize(blob, { onStatus: message => { if (ticket === epoch) setStatus(message, "loading"); } });
      if (ticket !== epoch) return;
      candidates = recognized.map(sanitizeFlightRecord);
      setStatus(candidates.length ? `识别到 ${candidates.length} 个航段；保存前请核对下方预览。` : "未识别到航段；仍可保存脱敏图片，未知信息不自动补写。", "info");
    } catch (error) { if (ticket === epoch) { candidates = []; setStatus("识别未完成，可保存已确认脱敏的图片或改用链接。", "info"); } }
    finally {
      if (ticket === epoch) {
        loading = false;
        query("[data-flight-image-label]").textContent = pendingBlob ? "脱敏图片已就绪（尚未保存）" : "图片未就绪";
        let preview = query("[data-flight-preview]");
        if (!preview) { preview = root.createElement ? root.createElement("div") : document.createElement("div"); preview.dataset.flightPreview = ""; form.append(preview); }
        preview.innerHTML = candidates.map((item,i) => renderFlightTicket({...item, detailUrl:"", imageKey:"preview", imageRedacted:true}, i, { showActions: false })).join("");
      }
    }
  });
  const cleanup = async (previous, next) => {
    const retained = new Set(next.map(item => item.imageKey).filter(Boolean));
    for (const key of new Set(previous.map(item => item.imageKey).filter(Boolean))) {
      if (!retained.has(key)) await images.delete(key);
    }
  };
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (loading || saving || needsRedaction) { setStatus("请先完成图片脱敏确认与识别。", "info"); return; }
    const detailUrl = safeFlightDetailUrl(linkInput.value);
    if (linkInput.value && !detailUrl) { setStatus("仅支持不含登录凭据或敏感订单参数的 HTTPS 链接。", "error"); return; }
    const previous = items, group = flightId();
    if (!pendingBlob && !detailUrl) {
      setStatus("请上传并确认脱敏图片，或填写购票软件链接。", "error"); return;
    }
    saving = true;
    let newImageKey = "";
    try {
      let additions;
      if (pendingBlob) {
        newImageKey = `${guideId}:${flightId()}`;
        await images.put(newImageKey, pendingBlob);
        additions = (candidates.length ? candidates : [{}]).map((item,index) => sanitizeFlightRecord({
          ...item, id: flightId(), groupId: group, detailUrl, imageKey: newImageKey, imageRedacted: true
        }, index));
      } else {
        additions = [sanitizeFlightRecord({ id:flightId(), groupId:group, detailUrl })];
      }
      const next = additions;
      if (!persist(next)) { if (newImageKey) await images.delete(newImageKey); return; }
      items = next; clearPending(); editor.hidden = true; manage.setAttribute("aria-expanded","false");
      query("[data-flight-preview]")?.remove(); render(); setStatus(previous.length ? "新凭证已保存，并覆盖旧记录。" : "凭证已保存在当前浏览器。", "success");
      // 只发送已清洗的航班执行信息；imageKey 与图片像素始终留在本机。
      document.dispatchEvent(new CustomEvent("guide:flight-records-save", { detail: { records: items.map(item => ({ ...sanitizeFlightRecord(item), imageKey: "", imageRedacted: false })) } }));
      try { await cleanup(previous, next); } catch (_) { setStatus("凭证已保存；旧图片清理失败，请检查浏览器存储。", "error"); }
    } catch (_) { setStatus("图片无法保存到当前浏览器，本次修改未完成。", "error"); }
    finally { saving = false; }
  });
  const closeViewer = () => {
    if (viewer.open && typeof viewer.close === "function") viewer.close(); else viewer.removeAttribute("open");
    viewerImage.removeAttribute("src");
    if (viewerUrl) global.URL.revokeObjectURL(viewerUrl);
    viewerUrl = "";
  };
  list.addEventListener("click", async event => {
    const button = event.target.closest("[data-flight-view]");
    if (!button) return;
    const item = items.find(entry => entry.id === button.dataset.flightView);
    if (!item?.imageKey || !item.imageRedacted) return;
    try {
      const blob = await images.get(item.imageKey);
      if (!blob) throw new Error("图片不存在");
      closeViewer(); viewerUrl = global.URL.createObjectURL(blob); viewerImage.src = viewerUrl;
      if (typeof viewer.showModal === "function") viewer.showModal(); else viewer.setAttribute("open","");
    } catch (_) { setStatus("图片暂时无法读取，请从管理凭证重新上传。","error"); }
  });
  query("[data-flight-view-close]").addEventListener("click", closeViewer);
  viewer.addEventListener("click", event => { if (event.target === viewer) closeViewer(); });
  viewer.addEventListener("cancel", closeViewer);
  viewer.addEventListener("close", () => { viewerImage.removeAttribute("src"); if(viewerUrl)global.URL.revokeObjectURL(viewerUrl); viewerUrl=""; });
  document.addEventListener("guide:flight-records-remote", event => {
    const records = Array.isArray(event.detail?.records) ? event.detail.records : [];
    const local = new Map(items.map(item => [item.id, item]));
    const remoteIds = new Set(records.map(record => record.id));
    const localOnly = items.filter(item => item.shared !== true && !remoteIds.has(item.id));
    items = records.map((record, index) => {
      const previous = local.get(record.id) || {};
      return sanitizeFlightRecord({ ...record, shared: true, imageKey: previous.imageKey || "", imageRedacted: previous.imageRedacted === true }, index);
    }).concat(localOnly);
    if (!persist(items)) { render(); return; }
    render();
    setStatus(localOnly.length ? `已收到其他设备保存的航班信息；${localOnly.length} 条本机未同步记录已保留。` : "已收到其他设备保存的航班信息；机票图片仍仅在原设备。", "success");
  });
  document.addEventListener("guide:flight-records-sync-status", event => {
    setStatus(event.detail?.message || "", event.detail?.state || "");
  });
  card.dataset.flightReady = "true";
  render();
  return { render, openEditor, flightOcrFields, flightOcrCandidates };
}

if (typeof module === "object" && module.exports) {
  module.exports = { renderFlightRecords, renderFlightTicket, sanitizeFlightRecord, safeFlightDetailUrl, flightOcrCandidates };
}

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

function initThemeSwitcher({ root = document } = {}) {
  const body = root.body || document.body;
  const picker = root.querySelector?.("[data-guide-theme-picker]");
  if (!body || !picker) return null;
  if (picker.dataset.themeReady === "true") return picker._themeController || null;
  picker.dataset.themeReady = "true";
  const themes = ["rainforest", "coast", "terracotta", "ink", "burgundy", "midnight"];
  const launcher = root.querySelector?.("[data-guide-theme-launcher]");
  const currentLabel = root.querySelector?.("[data-guide-theme-current]");
  const popover = root.querySelector?.("[data-guide-theme-popover]");
  const closeButton = root.querySelector?.("[data-guide-theme-close]");
  const storageKey = `travel-guide-theme:${body.dataset.guideId || location.pathname || "guide"}`;
  const buttons = [...picker.querySelectorAll("[data-guide-theme]")];
  const labels = new Map(buttons.map((button) => [button.dataset.guideTheme, button.querySelector("span")?.textContent?.trim() || button.textContent.trim()]));
  const readStored = () => { try { return localStorage.getItem(storageKey); } catch (_error) { return null; } };
  const apply = (theme, persist = true) => {
    const next = themes.includes(theme) ? theme : "coast";
    body.dataset.guideTheme = next;
    buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.guideTheme === next)));
    if (currentLabel) currentLabel.textContent = labels.get(next) || "海岸蓝";
    if (persist) try { localStorage.setItem(storageKey, next); } catch (_error) {}
    root.dispatchEvent?.(new CustomEvent("guide:theme-change", { detail: { theme: next } }));
    return next;
  };
  const setOpen = (open) => {
    if (!popover || !launcher) return;
    popover.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    if (open) closeButton?.focus();
  };
  const onClick = (event) => {
    const button = event.target.closest?.("[data-guide-theme]");
    if (button && picker.contains(button)) apply(button.dataset.guideTheme);
  };
  const onLauncherClick = () => setOpen(popover?.hidden !== false);
  const onCloseClick = () => { setOpen(false); launcher?.focus(); };
  const onDocumentClick = (event) => {
    if (!popover || popover.hidden || popover.contains(event.target) || launcher?.contains(event.target)) return;
    setOpen(false);
  };
  const onKeyDown = (event) => { if (event.key === "Escape" && popover && !popover.hidden) { setOpen(false); launcher?.focus(); } };
  picker.addEventListener("click", onClick);
  launcher?.addEventListener("click", onLauncherClick);
  closeButton?.addEventListener("click", onCloseClick);
  root.addEventListener?.("click", onDocumentClick);
  root.addEventListener?.("keydown", onKeyDown);
  apply(readStored() || body.dataset.guideDefaultTheme || "coast", false);
  const controller = { apply, setOpen, destroy() { picker.removeEventListener("click", onClick); launcher?.removeEventListener("click", onLauncherClick); closeButton?.removeEventListener("click", onCloseClick); root.removeEventListener?.("click", onDocumentClick); root.removeEventListener?.("keydown", onKeyDown); delete picker.dataset.themeReady; delete picker._themeController; } };
  picker._themeController = controller;
  return controller;
}

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
    if (open && config.focus) (visibleActions().at(-1) || toggle).focus();
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
  if (options.sources !== false) active.sources = initialize("sources", () => initSourceLinks({ root, ...(options.sourceOptions || {}) }));
  if (options.search !== false) active.search = initialize("search", () => initSearch({ root, ...(options.searchOptions || {}) }));
  if (options.copy !== false) active.copy = initialize("copy", () => initCopyControls({ root, ...(options.copyOptions || {}) }));
  if (options.checklist !== false) active.checklist = initialize("checklist", () => initChecklist({ root, editable: true, ...(options.checklistOptions || {}) }));
  if (options.preview !== false) active.preview = initialize("preview", () => initImagePreview({ root, ...(options.previewOptions || {}) }));
  if (options.navigation !== false) active.navigation = initialize("navigation", () => initQuickNav({ root, ...(options.navigationOptions || {}) }));
  if (options.exchange) active.exchange = initialize("exchange", () => initExchange({ root, ...(options.exchange === true ? {} : options.exchange) }));
  if (options.weather) active.weather = initialize("weather", () => initWeatherForecast({ root, ...(options.weather === true ? {} : options.weather) }));
  if (options.dayTabs) active.dayTabs = initialize("dayTabs", () => initDayTabs({ root, ...(options.dayTabs === true ? {} : options.dayTabs) }));
  if (options.execution) active.execution = initialize("execution", () => initExecutionLinks({ root, ...(options.execution === true ? {} : options.execution) }));
  if (options.calendar) active.calendar = initialize("calendar", () => initCalendarExport({ root, ...(options.calendar === true ? {} : options.calendar) }));
  if (options.expenses) active.expenses = initialize("expenses", () => initExpenseTracker({ root, ...(options.expenses === true ? {} : options.expenses) }));
  if (options.bookings !== false) active.bookings = initialize("bookings", () => initBookingLedger({ root }));
  if (options.flights) active.flights = initialize("flights", () => initFlightRecords({ root, ...(options.flights === true ? {} : options.flights) }));
  if (options.routeSummary !== false) active.routeSummary = initialize("routeSummary", () => initRouteSummary({ root, ...(options.routeSummaryOptions || {}) }));
  if (options.themes !== false) active.themes = initialize("themes", () => initThemeSwitcher({ root, ...(options.themeOptions || {}) }));
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
})(window);
