#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname,"..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(),"guide-review-regression-"));
const run = (args, options={}) => spawnSync(process.execPath,args,{encoding:"utf8",cwd:root,...options});
const write = (name,value) => { const file=path.join(temp,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));return file; };
const { DEPLOYMENT_FILES, publicSourceViolations, PUBLIC_PLACEHOLDERS } = require("./public-config.js");
const { verifyGitIdentity } = require("./git-identity-gate.js");
const { applyPatch } = require("./extract-trip-sections.js");
const { sha256, assetDigest, REQUIRED_CHECKS, validateEvidence, browserValidationAcceptable } = require("./qa-evidence.js");

assert.deepEqual(publicSourceViolations('<script src="https://api.map.baidu.com/api?ak=__BAIDU_MAP_BROWSER_AK__"></script>'),[]);
assert.ok(publicSourceViolations('sb_publishable_synthetic').length);
assert.ok(publicSourceViolations('https://synthetic.supabase.co').length);
assert.ok(publicSourceViolations('https://api.map.baidu.com/api?ak=abcdefghijklmnopqr').length);
assert.deepEqual(publicSourceViolations(fs.readFileSync(path.join(root,'scripts/public-config.js'),'utf8')),[]);

// All deployment dependencies really execute in a clean directory.
for(const file of DEPLOYMENT_FILES){fs.mkdirSync(path.dirname(path.join(temp,file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(temp,file));}
const source=write('source.html',`<meta name="guide-build" content="${PUBLIC_PLACEHOLDERS.buildSha}"><script src="https://api.map.baidu.com/api?ak=${PUBLIC_PLACEHOLDERS.baiduAk}"></script>`);
const artifact=path.join(temp,'out/guide.html');
const built=run([path.join(temp,'scripts/build-public-guide.js'),source,artifact,'--attest-build'],{cwd:temp,env:{...process.env,GUIDE_BUILD_SHA:'a'.repeat(40),BAIDU_MAP_BROWSER_AK:'synthetic_browser_value'}});
assert.equal(built.status,0,built.stderr);assert.ok(fs.existsSync(artifact+'.build.json'));
assert.ok(fs.readFileSync(artifact,'utf8').includes('synthetic_browser_value'));

const data={days:[{dayNumber:1,items:[]}],transport:[]};
const patch=applyPatch(data,{days:[{dayNumber:1,items:[]}],transport:[{duration:12}]},{days:['1'],modules:['transport']});
assert.equal(patch.next.transport[0].duration,12);
assert.throws(()=>applyPatch(data,{days:[{dayNumber:2,items:[]}]},{days:['1'],modules:['transport']}),/超出/);

function gitMock({author='person@users.noreply.github.com',committer=author,history=author,domains='internal.invalid'}={}) {
  return (...args)=>({status:0,stdout:args[0]==='config'?domains+'\n':args[0]==='var'?`Name <${args[1]==='GIT_AUTHOR_IDENT'?author:committer}> 1 +0000\n`:`${history}\n${committer}\n`,stderr:''});
}
assert.equal(verifyGitIdentity(gitMock(),['abc']),true);
assert.throws(()=>verifyGitIdentity(gitMock({author:'x@internal.invalid'})),/禁用域/);
assert.throws(()=>verifyGitIdentity(gitMock({committer:'x@sub.internal.invalid'})),/禁用域/);
assert.throws(()=>verifyGitIdentity(gitMock({history:'x@internal.invalid'}),['abc']),/禁用域/);
assert.throws(()=>verifyGitIdentity(gitMock({domains:''})),/禁用邮箱域/);

// Isolated synthetic private configuration must never be read by public rendering.
const fixture=path.join(temp,'trip-data.json');
assert.equal(run(['scripts/test-data-pipeline.js','--write-content-fixture='+fixture]).status,0);
const privateHome=path.join(temp,'codex-home');
write('codex-home/private/travel-guide-builder-v2/supabase.local.json',{projectUrl:'https://synthetic.supabase.co',publishableKey:'sb_publishable_synthetic'});
const html=path.join(temp,'guide.html');
const rendered=run(['scripts/render-guide.js',fixture,html,'--public-source'],{env:{...process.env,CODEX_HOME:privateHome}});
assert.equal(rendered.status,0,rendered.stderr);
assert.ok(!fs.readFileSync(html,'utf8').includes('sb_publishable_synthetic'));
assert.ok(!fs.readFileSync(html,'utf8').includes('data-guide-collaboration-runtime'));

// Full source -> injected artifact -> evidence binding, including resource invalidation.
write('images/cover.jpg','synthetic-image');write('images/station-locker.png','synthetic-image');
const preview=path.join(temp,'preview/guide.html');
const result=run(['scripts/build-public-guide.js',html,preview,'--attest-build'],{env:{...process.env,GUIDE_BUILD_SHA:'a'.repeat(40),GOOGLE_MAPS_BROWSER_KEY:'synthetic_browser_value'}});
assert.equal(result.status,0,result.stderr);
const evidence={method:'manual-attestation',reviewer:'synthetic test fixture',checkedAt:new Date().toISOString(),sourceSha256:sha256(html),artifactSha256:sha256(preview),assetSha256:assetDigest(html),checks:REQUIRED_CHECKS.map(name=>({name,status:'passed',evidence:'Synthetic assertion for evidence binding only, not real browser QA'}))};
const buildProof=JSON.parse(fs.readFileSync(preview+'.build.json','utf8'));
const degradedEvidence=structuredClone(evidence);
degradedEvidence.checks.find(check=>check.name==='map').status='degraded';
const degradedValidation=validateEvidence(degradedEvidence,html,preview,buildProof);
assert.equal(degradedValidation.status,'passed_with_limitations','地图降级不得被记录为完整通过');
assert.equal(browserValidationAcceptable(degradedValidation),true,'已验收的地图降级应允许继续发布');
const invalidEvidence=structuredClone(degradedEvidence);
invalidEvidence.checks.find(check=>check.name==='desktop').status='degraded';
assert.throws(()=>validateEvidence(invalidEvidence,html,preview,buildProof),/desktop/,'其他检查项不得用地图降级状态放行');
const evidenceFile=write('qa.json',evidence), report=path.join(temp,'guide.validation.json');
const record=()=>run(['scripts/record-browser-qa.js',html,'--validation='+report,'--artifact='+preview,'--evidence='+evidenceFile]);
assert.equal(record().status,0,record().stderr);
write('images/cover.jpg','changed-image');assert.notEqual(record().status,0);
write('images/cover.jpg','synthetic-image');
fs.appendFileSync(preview,'<script>invalid(</script>');assert.notEqual(record().status,0);

const oldOutputHash=sha256(html);
const preload=write('reject-html.cjs',`const Module=require('module');const original=Module._load;Module._load=function(id,...args){const value=original.call(this,id,...args);if(id==='./validate-guide-contract.js')return {...value,validateGuideContract:()=>({valid:false,failures:['synthetic rejection'],expectedDates:[],itineraryDates:[]})};return value};`);
assert.notEqual(run(['--require',preload,'scripts/render-guide.js',fixture,html,'--public-source'],{env:{...process.env,CODEX_HOME:privateHome}}).status,0);
assert.equal(sha256(html),oldOutputHash,'HTML 契约失败不得覆盖旧成品');

// Empty culture is valid with an applicability note, and incomplete research cannot masquerade as complete.
const guide=JSON.parse(fs.readFileSync(fixture));guide.localKnowledge=[];guide.meta.cultureNote='个人城市短途，无特殊礼仪事项';
const {validateTripData}=require('./validate-trip-data.js');
assert.equal(validateTripData(guide,{stage:'content'}).valid,true);
guide.sources.forEach(source=>{source.type='official';source.verificationStatus='已核验';source.url='https://official.invalid/source/'+source.id;});
guide.researchAudit.xiaohongshuReadCount=0;guide.researchAudit.xiaohongshuShortfallReason='已用官方来源覆盖';
guide.researchAudit.decisionCoverage=['路线节奏','交通','住宿','预算','预约','安全'].map(topic=>({topic,status:'verified',sourceIds:[1]}));
assert.equal(validateTripData(guide,{stage:'content'}).valid,false,'官方来源和完整覆盖不能豁免 10 篇小红书');
guide.researchAudit.decisionCoverage.pop();assert.equal(validateTripData(guide,{stage:'content'}).valid,false);

// Corrupt optional storage must neither overwrite records nor block later modules.
const dom=new JSDOM('<body data-guide-id="review-test"><section data-expense-tracker><input data-expense-name><input data-expense-amount><ul data-expense-list></ul><b data-expense-total></b><span data-expense-compare></span></section></body>',{runScripts:'outside-only',url:'https://local.test'});
dom.window.localStorage.setItem('travel-guide-expenses:review-test','{}');
dom.window.eval(fs.readFileSync(path.join(root,'assets/travel-guide-interactions.js'),'utf8'));
const active=dom.window.TravelGuideInteractions.initGuidePage({expenses:true});
assert.ok(active.expenses);assert.ok(active.bookings);assert.deepEqual(Array.from(active.errors),[]);
assert.equal(dom.window.localStorage.getItem('travel-guide-expenses:review-test'),'{}');
assert.match(dom.window.document.querySelector('[role=status]').textContent,/未能恢复/);
dom.window.close();
console.log('PASS review regressions: clean deploy, source isolation, identity, evidence, joint patch, coverage, storage');
