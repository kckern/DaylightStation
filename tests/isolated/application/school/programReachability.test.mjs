/**
 * A program nothing can start is reported, not planned.
 *
 * 2026-08-26: Alan and Soren were assigned story time, the living-room trigger
 * source declared no `learner_action`, and every layer behaved exactly as
 * written while they stood at the reader tapping. These are the two places that
 * now notice — the per-projection fault and the startup report.
 */
import { describe, it, expect, vi } from 'vitest';
import { collectProgramStatuses } from '#apps/school/programStatusCollection.mjs';
import { reportUnreachableSchoolPrograms } from '#composition/modules/schoolReachability.mjs';
import { planDailyAgenda } from '#domains/school/agenda.mjs';
import { resolveDayCompletion } from '#domains/school/completion.mjs';

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });

const storyLauncher = (overrides = {}) => ({
  get entryAction() { return 'reading-session'; },
  status: vi.fn(async () => ({ doneToday: false, progressLabel: '0 of 2 read today', score: null })),
  ...overrides,
});

const plan = { entries: [{ unitId: 'story-time', program: 'story-time', subject: 'reading', status: 'available' }] };

describe('collectProgramStatuses reachability', () => {
  it('reports a program whose entry action no reader declares', async () => {
    const launcher = storyLauncher();
    const [row] = await collectProgramStatuses({
      plan, learnerId: 'soren',
      launchers: new Map([['story-time', launcher]]),
      declaredEntryActions: new Set(['print-agenda']),
      logger: silentLogger(),
    });
    expect(row.status).toEqual({ error: true, reason: 'no_entry_point' });
  });

  it('does not even ASK the launcher — a happy status about unreachable work is worse than none', async () => {
    // Story time's `status()` answers "0 of 2 read today" perfectly happily.
    // That is true, and useless, because nothing in the house can start it.
    const launcher = storyLauncher();
    await collectProgramStatuses({
      plan, learnerId: 'soren',
      launchers: new Map([['story-time', launcher]]),
      declaredEntryActions: new Set(),
      logger: silentLogger(),
    });
    expect(launcher.status).not.toHaveBeenCalled();
  });

  it('passes the program through when a reader declares the action', async () => {
    const launcher = storyLauncher();
    const [row] = await collectProgramStatuses({
      plan, learnerId: 'soren',
      launchers: new Map([['story-time', launcher]]),
      declaredEntryActions: new Set(['reading-session']),
      logger: silentLogger(),
    });
    expect(row.status).toMatchObject({ doneToday: false });
    expect(launcher.status).toHaveBeenCalled();
  });

  it('asks nothing at all when the caller does not supply the set', async () => {
    // Backward compatibility: every pre-existing caller and test keeps its
    // behaviour exactly.
    const launcher = storyLauncher();
    const [row] = await collectProgramStatuses({
      plan, learnerId: 'soren',
      launchers: new Map([['story-time', launcher]]),
      logger: silentLogger(),
    });
    expect(row.status).toMatchObject({ doneToday: false });
  });

  it('fails toward reporting when the trigger config could not be read', async () => {
    const [row] = await collectProgramStatuses({
      plan, learnerId: 'soren',
      launchers: new Map([['story-time', storyLauncher()]]),
      declaredEntryActions: null,
      logger: silentLogger(),
    });
    expect(row.status).toEqual({ error: true, reason: 'no_entry_point' });
  });

  it('leaves a launcher with no entryAction alone', async () => {
    const launcher = { status: vi.fn(async () => ({ doneToday: true })) };
    const [row] = await collectProgramStatuses({
      plan: { entries: [{ unitId: 'p', program: 'piano-course', subject: 'arts', status: 'available' }] },
      learnerId: 'milo',
      launchers: new Map([['piano-course', launcher]]),
      declaredEntryActions: new Set(),
      logger: silentLogger(),
    });
    expect(row.status).toMatchObject({ doneToday: true });
  });
});

describe('the fault reaches day completion', () => {
  it('an unstartable program makes the day INDETERMINATE, never complete', async () => {
    // This is the whole point of reusing `error: true`: the existing chain
    // (program_unavailable -> FAULT_REASONS -> faulted -> indeterminate) means
    // the status board shows no done chip and the receipt prints no
    // done-for-the-day line for a child who could never begin.
    const statuses = await collectProgramStatuses({
      plan, learnerId: 'soren',
      launchers: new Map([['story-time', storyLauncher()]]),
      declaredEntryActions: new Set(),
      logger: silentLogger(),
    });
    const { sections } = planDailyAgenda({
      plan, sessions: [], programStatuses: statuses, now: '2026-08-26T18:00:00.000Z',
    });
    // One section, for the one program. Asserted positionally rather than by
    // subject name because `planDailyAgenda` normalises an unrecognised
    // subject to `other`, and the subject label is not what this test is about.
    expect(sections).toHaveLength(1);
    expect(sections[0].programUnavailable).toBe(true);
    expect(sections[0].obligation)
      .toEqual({ state: 'faulted', reason: 'program_unavailable' });
    expect(resolveDayCompletion({ sections, planErrors: [] }).state).toBe('indeterminate');
  });
});

describe('reportUnreachableSchoolPrograms', () => {
  it('warns once per unreachable program, naming the remedy', () => {
    const logger = silentLogger();
    const out = reportUnreachableSchoolPrograms({
      launchers: new Map([
        ['story-time', storyLauncher()],
        ['piano-course', { status: vi.fn() }],
      ]),
      declared: new Set(['print-agenda']),
      logger,
    });
    expect(out).toEqual([{ programId: 'story-time', entryAction: 'reading-session' }]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][1]).toMatchObject({
      program: 'story-time',
      remedy: 'declare learner_action: reading-session on a trigger source',
    });
  });

  it('says nothing when every program is reachable', () => {
    const logger = silentLogger();
    expect(reportUnreachableSchoolPrograms({
      launchers: new Map([['story-time', storyLauncher()]]),
      declared: new Set(['reading-session']),
      logger,
    })).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('marks the unreadable-config case so a reader can tell it apart', () => {
    const logger = silentLogger();
    reportUnreachableSchoolPrograms({
      launchers: new Map([['story-time', storyLauncher()]]),
      declared: null,
      logger,
    });
    expect(logger.warn.mock.calls[0][1]).toMatchObject({ configUnreadable: true });
  });

  it('never throws on an unwired school', () => {
    expect(reportUnreachableSchoolPrograms({ launchers: null, declared: new Set() })).toEqual([]);
  });
});
