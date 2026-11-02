#!/usr/bin/env node
const assert = require("assert");
const { findUncoveredFlightDates } = require("./validate-trip-data.js");

const flights = [
  { departureDate: "2026-09-24", arrivalDate: "2026-09-24" },
  { departureDate: "2026-10-06", arrivalDate: "2026-10-07" }
];

assert.deepStrictEqual(
  findUncoveredFlightDates(flights, ["2026-09-24", "2026-10-06"], ["2026-10-07"]),
  [],
  "明确排除的跨日航班日期应通过覆盖门禁"
);
assert.deepStrictEqual(
  findUncoveredFlightDates(flights, ["2026-10-06"], ["2026-10-07"]),
  [
    { index: 0, field: "departureDate", date: "2026-09-24" },
    { index: 0, field: "arrivalDate", date: "2026-09-24" }
  ],
  "未进入逐日清单且未明确排除的航班日期必须被拦截"
);

console.log("PASS flight date coverage");
