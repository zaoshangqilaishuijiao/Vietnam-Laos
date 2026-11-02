/* ── 05  checklist ── */
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
