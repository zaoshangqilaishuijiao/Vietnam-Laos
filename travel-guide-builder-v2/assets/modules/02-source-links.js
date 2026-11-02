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
