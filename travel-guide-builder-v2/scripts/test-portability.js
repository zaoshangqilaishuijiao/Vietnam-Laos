#!/usr/bin/env node
const assert = require("assert");
const path = require("path");
const { resolvePrivateConfigPath } = require("./render-guide.js");

assert.strictEqual(
  resolvePrivateConfigPath("baidu-map.local.json", {}, path.join(path.sep, "Users", "traveler")),
  path.join(path.sep, "Users", "traveler", ".codex", "private", "travel-guide-builder-v2", "baidu-map.local.json")
);
assert.strictEqual(
  resolvePrivateConfigPath("supabase.local.json", { CODEX_HOME: path.join(path.sep, "portable-codex") }, path.join(path.sep, "ignored")),
  path.join(path.sep, "portable-codex", "private", "travel-guide-builder-v2", "supabase.local.json")
);

console.log("PASS private config portability");
