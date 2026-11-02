#!/usr/bin/env node
/**
 * combine-interactions-modules.js
 * Reads individual module files from assets/modules/ and combines
 * them into a single travel-guide-interactions.js file that is
 * byte-for-byte equivalent to the original monolithic file.
 */
const fs = require("fs");
const path = require("path");
const { ASSET_SENTINELS } = require("./shared-constants.js");

const skillRoot = path.resolve(__dirname, "..");
const modulesDir = path.join(skillRoot, "assets", "modules");
const outputFile = path.join(skillRoot, "assets", "travel-guide-interactions.js");

// Module order is derived from the numeric filename prefix so a valid new module
// cannot pass syntax checks while being silently omitted from the combined asset.
const discoveredJsFiles = fs.readdirSync(modulesDir).filter((name) => name.endsWith(".js"));
const invalidModuleNames = discoveredJsFiles.filter((name) => !/^\d{2}-[a-z0-9-]+\.js$/.test(name));
if (invalidModuleNames.length) throw new Error(`交互模块文件名无效：${invalidModuleNames.join("、")}`);
const moduleFiles = discoveredJsFiles.sort((left, right) => left.localeCompare(right, "en"));
moduleFiles.forEach((file, index) => {
  const expectedPrefix = String(index + 1).padStart(2, "0") + "-";
  if (!file.startsWith(expectedPrefix)) throw new Error(`交互模块编号不连续：应为 ${expectedPrefix}，实际为 ${file}`);
});

// 版本哨兵唯一来源是 shared-constants.js 的 ASSET_SENTINELS。升级资产时先更新该常量，
// 再运行本脚本重新生成；--check（由全量回归执行）会自动校验产物与常量一致，防止漂移。
const shouldCheck = process.argv.includes("--check");
const interactionsSentinel = ASSET_SENTINELS.find((entry) => entry.file === "assets/travel-guide-interactions.js");
const versionHeader = `/* ${interactionsSentinel.marker} */`;

// Assemble output
const preamble = `${versionHeader}\n(function initTravelGuideInteractions(global) {\n  "use strict";\n\n`;
const parts = [];

moduleFiles.forEach((file) => {
  const filePath = path.join(modulesDir, file);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing module file: ${filePath}`);
    process.exit(1);
  }
  let content = fs.readFileSync(filePath, "utf8");
  // Remove block comment headers (/* ... */)
  content = content.replace(/^\/\*\s*──\s+\d+\s+\w+.*?\*\/\s*\n?/m, "");
  parts.push(content.trim());
});

// Postamble: close IIFE
const postamble = `\n})(window);\n`;

const combined = preamble + "\n\n" + parts.join("\n\n") + postamble;

if (shouldCheck) {
  const existing = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : "";
  if (existing !== combined) {
    console.error("交互模块组合结果与 assets/travel-guide-interactions.js 不一致；请先更新 shared-constants.js 的 ASSET_SENTINELS，再运行 combine-interactions-modules.js 后更新模板锁。");
    process.exit(1);
  }
  console.log("通过：交互模块组合结果与发布文件一致");
} else {
  fs.writeFileSync(outputFile, combined, "utf8");
  console.log(`Written ${combined.length} bytes to ${outputFile}`);
}
