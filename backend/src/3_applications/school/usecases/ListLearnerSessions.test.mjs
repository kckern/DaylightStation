import { describe, it, expect } from 'vitest';
import { ListLearnerSessions } from './ListLearnerSessions.mjs';

const mk = (id, updatedAt) => ({ id, updatedAt });
const repo = (rows) => ({ listForLearner: async () => rows });

describe('ListLearnerSessions', () => {
  // Window for this clock: 2026-08-06T04:00Z → 2026-08-07T04:00Z.
  const clock = () => new Date('2026-08-06T18:00:00Z');

  it('window=today keeps only sessions whose updatedAt falls in the study-day window', async () => {
    const uc = new ListLearnerSessions({
      sessions: repo([mk('old', '2026-08-05T12:00:00Z'), mk('now', '2026-08-06T09:00:00Z')]),
      clock,
    });
    const rows = await uc.execute({ learnerId: 'felix', window: 'today' });
    expect(rows.map((r) => r.id)).toEqual(['now']);
  });

  it('no window returns everything', async () => {
    const uc = new ListLearnerSessions({ sessions: repo([mk('a', '2026-01-01T00:00:00Z')]), clock });
    expect((await uc.execute({ learnerId: 'felix' })).length).toBe(1);
  });

  it('an unknown window value returns everything (never an empty lie)', async () => {
    const uc = new ListLearnerSessions({ sessions: repo([mk('a', '2026-01-01T00:00:00Z')]), clock });
    expect((await uc.execute({ learnerId: 'felix', window: 'fortnight' })).length).toBe(1);
  });

  it('falls back to created when updatedAt is absent', async () => {
    const uc = new ListLearnerSessions({
      sessions: repo([{ id: 'c', created: '2026-08-06T05:00:00Z' }]),
      clock,
    });
    expect((await uc.execute({ learnerId: 'felix', window: 'today' })).map((r) => r.id)).toEqual(['c']);
  });

  it('a session with neither timestamp is excluded from today, not crashed on', async () => {
    const uc = new ListLearnerSessions({ sessions: repo([{ id: 'x' }, mk('y', '2026-08-06T10:00:00Z')]), clock });
    expect((await uc.execute({ learnerId: 'felix', window: 'today' })).map((r) => r.id)).toEqual(['y']);
  });

  it('applies the household timezone to the boundary', async () => {
    // 2026-08-06T09:00Z = Aug 6 02:00 LA — before LA's 4am roll, so LA's
    // "today" window starts Aug 5 04:00 LA = Aug 5 11:00Z. A 10:00Z session
    // from Aug 5 is INSIDE LA-today but outside UTC-today.
    const laClock = () => new Date('2026-08-06T09:00:00Z');
    const uc = new ListLearnerSessions({
      sessions: repo([mk('la-today', '2026-08-05T12:00:00Z')]),
      timezone: 'America/Los_Angeles',
      clock: laClock,
    });
    expect((await uc.execute({ learnerId: 'felix', window: 'today' })).map((r) => r.id)).toEqual(['la-today']);
  });

  it('requires a sessions repository', () => {
    expect(() => new ListLearnerSessions({})).toThrow(/sessions/);
  });
});
