/* ── 17  semantic theme switcher ── */
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
