/* ── 02  source links ── */
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
  let fallback = null;
  let attempt = 0;
  const removeFallback = () => { fallback?.remove(); fallback = null; };
  const clearXhsTimer = () => { global.clearTimeout(xhsTimer); xhsTimer = null; };
  const linkContext = (link) => {
    let keyword = text(link.dataset.xhsKeyword);
    if (!keyword) {
      try { keyword = text(new URL(link.href).searchParams.get("keyword")); } catch (_) { /* Use the visible note title below. */ }
    }
    keyword ||= text(link.textContent).replace(/^(?:图片[：:]\s*|原帖\s*[·：:]\s*)/, "").replace(/\s*↗\s*$/, "");
    return { keyword, url: link.href, deeplink: link.dataset.xhsDeeplink, link };
  };
  const reportXhsFailure = (context) => {
    clearXhsTimer();
    ownerDocument.dispatchEvent(new CustomEvent("guide:xhs-open-failed", { detail: context }));
  };
  const onVisibilityChange = () => { if (!isPageVisible()) { attempt += 1; clearXhsTimer(); removeFallback(); } };
  const onPageHide = () => { attempt += 1; clearXhsTimer(); removeFallback(); };
  const copyValue = async (value, label) => {
    try {
      if (global.navigator?.clipboard && global.isSecureContext) await global.navigator.clipboard.writeText(value);
      else if (!fallbackCopy(value, ownerDocument)) throw Error("copy unavailable");
      toast(`${label}已复制`);
    } catch (_) {
      // Leave a selectable value even when clipboard access is unavailable.
      if (!fallback) return;
      let field = fallback.querySelector("input");
      if (!field) { field = ownerDocument.createElement("input"); field.readOnly = true; field.setAttribute("aria-label", label); fallback.append(field); }
      field.value = value; field.focus(); field.select();
      toast(`请长按或手动复制${label}`);
    }
  };
  const onXhsOpenFailed = (event) => {
    const context = event.detail || {};
    const keyword = text(context.keyword);
    toast(`未能唤起小红书${keyword ? `：${keyword}` : ""}；可打开网页或复制原链接`);
    if (!context.link?.isConnected) return;
    removeFallback();
    fallback = ownerDocument.createElement("span");
    fallback.className = "guide-xhs-fallback";
    fallback.setAttribute("role", "group");
    fallback.setAttribute("aria-label", "小红书备用打开方式");
    const label = ownerDocument.createElement("span");
    label.textContent = keyword;
    fallback.append(label);
    const action = (title, run) => {
      const button = ownerDocument.createElement("button"); button.type = "button"; button.textContent = title;
      button.addEventListener("click", run); fallback.append(button);
    };
    action("重试 App", () => launch(context));
    try {
      const url = new URL(context.url);
      if (url.protocol === "https:" && /(^|\.)xiaohongshu\.com$|^xhslink\.com$/i.test(url.hostname)) {
        const web = ownerDocument.createElement("a");
        web.href = url.href; web.target = "_blank"; web.rel = "noopener noreferrer";
        web.textContent = context.deeplink?.includes("/item/") ? "打开原帖网页" : "打开搜索网页";
        // An explicit click, not a delayed automatic navigation. Keep access parameters intact.
        fallback.append(web);
        action("复制原链接", () => copyValue(url.href, "原链接"));
      }
    } catch (_) { /* Never invent a replacement note URL. */ }
    if (keyword) action("复制搜索词", () => copyValue(keyword, "搜索词"));
    action("收起", () => { removeFallback(); context.link.focus(); });
    context.link.after(fallback);
  };
  const launch = (context) => {
    clearXhsTimer(); removeFallback();
    const token = ++attempt;
    try { navigate(context.deeplink); }
    catch { reportXhsFailure(context); return; }
    // Hiding the page invalidates this attempt; returning from the App must not trigger fallback.
    if (token === attempt) xhsTimer = global.setTimeout(() => {
      if (token === attempt && isPageVisible()) reportXhsFailure(context);
    }, xhsFailureDelay);
  };
  ownerDocument.addEventListener("visibilitychange", onVisibilityChange);
  global.addEventListener("pagehide", onPageHide);
  ownerDocument.addEventListener("guide:xhs-open-failed", onXhsOpenFailed);
  const onClick = (event) => {
    const link = event.target.closest('a[href^="#source-"]');
    if (link) {
      const target = root.querySelector(link.getAttribute("href"));
      if (!target) return;
      options.revealOverview?.();
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
    if (!xhsLink || event.defaultPrevented || !isMobile() || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const deeplink = xhsLink.dataset.xhsDeeplink;
    if (!deeplink) return;
    event.preventDefault();
    launch(linkContext(xhsLink));
  };
  root.addEventListener("click", onClick);
  const api = Object.freeze({
    destroy() {
      root.removeEventListener("click", onClick);
      global.clearTimeout(timer);
      clearXhsTimer();
      attempt += 1;
      removeFallback();
      ownerDocument.removeEventListener("visibilitychange", onVisibilityChange);
      global.removeEventListener("pagehide", onPageHide);
      ownerDocument.removeEventListener("guide:xhs-open-failed", onXhsOpenFailed);
      active?.classList.remove(activeClass);
      active = null;
      if (sourceLinkInstances.get(root) === api) sourceLinkInstances.delete(root);
    }
  });
  sourceLinkInstances.set(root, api);
  return api;
}
