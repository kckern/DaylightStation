// Explicit preparation runner only; intentionally outside default test globs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
const allowed = process.env.PRE_RUN_ROOT;
const denied = process.env.PRE_DENIED_ROOT;
assert.ok(allowed && denied && allowed !== denied);
test('CASE-ISO-WRITE-ALLOW synthetic root is writable', () => {
  const p = path.join(allowed, 'positive.txt');
  fs.writeFileSync(p, 'synthetic');
  assert.equal(fs.readFileSync(p, 'utf8'), 'synthetic');
});
test('CASE-ISO-WRITE-DENY outside-root write rejected', () => {
  assert.throws(() => fs.writeFileSync(path.join(denied, 'should-not-exist.txt'), 'no'), e => ['EPERM', 'EACCES'].includes(e.code));
});
test('CASE-ISO-READ-DENY private fallback simulated by inaccessible synthetic root', () => {
  assert.throws(() => fs.readFileSync(path.join(denied, 'sentinel.txt')), e => ['EPERM', 'EACCES'].includes(e.code));
});
test('CASE-ISO-SYMLINK escape rejected', () => {
  const link = path.join(allowed, 'escape');
  fs.symlinkSync(denied, link);
  assert.throws(() => fs.writeFileSync(path.join(link, 'escape.txt'), 'no'), e => ['EPERM', 'EACCES'].includes(e.code));
});
test('CASE-ISO-PROCESS child process rejected', () => {
  const r = spawnSync('/usr/bin/true');
  assert.equal(r.error?.code, 'EPERM');
});
test('CASE-ISO-DEVICE device read rejected', () => {
  assert.throws(() => fs.openSync('/dev/tty', 'r'), e => ['EPERM', 'EACCES'].includes(e.code));
});
test('CASE-ISO-NETWORK live-server connection rejected before connecting', async () => {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: '127.0.0.1',
      port: 9
    });
    socket.on('connect', () => {
      socket.destroy();
      reject(new Error('Network unexpectedly allowed'));
    });
    socket.on('error', error => {
      try {
        assert.ok(['EPERM', 'EACCES'].includes(error.code), error.code);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
});
test('CASE-ISO-ENV real data environment absent before imports', () => {
  assert.equal(process.env.DAYLIGHT_BASE_PATH, undefined);
  assert.equal(process.env.DAYLIGHT_DATA_PATH, undefined);
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.TMPDIR, allowed);
});
