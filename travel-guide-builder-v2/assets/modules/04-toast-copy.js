/* ── 04  toast & copy ── */
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
