/* ── 08  weather forecast ── */
function initWeatherForecast(options = {}) {
  const root = options.root || document;
  const card = options.card || root.querySelector(options.cardSelector || "[data-weather-card]");
  if (!card || card.dataset.weatherReady === "true") return;
  const refreshButton = card.querySelector("[data-weather-refresh]");
  const status = card.querySelector("[data-weather-status]");
  const grid = card.querySelector("[data-weather-grid]");
  const dataKind = card.querySelector("[data-weather-data-kind]");
  const updatedAt = card.querySelector("[data-weather-updated-at]");
  const easterEgg = card.querySelector("[data-rain-easter-egg]");
  if (!refreshButton || !status || !grid) return;
  const locations = options.locations || readJsonIndex("[data-weather-locations]", card);
  const startDate = text(options.startDate || card.dataset.weatherStartDate);
  const endDate = text(options.endDate || card.dataset.weatherEndDate);
  const days = Math.min(7, Math.max(1, Number(options.days || card.dataset.weatherDays || 7)));
  const threshold = Number(options.rainThreshold || card.dataset.rainThreshold || 80);
  const fetchImpl = options.fetchImpl || global.fetch?.bind(global);
  const weatherText = { 0: "晴", 1: "大致晴朗", 2: "多云", 3: "阴", 45: "雾", 48: "雾凇", 51: "毛毛雨", 53: "毛毛雨", 55: "强毛毛雨", 61: "小雨", 63: "中雨", 65: "大雨", 80: "阵雨", 81: "阵雨", 82: "强阵雨", 95: "雷暴", 96: "雷暴伴冰雹", 99: "强雷暴伴冰雹" };
  const format = (value, digits = 0) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
  const dateOnly = (date) => new Date(date + "T00:00:00");
  const formatDate = (date) => date ? date.slice(5).replace("-", "/") : "—";
  const localIsoDate = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  const addDays = (date, amount) => { const next = dateOnly(date); next.setDate(next.getDate() + amount); return localIsoDate(next); };
  const weatherCacheKey = `travel-guide-weather-summary:v2:${location.pathname}:${startDate}:${endDate}:${JSON.stringify(locations.map(item => [item.placeId, item.name, item.latitude, item.longitude]))}`;
  const locationKey = item => item.placeId || item.name;
  const rowsForLocation = (rows, item) => rows[locationKey(item)] || (locations.filter(other => other.name === item.name).length === 1 ? rows[item.name] : null);
  const applyDayWeather = (summary) => {
    root.querySelectorAll("[data-itinerary-date]").forEach((day) => {
      const badge = day.querySelector("[data-day-weather]");
      if (!badge) return;
      const matches = locations.filter(item => day.dataset.weatherPlaceId
        ? item.placeId === day.dataset.weatherPlaceId
        : item.name === day.dataset.city);
      const selected = matches.length === 1 ? matches[0] : (!day.dataset.city && !day.dataset.weatherPlaceId && locations.length === 1 ? locations[0] : null);
      const row = selected ? summary?.[locationKey(selected)]?.[day.dataset.itineraryDate] : null;
      badge.textContent = row ? `${row.weather} · 降雨 ${row.chance}% · ${row.min}–${row.max}°C` : "天气待刷新";
      badge.title = selected ? `天气地点：${selected.name}` : '尚未匹配当天预报地点';
      badge.setAttribute('aria-label', selected ? `${selected.name}：${badge.textContent}` : badge.textContent);
      badge.classList.toggle("is-risk", Boolean(row && row.chance >= threshold));
    });
  };
  const syncDayWeather = (rowsByLocation) => {
    const summary = Object.fromEntries(locations.map(item => [locationKey(item), Object.fromEntries(
      (rowsForLocation(rowsByLocation, item) || []).map(row => [row.date, { weather: row.weather, chance: Math.round(Number(row.chance) || 0), min: Math.round(Number(row.min)), max: Math.round(Number(row.max)) }])
    )]));
    applyDayWeather(summary);
    try { sessionStorage.setItem(weatherCacheKey, JSON.stringify(summary)); } catch (_error) {}
  };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tripStart = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? dateOnly(startDate) : null;
  const tripEnd = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? dateOnly(endDate) : (tripStart ? dateOnly(addDays(startDate, days - 1)) : null);
  const daysUntilStart = tripStart ? Math.round((tripStart - today) / 86400000) : 0;
  const withinForecastWindow = !tripStart || (daysUntilStart <= 7 && (!tripEnd || today <= tripEnd));
  const enabled = options.enabled ?? (card.dataset.weatherEnabled === "true" || (card.dataset.weatherEnabled !== "false" && withinForecastWindow));
  const render = (rowsByLocation) => {
    grid.innerHTML = locations.map((location) => {
      const rows = rowsForLocation(rowsByLocation, location);
      if (!rows) return '<article class="guide-weather-location is-error"><h4>' + escapeHtml(location.name) + "<small>" + escapeHtml(location.label || "") + '</small></h4><p class="guide-weather-location-error">该地点暂时获取失败，请稍后重试。</p></article>';
      const body = rows.map((row) => '<tr><td>' + formatDate(row.date) + '</td><td class="weather">' + escapeHtml(row.weather) + "<br>" + format(row.min) + "–" + format(row.max) + '°C</td><td class="metric">最高约 ' + format(row.feel) + '°C</td><td class="metric">' + format(row.rain, 1) + " mm · " + format(row.hours) + " 小时<br>降雨 " + format(row.chance) + '%</td><td class="metric">' + format(row.gust) + " km/h · UV " + format(row.uv) + "<br>日落 " + escapeHtml(row.sunset || "—") + "</td></tr>").join("");
      return '<article class="guide-weather-location"><h4>' + escapeHtml(location.name) + "<small>" + escapeHtml(location.label || "") + '</small></h4><div class="guide-weather-table-wrap"><table class="guide-weather-table"><thead><tr><th>日期</th><th>天气 / 温度</th><th>体感</th><th>雨量 / 雨时</th><th>阵风 / UV / 日落</th></tr></thead><tbody>' + body + "</tbody></table></div></article>";
    }).join("");
    if (easterEgg) easterEgg.hidden = !Object.values(rowsByLocation).some((rows) => rows?.some((row) => Number(row.chance) >= threshold));
    syncDayWeather(rowsByLocation);
  };
  const requestWithRetry = async (url, opts, maxAttempts = 3) => {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? global.setTimeout(() => controller.abort(), 12000) : null;
      try {
        const response = await fetchImpl(url, { ...opts, signal: controller?.signal });
        if (response.ok) return response;
        if (response.status >= 400 && response.status < 500) throw new Error("HTTP " + response.status);
        if (attempt === maxAttempts - 1) throw new Error("HTTP " + response.status);
      } catch (error) {
        if (attempt === maxAttempts - 1) throw error;
      } finally { if (timer) global.clearTimeout(timer); }
      await new Promise((resolve) => global.setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  };
  const requestLocation = async (location) => {
    if (!fetchImpl) throw new Error("fetch unavailable");
    const todayIso = localIsoDate(new Date());
    const queryStart = tripStart && today > tripStart ? todayIso : (startDate || todayIso);
    const plannedEnd = addDays(queryStart, days - 1);
    const queryEnd = tripEnd && dateOnly(plannedEnd) > tripEnd ? localIsoDate(tripEnd) : plannedEnd;
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: location.latitude, longitude: location.longitude,
      daily: "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_sum,precipitation_hours,precipitation_probability_max,wind_gusts_10m_max,uv_index_max,sunset",
      timezone: location.timezone || options.timezone || "auto", start_date: queryStart, end_date: queryEnd
    });
    const response = await requestWithRetry(url, { cache: "no-store", headers: { Accept: "application/json" } });
    const daily = (await response.json()).daily;
    if (!daily?.time?.length) throw new Error(location.name + " weather response empty");
    return [locationKey(location), daily.time.map((date, index) => ({
      date, weather: weatherText[daily.weather_code[index]] || "待核验",
      min: daily.temperature_2m_min[index], max: daily.temperature_2m_max[index], feel: daily.apparent_temperature_max[index],
      rain: daily.precipitation_sum[index] || 0, hours: daily.precipitation_hours[index] || 0,
      chance: daily.precipitation_probability_max[index] || 0, gust: daily.wind_gusts_10m_max[index] || 0,
      uv: daily.uv_index_max[index] || 0, sunset: (daily.sunset[index] || "").slice(11, 16)
    }))];
  };
  const refresh = async () => {
    refreshButton.disabled = true;
    card.classList.add("is-loading");
    refreshButton.textContent = "正在刷新…";
    status.textContent = "正在获取 " + locations.map((item) => item.name).join("、") + " 的体感、雨量、阵风、UV 与日落…";
    try {
      if (!locations.length) throw new Error("weather locations missing");
      const settled = await Promise.allSettled(locations.map(requestLocation));
      const successes = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
      if (!successes.length) throw new Error("all weather requests failed");
      const rows = Object.fromEntries(successes);
      const failedCount = settled.length - successes.length;
      render(rows);
      if (dataKind) { dataKind.textContent = failedCount ? "部分刷新成功" : "已刷新：Open‑Meteo 预报"; dataKind.classList.remove("is-waiting"); }
      status.textContent = failedCount
        ? "已更新 " + successes.length + " 个地点，" + failedCount + " 个地点获取失败。"
        : "天气已刷新。";
      if (updatedAt) updatedAt.innerHTML = "<strong>更新时间：</strong>" + new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date());
    } catch (_error) {
      status.textContent = global.location?.protocol === "file:" ? "天气请求失败，请通过本地 HTTP 预览后重试。" : "天气请求失败，请重试。";
    } finally {
      refreshButton.disabled = false;
      card.classList.remove("is-loading");
      refreshButton.textContent = "刷新天气";
    }
  };
  const modal = card.querySelector("[data-rain-prayer-modal]");
  const frame = card.querySelector("[data-rain-prayer-frame]");
  const closeButton = card.querySelector("[data-rain-prayer-close]");
  const openButton = card.querySelector("[data-rain-prayer-open]");
  const prayerSource = readJsonIndex("[data-rain-prayer-source]", card);
  let prayerLastFocus = null;
  const closePrayer = () => { if (!modal || !frame) return; modal.hidden = true; frame.srcdoc = ""; root.body.style.overflow = ""; prayerLastFocus?.focus?.(); prayerLastFocus = null; };
  openButton?.addEventListener("click", (event) => {
    event.preventDefault();
    if (!modal || !frame || typeof prayerSource !== "string") return;
    prayerLastFocus = root.activeElement;
    closeButton.hidden = true;
    frame.srcdoc = prayerSource;
    modal.hidden = false;
    root.body.style.overflow = "hidden";
    const panel = modal.querySelector(".guide-rain-prayer-panel");
    if (panel && !panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
    panel?.focus?.({ preventScroll: true });
  });
  closeButton?.addEventListener("click", closePrayer);
  root.addEventListener("keydown", (event) => { if (event.key === "Escape" && modal && !modal.hidden) closePrayer(); });
  global.addEventListener("message", (event) => {
    if (frame && event.source === frame.contentWindow && event.data?.type === "rain-prayer-complete") closeButton.hidden = false;
  });
  card.dataset.weatherReady = "true";
  refreshButton.disabled = !enabled;
  refreshButton.textContent = enabled ? "刷新天气" : "T-7 开启";
  refreshButton.title = enabled ? "手动刷新天气" : "将在行程开始前 7 天开放天气刷新";
  refreshButton.setAttribute("aria-label", refreshButton.title);

  try { applyDayWeather(JSON.parse(sessionStorage.getItem(weatherCacheKey) || "null")); } catch (_error) {}

  if (!enabled && dataKind) dataKind.textContent = "预测窗口尚未开启";
  status.textContent = enabled ? '点击刷新查看预报。' : options.disabledText || "出发前 7 天开放预报。";
  refreshButton.addEventListener("click", refresh);
  return { refresh, render };
}
