import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TrashRetentionSweep, SESSION_TRASH_RETENTION_MS } from './TrashRetentionSweep.mjs';

const DAY = 24 * 60 * 60 * 1000;
const silent = { info() {}, warn() {}, debug() {} };

function mkEntry(trashDir, date, id, ageMs, now) {
  const dir = path.join(trashDir, date, id, 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'f.jpg'), Buffer.from([0xff]));
  const t = new Date(now - ageMs);
  // stamp the <id> dir (what retention measures)
  fs.utimesSync(path.join(trashDir, date, id), t, t);
  return path.join(trashDir, date, id);
}

function setup() {
  const media = fs.mkdtempSync(path.join(os.tmpdir(), 'trash-'));
  const trashDir = path.join(media, 'apps', 'fitness', '_trash');
  fs.mkdirSync(trashDir, { recursive: true });
  const sweep = new TrashRetentionSweep({ trashDir, fileIO: fs, logger: silent });
  return { media, trashDir, sweep };
}

test('retention default is 7 days', () => {
  assert.equal(SESSION_TRASH_RETENTION_MS, 7 * DAY);
});

test('hard-deletes a trash entry older than 7 days', async () => {
  const { trashDir, sweep } = setup();
  const now = Date.now();
  const old = mkEntry(trashDir, '2026-06-01', '20260601090000', 8 * DAY, now);
  const stats = await sweep.run({ now });
  assert.equal(fs.existsSync(old), false);
  assert.equal(stats.deleted, 1);
});

test('keeps a trash entry younger than 7 days', async () => {
  const { trashDir, sweep } = setup();
  const now = Date.now();
  const fresh = mkEntry(trashDir, '2026-06-19', '20260619090000', 2 * DAY, now);
  const stats = await sweep.run({ now });
  assert.equal(fs.existsSync(fresh), true);
  assert.equal(stats.deleted, 0);
  assert.equal(stats.kept, 1);
});

test('prunes a date dir once its last entry is deleted', async () => {
  const { trashDir, sweep } = setup();
  const now = Date.now();
  mkEntry(trashDir, '2026-06-01', '20260601090000', 8 * DAY, now);
  await sweep.run({ now });
  assert.equal(fs.existsSync(path.join(trashDir, '2026-06-01')), false);
});

test('only ever touches _trash — a sibling sessions tree is never reached', async () => {
  const { media, trashDir, sweep } = setup();
  const now = Date.now();
  // a live session media dir next to _trash, with old mtime — must NOT be touched
  const liveSession = path.join(media, 'apps', 'fitness', 'sessions', '2026-06-01', '20260601090000', 'screenshots');
  fs.mkdirSync(liveSession, { recursive: true });
  fs.writeFileSync(path.join(liveSession, 'real.jpg'), Buffer.from([0xff]));
  const t = new Date(now - 30 * DAY);
  fs.utimesSync(path.join(media, 'apps', 'fitness', 'sessions', '2026-06-01', '20260601090000'), t, t);
  mkEntry(trashDir, '2026-06-01', '20260601100000', 8 * DAY, now);

  await sweep.run({ now });
  assert.equal(fs.existsSync(path.join(liveSession, 'real.jpg')), true); // untouched
});

test('missing trash dir is a clean no-op', async () => {
  const media = fs.mkdtempSync(path.join(os.tmpdir(), 'trash-'));
  const sweep = new TrashRetentionSweep({ trashDir: path.join(media, 'nope', '_trash'), fileIO: fs, logger: silent });
  const stats = await sweep.run({ now: Date.now() });
  assert.equal(stats.deleted, 0);
  assert.equal(stats.kept, 0);
});

test('mixed batch: old deleted, fresh kept, in the same date dir', async () => {
  const { trashDir, sweep } = setup();
  const now = Date.now();
  const old = mkEntry(trashDir, '2026-06-10', '20260610090000', 10 * DAY, now);
  const fresh = mkEntry(trashDir, '2026-06-10', '20260610200000', 1 * DAY, now);
  const stats = await sweep.run({ now });
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(fresh), true);
  assert.equal(stats.deleted, 1);
  assert.equal(stats.kept, 1);
  assert.equal(fs.existsSync(path.join(trashDir, '2026-06-10')), true); // date kept (fresh remains)
});
