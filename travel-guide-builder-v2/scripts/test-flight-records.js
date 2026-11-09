#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { renderFlightRecords, renderFlightTicket, sanitizeFlightRecord, safeFlightDetailUrl, flightOcrCandidates } = require('../assets/modules/15-flight-records.js');
const source = fs.readFileSync(path.join(__dirname, '../assets/travel-guide-interactions.js'), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const waitFor = async predicate => { for(let i=0;i<100;i++){ if(predicate())return; await tick(); } throw Error('condition not reached'); };
const sample = { id:'known',legLabel:'去程',flightNumber:'CA1234',airline:'测试航空',departureDate:'2026-12-31',arrivalDate:'2027-01-01',departureCode:'AAA',departureAirport:'出发测试机场',departureTerminal:'T1',arrivalCode:'BBB',arrivalAirport:'到达测试机场',arrivalTerminal:'T2',departureTime:'23:20',arrivalTime:'07:40',durationMinutes:500,seat:'12A',gate:'B8',baggageClaim:'3',detailUrl:'https://example.com/ticket' };
function fixture(seed = [], options = {}) {
  const dom = new JSDOM(`<!doctype html><body data-guide-id="proof-test">${renderFlightRecords(seed)}</body>`, {url:'http://localhost/flight',runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window, doc = w.document, q = s => doc.querySelector(s);
  const blobs = new Map(), deleted = [], writes = [], recognitions = [], masks = [];
  w.confirm = () => true;
  w.URL.createObjectURL = () => 'blob:local-test'; w.URL.revokeObjectURL = () => {};
  w.Image = class { naturalWidth=800; naturalHeight=600; set src(value){if(value)queueMicrotask(()=>this.onload?.());} };
  w.HTMLCanvasElement.prototype.getContext = () => ({drawImage(){},fillRect(...args){masks.push(args);},fillStyle:''});
  w.HTMLCanvasElement.prototype.toBlob = function(callback){callback(new w.Blob(['redacted-pixels'],{type:'image/png'}));};
  if(options.stored)w.localStorage.setItem('travel-guide-flight-records:proof-test',JSON.stringify(options.stored));
  w.eval(source);
  const api = w.TravelGuideInteractions.initFlightRecords({root:doc,
    recognize: async blob => {recognitions.push(blob);return options.recognize ? options.recognize(blob) : [{...sample},{...sample,flightNumber:'CA5678',legLabel:'返程'}];},
    imageStore:{put:async(key,blob)=>{if(options.failImage)throw Error('quota');writes.push(blob);blobs.set(key,blob);},get:async key=>blobs.get(key),delete:async key=>{deleted.push(key);blobs.delete(key);}}
  });
  const saved = () => JSON.parse(w.localStorage.getItem('travel-guide-flight-records:proof-test') || '[]');
  const submit = () => q('[data-flight-form]').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
  const upload = async () => {
    const file = new w.File(['raw-private-image'],'private-name.png',{type:'image/png'});
    Object.defineProperty(q('[data-flight-file]'),'files',{configurable:true,value:[file]});
    q('[data-flight-file]').dispatchEvent(new w.Event('change'));
    await waitFor(()=>!q('[data-flight-redaction]').hidden);
    return file;
  };
  return {dom,w,doc,q,api,blobs,deleted,writes,recognitions,masks,saved,submit,upload};
}

(async()=>{
  assert.doesNotMatch(source, /<\/script/i, 'inline interaction source cannot close its containing script');
  const card = new JSDOM(renderFlightTicket({...sample,imageKey:'img',imageRedacted:true})).window.document;
  assert.equal(card.querySelectorAll('[data-flight-view]').length,1);
  assert.equal(card.querySelectorAll('[data-flight-link-view]').length,0);
  assert.match(card.querySelector('header').textContent,/去程.*2026-12-31.*2027-01-01/);
  assert.match(card.querySelector('.flight-airline').textContent,/测试航空.*CA1234.*8小时20分/);
  assert.match(card.querySelector('.flight-extras').textContent,/座位 12A.*登机口 B8.*转盘 3/);
  assert.equal(card.querySelector('.flight-extra:last-child .flight-extra-label').title,'行李提取转盘');
  assert.equal(card.querySelector('.flight-identity .flight-number').textContent,'CA1234');
  assert.equal(card.querySelector('.flight-duration').textContent,'8小时20分');
  assert.equal(card.querySelectorAll('.flight-extras strong').length,3);
  for (const extra of [{seat:'12A',gate:'',baggageClaim:''},{seat:'',gate:'B8',baggageClaim:'3'}]) {
    const doc=new JSDOM(renderFlightTicket({...sample,...extra})).window.document;
    assert.equal(doc.querySelectorAll('.flight-extra').length,Object.values(extra).filter(Boolean).length);
  }
  assert.match(card.querySelector('.flight-route').textContent,/23:20.*AAA 出发测试机场 T1.*07:40.*BBB 到达测试机场 T2/);
  assert.equal(renderFlightTicket({flightNumber:'CA1234'}),'');
  assert.equal(renderFlightTicket({imageKey:'legacy',imageRedacted:false}),'');
  assert.equal(new JSDOM(renderFlightTicket({detailUrl:sample.detailUrl})).window.document.querySelector('.flight-extras'),null);
  for(const url of ['http://example.com','javascript:alert(1)','https://name:secret@example.com','https://example.com/?pnr=secret'])assert.equal(safeFlightDetailUrl(url),'');
  assert.equal(safeFlightDetailUrl(sample.detailUrl),sample.detailUrl);
  const clean = sanitizeFlightRecord({...sample,passengerName:'张三',pnr:'secret',rawOcr:'full text',airline:'PNR secret',meal:'dinner'});
  assert.equal(clean.airline,'');
  assert.ok(!JSON.stringify(clean).includes('secret'));
  assert.ok(!('meal' in clean));
  const connection = {airportCode:'BBB',airport:'中转示意机场',durationMinutes:150};
  const transferCard=new JSDOM(renderFlightTicket({...sample,imageKey:'img',imageRedacted:true,connection})).window.document;
  assert.match(transferCard.querySelector('[data-flight-connection]').textContent,/中转提醒.*BBB 中转示意机场.*停留2小时30分/);
  assert.equal(transferCard.querySelector('[data-flight-card]').lastElementChild,transferCard.querySelector('[data-flight-connection]'),'reminder is at the very bottom, after image action');
  assert.equal(card.querySelector('[data-flight-connection]'),null,'direct flight stays unchanged');
  assert.match(renderFlightTicket({...sample,connection:{}}),/中转机场待核验.*停留时长待核验/);
  assert.match(renderFlightTicket({...sample,connection:{durationMinutes:45}}),/停留45分/);
  assert.doesNotMatch(renderFlightTicket({...sample,connection:{durationMinutes:-1}}),/停留-1/);
  assert.doesNotMatch(JSON.stringify(sanitizeFlightRecord({...sample,connection:{airport:'PNR secret',pnr:'secret',rawOcr:'secret'}})),/secret/);
  const transferRuntime=fixture([{...sample,connection}]);
  assert.match(transferRuntime.q('[data-flight-connection]').textContent,/停留2小时30分/);
  transferRuntime.api.openEditor(true);
  assert.equal(transferRuntime.q('[data-flight-list]').querySelectorAll('[data-flight-connection]').length,1,'rerender does not duplicate reminder');
  transferRuntime.dom.window.close();
  const {validateTripData}=require('./validate-trip-data.js');
  const trip=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/data/trip-data.template.json'),'utf8'));
  trip.features.arrivalDeparture=true;
  trip.meta.dateExclusions=[
    {date:'2026-12-31',scope:'departure',reason:'测试用例明确不生成逐日卡'},
    {date:'2027-01-01',scope:'arrival',reason:'测试用例明确不生成逐日卡'}
  ];
  const flightErrors=record=>{
    trip.arrivalDeparture={...(trip.arrivalDeparture||{}),flights:[record]};
    return validateTripData(trip).failures.filter(message=>message.includes('arrivalDeparture.flights'));
  };
  assert.deepEqual(flightErrors({detailUrl:'https://tickets.invalid/receipt'}),[],'link-only seed is valid');
  assert.deepEqual(flightErrors({...sample,detailUrl:'https://tickets.invalid/receipt'}),[],'optional execution fields are valid');
  assert.deepEqual(flightErrors({connection}),[],'explicit connection fields are valid');
  assert.deepEqual(flightErrors({connection:{}}),[],'confirmed connection may have unknown details');
  for(const invalid of [null,[],{durationMinutes:0},{durationMinutes:10081},{airportCode:'ABCD'},{airport:'PNR secret'},{rawOcr:'secret'}]) assert.ok(flightErrors({connection:invalid}).length>0,'invalid connection must fail');
  for(const invalid of [{durationMinutes:-1},{durationMinutes:3000},{seat:'invalid value longer than twelve'},{gate:'<script>'},{departureTime:'30:00'},{arrivalDate:'2026-02-30'},{pnr:'ABCDEF'},{orderNumber:'secret'}]){
    assert.ok(flightErrors(invalid).length>0,JSON.stringify(invalid)+' must fail validation');
  }

  const a = fixture();
  assert.equal(a.q('[data-flight-form]').querySelectorAll('input').length,2);
  assert.equal(a.q('[data-flight-new],[data-flight-select],[data-flight-delete]'),null);
  assert.equal(a.q('[data-flight-editor]').hidden,true);
  assert.equal(a.q('[data-flight-manage]').textContent,'录入凭证');
  a.api.openEditor(true);a.submit();assert.equal(a.saved().length,0);
  a.q('[data-flight-link]').value=sample.detailUrl;a.submit();
  await waitFor(()=>a.saved().length===1);
  assert.equal(a.q('[data-flight-manage]').textContent,'管理凭证');
  assert.equal(a.q('.flight-empty'),null);
  assert.equal(a.q('[data-flight-view]'),null);
  assert.equal(a.q('[data-flight-link-view]').getAttribute('rel'),'noopener noreferrer');
  assert.ok(a.q('[data-flight-editor] [data-flight-link-view]'));
  assert.equal(a.q('[data-flight-list] [data-flight-link-view]'),null);
  assert.equal(a.saved()[0].flightNumber,'');
  a.api.openEditor(true);a.q('[data-flight-link]').value='https://example.com/replaced';a.submit();
  await waitFor(()=>a.saved()[0].detailUrl.endsWith('replaced'));
  assert.equal(a.saved().length,1);
  a.dom.window.close();

  const b = fixture([sample,{...sample,id:'unrelated-old',flightNumber:'CA9999'}]);b.api.openEditor(true);
  b.q('[data-flight-link]').value=sample.detailUrl;
  const original = await b.upload();
  b.submit();assert.equal(b.writes.length,0);assert.equal(b.recognitions.length,0);
  b.q('[data-flight-redact-all]').click();assert.equal(b.masks.length,1);
  b.q('[data-flight-redact-confirm]').click();
  await waitFor(()=>b.q('[data-flight-image-label]').textContent.includes('已就绪'));
  assert.notEqual(b.recognitions[0],original);
  b.submit();await waitFor(()=>b.saved().length===2);
  assert.equal(b.writes.length,1);
  assert.notEqual(b.writes[0],original);
  assert.equal(b.writes[0],b.recognitions[0]);
  assert.equal(b.saved()[0].imageKey,b.saved()[1].imageKey);
  assert.equal(b.saved()[0].groupId,b.saved()[1].groupId);
  assert.equal(b.doc.querySelectorAll('[data-flight-list] [data-flight-card]').length,2);
  assert.equal(b.doc.querySelectorAll('[data-flight-list] [data-flight-link-view]').length,0);
  assert.equal(b.doc.querySelectorAll('[data-flight-editor] [data-flight-link-view]').length,1);
  assert.ok(b.saved().every(item=>item.flightNumber!=='CA9999'),'new image replaces all history, not one group');
  b.q('[data-flight-view]').click();await waitFor(()=>b.q('[data-flight-viewer]').hasAttribute('open'));
  b.q('[data-flight-view-close]').click();assert.equal(b.q('[data-flight-view-image]').hasAttribute('src'),false);
  const oldKey=b.saved()[0].imageKey;
  b.api.openEditor(true);b.q('[data-flight-link]').value='https://example.com/group-update';b.submit();
  await waitFor(()=>b.saved().every(item=>item.detailUrl.endsWith('group-update')));
  await waitFor(()=>b.deleted.includes(oldKey));
  await tick();
  assert.equal(b.saved().length,1);
  assert.equal(b.saved()[0].imageKey,'');
  assert.equal(b.saved()[0].flightNumber,'','link replacement must not retain stale flight data');
  b.api.openEditor(true);await b.upload();b.q('[data-flight-redact-confirm]').click();
  await waitFor(()=>b.q('[data-flight-image-label]').textContent.includes('已就绪'));
  b.submit();await waitFor(()=>b.saved().length===2);
  assert.equal(b.saved().length,2,'replace group without duplicate legs');
  assert.ok(b.saved().every(item=>item.detailUrl===''),'new image does not inherit previous link');
  b.api.openEditor(true);assert.equal(b.q('[data-flight-delete],[data-flight-new],[data-flight-select]'),null);
  b.submit();assert.equal(b.saved().length,2,'empty submission does not erase records');
  b.dom.window.close();

  const c=fixture([sample],{failImage:true});c.api.openEditor(true);await c.upload();c.q('[data-flight-redact-confirm]').click();
  await waitFor(()=>c.q('[data-flight-image-label]').textContent.includes('已就绪'));c.submit();
  await waitFor(()=>c.q('[data-flight-status]').dataset.state==='error');
  assert.equal(c.q('[data-flight-list] [data-flight-card]').textContent.includes(sample.flightNumber),true);
  assert.equal(c.saved().length,0,'no failed state is persisted');c.dom.window.close();

  const rollback=fixture([],{stored:[{...sample,imageKey:'retained-image',imageRedacted:true}]});
  rollback.api.openEditor(true);await rollback.upload();rollback.q('[data-flight-redact-confirm]').click();
  await waitFor(()=>rollback.q('[data-flight-image-label]').textContent.includes('已就绪'));
  rollback.w.Storage.prototype.setItem=()=>{throw Error('metadata quota');};
  rollback.submit();await waitFor(()=>rollback.deleted.length===1);
  assert.equal(rollback.saved()[0].id,sample.id,'metadata failure retains original record');
  assert.equal(rollback.saved()[0].imageKey,'retained-image');
  assert.ok(!rollback.deleted.includes('retained-image'),'metadata failure never deletes old image');
  assert.equal(rollback.q('[data-flight-list] [data-flight-card]').textContent.includes(sample.flightNumber),true);
  rollback.dom.window.close();

  let release;
  const d=fixture([],{recognize:()=>new Promise(resolve=>{release=resolve;})});d.api.openEditor(true);await d.upload();d.q('[data-flight-redact-confirm]').click();
  await waitFor(()=>release);d.q('[data-flight-cancel]').click();d.api.openEditor(true);
  d.q('[data-flight-link]').value=sample.detailUrl;release([sample]);await tick();d.submit();
  await waitFor(()=>d.saved().length===1);assert.equal(d.saved()[0].flightNumber,'','cancelled OCR cannot contaminate new record');assert.equal(d.writes.length,0);d.dom.window.close();

  const e=fixture([],{stored:[{...sample,detailUrl:'',imageKey:'old-raw'}]});
  assert.equal(e.q('[data-flight-card]'),null);e.api.openEditor(true);assert.match(e.q('[data-flight-status]').textContent,/旧图片/);
  assert.equal(e.saved()[0].imageKey,'old-raw','legacy storage is not silently deleted');e.dom.window.close();

  const row=(text,y)=>({text,score:.99,poly:[[0,y],[200,y],[200,y+20],[0,y+20]]});
  const parsed=flightOcrCandidates([row('去程',0),row('测试航空 CA1234',30),row('2026年12月31日',60),row('次日',90),row('飞行时长 8小时20分钟',120),row('座位 12A 登机口 B8 行李提取转盘 3',150),row('PNR ABCDEF',180)]);
  assert.equal(parsed[0].arrivalDate,'2027-01-01');assert.equal(parsed[0].durationMinutes,500);assert.equal(parsed[0].seat,'12A');assert.equal(parsed[0].gate,'B8');assert.equal(parsed[0].baggageClaim,'3');
  assert.ok(!JSON.stringify(parsed).includes('ABCDEF'));
  const firstLeg=[row('测试航空 CA1234',0),row('2026年12月31日',25),row('AAA 出发示意机场',50),row('BBB 衔接示意机场',75),row('18:00',100),row('20:00',125)];
  const secondLeg=[row('测试航空 CA5678',210),row('2027年01月01日',235),row('BBB 衔接示意机场',260),row('CCC 终点示意机场',285),row('00:30',310),row('03:00',335)];
  const transfer=flightOcrCandidates([...firstLeg,row('中转 BBB 衔接示意机场 停留4小时30分',180),...secondLeg]);
  assert.equal(transfer.length,2);
  assert.deepEqual(transfer[0].connection,{airportCode:'BBB',airport:'衔接示意机场',durationMinutes:270});
  assert.equal(transfer[0].arrivalCode,'BBB');assert.equal(transfer[1].departureCode,'BBB');assert.equal(transfer[1].arrivalCode,'CCC');
  assert.equal(transfer[0].arrivalTime,'20:00');assert.equal(transfer[1].departureTime,'00:30');
  assert.equal(transfer[1].connection,undefined,'reminder belongs only to preceding leg');
  assert.equal(transfer[0].durationMinutes,undefined,'layover must not become flight duration');
  for(const text of ['直飞，无需中转','无中转','中转注意事项','建议中转至少2小时','停留2小时']) {
    assert.ok(flightOcrCandidates([...firstLeg,row(text,180),...secondLeg]).every(item=>!item.connection),text);
  }
  assert.ok(flightOcrCandidates([...firstLeg,...secondLeg]).every(item=>!item.connection),'matching airports alone do not establish a connection');
  const missingTime=flightOcrCandidates([...firstLeg,row('中转 BBB 衔接示意机场',180),...secondLeg]);
  assert.equal(missingTime[0].connection.durationMinutes,null,'do not infer layover from clocks/dates');
  const twoTransfers=flightOcrCandidates([...firstLeg,row('中转 BBB 衔接示意机场 2小时',180),...secondLeg,row('中转 CCC 终点示意机场 45分钟',370),row('测试航空 CA9012',400),row('CCC 终点示意机场',430),row('DDD 最后示意机场',460)]);
  assert.deepEqual(twoTransfers.map(item=>item.connection?.durationMinutes),[120,45,undefined]);
  const transitUpload=fixture([],{recognize:async()=>transfer});
  transitUpload.api.openEditor(true);await transitUpload.upload();transitUpload.q('[data-flight-redact-confirm]').click();
  await waitFor(()=>transitUpload.q('[data-flight-image-label]').textContent.includes('已就绪'));
  assert.match(transitUpload.q('[data-flight-preview] [data-flight-connection]').textContent,/停留4小时30分/);
  transitUpload.submit();await waitFor(()=>transitUpload.saved().length===2);
  assert.equal(transitUpload.saved()[0].connection.durationMinutes,270);
  const reloaded=fixture([],{stored:transitUpload.saved()});
  assert.equal(reloaded.q('[data-flight-list]').querySelectorAll('[data-flight-connection]').length,1);
  reloaded.dom.window.close();transitUpload.dom.window.close();
  const css=fs.readFileSync(path.join(__dirname,'../assets/travel-guide-interactions.css'),'utf8')
    .split('/* ==================== 机票凭证 ==================== */')[1].split('.guide-collab-notice')[0];
  assert.match(css,/@container \(min-width:720px\).*repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(css,/repeat\(3|620px|960px|280px/);
  const outputDir=process.argv.find(arg=>arg.startsWith('--preview-dir='))?.slice('--preview-dir='.length);
  if(outputDir){
    const {PAGE_TEMPLATE_VERSION}=require('./shared-constants.js');
    const dir=path.resolve(outputDir);fs.mkdirSync(dir,{recursive:true});
    const shell=fs.readFileSync(path.join(__dirname,'../assets/guide-shell.css'),'utf8');
    const styles=fs.readFileSync(path.join(__dirname,'../assets/travel-guide-interactions.css'),'utf8');
    const records=Array.from({length:4},(_,i)=>({...sample,id:`preview-${i}`,legLabel:i>1?'返程':'去程',flightNumber:`CA${1234+i}`}));
    const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>机票凭证模板 ${PAGE_TEMPLATE_VERSION} · 本地预览</title><style>${shell}\n${styles}</style></head><body class="guide-page" data-guide-id="flight-preview-${PAGE_TEMPLATE_VERSION}"><main class="guide-section"><h1>机票凭证模板预览</h1><p>虚构航班，仅展示布局与本地交互，不代表真实机票。</p>${renderFlightRecords(records)}</main><script>${source}</script><script>TravelGuideInteractions.initGuidePage({flights:true});</script></body></html>`;
    fs.writeFileSync(path.join(dir,'index.html'),html);
    fs.writeFileSync(path.join(dir,'empty.html'),html.replace(renderFlightRecords(records),renderFlightRecords([])).replace('flight-preview-'+PAGE_TEMPLATE_VERSION,'flight-empty-'+PAGE_TEMPLATE_VERSION));
    const longRecords=records.map((item,i)=>({...item,airline:'示意航空公司 Very Long Airline Name',seat:i===0?'':item.seat,gate:i===1?'':item.gate,baggageClaim:i<2?'':item.baggageClaim}));
    fs.writeFileSync(path.join(dir,'long.html'),html.replace(renderFlightRecords(records),renderFlightRecords(longRecords)).replace('flight-preview-'+PAGE_TEMPLATE_VERSION,'flight-long-'+PAGE_TEMPLATE_VERSION));
    const transferRecords=records.map((item,i)=>({...item,
      departureCode:i%2?'BBB':i===0?'AAA':'CCC',departureAirport:i%2?'衔接示意机场':i===0?'出发示意机场':'终点示意机场',
      arrivalCode:i%2?(i===1?'CCC':'AAA'):'BBB',arrivalAirport:i%2?(i===1?'终点示意机场':'出发示意机场'):'衔接示意机场',
      departureDate:i%2?'2027-01-01':item.departureDate,departureTime:i%2?'10:10':item.departureTime,arrivalTime:i%2?'18:30':item.arrivalTime,
      ...(i===0?{connection:{...connection,airport:'衔接示意机场'}}:i===2?{connection:{airportCode:'BBB',airport:'衔接示意机场'}}:{})}));
    fs.writeFileSync(path.join(dir,'transfer.html'),html.replace(renderFlightRecords(records),renderFlightRecords(transferRecords)).replace('flight-preview-'+PAGE_TEMPLATE_VERSION,'flight-transfer-'+PAGE_TEMPLATE_VERSION));
    console.log('Preview: '+dir);
  }
  console.log('PASS flight proofs: management-only link, no record list/add/delete, full replacement, privacy confirmation, failures, cancellation and layout');
})().catch(error=>{console.error(error);process.exitCode=1;});
