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

describe('PrintedActivityProgramLauncher.launch', () => {
  const POOL = [
    { externalId: 'm-1', title: 'North End Labyrinth', kind: 'maze', level: 3, theme: 'city' },
    { externalId: 'm-2', title: 'Forest Path', kind: 'maze', level: 3, theme: 'forest' },
    { externalId: 'm-3', title: 'Harbour Loop', kind: 'maze', level: 3, theme: 'sea' },
  ];
  const fakePlatform = (over = {}) => ({
    id: 'beeloo',
    listActivities: vi.fn(async () => POOL),
    getPrintable: vi.fn(async (id) => Buffer.from(`pdf:${id}`)),
    ...over,
  });
  const fakePrinter = (result = { ok: true }) => ({ printPdf: vi.fn(async () => result) });
  const setup = ({ platform = fakePlatform(), printer = fakePrinter(), ...rest } = {}) => {
    const built = make({ platforms: new Map([['beeloo', platform]]), printer, ...rest });
    return { ...built, platform, printer };
  };
  const go = (launcher, corpusId = 'beeloo:maze') => launcher.launch({ userId: 'learner_a', corpusId });

  it('prints a new pick and records the issuance', async () => {
    const { launcher, store, platform, printer, log } = setup();
    const r = await go(launcher);
    expect(r).toEqual({ decision: 'dispatched', message: 'North End Labyrinth is printing.' });
    expect(platform.listActivities).toHaveBeenCalledWith({ kind: 'maze', level: 3, paper: 'letter' });
    expect(platform.getPrintable).toHaveBeenCalledWith('m-1', { paper: 'letter' });
    expect(printer.printPdf).toHaveBeenCalledWith(Buffer.from('pdf:m-1'), { jobName: 'learner_a maze m-1', user: 'learner_a', copies: 1 });
    expect(store.append).toHaveBeenCalledTimes(1);
    const rec = store.append.mock.calls[0][0];
    expect(rec).toEqual({
      issuanceId: 'pa_aaaaaaaa', learnerId: 'learner_a', programId: 'printed-activity', corpusId: 'beeloo:maze',
      platform: 'beeloo', externalId: 'm-1', title: 'North End Labyrinth', kind: 'maze', level: 3,
      issuedAt: NOW.toISOString(), issuedStudyDay: TODAY, completedAt: null, completedStudyDay: null, completedVia: null,
    });
    expect(rec.issuanceId).toMatch(/^pa_[a-z0-9]{8}$/);
    expect(log.info).toHaveBeenCalledWith('school.printed-activity.issued', expect.objectContaining({
      learnerId: 'learner_a', corpusId: 'beeloo:maze', platform: 'beeloo', externalId: 'm-1', reprint: false,
    }));
  });

  it('skips pages from its own history and pages open for anyone in the household', async () => {
    const store = fakeStore([
      issuance({ externalId: 'm-1', completedAt: '2026-11-01T17:00:00.000Z', completedStudyDay: '2026-11-01' }),
      issuance({ issuanceId: 'pa_sib', learnerId: 'learner_b', externalId: 'm-2' }),
    ]);
    const { launcher } = setup({ store });
    const r = await go(launcher);
    expect(r.decision).toBe('dispatched');
    expect(store.append.mock.calls[0][0].externalId).toBe('m-3');
  });

  it('a sibling\'s page on another platform does not exclude', async () => {
    const store = fakeStore([issuance({ issuanceId: 'pa_sib', learnerId: 'learner_b', platform: 'other', externalId: 'm-1' })]);
    const { launcher } = setup({ store });
    await go(launcher);
    expect(store.append.mock.calls[0][0].externalId).toBe('m-1');
  });

  it('reprints the open page for a lost sheet and appends nothing', async () => {
    const store = fakeStore([issuance({ externalId: 'm-2', title: 'Forest Path' })]);
    const { launcher, platform, printer, log } = setup({ store });
    const r = await go(launcher);
    expect(r).toEqual({ decision: 'dispatched', message: 'Forest Path is printing.' });
    expect(platform.listActivities).not.toHaveBeenCalled();
    expect(platform.getPrintable).toHaveBeenCalledWith('m-2', { paper: 'letter' });
    expect(printer.printPdf).toHaveBeenCalledTimes(1);
    expect(store.append).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('school.printed-activity.issued', expect.objectContaining({ reprint: true, externalId: 'm-2' }));
  });

  it('an open page in the other corpus is not reprinted here', async () => {
    const store = fakeStore([issuance({ corpusId: 'beeloo:sudoku', externalId: 's-9', kind: 'sudoku' })]);
    const { launcher } = setup({ store });
    await go(launcher);
    expect(store.append).toHaveBeenCalledTimes(1);
  });

  it('records nothing when the printer throws', async () => {
    const printer = { printPdf: vi.fn(async () => { throw new Error('offline'); }) };
    const { launcher, store, log } = setup({ printer });
    const r = await go(launcher);
    expect(r).toEqual({ decision: 'failed', message: 'The printer did not answer. Try the ticket again.' });
    expect(store.append).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith('school.printed-activity.print-failed', expect.any(Object));
  });

  it('does not record a page a dry-run printer never printed', async () => {
    const { launcher, store, log } = setup({ printer: fakePrinter({ confirmed: false }) });
    const r = await go(launcher);
    expect(r.decision).toBe('dispatched');
    expect(store.append).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('school.printed-activity.unconfirmed', expect.objectContaining({ externalId: 'm-1', recorded: false }));
  });

  it('says the level is used up when every page is excluded', async () => {
    const store = fakeStore(POOL.map((p, i) => issuance({ issuanceId: `pa_${i}`, externalId: p.externalId, completedAt: 'x', completedStudyDay: '2026-11-01' })));
    const { launcher, printer, log } = setup({ store });
    const r = await go(launcher);
    expect(r).toEqual({ decision: 'failed', message: 'No new maze pages left at this level. Ask a grown-up.' });
    expect(printer.printPdf).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith('school.printed-activity.pool-exhausted', expect.any(Object));
  });

  it('fails when the platform is not configured', async () => {
    const { launcher, log } = make({ printer: fakePrinter() });
    const r = await go(launcher);
    expect(r).toEqual({ decision: 'failed', message: 'Worksheets are unavailable right now. Ask a grown-up.' });
    expect(log.warn).toHaveBeenCalledWith('school.printed-activity.platform-missing', expect.any(Object));
  });

  it('fails when the platform throws listing or fetching', async () => {
    for (const over of [
      { listActivities: vi.fn(async () => { throw new Error('beeloo down'); }) },
      { getPrintable: vi.fn(async () => { throw new Error('beeloo down'); }) },
    ]) {
      const { launcher, store, printer, log } = setup({ platform: fakePlatform(over) });
      const r = await go(launcher);
      expect(r).toEqual({ decision: 'failed', message: 'Worksheets are unavailable right now. Ask a grown-up.' });
      expect(printer.printPdf).not.toHaveBeenCalled();
      expect(store.append).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith('school.printed-activity.platform-failed', expect.any(Object));
    }
  });

  it('answers a page race when a sibling takes the page between pick and append', async () => {
    const store = fakeStore();
    store.append.mockRejectedValueOnce(Object.assign(new Error('already open'), { code: 'PAGE_ALREADY_OPEN', heldBy: 'learner_b' }));
    const { launcher, log } = setup({ store });
    const r = await go(launcher);
    expect(r).toEqual({ decision: 'failed', message: 'That page was just given to someone else. Scan the ticket again.' });
    expect(log.warn).toHaveBeenCalledWith('school.printed-activity.page-race', expect.any(Object));
  });

  it('fails with an error log when the append fails for another reason', async () => {
    const store = fakeStore();
    store.append.mockRejectedValueOnce(new Error('disk full'));
    const { launcher, log } = setup({ store });
    const r = await go(launcher);
    expect(r.decision).toBe('failed');
    expect(log.error).toHaveBeenCalledWith('school.printed-activity.record-failed', expect.any(Object));
  });

  it('refuses a corpus the learner is not assigned', async () => {
    const { launcher, printer } = setup({ programs: [SUDOKU] });
    expect(await go(launcher)).toEqual({ decision: 'failed', message: 'This activity is not assigned.' });
    expect(printer.printPdf).not.toHaveBeenCalled();
  });

  it('refuses an invalid entry as not assigned', async () => {
    const { launcher } = setup({ programs: [{ ...MAZE, activity: { platform: 'beeloo' } }] });
    expect(await go(launcher)).toEqual({ decision: 'failed', message: 'This activity is not assigned.' });
  });

  it('fails honestly with no printer', async () => {
    const { launcher, platform } = setup({ printer: null });
    expect(await go(launcher)).toEqual({ decision: 'failed', message: 'The printer is not set up. Ask a grown-up.' });
    expect(platform.listActivities).not.toHaveBeenCalled();
  });

  it('never throws, even when the store does', async () => {
    const store = fakeStore();
    store.listForLearner.mockRejectedValue(new Error('boom'));
    const { launcher } = setup({ store });
    await expect(go(launcher)).resolves.toMatchObject({ decision: 'failed' });
  });
});
