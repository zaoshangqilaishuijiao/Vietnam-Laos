#!/usr/bin/env node
// Public deployment placeholders and key classification shared by rendering and CI build.
const PUBLIC_PLACEHOLDERS = Object.freeze({
  baiduAk: "__BAIDU_MAP_BROWSER_AK__",
  googleKey: "__GOOGLE_MAPS_BROWSER_KEY__",
  supabaseProjectUrl: "https://__SUPABASE_PROJECT_REF__.supabase.co",
  supabasePublishableKey: "__SUPABASE_PUBLISHABLE_KEY__"
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

module.exports = { PUBLIC_PLACEHOLDERS, classifySupabaseKey };
