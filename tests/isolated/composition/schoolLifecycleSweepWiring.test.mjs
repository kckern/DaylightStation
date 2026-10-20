// @vitest-environment node
//
// THE SWEEP THAT SAW NOBODY.
//
// The nightly `school-stale-sweep` job ran every night and logged
// `school.session.sweep-complete {"swept":0}`, because the DDD remediation
// moved the stale-sweep roster out of `createSchoolLifecycle` into a
// `learnerDirectory` parameter — and `createSchoolLifecycleRuntime` never
// passed one. `MarkSessionAbandoned.listStale` reads a missing directory as
// "no learners", so a sheet issued and never graded reprinted forever.
//
// Building the whole runtime needs most of the house, so this test stops at
// the seam that broke: what the runtime hands `createSchoolLifecycle`. The
// lifecycle module is replaced by a recorder; the captured directory then
// drives a real `MarkSessionAbandoned` over a fake session store, which is the
// exact construction `schoolLifecycle.mjs` performs.
import { describe, it, expect, vi } from 'vitest';
import { MarkSessionAbandoned } from "../../../__app_modules/learning/school/server/application/usecases/MarkSessionAbandoned.mjs";
import { FakeSessionRepository, silentLogger } from '../../_lib/school/lifecycleFakes.mjs';

const captured = vi.hoisted(() => ({ args: null }));

vi.mock("../../../__app_modules/learning/school/server/composition/schoolLifecycle.mjs", () => ({
  createSchoolLifecycle: async (args) => {
    captured.args = args;
    // An unwired lifecycle: no launcher, no realtime — the runtime carries on
    // past the book-scan wiring without needing anything else from us.
    return { wired: false };
  },
}));

const { createSchoolLifecycleRuntime } = await import(
  "../../../__app_modules/learning/school/server/composition/lifecycle-runtime.mjs"
);

const NOW = new Date('2026-10-19T09:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

async function runRuntime(schoolLearnerDirectory) {
  captured.args = null;
  const dependencies = {
    nfcLocationsForReachability: () => [],
    configService: { getHouseholdAppConfig: () => ({}), getDataDir: () => '/nonexistent' },
    householdId: 'test',
    economyApi: { economyService: null },
    v1Routers: {},
    books: {},
    schoolCalc: {},
    schoolLifecycleLogger: silentLogger,
    rootLogger: silentLogger,
    getSchoolScreenConfig: () => null,
    schoolLearnerDirectory,
  };
  // Everything after the lifecycle is built is out of scope here, and with a
  // stubbed house some of it will throw. The call we care about has happened.
  await createSchoolLifecycleRuntime(dependencies).catch(() => {});
  return captured.args;
}

describe('lifecycle runtime → stale sweep roster', () => {
  it('hands createSchoolLifecycle the School learner directory', async () => {
    const directory = { listLearners: () => [{ id: 'kid1', name: 'Kid' }] };
    const args = await runRuntime(directory);
    expect(args).not.toBeNull();
    expect(typeof args.learnerDirectory?.listLearners).toBe('function');
  });

  it('a sweep built from that directory finds stale work for directory learners', async () => {
    const directory = { listLearners: () => [{ id: 'kid1', name: 'Kid' }] };
    const args = await runRuntime(directory);

    const sessions = new FakeSessionRepository();
    await sessions.appendEvent('ses_tiger', { type: 'created', at: daysAgo(30), learnerId: 'kid1', unitId: 'mammals-tiger' });
    await sessions.appendEvent('ses_tiger', { type: 'issued', at: daysAgo(30), artifactId: 'a1' });

    const useCase = new MarkSessionAbandoned({
      sessions,
      teacherGate: { assert: () => { throw new Error('sweep must not ask the teacher gate'); } },
      learnerDirectory: args.learnerDirectory,
      clock: () => NOW,
      logger: silentLogger,
    });
    const result = await useCase.sweepUntouched({ olderThanDays: 14, dryRun: true });
    expect(result.swept.map((row) => row.sessionId)).toEqual(['ses_tiger']);
  });
});
