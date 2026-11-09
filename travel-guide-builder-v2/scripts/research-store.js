#!/usr/bin/env node
// Trip-local research only. Never downloads, renders, publishes, or modifies trip-data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {readOption} = require('./cli-options.js');
const {xiaohongshuIdentity} = require('./xiaohongshu-identity.js');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const emptyStore = () => ({version:1,sources:[],entities:[],facts:[],assets:[]});
const requireText = (value, label) => { if(typeof value !== 'string' || !value.trim()) throw Error(label + ' must be nonempty text'); };
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const states = ['candidate','usable','recheck','rejected'];
const fields = {
  sources:['id','type','title','author','url','publishedAt','readAt'],
  entities:['id','name','city','country','aliases','placeId','address','localName'],
  facts:['id','category','text','sourceId','entityIds','modules','dynamic','observedAt','conditions','locator','state'],
  assets:['id','path','sha256','sourceId','entityIds','kind','description','locator','state','inspected','failure','url']
};
const modules = new Set(require('../references/module-registry.json').modules.map(m=>m.name));
function sourceKey(source) {
  const url = new URL(source.url);
  if(!['http:','https:'].includes(url.protocol)) throw Error('Source must use HTTP(S)');
  if(source.type === 'xiaohongshu') {
    const note = xiaohongshuIdentity(source.url);
    if(!note) throw Error('XHS source needs an actually opened long note URL');
    return 'xhs:' + note;
  }
  url.hash = '';
  return 'web:' + sha(url.href).slice(0,24);
}
function validate(store) {
  if(store.version !== 1) throw Error('Unknown research store version');
  const sets = {};
  for(const key of ['sources','entities','facts','assets']) {
    if(!Array.isArray(store[key])) throw Error(key + ' must be an array');
    sets[key] = new Set();
    for(const row of store[key]) {
      if(Object.keys(row).some(field=>!fields[key].includes(field))) throw Error('Unknown '+key+' field; keep useful extracts, not full tool responses');
      requireText(row.id,key+'.id');
      if(sets[key].has(row.id)) throw Error('Duplicate '+key+' identity');
      sets[key].add(row.id);
    }
  }
  for(const source of store.sources) {
    if(!['xiaohongshu','official','other'].includes(source.type)) throw Error('Invalid source type');
    requireText(source.title,'source.title');
    if(!date(source.readAt)) throw Error('Source readAt must be an actual read date');
    if(source.publishedAt !== undefined && !date(source.publishedAt)) throw Error('Invalid source publishedAt');
    if(source.type === 'xiaohongshu') requireText(source.author,'source.author');
    if(sourceKey(source) !== source.id) throw Error('Source identity mismatch');
  }
  for(const entity of store.entities) {
    for(const field of ['name','city','country']) requireText(entity[field],'entity.'+field);
    if(entity.aliases !== undefined && (!Array.isArray(entity.aliases) || entity.aliases.some(a=>typeof a!=='string'))) throw Error('aliases must be text array');
  }
  for(const row of [...store.facts,...store.assets]) {
    if(!sets.sources.has(row.sourceId)) throw Error('Unknown sourceId: '+row.sourceId);
    if(!Array.isArray(row.entityIds) || row.entityIds.some(id=>!sets.entities.has(id))) throw Error('Unknown entity reference');
    if(!states.includes(row.state)) throw Error('Invalid research state');
    if(!['body','comment','image'].includes(row.locator?.kind)) throw Error('Need body/comment/image evidence locator');
    if(Object.keys(row.locator).some(key=>!['kind','imageIndex','commentId'].includes(key))) throw Error('Unknown evidence locator field');
    if(row.locator.kind === 'image' && (!Number.isInteger(row.locator.imageIndex) || row.locator.imageIndex < 1)) throw Error('Image evidence needs a 1-based imageIndex');
    if(row.locator.kind === 'comment') requireText(row.locator.commentId,'commentId');
  }
  for(const fact of store.facts) {
    requireText(fact.category,'fact.category'); requireText(fact.text,'fact.text');
    if(typeof fact.dynamic !== 'boolean') throw Error('Fact dynamic must be explicit');
    if(!Array.isArray(fact.modules) || !fact.modules.length || fact.modules.some(m=>!modules.has(m))) throw Error('Invalid module references');
    if(fact.observedAt !== undefined && !date(fact.observedAt)) throw Error('Invalid observedAt');
    if(fact.dynamic && fact.state==='usable' && !fact.observedAt) throw Error('Usable dynamic facts need an observation date');
  }
  for(const asset of store.assets) {
    requireText(asset.kind,'asset.kind');
    if(typeof asset.inspected !== 'boolean') throw Error('Asset inspected must be boolean');
    if(asset.inspected) requireText(asset.description,'inspected image description');
    if(asset.path !== undefined && !/^research-assets\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(asset.path)) throw Error('Unsafe research asset path');
    if(asset.path && !/^[a-f0-9]{64}$/.test(asset.sha256 || '')) throw Error('Asset digest missing');
    if(!asset.path && !asset.failure) throw Error('Missing asset must record a bounded-research gap');
  }
  return store;
}
function loadStore(file) { return fs.existsSync(file) ? validate(JSON.parse(fs.readFileSync(file,'utf8'))) : emptyStore(); }
function mergeRows(existing, incoming, kind) {
  const map = new Map(existing.map(row=>[row.id,row]));
  for(const row of incoming) {
    const previous = map.get(row.id);
    if(previous && kind === 'facts' && ['text','sourceId','entityIds','locator','observedAt','dynamic','conditions'].some(key=>JSON.stringify(previous[key])!==JSON.stringify(row[key]))) throw Error('Changed observation needs a new fact id; old evidence must remain');
    if(previous && kind === 'entities' && ['name','city','country'].some(key=>previous[key]!==row[key])) throw Error('Entity identity changed; confirm the branch or use a new id');
    if(previous && kind === 'entities' && previous.placeId && row.placeId && previous.placeId!==row.placeId) throw Error('Entity placeId changed; confirm the branch or use a new id');
    const firstAssetFile = kind === 'assets' && previous && !previous.path && Boolean(row.path);
    if(previous && kind === 'assets' && (['sourceId','locator','entityIds','kind'].some(key=>JSON.stringify(previous[key])!==JSON.stringify(row[key]))
      || (!firstAssetFile && previous.path!==row.path))) throw Error('Changed image evidence needs a new asset id');
    const merged = {...previous,...row};
    if(firstAssetFile) delete merged.failure; // The original gap is resolved; identity and review state are retained.
    if(kind === 'sources' && previous?.readAt > row.readAt) merged.readAt=previous.readAt;
    if(kind === 'facts') merged.modules = [...new Set([...(previous?.modules || []),...row.modules])];
    if(kind === 'entities' && (previous?.aliases || row.aliases)) merged.aliases = [...new Set([...(previous?.aliases || []),...(row.aliases || [])])];
    map.set(row.id,merged);
  }
  return [...map.values()];
}
function imageExtension(bytes) {
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if(bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'jpg';
  if(bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP') return 'webp';
  throw Error('Research asset must be a local PNG/JPEG/WebP image');
}
function mergeStore(file, patch) {
  if(!file.endsWith('.local.json')) throw Error('Research store must use .local.json; never write trip-data');
  fs.mkdirSync(path.dirname(path.resolve(file)),{recursive:true});
  const lock = file+'.lock'; const fd = fs.openSync(lock,'wx',0o600);
  try {
    const store = loadStore(file), transfers = new Map();
    for(const key of Object.keys(patch)) if(!['sources','entities','facts','assets'].includes(key)) throw Error('Unknown patch section: '+key);
    for(const key of ['sources','entities','facts','assets']) if(patch[key]!==undefined && !Array.isArray(patch[key])) throw Error('Patch arrays required');
    const sources = (patch.sources || []).map(source=>({...source,id:sourceKey(source)}));
    const priorFacts = new Map(store.facts.map(f=>[f.id,f])), priorAssets = new Map(store.assets.map(a=>[a.id,a]));
    const facts = (patch.facts || []).map(input=> {
      const {needsRecheck,sourceReadAt,...fact} = input; // Query diagnostics are not stored evidence.
      const id = fact.id || 'fact:'+sha(JSON.stringify([fact.sourceId,fact.entityIds,fact.category,fact.text,fact.locator,fact.observedAt,fact.conditions])).slice(0,24);
      return {...fact,id,state:fact.state ?? priorFacts.get(id)?.state ?? 'candidate'};
    });
    const assets = (patch.assets || []).map(row=> {
      const {fileAvailable,readyForReview,...input} = row;
      const asset = {...input,state:input.state || 'candidate',inspected:input.inspected === true};
      if(input.file) {
        const bytes = fs.readFileSync(input.file), digest = sha(bytes);
        asset.path = 'research-assets/'+digest+'.'+imageExtension(bytes); asset.sha256=digest;
        transfers.set(asset.path,bytes); delete asset.file;
      }
      asset.id ||= 'asset:'+sha(JSON.stringify([asset.sourceId,asset.locator,asset.entityIds,asset.kind,asset.path])).slice(0,24);
      asset.state = input.state ?? priorAssets.get(asset.id)?.state ?? 'candidate';
      asset.inspected = input.inspected ?? priorAssets.get(asset.id)?.inspected ?? false;
      return asset;
    });
    const merged = validate({version:1,sources:mergeRows(store.sources,sources,'sources'),entities:mergeRows(store.entities,patch.entities || [],'entities'),facts:mergeRows(store.facts,facts,'facts'),assets:mergeRows(store.assets,assets,'assets')});
    const root = fs.realpathSync(path.dirname(path.resolve(file)));
    const assetDir = path.join(root,'research-assets');
    if(fs.existsSync(assetDir) && fs.lstatSync(assetDir).isSymbolicLink()) throw Error('Research assets directory cannot be a symlink');
    for(const [relative,bytes] of transfers) {
      const target = path.join(root,relative); fs.mkdirSync(assetDir,{recursive:true});
      if(fs.existsSync(target)) { if(fs.lstatSync(target).isSymbolicLink() || sha(fs.readFileSync(target))!==sha(bytes)) throw Error('Asset path collision'); }
      else fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});
    }
    const temporary = file+'.tmp-'+process.pid;
    try { fs.writeFileSync(temporary,JSON.stringify(merged,null,2)+'\n',{mode:0o600}); fs.renameSync(temporary,file); }
    finally { if(fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return merged;
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
function createContext(store, root = null) {
  validate(store);
  const sources = new Map(store.sources.map(s=>[s.id,s])), entities = new Map(store.entities.map(e=>[e.id,e]));
  const indices = Object.fromEntries(['entity','module','category','source'].map(key=>[key,new Map()]));
  for(const fact of store.facts) for(const [key,values] of [['entity',fact.entityIds],['module',fact.modules],['category',[fact.category]],['source',[fact.sourceId]]]) for(const value of values) {
    if(!indices[key].has(value)) indices[key].set(value,[]);
    indices[key].get(value).push(fact);
  }
  return {store,sources,entities,indices,root};
}
function queryStore(context, filters={}) {
  const {store,sources,entities,indices,root} = context;
  if(filters.state && !states.includes(filters.state)) throw Error('Unknown state filter');
  if(filters.module && !modules.has(filters.module)) throw Error('Unknown module filter');
  const limit = Number(filters.limit ?? 10), offset = Number(filters.offset ?? 0);
  if(!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0) throw Error('limit=1..50 and offset>=0 required');
  const assetLimit = Number(filters.assetLimit ?? limit), assetOffset = Number(filters.assetOffset ?? 0);
  if(!Number.isInteger(assetLimit)||assetLimit<1||assetLimit>50||!Number.isInteger(assetOffset)||assetOffset<0) throw Error('assetLimit=1..50 and assetOffset>=0 required');
  const pools = Object.keys(indices).filter(k=>filters[k]).map(k=>indices[k].get(filters[k]) || []);
  const candidates = pools.length ? pools.sort((a,b)=>a.length-b.length)[0] : store.facts;
  const lower = value=>String(value || '').toLocaleLowerCase();
  const matching = candidates.filter(f=> (!filters.entity || f.entityIds.includes(filters.entity)) && (!filters.module || f.modules.includes(filters.module)) && (!filters.source || f.sourceId===filters.source) && (!filters.category || f.category===filters.category) && (filters.state ? f.state===filters.state : f.state!=='rejected') && (!filters.city || f.entityIds.some(id=>entities.get(id)?.city===filters.city)) && (!filters.q || lower([f.text,f.category,...f.entityIds.flatMap(id=>{const e=entities.get(id);return [e.name,...(e.aliases || [])];})].join(' ')).includes(lower(filters.q))));
  const facts = matching.slice(offset,offset+limit).map(f=>({...f,needsRecheck:f.dynamic || f.state==='recheck',sourceReadAt:sources.get(f.sourceId).readAt}));
  const entityIds = new Set(facts.flatMap(f=>f.entityIds));
  // Asset paging is independent of the current fact page, so later pages cannot lose their scope.
  const matchingEntities = new Set(matching.flatMap(f=>f.entityIds)), matchingSources = new Set(matching.map(f=>f.sourceId));
  const factScoped = Boolean(filters.module || filters.category || filters.q);
  const related = store.assets.filter(a=> {
    if(filters.state ? a.state!==filters.state : a.state==='rejected') return false;
    if(filters.source && a.sourceId!==filters.source) return false;
    if(filters.entity && !a.entityIds.includes(filters.entity)) return false;
    if(filters.city && !a.entityIds.some(id=>entities.get(id)?.city===filters.city)
      && !(a.entityIds.length===0 && matchingSources.has(a.sourceId))) return false;
    // Direct source/place lookup includes first-read assets even before fact extraction.
    // Fact-specific queries retain the complete filtered fact scope, independent of paging.
    return !factScoped || a.entityIds.some(id=>matchingEntities.has(id))
      || (a.entityIds.length===0 && matchingSources.has(a.sourceId));
  });
  const assets = related.slice(assetOffset,assetOffset+assetLimit).map(a=> {
    let fileAvailable = false;
    if(root && a.path) {
      try { const realRoot=fs.realpathSync(root),file=fs.realpathSync(path.resolve(realRoot,a.path)); fileAvailable=file.startsWith(realRoot+path.sep) && sha(fs.readFileSync(file))===a.sha256; } catch (_) { /* Missing assets remain explicit research gaps. */ }
    }
    return {...a,fileAvailable,readyForReview:fileAvailable && a.inspected && a.state==='usable'};
  });
  assets.flatMap(a=>a.entityIds).forEach(id=>entityIds.add(id));
  if(filters.entity && entities.has(filters.entity) && (!filters.city || entities.get(filters.entity).city===filters.city)) entityIds.add(filters.entity);
  const sourceIds = new Set([...facts,...assets].map(r=>r.sourceId));
  if(filters.source && sources.has(filters.source)) sourceIds.add(filters.source);
  const assetHasMore = assetOffset+assets.length<related.length;
  return {total:matching.length,offset,limit,hasMore:offset+facts.length<matching.length,facts,assets,relatedAssetTotal:related.length,assetOffset,assetLimit,assetHasMore,nextAssetOffset:assetHasMore?assetOffset+assets.length:null,assetsTruncated:related.length>assets.length,entities:[...entityIds].map(id=>entities.get(id)),sources:[...sourceIds].map(id=>sources.get(id)),publicationSelected:false};
}
function main(args) {
  const file = readOption(args,'store'); if(!file) throw Error('Usage: research-store.js --store=<research.local.json> [--merge=<patch.json> | --entity=id --module=itinerary --city=城市 --q=关键词 --limit=10 --offset=0 --asset-limit=10 --asset-offset=0]');
  const patch = readOption(args,'merge');
  if(patch) { const input=JSON.parse(fs.readFileSync(patch,'utf8')),store=mergeStore(file,input); console.log(JSON.stringify({counts:Object.fromEntries(['sources','entities','facts','assets'].map(k=>[k,store[k].length])),sourceIds:(input.sources || []).map(s=>({id:sourceKey(s),title:s.title}))})); return; }
  const filters=Object.fromEntries(['entity','module','category','source','state','city','q','limit','offset'].map(k=>[k,readOption(args,k)]).filter(([,v])=>v!==''));
  for(const [key,flag] of [['assetOffset','asset-offset'],['assetLimit','asset-limit']]) {
    const value=readOption(args,flag); if(value!=='') filters[key]=value;
  }
  console.log(JSON.stringify(queryStore(createContext(loadStore(file),path.dirname(path.resolve(file))),filters),null,2));
}
if(require.main===module) try {main(process.argv.slice(2));} catch(error) {console.error(error.message);process.exitCode=1;}
module.exports={sourceKey,validate,loadStore,mergeStore,createContext,queryStore};
