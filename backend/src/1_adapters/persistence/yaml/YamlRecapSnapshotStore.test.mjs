import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlRecapSnapshotStore } from './YamlRecapSnapshotStore.mjs';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  const screenshotsDir = path.join(root, 'screenshots');
  fs.mkdirSync(screenshotsDir);
  ['0000', '0001', '0002'].forEach((i, n) =>
    fs.writeFileSync(path.join(screenshotsDir, `2026-06-12_${i}.jpg`), Buffer.from([0xff, 0xd8, n])));
  const datastore = {
    getStoragePaths: () => ({ screenshotsDir }),
    findById: async () => ({ snapshots: { captures: [
      { index: 1, filename: '2026-06-12_0001.jpg', path: `${screenshotsDir}/2026-06-12_0001.jpg`, timestamp: 2 },
      { index: 0, filename: '2026-06-12_0000.jpg', path: `${screenshotsDir}/2026-06-12_0000.jpg`, timestamp: 1 }
    ] } })
  };
  return { root, screenshotsDir, datastore };
}

const silent = { debug() {}, warn() {} };

test('listCaptures returns captures in timestamp order with absolute paths', async () => {
  const { datastore, screenshotsDir } = setup();
  const store = new YamlRecapSnapshotStore({ sessionDatastore: datastore, fileIO: fs, logger: silent });
  const caps = await store.listCaptures('S1', 'h');
  assert.equal(caps.length, 2);
  assert.equal(caps[0].index, 0); // sorted by timestamp ascending
  assert.equal(caps[1].index, 1);
  assert.ok(caps[0].absolutePath.startsWith(screenshotsDir));
});

test('readCapture returns the file buffer', async () => {
  const { datastore } = setup();
  const store = new YamlRecapSnapshotStore({ sessionDatastore: datastore, fileIO: fs, logger: silent });
  const caps = await store.listCaptures('S1', 'h');
  const buf = await store.readCapture(caps[0].absolutePath);
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xd8);
});

test('cleanup deletes the screenshots dir when not archiving', async () => {
  const { datastore, screenshotsDir } = setup();
  const store = new YamlRecapSnapshotStore({ sessionDatastore: datastore, fileIO: fs, logger: silent });
  await store.cleanup('S1', 'h', { archive: false });
  assert.equal(fs.existsSync(screenshotsDir), false);
});

test('cleanup archives instead of deletes when archive:true', async () => {
  const { datastore, screenshotsDir, root } = setup();
  const store = new YamlRecapSnapshotStore({ sessionDatastore: datastore, fileIO: fs, logger: silent });
  await store.cleanup('S1', 'h', { archive: true });
  assert.equal(fs.existsSync(screenshotsDir), false);
  assert.equal(fs.existsSync(path.join(root, 'screenshots_archive')), true);
});

function setupTrash() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  const screenshotsDir = path.join(root, 'sessions', '2026-06-12', '20260612090000', 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });
  ['0000', '0001'].forEach((i, n) =>
    fs.writeFileSync(path.join(screenshotsDir, `2026-06-12_${i}.jpg`), Buffer.from([0xff, 0xd8, n])));
  const trashDir = path.join(root, '_trash', '2026-06-12', '20260612090000');
  const datastore = { getStoragePaths: () => ({ screenshotsDir, trashDir }) };
  return { root, screenshotsDir, trashDir, datastore };
}

test('moveToTrash relocates the frames into _trash (does NOT hard-delete)', async () => {
  const { datastore, screenshotsDir, trashDir } = setupTrash();
  const store = new YamlRecapSnapshotStore({ sessionDatastore: datastore, fileIO: fs, logger: silent });
  const now = Date.UTC(2026, 5, 12, 9, 30, 0);
  const dest = await store.moveToTrash('S1', 'h', { now });
  // Source gone, frames preserved under _trash
  assert.equal(fs.existsSync(screenshotsDir), false);
  assert.equal(fs.existsSync(path.join(trashDir, 'screenshots', '2026-06-12_0000.jpg')), true);
  assert.equal(fs.existsSync(path.join(trashDir, 'screenshots', '2026-06-12_0001.jpg')), true);
  assert.ok(dest.startsWith(trashDir));
  // The trash entry's mtime is stamped to the trash time (drives 7-day retention)
  assert.equal(Math.round(fs.statSync(trashDir).mtimeMs), now);
});

test('moveToTrash is a no-op when there are no frames to move', async () => {
  const { datastore, screenshotsDir } = setupTrash();
  fs.rmSync(screenshotsDir, { recursive: true, force: true });
  const store = new YamlRecapSnapshotStore({ sessionDatastore: datastore, fileIO: fs, logger: silent });
  const dest = await store.moveToTrash('S1', 'h', { now: Date.now() });
  assert.equal(dest, null);
});

test('moveToTrash overwrites a stale prior trash entry for the same session', async () => {
  const { datastore, trashDir } = setupTrash();
  // a leftover trash entry from a previous run
  fs.mkdirSync(path.join(trashDir, 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(trashDir, 'screenshots', 'OLD.jpg'), Buffer.from([0]));
  const store = new YamlRecapSnapshotStore({ sessionDatastore: datastore, fileIO: fs, logger: silent });
  await store.moveToTrash('S1', 'h', { now: Date.now() });
  assert.equal(fs.existsSync(path.join(trashDir, 'screenshots', 'OLD.jpg')), false);
  assert.equal(fs.existsSync(path.join(trashDir, 'screenshots', '2026-06-12_0000.jpg')), true);
});
