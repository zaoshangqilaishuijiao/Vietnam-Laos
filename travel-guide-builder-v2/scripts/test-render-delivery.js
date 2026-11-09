const assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-delivery-cli-'));
const run = args => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
const input = path.join(temp, 'trip.json'), output = path.join(temp, 'new-output/index.html');
assert.equal(run(['scripts/test-data-pipeline.js', '--write-content-fixture=' + input]).status, 0);
const result = run(['scripts/render-guide.js', input, output, '--public-source', '--no-collaboration']);
assert.equal(result.status, 0, result.stderr);
for (const file of require('./build-public-guide.js').collectLocalAssetReferences(fs.readFileSync(output, 'utf8'))) assert.ok(fs.existsSync(path.join(path.dirname(output), file)), file);
const baseline = fs.readFileSync(output);
const namedOutput = path.join(path.dirname(output), 'guide.html');
const namedRender = run(['scripts/render-guide.js', input, namedOutput, '--public-source', '--no-collaboration']);
assert.equal(namedRender.status, 0, namedRender.stderr);
const data = JSON.parse(fs.readFileSync(input));
data.meta.hero.title = '';
fs.writeFileSync(input, JSON.stringify(data));
const invalidOutput = path.join(temp, 'fresh-invalid/index.html');
const invalid = run(['scripts/render-guide.js', input, invalidOutput, '--public-source', '--no-collaboration']);
assert.equal(invalid.status, 1);
assert.ok(!invalid.stderr.includes('ENOENT'), invalid.stderr);
const report = JSON.parse(fs.readFileSync(invalidOutput.replace('.html', '.validation.json')));
assert.equal(report.dataValidation.valid, false);
assert.ok(report.dataValidation.failures.length);
assert.deepEqual(fs.readFileSync(output), baseline);
console.log('PASS CLI complete resources and invalid input report in fresh directory');

const { collectLocalAssetReferences, copyReferencedAssets } = require('./build-public-guide.js');
const html = baseline.toString('utf8');
const references = collectLocalAssetReferences(html);
const manifestFile = [...references].find(file => file.endsWith('.webmanifest'));
assert.ok(manifestFile, 'HTML references an actual install manifest');
const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(output), manifestFile), 'utf8'));
const namedManifestFile = [...collectLocalAssetReferences(fs.readFileSync(namedOutput, 'utf8'))].find(file => file.endsWith('.webmanifest'));
const namedManifest = JSON.parse(fs.readFileSync(path.join(path.dirname(output), namedManifestFile), 'utf8'));
assert.notEqual(namedManifestFile, manifestFile);
assert.equal(namedManifest.start_url, './guide.html');
assert.equal(namedManifest.id, manifest.id);
assert.equal(new URL(manifest.start_url, 'https://example.test/bangkok/' + manifestFile).pathname, '/bangkok/index.html');
assert.equal(manifest.display, 'standalone');
assert.match(manifest.short_name, /攻略$/);
assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
for (const icon of manifest.icons) assert.ok(references.has(icon.src), icon.src);
const deployment = path.join(temp, 'pages/index.html');
copyReferencedAssets(html, output, deployment);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(deployment), manifestFile))), manifest);
assert.throws(() => copyReferencedAssets(html, output, path.join(temp, 'pages/wrong.html')), /保留源 HTML 文件名/);

const JSDOM = require('./test-env.js').requireJsdom();
if (JSDOM) {
  const runtime = fs.readFileSync(path.join(root, 'assets/travel-guide-interactions.js'), 'utf8');
  const open = (url, userAgent, installed = false) => {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    const win = dom.window;
    Object.defineProperty(win.navigator, 'userAgent', { value: userAgent });
    win.matchMedia = query => ({ matches: installed && query === '(display-mode: standalone)' });
    win.eval(runtime);
    win.TravelGuideInteractions.initGuidePage();
    return dom;
  };
  const iphone = open('https://example.test/bangkok/', 'iPhone');
  const doc = iphone.window.document;
  const entry = doc.querySelector('[data-guide-home-screen]');
  const launcher = doc.querySelector('[data-guide-floating-toggle]');
  const dialog = doc.querySelector('[data-guide-home-screen-dialog]');
  dialog.showModal = () => { dialog.open = true; };
  launcher.click();
  assert.equal(entry.hidden, false);
  entry.click();
  assert.equal(dialog.open, true);
  assert.match(dialog.textContent, /Safari.*分享.*添加到主屏幕/);
  dialog.open = false;
  dialog.dispatchEvent(new iphone.window.Event('close'));
  assert.equal(doc.activeElement, launcher);
  iphone.window.close();

  const android = open('https://example.test/bangkok/', 'Android');
  const event = new android.window.Event('beforeinstallprompt', { cancelable: true });
  let prompted = 0;
  event.prompt = () => { prompted += 1; };
  android.window.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(prompted, 0);
  const androidEntry = android.window.document.querySelector('[data-guide-home-screen]');
  androidEntry.click();
  assert.equal(prompted, 1);
  android.window.dispatchEvent(new android.window.Event('appinstalled'));
  assert.equal(androidEntry.hidden, true);
  android.window.close();

  for (const [url, installed] of [['http://127.0.0.1:8766/bangkok/', false], ['https://example.test/bangkok/', true]]) {
    const hidden = open(url, 'iPhone', installed);
    assert.equal(hidden.window.document.querySelector('[data-guide-home-screen]').hidden, true);
    hidden.window.close();
  }
}
console.log('PASS install manifest, asset delivery, native prompt, and manual guidance');
