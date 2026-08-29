import { describe, it, expect, beforeEach } from 'vitest';
import { WorkSessionReporter } from '#apps/school/WorkSessionReporter.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { GetSchoolReport } from '#apps/school/GetSchoolReport.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeAssignmentStore, FakeReviewQueue,
  fakeClock, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS, MEDIA_UNIT, WORKSHEET_UNIT, fixtureUnit,
} from '#testlib/school/lifecycleFixtures.mjs';

let clock, sessions, assignments, reviewQueue, reporter;

const build = ({ assignment = { learnerId: 'kid1', courses: ['math-fractions'] } } = {}) => {
  clock = fakeClock();
  const catalog = new FakeCatalog({ units: rawUnits(), documents: rawDocuments(), manifests: rawManifests() });
  const curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
  sessions = new FakeSessionRepository();
  assignments = new FakeAssignmentStore(assignment ? [assignment] : []);
  reviewQueue = new FakeReviewQueue();
  reporter = new WorkSessionReporter({ curriculum, sessions, assignments, reviewQueue, clock: clock.now, logger: silentLogger });
};

const pass = async (sessionId, unitId) => {
  for (const event of [
    { type: 'created', learnerId: 'kid1', unitId },
    { type: 'issued', artifactId: `art_${sessionId}` },
    { type: 'submitted', transport: 'paper' },
    { type: 'graded', attemptIds: ['att_1'], percent: 100 },
    { type: 'outcome_recorded', outcomeId: `out:${sessionId}`, result: 'passed' },
    { type: 'rewarded', txnId: 'txn_1', amount: 0 },
  ]) {
    await sessions.appendEvent(sessionId, { ...event, sessionId, at: clock.iso() });
  }
};

beforeEach(() => build());

describe('the contract', () => {
  it('is a program reporter', () => {
    expect(typeof reporter.summarize).toBe('function');
    expect(reporter.id).toBe('coursework');
  });

  it('reports nothing for a learner with no assignment', async () => {
    build({ assignment: null });
    expect(await reporter.summarize({ userId: 'kid1' })).toEqual([]);
  });

  it('reports nothing without a learner', async () => {
    expect(await reporter.summarize({})).toEqual([]);
  });

  it('never throws — it swallows a broken store and reports nothing', async () => {
    assignments.get = async () => { throw new Error('disk on fire'); };
    await expect(reporter.summarize({ userId: 'kid1' })).resolves.toEqual([]);
  });
});

describe('the row', () => {
  it('one row per assigned course, with progress out of its units', async () => {
    const [row] = await reporter.summarize({ userId: 'kid1' });
    expect(row).toMatchObject({ program: 'coursework', instanceId: 'math-fractions', state: 'active', headline: '0 of 4 done' });
    expect(row.metrics[0]).toMatchObject({ kind: 'progress', value: 0, total: 4 });
  });

  it('counts a passed unit', async () => {
    await pass('ses_1', MEDIA_UNIT);
    const [row] = await reporter.summarize({ userId: 'kid1' });
    expect(row.headline).toBe('1 of 4 done');
    expect(row.next.label).toBe(fixtureUnit(WORKSHEET_UNIT).title);
  });

  it('reports the course complete when every unit has passed', async () => {
    await pass('ses_1', MEDIA_UNIT);
    await pass('ses_2', WORKSHEET_UNIT);
    await pass('ses_3', 'math-fractions.03');
    await pass('ses_4', 'math-fractions.04');
    const [row] = await reporter.summarize({ userId: 'kid1' });
    expect(row).toMatchObject({ state: 'complete', headline: '4 of 4 done' });
  });

  it('BLOCKS on work waiting for a grown-up, and says so', async () => {
    await sessions.appendEvent('ses_1', { type: 'created', at: clock.iso(), sessionId: 'ses_1', learnerId: 'kid1', unitId: MEDIA_UNIT });
    await sessions.appendEvent('ses_1', { type: 'issued', at: clock.iso(), sessionId: 'ses_1', artifactId: 'art_1' });
    await sessions.appendEvent('ses_1', { type: 'submitted', at: clock.iso(), sessionId: 'ses_1', transport: 'paper' });
    await reviewQueue.enqueue([{ sessionId: 'ses_1', itemId: 'q1', learnerId: 'kid1', unitId: MEDIA_UNIT, reason: 'blank', enqueuedAt: clock.iso() }]);
    const [row] = await reporter.summarize({ userId: 'kid1' });
    expect(row.state).toBe('blocked');
    expect(row.next).toMatchObject({ blocked: true, blockedReason: 'Waiting on a grown-up to mark it' });
  });

  it('keeps the waiting count off a child\'s surface', async () => {
    await sessions.appendEvent('ses_1', { type: 'created', at: clock.iso(), sessionId: 'ses_1', learnerId: 'kid1', unitId: MEDIA_UNIT });
    await sessions.appendEvent('ses_1', { type: 'issued', at: clock.iso(), sessionId: 'ses_1', artifactId: 'art_1' });
    await sessions.appendEvent('ses_1', { type: 'submitted', at: clock.iso(), sessionId: 'ses_1', transport: 'paper' });
    await reviewQueue.enqueue([{ sessionId: 'ses_1', itemId: 'q1', learnerId: 'kid1', unitId: MEDIA_UNIT, reason: 'blank', enqueuedAt: clock.iso() }]);
    const [row] = await reporter.summarize({ userId: 'kid1' });
    expect(row.metrics.find((m) => m.id === 'awaiting-review').audience).toBe('parent');
  });

  it('ignores another learner\'s review backlog', async () => {
    await reviewQueue.enqueue([{ sessionId: 'ses_x', itemId: 'q1', learnerId: 'kid2', unitId: MEDIA_UNIT, reason: 'blank', enqueuedAt: clock.iso() }]);
    const [row] = await reporter.summarize({ userId: 'kid1' });
    expect(row.state).toBe('active');
  });

  it('separates standalone work from course work', async () => {
    build({ assignment: { learnerId: 'kid1', courses: ['math-fractions'], units: [] } });
    const rows = await reporter.summarize({ userId: 'kid1' });
    expect(rows.map((r) => r.instanceId)).toEqual(['math-fractions']);
  });
});

describe('through the aggregate board', () => {
  it('normalises cleanly into a school report row', async () => {
    await pass('ses_1', MEDIA_UNIT);
    const report = new GetSchoolReport({
      reporters: [reporter],
      userService: { getHouseholdRoster: () => [{ id: 'kid1', name: 'Sam' }] },
      logger: silentLogger,
    });
    const { learners } = await report.execute({ userId: 'kid1', audience: 'parent' });
    expect(learners[0].reports).toHaveLength(1);
    expect(learners[0].reports[0]).toMatchObject({ program: 'coursework', instanceId: 'math-fractions' });
    // A dropped metric means the reporter emitted a shape the board cannot draw.
    expect(learners[0].reports[0].metrics).toHaveLength(1);
  });

  it('hides parent instrumentation from a learner-scoped request', async () => {
    await sessions.appendEvent('ses_1', { type: 'created', at: clock.iso(), sessionId: 'ses_1', learnerId: 'kid1', unitId: MEDIA_UNIT });
    await sessions.appendEvent('ses_1', { type: 'issued', at: clock.iso(), sessionId: 'ses_1', artifactId: 'art_1' });
    await sessions.appendEvent('ses_1', { type: 'submitted', at: clock.iso(), sessionId: 'ses_1', transport: 'paper' });
    await reviewQueue.enqueue([{ sessionId: 'ses_1', itemId: 'q1', learnerId: 'kid1', unitId: MEDIA_UNIT, reason: 'blank', enqueuedAt: clock.iso() }]);
    const report = new GetSchoolReport({
      reporters: [reporter],
      userService: { getHouseholdRoster: () => [{ id: 'kid1', name: 'Sam' }] },
      logger: silentLogger,
    });
    const { learners } = await report.execute({ userId: 'kid1', audience: 'learner' });
    // Both metrics are parent-side: the review backlog by declaration, and
    // whole-course progress because the reporting contract forces total-scope
    // progress to `parent` however it was declared. A child's row is therefore
    // headline plus next step — what they can DO — which is the intent.
    expect(learners[0].reports[0].metrics).toEqual([]);
    expect(learners[0].reports[0].next.label).toBeTruthy();
  });
});
