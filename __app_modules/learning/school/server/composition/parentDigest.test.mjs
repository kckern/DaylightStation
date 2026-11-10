import { describe, it, expect } from 'vitest';
import { createDigestEconomyPort, createSchoolParentDigest } from "./parentDigest.mjs";

const TZ = 'America/Los_Angeles';
const quiet = { info() {}, warn() {} };

// Study day 2026-10-20 runs 04:00 local (11:00Z) to 04:00 the next morning.
const LEDGER = [
  { at: '2026-10-21T02:00:00.000Z', kind: 'earn', currency: 'silver', delta: 4, source: 'payout', action: 'payout:week:a' },
  { at: '2026-10-20T20:00:00.000Z', kind: 'earn', currency: 'silver', delta: 3, source: 'payout', action: 'payout:week:b' },
  // Not a payout: a refund and a parent deposit.
  { at: '2026-10-20T20:05:00.000Z', kind: 'earn', currency: 'silver', delta: 5, source: 'pass', action: 'games-refund' },
  { at: '2026-10-20T20:06:00.000Z', kind: 'deposit', currency: 'silver', delta: 9, source: 'admin', action: 'parent-deposit' },
  // Gold minted is not silver earned.
  { at: '2026-10-20T20:07:00.000Z', kind: 'earn', currency: 'gold', delta: 1, source: 'payout', action: 'payout:week:c' },
  // Before the 4 am boundary: the previous study day.
  { at: '2026-10-20T10:30:00.000Z', kind: 'earn', currency: 'silver', delta: 7, source: 'payout', action: 'payout:week:d' },
  // Two passes bought today, one refunded.
  { at: '2026-10-20T21:00:00.000Z', kind: 'pass', source: 'pass', ref: 'pass:1', evidenceRef: 'pass:1', meta: { state: 'active', studyDay: '2026-10-20' } },
  { at: '2026-10-20T21:00:00.000Z', kind: 'spend', source: 'pass', ref: 'pass:1', delta: -10, currency: 'silver' },
  { at: '2026-10-20T22:00:00.000Z', kind: 'pass', source: 'pass', ref: 'pass:2', evidenceRef: 'pass:2', meta: { state: 'active', studyDay: '2026-10-20' } },
  { at: '2026-10-20T22:01:00.000Z', kind: 'pass', source: 'pass', ref: 'pass:2:refunded', evidenceRef: 'pass:2', meta: { state: 'refunded' } },
];

describe('createDigestEconomyPort', () => {
  it('sums silver payouts inside the study day and counts passes bought, less refunds', async () => {
    const calls = [];
    const port = createDigestEconomyPort({
      economyService: { hasUser: () => true, getHistory: async (id, opts) => { calls.push(opts); return LEDGER; } },
      timezone: TZ,
    });
    expect(await port('learner_a', '2026-10-20')).toEqual({ silverEarned: 7, passesUsed: 1 });
    expect(calls[0].since).toBe('2026-10-20T11:00:00.000Z');
  });

  it('opens the window at 4 am standard time on the day the clocks fall back', async () => {
    const calls = [];
    const port = createDigestEconomyPort({
      economyService: { getHistory: async (id, opts) => { calls.push(opts.since); return [
        { at: '2026-11-01T11:30:00.000Z', kind: 'earn', currency: 'silver', delta: 2, source: 'payout', action: 'payout:a' },
        { at: '2026-11-01T12:30:00.000Z', kind: 'earn', currency: 'silver', delta: 3, source: 'payout', action: 'payout:b' },
      ]; } },
      timezone: TZ,
    });
    expect(await port('learner_a', '2026-11-01')).toEqual({ silverEarned: 3, passesUsed: 0 });
    expect(calls).toEqual(['2026-11-01T12:00:00.000Z']);
  });

  it('answers null for a learner the economy does not know', async () => {
    const port = createDigestEconomyPort({ economyService: { hasUser: () => false, getHistory: async () => LEDGER }, timezone: TZ });
    expect(await port('learner_x', '2026-10-20')).toBeNull();
  });

  it('is absent without an economy', () => {
    expect(createDigestEconomyPort({ economyService: null })).toBeNull();
  });
});

describe('createSchoolParentDigest', () => {
  const base = (digest, extra = {}) => {
    const tasks = [];
    const wired = createSchoolParentDigest({
      economyConfig: { catalog: () => ({ mode: 'live', digest }) },
      roster: () => [], getLearnerDayCompletion: { execute: async () => ({}) }, termVerdicts: null,
      notificationService: { send: async () => [] }, teachers: () => [],
      scheduler: { registerTask: (name, cron) => tasks.push([name, cron]) }, enabled: true, studyCalendar: { timezone: TZ, boundaryHour: 4 }, logger: quiet,
      ...extra,
    });
    return { wired, tasks };
  };

  it('registers the digest on the catalog cron, and the retry tick', () => {
    const { wired, tasks } = base({ cron: '0 18 * * *', zero_days_alert: 2 });
    expect(wired.digest).toBeTruthy();
    expect(tasks).toEqual([['school:parent-digest', '0 18 * * *'], ['school:parent-digest-retry', '0 * * * *']]);
  });

  it('registers nothing for a null cron', () => {
    const { wired, tasks } = base({ cron: null, zero_days_alert: null });
    expect(wired.digest).toBeNull();
    expect(tasks).toEqual([]);
  });

  it('uses the one study calendar for School\'s today and the economy\'s window', async () => {
    const since = [];
    const sent = [];
    const { wired } = base({ cron: '0 18 * * *', zero_days_alert: 2 }, {
      // 10:30Z: 03:30 in Los Angeles (still the 20th's study day), 10:30 UTC (the 21st's).
      now: () => Date.parse('2026-10-21T10:30:00.000Z'),
      studyCalendar: { timezone: TZ, boundaryHour: 4 },
      roster: () => [{ id: 'learner_a' }],
      teachers: () => ['parent_a'],
      economyService: { hasUser: () => true, getHistory: async (id, opts) => { since.push(opts.since); return []; } },
      notificationService: { send: async (intent) => { sent.push(intent); return [{ delivered: true }]; } },
    });
    const result = await wired.digest.run({});
    expect(result.studyDay).toBe('2026-10-20');
    expect(since).toEqual(['2026-10-20T11:00:00.000Z']);
    expect(sent[0].dedupeKey).toBe('digest:2026-10-20');
  });

  it('registers nothing when the scheduler gate is off', () => {
    const { tasks } = base({ cron: '0 18 * * *' }, { enabled: false });
    expect(tasks).toEqual([]);
  });
});
