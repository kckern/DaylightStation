// @vitest-environment node
/**
 * A grown-up's day bypass settles ANY program's day, not only piano's.
 *
 * The ledger (`ManageProgramDayBypass`) always accepted any enrolled program,
 * but only `PianoCourseProgramLauncher` read it — so excusing a card-ladder day
 * filed a record that changed nothing. The collector now reads it for every
 * program: real completion first, the bypass only for a day nobody finished.
 */
import { describe, it, expect } from 'vitest';
import { collectProgramStatuses } from './programStatusCollection.mjs';

const plan = { entries: [{ program: 'flashcards', programInstance: 'deck-a', cadence: 'daily' }] };
const launcher = (status) => new Map([['flashcards', { status: async () => status }]]);
const bypasses = (rows) => ({
  activeFor: async ({ learnerId, programId, studyDate }) => rows.find((r) => r.learnerId === learnerId
    && r.programId === programId && r.studyDate === studyDate) ?? null,
});
const grant = { learnerId: 'test-learner', programId: 'flashcards', studyDate: '2026-09-24', decidedBy: 'test-teacher' };
const collect = (status, rows, extra = {}) => collectProgramStatuses({
  plan, learnerId: 'test-learner', launchers: launcher(status), logger: { warn() {}, debug() {} },
  studyDay: '2026-09-24', dayBypasses: bypasses(rows), ...extra,
}).then((s) => s[0].status);

describe('collectProgramStatuses — day bypass for any program', () => {
  it('settles an unfinished day and says who credited it', async () => {
    const status = await collect({ doneToday: false, progressLabel: '3 recognised' }, [grant]);
    expect(status).toMatchObject({ doneToday: true, excused: true, bypassed: true });
    expect(status.progressLabel).toBe('Credited today by test-teacher · 3 recognised');
  });

  it('real completion outranks the bypass', async () => {
    const status = await collect({ doneToday: true, progressLabel: 'done' }, [grant]);
    expect(status).toEqual({ doneToday: true, progressLabel: 'done' });
  });

  it('only the bypassed study day', async () => {
    const status = await collect({ doneToday: false }, [{ ...grant, studyDate: '2026-09-23' }]);
    expect(status.doneToday).toBe(false);
  });

  it('never masks a broken program', async () => {
    const status = await collect({ error: true }, [grant]);
    expect(status).toEqual({ error: true });
  });

  it('a replayed day with a bypass on file reads credited, not unknowable', async () => {
    const status = await collect({ doneToday: false }, [grant], { day: '2026-09-24' });
    expect(status).toMatchObject({ doneToday: true, bypassed: true });
  });

  it('a bypass store that throws leaves the status as the launcher said', async () => {
    const status = await collectProgramStatuses({
      plan, learnerId: 'test-learner', launchers: launcher({ doneToday: false }), logger: { warn() {}, debug() {} },
      studyDay: '2026-09-24', dayBypasses: { activeFor: async () => { throw new Error('disk'); } },
    }).then((s) => s[0].status);
    expect(status).toEqual({ doneToday: false });
  });
});
