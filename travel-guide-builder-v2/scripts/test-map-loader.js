#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "scripts", "render-guide.js"), "utf8");
const publishing = fs.readFileSync(path.join(root, "references", "web-output-and-publishing.md"), "utf8");
const routeCss = fs.readFileSync(path.join(root, "assets", "route-map.css"), "utf8");
const { ASSET_SENTINELS } = require("./shared-constants.js");
const fail = (message) => { throw new Error(message); };

if (/tile-loader\.js|loadLeaflet|startLeaflet|window\.L/.test(renderer)) fail("渲染器不得引用旧 Leaflet 运行时");
if (/Leaflet JavaScript|地图瓦片.*多源降级/.test(publishing)) fail("发布规则仍保留旧 Leaflet 双源真相");
if (!routeCss.includes(ASSET_SENTINELS.find(asset => asset.file === "assets/route-map.css").marker) || !routeCss.includes(".route-map-loading") || !routeCss.includes(".route-map-status")) fail("地图通用状态样式缺失");
if (!/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.route-map-loading\.is-visible \{ animation: none; \}/.test(routeCss)) fail("地图骨架动画缺少减少动效降级");
console.log("PASS active map runtime has no legacy Leaflet dependency");
