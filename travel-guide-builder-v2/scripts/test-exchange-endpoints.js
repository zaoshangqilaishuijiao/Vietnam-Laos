#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const asset = fs.readFileSync(path.join(__dirname, "..", "assets", "travel-guide-interactions.js"), "utf8");
const cnyGuard = 'const fallbackEndpoint = base === "CNY" ? "" :';
if (!asset.includes(cnyGuard)) throw new Error("CNY fallback guard is missing");
if (!asset.includes("https://open.er-api.com/v6/latest/${encodeURIComponent(base)}")) throw new Error("primary exchange endpoint is missing");
if (!asset.includes("https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(targetList)}")) throw new Error("non-CNY fallback endpoint is missing");

const exchangeStart = asset.indexOf("function initExchange(options = {}) {");
const exchangeEnd = asset.indexOf("\nfunction initWeatherForecast", exchangeStart);
if (exchangeStart < 0 || exchangeEnd < 0) throw new Error("initExchange boundary is missing");
const exchangeCode = asset.slice(exchangeStart, exchangeEnd);
if (!exchangeCode.includes("refreshButton.addEventListener('click', onRefreshClick)")) {
  throw new Error("exchange refresh is not bound to the user click");
}
if (!exchangeCode.includes("input.addEventListener('keydown', onInputKeyDown)")) throw new Error("exchange refresh is not bound to Enter");

console.log("PASS exchange endpoint, fallback, and manual-refresh contract");
