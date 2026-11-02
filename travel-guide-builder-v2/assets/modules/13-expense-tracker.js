/* ── 13  expense tracker ── */
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
