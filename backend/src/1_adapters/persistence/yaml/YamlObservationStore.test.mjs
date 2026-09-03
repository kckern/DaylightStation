import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlObservationStore } from './YamlObservationStore.mjs';

// Temp-dir pattern lifted from YamlNutriListDatastore.newfields.test.mjs (Task 0.2):
// a stub dataService whose `user.resolveDir` returns paths inside an mkdtemp'd
// directory, so every test gets a clean, isolated filesystem.

let dir, store, filePath;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'observation-store-'));
  store = new YamlObservationStore({
    dataService: { user: { resolveDir: (rel, userId) => path.join(dir, userId, rel) } },
    logger: { error: () => {}, warn: () => {} },
  });
  filePath = (userId) => path.join(dir, userId, 'lifelog/nutrition/observations.yml');
});

describe('YamlObservationStore.append / listByDate', () => {
  it('round-trips every field of a weight observation', () => {
    const saved = store.append('u1', {
      kind: 'weight', value: 214, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 18:04:12',
    });

    expect(saved.id).toBeTruthy();
    expect(saved.kind).toBe('weight');
    expect(saved.value).toBe(214);
    expect(saved.unit).toBe('g');
    expect(saved.scaleId).toBe('kitchen-1');
    expect(saved.at).toBe('2026-09-02 18:04:12');
    expect(saved.date).toBe('2026-09-02');
    expect(saved.status).toBe('open');
    expect(saved.pairedEntryUuid).toBeNull();

    const rows = store.listByDate('u1', '2026-09-02');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(saved);
  });

  it('round-trips a upc/container/density observation with no unit', () => {
    const upc = store.append('u1', { kind: 'upc', value: '049000028911', scaleId: 'kitchen-1', at: '2026-09-02 18:05:00' });
    const ct = store.append('u1', { kind: 'container', value: 'bowl', scaleId: 'kitchen-1', at: '2026-09-02 18:05:10' });
    const dl = store.append('u1', { kind: 'density', value: 4, scaleId: 'kitchen-1', at: '2026-09-02 18:05:20' });

    expect(upc.unit).toBeNull();
    expect(ct.unit).toBeNull();
    expect(dl.unit).toBeNull();

    const rows = store.listByDate('u1', '2026-09-02');
    expect(rows.map((r) => r.kind)).toEqual(['upc', 'container', 'density']);
  });

  it('a missing file reads as an empty day, not an error', () => {
    expect(fs.existsSync(filePath('nobody'))).toBe(false);
    expect(store.listByDate('nobody', '2026-09-02')).toEqual([]);
    expect(store.openForScale('nobody', 'kitchen-1')).toEqual([]);
  });

  it('listByDate only returns rows for the requested date', () => {
    store.append('u1', { kind: 'weight', value: 100, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-01 09:00:00' });
    store.append('u1', { kind: 'weight', value: 200, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 09:00:00' });
    store.append('u1', { kind: 'weight', value: 300, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 10:00:00' });

    const day2 = store.listByDate('u1', '2026-09-02');
    expect(day2).toHaveLength(2);
    expect(day2.map((r) => r.value)).toEqual([200, 300]); // oldest first
    expect(store.listByDate('u1', '2026-09-01')).toHaveLength(1);
    expect(store.listByDate('u1', '2026-09-03')).toEqual([]);
  });

  it('rejects an observation with no plausible day instead of dropping or guessing one', () => {
    expect(() => store.append('u1', { kind: 'weight', value: 1, unit: 'g', scaleId: 'k1' /* no at */ }))
      .toThrow(/at must be a local timestamp/);
    expect(() => store.append('u1', { kind: 'weight', value: 1, unit: 'g', scaleId: 'k1', at: 'garbage' }))
      .toThrow(/at must be a local timestamp/);
    expect(() => store.append('u1', { kind: 'weight', value: 1, unit: 'g', scaleId: 'k1', at: '2026-09-02T18:04:12.000Z' }))
      .toThrow(/at must be a local timestamp/); // UTC ISO is explicitly the wrong shape
    // Nothing was written for any of the three rejected calls.
    expect(store.listByDate('u1', '2026-09-02')).toEqual([]);
  });

  it('rejects an unknown kind', () => {
    expect(() => store.append('u1', { kind: 'gross-weight', value: 1, scaleId: 'k1', at: '2026-09-02 18:00:00' }))
      .toThrow(/kind must be one of/);
  });
});

describe('YamlObservationStore malformed-file posture', () => {
  it('throws a typed, catchable error rather than an empty array when the file is corrupt YAML', () => {
    fs.mkdirSync(path.dirname(filePath('u1')), { recursive: true });
    fs.writeFileSync(filePath('u1'), '{ not: [valid yaml', 'utf8');

    let caught = null;
    try {
      store.listByDate('u1', '2026-09-02');
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe('CORRUPT_OBSERVATIONS_FILE');
    expect(caught.name).toBe('InfrastructureError');
  });

  it('throws the same typed error when the file parses but is not an array', () => {
    fs.mkdirSync(path.dirname(filePath('u1')), { recursive: true });
    fs.writeFileSync(filePath('u1'), 'just_a_string: true\n', 'utf8');

    expect(() => store.listByDate('u1', '2026-09-02')).toThrow(/CORRUPT_OBSERVATIONS_FILE|unexpected shape/);
    try {
      store.listByDate('u1', '2026-09-02');
    } catch (err) {
      expect(err.code).toBe('CORRUPT_OBSERVATIONS_FILE');
    }
  });

  it('an empty (zero-byte) file reads as an empty day, not corrupt', () => {
    fs.mkdirSync(path.dirname(filePath('u1')), { recursive: true });
    fs.writeFileSync(filePath('u1'), '', 'utf8');
    expect(store.listByDate('u1', '2026-09-02')).toEqual([]);
  });

  it('openForScale and append also surface the corrupt-file error rather than silently succeeding', () => {
    fs.mkdirSync(path.dirname(filePath('u1')), { recursive: true });
    fs.writeFileSync(filePath('u1'), '{ not: [valid yaml', 'utf8');

    expect(() => store.openForScale('u1', 'kitchen-1')).toThrow(/corrupt/i);
    expect(() => store.append('u1', { kind: 'weight', value: 1, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 18:00:00' }))
      .toThrow(/corrupt/i);
    try { store.openForScale('u1', 'kitchen-1'); } catch (err) { expect(err.code).toBe('CORRUPT_OBSERVATIONS_FILE'); }
    try { store.append('u1', { kind: 'weight', value: 1, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 18:00:00' }); } catch (err) { expect(err.code).toBe('CORRUPT_OBSERVATIONS_FILE'); }
  });
});

describe('YamlObservationStore.update', () => {
  it('updates status and pairing by id', () => {
    const row = store.append('u1', { kind: 'weight', value: 100, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 08:00:00' });

    const paired = store.update('u1', row.id, { status: 'consumed', pairedEntryUuid: 'entry-abc' });
    expect(paired.status).toBe('consumed');
    expect(paired.pairedEntryUuid).toBe('entry-abc');
    // Untouched fields survive the patch.
    expect(paired.value).toBe(100);
    expect(paired.at).toBe(row.at);

    const rows = store.listByDate('u1', '2026-09-02');
    expect(rows[0].status).toBe('consumed');
    expect(rows[0].pairedEntryUuid).toBe('entry-abc');
  });

  it('supports dismissing without pairing', () => {
    const row = store.append('u1', { kind: 'density', value: 3, scaleId: 'kitchen-1', at: '2026-09-02 08:00:00' });
    const dismissed = store.update('u1', row.id, { status: 'dismissed' });
    expect(dismissed.status).toBe('dismissed');
    expect(dismissed.pairedEntryUuid).toBeNull();
  });

  it('throws NOT_FOUND for an unknown id', () => {
    let caught = null;
    try {
      store.update('u1', 'does-not-exist', { status: 'consumed' });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe('NOT_FOUND');
  });

  it('rejects a patch touching a field other than status/pairedEntryUuid', () => {
    const row = store.append('u1', { kind: 'weight', value: 1, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 08:00:00' });
    expect(() => store.update('u1', row.id, { value: 999 })).toThrow(/UNKNOWN_PATCH_FIELD|may only patch/);
  });

  it('rejects an unknown status value', () => {
    const row = store.append('u1', { kind: 'weight', value: 1, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 08:00:00' });
    expect(() => store.update('u1', row.id, { status: 'archived' })).toThrow(/status must be one of/);
  });

  it('never deletes a row — dismissed observations still round-trip through listByDate', () => {
    const row = store.append('u1', { kind: 'weight', value: 1, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 08:00:00' });
    store.update('u1', row.id, { status: 'dismissed' });
    const rows = store.listByDate('u1', '2026-09-02');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('dismissed');
  });
});

describe('YamlObservationStore.openForScale', () => {
  it('finds only the still-open observations for a given scale', () => {
    const a = store.append('u1', { kind: 'weight', value: 1, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 08:00:00' });
    store.append('u1', { kind: 'weight', value: 2, unit: 'g', scaleId: 'kitchen-2', at: '2026-09-02 08:01:00' }); // other scale
    const c = store.append('u1', { kind: 'density', value: 3, scaleId: 'kitchen-1', at: '2026-09-02 08:02:00' });
    store.update('u1', a.id, { status: 'consumed' });

    const open = store.openForScale('u1', 'kitchen-1');
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(c.id);
  });

  it('is not date-scoped: an open observation from yesterday still surfaces (900s window can straddle midnight)', () => {
    const late = store.append('u1', { kind: 'container', value: 'bowl', scaleId: 'kitchen-1', at: '2026-09-01 23:59:00' });
    const open = store.openForScale('u1', 'kitchen-1');
    expect(open.map((r) => r.id)).toContain(late.id);
  });

  it('an empty/missing file reads as no open observations, not an error', () => {
    expect(store.openForScale('fresh-user', 'kitchen-1')).toEqual([]);
  });
});
