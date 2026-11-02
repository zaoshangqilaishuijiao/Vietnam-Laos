#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { readOption } = require("./cli-options.js");

const { REQUIRED_CHECKS, sha256, assetDigest, validateEvidence } = require("./qa-evidence.js");
const { validateGuideContract } = require("./validate-guide-contract.js");
const usage = "Usage: node record-browser-qa.js <source.html> --validation=<report.json> [--artifact=<built.html>] --evidence=<browser-results.json>";

function main(args = process.argv.slice(2)) {
  const file = args.find((arg) => !arg.startsWith("--"));
  const validationArg = readOption(args, "validation");
  const evidencePath = readOption(args, "evidence");
  if (!file || !validationArg || !evidencePath) throw new Error(usage);
  const html = path.resolve(file);
  const validation = path.resolve(validationArg);
  const report = JSON.parse(fs.readFileSync(validation, "utf8"));
  if (path.basename(html) !== report.output) throw new Error(`验证报告输出为 ${report.output}，与目标 HTML ${path.basename(html)} 不一致。`);
  if (!report.htmlValidation?.valid || report.htmlValidation.htmlSha256 !== sha256(html)) throw Error("静态验收失效，请重新渲染");
  const artifact = path.resolve(readOption(args, "artifact") || html);
  if (fs.readFileSync(artifact, "utf8").includes("__GUIDE_BUILD_SHA__")) throw Error("请在注入配置后的本地产物上验收，并使用 --artifact");
  const result = validateGuideContract(fs.readFileSync(artifact, "utf8"), { full: true, expectedDatesOption: (report.htmlValidation.expectedDates || []).join(",") });
  if (!result.valid) throw Error("产物静态契约不通过，不能登记浏览器通过");
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  const build = artifact === html ? null : JSON.parse(fs.readFileSync(artifact + ".build.json", "utf8"));
  report.browserValidation = validateEvidence(evidence, html, artifact, build);
  fs.writeFileSync(validation, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`已记录浏览器验收：${path.basename(html)} status=${report.browserValidation.status} sha256=${report.browserValidation.htmlSha256.slice(0, 12)} checks=${REQUIRED_CHECKS.join(",")}`);
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exit(2); } }
module.exports = { REQUIRED_CHECKS, sha256, assetDigest };
