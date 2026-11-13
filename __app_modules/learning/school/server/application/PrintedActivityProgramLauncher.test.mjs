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

const isOpen = (r) => r.completedAt == null && r.voidedAt == null;

/**
 * In-memory store with the real store's refusals, by `code`: duplicate id,
 * one open sheet per learner+corpus (`held`), one open issuance per page
 * (`heldBy`). `calls` records append/void order against the printer.
 */
function fakeStore(rows = [], calls = []) {
  const all = rows.map((r) => ({ voidedAt: null, voidReason: null, ...r }));
  return {
    rows: all,
    calls,
    append: vi.fn(async (i) => {
      calls.push(`append:${i.externalId}`);
      if (all.some((r) => r.learnerId === i.learnerId && r.issuanceId === i.issuanceId)) {
        throw Object.assign(new Error('dup'), { code: 'DUPLICATE_ISSUANCE_ID' });
      }
      const held = all.find((r) => isOpen(r) && r.learnerId === i.learnerId && r.corpusId === i.corpusId);
      if (held) throw Object.assign(new Error('corpus open'), { code: 'CORPUS_ALREADY_OPEN', held });
      const holder = all.find((r) => isOpen(r) && r.platform === i.platform && r.externalId === i.externalId);
      if (holder) {
        throw Object.assign(new Error('already open'), {
          code: 'PAGE_ALREADY_OPEN', heldBy: holder.learnerId, issuanceId: holder.issuanceId, externalId: i.externalId,
        });
      }
      all.push({ ...i, voidedAt: null, voidReason: null });
      return i;
    }),
    void: vi.fn(async (learnerId, issuanceId, { at, reason }) => {
      calls.push(`void:${reason}`);
      const row = all.find((r) => r.learnerId === learnerId && r.issuanceId === issuanceId);
      if (!row) return { status: 'missing', issuance: null };
      Object.assign(row, { voidedAt: at, voidReason: reason });
      return { status: 'voided', issuance: row };
    }),
    markPrinted: vi.fn(async (learnerId, issuanceId, { at }) => {
      const row = all.find((r) => r.learnerId === learnerId && r.issuanceId === issuanceId);
      calls.push(`mark:${row?.externalId ?? issuanceId}`);
      if (!row) return { status: 'missing', issuance: null };
      Object.assign(row, { lastPrintedAt: at });
      return { status: 'marked', issuance: row };
    }),
    listForLearner: vi.fn(async (learnerId) => all.filter((r) => r.learnerId === learnerId)),
    listOpenAll: vi.fn(async () => all.filter(isOpen)),
    listIssuedExternalIds: vi.fn(async (platform) => [...new Set(all
      .filter((r) => r.platform === platform && r.voidedAt == null).map((r) => r.externalId))]),
    listCompletedForDay: vi.fn(async (learnerId, corpusId, day) => all.filter((r) => r.learnerId === learnerId
      && r.corpusId === corpusId && r.voidedAt == null && r.completedStudyDay === day)),
  };
}

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** A platform that is wired; `status()` only asks whether one is. */
const WIRED = () => new Map([['beeloo', { id: 'beeloo' }]]);

function make({
  programs = [MAZE, SUDOKU], assignment, store = fakeStore(), platforms, printer, rng = () => 0,
  clock = () => NOW, timezone = null, log = logger(), reprintCooldownMs,
} = {}) {
  const launcher = new PrintedActivityProgramLauncher({
    assignments: { get: vi.fn(async () => (assignment !== undefined ? assignment : { programs })) },
    store,
    platforms: platforms ?? WIRED(),
    printer: printer === undefined ? null : printer,
    timezone,
    clock,
    rng,
    logger: log,
    ...(reprintCooldownMs === undefined ? {} : { reprintCooldownMs }),
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

  it('refuses a reprint cooldown that is not a number >= 0', () => {
    const base = { assignments: {}, store: {}, clock: () => NOW, rng: () => 0, logger: logger() };
    for (const reprintCooldownMs of [-1, 'ten', NaN, Infinity]) {
      expect(() => new PrintedActivityProgramLauncher({ ...base, reprintCooldownMs })).toThrow(/reprintCooldownMs/);
    }
    expect(() => new PrintedActivityProgramLauncher({ ...base, reprintCooldownMs: 0 })).not.toThrow();
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

  it('is unavailable, not "0 of 1", when the log is corrupt (LOG_UNREADABLE)', async () => {
    const store = fakeStore();
    store.listCompletedForDay.mockRejectedValue(Object.assign(new Error('corrupt'), { code: 'LOG_UNREADABLE' }));
    const { launcher, log } = make({ store });
    const s = await launcher.status({ userId: 'learner_a', programInstance: 'beeloo:maze' });
    expect(s).toMatchObject({ error: true, enrolled: true, doneToday: false, progressLabel: 'Printed activity unavailable' });
    expect(log.error).toHaveBeenCalledWith('school.printed-activity.log-unreadable', expect.objectContaining({ code: 'LOG_UNREADABLE' }));
  });

  it('is unavailable when its platform is not wired, rather than offering a ticket that can only fail', async () => {
    const { launcher, store, log } = make({ platforms: new Map() });
    const s = await launcher.status({ userId: 'learner_a', programInstance: 'beeloo:maze' });
    expect(s).toEqual({
      error: true, enrolled: true, doneToday: false, progressLabel: 'Worksheets unavailable', score: null,
      terminal: false, obligationProgress: null, servedWork: [],
    });
    expect(store.listCompletedForDay).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith('school.printed-activity.platform-missing', expect.objectContaining({ platform: 'beeloo' }));
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe('PrintedActivityProgramLauncher — study day', () => {
  it('reads the household timezone for the default day', async () => {
    const { launcher, store } = make({ clock: () => new Date('2026-11-14T11:30:00Z'), timezone: 'America/Los_Angeles' });
    expect(launcher.studyDay()).toBe('2026-11-13');
    await launcher.status({ userId: 'learner_a', programInstance: 'beeloo:maze' });
    expect(store.listCompletedForDay).toHaveBeenCalledWith('learner_a', 'beeloo:maze', '2026-11-13');
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
  const fakePrinter = (calls, result = { ok: true }) => ({
    printPdf: vi.fn(async (bytes) => { calls?.push(`print:${String(bytes).slice(4)}`); return result; }),
  });
  const setup = ({ calls = [], store, platform = fakePlatform(), printer, ...rest } = {}) => {
    const s = store ?? fakeStore([], calls);
    const p = printer === undefined ? fakePrinter(s.calls) : printer;
    const built = make({ platforms: new Map([['beeloo', platform]]), printer: p, store: s, ...rest });
    return { ...built, platform, printer: p, calls: s.calls };
  };
  const go = (launcher, corpusId = 'beeloo:maze') => launcher.launch({ userId: 'learner_a', corpusId });
  const raceErr = (heldBy, externalId = 'm-1') => Object.assign(new Error('already open'), {
    code: 'PAGE_ALREADY_OPEN', heldBy, issuanceId: 'pa_held', externalId,
  });

  it('reserves a new pick, then prints it', async () => {
    const { launcher, store, platform, printer, log, calls } = setup();
    const r = await go(launcher);
    expect(r).toEqual({ decision: 'dispatched', message: 'North End Labyrinth is printing.' });
    expect(calls).toEqual(['append:m-1', 'print:m-1', 'mark:m-1']);
    expect(store.markPrinted).toHaveBeenCalledWith('learner_a', 'pa_aaaaaaaa', { at: NOW.toISOString() });
    expect(platform.listActivities).toHaveBeenCalledWith({ kind: 'maze', level: 3, paper: 'letter' });
    expect(platform.getPrintable).toHaveBeenCalledWith('m-1', { paper: 'letter' });
    expect(printer.printPdf).toHaveBeenCalledWith(Buffer.from('pdf:m-1'), { jobName: 'learner_a maze m-1', user: 'learner_a', copies: 1 });
    const rec = store.append.mock.calls[0][0];
    expect(rec).toEqual({
      issuanceId: 'pa_aaaaaaaa', learnerId: 'learner_a', programId: 'printed-activity', corpusId: 'beeloo:maze',
      platform: 'beeloo', externalId: 'm-1', title: 'North End Labyrinth', kind: 'maze', level: 3,
      issuedAt: NOW.toISOString(), issuedStudyDay: TODAY, completedAt: null, completedStudyDay: null, completedVia: null,
    });
    expect(rec.issuanceId).toMatch(/^pa_[a-z0-9]{8}$/);
    expect(store.void).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('school.printed-activity.issued', expect.objectContaining({
      learnerId: 'learner_a', corpusId: 'beeloo:maze', platform: 'beeloo', externalId: 'm-1', reprint: false,
    }));
  });

  it('reads the clock once: issuedAt and issuedStudyDay name the same instant', async () => {
    const clock = vi.fn(() => new Date('2026-11-14T11:30:00Z'));
    const { launcher, store } = setup({ clock, timezone: 'America/Los_Angeles' });
    await go(launcher);
    expect(clock).toHaveBeenCalledTimes(1);
    expect(store.append.mock.calls[0][0]).toMatchObject({ issuedAt: '2026-11-14T11:30:00.000Z', issuedStudyDay: '2026-11-13' });
  });

  it('skips every page issued in the household: completed or open, any learner', async () => {
    const store = fakeStore([
      issuance({ externalId: 'm-1', completedAt: '2026-11-01T17:00:00.000Z', completedStudyDay: '2026-11-01' }),
      issuance({ issuanceId: 'pa_sib', learnerId: 'learner_b', externalId: 'm-2' }),
    ]);
    const { launcher } = setup({ store });
    expect((await go(launcher)).decision).toBe('dispatched');
    expect(store.append.mock.calls[0][0].externalId).toBe('m-3');
  });

  it('never picks a page a sibling completed, so an old copy cannot credit this child', async () => {
    const store = fakeStore([
      issuance({ issuanceId: 'pa_s1', learnerId: 'learner_b', externalId: 'm-1', completedAt: '2026-11-01T17:00:00.000Z', completedStudyDay: '2026-11-01' }),
      issuance({ issuanceId: 'pa_s2', learnerId: 'learner_b', corpusId: 'beeloo:sudoku', externalId: 'm-2', completedAt: '2026-11-02T17:00:00.000Z', completedStudyDay: '2026-11-02' }),
    ]);
    const { launcher } = setup({ store });
    expect((await go(launcher)).decision).toBe('dispatched');
    expect(store.append.mock.calls[0][0].externalId).toBe('m-3');
    expect(store.listIssuedExternalIds).toHaveBeenCalledWith('beeloo');
  });

  it('a page a sibling had voided is eligible again: it never reached paper', async () => {
    const store = fakeStore([issuance({
      issuanceId: 'pa_s1', learnerId: 'learner_b', externalId: 'm-1', voidedAt: '2026-11-01T17:00:00.000Z', voidReason: 'print-failed',
    })]);
    const { launcher } = setup({ store });
    await go(launcher);
    expect(store.append.mock.calls[0][0].externalId).toBe('m-1');
  });

  it('a voided page is not history: the child never got it', async () => {
    const store = fakeStore([issuance({ externalId: 'm-1', voidedAt: '2026-11-01T17:00:00.000Z', voidReason: 'print-failed' })]);
    const { launcher } = setup({ store });
    await go(launcher);
    expect(store.append.mock.calls[0][0].externalId).toBe('m-1');
  });

  it('pages issued on another platform, to any learner, do not exclude', async () => {
    const store = fakeStore([
      issuance({ platform: 'other', externalId: 'm-1', completedAt: 'x', completedStudyDay: '2026-11-01' }),
      issuance({ issuanceId: 'pa_sib', learnerId: 'learner_b', platform: 'other', externalId: 'm-1' }),
    ]);
    const { launcher } = setup({ store });
    await go(launcher);
    expect(store.append.mock.calls[0][0].externalId).toBe('m-1');
  });

  it('reprints the open page for a lost sheet: no append, no void', async () => {
    const store = fakeStore([issuance({ externalId: 'm-2', title: 'Forest Path' })]);
    const { launcher, platform, printer, log } = setup({ store });
    const r = await go(launcher);
    expect(r).toEqual({ decision: 'dispatched', message: 'Forest Path is printing.' });
    expect(platform.listActivities).not.toHaveBeenCalled();
    expect(platform.getPrintable).toHaveBeenCalledWith('m-2', { paper: 'letter' });
    expect(printer.printPdf).toHaveBeenCalledTimes(1);
    expect(store.append).not.toHaveBeenCalled();
    expect(store.void).not.toHaveBeenCalled();
    expect(store.markPrinted).toHaveBeenCalledWith('learner_a', 'pa_00000000', { at: NOW.toISOString() });
    expect(log.info).toHaveBeenCalledWith('school.printed-activity.issued', expect.objectContaining({ reprint: true, externalId: 'm-2' }));
  });

  describe('reprint cooldown', () => {
    const at = (iso) => () => new Date(iso);

    it('refuses a reprint inside the cooldown, printing nothing', async () => {
      // Issued 15:00, last printed 17:55; NOW is 18:00, inside the default 10 minutes.
      const store = fakeStore([issuance({ externalId: 'm-2', lastPrintedAt: '2026-11-13T17:55:00.000Z' })]);
      const { launcher, printer, platform, log } = setup({ store });
      expect(await go(launcher)).toEqual({ decision: 'failed', message: 'That sheet just printed. Check the printer tray.' });
      expect(printer.printPdf).not.toHaveBeenCalled();
      expect(platform.getPrintable).not.toHaveBeenCalled();
      expect(store.markPrinted).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith('school.printed-activity.reprint-cooldown', expect.objectContaining({
        userId: 'learner_a', corpusId: 'beeloo:maze', externalId: 'm-2', lastPrintedAt: '2026-11-13T17:55:00.000Z',
      }));
    });

    it('reprints again once the cooldown has passed, and records the new print', async () => {
      const store = fakeStore([issuance({ externalId: 'm-2', lastPrintedAt: '2026-11-13T17:55:00.000Z' })]);
      const { launcher, printer } = setup({ store, clock: at('2026-11-13T18:05:00.000Z') });
      expect((await go(launcher)).decision).toBe('dispatched');
      expect(printer.printPdf).toHaveBeenCalledTimes(1);
      expect(store.rows[0].lastPrintedAt).toBe('2026-11-13T18:05:00.000Z');
    });

    it('a second scan right after a reprint is refused: the reprint reset the clock', async () => {
      const store = fakeStore([issuance({ externalId: 'm-2' })]);
      const { launcher, printer } = setup({ store });
      expect((await go(launcher)).decision).toBe('dispatched');
      expect((await go(launcher)).message).toBe('That sheet just printed. Check the printer tray.');
      expect(printer.printPdf).toHaveBeenCalledTimes(1);
    });

    it('an old row without lastPrintedAt falls back to issuedAt', async () => {
      const store = fakeStore([issuance({ externalId: 'm-2', issuedAt: '2026-11-13T17:58:00.000Z' })]);
      const { launcher, printer } = setup({ store });
      expect((await go(launcher)).message).toBe('That sheet just printed. Check the printer tray.');
      expect(printer.printPdf).not.toHaveBeenCalled();
    });

    it('honours the configured cooldown', async () => {
      const store = fakeStore([issuance({ externalId: 'm-2', lastPrintedAt: '2026-11-13T17:58:00.000Z' })]);
      const { launcher, printer } = setup({ store, reprintCooldownMs: 60_000 });
      expect((await go(launcher)).decision).toBe('dispatched');
      expect(printer.printPdf).toHaveBeenCalledTimes(1);
    });

    it('a print that fails or is unconfirmed does not reset the clock', async () => {
      const calls = [];
      const store = fakeStore([issuance({ externalId: 'm-2' })], calls);
      const { launcher } = setup({ store, printer: fakePrinter(calls, { confirmed: false }) });
      await go(launcher);
      expect(store.markPrinted).not.toHaveBeenCalled();
    });

    it('a failed markPrinted is logged and the answer is still dispatched', async () => {
      const store = fakeStore();
      store.markPrinted.mockRejectedValueOnce(new Error('disk'));
      const { launcher, log } = setup({ store });
      expect((await go(launcher)).decision).toBe('dispatched');
      expect(log.warn).toHaveBeenCalledWith('school.printed-activity.mark-printed-failed', expect.objectContaining({ error: 'disk' }));
    });
  });

  it('reprints the newest of several open pages and warns', async () => {
    const store = fakeStore([
      issuance({ issuanceId: 'pa_new', externalId: 'm-3', title: 'Harbour Loop', issuedAt: '2026-11-13T16:00:00.000Z' }),
      issuance({ issuanceId: 'pa_old', externalId: 'm-2', title: 'Forest Path', issuedAt: '2026-11-12T16:00:00.000Z' }),
    ]);
    const { launcher, platform, log } = setup({ store });
    expect((await go(launcher)).message).toBe('Harbour Loop is printing.');
    expect(platform.getPrintable).toHaveBeenCalledWith('m-3', { paper: 'letter' });
    expect(log.warn).toHaveBeenCalledWith('school.printed-activity.multiple-open', {
      userId: 'learner_a', corpusId: 'beeloo:maze', issuanceIds: ['pa_new', 'pa_old'],
    });
  });

  it('an unconfirmed reprint is still a reprint: nothing voided', async () => {
    const calls = [];
    const store = fakeStore([issuance({ externalId: 'm-2', title: 'Forest Path' })], calls);
    const { launcher, log } = setup({ store, printer: fakePrinter(calls, { confirmed: false }) });
    expect((await go(launcher)).decision).toBe('dispatched');
    expect(store.void).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('school.printed-activity.unconfirmed', expect.objectContaining({ reprint: true }));
  });

  it('an open page in the other corpus is not reprinted here', async () => {
    const store = fakeStore([issuance({ corpusId: 'beeloo:sudoku', externalId: 's-9', kind: 'sudoku' })]);
    const { launcher } = setup({ store });
    await go(launcher);
    expect(store.append).toHaveBeenCalledTimes(1);
  });

  describe('double scan', () => {
    it('CORPUS_ALREADY_OPEN inside the cooldown is the sheet that just came out: no second print', async () => {
      const store = fakeStore();
      const held = issuance({ issuanceId: 'pa_win', externalId: 'm-2', title: 'Forest Path', issuedAt: NOW.toISOString() });
      store.append.mockRejectedValueOnce(Object.assign(new Error('corpus open'), { code: 'CORPUS_ALREADY_OPEN', held }));
      const { launcher, printer, log } = setup({ store });
      expect(await go(launcher)).toEqual({ decision: 'failed', message: 'That sheet just printed. Check the printer tray.' });
      expect(printer.printPdf).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith('school.printed-activity.reprint-cooldown', expect.objectContaining({ externalId: 'm-2' }));
    });

    it('CORPUS_ALREADY_OPEN reprints the held page and appends nothing more', async () => {
      const store = fakeStore();
      const held = issuance({ issuanceId: 'pa_win', externalId: 'm-2', title: 'Forest Path' });
      store.append.mockRejectedValueOnce(Object.assign(new Error('corpus open'), { code: 'CORPUS_ALREADY_OPEN', held }));
      const { launcher, platform, printer } = setup({ store });
      expect(await go(launcher)).toEqual({ decision: 'dispatched', message: 'Forest Path is printing.' });
      expect(store.append).toHaveBeenCalledTimes(1);
      expect(platform.getPrintable).toHaveBeenLastCalledWith('m-2', { paper: 'letter' });
      expect(printer.printPdf).toHaveBeenCalledTimes(1);
      expect(store.void).not.toHaveBeenCalled();
    });

    it('PAGE_ALREADY_OPEN held by this learner (another corpus) picks again, never borrows that sheet', async () => {
      // The store checks the corpus before the page, so a page this learner
      // holds can only be held under ANOTHER corpus. Reprinting it here would
      // let this ticket's scan credit the other corpus.
      const calls = [];
      const store = fakeStore([], calls);
      store.append.mockRejectedValueOnce(raceErr('learner_a'));
      const { launcher } = setup({ store });
      expect(await go(launcher)).toEqual({ decision: 'dispatched', message: 'Forest Path is printing.' });
      expect(store.append.mock.calls.map(([i]) => i.externalId)).toEqual(['m-1', 'm-2']);
      expect(calls.filter((c) => c.startsWith('print:'))).toEqual(['print:m-2']);
    });

    it('two concurrent launches end with one reservation and one print; the second is told it just printed', async () => {
      let k = 0;
      const { launcher, store, printer } = setup({ rng: () => ((k++ * 0.37) % 1) });
      const results = await Promise.all([go(launcher), go(launcher)]);
      expect(results).toEqual([
        { decision: 'dispatched', message: expect.stringMatching(/is printing\.$/) },
        { decision: 'failed', message: 'That sheet just printed. Check the printer tray.' },
      ]);
      expect(store.rows).toHaveLength(1);
      const printed = printer.printPdf.mock.calls.map(([b]) => String(b));
      expect(printed).toEqual([`pdf:${store.rows[0].externalId}`]);
    });

    it('with no cooldown, two concurrent launches print the same page twice', async () => {
      let k = 0;
      const { launcher, store, printer } = setup({ rng: () => ((k++ * 0.37) % 1), reprintCooldownMs: 0 });
      const results = await Promise.all([go(launcher), go(launcher)]);
      expect(results.map((r) => r.decision)).toEqual(['dispatched', 'dispatched']);
      expect(store.rows).toHaveLength(1);
      const printed = printer.printPdf.mock.calls.map(([b]) => String(b));
      expect(printed).toEqual([`pdf:${store.rows[0].externalId}`, `pdf:${store.rows[0].externalId}`]);
    });
  });

  describe('sibling race', () => {
    it('picks again once, excluding the lost page, and prints nothing for the lost one', async () => {
      const calls = [];
      const store = fakeStore([], calls);
      store.append.mockRejectedValueOnce(raceErr('learner_b'));
      const { launcher, log } = setup({ store });
      expect(await go(launcher)).toEqual({ decision: 'dispatched', message: 'Forest Path is printing.' });
      expect(store.append.mock.calls.map(([i]) => i.externalId)).toEqual(['m-1', 'm-2']);
      expect(calls.filter((c) => c.startsWith('print:'))).toEqual(['print:m-2']);
      expect(log.warn).toHaveBeenCalledWith('school.printed-activity.page-race', expect.objectContaining({ heldBy: 'learner_b' }));
    });

    it('a second race answers the race message and prints nothing', async () => {
      const store = fakeStore();
      store.append.mockRejectedValueOnce(raceErr('learner_b')).mockRejectedValueOnce(raceErr('learner_b', 'm-2'));
      const { launcher, printer } = setup({ store });
      expect(await go(launcher)).toEqual({ decision: 'failed', message: 'That page was just given to someone else. Scan the ticket again.' });
      expect(printer.printPdf).not.toHaveBeenCalled();
    });
  });

  it('retries a duplicate issuance id once with a fresh id', async () => {
    let n = 0;
    const store = fakeStore();
    store.append.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'DUPLICATE_ISSUANCE_ID' }));
    const { launcher } = setup({ store, rng: () => { n += 1; return n > 8 ? 0.99 : 0; } });
    expect((await go(launcher)).decision).toBe('dispatched');
    const ids = store.append.mock.calls.map(([i]) => i.issuanceId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('a printer throw voids the reservation and answers failed', async () => {
    const calls = [];
    const store = fakeStore([], calls);
    const printer = { printPdf: vi.fn(async () => { throw new Error('offline'); }) };
    const { launcher, log } = setup({ store, printer });
    expect(await go(launcher)).toEqual({ decision: 'failed', message: 'The printer did not answer. Try the ticket again.' });
    expect(calls).toEqual(['append:m-1', 'void:print-failed']);
    expect(store.void).toHaveBeenCalledWith('learner_a', 'pa_aaaaaaaa', { at: NOW.toISOString(), reason: 'print-failed' });
    expect(log.warn).toHaveBeenCalledWith('school.printed-activity.print-failed', expect.any(Object));
    expect(await store.listOpenAll()).toEqual([]);
  });

  it('a failed void is logged and the answer is still failed', async () => {
    const store = fakeStore();
    store.void.mockRejectedValueOnce(new Error('disk'));
    const printer = { printPdf: vi.fn(async () => { throw new Error('offline'); }) };
    const { launcher, log } = setup({ store, printer });
    expect((await go(launcher)).decision).toBe('failed');
    expect(log.error).toHaveBeenCalledWith('school.printed-activity.void-failed', expect.objectContaining({ reason: 'print-failed' }));
  });

  it('a dry-run printer voids the new reservation but still answers dispatched', async () => {
    const calls = [];
    const store = fakeStore([], calls);
    const { launcher, log } = setup({ store, printer: fakePrinter(calls, { confirmed: false }) });
    expect((await go(launcher)).decision).toBe('dispatched');
    expect(calls).toEqual(['append:m-1', 'print:m-1', 'void:print-unconfirmed']);
    expect(log.info).toHaveBeenCalledWith('school.printed-activity.unconfirmed', expect.objectContaining({ externalId: 'm-1', reprint: false }));
  });

  it('says the level is used up when every page is excluded, after one fresh sample', async () => {
    const store = fakeStore(POOL.map((p, i) => issuance({ issuanceId: `pa_${i}`, externalId: p.externalId, completedAt: 'x', completedStudyDay: '2026-11-01' })));
    const { launcher, printer, log, platform } = setup({ store });
    expect(await go(launcher)).toEqual({ decision: 'failed', message: 'No new maze pages left at this level. Ask a grown-up.' });
    expect(platform.listActivities).toHaveBeenCalledTimes(2);
    expect(printer.printPdf).not.toHaveBeenCalled();
    expect(store.append).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith('school.printed-activity.pool-exhausted', expect.objectContaining({ resampled: true }));
  });

  it('an exhausted sample is retried once: the platform samples, so a fresh list can hold new pages', async () => {
    const store = fakeStore(POOL.map((p, i) => issuance({ issuanceId: `pa_${i}`, externalId: p.externalId, completedAt: 'x', completedStudyDay: '2026-11-01' })));
    const fresh = [...POOL, { externalId: 'm-4', title: 'Mountain Pass', kind: 'maze', level: 3, theme: null }];
    const platform = fakePlatform({ listActivities: vi.fn().mockResolvedValueOnce(POOL).mockResolvedValueOnce(fresh) });
    const { launcher, log } = setup({ store, platform });
    expect(await go(launcher)).toEqual({ decision: 'dispatched', message: 'Mountain Pass is printing.' });
    expect(platform.listActivities).toHaveBeenCalledTimes(2);
    expect(log.warn).not.toHaveBeenCalledWith('school.printed-activity.pool-exhausted', expect.anything());
  });

  it('a throw on the fresh sample is a platform fault', async () => {
    const store = fakeStore(POOL.map((p, i) => issuance({ issuanceId: `pa_${i}`, externalId: p.externalId, completedAt: 'x', completedStudyDay: '2026-11-01' })));
    const platform = fakePlatform({ listActivities: vi.fn().mockResolvedValueOnce(POOL).mockRejectedValueOnce(new Error('beeloo down')) });
    const { launcher } = setup({ store, platform });
    expect(await go(launcher)).toEqual({ decision: 'failed', message: 'Worksheets are unavailable right now. Ask a grown-up.' });
  });

  it('fails when the platform is not configured', async () => {
    const { launcher, log } = make({ printer: fakePrinter(), platforms: new Map() });
    expect(await go(launcher)).toEqual({ decision: 'failed', message: 'Worksheets are unavailable right now. Ask a grown-up.' });
    expect(log.warn).toHaveBeenCalledWith('school.printed-activity.platform-missing', expect.any(Object));
  });

  it('fails when the platform throws listing or fetching, before anything is reserved or printed', async () => {
    for (const over of [
      { listActivities: vi.fn(async () => { throw new Error('beeloo down'); }) },
      { getPrintable: vi.fn(async () => { throw new Error('beeloo down'); }) },
    ]) {
      const { launcher, store, printer, log } = setup({ platform: fakePlatform(over) });
      expect(await go(launcher)).toEqual({ decision: 'failed', message: 'Worksheets are unavailable right now. Ask a grown-up.' });
      expect(printer.printPdf).not.toHaveBeenCalled();
      expect(store.append).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith('school.printed-activity.platform-failed', expect.any(Object));
    }
  });

  it('fails with an error log when the append fails for another reason, printing nothing', async () => {
    const store = fakeStore();
    store.append.mockRejectedValueOnce(new Error('disk full'));
    const { launcher, log, printer } = setup({ store });
    expect(await go(launcher)).toEqual({ decision: 'failed', message: 'That page could not be saved. Ask a grown-up.' });
    expect(printer.printPdf).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith('school.printed-activity.record-failed', expect.any(Object));
  });

  it('titles the job by the entry label when the page has no title', async () => {
    const platform = fakePlatform({ listActivities: vi.fn(async () => [{ externalId: 'm-9', title: null, kind: 'maze', level: 3 }]) });
    const { launcher } = setup({ platform });
    expect((await go(launcher)).message).toBe('Maze is printing.');
  });

  it('a household lookup that throws answers failed, never throws', async () => {
    const store = fakeStore();
    store.listIssuedExternalIds.mockRejectedValue(new Error('boom'));
    const { launcher, printer, log } = setup({ store });
    expect(await go(launcher)).toEqual({ decision: 'failed', message: 'Something went wrong printing that page. Ask a grown-up.' });
    expect(printer.printPdf).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith('school.printed-activity.launch-failed', expect.any(Object));
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

  it('an unreadable assignment asks for a grown-up, not "not assigned"', async () => {
    const { launcher, log, printer } = setup({ assignment: null });
    expect(await go(launcher)).toEqual({ decision: 'failed', message: 'Something went wrong printing that page. Ask a grown-up.' });
    expect(log.error).toHaveBeenCalledWith('school.printed-activity.enrollment-unreadable', expect.any(Object));
    expect(printer.printPdf).not.toHaveBeenCalled();
  });

  it('fails honestly with no printer', async () => {
    const { launcher, platform } = setup({ printer: null });
    expect(await go(launcher)).toEqual({ decision: 'failed', message: 'The printer is not set up. Ask a grown-up.' });
    expect(platform.listActivities).not.toHaveBeenCalled();
  });

  it('never throws, even when the store and the logger both throw', async () => {
    const store = fakeStore();
    store.listForLearner.mockRejectedValue(new Error('boom'));
    const angry = () => { throw new Error('logger down'); };
    const { launcher } = setup({ store, log: { debug: angry, info: angry, warn: angry, error: angry } });
    await expect(go(launcher)).resolves.toEqual({ decision: 'failed', message: 'Something went wrong printing that page. Ask a grown-up.' });
  });
});
