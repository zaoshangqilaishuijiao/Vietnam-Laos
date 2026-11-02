#!/usr/bin/env node
// Stage and validate a local upgrade before replacing any source file. Never publishes.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { readOption } = require("./cli-options.js");
const { requiredLockedFiles } = require("./locked-files.js");
const root = path.resolve(__dirname, "..");
function upgrade(version, baselineLock = "") {
  if (!/^\d+\.\d+\.\d+$/.test(version || "")) throw Error("Usage: node scripts/upgrade-skill.js --version=X.Y.Z");
  const old = JSON.parse(fs.readFileSync(baselineLock || path.join(root,"assets/page-template.lock.json"), "utf8"));
  const compare = (a,b) => { const x=a.split('.').map(Number), y=b.split('.').map(Number); for(let i=0;i<3;i++) if(x[i]!==y[i]) return x[i]-y[i]; return 0; };
  const files = requiredLockedFiles(root);
  const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const initialHashes = new Map(files.map(file => [file, hash(path.join(root,file))]));
  const changed = files.some(file => old.files[file] !== initialHashes.get(file));
  if (compare(version, old.templateVersion) < 0 || (changed && compare(version, old.templateVersion) <= 0)) throw Error("共享文件发生变化时版本必须高于当前锁版本");
  const outputs = ["package.json", "package-lock.json", "scripts/shared-constants.js", "SKILL.md", "agents/openai.yaml", "references/skill-rules.md", "references/capability-and-versioning.md", "assets/travel-guide-interactions.js", "assets/page-template.lock.json"];
  const originals = new Map(outputs.map(name => [name, fs.readFileSync(path.join(root,name))]));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "travel-guide-upgrade-"));
  const staged = path.join(scratch,"staged"), backup = path.join(scratch,"backup");
  for (const name of ["assets","scripts","references","supabase",".githooks","agents","SKILL.md","package.json","package-lock.json"]) {
    fs.mkdirSync(staged,{recursive:true});
    fs.cpSync(path.join(root,name),path.join(staged,name),{recursive:true});
  }
  for (const [name, contents] of originals) { const target=path.join(backup,name); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,contents); }
  for (const name of ["package.json", "package-lock.json"]) {
    const file=path.join(staged,name), data=JSON.parse(fs.readFileSync(file,"utf8"));
    data.version=version; if(data.packages?.[""]) data.packages[""].version=version;
    if (name === 'package.json') {
      if (!/旅行攻略制作 \d+\.\d+\.\d+/.test(data.description || '')) throw Error('升级字段缺失：npm 包描述，原文件未修改');
      data.description = data.description.replace(/旅行攻略制作 \d+\.\d+\.\d+/, `旅行攻略制作 ${version}`);
    }
    fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n");
  }
  for (const [name,regex,replacement] of [
    ["scripts/shared-constants.js", /const PAGE_TEMPLATE_VERSION = ["'][^"']+["'];/, `const PAGE_TEMPLATE_VERSION = '${version}';`],
    ["SKILL.md", /当前稳定版 \d+\.\d+\.\d+/, `当前稳定版 ${version}`],
    ["SKILL.md", /旅行攻略规划与网页制作技能 \d+\.\d+\.\d+/, `旅行攻略规划与网页制作技能 ${version}`],
    ["SKILL.md", /^# 旅行攻略制作 \d+\.\d+\.\d+/m, `# 旅行攻略制作 ${version}`],
    ["agents/openai.yaml", /display_name: "旅行攻略制作 \d+\.\d+\.\d+"/, `display_name: "旅行攻略制作 ${version}"`],
    ["agents/openai.yaml", /按当前 \d+\.\d+\.\d+ 模板/, `按当前 ${version} 模板`],
    ["references/skill-rules.md", /^# 旅行攻略制作 \d+\.\d+\.\d+ - 详细规则/m, `# 旅行攻略制作 ${version} - 详细规则`],
    ["references/capability-and-versioning.md", /当前稳定版本为 \*\*\d+\.\d+\.\d+\*\*/, `当前稳定版本为 **${version}**`]
  ]) {
    const file=path.join(staged,name), content=fs.readFileSync(file,"utf8");
    if(!regex.test(content)) throw Error(`升级字段缺失：${name}，原文件未修改`);
    fs.writeFileSync(file,content.replace(regex,replacement));
  }
  const checkedRun = args => {
    const result=spawnSync(process.execPath,args,{cwd:staged,encoding:"utf8"});
    if(result.status!==0) throw Error(result.stderr || "升级预检查失败，原文件未修改");
  };
  checkedRun([path.join(staged,"scripts/combine-interactions-modules.js")]);
  checkedRun(["--check",path.join(staged,"assets/travel-guide-interactions.js")]);
  const database=fs.readdirSync(path.join(staged,"supabase")).filter(f=>f.endsWith('.sql')).sort().at(-1);
  const lock={templateVersion:version,previousVersion:old.templateVersion,mode:"locked",components:{data:require(path.join(staged,"scripts/shared-constants.js")).GUIDE_DATA_VERSION,page:version,tools:version,database},files:Object.fromEntries(files.map(file=>[file,hash(path.join(staged,file))]))};
  fs.writeFileSync(path.join(staged,"assets/page-template.lock.json"),JSON.stringify(lock,null,2)+"\n");
  checkedRun([path.join(staged,"scripts/verify-template-lock.js")]);
  checkedRun([path.join(staged,"scripts/test-version-consistency.js")]);
  // Detect concurrent edits before the transaction. Retain the local snapshot for recovery.
  for (const [name,contents] of originals) if(!fs.readFileSync(path.join(root,name)).equals(contents)) throw Error(`升级期间文件被修改：${name}，停止替换`);
  for (const [name,sha] of initialHashes) if(hash(path.join(root,name)) !== sha) throw Error(`升级期间运行文件被修改：${name}，停止替换`);
  const replace = (name, contents, suffix) => {
    const target=path.join(root,name), temporary=target+`.${suffix}-${process.pid}.tmp`;
    try { fs.writeFileSync(temporary,contents); fs.renameSync(temporary,target); }
    finally { if(fs.existsSync(temporary)) fs.unlinkSync(temporary); } // Only this invocation's temporary file.
  };
  const committed=[];
  try {
    for(const name of outputs) {
      replace(name,fs.readFileSync(path.join(staged,name)),"upgrade");
      committed.push(name);
    }
  } catch(error) {
    const failed=[];
    for(const name of committed.reverse()) {
      try { replace(name,originals.get(name),"rollback"); }
      catch(_) { failed.push(name); }
    }
    throw Error(`升级落盘失败：${error.message}；${failed.length ? '部分恢复失败：'+failed.join('、') : '已恢复原文件'}。本地备份：${backup}`);
  }
  console.log(`已同步本地版本 ${version}、组合产物和 ${files.length} 个锁定文件；尚需统一回归。本地升级前快照：${backup}`);
}
if(require.main===module){try{upgrade(readOption(process.argv.slice(2),"version"),readOption(process.argv.slice(2),"baseline-lock"));}catch(error){console.error(error.message);process.exit(1);}}
module.exports={upgrade};
