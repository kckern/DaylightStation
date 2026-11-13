import { describe, expect, it, vi } from 'vitest';
import { PrintedActivityProgramLauncher } from './PrintedActivityProgramLauncher.mjs';

const NOW = new Date('2026-11-13T18:00:00Z');
const TODAY = '2026-11-13';

const MAZE = {
  programId: 'printed-activity', corpusId: 'beeloo:maze', subject: 'arts', title: 'Maze', target: 1,
  activity: { platform: 'beeloo', kind: 'maze', level: 3, paper: 'letter' },
};
const SUDOKU = {
  programId: 'printed-activity', corpusId: 'beeloo:sudoku', subject: 'math', title: 'Sudoku', target: 1,
  activity: { platform: 'beeloo', kind: 'sudoku', level: 3, paper: 'letter' },
};

const issuance = (over) => ({
  issuanceId: 'pa_00000000', learnerId: 'learner_a', programId: 'printed-activity', corpusId: 'beeloo:maze',
  platform: 'beeloo', externalId: 'm-1', title: 'North End Labyrinth', kind: 'maze', level: 3,
  issuedAt: '2026-11-13T15:00:00.000Z', issuedStudyDay: TODAY,
  completedAt: null, completedStudyDay: null, completedVia: null, ...over,
});

/** In-memory store; `append` enforces one open issuance per page like the real one. */
function fakeStore(rows = []) {
  const all = [...rows];
  return {
    rows: all,
    append: vi.fn(async (i) => {
      const holder = all.find((r) => r.completedAt == null && r.platform === i.platform && r.externalId === i.externalId);
      if (holder) throw Object.assign(new Error('already open'), { code: 'PAGE_ALREADY_OPEN', heldBy: holder.learnerId });
      all.push({ ...i });
      return i;
    }),
    listForLearner: vi.fn(async (learnerId) => all.filter((r) => r.learnerId === learnerId)),
    listOpenAll: vi.fn(async () => all.filter((r) => r.completedAt == null)),
    listCompletedForDay: vi.fn(async (learnerId, corpusId, day) => all.filter((r) => r.learnerId === learnerId
      && r.corpusId === corpusId && r.completedStudyDay === day)),
  };
}

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function make({ programs = [MAZE, SUDOKU], assignment, store = fakeStore(), platforms, printer, rng = () => 0 } = {}) {
  const log = logger();
  const launcher = new PrintedActivityProgramLauncher({
    assignments: { get: vi.fn(async () => (assignment !== undefined ? assignment : { programs })) },
    store,
    platforms: platforms ?? new Map(),
    printer: printer === undefined ? null : printer,
    clock: () => NOW,
    rng,
    logger: log,
  });
  return { launcher, store, log };
}

describe('PrintedActivityProgramLauncher — identity', () => {
  it('answers the launcher getters', () => {
    const { launcher } = make();
    expect(launcher.id).toBe('printed-activity');
    expect(launcher.locationHint).toBe('on the printer');
    expect(launcher.surface).toBeNull();
    expect(launcher.entryAction).toBeNull();
    expect(launcher.replayable).toBe(true);
  });

  it('requires its injected dependencies', () => {
    const base = { assignments: {}, store: {}, clock: () => NOW, rng: () => 0, logger: logger() };
    for (const key of ['assignments', 'store', 'clock', 'rng', 'logger']) {
      expect(() => new PrintedActivityProgramLauncher({ ...base, [key]: undefined })).toThrow();
    }
  });
});

describe('PrintedActivityProgramLauncher.status', () => {
  it('is open with nothing completed today', async () => {
    const { launcher } = make();
    const s = await launcher.status({ userId: 'learner_a', programInstance: 'beeloo:maze' });
    expect(s).toMatchObject({
      error: false, enrolled: true, doneToday: false, progressLabel: '0 of 1 sheet', score: null,
      terminal: false, subject: 'arts', obligationProgress: { completed: 0, total: 1 }, servedWork: [],
    });
  });

  it('is done once a sheet is completed today, and names the page', async () => {
    const store = fakeStore([issuance({ completedAt: '2026-11-13T17:00:00.000Z', completedStudyDay: TODAY, completedVia: 'scan' })]);
    const { launcher } = make({ store });
    const s = await launcher.status({ userId: 'learner_a', programInstance: 'beeloo:maze' });
    expect(s).toMatchObject({ error: false, doneToday: true, progressLabel: '1 of 1 sheet', obligationProgress: { completed: 1, total: 1 } });
    expect(s.servedWork).toEqual([{ unitId: 'printed-activity:beeloo:maze', title: 'Maze: North End Labyrinth' }]);
    expect(s.servedWork[0]).not.toHaveProperty('assignmentUnitId');
  });

  it('names the most recently completed page when several are done', async () => {
    const store = fakeStore([
      issuance({ issuanceId: 'pa_b', externalId: 'm-2', title: 'Later Maze', completedAt: '2026-11-13T17:30:00.000Z', completedStudyDay: TODAY }),
      issuance({ issuanceId: 'pa_a', completedAt: '2026-11-13T16:00:00.000Z', completedStudyDay: TODAY }),
    ]);
    const { launcher } = make({ store, programs: [{ ...MAZE, target: 2 }] });
    const s = await launcher.status({ userId: 'learner_a', programInstance: 'beeloo:maze' });
    expect(s.progressLabel).toBe('2 of 2 sheets');
    expect(s.servedWork).toEqual([{ unitId: 'printed-activity:beeloo:maze', title: 'Maze: Later Maze' }]);
  });

  it('does not count a completion in the other corpus', async () => {
    const store = fakeStore([issuance({ corpusId: 'beeloo:sudoku', kind: 'sudoku', completedAt: '2026-11-13T17:00:00.000Z', completedStudyDay: TODAY })]);
    const { launcher } = make({ store });
    const s = await launcher.status({ userId: 'learner_a', programInstance: 'beeloo:maze' });
    expect(s.doneToday).toBe(false);
    expect(s.servedWork).toEqual([]);
  });

  it('answers not enrolled without error for a corpus the learner does not hold', async () => {
    const { launcher } = make({ programs: [SUDOKU] });
    const s = await launcher.status({ userId: 'learner_a', programInstance: 'beeloo:maze' });
    expect(s).toEqual({
      error: false, enrolled: false, doneToday: false, progressLabel: 'No printed activity', score: null,
      terminal: false, obligationProgress: null, servedWork: [],
    });
  });

  it('is unavailable when the assignment cannot be read', async () => {
    const { launcher, log } = make({ assignment: null });
    const s = await launcher.status({ userId: 'learner_a', programInstance: 'beeloo:maze' });
    expect(s).toMatchObject({ error: true, enrolled: null, doneToday: false, progressLabel: 'Printed activity unavailable', servedWork: [] });
    expect(log.error).toHaveBeenCalledWith('school.printed-activity.enrollment-unreadable', expect.any(Object));
  });

  it('is unavailable when the entry is invalid', async () => {
    const { launcher, log } = make({ programs: [{ ...MAZE, subject: 'not-a-subject' }] });
    const s = await launcher.status({ userId: 'learner_a', programInstance: 'beeloo:maze' });
    expect(s.error).toBe(true);
    expect(log.error).toHaveBeenCalledWith('school.printed-activity.entry-invalid', expect.objectContaining({ errors: expect.any(Array) }));
  });

  it('reads the day it is asked for', async () => {
    const store = fakeStore([issuance({ completedAt: '2026-11-10T17:00:00.000Z', completedStudyDay: '2026-11-10' })]);
    const { launcher } = make({ store });
    const s = await launcher.status({ userId: 'learner_a', programInstance: 'beeloo:maze', day: '2026-11-10' });
    expect(store.listCompletedForDay).toHaveBeenCalledWith('learner_a', 'beeloo:maze', '2026-11-10');
    expect(s.doneToday).toBe(true);
  });

  it('reads today by default', async () => {
    const { launcher, store } = make();
    await launcher.status({ userId: 'learner_a', programInstance: 'beeloo:maze' });
    expect(store.listCompletedForDay).toHaveBeenCalledWith('learner_a', 'beeloo:maze', TODAY);
  });

  it('is unavailable, not zero, when the store throws', async () => {
    const store = fakeStore();
    store.listCompletedForDay.mockRejectedValue(new Error('disk gone'));
    const { launcher } = make({ store });
    const s = await launcher.status({ userId: 'learner_a', programInstance: 'beeloo:maze' });
    expect(s).toMatchObject({ error: true, enrolled: true, doneToday: false });
  });
});
