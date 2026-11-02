#!/usr/bin/env node
const FLIGHT_SENSITIVE = /姓名|乘机人|旅客|证件|护照|订单|票号|二维码|条[形]?码|\b(?:PNR|PASSENGER|PASSPORT|TICKET\s*(?:NO|NUMBER)|BOOKING\s*REF)\b/i;
const FLIGHT_SYNC_FIELDS = Object.freeze([
  "id", "legLabel", "flightNumber", "airline", "departureDate", "arrivalDate",
  "departureTime", "arrivalTime", "departureCode", "arrivalCode", "departureAirport",
  "arrivalAirport", "departureTerminal", "arrivalTerminal", "durationMinutes", "seat",
  "gate", "baggageClaim", "connection", "detailUrl"
]);

function safeFlightDetailUrl(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    let decoded = raw;
    for (let index = 0; index < 3; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    if (/%[0-9a-f]{2}|[\s\\]/i.test(decoded) || /pnr|passenger|passport|ticket[-_ ]?(?:no|number)|order[-_ ]?(?:id|no|number)|booking[-_ ]?(?:ref|reference)|姓名|证件|订单|票号|乘机人/i.test(decoded)) return "";
    return url.href;
  } catch (_invalidUrl) { return ""; /* Invalid user input is an expected validation result. */ }
}

function sanitizeFlightAirport(value) {
  const text = String(value == null ? "" : value).trim();
  return text && text.length <= 80 && !FLIGHT_SENSITIVE.test(text) ? text : "";
}

module.exports = { FLIGHT_SYNC_FIELDS, safeFlightDetailUrl, sanitizeFlightAirport };
