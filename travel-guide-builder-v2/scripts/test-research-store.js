const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {sourceKey,mergeStore,loadStore,createContext,queryStore} = require('./research-store.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'guide-research-store-'));
const file = path.join(dir,'research.local.json');
const photo = path.join(dir,'test.png');
fs.writeFileSync(photo,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/j9sAAAAASUVORK5CYII=','base64'));
const source = {type:'xiaohongshu',title:'测试咖啡与接驳笔记',author:'测试作者',url:'https://www.xiaohongshu.com/explore/note123?xsec_token=first',readAt:'2026-11-03'};
const sid = sourceKey(source);
const fact = {id:'cafe-menu',category:'menu',text:'测试分店菜单有豆花咖啡',sourceId:sid,entityIds:['cafe-a'],modules:['recommendations'],dynamic:false,state:'usable',locator:{kind:'body'}};
const price = {id:'cafe-price',category:'price',text:'观察价格 30 当地币',sourceId:sid,entityIds:['cafe-a'],modules:['budget','recommendations'],dynamic:true,observedAt:'2026-09-01',state:'usable',locator:{kind:'image',imageIndex:2}};
const patch = {sources:[source],entities:[{id:'cafe-a',name:'同名咖啡',city:'测试城',country:'测试国',aliases:['A店'],placeId:'place-cafe-a'},{id:'cafe-b',name:'同名咖啡',city:'另一个城',country:'测试国'}],facts:[fact,price,{id:'rejected',category:'entrance',text:'此图属于其他分店',sourceId:sid,entityIds:['cafe-b'],modules:['recommendations'],dynamic:false,state:'rejected',locator:{kind:'comment',commentId:'comment1'}}],assets:[{sourceId:sid,entityIds:['cafe-a'],kind:'menu',description:'测试分店的菜单',locator:{kind:'image',imageIndex:2},file:photo,inspected:true,state:'usable'},{sourceId:sid,entityIds:['cafe-a'],kind:'reference',locator:{kind:'image',imageIndex:3},file:photo},{sourceId:sid,entityIds:['cafe-a'],kind:'entrance',locator:{kind:'image',imageIndex:4},failure:'一次下载失败，等待后续有需要时补查'}]};
let store = mergeStore(file,patch);
assert.equal(fs.readdirSync(path.join(dir,'research-assets')).length,1,'Same image bytes must only be saved once');
assert.equal(store.assets[0].path,store.assets[1].path);
assert.ok(!JSON.stringify(store).includes(photo),'Original absolute image path must not persist');
assert.equal(store.assets[2].path,undefined,'No placeholder image for failed download');
mergeStore(file,{sources:[{...source,url:'https://www.xiaohongshu.com/search_result/note123?xsec_token=second'}],facts:[{...fact,modules:['itinerary'],state:undefined}]});
store=loadStore(file);
assert.equal(store.sources.length,1,'Share URL variants must not inflate source count');
assert.equal(store.facts.length,3,'Same observation deduped across consumers');
assert.equal(store.facts.find(f=>f.id===fact.id).state,'usable','A repeat read does not reset state');
assert.deepEqual(store.facts.find(f=>f.id===fact.id).modules,['recommendations','itinerary']);
const ctx=createContext(store,dir);
const r=queryStore(ctx,{city:'测试城',module:'recommendations',limit:1});
assert.equal(r.total,2); assert.equal(r.hasMore,true); assert.equal(r.facts.length,1);
assert.equal(r.sources.length,1); assert.equal(r.assets[0].readyForReview,true);
assert.equal(queryStore(ctx,{category:'price'}).facts[0].needsRecheck,true,'Dynamic observations never become current prices automatically');
assert.equal(queryStore(ctx,{state:'rejected'}).facts[0].id,'rejected');
assert.equal(queryStore(ctx,{entity:'cafe-b'}).total,0,'Do not infer branch identity by name');
assert.equal(queryStore(ctx,{q:'A店'}).total,2,'Aliases work for focused lookup');
mergeStore(file,{facts:[{...r.facts[0],state:'recheck'}]});
assert.equal(loadStore(file).facts.find(f=>f.id===r.facts[0].id).state,'recheck','Focused query results can be reused for status updates without persisting diagnostics');
assert.throws(()=>queryStore(ctx,{module:'typo'}));
const before=fs.readFileSync(file,'utf8');
for(const bad of [
  {facts:[{...fact,text:'Changed observation under the same id'}]},
  {facts:[{...fact,sourceId:'missing'}]},
  {entities:[{id:'cafe-a',name:'另一家店',city:'测试城',country:'测试国'}]},
  {sources:[{...source,url:'https://xhslink.com/short'}]},
  {facts:[{...price,observedAt:undefined}]},
  {facts:[{...fact,rawResponse:'unnecessary bulk data'}]}
]) { assert.throws(()=>mergeStore(file,bad)); assert.equal(fs.readFileSync(file,'utf8'),before,'Invalid input cannot change the store'); }
const newObservation={...price,id:'price-new',text:'新日期报价 35 当地币',observedAt:'2026-11-03'};
mergeStore(file,{facts:[newObservation]});
assert.equal(loadStore(file).facts.filter(f=>f.category==='price').length,2,'Conflicting dated observations remain separate');
fs.writeFileSync(path.join(dir,store.assets[0].path),'damaged');
assert.equal(queryStore(createContext(loadStore(file),dir),{entity:'cafe-a'}).assets[0].readyForReview,false,'Recheck actual files and hashes, not only saved metadata');
const cli=spawnSync(process.execPath,[path.join(__dirname,'research-store.js'),'--store='+file,'--module=itinerary','--limit=1'],{encoding:'utf8'});
assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).facts.length,1);
assert.equal(JSON.parse(cli.stdout).publicationSelected,false);
assert.throws(()=>mergeStore(path.join(dir,'trip-data.json'),patch));
const paged=mergeStore(file,{assets:Array.from({length:55},(_,index)=>({...store.assets[0],id:'paged-'+index,locator:{kind:'image',imageIndex:100+index}}))});
const pagedContext=createContext(paged,dir), seen=new Set();let assetOffset=0;
do {
  const page=queryStore(pagedContext,{entity:'cafe-a',limit:1,offset:100,assetLimit:20,assetOffset});
  assert.equal(page.facts.length,0,'asset scope does not depend on the current fact page');
  assert.ok(page.assets.length<=20);
  page.assets.forEach(asset=>{assert.ok(!seen.has(asset.id),'pages must not repeat the first assets');seen.add(asset.id);});
  assetOffset=page.nextAssetOffset;
  if(assetOffset!==null) assert.equal(page.assetHasMore,true);
} while(assetOffset!==null);
assert.equal(seen.size,58,'all matching assets beyond the 50-row limit are reachable');
assert.ok(seen.has('paged-54'));
const scoped=queryStore(pagedContext,{module:'itinerary',offset:100,assetOffset:50,assetLimit:10});
assert.equal(scoped.assets.length,8,'fact-filtered image scope remains stable on later fact pages');
assert.throws(()=>queryStore(pagedContext,{assetOffset:-1}));
assert.throws(()=>queryStore(pagedContext,{assetLimit:51}));
const assetCli=spawnSync(process.execPath,[path.join(__dirname,'research-store.js'),'--store='+file,'--entity=cafe-a','--asset-offset=50','--asset-limit=10'],{encoding:'utf8'});
assert.equal(assetCli.status,0,assetCli.stderr);assert.equal(JSON.parse(assetCli.stdout).assets.length,8);
// First-read sources and images must be reusable before fact extraction.
const gapsDir=fs.mkdtempSync(path.join(os.tmpdir(),'guide-research-gaps-'));
const gapsFile=path.join(gapsDir,'research.local.json');
const sourceA={type:'official',title:'菜单',url:'https://example.test/menu',readAt:'2026-11-03'};
const sourceB={...sourceA,title:'另一处资料',url:'https://example.test/other'};
const sourceC={...sourceA,title:'仅来源记录',url:'https://example.test/source-only'};
const aid=sourceKey(sourceA),bid=sourceKey(sourceB),cid=sourceKey(sourceC);
const gap={id:'gap-menu',sourceId:aid,entityIds:['e1'],kind:'menu',locator:{kind:'image',imageIndex:1},failure:'首次下载失败'};
let gapStore=mergeStore(gapsFile,{sources:[sourceA,sourceB,sourceC],entities:[
  {id:'e1',name:'门店一',city:'甲城',country:'测试国'},{id:'e2',name:'门店二',city:'乙城',country:'测试国'}
],assets:[gap,{...gap,id:'unbound-image',entityIds:[],locator:{kind:'image',imageIndex:2}},
  {...gap,id:'excluded-image',sourceId:bid,entityIds:['e2'],state:'rejected'}]});
const direct=createContext(gapStore,gapsDir);
assert.equal(queryStore(direct,{source:aid}).assets.length,2,'source lookup must not require a fact row');
assert.equal(queryStore(direct,{source:aid}).sources[0].id,aid);
assert.equal(queryStore(direct,{entity:'e1'}).assets.length,1);
assert.equal(queryStore(direct,{city:'甲城'}).assets.length,1);
assert.equal(queryStore(direct,{source:cid}).sources[0].id,cid,'a source-only record is discoverable');
assert.equal(queryStore(direct,{source:aid,entity:'e2'}).assets.length,0);
assert.equal(queryStore(direct,{source:aid,city:'乙城'}).assets.length,0);
assert.equal(queryStore(direct,{entity:'e1',city:'乙城'}).assets.length,0);
assert.equal(queryStore(direct,{source:aid,module:'itinerary'}).assets.length,0,'fact-specific filters remain strict');
assert.equal(queryStore(direct,{source:aid,category:'menu'}).assets.length,0);
assert.equal(queryStore(direct,{source:aid,q:'不存在的内容'}).assets.length,0);
assert.equal(queryStore(direct,{source:bid}).assets.length,0,'rejected images remain hidden by default');
assert.equal(queryStore(direct,{source:bid,state:'rejected'}).assets.length,1);
assert.equal(queryStore(direct,{source:aid,state:'usable'}).assets.length,0,'direct lookup cannot upgrade state');
assert.equal(queryStore(direct,{source:'missing'}).sources.length,0);
const unfilled=queryStore(direct,{entity:'e1'}).assets[0];
const prefill=fs.readFileSync(gapsFile,'utf8');
assert.throws(()=>mergeStore(gapsFile,{assets:[{...unfilled,sourceId:bid,file:photo}]}));
assert.equal(fs.readFileSync(gapsFile,'utf8'),prefill);
gapStore=mergeStore(gapsFile,{assets:[{...unfilled,file:photo}]});
assert.equal(gapStore.assets.length,3,'fill the existing gap rather than creating a duplicate record');
let filled=queryStore(createContext(gapStore,gapsDir),{entity:'e1'}).assets[0];
assert.equal(filled.id,'gap-menu');assert.equal(filled.failure,undefined);
assert.equal(filled.fileAvailable,true);assert.equal(filled.readyForReview,false,'download success is not semantic review');
gapStore=mergeStore(gapsFile,{assets:[{...filled,inspected:true,description:'门店一的实际菜单',state:'usable'}]});
filled=queryStore(createContext(gapStore,gapsDir),{entity:'e1'}).assets[0];
assert.equal(filled.readyForReview,true);
const differentPhoto=path.join(gapsDir,'different.png');
fs.writeFileSync(differentPhoto,Buffer.concat([fs.readFileSync(photo),Buffer.from('different image bytes')]));
const filledBefore=fs.readFileSync(gapsFile,'utf8');
for(const changed of [{file:differentPhoto},{sourceId:bid},{entityIds:['e2']},{kind:'entrance'},{locator:{kind:'image',imageIndex:3}}]) {
  assert.throws(()=>mergeStore(gapsFile,{assets:[{...filled,...changed}]}),'an existing image or its attribution still needs a new id');
  assert.equal(fs.readFileSync(gapsFile,'utf8'),filledBefore);
}
assert.equal(fs.readdirSync(path.join(gapsDir,'research-assets')).length,1,'failed replacement must not copy an orphan file');
const directCli=spawnSync(process.execPath,[path.join(__dirname,'research-store.js'),'--store='+gapsFile,'--source='+aid],{encoding:'utf8'});
assert.equal(directCli.status,0,directCli.stderr);assert.equal(JSON.parse(directCli.stdout).assets.length,2);
console.log('PASS research reuse: note/image deduplication, branch identity, module lookup, pagination, evidence gaps, dated conflicts and atomic validation');
