/* ── 14  booking ledger ── */
function initBookingLedger({ root = document } = {}) {
  const storagePrefix = `travel-guide-bookings:${root.body?.dataset?.guideId || location.pathname}:`;
  const labels = { confirmed: "已预订", pending: "待预订", verify: "待核验" };
  root.querySelectorAll('[data-booking-toggle][data-local-booking="true"]').forEach((button) => {
    if (button.dataset.bookingReady === "true") return;
    const key = button.dataset.bookingId; if (!key) return;
    const apply = (status) => { button.classList.remove("is-confirmed", "is-pending", "is-verify"); button.classList.add(`is-${status}`); button.dataset.bookingStatus = status; button.textContent = labels[status] || labels.verify; button.setAttribute("aria-pressed", String(status === "confirmed")); };
    let status = button.dataset.bookingInitialStatus || "verify";
    try { status = localStorage.getItem(storagePrefix + key) || status; } catch (_error) {}
    apply(status);
    button.addEventListener("click", () => { const current = button.dataset.bookingStatus || status; status = current === "confirmed" ? "pending" : current === "pending" ? "verify" : "confirmed"; apply(status); try { localStorage.setItem(storagePrefix + key, status); } catch (_error) {} });
    button.dataset.bookingReady = "true";
  });
  return { refresh: () => initBookingLedger({ root }) };
}
