#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const scriptsRoot = __dirname;
const failures = [];
const run = (args, label) => {
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, TRAVEL_GUIDE_REQUIRE_JSDOM: "1" }
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) failures.push(label);
};

fs.readdirSync(scriptsRoot)
  .filter((name) => name.endsWith(".js"))
  .forEach((name) => run(["--check", path.join(scriptsRoot, name)], `${name} 语法检查`));

const assetFiles = [path.join(scriptsRoot, "..", "assets", "ics-calendar.js"), path.join(scriptsRoot, "..", "assets", "travel-guide-interactions.js"), path.join(scriptsRoot, "..", "assets", "supabase-execution-sync.js")];
fs.readdirSync(path.join(scriptsRoot, "..", "assets", "modules"))
  .filter((name) => name.endsWith(".js"))
  .forEach((name) => assetFiles.push(path.join(scriptsRoot, "..", "assets", "modules", name)));
assetFiles.forEach((file) => run(["--check", file], `${path.basename(file)} 语法检查`));
run([path.join(scriptsRoot, "combine-interactions-modules.js"), "--check"], "交互模块组合一致性");

fs.readdirSync(path.join(scriptsRoot, "..", "assets", "data"))
  .filter((name) => name.endsWith(".json"))
  .forEach((name) => {
    try {
      JSON.parse(fs.readFileSync(path.join(scriptsRoot, "..", "assets", "data", name), "utf8"));
    } catch (error) {
      failures.push(`${name} JSON 解析`);
      console.error(error.message);
    }
  });

[
  "test-date-coverage-validator.js",
  "test-full-contract-validator.js",
  "test-exchange-endpoints.js",
  "test-exchange-modal.js",
  "test-calendar-export.js",
  "test-compact-layout.js",
  "test-hero-template.js",
  "test-segment-navigation.js",
  "test-route-summary-runtime.js",
  "test-travel-mode.js",

  "test-data-pipeline.js",
  "test-contextual-explore.js",
  "test-nearby-map.js",
  "test-nearby-legacy-upgrade.js",
  "test-schema-validator.js",
  "test-interactions-dom.js",
  "test-flight-records.js",
  "test-arrival-forms.js",
  "test-flight-date-coverage.js",
  "test-flight-sync.js",
  "test-collaboration-runtime.js",
  "test-map-loader.js",
  "test-map-providers.js",
  "test-version-consistency.js",
  "test-structure-integrity.js",
  "test-template-lock.js",
  "test-incremental-gates.js",
  "test-content-continuity.js",
  "test-map-runtime.js",
  "test-portability.js",
  "test-collaboration-contract.js",
  "test-public-deploy.js",
  "test-git-email-gate.js",
  "test-context-tools.js",
  "test-research-store.js",
  "test-supplementary-reading.js",
  "test-preview-guide.js",
  "test-shared-rules.js",
  "test-review-regressions.js",
  "test-review-followups.js",
  "test-review-publishing.js",
  "test-render-artifacts.js",
  "test-render-delivery.js",
  "test-weather-cities.js",
  "test-map-pending.js",
  "test-pinbook-export.js",
  "test-sql-migrations.js"
].forEach((name) => run([path.join(scriptsRoot, name)], name));

if (failures.length) {
  console.error(`失败（${failures.length} 项）：\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("通过：travel-guide-builder-v2 全量本地回归");
