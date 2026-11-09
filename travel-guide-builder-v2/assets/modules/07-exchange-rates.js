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
  const fromSelect = card.querySelector('[data-exchange-from]');
  const toSelect = card.querySelector('[data-exchange-to]');
  const swapButton = card.querySelector('[data-exchange-swap]');
  const pairMode = !!(fromSelect && toSelect && localInput);
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
  const cacheKey = `travel-guide-exchange:quotes:${base}`;
  const amountValue = field => Number(String(field?.value || '').replace(/,/g, ''));
  const updateMnemonic = () => {
    if (!mnemonic) return;
    const quote = Number(rates?.[selectedCurrency]);
    if (!(quote > 0)) {
      mnemonic.textContent = '';
      const block = mnemonic.closest('.guide-quickcalc__mnemonic');
      if (block) block.hidden = true;
      if (mnemonicExample) { mnemonicExample.textContent = ''; mnemonicExample.hidden = true; }
      return;
    }
    // Choose one simple operation, optionally after removing trailing zeros.
    // Hide when no integer multiplier/divisor is within 8% of the quote.
    let best = null;
    for (let zeros = 0; zeros <= 6; zeros++) {
      for (const operation of ['divide', 'multiply']) {
        const exact = operation === 'divide' ? quote / (10 ** zeros) : (10 ** zeros) / quote;
        const factor = Math.round(exact);
        if (factor < 1 || factor > 10) continue;
        const ratio = operation === 'divide' ? quote / (10 ** zeros * factor) : quote * factor / (10 ** zeros);
        const error = Math.abs(ratio - 1);
        const cost = (zeros ? 1 : 0) + (factor === 1 ? 0 : 1);
        if (error <= .08 && (!best || cost < best.cost || (cost === best.cost && error < best.error))) best = { zeros, operation, factor, error, cost };
      }
    }
    const block = mnemonic.closest('.guide-quickcalc__mnemonic');
    if (block) block.hidden = !best;
    if (!best) { mnemonic.textContent = ''; return; }
    const action = best.factor === 1 ? '' : `${best.operation === 'divide' ? '除以' : '乘'} ${best.factor}`;
    mnemonic.textContent = `${selectedCurrency} ${best.zeros ? `去掉 ${best.zeros} 个 0${action ? '，再' : ''}` : ''}${action || (best.zeros ? '' : '金额不变')}，约等于人民币`;
    if (mnemonicExample) { mnemonicExample.textContent = ''; mnemonicExample.hidden = true; }
  };
  const updateRateLabels = () => {
    targets.forEach((currency) => {
      const node = card.querySelector(`[data-exchange-rate="${currency}"]`);
      if (!node) return;
      const quote = rates?.[currency];
      node.textContent = Number.isFinite(quote) && quote > 0 ? `1 ${base} ≈ ${format(quote)} ${currency}` : '待刷新';
    });
    if (pairMode) selectedCurrency = [fromSelect.value, toSelect.value].find(code => code !== base && code !== 'USD') || targets.find(code => code !== 'USD') || 'USD';
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
    if (pairMode) {
      const n = amountValue(localInput);
      const result = n / Number(rates?.[fromSelect.value]) * Number(rates?.[toSelect.value]);
      input.value = String(localInput.value).trim() && Number.isFinite(n) && n >= 0 && Number.isFinite(result) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: ['VND', 'LAK', 'JPY', 'KRW', 'IDR'].includes(toSelect.value) ? 0 : 2 }).format(result) : '';
      input.style.fontSize = input.value.length > 13 ? '23px' : '';
      return;
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
      if (!nextRates || [...targets, ...(pairMode ? ['USD', base] : [])].some((currency) => !Number.isFinite(nextRates[currency]) || nextRates[currency] <= 0)) throw new Error('exchange response incomplete');
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
      if (pairMode) {
        try { global.localStorage.setItem(cacheKey, JSON.stringify({ rates, date: result.date || new Date().toISOString() })); } catch (_) { /* Storage may be unavailable; in-memory conversion remains usable. */ }
      }
      if (lastUpdated) {
        lastUpdated.textContent = pairMode ? `汇率日期：${result.date || stamp(new Date())}` : `更新时间：${stamp(new Date())}${result.date ? `；数据日期：${result.date}` : ''}`;
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
    (pairMode ? dialogClose : localInput)?.focus({ preventScroll: true });
  };
  const onDialogCloseClick = () => {
    if (typeof dialog?.close === 'function' && dialog.open) dialog.close();
    else { dialog?.removeAttribute('open'); root.querySelector('[data-guide-floating-toggle]')?.focus({ preventScroll: true }); }
  };
  const onDialogBackdropClick = (event) => { if (event.target === dialog) onDialogCloseClick(); };
  const onDialogClosed = () => root.querySelector('[data-guide-floating-toggle]')?.focus({ preventScroll: true });
  let previousFrom = fromSelect?.value, previousTo = toSelect?.value;
  const rememberPair = () => { previousFrom = fromSelect?.value; previousTo = toSelect?.value; updateRateLabels(); updateResults(); };
  const onFromChange = () => { if (fromSelect.value === toSelect.value) toSelect.value = previousFrom; rememberPair(); };
  const onToChange = () => { if (toSelect.value === fromSelect.value) fromSelect.value = previousTo; rememberPair(); };
  const onSwap = () => { [fromSelect.value, toSelect.value] = [toSelect.value, fromSelect.value]; rememberPair(); };
  fromSelect?.addEventListener('change', onFromChange);
  toSelect?.addEventListener('change', onToChange);
  swapButton?.addEventListener('click', onSwap);
  if (pairMode) {
    try {
      const cached = JSON.parse(global.localStorage.getItem(cacheKey));
      if (cached?.rates?.[base] === 1 && [...targets, 'USD'].every(code => Number.isFinite(cached.rates[code]) && cached.rates[code] > 0)) {
        rates = cached.rates;
        if (lastUpdated) { lastUpdated.textContent = `汇率日期：${cached.date}`; lastUpdated.hidden = false; }
      }
    } catch (_) { /* An invalid cache is ignored; manual refresh remains available. */ }
  }
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
      fromSelect?.removeEventListener('change', onFromChange);
      toSelect?.removeEventListener('change', onToChange);
      swapButton?.removeEventListener('click', onSwap);
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
