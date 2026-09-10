// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { collectProgramStatuses } from './programStatusCollection.mjs';
import { appendAssignedProgramEntries } from './assignedProgramPlan.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function launcher({ doneOn = [], replayable = true }) {
  const seen = [];
  return {
    seen,
    id: 'p', entryAction: null, surface: null, replayable,
    async status({ day = null }) {
      seen.push(day);
      // Live (no day) answers for the judged "today" the test picks below.
      return { doneToday: doneOn.includes(day ?? 'TODAY'), progressLabel: null, score: null };
    },
    async launch() {},
  };
}
const plan = { entries: [{ unitId: 'p:w', program: 'p', programInstance: null, cadence: 'weekly' }] };

describe('collectProgramStatuses — weekly fold', () => {
  it('asks the replayable launcher for Monday through the day before, and stops at the first done', async () => {
    const l = launcher({ doneOn: ['2026-09-08'] });
    const [row] = await collectProgramStatuses({ plan, learnerId: 'k', launchers: new Map([['p', l]]), logger: silent, studyDay: '2026-09-10' });
    expect(l.seen).toEqual([null, '2026-09-07', '2026-09-08']);
    expect(row.status.weekly).toEqual({ weekFrom: '2026-09-07', servedOn: '2026-09-08', satisfiedBefore: true });
    expect(row.status.doneToday).toBe(false);
  });

  it('never looks at a day after the one judged — Thursday is not satisfied by Saturday', async () => {
    const l = launcher({ doneOn: ['2026-09-12'] });
    const [row] = await collectProgramStatuses({ plan, learnerId: 'k', launchers: new Map([['p', l]]), logger: silent, studyDay: '2026-09-10' });
    expect(l.seen.every((d) => d === null || d < '2026-09-10')).toBe(true);
    expect(row.status.weekly.servedOn).toBeNull();
  });

  it('done on the judged day itself: servedOn is that day, satisfiedBefore false', async () => {
    const l = launcher({ doneOn: ['TODAY'] });
    const [row] = await collectProgramStatuses({ plan, learnerId: 'k', launchers: new Map([['p', l]]), logger: silent, studyDay: '2026-09-10' });
    expect(row.status.weekly).toMatchObject({ servedOn: '2026-09-10', satisfiedBefore: false });
  });

  it('a non-replayable weekly launcher is asked only for the judged day', async () => {
    const l = launcher({ doneOn: [], replayable: false });
    await collectProgramStatuses({ plan, learnerId: 'k', launchers: new Map([['p', l]]), logger: silent, studyDay: '2026-09-10' });
    expect(l.seen).toEqual([null]);
  });

  it('a daily entry is never folded, even with a studyDay', async () => {
    const l = launcher({ doneOn: [] });
    const daily = { entries: [{ unitId: 'p:d', program: 'p', programInstance: null, cadence: 'daily' }] };
    const [row] = await collectProgramStatuses({ plan: daily, learnerId: 'k', launchers: new Map([['p', l]]), logger: silent, studyDay: '2026-09-10' });
    expect(l.seen).toEqual([null]);
    expect(row.status.weekly).toBeUndefined();
  });
});

describe('the book-log divergence, pinned', () => {
  it("a `per: week` shelf obligation still yields cadence 'daily' — a trailing window is not a Monday→Sunday week", () => {
    const plan = { entries: [], errors: [] };
    appendAssignedProgramEntries(plan, { programs: [{ programId: 'book-log', obligation: { per: 'week', target: 3 } }] });
    expect(plan.entries[0].cadence).toBe('daily');
  });
  it("an enrollment declaring cadence: weekly becomes a weekly entry", () => {
    const plan = { entries: [], errors: [] };
    appendAssignedProgramEntries(plan, { programs: [{ programId: 'piano-course', courseId: 'c1', cadence: 'weekly' }] });
    expect(plan.entries[0].cadence).toBe('weekly');
  });
});
