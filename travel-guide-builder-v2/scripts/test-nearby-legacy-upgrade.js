#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {validateTripData, runPipelineValidation} = require('./validate-trip-data.js');
const {extractSections, applyPatch, validateResult} = require('./extract-trip-sections.js');
const root = path.resolve(__dirname,'..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'travel-nearby-legacy-'));
const input = path.join(temp,'trip.json');
const run = (script,args=[],env={}) => spawnSync(process.execPath,[path.join(__dirname,script),...args],{encoding:'utf8',env:{...process.env,...env}});
const fixture=run('test-data-pipeline.js',[`--write-content-fixture=${input}`]);
assert.equal(fixture.status,0,fixture.stderr);
const old=JSON.parse(fs.readFileSync(input,'utf8'));
old.meta.guideId='legacy-nearby-guide';
old.features.exchange=true;
old.budget.targetCurrencies=['USD'];
old.recommendations[0].placeId='city-park'; // Legacy no image, other two are generic recommendations.
old.recommendations[0].menuItems=[{name:'清汤面',reason:'短停时选择一份简餐',sourceIds:[2]}];
assert.equal(validateTripData(old,{stage:'content'}).valid,true);
const upgraded=structuredClone(old);
upgraded.features.nearbyExplore=true;
upgraded.nearbyDays=[{dayNumber:1,status:'hide-late-arrival',dayType:'ordinary',readyAt:'22:30',reason:'晚间抵达并办理入住后不再安排外出，保留休息。',freeWindows:[],candidates:[]}];
const options={stage:'content',baseline:old,allowPaths:['features','nearbyDays','recommendations','places','sources','sourceIndex','budget']};
const valid=(data=upgraded,opts=options)=>{const r=validateTripData(data,opts);assert.equal(r.valid,true,r.failures.join('\n'));return r;};
const invalid=(mutate,pattern,opts=options)=>{const d=structuredClone(upgraded);mutate(d);const r=validateTripData(d,opts);assert.equal(r.valid,false);assert.ok(r.failures.some(f=>pattern.test(f)),r.failures.join('\n'));};
const result=valid();
assert.ok(result.warnings.some(s=>/旧攻略增量兼容.*budget.exchangeChannels.*recommendations\[0\].image/.test(s)));
assert.equal(runPipelineValidation(upgraded,options).result.valid,true);
assert.equal(valid(upgraded,{...options,baseline:structuredClone(upgraded)}).valid,true,'A second incremental edit retains compatibility');
invalid(()=>{},/image|placeId|具名换汇/,{stage:'content'});
invalid(d=>{d.meta.guideId='another-guide';},/image|placeId|具名换汇/);
invalid(d=>{d.features.contextualExplore=true;},/image|placeId|具名换汇/);
invalid(()=>{},/image|placeId|具名换汇/,{...options,baseline:{...old,features:{...old.features,contextualExplore:true}}});
const copyEdit=structuredClone(upgraded);
copyEdit.recommendations[0].reason='公园绿地与步道';
copyEdit.recommendations[0].travelerFit='上午步行线内可停留';
copyEdit.budget.notes=['单人预算'];
copyEdit.budget.items[0].note='住宿估算';
valid(copyEdit);
invalid(d=>{d.recommendations[0].name='另一家公园';},/recommendations\[0\].image/);
invalid(d=>{d.recommendations[0].sourceIds=[1];},/recommendations\[0\].image/);
invalid(d=>{d.recommendations[0].menuItems[0].reason='新的菜品评价';},/recommendations\[0\].image/);
invalid(d=>{d.recommendations.push({...d.recommendations[0],id:'new-no-image'});},/recommendations\[3\].image/);
invalid(d=>{d.places[1].coordinates.latitude+=.001;},/recommendations\[0\].image/);
invalid(d=>{d.sources[8].verificationStatus='本次改写原来源的结论';},/recommendations\[0\].image/);
invalid(d=>{d.sources[1].verificationStatus='改写嵌套菜单引用的来源';},/recommendations\[0\].image/);
invalid(d=>{d.sources[6].verificationStatus='改写预算引用的来源';},/具名换汇/);
invalid(d=>{d.budget.items[0].min+=1;},/具名换汇/);
invalid(d=>{d.researchAudit.xiaohongshuReadCount=9;},/xiaohongshuReadCount/);
invalid(d=>{d.sources.pop();d.sourceIndex.pop();d.researchAudit.xiaohongshuReadCount=9;},/至少 10 篇/);
assert.equal(validateTripData(upgraded,{...options,allowPaths:[]}).valid,false,'Baseline alone never bypasses the change whitelist');

// Removing an unused citation only changes numeric labels, including nested refs.
const shiftRefs=value=>Array.isArray(value)?value.map(shiftRefs):value&&typeof value==='object'
 ?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='sourceId'?v+1:k==='sourceIds'?v.map(id=>id+1):shiftRefs(v)])):value;
const numberedBaseline=shiftRefs(structuredClone(upgraded));
numberedBaseline.sources=numberedBaseline.sources.map(s=>({...s,id:s.id+1}));
numberedBaseline.sources.unshift({id:1,type:'other',scope:'general',title:'未采用的历史资料',url:'https://unused.example.invalid/',cities:['测试城市'],topics:['历史研究'],verificationStatus:'原已读资料，不用于正文'});
const renumberOptions={...options,baseline:numberedBaseline,allowPaths:Object.keys(upgraded)};
valid(upgraded,renumberOptions);
invalid(d=>{d.sources[8].verificationStatus='证据结论已改动';},/recommendations\[0\].image/,renumberOptions);
invalid(d=>{d.sources[8].url='https://different.example.invalid/';},/recommendations\[0\].image/,renumberOptions);
invalid(d=>{d.sources[1].verificationStatus='嵌套菜单证据已改动';},/recommendations\[0\].image/,renumberOptions);
invalid(d=>{d.sources[6].verificationStatus='预算证据已改动';},/具名换汇/,renumberOptions);

// Even an unchanged legacy target needs a real image and XHS evidence when promoted.
const candidates=structuredClone(upgraded);
candidates.sources[7].author='测试作者';
for(let n=0;n<3;n++){
 const place={...structuredClone(old.places[1]),id:`near-${n}`,usage:'suggestion',coordinates:{latitude:31.241+n*.001,longitude:121.492}};
 candidates.places.push(place);
 candidates.recommendations.push({...structuredClone(old.recommendations[0]),id:`rec-near-${n}`,travelerFit:`公园第 ${n+1} 个出口附近的短暂停靠备选`,placeId:place.id,image:{src:'images/avatar.jpg',alt:'候选实景测试',sourceId:8},sourceIds:[8]});
}
candidates.nearbyDays=[{dayNumber:1,status:'show',dayType:'ordinary',reason:'下午有完整自由时间，三处供选择。',freeWindows:[{startTime:'13:00',endTime:'16:00',city:'测试城市',anchorPlaceId:'city-park',bufferMinutes:30,basis:'原上午行程结束后，已另留返程余量。'}],candidates:[0,1,2].map(n=>({targetType:'recommendation',targetId:`rec-near-${n}`,whyNow:'下午公园周边短停，三个候选择一。',windowIndex:0,timing:'下午确认开门后短停'}))}];
const completeBaseline=structuredClone(candidates);
const candidateValidation=validateTripData(candidates,{...options,baseline:completeBaseline});
assert.equal(candidateValidation.valid,true,candidateValidation.failures.join('\n'));
delete candidates.recommendations.at(-1).image;
const incompleteBaseline=structuredClone(candidates);
assert.ok(validateTripData(candidates,{...options,baseline:incompleteBaseline}).failures.some(f=>/图片|image/.test(f)),'An identical baseline cannot grandfather a missing candidate image');

// nearbyDays is explicitly patchable; unrelated top-level additions are still rejected.
assert.deepEqual(extractSections(upgraded,{modules:['nearbyDays']}).nearbyDays,upgraded.nearbyDays);
const patch=applyPatch(old,{features:upgraded.features,nearbyDays:upgraded.nearbyDays},{modules:['features','nearbyDays']});
validateResult(patch.next,old);
assert.throws(()=>applyPatch(old,{nearbyDays:[]},{modules:['budget']}),/超出/);
assert.throws(()=>validateResult({...old,unexpected:true},old),/顶层键集合变化/);
assert.throws(()=>{const d=structuredClone(upgraded);delete d.nearbyDays;validateResult(d,upgraded);},/顶层键集合变化/);
const patchFile=path.join(temp,'patch.json');
fs.writeFileSync(input,JSON.stringify(old));
fs.writeFileSync(patchFile,JSON.stringify({features:upgraded.features,nearbyDays:upgraded.nearbyDays}));
const cli=run('extract-trip-sections.js',[input,'--module=features,nearbyDays',`--patch-file=${patchFile}`,'--apply']);
assert.equal(cli.status,0,cli.stderr);
assert.deepEqual(JSON.parse(fs.readFileSync(input,'utf8')),upgraded);

// The renderer's privacy revalidation must sanitize both current data and baseline.
const localHome=path.join(temp,'codex-home');
const privateDir=path.join(localHome,'private/travel-guide-builder-v2');
fs.mkdirSync(privateDir,{recursive:true});
fs.writeFileSync(path.join(privateDir,'github-self-hosts.local.json'),JSON.stringify({selfHosts:['self.example.invalid']}));
const baseline=structuredClone(old),renderInput=structuredClone(upgraded);
for(const d of [baseline,renderInput]){
 d.sources.push({id:11,type:'other',scope:'general',title:'旧攻略的自身链接',url:'https://self.example.invalid/guide/',topics:['旧版'],cities:['测试城市'],verificationStatus:'原本地资料索引'});
 d.sourceIndex.push({sourceId:11,title:'旧攻略的自身链接',cities:['测试城市'],tags:['旧版','本地','参考'],searchHints:['旧版索引']});
 d.budget.notes.push('对比预算前先确认结算口径。');
}
const baselinePath=path.join(temp,'old.baseline.json');
fs.writeFileSync(baselinePath,JSON.stringify(baseline));
fs.writeFileSync(input,JSON.stringify(renderInput));
const mapConfig=path.join(temp,'map.json');
fs.writeFileSync(mapConfig,JSON.stringify({googleMapsApiKey:'TEST_ONLY_NOT_A_REAL_API_KEY'}));
const html=path.join(temp,'guide.html');
const rendered=run('render-guide.js',[input,html,`--baseline=${baselinePath}`,'--allow-paths=features,nearbyDays',`--map-config=${mapConfig}`,'--no-collaboration'],{CODEX_HOME:localHome});
assert.equal(rendered.status,0,rendered.stdout+'\n'+rendered.stderr);
assert.ok(!fs.readFileSync(html,'utf8').includes('https://self.example.invalid/guide/'));
assert.equal(JSON.parse(fs.readFileSync(html.replace(/\.html$/,'.validation.json'),'utf8')).htmlValidation.valid,true);
console.log('PASS baseline-bound nearby upgrades: copy-only compatibility, strict venue/financial/new/candidate evidence, scoped patching, privacy revalidation');
