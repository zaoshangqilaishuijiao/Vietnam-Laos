#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requireJsdom } = require('./test-env.js');
const JSDOM = requireJsdom();
if (!JSDOM) process.exit(1);

async function main() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div data-guide-floating-tools><div data-guide-floating-actions><button data-floating-action="today" hidden>今天</button><button data-floating-action="exchange">汇率</button><button data-floating-action="search">搜索</button></div><button data-guide-floating-toggle>牛哞</button></div>
    <dialog data-exchange-dialog><button data-exchange-dialog-close>关闭</button><section data-exchange-tool data-exchange-base="CNY" data-exchange-targets="VND,LAK"><button data-exchange-currency="VND" aria-pressed="true">越南盾 <small>VND</small></button><button data-exchange-currency="LAK" aria-pressed="false">老挝基普 <small>LAK</small></button><span data-exchange-rate-base></span><span data-exchange-rate-usd hidden></span><button data-exchange-refresh>刷新汇率</button><span data-exchange-local-label></span><input data-exchange-local-input value="100000"><input data-exchange-input><p data-exchange-mnemonic></p><small data-exchange-mnemonic-example hidden></small><p data-exchange-status hidden></p><p data-exchange-last-updated hidden></p></section></dialog>
  </body></html>`, { url: 'http://localhost/guide.html', runScripts: 'outside-only', pretendToBeVisual: true });
  try {
    dom.window.eval(fs.readFileSync(path.join(__dirname, '../assets/travel-guide-interactions.js'), 'utf8'));
    const doc = dom.window.document;
    const api = dom.window.TravelGuideInteractions;
    let calls = 0;
    const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ result: 'success', rates: { CNY: 1, VND: 3861, LAK: 2900, USD: 0.14 } }) }; };
    const controller = api.initExchange({ root: doc, fetchImpl });
    assert.equal(calls, 0, 'opening must not request rates automatically');
    doc.querySelector('[data-floating-action="exchange"]').click();
    assert.equal(doc.querySelector('[data-exchange-dialog]').hasAttribute('open'), true);
    assert.equal(doc.activeElement, doc.querySelector('[data-exchange-local-input]'));
    await controller.refresh();
    assert.equal(calls, 1);
    assert.equal(doc.querySelector('[data-exchange-input]').value, (100000 / 3861).toFixed(2));
    assert.match(doc.querySelector('[data-exchange-rate-usd]').textContent, /USD.*VND/);
    assert.match(doc.querySelector('[data-exchange-mnemonic]').textContent, /人民币/);
    doc.querySelector('[data-exchange-input]').value = '100';
    doc.querySelector('[data-exchange-input]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(doc.querySelector('[data-exchange-local-input]').value, '386100');
    doc.querySelector('[data-exchange-currency="LAK"]').click();
    assert.equal(doc.querySelector('[data-exchange-local-input]').value, '290000');
    assert.equal(doc.querySelector('[data-exchange-currency="LAK"]').getAttribute('aria-pressed'), 'true');
    assert.equal(api.initExchange({ root: doc }), controller, 'repeat initialization must be idempotent');
    const menu = api.initFloatingActions({ root: doc });
    const edit = doc.createElement('button'); edit.dataset.floatingAction = 'edit'; edit.textContent = '编辑';
    doc.querySelector('[data-guide-floating-actions]').insertBefore(edit, doc.querySelector('[data-floating-action="search"]'));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    assert.equal(edit.nextElementSibling.dataset.floatingAction, 'exchange', 'menu order matches current Niumou demo');
    doc.querySelector('[data-exchange-dialog-close]').click();
    assert.equal(doc.querySelector('[data-exchange-dialog]').hasAttribute('open'), false);
    assert.equal(doc.activeElement, doc.querySelector('[data-guide-floating-toggle]'));
    menu.destroy(); controller.destroy();
    console.log('PASS Niumou exchange dialog, bidirectional conversion, USD, mnemonic, menu order');
  } finally { dom.window.close(); }
}
async function testPairConverter() {
  const dom = new JSDOM(`<!doctype html><body><section data-exchange-tool data-exchange-base="CNY" data-exchange-targets="LAK,VND"><input data-exchange-local-input value="100"><input data-exchange-input readonly><select data-exchange-from><option>LAK</option><option>VND</option><option>USD</option><option>CNY</option></select><select data-exchange-to><option>LAK</option><option>VND</option><option>USD</option><option selected>CNY</option></select><button data-exchange-swap>交换</button><span data-exchange-rate-base></span><span data-exchange-rate-usd></span><div class="guide-quickcalc__mnemonic" hidden><p data-exchange-mnemonic></p></div><p data-exchange-last-updated hidden></p><p data-exchange-status hidden></p><button data-exchange-refresh>刷新</button></section>`, { url: 'https://example.test/', runScripts: 'outside-only' });
  try {
    dom.window.eval(fs.readFileSync(path.join(__dirname, '../assets/travel-guide-interactions.js'), 'utf8'));
    const doc=dom.window.document, get=key=>doc.querySelector(`[data-exchange-${key}]`);
    const amount=get('local-input'), result=get('input'), from=get('from'), to=get('to');
    let calls=0, fail=false;
    const fetchImpl=async()=>{calls++; if(fail) throw Error('offline'); return {ok:true,json:async()=>({rates:{CNY:1,LAK:3000,VND:3600,USD:.14},date:'2026-11-03'})};};
    const api=dom.window.TravelGuideInteractions;
    let controller=api.initExchange({root:doc,fetchImpl});
    assert.equal(amount.value,'100'); assert.equal(result.value,''); assert.equal(calls,0);
    await controller.refresh();
    assert.equal(result.value,'0.03'); assert.match(get('mnemonic').textContent,/去掉 3 个 0，再除以 3/);
    get('swap').click(); assert.equal(amount.value,'100'); assert.equal(from.value,'CNY'); assert.equal(to.value,'LAK'); assert.equal(result.value,'300,000');
    amount.value='250'; amount.dispatchEvent(new dom.window.Event('input')); get('swap').click(); assert.equal(amount.value,'250');
    to.value='LAK';to.dispatchEvent(new dom.window.Event('change')); assert.equal(from.value,'CNY'); assert.equal(to.value,'LAK');
    from.value='VND';from.dispatchEvent(new dom.window.Event('change')); assert.equal(amount.value,'250'); assert.equal(calls,1);
    const previous=result.value, date=get('last-updated').textContent;
    fail=true; await controller.refresh(); assert.equal(result.value,previous);assert.equal(get('last-updated').textContent,date);
    controller.destroy();
    controller=api.initExchange({root:doc,fetchImpl});assert.equal(result.value,previous);assert.equal(calls,2,'cache must restore without another request');
    get('swap').click();assert.equal(from.value,'LAK','destroy/reinit must not duplicate swap handlers');
    controller.destroy(); console.log('PASS currency pair default, stable amount, duplicate selection, cache, offline, lifecycle');
  } finally {dom.window.close();}
}
main().then(testPairConverter).catch((error) => { console.error(error); process.exitCode = 1; });
