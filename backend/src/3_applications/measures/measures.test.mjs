import { describe, it, expect } from 'vitest';
import { MeasureRegistry } from './MeasureRegistry.mjs';
import { createFitnessRingsProvider } from './fitnessRingsProvider.mjs';

const TZ = 'America/Los_Angeles';

// Sun 2026-08-23 .. Sat 2026-08-29
const WINDOW = { from: '2026-08-23', to: '2026-08-29' };

const session = (isoStart, participants) => ({
  startTime: Date.parse(isoStart),
  date: isoStart.slice(0, 10),
  participants,
});

const sourceOf = (list) => ({ listSessions: async () => list });

describe('fitnessRingsProvider', () => {
  it('sums a learner’s rings across the week', async () => {
    const p = createFitnessRingsProvider({
      timezone: TZ,
      sessions: sourceOf([
        session('2026-08-24T16:00:00Z', { milo: { rings: 40 } }),
        session('2026-08-26T16:00:00Z', { milo: { rings: 25 }, felix: { rings: 10 } }),
      ]),
    });
    expect(await p.total({ learnerId: 'milo', ...WINDOW })).toBe(65);
    expect(await p.total({ learnerId: 'felix', ...WINDOW })).toBe(10);
  });

  it('counts Saturday — catch-up work is real work', async () => {
    const p = createFitnessRingsProvider({
      timezone: TZ,
      sessions: sourceOf([session('2026-08-29T18:00:00Z', { milo: { rings: 12 } })]),
    });
    expect(await p.total({ learnerId: 'milo', ...WINDOW })).toBe(12);
  });

  it('does NOT count the next Sunday — it head-starts the following week', async () => {
    const p = createFitnessRingsProvider({
      timezone: TZ,
      sessions: sourceOf([session('2026-08-30T18:00:00Z', { milo: { rings: 99 } })]),
    });
    expect(await p.total({ learnerId: 'milo', ...WINDOW })).toBe(0);
  });

  it('dates a session by its START, so a workout past 4am is not split', async () => {
    // 2026-08-30T10:00Z is 03:00 Sunday local — still Saturday's study day,
    // so it belongs to the week that is ending.
    const p = createFitnessRingsProvider({
      timezone: TZ,
      sessions: sourceOf([session('2026-08-30T10:00:00Z', { milo: { rings: 7 } })]),
    });
    expect(await p.total({ learnerId: 'milo', ...WINDOW })).toBe(7);
  });

  it('returns 0, not NaN, for a learner who did nothing', async () => {
    const p = createFitnessRingsProvider({
      timezone: TZ,
      sessions: sourceOf([session('2026-08-24T16:00:00Z', { felix: { rings: 5 } })]),
    });
    expect(await p.total({ learnerId: 'milo', ...WINDOW })).toBe(0);
  });

  it('ignores a participant with no ring data rather than counting it as zero-ish NaN', async () => {
    const p = createFitnessRingsProvider({
      timezone: TZ,
      sessions: sourceOf([
        session('2026-08-24T16:00:00Z', { milo: { rings: null } }),
        session('2026-08-25T16:00:00Z', { milo: { rings: 3 } }),
      ]),
    });
    expect(await p.total({ learnerId: 'milo', ...WINDOW })).toBe(3);
  });
});

describe('MeasureRegistry', () => {
  const stub = (id, value) => ({ id, label: id, unit: 'x', total: async () => value });

  it('returns one row per registered measure', async () => {
    const r = new MeasureRegistry().register(stub('a', 1)).register(stub('b', 2));
    expect(await r.totalsFor({ learnerId: 'milo', ...WINDOW })).toEqual([
      { id: 'a', label: 'a', unit: 'x', value: 1 },
      { id: 'b', label: 'b', unit: 'x', value: 2 },
    ]);
  });

  it('distinguishes "could not find out" (null) from "did nothing" (0)', async () => {
    const boom = { id: 'boom', label: 'Boom', unit: 'x', total: async () => { throw new Error('nope'); } };
    const r = new MeasureRegistry().register(boom).register(stub('zero', 0));
    const rows = await r.totalsFor({ learnerId: 'milo', ...WINDOW });
    expect(rows.find((x) => x.id === 'boom').value).toBeNull();
    expect(rows.find((x) => x.id === 'zero').value).toBe(0);
  });

  it('refuses a duplicate id and a provider with no total()', () => {
    const r = new MeasureRegistry().register(stub('a', 1));
    expect(() => r.register(stub('a', 2))).toThrow(/already registered/);
    expect(() => r.register({ id: 'c' })).toThrow(/needs total/);
  });
});
