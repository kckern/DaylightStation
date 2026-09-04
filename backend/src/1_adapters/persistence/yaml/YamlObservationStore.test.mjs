import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { YamlObservationStore } from './YamlObservationStore.mjs';

// Temp-dir pattern lifted from YamlNutriListDatastore.newfields.test.mjs (Task 0.2):
// a stub dataService whose `user.resolveDir` returns paths inside an mkdtemp'd
// directory, so every test gets a clean, isolated filesystem.

let dir, store, filePath, warnLog;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'observation-store-'));
  warnLog = [];
  store = new YamlObservationStore({
    dataService: { user: { resolveDir: (rel, userId) => path.join(dir, userId, rel) } },
    logger: { error: () => {}, warn: (event, data) => warnLog.push({ event, data }) },
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

describe('YamlObservationStore.updateMany (all-or-nothing batch)', () => {
  it('applies a set of per-id patches in one write', () => {
    const w = store.append('u1', { kind: 'weight', value: 214, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 18:00:00' });
    const d = store.append('u1', { kind: 'density', value: 4, scaleId: 'kitchen-1', at: '2026-09-02 18:00:05' });
    const c = store.append('u1', { kind: 'container', value: 'bowl', scaleId: 'kitchen-1', at: '2026-09-02 18:00:10' });

    const updated = store.updateMany('u1', [
      { id: w.id, status: 'consumed', pairedEntryUuid: 'entry-1' },
      { id: d.id, status: 'consumed', pairedEntryUuid: 'entry-1' },
      { id: c.id, status: 'consumed', pairedEntryUuid: 'entry-1' },
    ]);

    expect(updated).toHaveLength(3);
    expect(updated.every((r) => r.status === 'consumed' && r.pairedEntryUuid === 'entry-1')).toBe(true);

    const rows = store.listByDate('u1', '2026-09-02');
    expect(rows.every((r) => r.status === 'consumed' && r.pairedEntryUuid === 'entry-1')).toBe(true);
  });

  it('is all-or-nothing: one missing id rejects the WHOLE batch and writes nothing', () => {
    const w = store.append('u1', { kind: 'weight', value: 100, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 18:00:00' });
    const d = store.append('u1', { kind: 'density', value: 4, scaleId: 'kitchen-1', at: '2026-09-02 18:00:05' });

    let caught = null;
    try {
      store.updateMany('u1', [
        { id: w.id, status: 'consumed', pairedEntryUuid: 'entry-1' },
        { id: 'does-not-exist', status: 'consumed', pairedEntryUuid: 'entry-1' },
        { id: d.id, status: 'consumed', pairedEntryUuid: 'entry-1' },
      ]);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe('NOT_FOUND');
    expect(caught.context.ids).toEqual(['does-not-exist']);

    // Neither w NOR d was touched — not even the ones that existed.
    const rows = store.listByDate('u1', '2026-09-02');
    expect(rows.every((r) => r.status === 'open' && r.pairedEntryUuid === null)).toBe(true);
  });

  it('rejects a duplicate id within one batch before writing anything', () => {
    const w = store.append('u1', { kind: 'weight', value: 100, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 18:00:00' });
    expect(() => store.updateMany('u1', [
      { id: w.id, status: 'consumed' },
      { id: w.id, status: 'dismissed' },
    ])).toThrow(/DUPLICATE_PATCH_ID|more than once/);
    expect(store.listByDate('u1', '2026-09-02')[0].status).toBe('open');
  });

  it('rejects an invalid patch entry in the batch before writing anything', () => {
    const w = store.append('u1', { kind: 'weight', value: 100, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 18:00:00' });
    const d = store.append('u1', { kind: 'density', value: 4, scaleId: 'kitchen-1', at: '2026-09-02 18:00:05' });
    expect(() => store.updateMany('u1', [
      { id: w.id, status: 'consumed' },
      { id: d.id, status: 'archived' }, // invalid status
    ])).toThrow(/status must be one of/);
    const rows = store.listByDate('u1', '2026-09-02');
    expect(rows.every((r) => r.status === 'open')).toBe(true);
  });

  it('an empty batch is a no-op', () => {
    expect(store.updateMany('u1', [])).toEqual([]);
  });
});

describe('YamlObservationStore.findByPairedEntry', () => {
  it('finds every observation currently paired to an entry (weight + density + container)', () => {
    const w = store.append('u1', { kind: 'weight', value: 100, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 18:00:00' });
    const d = store.append('u1', { kind: 'density', value: 4, scaleId: 'kitchen-1', at: '2026-09-02 18:00:05' });
    store.append('u1', { kind: 'container', value: 'bowl', scaleId: 'kitchen-1', at: '2026-09-02 18:00:10' }); // stays open, not paired

    store.updateMany('u1', [
      { id: w.id, status: 'consumed', pairedEntryUuid: 'entry-9' },
      { id: d.id, status: 'consumed', pairedEntryUuid: 'entry-9' },
    ]);

    const found = store.findByPairedEntry('u1', 'entry-9');
    expect(found.map((r) => r.id).sort()).toEqual([w.id, d.id].sort());
  });

  it('is not date-scoped: a pairing from a different date than the entry still surfaces', () => {
    const yesterday = store.append('u1', { kind: 'container', value: 'bowl', scaleId: 'kitchen-1', at: '2026-09-01 23:59:00' });
    store.update('u1', yesterday.id, { status: 'consumed', pairedEntryUuid: 'entry-cross-midnight' });

    const found = store.findByPairedEntry('u1', 'entry-cross-midnight');
    expect(found.map((r) => r.id)).toEqual([yesterday.id]);
  });

  it('returns [] when nothing is paired, including for a user with no observations at all', () => {
    expect(store.findByPairedEntry('fresh-user', 'entry-1')).toEqual([]);
    const w = store.append('u1', { kind: 'weight', value: 1, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 18:00:00' });
    expect(store.findByPairedEntry('u1', 'nobody-points-here')).toEqual([]);
    expect(w.pairedEntryUuid).toBeNull();
  });
});

describe('YamlObservationStore malformed INDIVIDUAL record (rest of the day still reads)', () => {
  it('skips a garbage row with a matching date instead of returning it or throwing', () => {
    const good = store.append('u1', { kind: 'weight', value: 100, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 08:00:00' });

    // Hand-corrupt the file: inject a row with a VALID date (so it would pass the date
    // filter) but missing/garbage everything else — no `kind`, no `at`, wrong `status`.
    const raw = yaml.load(fs.readFileSync(filePath('u1'), 'utf8'));
    raw.push({ id: 'garbage-row', date: '2026-09-02', status: 'not-a-real-status' });
    fs.writeFileSync(filePath('u1'), yaml.dump(raw), 'utf8');

    const rows = store.listByDate('u1', '2026-09-02');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(good.id);
    expect(rows.find((r) => r.id === 'garbage-row')).toBeUndefined();

    // It was logged, not silently dropped from awareness.
    expect(warnLog.some((w) => w.event === 'observationStore.read.invalidRecordSkipped' && w.data.id === 'garbage-row')).toBe(true);
  });

  it('does not throw for one bad row — the rest of the day still reads', () => {
    store.append('u1', { kind: 'weight', value: 1, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 08:00:00' });
    const raw = yaml.load(fs.readFileSync(filePath('u1'), 'utf8'));
    raw.push({ garbage: true });
    fs.writeFileSync(filePath('u1'), yaml.dump(raw), 'utf8');

    expect(() => store.listByDate('u1', '2026-09-02')).not.toThrow();
    expect(() => store.openForScale('u1', 'kitchen-1')).not.toThrow();
  });

  it('the malformed row is preserved on disk (not silently dropped) after an unrelated write', () => {
    store.append('u1', { kind: 'weight', value: 1, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 08:00:00' });
    const raw = yaml.load(fs.readFileSync(filePath('u1'), 'utf8'));
    raw.push({ id: 'garbage-row', date: '2026-09-02' });
    fs.writeFileSync(filePath('u1'), yaml.dump(raw), 'utf8');

    // An unrelated append does a read-modify-write; the garbage row must survive it,
    // since #readAll (used for writes) is never filtered — only #readAllValid (used for
    // reads returned to callers) drops it.
    store.append('u1', { kind: 'weight', value: 2, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 09:00:00' });

    const onDisk = yaml.load(fs.readFileSync(filePath('u1'), 'utf8'));
    expect(onDisk.some((r) => r.id === 'garbage-row')).toBe(true);
  });
});

describe('YamlObservationStore.get (read-only bare-id lookup)', () => {
  it('returns a full record by id', () => {
    const saved = store.append('u1', { kind: 'weight', value: 214, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 18:04:12' });
    expect(store.get('u1', saved.id)).toEqual(saved);
  });

  it('throws NOT_FOUND for an unknown id', () => {
    let caught = null;
    try {
      store.get('u1', 'does-not-exist');
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe('NOT_FOUND');
    expect(caught.name).toBe('InfrastructureError');
  });

  it('does NOT write to disk — no write/rename syscall happens, and the file is byte-identical', () => {
    const saved = store.append('u1', { kind: 'weight', value: 100, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 08:00:00' });
    const before = fs.readFileSync(filePath('u1'), 'utf8');

    // Content staying byte-identical is necessary but NOT sufficient (a spurious
    // write-back of the unmodified array would also be byte-identical), so this
    // asserts on the actual write/rename syscalls directly.
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    const renameSpy = vi.spyOn(fs, 'renameSync');

    store.get('u1', saved.id);
    // Also exercise the not-found path — a failed lookup must not write either.
    try { store.get('u1', 'nope'); } catch { /* expected */ }

    expect(writeSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
    renameSpy.mockRestore();

    const after = fs.readFileSync(filePath('u1'), 'utf8');
    expect(after).toBe(before);
  });

  it('skips a malformed row the same way other read paths do (finds the good one, ignores garbage)', () => {
    const good = store.append('u1', { kind: 'weight', value: 1, unit: 'g', scaleId: 'kitchen-1', at: '2026-09-02 08:00:00' });
    const raw = yaml.load(fs.readFileSync(filePath('u1'), 'utf8'));
    raw.push({ id: 'garbage-row', date: '2026-09-02' }); // missing kind/at/status
    fs.writeFileSync(filePath('u1'), yaml.dump(raw), 'utf8');

    expect(store.get('u1', good.id)).toMatchObject({ id: good.id });
    let caught = null;
    try {
      store.get('u1', 'garbage-row');
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe('NOT_FOUND'); // treated as absent, not returned as-is
  });

  it('finds a record regardless of date — not accidentally day-scoped', () => {
    const yesterday = store.append('u1', { kind: 'container', value: 'bowl', scaleId: 'kitchen-1', at: '2026-08-15 09:00:00' });
    expect(store.get('u1', yesterday.id).id).toBe(yesterday.id);
  });

  it('a missing file throws NOT_FOUND (not a crash) for a bare-id lookup on a fresh user', () => {
    let caught = null;
    try {
      store.get('fresh-user', 'anything');
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe('NOT_FOUND');
  });
});

// ===========================================================================
// Hot file + monthly archives.
//
// This store sits on a hardware frame path — `ObservationService.setWeight` reads,
// appends and re-reads on every qualifying placement — so an unbounded file is a
// latency bug, not merely untidy. Archiving is RELOCATION: the no-deletion contract
// stands, and every read path still finds an archived row.
// ===========================================================================

/** Seed the hot file directly with n resolved rows, one an hour apart from `start`. */
function seedResolved(store, userId, n, start = Date.UTC(2026, 0, 1, 8, 0, 0)) {
  const ids = [];
  for (let i = 0; i < n; i += 1) {
    const at = new Date(start + i * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
    const row = store.append(userId, { kind: 'weight', value: 100 + i, unit: 'g', scaleId: 'kitchen-1', at });
    ids.push(row.id);
  }
  // Resolve them all so they become archive-eligible.
  store.updateMany(userId, ids.map((id) => ({ id, status: 'consumed', pairedEntryUuid: 'e1' })));
  return ids;
}

describe('YamlObservationStore archiving', () => {
  it('leaves a small file entirely hot — no archive directory at all', () => {
    seedResolved(store, 'u1', 40);
    expect(fs.existsSync(path.join(dir, 'u1', 'lifelog/nutrition/archives/observations'))).toBe(false);
  });

  it('rolls resolved, aged rows into a per-month archive once the hot file is big enough', () => {
    seedResolved(store, 'u1', 300);
    // The roll fires on the NEXT append.
    store.append('u1', { kind: 'weight', value: 999, unit: 'g', scaleId: 'kitchen-1', at: '2026-01-20 12:00:00' });

    const hot = yaml.load(fs.readFileSync(filePath('u1'), 'utf8'));
    expect(hot.length).toBeLessThan(300);
    const archiveDir = path.join(dir, 'u1', 'lifelog/nutrition/archives/observations');
    expect(fs.existsSync(archiveDir)).toBe(true);
    expect(fs.readdirSync(archiveDir)).toContain('2026-01.yml');
  });

  it('NEVER archives an open row, however old — openForScale stays correct from the hot file alone', () => {
    const stale = store.append('u1', { kind: 'density', value: 4, scaleId: 'kitchen-1', at: '2026-01-01 08:00:00' });
    seedResolved(store, 'u1', 300, Date.UTC(2026, 0, 1, 9, 0, 0));
    store.append('u1', { kind: 'weight', value: 999, unit: 'g', scaleId: 'kitchen-1', at: '2026-01-20 12:00:00' });

    const hot = yaml.load(fs.readFileSync(filePath('u1'), 'utf8'));
    expect(hot.some((r) => r.id === stale.id)).toBe(true);
    expect(store.openForScale('u1', 'kitchen-1').map((r) => r.id)).toContain(stale.id);
  });

  it('an archived row is still found by listByDate, get and findByPairedEntry', () => {
    const ids = seedResolved(store, 'u1', 300);
    store.append('u1', { kind: 'weight', value: 999, unit: 'g', scaleId: 'kitchen-1', at: '2026-01-20 12:00:00' });

    const first = ids[0];
    const hot = yaml.load(fs.readFileSync(filePath('u1'), 'utf8'));
    expect(hot.some((r) => r.id === first)).toBe(false);   // it really did leave the hot file

    expect(store.get('u1', first).id).toBe(first);
    expect(store.listByDate('u1', '2026-01-01').map((r) => r.id)).toContain(first);
    expect(store.findByPairedEntry('u1', 'e1').map((r) => r.id)).toContain(first);
  });

  it('an archived row can still be patched by update and by updateMany', () => {
    const ids = seedResolved(store, 'u1', 300);
    store.append('u1', { kind: 'weight', value: 999, unit: 'g', scaleId: 'kitchen-1', at: '2026-01-20 12:00:00' });

    const updated = store.update('u1', ids[0], { status: 'open', pairedEntryUuid: null });
    expect(updated).toMatchObject({ id: ids[0], status: 'open', pairedEntryUuid: null });
    expect(store.get('u1', ids[0]).status).toBe('open');

    const batch = store.updateMany('u1', [{ id: ids[1], pairedEntryUuid: 'e2' }, { id: ids[2], pairedEntryUuid: 'e2' }]);
    expect(batch.map((r) => r.pairedEntryUuid)).toEqual(['e2', 'e2']);
    expect(store.findByPairedEntry('u1', 'e2')).toHaveLength(2);
  });

  // A batch spanning the hot file and an archive has TWO atomic renames and no rollback
  // between them: the reviewer built exactly this, made the archive directory unwritable,
  // and watched the hot row land anyway while the archived row kept its old pairing.
  // The store now refuses such a batch before writing a byte.
  it('updateMany REFUSES a batch spanning the hot file and an archive, and writes nothing', () => {
    const ids = seedResolved(store, 'u1', 300);
    const hot = store.append('u1', { kind: 'weight', value: 999, unit: 'g', scaleId: 'kitchen-1', at: '2026-01-20 12:00:00' });
    const archivedId = ids.find((id) => !yaml.load(fs.readFileSync(filePath('u1'), 'utf8')).some((r) => r.id === id));
    expect(archivedId).toBeTruthy();

    let caught = null;
    try {
      store.updateMany('u1', [
        { id: archivedId, pairedEntryUuid: 'e-new' },
        { id: hot.id, pairedEntryUuid: 'e-new' },
      ]);
    } catch (err) { caught = err; }

    expect(caught?.code).toBe('CROSS_FILE_BATCH');
    expect(store.get('u1', archivedId).pairedEntryUuid).toBe('e1');
    expect(store.get('u1', hot.id).pairedEntryUuid).toBeNull();
    expect(store.findByPairedEntry('u1', 'e-new')).toHaveLength(0);
  });

  it('updateMany still refuses the whole batch when an id exists nowhere', () => {
    const ids = seedResolved(store, 'u1', 300);
    store.append('u1', { kind: 'weight', value: 999, unit: 'g', scaleId: 'kitchen-1', at: '2026-01-20 12:00:00' });
    let caught = null;
    try {
      store.updateMany('u1', [{ id: ids[0], pairedEntryUuid: 'x' }, { id: 'nope', pairedEntryUuid: 'x' }]);
    } catch (err) { caught = err; }
    expect(caught?.code).toBe('NOT_FOUND');
    expect(store.get('u1', ids[0]).pairedEntryUuid).toBe('e1');   // untouched
  });

  it('bounds the hot file no matter how much history accumulates', () => {
    seedResolved(store, 'u1', 300);
    store.append('u1', { kind: 'weight', value: 1, unit: 'g', scaleId: 'kitchen-1', at: '2026-01-20 12:00:00' });
    const afterFirst = yaml.load(fs.readFileSync(filePath('u1'), 'utf8')).length;
    seedResolved(store, 'u1', 300, Date.UTC(2026, 1, 1, 8, 0, 0));
    store.append('u1', { kind: 'weight', value: 2, unit: 'g', scaleId: 'kitchen-1', at: '2026-02-20 12:00:00' });
    const afterSecond = yaml.load(fs.readFileSync(filePath('u1'), 'utf8')).length;

    expect(afterFirst).toBeLessThanOrEqual(300);
    expect(afterSecond).toBeLessThanOrEqual(300);
    // …and nothing was lost: every row is still reachable.
    expect(store.findByPairedEntry('u1', 'e1')).toHaveLength(600);
  });
});
