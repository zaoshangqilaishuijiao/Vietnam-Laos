#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { GUIDE_DATA_VERSION } = require("./shared-constants.js");
const { FLIGHT_SYNC_FIELDS, safeFlightDetailUrl, sanitizeFlightAirport } = require("./flight-record-rules.js");
const browserFlights = require("../assets/modules/15-flight-records.js");
const summary = require("./summarize-trip-brief.js");

assert.equal(typeof summary.buildTripBriefSummary, "function");
assert.equal(summary.main([], { error() {}, log() {} }), 2, "summary CLI should report usage without terminating an importing process");

const coreSource = fs.readFileSync(path.join(__dirname, "../assets/modules/01-core-utilities.js"), "utf8");
const browserEscapeHtml = new Function(`${coreSource}\nreturn escapeHtml;`)();
for (const [value, expected] of [[0, "0"], [false, "false"], [" x ", " x "], ["<&", "&lt;&amp;"]]) {
  const nodeEscaped = String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  assert.equal(browserEscapeHtml(value), expected);
  assert.equal(browserEscapeHtml(value), nodeEscaped);
}

const urls = [
  "https://example.com/flights?route=Paris",
  "http://example.com/flights",
  "https://user:secret@example.com/flights",
  "https://example.com/?pnr=secret",
  "https://example.com/?next=%2523pnr%253Dsecret",
  "not a url"
];
for (const url of urls) assert.equal(browserFlights.safeFlightDetailUrl(url), safeFlightDetailUrl(url), `flight URL rules drifted for ${url}`);
for (const airport of ["巴黎戴高乐机场", " PNR secret ", "A".repeat(81)]) {
  assert.equal(browserFlights.sanitizeFlightRecord({ departureAirport: airport }).departureAirport, sanitizeFlightAirport(airport), `flight airport rules drifted for ${airport}`);
}

const hardeningSql = fs.readFileSync(path.join(__dirname, "../supabase/006_flight_sync_hardening.sql"), "utf8");
const allowedBody = hardeningSql.match(/allowed text\[\]\s*:=\s*array\[([^\]]+)\]/)?.[1] || "";
const sqlFields = [...allowedBody.matchAll(/'([^']+)'/g)].map((match) => match[1]);
assert.deepEqual(sqlFields, FLIGHT_SYNC_FIELDS, "SQL 006 flight allowlist drifted from the application contract");
assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname, "../references/trip-data.schema.json"), "utf8")).properties.schemaVersion.const, GUIDE_DATA_VERSION);

console.log("PASS importable summary, shared escaping, data version and flight-rule parity");
