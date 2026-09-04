import { describe, it, expect } from 'vitest';
import {
  matchObservations,
  MATCH_WINDOW_MS,
  MIN_PLAUSIBLE_KCAL_PER_G,
  MAX_PLAUSIBLE_KCAL_PER_G,
} from './ObservationMatcher.mjs';

/** Local-timestamp epoch-ms helper mirroring the module's own parser, for test math only. */
function localMs(ts) {
  const [datePart, timePart] = ts.split(' ');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi, s] = timePart.split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

let seq = 0;
function observation(overrides = {}) {
  seq += 1;
  return {
    id: overrides.id ?? `obs-${seq}`,
    kind: 'weight',
    value: 100,
    unit: 'g',
    scaleId: 'kitchen-1',
    at: '2026-09-02 18:00:00',
    date: '2026-09-02',
    status: 'open',
    pairedEntryUuid: null,
    ...overrides,
  };
}

function entry(overrides = {}) {
  return {
    uuid: 'entry-1',
    createdAt: '2026-09-02 18:00:00',
    date: '2026-09-02',
    calories: 200, // 2 kcal/g against a 100g weight by default — plausible
    settled: false,
    ...overrides,
  };
}

describe('matchObservations — empty inputs', () => {
  it('returns empty pairings and null composition for no observations/entries', () => {
    const result = matchObservations({ observations: [], entries: [], nowTs: localMs('2026-09-02 18:00:00') });
    expect(result).toEqual({ pairings: [], composition: null });
  });
});

describe('matchObservations — straightforward in-window match', () => {
  it('pairs a weight observation to the sole unsettled same-date candidate', () => {
    const obs = observation({ at: '2026-09-02 18:00:00' });
    const e = entry({ createdAt: '2026-09-02 18:02:00' }); // 120s away, well inside 900s
    const result = matchObservations({ observations: [obs], entries: [e], nowTs: localMs('2026-09-02 18:03:00') });
    expect(result.pairings).toEqual([{ observationId: obs.id, entryUuid: 'entry-1', confidence: 1 }]);
    expect(result.composition).toBeNull();
  });
});

describe('matchObservations — out-of-window observation left open', () => {
  it('does not pair when the only candidate is outside the 900s window', () => {
    const obs = observation({ at: '2026-09-02 18:00:00' });
    const e = entry({ createdAt: '2026-09-02 18:16:00' }); // 960s away > 900s
    expect(localMs(e.createdAt) - localMs(obs.at)).toBeGreaterThan(MATCH_WINDOW_MS);
    const result = matchObservations({ observations: [obs], entries: [e], nowTs: localMs('2026-09-02 18:20:00') });
    expect(result.pairings).toEqual([]);
    // Stays open, waiting — and since a weight alone is incomplete, no composition either.
    expect(result.composition).toBeNull();
  });

  it('boundary: exactly 900s is still in-window (inclusive)', () => {
    const obs = observation({ at: '2026-09-02 18:00:00' });
    const e = entry({ createdAt: '2026-09-02 18:15:00' }); // exactly 900s
    const result = matchObservations({ observations: [obs], entries: [e], nowTs: localMs('2026-09-02 18:15:00') });
    expect(result.pairings).toEqual([{ observationId: obs.id, entryUuid: 'entry-1', confidence: 1 }]);
  });
});

describe('matchObservations — plausibility rejection', () => {
  it('an absurd kcal/gram ratio leaves the weight open rather than force-paired', () => {
    // 100g at 5000 kcal => 50 kcal/g, way outside [0.1, 9].
    const obs = observation({ at: '2026-09-02 18:00:00', value: 100 });
    const e = entry({ createdAt: '2026-09-02 18:01:00', calories: 5000 });
    const result = matchObservations({ observations: [obs], entries: [e], nowTs: localMs('2026-09-02 18:02:00') });
    expect(result.pairings).toEqual([]);
  });

  it('boundary ratios at the plausibility edges are accepted', () => {
    const lowObs = observation({ id: 'low', at: '2026-09-02 18:00:00', value: 100 });
    const lowEntry = entry({ uuid: 'e-low', createdAt: '2026-09-02 18:01:00', calories: 100 * MIN_PLAUSIBLE_KCAL_PER_G });
    const highObs = observation({ id: 'high', at: '2026-09-02 12:00:00', value: 100 });
    const highEntry = entry({ uuid: 'e-high', createdAt: '2026-09-02 12:01:00', calories: 100 * MAX_PLAUSIBLE_KCAL_PER_G });

    const result = matchObservations({
      observations: [lowObs, highObs],
      entries: [lowEntry, highEntry],
      nowTs: localMs('2026-09-02 18:02:00'),
    });
    expect(result.pairings).toEqual(expect.arrayContaining([
      { observationId: 'low', entryUuid: 'e-low', confidence: 1 },
      { observationId: 'high', entryUuid: 'e-high', confidence: 1 },
    ]));
    expect(result.pairings).toHaveLength(2);
  });

  it('a non-weight observation is never plausibility-gated', () => {
    const obs = observation({ kind: 'density', value: 4, unit: null, at: '2026-09-02 18:00:00' });
    const e = entry({ createdAt: '2026-09-02 18:01:00', calories: 999999 });
    const result = matchObservations({ observations: [obs], entries: [e], nowTs: localMs('2026-09-02 18:02:00') });
    expect(result.pairings).toEqual([{ observationId: obs.id, entryUuid: 'entry-1', confidence: 1 }]);
  });
});

describe('matchObservations — nearest-in-time tie-break', () => {
  it('picks the closer of two eligible candidates and marks it contested (confidence 0.5)', () => {
    const obs = observation({ at: '2026-09-02 18:00:00' });
    const near = entry({ uuid: 'near', createdAt: '2026-09-02 18:01:00' }); // 60s
    const far = entry({ uuid: 'far', createdAt: '2026-09-02 18:10:00' }); // 600s
    const result = matchObservations({ observations: [obs], entries: [near, far], nowTs: localMs('2026-09-02 18:20:00') });
    expect(result.pairings).toEqual([{ observationId: obs.id, entryUuid: 'near', confidence: 0.5 }]);
  });
});

describe('matchObservations — exact-tie determinism', () => {
  it('two equidistant candidates always resolve to the lexicographically smaller uuid', () => {
    const obs = observation({ at: '2026-09-02 18:00:00' });
    const before = entry({ uuid: 'entry-a', createdAt: '2026-09-02 17:57:00' }); // -180s
    const after = entry({ uuid: 'entry-z', createdAt: '2026-09-02 18:03:00' }); // +180s
    const forward = matchObservations({ observations: [obs], entries: [before, after], nowTs: localMs('2026-09-02 18:20:00') });
    const reversed = matchObservations({ observations: [obs], entries: [after, before], nowTs: localMs('2026-09-02 18:20:00') });
    expect(forward.pairings).toEqual([{ observationId: obs.id, entryUuid: 'entry-a', confidence: 0.5 }]);
    expect(reversed.pairings).toEqual(forward.pairings);
  });
});

describe('matchObservations — midnight: same-date wins over the window', () => {
  it('does not pair across a date boundary even when the clocks are within 900s', () => {
    const obs = observation({ at: '2026-09-02 23:59:30', date: '2026-09-02' });
    const e = entry({ createdAt: '2026-09-03 00:01:00', date: '2026-09-03' }); // 90s away
    expect(Math.abs(localMs(e.createdAt) - localMs(obs.at))).toBeLessThan(MATCH_WINDOW_MS);
    const result = matchObservations({ observations: [obs], entries: [e], nowTs: localMs('2026-09-03 00:02:00') });
    expect(result.pairings).toEqual([]);
  });

  it('same date on both sides of midnight still matches normally (sanity control)', () => {
    const obs = observation({ at: '2026-09-02 23:59:30', date: '2026-09-02' });
    const e = entry({ createdAt: '2026-09-02 23:58:00', date: '2026-09-02' });
    const result = matchObservations({ observations: [obs], entries: [e], nowTs: localMs('2026-09-03 00:02:00') });
    expect(result.pairings).toEqual([{ observationId: obs.id, entryUuid: 'entry-1', confidence: 1 }]);
  });
});

describe('matchObservations — composition consuming several observations into one entry', () => {
  it('a weight, a density and a container tare can all resolve to the same entry', () => {
    const weight = observation({ id: 'w1', kind: 'weight', value: 150, unit: 'g', at: '2026-09-02 18:00:00' });
    const density = observation({ id: 'd1', kind: 'density', value: 4, unit: null, at: '2026-09-02 18:00:30' });
    const container = observation({ id: 'c1', kind: 'container', value: 'bowl', unit: null, at: '2026-09-02 18:01:00' });
    const e = entry({ createdAt: '2026-09-02 18:02:00', calories: 300 }); // 2 kcal/g against 150g — plausible

    const result = matchObservations({
      observations: [weight, density, container],
      entries: [e],
      nowTs: localMs('2026-09-02 18:03:00'),
    });

    expect(result.pairings).toEqual(expect.arrayContaining([
      { observationId: 'w1', entryUuid: 'entry-1', confidence: 1 },
      { observationId: 'd1', entryUuid: 'entry-1', confidence: 1 },
      { observationId: 'c1', entryUuid: 'entry-1', confidence: 1 },
    ]));
    expect(result.pairings).toHaveLength(3);
    // All three are claimed by the entry, so nothing is left to form a fresh composition.
    expect(result.composition).toBeNull();
  });
});

describe('matchObservations — settled candidate must not be paired', () => {
  it('a weight whose only candidate entry is already settled stays open', () => {
    const obs = observation({ at: '2026-09-02 18:00:00' });
    const e = entry({ createdAt: '2026-09-02 18:01:00', settled: true });
    const result = matchObservations({ observations: [obs], entries: [e], nowTs: localMs('2026-09-02 18:02:00') });
    expect(result.pairings).toEqual([]);
  });

  it('absent settled reads as settled (legacy row) and is not a candidate', () => {
    const obs = observation({ at: '2026-09-02 18:00:00' });
    const e = entry({ createdAt: '2026-09-02 18:01:00' });
    delete e.settled;
    const result = matchObservations({ observations: [obs], entries: [e], nowTs: localMs('2026-09-02 18:02:00') });
    expect(result.pairings).toEqual([]);
  });

  it('an already-consumed/dismissed observation is never matched', () => {
    const obs = observation({ at: '2026-09-02 18:00:00', status: 'consumed' });
    const e = entry({ createdAt: '2026-09-02 18:01:00' });
    const result = matchObservations({ observations: [obs], entries: [e], nowTs: localMs('2026-09-02 18:02:00') });
    expect(result.pairings).toEqual([]);
  });
});

describe('matchObservations — composition for observations with no candidate entry', () => {
  it('unclaimed weight+density within the window merge into an in-progress composition', () => {
    const weight = observation({ id: 'w1', kind: 'weight', value: 220, unit: 'g', at: '2026-09-02 18:00:00' });
    const density = observation({ id: 'd1', kind: 'density', value: 3, unit: null, at: '2026-09-02 18:00:20' });
    const result = matchObservations({ observations: [weight, density], entries: [], nowTs: localMs('2026-09-02 18:01:00') });
    expect(result.pairings).toEqual([]);
    expect(result.composition).toEqual({
      scaleId: 'kitchen-1',
      grams: 220,
      unit: 'g',
      density: 3,
      container: null,
      complete: true,
      observationIds: ['w1', 'd1'],
    });
  });

  it('a lone weight with no density is an incomplete composition', () => {
    const weight = observation({ id: 'w1', kind: 'weight', value: 220, unit: 'g', at: '2026-09-02 18:00:00' });
    const result = matchObservations({ observations: [weight], entries: [], nowTs: localMs('2026-09-02 18:01:00') });
    expect(result.composition).toEqual({
      scaleId: 'kitchen-1',
      grams: 220,
      unit: 'g',
      density: null,
      container: null,
      complete: false,
      observationIds: ['w1'],
    });
  });

  // ZERO IS A WEIGHT. `complete` is compared against `null`, never tested for truthiness,
  // because a genuine 0 g reading with a density scanned against it is a finished
  // placement — an empty tared vessel, or food lifted off after the tare. Rewriting the
  // rule as `!!grams` or `grams && density` reads identically at a glance and silently
  // strands every such placement: the quiet commit refuses it as `incomplete` forever
  // and the prompt stays `pending` until the next placement supersedes it.
  it('a ZERO-gram weight with a density is a COMPLETE composition, not a falsy one', () => {
    const weight = observation({ id: 'w1', kind: 'weight', value: 0, unit: 'g', at: '2026-09-02 18:00:00' });
    const density = observation({ id: 'd1', kind: 'density', value: 3, unit: null, at: '2026-09-02 18:00:20' });
    const result = matchObservations({
      observations: [weight, density], entries: [], nowTs: localMs('2026-09-02 18:01:00'),
    });
    expect(result.composition).toEqual({
      scaleId: 'kitchen-1',
      grams: 0,
      unit: 'g',
      density: 3,
      container: null,
      complete: true,
      observationIds: ['w1', 'd1'],
    });
  });

  it('a ZERO-gram weight alone is still incomplete — it is the DENSITY that is missing', () => {
    const weight = observation({ id: 'w1', kind: 'weight', value: 0, unit: 'g', at: '2026-09-02 18:00:00' });
    const result = matchObservations({ observations: [weight], entries: [], nowTs: localMs('2026-09-02 18:01:00') });
    expect(result.composition).toMatchObject({ grams: 0, density: null, complete: false });
  });

  // Last-writer-wins per slot, for the CONTAINER as well as the density. The rows are
  // append-only, so a rescan does not overwrite anything — the later row simply wins, and
  // that is what makes rescanning the repair for a wrong slot.
  it('the LATER container row wins, so a rescan repairs a wrong tare', () => {
    const first = observation({ id: 'c1', kind: 'container', value: 'mug', unit: null, at: '2026-09-02 18:00:00' });
    const second = observation({ id: 'c2', kind: 'container', value: 'tupperware', unit: null, at: '2026-09-02 18:00:30' });
    const weight = observation({ id: 'w1', kind: 'weight', value: 500, unit: 'g', at: '2026-09-02 18:00:40' });
    const result = matchObservations({
      observations: [first, second, weight], entries: [], nowTs: localMs('2026-09-02 18:01:00'),
    });
    expect(result.composition.container).toBe('tupperware');
    // BOTH rows stay in the evidence set: neither was deleted, and the undo that takes
    // the later one back is what lets the earlier one win again.
    expect(result.composition.observationIds).toEqual(['c1', 'c2', 'w1']);
  });

  it('the LATER weight row wins too, so the composition reports the current load', () => {
    const first = observation({ id: 'w1', kind: 'weight', value: 480, unit: 'g', at: '2026-09-02 18:00:00' });
    const second = observation({ id: 'w2', kind: 'weight', value: 613, unit: 'ml', at: '2026-09-02 18:00:30' });
    const result = matchObservations({
      observations: [first, second], entries: [], nowTs: localMs('2026-09-02 18:01:00'),
    });
    // The unit travels with the weight that won — a stale unit against a fresh number is
    // how a millilitre reading gets multiplied by a kcal-per-gram density.
    expect(result.composition).toMatchObject({ grams: 613, unit: 'ml' });
  });

  it('an unclaimed observation older than the window from nowTs is dropped from composition', () => {
    const weight = observation({ id: 'w1', kind: 'weight', value: 220, unit: 'g', at: '2026-09-02 18:00:00' });
    const result = matchObservations({ observations: [weight], entries: [], nowTs: localMs('2026-09-02 18:16:00') });
    expect(result.composition).toBeNull();
  });

  it('a upc observation never contributes to a composition', () => {
    const upc = observation({ id: 'u1', kind: 'upc', value: '012345', unit: null, at: '2026-09-02 18:00:00' });
    const result = matchObservations({ observations: [upc], entries: [], nowTs: localMs('2026-09-02 18:01:00') });
    expect(result.composition).toBeNull();
  });
});
