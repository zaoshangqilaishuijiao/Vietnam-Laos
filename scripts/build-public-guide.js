#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PUBLIC_PLACEHOLDERS, classifySupabaseKey, publicSourceViolations } = require("./public-config.js");

const [sourceArg, outputArg] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

function replaceRequired(source, placeholder, value, label) {
  if (!source.includes(placeholder)) return source;
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`公开部署缺少 ${label}；未写出不完整产物。`);
  return source.split(placeholder).join(normalized);
}

function buildPublicGuide(source, env = process.env) {
  if (publicSourceViolations(source).length) {
    throw new Error("公开源 HTML 已包含真实密钥形式；必须重新使用 --public-source 生成占位符版。");
  }
  let output = source;
  output = replaceRequired(output, PUBLIC_PLACEHOLDERS.googleKey, env.GOOGLE_MAPS_BROWSER_KEY, "GOOGLE_MAPS_BROWSER_KEY");
  output = replaceRequired(output, PUBLIC_PLACEHOLDERS.baiduAk, env.BAIDU_MAP_BROWSER_AK, "BAIDU_MAP_BROWSER_AK");
  output = replaceRequired(output, PUBLIC_PLACEHOLDERS.buildSha, env.GITHUB_SHA || env.GUIDE_BUILD_SHA, "GITHUB_SHA / GUIDE_BUILD_SHA");
  if (output.includes(PUBLIC_PLACEHOLDERS.supabaseProjectUrl) || output.includes(PUBLIC_PLACEHOLDERS.supabasePublishableKey)) {
    const projectUrl = String(env.SUPABASE_PROJECT_URL || "").trim().replace(/\/+$/, "");
    const match = projectUrl.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co$/i);
    if (!match) throw new Error("SUPABASE_PROJECT_URL 必须是 https://<project-ref>.supabase.co。");
    if (classifySupabaseKey(env.SUPABASE_PUBLISHABLE_KEY) !== "publishable") {
      throw new Error("SUPABASE_PUBLISHABLE_KEY 只允许 sb_publishable_ 或旧版 anon JWT；secret/service_role 已拦截。");
    }
    output = output.split(PUBLIC_PLACEHOLDERS.supabaseProjectUrl).join(projectUrl);
    output = output.split(PUBLIC_PLACEHOLDERS.supabasePublishableKey).join(String(env.SUPABASE_PUBLISHABLE_KEY).trim());
  }
  const unresolved = Object.values(PUBLIC_PLACEHOLDERS).filter((placeholder) => output.includes(placeholder));
  if (unresolved.length) throw new Error(`公开部署仍有未解析占位符：${unresolved.join("、")}`);
  return output;
}

function collectLocalAssetReferences(source) {
  const references = new Set();
  // Only HTML attributes are resources; inline runtime templates are not files.
  const markup = source.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, block => block.slice(0, block.indexOf(">") + 1));
  const attributePattern = /\s(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attributePattern.exec(markup))) {
    const raw = String(match[1] || "").trim();
    if (!raw || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(raw)) continue;
    const withoutQuery = raw.split("#")[0].split("?")[0];
    if (!withoutQuery) continue;
    let decoded;
    try { decoded = decodeURIComponent(withoutQuery); }
    catch (_error) { throw new Error(`本地资源路径无法解码：${raw}`); }
    if (decoded.includes("\\")) throw new Error(`本地资源路径不得使用反斜杠：${raw}`);
    const normalized = path.posix.normalize(decoded.replace(/^\.\//, ""));
    if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
      throw new Error(`本地资源路径越界：${raw}`);
    }
    if (/\.html?$/i.test(normalized)) throw new Error(`单文件攻略不得引用另一份本地 HTML：${raw}`);
    references.add(normalized);
  }
  return references;
}

function copyReferencedAssets(source, sourcePath, outputPath) {
  const sourceDir = path.dirname(sourcePath);
  const outputDir = path.dirname(outputPath);
  const references = collectLocalAssetReferences(source);
  for (const relative of references) {
    const input = path.resolve(sourceDir, relative);
    const expectedPrefix = `${fs.realpathSync(sourceDir)}${path.sep}`;
    if (!fs.existsSync(input) || !fs.statSync(input).isFile()) {
      throw new Error(`HTML 引用的本地资源不存在：${relative}`);
    }
    if (!fs.realpathSync(input).startsWith(expectedPrefix)) throw new Error(`HTML 引用的本地资源通过符号链接越界：${relative}`);
    const destination = path.resolve(outputDir, relative);
    const outputPrefix = `${path.resolve(outputDir)}${path.sep}`;
    if (!destination.startsWith(outputPrefix)) throw new Error(`部署资源路径越界：${relative}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(input, destination);
  }
  return references;
}

function main() {
  if (!sourceArg || !outputArg) {
    console.error("Usage: node build-public-guide.js <public-source.html> <deployment-artifact.html>");
    process.exit(2);
  }
  const sourcePath = path.resolve(sourceArg);
  const outputPath = path.resolve(outputArg);
  if (sourcePath === outputPath) throw new Error("部署产物不得覆盖带占位符的公开源 HTML。");
  const output = buildPublicGuide(fs.readFileSync(sourcePath, "utf8"));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const copied = copyReferencedAssets(output, sourcePath, outputPath);
  fs.writeFileSync(outputPath, output, "utf8");
  if (process.argv.includes("--attest-build")) {
    const hash = value => crypto.createHash("sha256").update(value).digest("hex");
    const assets = [...copied].sort().map(relative => [relative, hash(fs.readFileSync(path.resolve(path.dirname(sourcePath), relative)))]);
    fs.writeFileSync(outputPath + ".build.json", JSON.stringify({ sourceSha256: hash(fs.readFileSync(sourcePath)), artifactSha256: hash(output), assetSha256: hash(JSON.stringify(assets)) }, null, 2) + "\n");
  }
  console.log(`已生成部署产物 ${outputPath}，同步 ${copied.size} 个实际引用资源（未输出密钥值）`);
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message); process.exit(1); }
}

module.exports = { buildPublicGuide, collectLocalAssetReferences, copyReferencedAssets, classifySupabaseKey, PUBLIC_PLACEHOLDERS };
