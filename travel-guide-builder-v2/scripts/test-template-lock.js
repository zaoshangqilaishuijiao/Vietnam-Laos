#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { verifyTemplateLock } = require("./verify-template-lock.js");
const { PAGE_TEMPLATE_VERSION } = require("./shared-constants.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "guide-template-lock-"));
const cleanup = () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch (_error) {} };
try {
  runCases();
} finally {
  cleanup();
}
console.log("PASS template lock and drift rejection");

function runCases() {
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  for (const folder of ["template","scripts","supabase",".githooks","references"]) fs.mkdirSync(path.join(root, folder), { recursive: true });
  for (const file of ["references/trip-data.schema.json","references/module-registry.json"]) fs.writeFileSync(path.join(root,file),"{}");
  const file = path.join(root, "template", "shell.txt");
  fs.writeFileSync(file, "locked", "utf8");
  const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  fs.writeFileSync(path.join(root, "assets", "page-template.lock.json"), JSON.stringify({ templateVersion: PAGE_TEMPLATE_VERSION, files: { "template/shell.txt": hash, ...Object.fromEntries(require("./locked-files.js").requiredLockedFiles(root).map(f => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(root,f))).digest("hex")])) } }), "utf8");

  verifyTemplateLock(root);
  fs.writeFileSync(file, "drift", "utf8");
  let rejected = false;
  try { verifyTemplateLock(root); } catch (error) { rejected = /未登记变更/.test(error.message); }
  if (!rejected) throw new Error("模板锁未拒绝资产漂移");
  fs.writeFileSync(file, "locked", "utf8");
  fs.writeFileSync(path.join(root, "assets", "page-template.lock.json"), JSON.stringify({ templateVersion: "0.0.0-stale", files: { "template/shell.txt": hash, ...Object.fromEntries(require("./locked-files.js").requiredLockedFiles(root).map(f => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(root,f))).digest("hex")])) } }), "utf8");
  let versionRejected = false;
  try { verifyTemplateLock(root); } catch (error) { versionRejected = /不一致/.test(error.message); }
  if (!versionRejected) throw new Error("模板锁未拒绝版本不一致");
}
