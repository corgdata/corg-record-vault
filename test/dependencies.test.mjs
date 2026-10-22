import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Ganache's published shrinkwrap can omit optional=true from this Darwin-only
// transitive dependency. Without it, npm ci stops with EBADPLATFORM on Linux.
test('Darwin-only fsevents remains optional; esbuild platform packages are retained', () => {
  const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url)));
  const entries = Object.entries(lock.packages);
  const watchers = entries.filter(([name]) => name.endsWith('/fsevents'));
  assert.ok(watchers.length > 0, 'Expected Ganache watcher dependency');
  for (const [name, item] of watchers) {
    assert.equal(item.optional, true, `${name} must be optional for npm ci on Linux`);
    assert.deepEqual(item.os, ['darwin']);
  }
  for (const platform of ['linux-x64', 'darwin-arm64', 'win32-x64']) {
    const item = lock.packages[`node_modules/@esbuild/${platform}`];
    assert.ok(item, `Missing frontend builder for ${platform}`);
    assert.equal(item.optional, true);
  }
});
