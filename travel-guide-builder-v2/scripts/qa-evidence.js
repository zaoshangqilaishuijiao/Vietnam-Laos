const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { collectLocalAssetReferences } = require("./build-public-guide.js");
const REQUIRED_CHECKS = ["desktop", "mobile390", "mobile412", "console", "map", "interactions"];
const statusForChecks = checks => checks?.find(check => check.name === "map")?.status === "degraded"
  ? "passed_with_limitations" : "passed";
function browserValidationAcceptable(validation) {
  return validation?.status === statusForChecks(validation?.checks)
    && REQUIRED_CHECKS.every(name => {
      const check = validation.checks?.find(item => item.name === name);
      return String(check?.evidence || "").trim()
        && (check.status === "passed" || (name === "map" && check.status === "degraded"));
    });
}
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const sha256 = file => digest(fs.readFileSync(file));
function assetDigest(html) {
  const root = fs.realpathSync(path.dirname(html));
  const assets = [...collectLocalAssetReferences(fs.readFileSync(html, "utf8"))].sort().map(relative => {
    const file = path.resolve(root, relative);
    if (!fs.realpathSync(file).startsWith(root + path.sep)) throw Error("验收资源越界");
    return [relative, sha256(file)];
  });
  return digest(JSON.stringify(assets));
}
function validateEvidence(evidence, source, artifact, build) {
  if (!["browser-run", "manual-attestation"].includes(evidence?.method)) throw Error("验收必须声明 browser-run 或 manual-attestation");
  if (!evidence.reviewer || !Number.isFinite(Date.parse(evidence.checkedAt))) throw Error("缺少验收者或有效验收时间");
  if (evidence.sourceSha256 !== sha256(source) || evidence.artifactSha256 !== sha256(artifact)
    || evidence.assetSha256 !== assetDigest(source) || assetDigest(artifact) !== assetDigest(source)) throw Error("验收证据与源文件、产物或资源哈希不一致");
  if (source !== artifact && (!build || build.sourceSha256 !== sha256(source) || build.artifactSha256 !== sha256(artifact) || build.assetSha256 !== assetDigest(source))) throw Error("缺少匹配的本地构建证明");
  for (const name of REQUIRED_CHECKS) {
    const check = evidence.checks?.find(c => c.name === name);
    if (!String(check?.evidence || "").trim()
      || (check.status !== "passed" && !(name === "map" && check.status === "degraded"))) {
      throw Error(`验收缺少通过结果及证据：${name}`);
    }
  }
  return { ...evidence, status: statusForChecks(evidence.checks), htmlSha256: sha256(source), build: build || null };
}
module.exports = { REQUIRED_CHECKS, digest, sha256, assetDigest, browserValidationAcceptable, validateEvidence };
