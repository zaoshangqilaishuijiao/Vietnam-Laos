#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { PUBLIC_PLACEHOLDERS, classifySupabaseKey } = require("./public-config.js");

const [sourceArg, outputArg] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

function replaceRequired(source, placeholder, value, label) {
  if (!source.includes(placeholder)) return source;
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`公开部署缺少 ${label}；未写出不完整产物。`);
  return source.split(placeholder).join(normalized);
}

function buildPublicGuide(source, env = process.env) {
  const sourceWithoutPlaceholders = Object.values(PUBLIC_PLACEHOLDERS)
    .reduce((value, placeholder) => value.split(placeholder).join(""), source);
  if (/AIza[0-9A-Za-z_-]{20,}|sb_(?:publishable|secret)_[0-9A-Za-z_-]+|[?&]ak=[0-9A-Za-z_-]{20,}/i.test(sourceWithoutPlaceholders)) {
    throw new Error("公开源 HTML 已包含真实密钥形式；必须重新使用 --public-source 生成占位符版。");
  }
  let output = source;
  output = replaceRequired(output, PUBLIC_PLACEHOLDERS.googleKey, env.GOOGLE_MAPS_BROWSER_KEY, "GOOGLE_MAPS_BROWSER_KEY");
  output = replaceRequired(output, PUBLIC_PLACEHOLDERS.baiduAk, env.BAIDU_MAP_BROWSER_AK, "BAIDU_MAP_BROWSER_AK");
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
  fs.writeFileSync(outputPath, output, "utf8");
  console.log(`已生成部署产物 ${outputPath}（未输出密钥值）`);
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message); process.exit(1); }
}

module.exports = { buildPublicGuide, classifySupabaseKey, PUBLIC_PLACEHOLDERS };
