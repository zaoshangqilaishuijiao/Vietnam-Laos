#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { PAGE_TEMPLATE_VERSION } = require("./shared-constants.js");
const { requiredLockedFiles } = require("./locked-files.js");

function verifyTemplateLock(skillRoot = path.resolve(__dirname, "..")) {
  const lockPath = path.join(skillRoot, "assets", "page-template.lock.json");
  if (!fs.existsSync(lockPath)) throw new Error("缺少 assets/page-template.lock.json，禁止在模板版本不明时生成网页。");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  if (!lock.templateVersion || !lock.files || typeof lock.files !== "object") throw new Error("页面模板锁文件格式无效。");
  if (lock.templateVersion !== PAGE_TEMPLATE_VERSION) throw new Error(`页面模板锁版本 ${lock.templateVersion} 与渲染器模板版本 ${PAGE_TEMPLATE_VERSION} 不一致；模板升级必须同步更新锁文件。`);
  const drift = [];
  for (const file of requiredLockedFiles(skillRoot)) if (!lock.files[file]) drift.push(`${file}（未纳入锁）`);
  Object.entries(lock.files).forEach(([relativePath, expected]) => {
    const file = path.resolve(skillRoot, relativePath);
    if (!file.startsWith(path.resolve(skillRoot) + path.sep) || !fs.existsSync(file)) { drift.push(`${relativePath}（缺失）`); return; }
    const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (actual !== expected) drift.push(relativePath);
  });
  if (drift.length) throw new Error(`2.0 页面模板已发生未登记变更：${drift.join("、")}。普通攻略只允许修改结构化数据；如属特殊需求，请明确升级模板版本并更新锁文件。`);
  return { valid: true, templateVersion: lock.templateVersion, files: Object.keys(lock.files).length };
}

if (require.main === module) {
  try { console.log(JSON.stringify(verifyTemplateLock(), null, 2)); }
  catch (error) { console.error(error.message); process.exit(1); }
}

module.exports = { verifyTemplateLock };
