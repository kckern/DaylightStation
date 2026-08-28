import { describe, it, expect, beforeEach } from 'vitest';
import { GetLearnerDayCompletion } from '#apps/school/GetLearnerDayCompletion.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeAssignmentStore, fakeClock, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import { rawUnits, rawDocuments, rawManifests, BANK_IDS } from '#testlib/school/lifecycleFixtures.mjs';

let clock, catalog, curriculum, sessions, assignments, useCase;

const build = ({ assignment = { learnerId: 'kid1', courses: [] }, units, launchers = new Map() } = {}) => {
  clock = fakeClock();
  catalog = new FakeCatalog({ units: units ?? rawUnits(), documents: rawDocuments(), manifests: rawManifests() });
  curriculum = new CurriculumAccess({
    catalog, bankIds: () => BANK_IDS, programIds: () => [], clock: clock.epoch, logger: silentLogger,
  });
  sessions = new FakeSessionRepository();
  assignments = new FakeAssignmentStore(assignment ? [assignment] : []);
  useCase = new GetLearnerDayCompletion({
    curriculum, assignments, sessions, launchers, timezone: null, clock: clock.now, logger: silentLogger,
  });
};

beforeEach(() => build());

describe('GetLearnerDayCompletion', () => {
  it('no assignment at all -> no_work_today', async () => {
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(result).toMatchObject({ learnerId: 'kid1', state: 'no_work_today' });
  });

  it('an assigned, untouched required unit -> incomplete', async () => {
    build({ assignment: { learnerId: 'kid1', courses: ['math-fractions'] } });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(result.state).toBe('incomplete');
  });

  it('does not create a session or mutate anything (read-only)', async () => {
    build({ assignment: { learnerId: 'kid1', courses: ['math-fractions'] } });
    await useCase.execute({ learnerId: 'kid1' });
    expect(sessions.ids()).toHaveLength(0);
  });

  it('matches the obligation-derived state BuildAgenda would compute for the same inputs — no drift between print and read paths', async () => {
    build({ assignment: { learnerId: 'kid1', courses: ['math-fractions'] } });
    const completion = await useCase.execute({ learnerId: 'kid1' });

    // Independently derive the same answer via the exact BuildAgenda path
    // (planLearnerWork -> planDailyAgenda -> resolveDayCompletion), reusing
    // this test's own catalog/assignments/sessions fakes, to prove the two
    // use cases cannot silently diverge.
    const { planLearnerWork } = await import('#domains/school/planner.mjs');
    const { planDailyAgenda } = await import('#domains/school/agenda.mjs');
    const { resolveDayCompletion } = await import('#domains/school/completion.mjs');
    const nowIso = clock.now().toISOString();
    const assignment = await assignments.get('kid1');
    const units = await curriculum.listUnits();
    const history = await sessions.listForLearner('kid1');
    const plan = planLearnerWork({ learnerId: 'kid1', assignment, units, sessions: history, now: nowIso, timezone: null });
    const { sections } = planDailyAgenda({ plan, sessions: history, programStatuses: {}, now: nowIso, timezone: null });
    const expected = resolveDayCompletion({ sections, planErrors: plan.errors });

    expect(completion.state).toBe(expected.state);
    expect(completion.excused).toEqual(expected.excused);
  });

  /**
   * THE PROGRAMS-ONLY LEARNER (regression, 2026-08-28).
   *
   * Every case above gives the learner COURSES. Nothing gave one only
   * PROGRAMS — and that is the shape two preschoolers in this household
   * actually have: `courses: []`, plus story time and a piano course.
   *
   * With `assignedPrograms: false` their day projected to zero sections, which
   * folds to `no_work_today` — and `no_work_today` unlocks piano games exactly
   * as `complete` does (`useSchoolGameAccess.completionAllowsGames`). So the
   * reward gate was structurally inoperative for precisely the children whose
   * whole curriculum it was supposed to see, every day, with nothing failing.
   *
   * These two pin BOTH directions, because a gate that is merely always-closed
   * is just as wrong as one that is always-open.
   */
  const programsOnly = {
    learnerId: 'kid1',
    courses: [],
    programs: [{ programId: 'story-time', subject: 'english', title: 'Story time', target: 2 }],
  };

  /** A story-time launcher in the shape `StoryTimeProgramLauncher` answers. */
  const storyTimeLauncher = ({ doneToday }) => new Map([['story-time', {
    id: 'story-time',
    surface: null,
    entryAction: 'reading-session',
    locationHint: 'on the living room TV',
    async status() {
      return {
        error: false, enrolled: true, doneToday, terminal: false,
        progressLabel: doneToday ? '2 of 2 stories' : '0 of 2 stories',
        score: null, count: doneToday ? 2 : 0, target: 2, reads: [],
      };
    },
    async launch() { return { decision: 'failed', message: 'at the TV' }; },
  }]]);

  it('a learner whose ONLY work is an unfinished program is incomplete, not no_work_today', async () => {
    build({ assignment: programsOnly, launchers: storyTimeLauncher({ doneToday: false }) });
    const result = await useCase.execute({ learnerId: 'kid1' });
    // The precise regression: `no_work_today` here unlocks the games gate.
    expect(result.state).not.toBe('no_work_today');
    expect(result.state).toBe('incomplete');
  });

  it('and reads complete once that program is done — the gate opens on merit, not on blindness', async () => {
    build({ assignment: programsOnly, launchers: storyTimeLauncher({ doneToday: true }) });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(result.state).toBe('complete');
  });
});
