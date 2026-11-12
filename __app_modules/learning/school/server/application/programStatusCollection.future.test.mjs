// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { collectProgramStatuses } from "./programStatusCollection.mjs";

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const plan = { entries: [{ unitId: 'p:d', program: 'p', programInstance: null, cadence: 'daily' }] };

function launcher({ replayable }) {
  const seen = [];
  return {
    seen, id: 'p', entryAction: null, surface: null, replayable,
    // Live (no day) is today, and today is done; any other day is untouched.
    async status({ day = null }) {
      seen.push(day);
      const done = day == null;
      return {
        doneToday: done, progressLabel: done ? 'Done' : 'Not started', score: null,
        obligationProgress: { completed: done ? 1 : 0, total: 1 },
        servedWork: done ? [{ unitId: 'p:d', title: 'P' }] : [],
      };
    },
    async launch() {},
  };
}

describe('collectProgramStatuses — a future study day', () => {
  it('asks a replayable launcher about that day, never today', async () => {
    const l = launcher({ replayable: true });
    const [row] = await collectProgramStatuses({
      plan, learnerId: 'k', launchers: new Map([['p', l]]), logger: silent,
      studyDay: '2026-11-14', futureDay: '2026-11-14',
    });
    expect(l.seen).toEqual(['2026-11-14']);
    expect(row.status.doneToday).toBe(false);
  });

  it('a non-replayable launcher keeps its live answer, but nothing in it is done yet', async () => {
    const l = launcher({ replayable: false });
    const [row] = await collectProgramStatuses({
      plan, learnerId: 'k', launchers: new Map([['p', l]]), logger: silent,
      studyDay: '2026-11-14', futureDay: '2026-11-14',
    });
    expect(l.seen).toEqual([null]);
    expect(row.status).toMatchObject({
      doneToday: false, servedWork: [], obligationProgress: { completed: 0, total: 1 },
    });
  });

  it('without futureDay, today is answered live as before', async () => {
    const l = launcher({ replayable: true });
    const [row] = await collectProgramStatuses({ plan, learnerId: 'k', launchers: new Map([['p', l]]), logger: silent });
    expect(l.seen).toEqual([null]);
    expect(row.status.doneToday).toBe(true);
  });
});
