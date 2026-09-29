import { describe, it, expect } from 'vitest';
import { MeasureRegistry } from './MeasureRegistry.mjs';
import { createFitnessRingsProvider } from './fitnessRingsProvider.mjs';

const TZ = 'America/Los_Angeles';

// Mon 2026-08-24 .. Sun 2026-08-30
const WINDOW = { from: '2026-08-24', to: '2026-08-30' };

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
        session('2026-08-24T16:00:00Z', { user_4: { rings: 40 } }),
        session('2026-08-26T16:00:00Z', { user_4: { rings: 25 }, user_3: { rings: 10 } }),
      ]),
    });
    expect(await p.total({ learnerId: 'user_4', ...WINDOW })).toBe(65);
    expect(await p.total({ learnerId: 'user_3', ...WINDOW })).toBe(10);
  });

  it('counts both weekend days in the week that began Monday', async () => {
    const p = createFitnessRingsProvider({
      timezone: TZ,
      sessions: sourceOf([
        session('2026-08-29T18:00:00Z', { user_4: { rings: 12 } }),
        session('2026-08-30T18:00:00Z', { user_4: { rings: 8 } }),
      ]),
    });
    expect(await p.total({ learnerId: 'user_4', ...WINDOW })).toBe(20);
  });

  it('does NOT count the next Monday', async () => {
    const p = createFitnessRingsProvider({
      timezone: TZ,
      sessions: sourceOf([session('2026-08-31T18:00:00Z', { user_4: { rings: 99 } })]),
    });
    expect(await p.total({ learnerId: 'user_4', ...WINDOW })).toBe(0);
  });

  it('dates a session by its START, so a workout past 4am is not split', async () => {
    // 2026-08-31T10:00Z is 03:00 Monday local — still Sunday's study day,
    // so it belongs to the week that is ending.
    const p = createFitnessRingsProvider({
      timezone: TZ,
      sessions: sourceOf([session('2026-08-31T10:00:00Z', { user_4: { rings: 7 } })]),
    });
    expect(await p.total({ learnerId: 'user_4', ...WINDOW })).toBe(7);
  });

  it('returns 0, not NaN, for a learner who did nothing', async () => {
    const p = createFitnessRingsProvider({
      timezone: TZ,
      sessions: sourceOf([session('2026-08-24T16:00:00Z', { user_3: { rings: 5 } })]),
    });
    expect(await p.total({ learnerId: 'user_4', ...WINDOW })).toBe(0);
  });

  it('ignores a participant with no ring data rather than counting it as zero-ish NaN', async () => {
    const p = createFitnessRingsProvider({
      timezone: TZ,
      sessions: sourceOf([
        session('2026-08-24T16:00:00Z', { user_4: { rings: null } }),
        session('2026-08-25T16:00:00Z', { user_4: { rings: 3 } }),
      ]),
    });
    expect(await p.total({ learnerId: 'user_4', ...WINDOW })).toBe(3);
  });
});

describe('fitnessRingsProvider.standings — the ring award week (Mon 04:00 → Sat 12:00)', () => {
  // Mon 04:00 PDT = 11:00Z; Sat 12:00 PDT = 19:00Z.
  const FROM = Date.parse('2026-08-24T11:00:00Z');
  const TO = Date.parse('2026-08-29T19:00:00Z');

  it('sums each asked learner\'s rings from sessions STARTED inside the window, zero for none', async () => {
    const asked = [];
    const p = createFitnessRingsProvider({
      timezone: TZ,
      sessions: { listSessions: async (args) => { asked.push(args); return [
        session('2026-08-24T10:59:00Z', { user_4: { rings: 99 } }), // Mon 03:59 — the week before's study day
        session('2026-08-24T16:00:00Z', { user_4: { rings: 20 }, user_3: { rings: 5 } }),
        session('2026-08-29T18:59:00Z', { user_4: { rings: 3 } }), // Sat 11:59 — counts
        session('2026-08-29T19:00:00Z', { user_4: { rings: 50 } }), // Sat 12:00 — contest closed
        session('2026-08-26T16:00:00Z', { kckern: { rings: 70 } }), // not asked about
      ]; } },
    });
    const out = await p.standings({ learnerIds: ['user_4', 'user_3', 'user_2'], fromMs: FROM, toMs: TO });
    expect(out).toEqual([{ learnerId: 'user_4', rings: 23 }, { learnerId: 'user_3', rings: 5 }, { learnerId: 'user_2', rings: 0 }]);
    // It lists the study days the window touches, and filters to the instant.
    expect(asked[0]).toEqual({ from: '2026-08-23', to: '2026-08-29' });
  });

  it('a session with no start time cannot be placed in the award week, so it is not counted', async () => {
    const p = createFitnessRingsProvider({
      timezone: TZ,
      sessions: sourceOf([{ date: '2026-08-25', participants: { user_4: { rings: 9 } } }]),
    });
    expect(await p.standings({ learnerIds: ['user_4'], fromMs: FROM, toMs: TO })).toEqual([{ learnerId: 'user_4', rings: 0 }]);
  });
});

describe('MeasureRegistry', () => {
  const stub = (id, value) => ({ id, label: id, unit: 'x', total: async () => value });

  it('returns one row per registered measure', async () => {
    const r = new MeasureRegistry().register(stub('a', 1)).register(stub('b', 2));
    expect(await r.totalsFor({ learnerId: 'user_4', ...WINDOW })).toEqual([
      { id: 'a', label: 'a', unit: 'x', value: 1 },
      { id: 'b', label: 'b', unit: 'x', value: 2 },
    ]);
  });

  it('distinguishes "could not find out" (null) from "did nothing" (0)', async () => {
    const boom = { id: 'boom', label: 'Boom', unit: 'x', total: async () => { throw new Error('nope'); } };
    const r = new MeasureRegistry().register(boom).register(stub('zero', 0));
    const rows = await r.totalsFor({ learnerId: 'user_4', ...WINDOW });
    expect(rows.find((x) => x.id === 'boom').value).toBeNull();
    expect(rows.find((x) => x.id === 'zero').value).toBe(0);
  });

  it('refuses a duplicate id and a provider with no total()', () => {
    const r = new MeasureRegistry().register(stub('a', 1));
    expect(() => r.register(stub('a', 2))).toThrow(/already registered/);
    expect(() => r.register({ id: 'c' })).toThrow(/needs total/);
  });
});
