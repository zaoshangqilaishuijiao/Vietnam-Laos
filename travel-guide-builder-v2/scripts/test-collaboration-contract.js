#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "scripts", "render-guide.js"), "utf8");
const asset = fs.readFileSync(path.join(root, "assets", "supabase-execution-sync.js"), "utf8");
const interactions = fs.readFileSync(path.join(root, "assets", "travel-guide-interactions.js"), "utf8");
const interactionCss = fs.readFileSync(path.join(root, "assets", "travel-guide-interactions.css"), "utf8");
const baseMigration = fs.readFileSync(path.join(root, "supabase", "001_shared_execution_state.sql"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "002_align_custom_checklist.sql"), "utf8");
const persistentMigration = fs.readFileSync(path.join(root, "supabase", "003_persistent_device_collaboration.sql"), "utf8");
const lwwMigration = fs.readFileSync(path.join(root, "supabase", "004_lww_execution_save.sql"), "utf8");
const flightMigration = fs.readFileSync(path.join(root, "supabase", "005_flight_records_sync.sql"), "utf8");
const flightHardening = fs.readFileSync(path.join(root, "supabase", "006_flight_sync_hardening.sql"), "utf8");
const checklistLimitMigration = fs.readFileSync(path.join(root, "supabase", "007_custom_checklist_text_limit.sql"), "utf8");
const authorizationMigration = fs.readFileSync(path.join(root, "supabase", "009_execution_authorization.sql"), "utf8");
assert.ok(authorizationMigration.includes("^[0-9]{8}$") && authorizationMigration.includes("members read execution"));
const cleanupMigration = fs.readFileSync(path.join(root, "supabase", "008_remove_legacy_collab_overloads.sql"), "utf8");
assert.ok(flightHardening.includes('revoke insert, update, delete on public.guide_flight_records from public, anon, authenticated'), 'flight writes must use validated RPC');
assert.ok(flightHardening.includes('for update;'), 'serialize replacements using parent guide row');
assert.ok(flightHardening.indexOf('for update;') < flightHardening.indexOf('delete from public.guide_flight_records'), 'lock before replacing group');
assert.ok(flightHardening.includes('guide_flight_safe_url') && flightHardening.includes('unsupported flight field'), 'enforce URL and field restrictions on server');
[
  "readSupabaseConfig",
  "parseRenderOptions",
  "defaultSupabaseConfig",
  "data-execution-status",
  "TravelGuideCollaboration.init",
  "renderBookingLedger(data, supabaseConfig.enabled)",
  'data-local-booking="true"'
].forEach((marker) => assert.ok(renderer.includes(marker), "renderer missing " + marker));
[
  "signInAnonymously",
  "bootstrap_guide_collab",
  "join_guide_collab",
  "restore_guide_collab",
  "leave_guide_collab",
  "save_guide_execution_state",
  "guide_execution_state",
  "deviceToken",
  "SAVE_DEBOUNCE_MS=1500",
  "SUPABASE_SDK_URL",
  "@supabase/supabase-js@2.49.4",
  "keepalive:true",
  "visibilitychange",
  "beforeunload",
  "pagehide",
  "data-collab-retry",
  "保存失败 · 重试",
  "网络异常，最新修改未保存",
  ".channel(",
  "postgres_changes",
  "dirty.get(key)",
  'row.booking_status==="pending"?"to_book"',
  "removeChannel",
  "event.returnValue",
  "TravelGuideFlightCollaboration",
  "replace_guide_flight_records",
  "guide:flight-records-save",
  "guide:flight-records-remote"
].forEach((marker) => assert.ok(asset.includes(marker), "collaboration asset missing " + marker));
assert.ok(!asset.includes("localDraft"), "persistent collaboration must not create a local draft");
const credentialLiteralPattern = /(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/;
assert.ok(!credentialLiteralPattern.test(renderer), "renderer must not embed actual credential literals");
assert.ok(!credentialLiteralPattern.test(asset), "browser asset must not embed actual credential literals");
assert.ok(interactions.includes('active && custom'), "system checklist labels must remain read-only");
assert.ok(interactions.includes('checklistRefreshBound'), "shared checklist must refresh progress");
assert.ok(interactions.includes('guide-search-open'), "search must own open surface state");
assert.ok(interactions.includes('searchReady'), "search initialization must be idempotent");
assert.ok(interactionCss.includes('--guide-floating-toggle-size'), "combined floating action token missing");
assert.ok(interactionCss.includes('.guide-search-open .guide-floating-tools'), "combined tools must yield to open search panel");
assert.ok(asset.includes('data-floating-action="edit"') && asset.includes('data-guide-floating-actions'), "editing must join the combined floating menu");
assert.ok(interactions.includes('button.dataset.bookingStatus = status'), "local booking state must expose current status");
assert.ok(interactions.includes('const current = button.dataset.bookingStatus || status'), "local booking cycle must read externally applied state");
assert.ok(interactions.includes("FLIGHT_OCR_TIMEOUT_MS"), "flight OCR must recover from a stalled prediction");
assert.ok(interactions.includes("const localOnly = items.filter"), "remote flight updates must retain unsynced local records");
assert.ok(interactionCss.includes('.booking-status.is-pending,.booking-status.is-to_book'), "shared to_book status must retain booking styling");
assert.ok(renderer.includes('data-execution-id="booking:'), "booking ledger must join shared execution state");
["guide_collab_device_sessions", "restore_guide_collab", "leave_guide_collab", "extensions.crypt"].forEach((marker) => assert.ok(persistentMigration.includes(marker), "persistent collaboration migration missing " + marker));
["save_guide_execution_state", "save_guide_checklist_state", "save_guide_custom_checklist", "clock_timestamp()", "security definer", "grant execute on function public.save_guide_execution_state"].forEach((marker) => assert.ok(lwwMigration.includes(marker), "lww migration 004 missing " + marker));
assert.ok(lwwMigration.includes("left(coalesce(p_text,''),240)"), "fresh installs must match the 240-character checklist constraint");
assert.ok(checklistLimitMigration.includes("left(coalesce(p_text,''),240)"), "existing installs need the checklist length alignment migration");
assert.ok(cleanupMigration.includes("drop function if exists public.bootstrap_guide_collab(text,text)") && cleanupMigration.includes("drop function if exists public.join_guide_collab(text,text)"), "migration 008 must remove legacy two-argument collaboration RPCs");
assert.ok(cleanupMigration.includes("guide_custom_checklist_guide_id_item_id_key") && cleanupMigration.includes("drop constraint guide_custom_checklist_guide_item_key"), "migration 008 must collapse the known duplicate checklist unique constraint safely");
assert.ok(!lwwMigration.includes("client_updated_at <= excluded.client_updated_at"), "server-order LWW must not compare client clocks");
[
  "guide_flight_records",
  "replace_guide_flight_records",
  "flight_data jsonb",
  "enable row level security",
  "supabase_realtime",
  "p_device_token"
].forEach((marker) => assert.ok(flightMigration.includes(marker), "flight collaboration migration missing " + marker));
assert.ok(!flightMigration.includes("imageKey"), "flight collaboration migration must not store browser image keys");
["guide_collab_trips", "guide_execution_state", "bootstrap_guide_collab", "enable row level security"].forEach((marker) => assert.ok(baseMigration.includes(marker), "base migration 001 missing " + marker));
["item_id text", "deleted boolean", "unique (guide_id, item_id)"].forEach((marker) => assert.ok(migration.includes(marker), "migration missing " + marker));
// 迁移清单只在 Supabase 协作文档维护；结构完整性测试负责顺序、模板锁和反孤儿检查。
const collaborationDoc = fs.readFileSync(path.join(root, "references", "supabase-collaboration.md"), "utf8");
fs.readdirSync(path.join(root, "supabase"))
  .filter((name) => name.endsWith(".sql"))
  .forEach((name) => assert.ok(collaborationDoc.includes(name), "supabase-collaboration.md must mention migration " + name));
console.log("通过：协作资产契约");




