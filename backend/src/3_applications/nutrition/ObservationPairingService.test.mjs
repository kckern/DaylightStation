import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlObservationStore } from '#adapters/persistence/yaml/YamlObservationStore.mjs';
import { createObservationPairingService } from './ObservationPairingService.mjs';

// The REAL store against a temp dir, not a fake: the cross-file behaviour this task had
// to decide about is a property of the hot-file/archive split, and a hand-written double
// would prove nothing about it.

let dir, store, entriesById, service, updates;

const SCALE_CONFIG = () => ({
  containers: {
    thresholdG: 150,
    items: [
      { id: 'mug', label: 'Mug', emoji: '☕', grams: 350 },
      { id: 'small-bowl', label: 'Small bowl', emoji: '🍚', grams: 180 },
    ],
  },
  densityLevels: [
    { level: 3, label: 'Lean', emoji: '🍲', kcal_per_g: 1.0, macros: { fat_pct: 20, carb_pct: 45, protein_pct: 35 } },
    { level: 4, label: 'Mixed', emoji: '🍛', kcal_per_g: 1.4, macros: { fat_pct: 25, carb_pct: 50, protein_pct: 25 } },
  ],
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'observation-pairing-'));
  store = new YamlObservationStore({
    dataService: { user: { resolveDir: (rel, userId) => path.join(dir, userId, rel) } },
    logger: { error: () => {}, warn: () => {}, info: () => {} },
  });
  entriesById = new Map([
    ['entry-a', { uuid: 'entry-a', name: 'Soup', grams: 0, calories: 500 }],
    ['entry-b', { uuid: 'entry-b', name: 'Stew', grams: 0, calories: 400 }],
  ]);
  updates = [];
  service = createObservationPairingService({
    observationStore: store,
    entries: {
      find: async (_userId, uuid) => entriesById.get(uuid) || null,
      update: async (_userId, uuid, changes) => {
        const existing = entriesById.get(uuid);
        if (!existing) return null;
        const item = { ...existing, ...changes };
        entriesById.set(uuid, item);
        updates.push({ uuid, changes });
        return { item, changedFields: Object.keys(changes) };
      },
    },
    scaleConfig: SCALE_CONFIG,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
});

const appendWeight = (grams, at = '2026-09-02 18:04:12') =>
  store.append('u1', { kind: 'weight', value: grams, unit: 'g', scaleId: 'kitchen-1', at });

describe('ObservationPairingService.listByDate', () => {
  it('returns every observation recorded on that date, oldest first', () => {
    appendWeight(82, '2026-09-02 18:04:12');
    appendWeight(140, '2026-09-02 18:05:00');
    store.append('u1', { kind: 'density', value: 3, scaleId: 'kitchen-1', at: '2026-09-03 07:00:00' });

    const rows = service.listByDate('u1', '2026-09-02');
    expect(rows.map((r) => r.value)).toEqual([82, 140]);
    expect(rows.every((r) => r.status === 'open')).toBe(true);
  });

  it('a user with no observations reads as an empty day, not an error', () => {
    expect(service.listByDate('nobody', '2026-09-02')).toEqual([]);
  });
});

describe('ObservationPairingService.pair — recompute', () => {
  it('recomputes the entry grams from the observation, using the net-weight math', async () => {
    const obs = appendWeight(82);

    const result = await service.pair('u1', obs.id, 'entry-a');

    expect(result.observation.status).toBe('consumed');
    expect(result.observation.pairedEntryUuid).toBe('entry-a');
    expect(entriesById.get('entry-a').grams).toBe(82);
    expect(entriesById.get('entry-a').amount).toBe(82);
  });

  it('subtracts a paired container tare — the SAME arithmetic the scale path uses', async () => {
    const weight = appendWeight(500, '2026-09-02 18:04:12');
    const container = store.append('u1', { kind: 'container', value: 'mug', scaleId: 'kitchen-1', at: '2026-09-02 18:04:20' });

    await service.pair('u1', container.id, 'entry-a');
    await service.pair('u1', weight.id, 'entry-a');

    expect(entriesById.get('entry-a').grams).toBe(150); // 500 gross − 350 mug
  });

  it('a tare heavier than the gross is REFUSED, not clamped to a 0 g entry', async () => {
    const weight = appendWeight(100, '2026-09-02 18:04:12');
    const container = store.append('u1', { kind: 'container', value: 'mug', scaleId: 'kitchen-1', at: '2026-09-02 18:04:20' });

    await service.pair('u1', container.id, 'entry-a');
    await service.pair('u1', weight.id, 'entry-a');

    expect(entriesById.get('entry-a').grams).toBe(100); // untared gross, never 0
  });

  it('takes the LATEST weight when a placement left several rows (edit-in-place appends one per >=5 g change)', async () => {
    const a = appendWeight(82, '2026-09-02 18:04:12');
    const b = appendWeight(140, '2026-09-02 18:04:30');
    const c = appendWeight(213, '2026-09-02 18:04:55');

    await service.pair('u1', a.id, 'entry-a');
    await service.pair('u1', b.id, 'entry-a');
    await service.pair('u1', c.id, 'entry-a');

    expect(store.findByPairedEntry('u1', 'entry-a')).toHaveLength(3);
    expect(entriesById.get('entry-a').grams).toBe(213);
  });

  it('recomputes calories when a density observation is part of the evidence', async () => {
    const weight = appendWeight(200, '2026-09-02 18:04:12');
    const density = store.append('u1', { kind: 'density', value: 3, scaleId: 'kitchen-1', at: '2026-09-02 18:04:40' });

    await service.pair('u1', density.id, 'entry-a');
    await service.pair('u1', weight.id, 'entry-a');

    expect(entriesById.get('entry-a').calories).toBe(200); // 200 g × 1.0 kcal/g
    expect(entriesById.get('entry-a').protein).toBeGreaterThan(0);
  });

  it('NEVER invents calories without a density observation — grams are corrected, kcal are left alone', async () => {
    const obs = appendWeight(82);
    await service.pair('u1', obs.id, 'entry-a');

    expect(entriesById.get('entry-a').grams).toBe(82);
    expect(entriesById.get('entry-a').calories).toBe(500); // untouched
    expect(updates.at(-1).changes).not.toHaveProperty('calories');
  });

  it('a density-only pairing writes nothing to the entry (no weight = nothing measured)', async () => {
    const density = store.append('u1', { kind: 'density', value: 3, scaleId: 'kitchen-1', at: '2026-09-02 18:04:40' });
    const result = await service.pair('u1', density.id, 'entry-a');

    expect(result.recomputed).toBeNull();
    expect(updates).toHaveLength(0);
    expect(entriesById.get('entry-a').grams).toBe(0);
  });
});

describe('ObservationPairingService.pair — a measurement is a PLACEMENT, moved whole', () => {
  /** A real placement: 500 g gross in a 180 g small bowl, density level 4 (1.4 kcal/g). */
  const seedPlacement = () => ({
    weight: appendWeight(500, '2026-09-02 18:04:12'),
    container: store.append('u1', { kind: 'container', value: 'small-bowl', scaleId: 'kitchen-1', at: '2026-09-02 18:04:20' }),
    density: store.append('u1', { kind: 'density', value: 4, scaleId: 'kitchen-1', at: '2026-09-02 18:04:40' }),
  });

  it('pairing the WEIGHT of an open placement brings its container and density with it', async () => {
    const { weight, container, density } = seedPlacement();

    const result = await service.pair('u1', weight.id, 'entry-b');

    expect(result.moved.sort()).toEqual([weight.id, container.id, density.id].sort());
    for (const id of [weight.id, container.id, density.id]) {
      expect(store.get('u1', id).status).toBe('consumed');
      expect(store.get('u1', id).pairedEntryUuid).toBe('entry-b');
    }
    // TARED grams and REAL calories — never the untared gross with ~no kcal.
    expect(entriesById.get('entry-b').grams).toBe(320);   // 500 − 180
    expect(entriesById.get('entry-b').calories).toBe(448); // 320 × 1.4
  });

  it('leaves no fragment behind: nothing from the placement stays open or points elsewhere', async () => {
    const { weight } = seedPlacement();
    await service.pair('u1', weight.id, 'entry-b');
    expect(store.openForScale('u1', 'kitchen-1')).toHaveLength(0);
  });

  it('a signal from a DIFFERENT scale, or outside the window, is not swept into the placement', async () => {
    const { weight } = seedPlacement();
    const other = store.append('u1', { kind: 'density', value: 3, scaleId: 'kitchen-2', at: '2026-09-02 18:04:30' });
    const later = store.append('u1', { kind: 'density', value: 3, scaleId: 'kitchen-1', at: '2026-09-02 18:30:00' });

    const result = await service.pair('u1', weight.id, 'entry-b');

    expect(result.moved).not.toContain(other.id);
    expect(result.moved).not.toContain(later.id);
    expect(store.get('u1', other.id).status).toBe('open');
    expect(store.get('u1', later.id).status).toBe('open');
  });

  it('a upc row moves alone — it names a product, not a scale slot', async () => {
    const { weight } = seedPlacement();
    const upc = store.append('u1', { kind: 'upc', value: '049000028911', scaleId: 'kitchen-1', at: '2026-09-02 18:04:25' });

    const result = await service.pair('u1', upc.id, 'entry-b');

    expect(result.moved).toEqual([upc.id]);
    expect(store.get('u1', weight.id).status).toBe('open');
  });
});

describe('ObservationPairingService.pair — moving a measurement off a LIVING entry is refused', () => {
  const seedConsumed = async (entryUuid) => {
    const weight = appendWeight(500, '2026-09-02 18:04:12');
    store.append('u1', { kind: 'container', value: 'small-bowl', scaleId: 'kitchen-1', at: '2026-09-02 18:04:20' });
    store.append('u1', { kind: 'density', value: 4, scaleId: 'kitchen-1', at: '2026-09-02 18:04:40' });
    await service.pair('u1', weight.id, entryUuid);
    return weight;
  };

  it('refuses with PRIOR_ENTRY_EXISTS, naming the entry — the day must not count the food twice', async () => {
    const weight = await seedConsumed('entry-a');
    expect(entriesById.get('entry-a').grams).toBe(320);

    let caught = null;
    try { await service.pair('u1', weight.id, 'entry-b'); } catch (err) { caught = err; }

    expect(caught?.code).toBe('PRIOR_ENTRY_EXISTS');
    expect(caught.message).toContain('Soup');       // the prior entry, by name
    expect(caught.message).toMatch(/second time/);  // and why
  });

  it('writes NOTHING when it refuses — the evidence still backs the entry it computed', async () => {
    const weight = await seedConsumed('entry-a');
    const before = entriesById.get('entry-a');
    const updatesBefore = updates.length;

    try { await service.pair('u1', weight.id, 'entry-b'); } catch { /* expected */ }

    expect(store.findByPairedEntry('u1', 'entry-a')).toHaveLength(3);
    expect(store.findByPairedEntry('u1', 'entry-b')).toHaveLength(0);
    expect(entriesById.get('entry-a')).toEqual(before);
    expect(updates).toHaveLength(updatesBefore);
    // The badge invariant: entry-a's number is still backed by the evidence that made it.
    expect(store.get('u1', weight.id).pairedEntryUuid).toBe('entry-a');
  });

  it('once the prior entry is gone the SAME request succeeds, moving the whole placement', async () => {
    const weight = await seedConsumed('entry-a');
    entriesById.delete('entry-a'); // the person deleted or corrected it, as the message asked

    const result = await service.pair('u1', weight.id, 'entry-b');

    expect(result.moved).toHaveLength(3);
    expect(store.findByPairedEntry('u1', 'entry-a')).toHaveLength(0);
    expect(store.findByPairedEntry('u1', 'entry-b')).toHaveLength(3);
    // Still TARED and density-backed — moving a whole placement recomputes it in full.
    expect(entriesById.get('entry-b').grams).toBe(320);
    expect(entriesById.get('entry-b').calories).toBe(448);
  });

  // END-TO-END INVARIANT — the failure the fix round exists to close.
  it('INVARIANT: a tared, density-backed placement moved A -> B leaves the food counted ONCE, B correct, and no badge without evidence', async () => {
    const weight = await seedConsumed('entry-a');
    // A is backed and correct to begin with.
    expect(entriesById.get('entry-a')).toMatchObject({ grams: 320, calories: 448 });

    // Moving while A lives is refused (no double count is even possible)…
    let caught = null;
    try { await service.pair('u1', weight.id, 'entry-b'); } catch (err) { caught = err; }
    expect(caught?.code).toBe('PRIOR_ENTRY_EXISTS');
    const dayTotalWhileRefused = [...entriesById.values()].reduce((sum, e) => sum + (e.calories || 0), 0);
    expect(dayTotalWhileRefused).toBe(448 + 400); // A's measured 448 + B's own untouched 400

    // …and after resolving A, the food is counted exactly once, on B.
    entriesById.delete('entry-a');
    await service.pair('u1', weight.id, 'entry-b');

    const dayTotalAfter = [...entriesById.values()].reduce((sum, e) => sum + (e.calories || 0), 0);
    expect(dayTotalAfter).toBe(448);                      // counted ONCE, not twice
    expect(entriesById.get('entry-b').grams).toBe(320);   // tared, not the 500 g gross
    // No entry carries a badge without the evidence that produced it: every consumed row
    // points at B, and B is exactly what they computed.
    expect(store.findByPairedEntry('u1', 'entry-b').map((o) => o.kind).sort())
      .toEqual(['container', 'density', 'weight']);
    expect(store.findByPairedEntry('u1', 'entry-a')).toHaveLength(0);
  });

  it('re-pairing to the SAME entry is idempotent on the ledger and still recomputes (the retry story)', async () => {
    const obs = appendWeight(82);
    await service.pair('u1', obs.id, 'entry-a');
    entriesById.set('entry-a', { ...entriesById.get('entry-a'), grams: 0 });

    const result = await service.pair('u1', obs.id, 'entry-a');

    expect(result.moved).toEqual([obs.id]);
    expect(store.findByPairedEntry('u1', 'entry-a')).toHaveLength(1);
    expect(entriesById.get('entry-a').grams).toBe(82);
  });

  it('an unknown observation id throws NOT_FOUND and writes nothing', async () => {
    let caught = null;
    try {
      await service.pair('u1', '11111111-2222-3333-4444-555555555555', 'entry-a');
    } catch (err) { caught = err; }
    expect(caught?.code).toBe('NOT_FOUND');
    expect(updates).toHaveLength(0);
  });

  it('an unknown entry uuid throws ENTRY_NOT_FOUND and leaves the observation untouched', async () => {
    const obs = appendWeight(82);
    let caught = null;
    try {
      await service.pair('u1', obs.id, 'entry-nope');
    } catch (err) { caught = err; }
    expect(caught?.code).toBe('ENTRY_NOT_FOUND');
    expect(store.get('u1', obs.id).status).toBe('open');
    expect(store.get('u1', obs.id).pairedEntryUuid).toBeNull();
  });

  it('never writes the ratification stamp — correcting which meal a measurement belongs to is not a calorie review', async () => {
    const obs = appendWeight(82);
    await service.pair('u1', obs.id, 'entry-a');
    expect(updates.at(-1).changes).not.toHaveProperty('settled');
    expect(updates.at(-1).changes).not.toHaveProperty('settledBy');
  });
});

// ===========================================================================
// The cross-boundary case. `updateMany` is atomic within ONE file; the hot file
// and each monthly archive are separate atomic writes. A re-pair is the only
// operation that can produce a batch spanning them (its patches come from
// findByPairedEntry, which reads archives). DECISION: REFUSE, before any write.
// ===========================================================================

/**
 * Seed `n` RESOLVED rows into the hot file (past the 250-row roll threshold) without
 * triggering the roll — the roll rides the next `append`, which callers do themselves so
 * they control the date that decides what is old enough to go cold.
 */
function seedResolvedHot(userId, n, pairedEntryUuid, start) {
  const ids = [];
  for (let i = 0; i < n; i += 1) {
    const at = new Date(start + i * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
    ids.push(store.append(userId, { kind: 'weight', value: 100 + i, unit: 'g', scaleId: 'kitchen-1', at }).id);
  }
  store.updateMany(userId, ids.map((id) => ({ id, status: 'consumed', pairedEntryUuid })));
  return ids;
}

/**
 * Seed resolved rows and actually roll them cold. The trigger append is dated well
 * outside the 7-day hot-retention window so EVERY seeded row lands in one archive month
 * — a partially-rolled seed would make "one file" tests accidentally cross-file.
 */
function seedArchived(userId, n, pairedEntryUuid, start = Date.UTC(2026, 0, 1, 8, 0, 0)) {
  // The roll's cutoff is (newest row in the file) − 7 days, so an ANCHOR row well past the
  // seeded range is what makes the whole seeded range old enough to go cold in ONE pass.
  // It is appended FIRST, before the file can cross the roll threshold, so no partial roll
  // ever fires with a nearer cutoff and strands half the seed hot. Paired elsewhere on
  // purpose: it stays hot, and a hot row paired to the entry under test would make every
  // "one file" case accidentally cross-file.
  const anchor = store.append(userId, { kind: 'weight', value: 1, unit: 'g', scaleId: 'kitchen-1', at: '2026-01-25 12:00:00' });
  store.update(userId, anchor.id, { status: 'consumed', pairedEntryUuid: 'entry-anchor' });
  const ids = seedResolvedHot(userId, n, pairedEntryUuid, start);
  store.append(userId, { kind: 'weight', value: 999, unit: 'g', scaleId: 'kitchen-1', at: '2026-01-28 12:00:00' });
  return ids;
}

// ===========================================================================
// A GROUP row is never a measurement target. Group rows carry ZERO nutrition by
// design — that is exactly what lets the day view sum every row unconditionally
// and still count each gram once — so writing a recomputed figure onto one makes
// the bucket count the same food twice inside a single dish.
// ===========================================================================
describe('ObservationPairingService.pair — a group row is refused', () => {
  /** The day view's own bucket sum: every row, unconditionally (LogTable.jsx's `kcal`). */
  const bucketTotal = () => Math.round(
    [...entriesById.values()].reduce((sum, r) => sum + (Number(r.calories) || 0), 0),
  );

  beforeEach(() => {
    entriesById = new Map([
      ['curry', { uuid: 'curry', name: 'Curry', kind: 'group', calories: 0, grams: 0 }],
      ['rice', { uuid: 'rice', name: 'Rice', kind: 'item', parentId: 'curry', calories: 200 }],
      ['sauce', { uuid: 'sauce', name: 'Sauce', kind: 'item', parentId: 'curry', calories: 130 }],
    ]);
  });

  const seedPlacement = () => {
    const weight = appendWeight(500, '2026-09-02 18:04:12');
    store.append('u1', { kind: 'container', value: 'small-bowl', scaleId: 'kitchen-1', at: '2026-09-02 18:04:20' });
    store.append('u1', { kind: 'density', value: 4, scaleId: 'kitchen-1', at: '2026-09-02 18:04:40' });
    return weight;
  };

  it('refuses with ENTRY_IS_GROUP, naming the dish and saying where the measurement belongs', async () => {
    const weight = seedPlacement();

    let caught = null;
    try { await service.pair('u1', weight.id, 'curry'); } catch (err) { caught = err; }

    expect(caught?.code).toBe('ENTRY_IS_GROUP');
    expect(caught.message).toContain('Curry');
    expect(caught.message).toMatch(/one of its items/);
  });

  it('writes NOTHING — not to the entry, and not to the ledger', async () => {
    const weight = seedPlacement();

    try { await service.pair('u1', weight.id, 'curry'); } catch { /* expected */ }

    expect(updates).toHaveLength(0);
    expect(entriesById.get('curry')).toEqual({ uuid: 'curry', name: 'Curry', kind: 'group', calories: 0, grams: 0 });
    expect(store.get('u1', weight.id).status).toBe('open');
    expect(store.get('u1', weight.id).pairedEntryUuid).toBeNull();
    expect(store.findByPairedEntry('u1', 'curry')).toHaveLength(0);
  });

  it('END TO END: the bucket total is unchanged by an attempted group pair — 330, never 778', async () => {
    const weight = seedPlacement();
    expect(bucketTotal()).toBe(330); // Curry 0 + Rice 200 + Sauce 130

    try { await service.pair('u1', weight.id, 'curry'); } catch { /* expected */ }

    // The reproduced bug wrote 448 kcal onto the group row, taking the bucket to 778 —
    // the same food counted twice inside one dish, under a "measured" badge.
    expect(bucketTotal()).toBe(330);
  });

  it('the same measurement attaches fine to one of the dish\'s ITEMS', async () => {
    const weight = seedPlacement();

    await service.pair('u1', weight.id, 'rice');

    expect(entriesById.get('rice').grams).toBe(320);
    expect(entriesById.get('rice').calories).toBe(448);
    expect(entriesById.get('curry').calories).toBe(0); // the header still holds nothing
  });

  // The guard exists TWICE — once in `pair` before any write, once in `recomputeEntry` at
  // the point of the write. Through `pair` the first one always fires first, so this pins
  // the reachable behaviour: even a ledger already pointing at a group never gets the group
  // written. (The write-time copy is defence in depth for a future caller that reaches
  // `recomputeEntry` by another route.)
  it('a ledger already pointing at a group is still refused, and the group is never written', async () => {
    const weight = seedPlacement();
    // Attach to an ITEM first so real evidence exists, then point the ledger at the group.
    await service.pair('u1', weight.id, 'rice');
    for (const o of store.findByPairedEntry('u1', 'rice')) {
      store.update('u1', o.id, { status: 'consumed', pairedEntryUuid: 'curry' });
    }
    const before = { ...entriesById.get('curry') };

    let caught = null;
    try { await service.pair('u1', weight.id, 'curry'); } catch (err) { caught = err; }

    expect(caught?.code).toBe('ENTRY_IS_GROUP');
    expect(entriesById.get('curry')).toEqual(before);
  });
});

describe('ObservationPairingService — cross-file batches are refused, never half-applied', () => {
  it('a placement spanning an archive and the hot file is refused with CROSS_FILE_BATCH and writes NOTHING', async () => {
    // entry-a's evidence: many archived rows...
    const archived = seedArchived('u1', 300, 'entry-a');
    // ...plus one HOT row, also paired to entry-a. (A real straddling case: an entry whose
    // evidence rows fell either side of a roll.)
    const hot = appendWeight(82, '2026-02-01 09:00:00');
    expect(fs.readFileSync(path.join(dir, 'u1', 'lifelog/nutrition/observations.yml'), 'utf8')
      .includes(archived[0])).toBe(false); // the seed really is cold
    store.update('u1', hot.id, { status: 'consumed', pairedEntryUuid: 'entry-a' });
    entriesById.delete('entry-a'); // resolved, so PRIOR_ENTRY_EXISTS is not what refuses

    const before = {
      archived0: store.get('u1', archived[0]).pairedEntryUuid,
      hot: store.get('u1', hot.id).pairedEntryUuid,
    };

    let caught = null;
    try {
      // The whole placement moves together — archived rows + the hot row = two files.
      await service.pair('u1', hot.id, 'entry-b');
    } catch (err) { caught = err; }

    expect(caught?.code).toBe('CROSS_FILE_BATCH');
    // NOTHING moved — neither side of the boundary.
    expect(store.get('u1', archived[0]).pairedEntryUuid).toBe(before.archived0);
    expect(store.get('u1', hot.id).pairedEntryUuid).toBe(before.hot);
    expect(store.get('u1', hot.id).status).toBe('consumed');
    expect(store.findByPairedEntry('u1', 'entry-b')).toHaveLength(0);
    expect(updates).toHaveLength(0); // and the entry was never recomputed
  });

  it('a re-pair confined to ONE file still succeeds — the refusal is narrow, not a blanket ban on old rows', async () => {
    const archived = seedArchived('u1', 300, 'entry-a');
    entriesById.delete('entry-a');
    // Every patch (the whole placement) lives in the same archive month.
    const result = await service.pair('u1', archived[0], 'entry-b');

    expect(result.observation.pairedEntryUuid).toBe('entry-b');
    expect(store.findByPairedEntry('u1', 'entry-b')).toHaveLength(archived.length);
    // Latest weight of the moved set — a placement's rows are many, the newest wins.
    expect(entriesById.get('entry-b').grams).toBe(100 + archived.length - 1);
  });
});

describe('ObservationPairingService.dismiss', () => {
  it('takes a row out of the open population and records why it left', () => {
    const obs = appendWeight(82);
    expect(store.openForScale('u1', 'kitchen-1').map((r) => r.id)).toContain(obs.id);

    const { observation } = service.dismiss('u1', obs.id);

    expect(observation.status).toBe('dismissed');
    expect(observation.pairedEntryUuid).toBeNull();
    expect(store.openForScale('u1', 'kitchen-1').map((r) => r.id)).not.toContain(obs.id);
    // Not deleted — the row is still readable evidence that a signal arrived.
    expect(store.listByDate('u1', '2026-09-02').map((r) => r.id)).toContain(obs.id);
  });

  it('a dismissed row becomes ARCHIVABLE — this is what stops open rows accumulating forever', () => {
    const hotFile = path.join(dir, 'u1', 'lifelog/nutrition/observations.yml');
    // The permanently-open row this task exists to fix: a bowl went on the scale, no
    // density card was ever scanned, nobody came back. Nothing in the automatic path
    // resolves it, and an OPEN row is never archived at any age — so it is pinned in the
    // hot file, which is on the scale's own frame path.
    const stale = store.append('u1', { kind: 'weight', value: 82, unit: 'g', scaleId: 'kitchen-1', at: '2026-01-01 08:00:00' });
    seedArchived('u1', 300, 'entry-a', Date.UTC(2026, 0, 1, 9, 0, 0));
    expect(store.get('u1', stale.id).status).toBe('open');
    expect(fs.readFileSync(hotFile, 'utf8').includes(stale.id)).toBe(true); // pinned hot while open

    service.dismiss('u1', stale.id);

    // Rebuild the hot file past the roll threshold and roll again: the row is now
    // RESOLVED and old, so this time it goes cold with everything else.
    seedResolvedHot('u1', 300, 'entry-a', Date.UTC(2026, 1, 1, 8, 0, 0));
    store.append('u1', { kind: 'weight', value: 1, unit: 'g', scaleId: 'kitchen-1', at: '2026-03-01 12:00:00' });

    expect(fs.readFileSync(hotFile, 'utf8').includes(stale.id)).toBe(false); // it really did leave the hot file
    expect(store.get('u1', stale.id).status).toBe('dismissed'); // …and is still readable
  });

  it('an unknown id throws NOT_FOUND', () => {
    let caught = null;
    try { service.dismiss('u1', '11111111-2222-3333-4444-555555555555'); } catch (err) { caught = err; }
    expect(caught?.code).toBe('NOT_FOUND');
  });
});
