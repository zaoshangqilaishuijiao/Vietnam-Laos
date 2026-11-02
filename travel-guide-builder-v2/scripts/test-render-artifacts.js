#!/usr/bin/env node
const assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { deliverArtifacts } = require('./render-artifacts.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-artifacts-test-'));
const input = path.join(temp, 'input'), output = path.join(temp, 'output');
for (const dir of [input, output]) fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
const html = '<img src="images/cover.jpg"><img src="images/reference.png">';
for (const [file, value] of [['images/cover.jpg', 'cover'], ['images/reference.png', 'reference']]) fs.writeFileSync(path.join(input, file), value);
const options = { inputPath: path.join(input, 'trip.json'), outputPath: path.join(output, 'index.html'), html, runtimeAssets: [], skillRoot: temp };
deliverArtifacts(options);
assert.equal(fs.readFileSync(path.join(output, 'images/reference.png'), 'utf8'), 'reference');
fs.writeFileSync(path.join(input, 'images/cover.jpg'), 'new-cover');
assert.throws(() => deliverArtifacts({ ...options, html: html + '<img src="images/missing.jpg">' }), /不存在/);
assert.equal(fs.readFileSync(path.join(output, 'images/cover.jpg'), 'utf8'), 'cover');
const rename = fs.renameSync;
let failed = false;
fs.renameSync = (from, to) => {
  if (!failed && to === path.join(fs.realpathSync(output), 'index.html')) { failed = true; throw Error('synthetic write failure'); }
  return rename(from, to);
};
try { assert.throws(() => deliverArtifacts({ ...options, html: html + '<p>new</p>' }), /synthetic/); }
finally { fs.renameSync = rename; }
assert.equal(fs.readFileSync(path.join(output, 'images/cover.jpg'), 'utf8'), 'cover');
assert.equal(fs.readFileSync(options.outputPath, 'utf8'), html);
fs.symlinkSync(input, path.join(output, 'escape'));
assert.throws(() => deliverArtifacts({ ...options, html: '<img src="escape/images/cover.jpg">' }), /越界|符号链接/);
console.log('PASS complete asset delivery, preflight, write rollback and symlink containment');
