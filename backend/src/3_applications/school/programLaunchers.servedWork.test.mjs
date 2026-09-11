/**
 * ONE INVARIANT, THREE LAUNCHERS: a program that finishes without opening a
 * School work session must say what it served.
 *
 * `AgendaStatusBoard` draws one disc per assignment from PLAN ∪ EVIDENCE. The
 * plan side drops out the moment a program reports `doneToday` (the agenda
 * stops offering it, so the section's `next` goes null), and the evidence side
 * is work sessions — which `BuildAgenda` deliberately never opens for a program
 * entry ("Program entries never get a work session here"). A program with
 * neither leg therefore does not turn its disc green when a child finishes it:
 * the disc LEAVES THE BOARD. That is the bug a child hit on the Sentence
 * Ladder; these three launchers stand in exactly the same place.
 *
 * `servedWork` is the third leg. Launchers report the work only — the agenda
 * stamps `assignmentUnitId` onto every row from the program entry that owns it
 * (`agenda.mjs`), so a launcher must never guess at one itself.
 */
import { describe, expect, it } from 'vitest';
import { LanguageReelsProgramLauncher } from './LanguageReelsProgramLauncher.mjs';
import { RubiksCubeProgramLauncher } from './RubiksCubeProgramLauncher.mjs';
import { SurfaceProgramLauncher } from './SurfaceProgramLauncher.mjs';

describe('LanguageReelsProgramLauncher — served work', () => {
  const make = (status) => new LanguageReelsProgramLauncher({
    service: { status: () => status },
    grants: { issue: () => 'grant' },
  });

  it('names the finished reel once the session is complete', async () => {
    const launcher = make({ doneToday: true, terminal: true, progressLabel: 'Reel complete', score: 80 });
    const result = await launcher.status({ userId: 'test-learner', programInstance: 'kr-market-day' });
    expect(result.servedWork).toEqual([{ unitId: 'language-reels:kr-market-day', title: 'Language reel' }]);
  });

  it('keeps everything the service already answered', async () => {
    const launcher = make({ doneToday: true, terminal: true, progressLabel: 'Reel complete', score: 80 });
    await expect(launcher.status({ userId: 'test-learner', programInstance: 'kr-market-day' }))
      .resolves.toMatchObject({ doneToday: true, terminal: true, progressLabel: 'Reel complete', score: 80 });
  });

  it('reports nothing served for a reel still in progress', async () => {
    const launcher = make({ doneToday: false, terminal: false, progressLabel: 'Reel in progress', score: null });
    await expect(launcher.status({ userId: 'test-learner', programInstance: 'kr-market-day' }))
      .resolves.toMatchObject({ servedWork: [] });
  });
});

describe('RubiksCubeProgramLauncher — served work', () => {
  const make = (status) => new RubiksCubeProgramLauncher({
    service: { status: () => status },
    grants: { issue: () => 'grant' },
  });

  it('names the course on a day an activity was completed', async () => {
    const launcher = make({ doneToday: true, progressLabel: '3 of 12 activities complete', score: 25 });
    const result = await launcher.status({ userId: 'test-learner' });
    expect(result.servedWork).toEqual([{ unitId: 'rubiks-cube:beginner-v1', title: "Rubik's cube" }]);
    expect(result).toMatchObject({ doneToday: true, score: 25 });
  });

  it('reports nothing served on a day nothing was completed', async () => {
    const launcher = make({ doneToday: false, progressLabel: '3 of 12 activities complete', score: 25 });
    await expect(launcher.status({ userId: 'test-learner' })).resolves.toMatchObject({ servedWork: [] });
  });
});

describe('SurfaceProgramLauncher — served work', () => {
  const AT = Date.parse('2026-09-11T18:00:00Z');
  const make = (rows) => new SurfaceProgramLauncher({
    id: 'pe-daily', label: 'P.E.', surface: 'garage-fitness',
    donow: { dispatch: async () => ({ decision: 'dispatched', message: 'Off you go.' }) },
    datastore: { listDispatches: async () => rows },
    timezone: 'UTC', clock: () => new Date(AT), logger: { warn() {} },
  });

  it('names the program once a dispatch has served the day', async () => {
    const result = await make([{ programId: 'pe-daily', learnerId: 'test-learner', at: new Date(AT - 3_600_000).toISOString() }])
      .status({ userId: 'test-learner' });
    expect(result).toMatchObject({ doneToday: true });
    // The label the household authored in `school.yml`, not the program id: a
    // receipt's finished-work line and a disc's spoken name are read by a child.
    expect(result.servedWork).toEqual([{ unitId: 'pe-daily:daily', title: 'P.E.' }]);
  });

  it('reports nothing served on a day with no dispatch of its own', async () => {
    const result = await make([{ programId: 'something-else', learnerId: 'test-learner', at: new Date(AT).toISOString() }])
      .status({ userId: 'test-learner' });
    expect(result).toMatchObject({ doneToday: false, servedWork: [] });
  });

  it('reports nothing served when the dispatch log cannot be read', async () => {
    const launcher = new SurfaceProgramLauncher({
      id: 'pe-daily', label: 'P.E.', surface: 'garage-fitness',
      donow: { dispatch: async () => ({ decision: 'dispatched', message: '' }) },
      datastore: { listDispatches: async () => { throw new Error('disk is gone'); } },
      timezone: 'UTC', clock: () => new Date(AT), logger: { warn() {} },
    });
    // An unreadable ledger is not evidence of work: the degraded answer must
    // never paint a disc green.
    await expect(launcher.status({ userId: 'test-learner' })).resolves.toMatchObject({ doneToday: false, servedWork: [] });
  });
});
