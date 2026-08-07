/**
 * Disk snapshot of the compiled material index (material-cache mini-wave).
 * Cache posture: corrupt reads are LOUD but writes may overwrite — every byte
 * is regenerable, so refusing (the record-store posture) would just wedge it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { YamlMaterialSnapshotStore } from './YamlMaterialSnapshotStore.mjs';

let tmp;
let warns;

const makeStore = () => new YamlMaterialSnapshotStore({
  configService: { getHouseholdPath: (rel) => path.join(tmp, rel) },
  logger: { warn: (event, data) => warns.push({ event, data }), info: () => {} },
});

const snapshotFile = () => path.join(tmp, 'apps/school/cache/materials.yml');

const full = {
  id: 'plex-123', title: 'Shakespeare Tales', unitCount: 2,
  units: [{ id: 'u1', index: 1, title: 'Play one', durationMs: 100, group: null }],
  trackParents: new Map([['t1', 'u1'], ['t2', 'u1']]),
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'material-snapshot-'));
  warns = [];
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('YamlMaterialSnapshotStore', () => {
  it('round-trips a material through disk, reviving trackParents to a Map', () => {
    const at = Date.parse('2026-08-07T10:00:00Z');
    const store = makeStore();
    store.put('plex-123', full, at);
    store.flush();
    expect(fs.existsSync(snapshotFile())).toBe(true);

    const loaded = makeStore().load();
    expect(loaded.size).toBe(1);
    const entry = loaded.get('plex-123');
    expect(entry.at).toBe(at);
    expect(entry.full.units).toEqual(full.units);
    expect(entry.full.trackParents).toBeInstanceOf(Map);
    expect([...entry.full.trackParents.entries()]).toEqual([['t1', 'u1'], ['t2', 'u1']]);
  });

  it('a material without trackParents round-trips without gaining one', () => {
    const { trackParents, ...flat } = full;
    const store = makeStore();
    store.put('plex-9', flat, Date.now());
    store.flush();
    const entry = makeStore().load().get('plex-9');
    expect('trackParents' in entry.full).toBe(false);
  });

  it('missing file loads as empty, silently', () => {
    expect(makeStore().load().size).toBe(0);
    expect(warns).toEqual([]);
  });

  it('corrupt file loads as empty with a loud warn, and the next flush overwrites it', () => {
    fs.mkdirSync(path.dirname(snapshotFile()), { recursive: true });
    fs.writeFileSync(snapshotFile(), '{{{{ not yaml', 'utf8');
    const store = makeStore();
    expect(store.load().size).toBe(0);
    expect(warns.map((w) => w.event)).toContain('school.material.snapshot-corrupt');

    store.put('plex-123', full, Date.now());
    store.flush();
    expect(makeStore().load().size).toBe(1); // cache posture: rebuild IS the repair
  });

  it('one malformed row is skipped without spoiling the rest', () => {
    const store = makeStore();
    store.put('good', full, Date.parse('2026-08-07T10:00:00Z'));
    store.flush();
    const raw = fs.readFileSync(snapshotFile(), 'utf8');
    fs.writeFileSync(snapshotFile(), `${raw}bad:\n  fetchedAt: not-a-date\n  full: {id: x}\nworse: 7\n`, 'utf8');
    const loaded = makeStore().load();
    expect([...loaded.keys()]).toEqual(['good']);
  });

  it('debounces: puts coalesce into one deferred write', () => {
    vi.useFakeTimers();
    try {
      const store = makeStore();
      store.put('a', full, Date.now());
      store.put('b', full, Date.now());
      expect(fs.existsSync(snapshotFile())).toBe(false);
      vi.advanceTimersByTime(300);
      expect(fs.existsSync(snapshotFile())).toBe(true);
      expect(makeStore().load().size).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('put/flush never throw when the disk write fails — they warn', () => {
    const store = makeStore();
    fs.mkdirSync(path.dirname(snapshotFile()), { recursive: true });
    fs.mkdirSync(snapshotFile()); // a directory where the file goes → rename fails
    store.put('plex-123', full, Date.now());
    expect(() => store.flush()).not.toThrow();
    expect(warns.map((w) => w.event)).toContain('school.material.snapshot-write-failed');
  });
});
