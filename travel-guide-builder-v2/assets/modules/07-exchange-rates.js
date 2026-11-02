/* ── 07  exchange rates ── */
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
