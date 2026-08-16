/**
 * YamlSessionDatastore — the snapshot manifest lives in media, not in data/.
 *
 * `snapshots.captures` is an index of webcam frames that already live under
 * media/apps/fitness/sessions/{date}/{id}/screenshots. Kept inline it dwarfs the
 * session it belongs to: one measured 2026-07-20 session was 294 lines of actual
 * history and 90,849 lines of manifest — 99.7% of a 3.2 MB file, in the tree that
 * is supposed to stay light enough to commit.
 *
 * So the manifest is written beside the frames it indexes and rehydrated on read.
 * Reads still accept an inline manifest, because every session written before this
 * has one and those files are not rewritten until they are migrated.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { YamlSessionDatastore } from '#adapters/persistence/yaml/YamlSessionDatastore.mjs';
import { saveYaml, loadYamlSafe } from '#system/utils/FileIO.mjs';

const DATE = '2026-07-20';
const ID = '20260720063117';

const captures = (n) => Array.from({ length: n }, (_, i) => ({
  index: i,
  filename: `${DATE}_player_${String(i).padStart(4, '0')}.jpg`,
  timestamp: 1784553357507 + i,
  role: 'player',
}));

const sessionWith = (snapshots) => ({
  sessionId: ID,
  timezone: 'UTC',
  session: { start: '2026-07-20T06:31:17Z' },
  participants: {},
  summary: {},
  timeline: { series: {}, events: [] },
  ...(snapshots ? { snapshots } : {}),
});

describe('YamlSessionDatastore — snapshot manifest placement', () => {
  let store; let tmpDir; let mediaRoot;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-snap-test-'));
    mediaRoot = path.join(tmpDir, 'media');
    store = new YamlSessionDatastore({
      configService: { getHouseholdPath: (p) => path.join(tmpDir, p) },
      mediaRoot,
    });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('keeps the manifest out of the session file in data/', async () => {
    await store.save(sessionWith({ updatedAt: 123, captures: captures(50) }));
    const paths = store.getStoragePaths(ID);
    const onDisk = loadYamlSafe(paths.sessionFilePath);

    expect(onDisk.snapshots).toBeUndefined();
    expect(onDisk.sessionId).toBe(ID);   // the history itself is untouched
    expect(onDisk.timeline).toBeDefined();
  });

  it('writes the manifest beside the frames it indexes', async () => {
    await store.save(sessionWith({ updatedAt: 123, captures: captures(3) }));
    const paths = store.getStoragePaths(ID);

    expect(paths.snapshotsFilePath).toBe(
      path.join(mediaRoot, 'apps', 'fitness', 'sessions', DATE, ID, 'snapshots')
    );
    const sidecar = loadYamlSafe(paths.snapshotsFilePath);
    expect(sidecar.captures).toHaveLength(3);
    expect(sidecar.updatedAt).toBe(123);
  });

  it('rehydrates the manifest on read, so consumers see no difference', async () => {
    await store.save(sessionWith({ updatedAt: 123, captures: captures(4) }));
    const loaded = await store.findById(ID);
    expect(loaded.snapshots.captures).toHaveLength(4);
    expect(loaded.snapshots.updatedAt).toBe(123);
  });

  // Every session written before this change carries its manifest inline.
  it('still reads an inline manifest from an unmigrated session', async () => {
    const paths = store.getStoragePaths(ID);
    fs.mkdirSync(paths.sessionsDir, { recursive: true });
    saveYaml(paths.sessionFilePath, sessionWith({ updatedAt: 9, captures: captures(2) }));

    const loaded = await store.findById(ID);
    expect(loaded.snapshots.captures).toHaveLength(2);
    expect(loaded.snapshots.updatedAt).toBe(9);
  });

  it('prefers the inline manifest when a session somehow has both', async () => {
    await store.save(sessionWith({ updatedAt: 1, captures: captures(1) }));
    const paths = store.getStoragePaths(ID);
    const data = loadYamlSafe(paths.sessionFilePath);
    data.snapshots = { updatedAt: 2, captures: captures(7) };
    saveYaml(paths.sessionFilePath, data);

    const loaded = await store.findById(ID);
    expect(loaded.snapshots.captures).toHaveLength(7);
  });

  // Session.toJSON emits `snapshots` when captures is empty but updatedAt is set
  // (a recap that ran and found nothing). The split must use the same predicate or
  // that state is silently lost.
  it('persists a manifest that has updatedAt but no captures', async () => {
    await store.save(sessionWith({ updatedAt: 456, captures: [] }));
    const loaded = await store.findById(ID);
    expect(loaded.snapshots.updatedAt).toBe(456);
  });

  it('leaves a session with no captures alone', async () => {
    await store.save(sessionWith(null));
    const paths = store.getStoragePaths(ID);
    expect(loadYamlSafe(paths.sessionFilePath).snapshots).toBeUndefined();
    expect(fs.existsSync(`${paths.snapshotsFilePath}.yml`)).toBe(false);

    const loaded = await store.findById(ID);
    expect(loaded.snapshots?.captures ?? []).toEqual([]);
  });
});
