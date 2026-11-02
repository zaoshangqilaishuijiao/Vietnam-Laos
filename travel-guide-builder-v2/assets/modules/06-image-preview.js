/* ── 06  image preview ── */
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
