import { describe, it, expect } from 'vitest';
import { StoryTimeProgramLauncher } from '#apps/school/StoryTimeProgramLauncher.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };
const at = (iso) => () => new Date(iso);

function makeLauncher({ rows = [], target = 2, now = '2026-08-26T18:00:00.000Z' } = {}) {
  return new StoryTimeProgramLauncher({
    readingLog: { listForDay: async () => rows },
    assignments: { get: async () => ({ programs: [{ programId: 'story-time', target }] }) },
    timezone: 'America/Los_Angeles', clock: at(now), logger: silent,
  });
}

describe('StoryTimeProgramLauncher', () => {
  it('is not done with no reads', async () => {
    const s = await makeLauncher({ rows: [] }).status({ userId: 'learner-c' });
    expect(s.doneToday).toBe(false);
    expect(s.progressLabel).toBe('0 of 2 stories');
    expect(s.obligationProgress).toEqual({ completed: 0, total: 2 });
    expect(s.servedWork).toEqual([]);
  });

  it('is not done partway', async () => {
    const s = await makeLauncher({ rows: [{ title: 'One' }] }).status({ userId: 'learner-c' });
    expect(s.doneToday).toBe(false);
    expect(s.progressLabel).toBe('1 of 2 stories');
    expect(s.obligationProgress).toEqual({ completed: 1, total: 2 });
    expect(s.servedWork).toEqual([]);
  });

  it('is done at the target', async () => {
    const s = await makeLauncher({ rows: [{ title: 'One' }, { title: 'Two' }] }).status({ userId: 'learner-c' });
    expect(s.doneToday).toBe(true);
    expect(s.progressLabel).toBe('2 of 2 stories');
    expect(s.obligationProgress).toEqual({ completed: 2, total: 2 });
    expect(s.servedWork).toEqual([{ unitId: 'story-time:daily', title: 'Story time' }]);
  });

  it('stays done past the target — extra stories are never a penalty', async () => {
    const s = await makeLauncher({ rows: [{}, {}, {}] }).status({ userId: 'learner-c' });
    expect(s.doneToday).toBe(true);
    expect(s.progressLabel).toBe('3 of 2 stories');
    expect(s.obligationProgress).toEqual({ completed: 2, total: 2 });
    expect(s.servedWork).toEqual([{ unitId: 'story-time:daily', title: 'Story time' }]);
  });

  it('is never terminal — a daily obligation does not complete', async () => {
    const s = await makeLauncher({ rows: [{}, {}] }).status({ userId: 'learner-c' });
    expect(s.terminal).toBe(false);
  });

  it('asks the reading log for the STUDY day, not the UTC date', async () => {
    const asked = [];
    const launcher = new StoryTimeProgramLauncher({
      readingLog: { listForDay: async (id, day) => { asked.push([id, day]); return []; } },
      assignments: { get: async () => ({ programs: [{ programId: 'story-time', target: 2 }] }) },
      // 01:30 UTC on the 27th is 18:30 on the 26th in Los Angeles, and the study
      // day does not roll until 4am — so this is still the 26th.
      timezone: 'America/Los_Angeles', clock: at('2026-08-27T01:30:00.000Z'), logger: silent,
    });
    await launcher.status({ userId: 'learner-c' });
    expect(asked).toEqual([['learner-c', '2026-08-26']]);
  });

  it('reports an error rather than a false zero when the log is unreadable', async () => {
    const launcher = new StoryTimeProgramLauncher({
      readingLog: { listForDay: async () => { throw new Error('disk gone'); } },
      assignments: { get: async () => ({ programs: [{ programId: 'story-time', target: 2 }] }) },
      timezone: 'America/Los_Angeles', clock: at('2026-08-26T18:00:00.000Z'), logger: silent,
    });
    const s = await launcher.status({ userId: 'learner-c' });
    expect(s.error).toBe(true);
    expect(s.doneToday).toBe(false);
    expect(s.obligationProgress).toBeNull();
  });
  // Deviation from the plan, deliberate: the plan returned `{ok:false, reason}`,
  // but both callers read `decision` and then relay `message` verbatim — an
  // `{ok}` shape reaches the child as the generic "ask a grown-up" instead of
  // the room to walk to.
  it('refuses a launch in DoNow\'s own shape, naming the room', async () => {
    const launcher = makeLauncher();
    expect(await launcher.launch({ userId: 'learner-c' })).toEqual({
      decision: 'failed', message: 'Story time happens on the living room TV — tap your card there.',
    });
    expect(launcher.locationHint).toBe('on the living room TV');
    expect(launcher.surface ?? null).toBe(null);
  });
  // `YamlAssignmentStore.get()` NEVER THROWS — it answers null for a missing
  // file AND for unparseable YAML. So the masking these two cover happens on
  // the happy path, not in a catch: `null?.programs ?? []` finds no entry and
  // silently falls back to the default target. For a learner whose target is 5
  // that is `doneToday: true` at two books — a FALSE DONE, worse than the false
  // zero this launcher's own header argues must never happen.
  it('refuses to guess a target when there is no assignment record at all', async () => {
    const launcher = new StoryTimeProgramLauncher({
      readingLog: { listForDay: async () => [{}, {}] },
      assignments: { get: async () => null },
      timezone: 'America/Los_Angeles', clock: at('2026-08-26T18:00:00.000Z'), logger: silent,
    });
    const s = await launcher.status({ userId: 'learner-c' });
    expect(s.error).toBe(true);
    expect(s.doneToday).toBe(false);
    expect(s.target).toBe(null);
  });

  it('refuses to guess a target the enrollment authored but garbled', async () => {
    const launcher = new StoryTimeProgramLauncher({
      readingLog: { listForDay: async () => [{}, {}] },
      assignments: { get: async () => ({ programs: [{ programId: 'story-time', target: '5' }] }) },
      timezone: 'America/Los_Angeles', clock: at('2026-08-26T18:00:00.000Z'), logger: silent,
    });
    const s = await launcher.status({ userId: 'learner-c' });
    expect(s.error).toBe(true);
    expect(s.target).toBe(null);
  });

  it('takes the default only when the enrollment exists and OMITS a target', async () => {
    const launcher = new StoryTimeProgramLauncher({
      readingLog: { listForDay: async () => [] },
      assignments: { get: async () => ({ programs: [{ programId: 'story-time' }] }) },
      timezone: 'America/Los_Angeles', clock: at('2026-08-26T18:00:00.000Z'), logger: silent,
    });
    expect((await launcher.status({ userId: 'learner-c' })).progressLabel).toBe('0 of 2 stories');
  });

  it('reports an error rather than a guessed target when the assignments store throws', async () => {
    const launcher = new StoryTimeProgramLauncher({
      readingLog: { listForDay: async () => [{}, {}] },
      assignments: { get: async () => { throw new Error('disk gone'); } },
      timezone: 'America/Los_Angeles', clock: at('2026-08-26T18:00:00.000Z'), logger: silent,
    });
    const s = await launcher.status({ userId: 'learner-c' });
    expect(s.error).toBe(true);
    expect(s.doneToday).toBe(false);
  });

  // Plan 03's on-screen counter reads `status().count`. An error branch that
  // omits it hands that counter `undefined` instead of "unknown".
  it('answers the same shape on both error branches as on success', async () => {
    const unreadableLog = await new StoryTimeProgramLauncher({
      readingLog: { listForDay: async () => { throw new Error('disk gone'); } },
      assignments: { get: async () => ({ programs: [{ programId: 'story-time', target: 3 }] }) },
      timezone: 'America/Los_Angeles', clock: at('2026-08-26T18:00:00.000Z'), logger: silent,
    }).status({ userId: 'learner-c' });
    expect(unreadableLog).toMatchObject({ error: true, count: null, target: 3, reads: [], terminal: false, score: null });

    const unknownTarget = await new StoryTimeProgramLauncher({
      readingLog: { listForDay: async () => [] },
      assignments: { get: async () => null },
      timezone: 'America/Los_Angeles', clock: at('2026-08-26T18:00:00.000Z'), logger: silent,
    }).status({ userId: 'learner-c' });
    expect(unknownTarget).toMatchObject({ error: true, count: null, target: null, reads: [], terminal: false, score: null });
  });
  // ── enrolled vs unreadable ────────────────────────────────────────────────
  // These two used to answer identically (`error: true, target: null`), and the
  // reading-session interceptor could not tell them apart: a learner with no
  // story-time enrollment and a learner whose log had just gone unreadable both
  // came back "browsing", so a genuinely broken read silently RELAXED a child
  // who was mid-assignment. `enrolled` is the field that separates them.
  it('reports an enrolled learner as enrolled', async () => {
    const s = await makeLauncher({ rows: [] }).status({ userId: 'learner-c' });
    expect(s).toMatchObject({ error: false, enrolled: true, target: 2 });
  });

  it('a readable enrollment with no story-time entry is NOT an error — it is simply not enrolled', async () => {
    const launcher = new StoryTimeProgramLauncher({
      readingLog: { listForDay: async () => [] },
      assignments: { get: async () => ({ programs: [{ programId: 'piano-course' }] }) },
      timezone: 'America/Los_Angeles', clock: at('2026-08-26T18:00:00.000Z'), logger: silent,
    });
    const s = await launcher.status({ userId: 'learner-d' });
    expect(s.error).toBe(false);
    expect(s.enrolled).toBe(false);
    expect(s.target).toBe(null);
    expect(s.count).toBe(null);
    expect(s.obligationProgress).toBeNull();
  });

  it('an EMPTY but readable assignment record is not enrolled either', async () => {
    const launcher = new StoryTimeProgramLauncher({
      readingLog: { listForDay: async () => [] },
      assignments: { get: async () => ({}) },
      timezone: 'America/Los_Angeles', clock: at('2026-08-26T18:00:00.000Z'), logger: silent,
    });
    expect(await launcher.status({ userId: 'learner-d' })).toMatchObject({ error: false, enrolled: false });
  });

  it('never asks the reading log about a learner who is not enrolled', async () => {
    const asked = [];
    const launcher = new StoryTimeProgramLauncher({
      readingLog: { listForDay: async (...a) => { asked.push(a); return []; } },
      assignments: { get: async () => ({ programs: [] }) },
      timezone: 'America/Los_Angeles', clock: at('2026-08-26T18:00:00.000Z'), logger: silent,
    });
    await launcher.status({ userId: 'learner-d' });
    expect(asked).toEqual([]);
  });

  it('an UNREADABLE assignment record stays an error, and says nothing about enrollment', async () => {
    const launcher = new StoryTimeProgramLauncher({
      readingLog: { listForDay: async () => [] },
      assignments: { get: async () => null },
      timezone: 'America/Los_Angeles', clock: at('2026-08-26T18:00:00.000Z'), logger: silent,
    });
    const s = await launcher.status({ userId: 'learner-c' });
    expect(s.error).toBe(true);
    expect(s.enrolled).toBe(null);
  });

  it('a garbled target is an error on an enrollment that DOES exist', async () => {
    const launcher = new StoryTimeProgramLauncher({
      readingLog: { listForDay: async () => [] },
      assignments: { get: async () => ({ programs: [{ programId: 'story-time', target: '5' }] }) },
      timezone: 'America/Los_Angeles', clock: at('2026-08-26T18:00:00.000Z'), logger: silent,
    });
    expect(await launcher.status({ userId: 'learner-c' })).toMatchObject({ error: true, enrolled: true });
  });

  it('an unreadable LOG is an error on an enrollment that reads fine', async () => {
    const launcher = new StoryTimeProgramLauncher({
      readingLog: { listForDay: async () => { throw new Error('disk gone'); } },
      assignments: { get: async () => ({ programs: [{ programId: 'story-time', target: 2 }] }) },
      timezone: 'America/Los_Angeles', clock: at('2026-08-26T18:00:00.000Z'), logger: silent,
    });
    expect(await launcher.status({ userId: 'learner-c' })).toMatchObject({ error: true, enrolled: true, target: 2 });
  });
});
