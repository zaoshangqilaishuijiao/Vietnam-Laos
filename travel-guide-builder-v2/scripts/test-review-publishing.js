#!/usr/bin/env node
const assert = require('node:assert/strict');
const { findOutgoingOutsideWhitelist } = require('./publish-checklist.js');
// NUL paths, deletions and intermediate commits must all be checked, not just HEAD.
const changes = { first: ['index.html', 'private notes.md', 'deleted.txt'], second: ['images/cover.jpg'] };
const git = (...args) => ({ status: 0, stdout: changes[args.at(-1)].join('\0') + '\0' });
assert.deepEqual(findOutgoingOutsideWhitelist(git, ['first', 'second'], new Set(['index.html', 'images/cover.jpg'])),
  ['first:private notes.md', 'first:deleted.txt']);
assert.deepEqual(findOutgoingOutsideWhitelist(git, ['second'], new Set(['images/cover.jpg'])), []);
assert.throws(() => findOutgoingOutsideWhitelist(() => ({ status: 1 }), ['first'], new Set()), /无法核对/);
console.log('PASS all outgoing commit paths respect publication whitelist');
