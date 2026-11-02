// Shared content policy. Legacy records retain their original 5–10 contract.
const NEARBY_STATUSES = Object.freeze(["show", "hide-late-arrival", "hide-early-departure", "hide-no-free-window", "research-pending"]);
const HIDDEN_STATUSES = new Set(NEARBY_STATUSES.filter(status => status.startsWith("hide-")));
const clockMinutes = value => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
const legacyNearbyDay = entry => entry?.status === undefined;
const visibleNearbyDay = entry => Boolean(entry && (legacyNearbyDay(entry) || entry.status === "show") && entry.candidates?.length);
function validateNearbyPolicy(entry, label, places, fail, formalDay) {
  const candidates = Array.isArray(entry?.candidates) ? entry.candidates : [];
  if (legacyNearbyDay(entry)) {
    if (["dayType", "reason", "freeWindows", "readyAt", "leaveAt"].some(key => entry?.[key] !== undefined)) fail(`${label} 含新策略字段时必须声明 status，不能混用旧版记录。`);
    if (candidates.length < 5 || candidates.length > 10) fail(`${label}.candidates 旧版记录必须有 5–10 个地点；采用新数量规则时请补齐逐日策略。`);
    return;
  }
  if (!NEARBY_STATUSES.includes(entry.status)) fail(`${label}.status 无效。`);
  if (!["ordinary", "transit"].includes(entry.dayType)) fail(`${label}.dayType 必须为 ordinary 或 transit，不能由航班/换城字段自动推断。`);
  if (typeof entry.reason !== "string" || !entry.reason.trim()) fail(`${label}.reason 必须说明交通日/普通日判定、数量或不显示的依据。`);
  const windows = Array.isArray(entry.freeWindows) ? entry.freeWindows : [];
  if (!Array.isArray(entry.freeWindows)) fail(`${label}.freeWindows 必须为数组；无已核实自由窗口可用空数组，不阻断有价值的推荐。`);
  let previousEnd = -1;
  for (const [index, window] of windows.entries()) {
    const wLabel = `${label}.freeWindows[${index}]`;
    const start = clockMinutes(window?.startTime), end = clockMinutes(window?.endTime);
    if (start === null || end === null || end <= start) fail(`${wLabel} 必须有同一目的地当地日期内递增的 HH:MM 开始/结束时间。`);
    else { if (start < previousEnd) fail(`${wLabel} 与前一个自由窗口重叠或乱序。`); previousEnd = end; }
    const anchor = places.find(place => place.id === window?.anchorPlaceId);
    if (!anchor?.coordinates) fail(`${wLabel}.anchorPlaceId 必须引用已确定且有坐标的目的地，不得虚构待定酒店。`);
    if (typeof window?.city !== "string" || !window.city.trim() || anchor && anchor.city !== window.city) fail(`${wLabel}.city 必须与锚点城市一致。`);
    if (!Number.isInteger(window?.bufferMinutes) || window.bufferMinutes < 0) fail(`${wLabel}.bufferMinutes 必须记录已扣除的非负缓冲分钟数。`);
    if (typeof window?.basis !== "string" || !window.basis.trim()) fail(`${wLabel}.basis 必须说明窗口与必要缓冲的依据。`);
    if (clockMinutes(entry.readyAt) !== null && start !== null && start < clockMinutes(entry.readyAt)) fail(`${wLabel} 不能早于完成抵达、接驳和入住的 readyAt。`);
    if (clockMinutes(entry.leaveAt) !== null && end !== null && end > clockMinutes(entry.leaveAt)) fail(`${wLabel} 不能晚于离开游玩区域的 leaveAt。`);
    for (const [itemIndex, item] of (formalDay?.items || []).entries()) {
      if (['cancelled', 'candidate'].includes(item.reservationStatus)) continue;
      const itemStart = clockMinutes(item.startTime), itemEnd = clockMinutes(item.endTime);
      // timeText remains flexible. Never infer clock times from prose or compare cities' local clocks.
      if (start === null || end === null || itemStart === null || itemEnd === null || itemEnd <= itemStart) continue;
      const city = places.find(place => place.id === item.placeId)?.city || formalDay.city;
      if (city !== window.city) continue;
      const previousCity = places.find(place => place.id === formalDay.items[itemIndex - 1]?.placeId)?.city;
      const travel = previousCity === city && Number.isInteger(item.travelMinutes) ? item.travelMinutes : 0;
      if (start < itemEnd && end > itemStart - travel) fail(`${wLabel} 与确定行程 ${item.id}（含同城接驳）冲突；请纠正自由窗口，或删除该窗口并省略相关候选窗口引用，不要为推荐改写正式时间。`);
    }
  }
  for (const key of ["readyAt", "leaveAt"]) if (entry[key] !== undefined && clockMinutes(entry[key]) === null) fail(`${label}.${key} 必须为 HH:MM 当地时间。`);
  if (entry.status === "show") {
    const min = entry.dayType === "transit" ? 1 : 3, max = entry.dayType === "transit" ? 3 : 5;
    if (candidates.length < min || candidates.length > max) fail(`${label}.candidates ${entry.dayType === "transit" ? "真正交通日" : "普通日"}必须有 ${min}–${max} 个地点，按推荐价值选择，不以空闲分钟数筛除。`);
  } else if (HIDDEN_STATUSES.has(entry.status)) {
    if (candidates.length || windows.length) fail(`${label} 合理不显示日必须为 0 个候选和 0 个可用窗口。`);
    if (entry.status === "hide-late-arrival" && !(clockMinutes(entry.readyAt) > 22 * 60)) fail(`${label}.hide-late-arrival 需要 22:00 后完成抵达与入住的 readyAt；较早但无窗口请使用 hide-no-free-window。`);
    if (entry.status === "hide-early-departure" && !(clockMinutes(entry.leaveAt) !== null && clockMinutes(entry.leaveAt) < 12 * 60)) fail(`${label}.hide-early-departure 需要 12:00 前离开游玩区域的 leaveAt。`);
  } else if (entry.status === "research-pending") {
    fail(`${label} 研究未完成（research-pending），不能作为完整攻略交付；不得改成无自由窗口规避核验。`);
  }
}
module.exports = { NEARBY_STATUSES, HIDDEN_STATUSES, clockMinutes, legacyNearbyDay, visibleNearbyDay, validateNearbyPolicy };
