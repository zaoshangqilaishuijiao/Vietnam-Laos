#!/usr/bin/env node
// Public deployment placeholders and key classification shared by rendering and CI build.
const PUBLIC_PLACEHOLDERS = Object.freeze({
  baiduAk: "__BAIDU_MAP_BROWSER_AK__",
  googleKey: "__GOOGLE_MAPS_BROWSER_KEY__",
  supabaseProjectUrl: "https://__SUPABASE_PROJECT_REF__.supabase.co",
  supabasePublishableKey: "__SUPABASE_PUBLISHABLE_KEY__",
  buildSha: "__GUIDE_BUILD_SHA__"
});

function classifySupabaseKey(value) {
  const key = String(value || "").trim();
  if (/^sb_secret_/i.test(key)) return "secret";
  if (/^sb_publishable_/i.test(key)) return "publishable";
  const parts = key.split(".");
  if (parts.length !== 3) return "invalid";
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (payload.role === "service_role") return "secret";
    if (payload.role === "anon") return "publishable";
  } catch (_invalidJwt) { /* Invalid JWT payloads are classified as invalid below. */ }
  return "invalid";
}

// Shared by pre-commit inspection and CI. Exact placeholders are the only exceptions.
function publicSourceViolations(source) {
  const clean = Object.values(PUBLIC_PLACEHOLDERS).reduce((s, value) => s.split(value).join(""), String(source));
  const hits = [];
  if (/AIza[0-9A-Za-z_-]{20,}/.test(clean)) hits.push("真实 Google API Key");
  if (/[?&]ak=[0-9A-Za-z_-]{16,}/i.test(clean) || /["'](?:ak|baiduAk)["']\s*:\s*["'][0-9A-Za-z_-]{16,}["']/i.test(clean)) hits.push("真实百度 AK");
  if (/sb_(?:secret|publishable)_[0-9A-Za-z_-]+/.test(clean)) hits.push("Supabase key");
  if (/https:\/\/[a-z0-9-]+\.supabase\.co\b/i.test(clean)) hits.push("Supabase Project URL");
  for (const match of clean.matchAll(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    if (classifySupabaseKey(match[0]) !== "invalid") hits.push("Supabase JWT");
  }
  return [...new Set(hits)];
}

const DEPLOYMENT_FILES = Object.freeze(["scripts/build-public-guide.js", "scripts/public-config.js"]);
module.exports = { PUBLIC_PLACEHOLDERS, classifySupabaseKey, publicSourceViolations, DEPLOYMENT_FILES };
