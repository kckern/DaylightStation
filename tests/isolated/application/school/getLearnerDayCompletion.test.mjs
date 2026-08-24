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
});
