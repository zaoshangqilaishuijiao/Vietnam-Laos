#!/usr/bin/env node
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {renderFlightRecords,flightOcrCandidates,safeFlightDetailUrl}=require('../assets/modules/15-flight-records.js');
const {resolveGuideIdentity}=require('./render-guide.js');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'assets/travel-guide-interactions.js'),'utf8');
const sync=fs.readFileSync(path.join(root,'assets/supabase-execution-sync.js'),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,0));
const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await tick();}throw Error('condition not reached');};
const sample={id:'audit-flight-001',legLabel:'返程',flightNumber:'KL1234',airline:'示意航空',departureAirport:'出发示意机场',arrivalAirport:'到达示意机场'};
async function fixture(initial=[]){
  const dom=new JSDOM('<body data-guide-id="audit">'+renderFlightRecords([])+'</body>',{url:'http://localhost/audit',runScripts:'outside-only'});
  const w=dom.window;w.CSS={escape:x=>x};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  let rows=initial,heldSave=null,heldRead=null,holdSave=false,holdRead=false,fail=false,reads=0;
  const calls=[],hooks=[],removed=[];
  const rpcResult=args=>{rows=args.p_records.map((value,index)=>({record_id:value.id,flight_data:value,record_index:index}));hooks.filter(h=>h.table==='guide_flight_records').forEach(h=>h.fn());return {data:{count:rows.length},error:null};};
  const sb={auth:{getSession:async()=>({data:{session:{user:{id:'u1'}}}}),signOut:async()=>({error:null})},
    from(table){const query={select(){return this;},eq(){return this;},order(){return this;},then(resolve,reject){
      if(table!=='guide_flight_records')return Promise.resolve({data:[],error:null}).then(resolve,reject);
      reads++;const snapshot=rows;
      return (holdRead?(holdRead=false,new Promise(r=>{heldRead=()=>r({data:snapshot,error:null});})):Promise.resolve({data:rows,error:null})).then(resolve,reject);
    }};return query;},
    channel(){const channel={on(_type,filter,fn){hooks.push({table:filter.table,fn});return this;},subscribe(fn){fn?.('SUBSCRIBED');return this;}};return channel;},
    removeChannel:async channel=>{removed.push(channel);},
    rpc:async(name,args)=>{calls.push({name,args});if(name!=='replace_guide_flight_records')return {data:{},error:null};
      if(holdSave){holdSave=false;return new Promise(r=>{heldSave=()=>r(rpcResult(args));});}
      if(fail)return {error:{message:'offline'}};
      return rpcResult(args);
    }};
  w.supabase={createClient:()=>sb};w.eval(source);w.TravelGuideInteractions.initFlightRecords({root:w.document});w.eval(sync);
  const config={projectUrl:'https://db.invalid',publishableKey:'dummy',guideId:'audit'};
  const api=await w.TravelGuideCollaboration.init(config);
  const flights=w.TravelGuideFlightCollaboration.init(config,Promise.resolve(api));
  w.document.querySelector('[data-collab-code]').value='12345678';w.document.querySelector('[data-collab-join]').click();
  await wait(()=>w.document.body.dataset.guideCollab==='editing');await tick();await tick();await tick();
  return {dom,w,api,flights,calls,removed,hooks,get reads(){return reads;},get rows(){return rows;},set rows(v){rows=v;},holdSave(){holdSave=true;},holdRead(){holdRead=true;},releaseSave(){heldSave();},releaseRead(){heldRead();},set fail(v){fail=v;},send(records){w.document.dispatchEvent(new w.CustomEvent('guide:flight-records-save',{detail:{records}}));}};
}
(async()=>{
  const f=await fixture([{record_id:sample.id,flight_data:sample}]);
  assert.equal(f.w.document.querySelectorAll('[data-flight-card]').length,1,'remote image-only proof must render metadata');
  assert.equal(f.w.document.querySelector('[data-flight-card] header b').textContent,'返程');
  assert.equal(f.w.document.querySelector('[data-flight-view]'),null,'never fabricate a local image');
  f.holdSave();f.send([{...sample,id:'audit-flight-002'}]);await wait(()=>f.api.hasPendingFlights());
  const leave=new f.w.Event('beforeunload',{cancelable:true});f.w.dispatchEvent(leave);assert.equal(leave.defaultPrevented,true);
  assert.match(f.w.document.querySelector('[data-collab-open]').textContent,/保存中/);
  let flushed=false;const flushing=f.api.flush().then(()=>{flushed=true;});await tick();assert.equal(flushed,false);
  f.send([{...sample,id:'audit-flight-003',imageKey:'private',rawOcr:'private',detailUrl:'https://tickets.invalid/#pnr=FAKE'}]);await tick();f.releaseSave();await flushing;await tick();await tick();
  assert.equal(f.rows[0].record_id,'audit-flight-003','latest full group replaces prior in-flight edit');
  const payload=f.calls.filter(c=>c.name==='replace_guide_flight_records').at(-1).args.p_records[0];
  assert.equal(payload.legLabel,'返程');assert.ok(!JSON.stringify(payload).includes('private'));assert.equal(payload.detailUrl,'');
  f.fail=true;f.send([{...sample,id:'audit-flight-004'}]);await tick();await tick();assert.equal(await f.api.flush(),false);
  assert.equal(f.api.hasPendingFlights(),true);assert.match(f.w.document.querySelector('[data-collab-open]').getAttribute('aria-label'),/保存失败/);
  const leaveCalls=f.calls.filter(c=>c.name==='leave_guide_collab').length;f.w.document.querySelector('[data-collab-exit]').click();await tick();assert.equal(f.calls.filter(c=>c.name==='leave_guide_collab').length,leaveCalls);
  f.fail=false;f.w.document.querySelector('[data-collab-retry]').click();await wait(()=>!f.api.hasPendingFlights());await tick();
  assert.equal(f.rows[0].record_id,'audit-flight-004');
  const before=f.reads;f.holdRead();f.flights.refresh();await wait(()=>f.reads>before);
  f.rows=[{record_id:sample.id,flight_data:{...sample,legLabel:'去程'}}];f.hooks.find(h=>h.table==='guide_flight_records').fn();f.releaseRead();
  await wait(()=>f.reads>=before+2);await tick();assert.equal(f.w.document.querySelector('[data-flight-card] header b').textContent,'去程','event during load triggers fresh read');
  f.holdRead();const reads=f.reads;f.flights.refresh();await wait(()=>f.reads>reads);f.w.document.querySelector('[data-collab-exit]').click();await wait(()=>f.w.document.body.dataset.guideCollab==='readonly');f.releaseRead();await tick();assert.ok(f.removed.length>=2,'both channels removed on exit');f.dom.window.close();
  const row=(text,y)=>({text,score:.99,poly:[[0,y],[250,y],[250,y+20],[0,y+20]]});
  const parsed=flightOcrCandidates([row('KLM KL1234',0),row('AMS 出发示意机场',30),row('CDG 到达示意机场',60)]);
  assert.equal(parsed[0].departureCode,'AMS');assert.equal(parsed[0].arrivalCode,'CDG');
  for(const url of ['https://tickets.invalid/#pnr=FAKE','https://tickets.invalid/passport/FAKE','https://tickets.invalid/?next=%2523pnr%253DFAKE','https://user:secret@tickets.invalid','https://tickets.invalid/?bookingReference=FAKE'])assert.equal(safeFlightDetailUrl(url),'');
  assert.ok(safeFlightDetailUrl('https://tickets.invalid/?route=%2Fflights'));
  const old={meta:{title:'旧标题',dates:['2026-12-31']}};const id=resolveGuideIdentity(old);
  const changed={meta:{title:'新标题',dates:['2027-01-01']}};
  assert.equal(resolveGuideIdentity(changed,{baseline:old}),id);assert.equal(resolveGuideIdentity(changed,{previousHtml:`<body data-guide-id="${id}">`}),id);
  assert.equal(resolveGuideIdentity({meta:{...changed.meta,guideId:id}}),id);
  assert.throws(()=>resolveGuideIdentity({meta:{...changed.meta,guideId:'different-id'}},{baseline:old}),/身份/);
  console.log('PASS flight sync: remote rendering, labels, shared queue, retries, unload/exit, refresh races, privacy, OCR and stable guide identity');
})().catch(error=>{console.error(error);process.exitCode=1;});
