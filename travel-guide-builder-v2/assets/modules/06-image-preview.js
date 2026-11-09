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
  const galleries = new Map();
  root.querySelectorAll("[data-travel-gallery]").forEach(gallery => {
    const track = gallery.querySelector("[data-travel-photo-track]");
    const slides = [...track.querySelectorAll("[data-preview-image]")];
    const dots = [...gallery.querySelectorAll("[data-travel-photo-index]")];
    if (slides.length < 2) return;
    let current = 0;
    let pointer = null;
    let dragged = false;
    const steps = [...gallery.querySelectorAll("[data-travel-photo-step]")];
    const source = gallery.closest("[data-travel-item]")?.querySelector("[data-travel-photo-source]");
    const show = (index, scroll = true) => {
      current = Math.max(0, Math.min(index, slides.length - 1));
      dots.forEach((dot, i) => dot.setAttribute("aria-pressed", String(i === current)));
      steps.forEach(step => { step.disabled = !slides[current + Number(step.dataset.travelPhotoStep)]; });
      gallery.querySelector("[data-travel-photo-count]").textContent = `${current + 1} / ${slides.length}`;
      const credit = slides[current].closest("figure")?.querySelector("[data-travel-photo-credit]");
      if (source && credit && source.dataset.photoIndex !== String(current)) {
        source.replaceChildren(credit.content.cloneNode(true));
        source.hidden = !source.firstElementChild;
        source.dataset.photoIndex = String(current);
      }
      if (scroll) track.scrollTo?.({ left: track.clientWidth * current, behavior: "auto" });
      return slides[current];
    };
    if (track._travelGallery) { galleries.set(gallery, track._travelGallery); return; }
    track.addEventListener("scroll", () => { if (track.clientWidth) show(Math.round(track.scrollLeft / track.clientWidth), false); }, { passive: true });
    track.addEventListener("pointerdown", event => { pointer = [event.clientX, event.clientY]; dragged = false; });
    track.addEventListener("pointermove", event => {
      if (pointer && Math.abs(event.clientX - pointer[0]) > 8 && Math.abs(event.clientX - pointer[0]) > Math.abs(event.clientY - pointer[1])) dragged = true;
    });
    track.addEventListener("pointercancel", () => { pointer = null; });
    track.addEventListener("pointerup", () => { pointer = null; });
    track.addEventListener("click", event => {
      if (dragged && event.detail > 0) event.stopPropagation();
      dragged = false;
    }, true);
    track.addEventListener("keydown", event => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      show(current + (event.key === "ArrowRight" ? 1 : -1));
    });
    dots.forEach((dot, i) => dot.addEventListener("click", () => show(i)));
    steps.forEach(step => step.addEventListener("click", () => show(current + Number(step.dataset.travelPhotoStep))));
    track._travelGallery = { slides, show, index: () => current };
    galleries.set(gallery, track._travelGallery);
    show(0, false);
  });
  let controls = dialog.querySelector("[data-travel-preview-controls]");
  if (!controls && galleries.size) {
    controls = root.createElement("div");
    controls.className = "travel-photo-controls";
    controls.dataset.travelPreviewControls = "";
    controls.innerHTML = '<button type="button" aria-label="上一张照片">上一张</button><span aria-live="polite"></span><button type="button" aria-label="下一张照片">下一张</button>';
    controls.hidden = true;
    dialog.append(controls);
    const [previous, next] = controls.querySelectorAll("button");
    previous.addEventListener("click", () => dialog._travelPreviewStep?.(-1));
    next.addEventListener("click", () => dialog._travelPreviewStep?.(1));
    dialog.addEventListener("keydown", event => {
      if (controls.hidden || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      dialog._travelPreviewStep?.(event.key === "ArrowRight" ? 1 : -1);
    });
  }
  const close = dialog._travelPreviewClose || (() => {
    dialog.close?.();
    dialog.removeAttribute("open");
    dialog._travelLastFocus?.focus?.({ preventScroll: true });
    dialog._travelLastFocus = null;
  });
  dialog._travelPreviewClose = close;
  const paint = trigger => {
    image.src = trigger.currentSrc || trigger.dataset.previewImage || trigger.src;
    image.alt = trigger.alt || trigger.querySelector("img")?.alt || "图片预览";
  };
  triggers.forEach(trigger => {
    if (trigger.dataset.previewReady === "true") return;
    const open = () => {
      dialog._travelLastFocus = trigger;
      const gallery = galleries.get(trigger.closest("[data-travel-gallery]"));
      if (controls) controls.hidden = !gallery;
      if (gallery && controls) {
        const [previous, next] = controls.querySelectorAll("button");
        const show = index => {
          paint(gallery.show(index));
          const current = gallery.index();
          controls.querySelector("span").textContent = `${current + 1} / ${gallery.slides.length}`;
          previous.disabled = current === 0;
          next.disabled = current === gallery.slides.length - 1;
        };
        dialog._travelPreviewStep = delta => show(gallery.index() + delta);
        show(gallery.slides.indexOf(trigger));
      } else paint(trigger);
      if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    };
    trigger.tabIndex = trigger.tabIndex >= 0 ? trigger.tabIndex : 0;
    trigger.dataset.previewReady = "true";
    trigger.addEventListener("click", open);
    if (trigger.tagName !== "BUTTON") trigger.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
    });
  });
  if (dialog.dataset.previewDialogReady !== "true") {
    closeButton.addEventListener("click", close);
    dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    dialog.dataset.previewDialogReady = "true";
  }
  return { close };
}
