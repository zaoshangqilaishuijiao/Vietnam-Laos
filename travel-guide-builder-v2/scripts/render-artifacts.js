const fs = require('fs');
const os = require('os');
const path = require('path');
const { collectLocalAssetReferences } = require('./build-public-guide.js');

function assertDestination(root, destination) {
  if (!destination.startsWith(root + path.sep)) throw Error('交付资源路径越界');
  // Reject symlink parents, including dangling links, before creating directories.
  for (let current = destination; current !== root; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error(`交付资源不能通过符号链接越界：${path.relative(root, destination)}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

// HTML, every referenced local asset and the success report are one rollback unit.
// Snapshots stay local for recovery; abrupt process termination is not a filesystem transaction.
function deliverArtifacts({ inputPath, outputPath, html, skillRoot, runtimeAssets = [], reportPath, report }) {
  const sourceRoot = fs.realpathSync(path.dirname(path.resolve(inputPath)));
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  const outputRoot = fs.realpathSync(path.dirname(path.resolve(outputPath)));
  const runtime = new Set(runtimeAssets);
  const entries = [];
  for (const relative of collectLocalAssetReferences(html)) {
    const destination = path.resolve(outputRoot, relative);
    assertDestination(outputRoot, destination);
    const roots = runtime.has(relative) ? [fs.realpathSync(skillRoot)] : [sourceRoot, outputRoot];
    let source;
    for (const root of roots) {
      const candidate = path.resolve(root, relative);
      if (!fs.existsSync(candidate)) continue;
      if (!fs.statSync(candidate).isFile() || !fs.realpathSync(candidate).startsWith(root + path.sep)) throw Error(`资源来源越界或不是文件：${relative}`);
      source = candidate; break;
    }
    if (!source) throw Error(`HTML 引用的本地资源不存在：${relative}；请放在 trip-data.json 同级相对路径。`);
    entries.push({ destination, contents: fs.readFileSync(source) });
  }
  entries.push({ destination: path.join(outputRoot, path.basename(outputPath)), contents: Buffer.from(html) });
  if (reportPath) entries.push({ destination: path.join(outputRoot, path.basename(reportPath)), contents: Buffer.from(JSON.stringify(report, null, 2) + '\n') });
  const unique = new Set();
  for (const entry of entries) {
    assertDestination(outputRoot, entry.destination);
    if (unique.has(entry.destination)) throw Error('交付路径重复');
    unique.add(entry.destination);
    entry.original = fs.existsSync(entry.destination) ? fs.readFileSync(entry.destination) : null;
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-render-transaction-'));
  const changed = entries.filter(entry => entry.original === null || !entry.original.equals(entry.contents));
  fs.writeFileSync(path.join(scratch, 'manifest.json'), JSON.stringify(changed.map(entry => ({ destination: entry.destination, existed: entry.original !== null })), null, 2));
  changed.forEach((entry, index) => {
    fs.writeFileSync(path.join(scratch, `${index}.new`), entry.contents);
    if (entry.original !== null) fs.writeFileSync(path.join(scratch, `${index}.old`), entry.original);
  });
  const replaced = [];
  const replace = (entry, contents) => {
    const temporary = entry.destination + `.${process.pid}.render-tmp`;
    fs.writeFileSync(temporary, contents);
    try { fs.renameSync(temporary, entry.destination); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  };
  try {
    for (const entry of changed) {
      fs.mkdirSync(path.dirname(entry.destination), { recursive: true });
      replace(entry, entry.contents);
      replaced.push(entry);
    }
  } catch (error) {
    const failures = [];
    for (const entry of replaced.reverse()) {
      try {
        if (entry.original === null) fs.unlinkSync(entry.destination);
        else replace(entry, entry.original);
      } catch (_) { failures.push(path.basename(entry.destination)); }
    }
    throw Error(`交付失败：${error.message}；${failures.length ? '恢复失败：' + failures.join('、') : '已恢复原成品'}；本地快照 ${scratch}`);
  }
}
module.exports = { deliverArtifacts };
