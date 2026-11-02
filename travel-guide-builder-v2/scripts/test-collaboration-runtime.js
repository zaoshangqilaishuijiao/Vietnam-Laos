#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { requireJsdom } = require("./test-env.js");
const JSDOM = requireJsdom();
if (!JSDOM) {
  console.log("SKIP: jsdom 未安装，DOM 测试跳过（安装提示见上方 stderr）。");
  process.exit(0);
}

const source = fs.readFileSync(path.resolve(__dirname, "../assets/supabase-execution-sync.js"), "utf8");
const dom = new JSDOM(`<!doctype html><html><body data-guide-id="runtime-test">
  <button class="booking-status is-to_book" data-execution-status data-execution-id="booking:b1" data-execution-type="activity" data-booking-status="to_book">待预订</button>
  <div data-checklist="runtime"><div data-checklist-items></div></div>
</body></html>`, {
  url: "http://localhost/guide.html",
  runScripts: "outside-only",
  pretendToBeVisual: true
});

const { window } = dom;
// 固定浏览器时钟，让同一毫秒内连续编辑稳定出现，避免依赖机器速度。
const NativeDate = window.Date;
let clock = NativeDate.parse("2026-08-27T00:00:00.000Z");
window.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
};
window.CSS = window.CSS || {};
window.CSS.escape = window.CSS.escape || ((value) => String(value).replace(/["\\]/g, "\\$&"));

const handlers = [];
let subscribed = false;
let liveCallback;
let failLeave = false;
let releaseSave;
let holdNextSave = true;
let failNextSave = false;
const saveCalls = [];

const channel = {
  on(_event, filter, callback) {
    handlers.push({ table: filter.table, callback });
    return this;
  },
  subscribe(callback) {
    subscribed = true; liveCallback = callback;
    callback("SUBSCRIBED");
    return this;
  }
};

const rowFromSave = (name, args) => {
  if (name === "save_guide_execution_state") {
    return {
      entity_id: args.p_entity_id,
      booking_status: args.p_booking_status,
      note: args.p_note || "",
      client_updated_at: new Date().toISOString()
    };
  }
  if (name === "save_guide_checklist_state") {
    return { item_id: args.p_item_id, checked: args.p_checked, client_updated_at: new Date().toISOString() };
  }
  return {
    item_id: args.p_item_id,
    text: args.p_text,
    checked: args.p_checked,
    deleted: args.p_deleted,
    client_updated_at: new Date().toISOString()
  };
};

const client = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: "u1" } } } }),
    signInAnonymously: async () => ({ data: { session: { user: { id: "u1" } } }, error: null }),
    signOut: async () => ({ error: null })
  },
  from() {
    return {
      select() { return this; },
      eq: async () => ({ data: [], error: null })
    };
  },
  channel() { return channel; },
  removeChannel: async () => ({ status: "ok" }),
  rpc(name, args) {
    if (name === "leave_guide_collab" && failLeave) return Promise.resolve({ error: { message: "synthetic offline" } });
    if (name === "restore_guide_collab") return Promise.resolve({ data: false, error: null });
    if (name === "bootstrap_guide_collab" || name === "join_guide_collab" || name === "leave_guide_collab") {
      return Promise.resolve({ data: null, error: null });
    }
    if (name.startsWith("save_guide_")) {
      saveCalls.push({ name, args });
      const row = rowFromSave(name, args);
      if (holdNextSave) {
        holdNextSave = false;
        return new Promise((resolve) => { releaseSave = () => resolve({ data: row, error: null }); });
      }
      if (failNextSave) {
        failNextSave = false;
        return Promise.resolve({ data: null, error: { message: "测试网络错误" } });
      }
      return Promise.resolve({ data: row, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }
};

window.supabase = { createClient: () => client };
window.eval(source);

const waitFor = async (predicate, message) => {
  for (let i = 0; i < 80; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
};

(async () => {
  const api = await window.TravelGuideCollaboration.init({
    projectUrl: "https://example.supabase.co",
    publishableKey: "publishable-test-key",
    guideId: "runtime-test"
  });

  const code = window.document.querySelector("[data-collab-code]");
  code.value = "12345678";
  window.document.querySelector("[data-collab-join]").click();
  await waitFor(() => window.document.body.dataset.guideCollab === "editing", "未进入编辑模式");

  assert.equal(subscribed, true, "进入编辑后必须订阅 Realtime");
  assert.deepEqual(handlers.map((item) => item.table).sort(), [
    "guide_checklist_state",
    "guide_custom_checklist",
    "guide_execution_state"
  ]);

  const booking = window.document.querySelector("[data-execution-id='booking:b1']");
  booking.click();
  const saving = api.flush();
  await waitFor(() => typeof releaseSave === "function", "首个保存请求未启动");

  booking.click();
  assert.equal(booking.dataset.bookingStatus, "confirmed", "第二次本地修改应立即生效");
  assert.strictEqual(api.flush(), saving, "并发 flush 应复用进行中的请求");
  releaseSave();
  assert.equal(await saving, true, "保存队列应成功完成");
  assert.equal(saveCalls.length, 2, "请求期间的新修改必须进入下一轮保存");
  assert.equal(saveCalls[0].args.p_client_updated_at, saveCalls[1].args.p_client_updated_at, "两次请求必须覆盖相同毫秒的编辑");
  assert.equal(saveCalls[1].args.p_booking_status, "confirmed", "服务器必须收到最新修改");
  assert.equal(booking.dataset.bookingStatus, "confirmed", "旧响应不得覆盖新修改");

  handlers.find((item) => item.table === "guide_execution_state").callback({
    new: { entity_id: "booking:b1", booking_status: "to_book", note: "remote" }
  });
  assert.equal(booking.dataset.bookingStatus, "to_book", "Realtime 执行状态应回写页面");

  const customHandler = handlers.find((item) => item.table === "guide_custom_checklist").callback;
  customHandler({ new: { item_id: "custom-1", text: "远端事项", checked: false, deleted: false } });
  let custom = window.document.querySelector("input[data-check='custom-1']");
  assert.ok(custom, "Realtime 应新增自定义事项");
  // 契约：恢复的自定义清单项必须位于天气卡之前。真实渲染中天气卡是 items 容器的兄弟节点，
  // 因此按 shell 层级比较顺序，而不是假设天气卡在 [data-checklist-items] 内部。
  const shell = window.document.querySelector('[data-checklist="runtime"]');
  const weatherCard = window.document.createElement("section");
  weatherCard.className = "guide-weather-card";
  weatherCard.dataset.weatherCard = "";
  const localNote = window.document.createElement("p");
  localNote.className = "local-note";
  shell.append(weatherCard, localNote);
  const itemsHost = window.document.querySelector("[data-checklist-items]");
  const orderInShell = () => Array.from(shell.children).map((node) => node.className || node.tagName);
  customHandler({ new: { item_id: "custom-2", text: "天气卡前事项", checked: false, deleted: false } });
  const ordered = orderInShell();
  assert.ok(
    ordered.findIndex((name) => name.includes("data-checklist-items") || name === "div") < ordered.indexOf("guide-weather-card"),
    "自定义清单项所在容器必须位于天气卡之前"
  );
  customHandler({ new: { item_id: "custom-2", text: "", checked: true, deleted: true } });
  assert.equal(window.document.querySelector("input[data-check='custom-2']"), null, "Realtime 应删除天气卡前事项");
  customHandler({ new: { item_id: "custom-1", text: "远端事项已更新", checked: true, deleted: false } });
  custom = window.document.querySelector("input[data-check='custom-1']");
  assert.equal(custom.checked, true, "Realtime 应更新自定义事项状态");
  assert.equal(custom.closest("label").querySelector("[data-check-label]").textContent, "远端事项已更新");
  customHandler({ new: { item_id: "custom-1", text: "", checked: true, deleted: true } });
  assert.equal(window.document.querySelector("input[data-check='custom-1']"), null, "Realtime 应删除自定义事项");

  const check = window.document.createElement("input");
  check.type = "checkbox";
  check.dataset.check = "system-1";
  window.document.querySelector("[data-checklist-items]").append(check);
  const changeCheck = (value) => {
    check.checked = value;
    check.dispatchEvent(new window.Event("change", { bubbles: true }));
  };
  const customEvent = (name, detail) => window.document.dispatchEvent(new window.CustomEvent(name, { detail }));
  const races = [
    {
      name: "核验勾选", rpc: "save_guide_checklist_state",
      first: () => changeCheck(true), latest: () => changeCheck(false),
      verify: (args) => { assert.equal(args.p_checked, false); assert.equal(check.checked, false); }
    },
    {
      name: "自定义事项新增后删除", rpc: "save_guide_custom_checklist",
      first: () => customEvent("guide:checklist-custom-add", { item: { id: "custom-race", text: "测试事项" } }),
      latest: () => customEvent("guide:checklist-custom-remove", { id: "custom-race" }),
      verify: (args) => { assert.equal(args.p_deleted, true); assert.equal(window.document.querySelector("input[data-check='custom-race']"), null); }
    }
  ];
  for (const shift of [0, -60000]) {
    for (const scenario of races) {
      const start = saveCalls.length;
      holdNextSave = true;
      releaseSave = null;
      scenario.first();
      const pending = api.flush();
      await waitFor(() => releaseSave, `${scenario.name}请求未启动`);
      clock += shift;
      scenario.latest();
      releaseSave();
      assert.equal(await pending, true);
      assert.equal(saveCalls.length, start + 2, `${scenario.name}在时钟变化 ${shift}ms 时不得丢失最新修改`);
      assert.equal(saveCalls[start + 1].name, scenario.rpc);
      scenario.verify(saveCalls[start + 1].args);
    }
  }

  failNextSave = true;
  changeCheck(true);
  assert.equal(await api.flush(), false, "失败时不得宣称已同步");
  assert.equal(window.document.querySelector("[data-collab-retry]").hidden, false);
  const failedCallCount = saveCalls.length;
  assert.equal(await api.flush(), true, "失败队列必须保留并允许重试");
  assert.equal(saveCalls.length, failedCallCount + 1);
  assert.equal(saveCalls.at(-1).args.p_checked, true);
  assert.equal(window.document.querySelector("[data-collab-label]").textContent, "编辑中");
  assert.equal(window.document.querySelector("[data-collab-open]").getAttribute("aria-label"), "编辑中 · 已同步");

  liveCallback("CHANNEL_ERROR");
  assert.equal(window.document.querySelector("[data-collab-live]").hidden, false);
  customHandler({new:{item_id:"custom-edit",text:"原文",checked:false,deleted:false}});
  const editableLabel=window.document.querySelector('input[data-check="custom-edit"]').closest('label').querySelector('[data-check-label]');
  editableLabel.textContent="修改后的事项";editableLabel.dispatchEvent(new window.FocusEvent("blur"));
  await api.flush();assert.equal(saveCalls.at(-1).args.p_text,"修改后的事项");
  failLeave=true;window.document.querySelector('[data-collab-exit]').click();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(window.document.body.dataset.guideCollab,"editing");
  assert.match(window.document.querySelector('[data-collab-notice]').textContent,/退出失败/);
  dom.window.close();
  console.log("通过：协作 Realtime、同毫秒/时钟回拨保存竞态、并发 flush 与失败重试回归");
})().catch((error) => {
  dom.window.close();
  console.error(error);
  process.exit(1);
});
