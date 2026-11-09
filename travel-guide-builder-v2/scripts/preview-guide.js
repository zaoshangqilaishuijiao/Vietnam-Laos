#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { readOption } = require('./cli-options.js');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const defaultConfig = () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'private/travel-guide-builder-v2/preview.local.json');
function readConfig(file) {
  if (!fs.existsSync(file)) throw Error('缺少私有预览配置；先用 --origin=<本机已授权HTTP来源> 登记，不自动选择端口。');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const origin = new URL(config.origin);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw Error('预览来源须为 http://127.0.0.1:<固定端口>');
  if (!config.mounts || typeof config.mounts !== 'object' || Array.isArray(config.mounts)) throw Error('mounts 必须为路径映射对象');
  return { ...config, origin: origin.origin };
}
function saveConfig(file, config) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const temporary = file + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', {mode:0o600});
  fs.renameSync(temporary, file);
}
function handler(configFile) {
  return (req, res) => {
    try {
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
      const config = readConfig(configFile);
      const url = new URL(req.url, config.origin);
      if (url.pathname === '/.well-known/travel-guide-preview') {
        res.setHeader('Content-Type','application/json');
        return res.end(JSON.stringify({service:'travel-guide-preview-v1'}));
      }
      const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
      const mount = Object.hasOwn(config.mounts, parts[0]) && config.mounts[parts[0]];
      if (!mount) { res.writeHead(404); return res.end('未登记的攻略路径'); }
      if (parts.length === 1 && !url.pathname.endsWith('/')) { res.writeHead(302,{Location:url.pathname + '/'}); return res.end(); }
      const root = fs.realpathSync(mount.directory);
      const candidate = path.resolve(root, parts.slice(1).join('/') || mount.entry);
      if (!candidate.startsWith(root + path.sep) || !fs.existsSync(candidate)) { res.writeHead(404); return res.end(); }
      const real = fs.realpathSync(candidate);
      if (!real.startsWith(root + path.sep) || !fs.statSync(real).isFile()) { res.writeHead(403); return res.end(); }
      const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon'};
      res.setHeader('Content-Type', types[path.extname(real)] || 'application/octet-stream');
      res.setHeader('Cache-Control','no-store');
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
    } catch (error) { res.writeHead(400); res.end('预览失败：' + error.message); }
  };
}
function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect({host:'127.0.0.1',port});
    const done = result => { socket.destroy(); resolve(result); };
    socket.setTimeout(1500, () => done(true));
    socket.on('connect', () => done(true));
    socket.on('error', error => done(error.code !== 'ECONNREFUSED'));
  });
}
async function startPreview({configFile, alias, directory, entry = 'guide.html', checkOnly = false}) {
  const config = readConfig(configFile);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(alias || '')) throw Error('需要 --mount=<独立攻略路径名>');
  const root = fs.realpathSync(directory);
  const input = fs.realpathSync(path.resolve(root, entry));
  if (!input.startsWith(root + path.sep) || !fs.statSync(input).isFile()) throw Error('入口必须是攻略目录中的文件');
  if (config.mounts[alias] && (config.mounts[alias].directory !== root || config.mounts[alias].entry !== entry)) throw Error('该攻略路径已绑定其他产物；请选独立路径名，不覆盖现有映射。');
  const url = config.origin + '/' + alias + '/';
  const port = Number(new URL(config.origin).port);
  if (await portOpen(port)) {
    let own = false;
    try { const r = await fetch(config.origin + '/.well-known/travel-guide-preview', {signal:AbortSignal.timeout(2000)}); own = r.ok && (await r.json()).service === 'travel-guide-preview-v1'; } catch (_) { /* Content identity below is the compatibility check. */ }
    if (own && !checkOnly) { config.mounts[alias] = {directory:root,entry}; saveConfig(configFile, config); }
    let response;
    try { response = await fetch(url, {signal:AbortSignal.timeout(3000),redirect:'error'}); }
    catch (error) { throw Error(`固定预览端口已占用且服务无法核对：${error.message}；未换端口、未停止进程。`); }
    if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== hash(fs.readFileSync(input))) throw Error('固定预览端口已占用，目标路径不对应当前产物；未换端口、未停止进程。');
    return {url,reused:true};
  }
  if (checkOnly) throw Error('固定来源尚无预览服务');
  config.mounts[alias] = {directory:root,entry};
  saveConfig(configFile, config);
  const server = http.createServer(handler(configFile));
  await new Promise((resolve,reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {url,reused:false,server};
}
async function main(args) {
  const configFile = readOption(args,'config') || defaultConfig();
  const origin = readOption(args,'origin');
  if (origin) {
    const previous = fs.existsSync(configFile) ? readConfig(configFile) : null;
    if (previous && previous.origin !== origin) throw Error('已有固定来源，不自动覆盖；需明确修改私有配置。');
    const config = {origin,mounts:previous?.mounts || {}};
    // Validate before writing; malformed origins never become the saved default.
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port || parsed.origin !== origin) throw Error('来源须为 http://127.0.0.1:<固定端口>');
    saveConfig(configFile, config); console.log('已登记本机私有预览来源：' + origin); return;
  }
  const result = await startPreview({configFile,alias:readOption(args,'mount'),directory:readOption(args,'directory'),entry:readOption(args,'entry') || 'guide.html',checkOnly:args.includes('--check')});
  console.log(JSON.stringify({url:result.url,reused:result.reused,mapVerified:false}));
}
if (require.main === module) main(process.argv.slice(2)).catch(error => {console.error(error.message); process.exitCode=1;});
module.exports = {readConfig,saveConfig,handler,startPreview};
