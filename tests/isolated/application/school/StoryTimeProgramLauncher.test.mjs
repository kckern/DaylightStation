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
  });

  it('is not done partway', async () => {
    const s = await makeLauncher({ rows: [{ title: 'One' }] }).status({ userId: 'learner-c' });
    expect(s.doneToday).toBe(false);
    expect(s.progressLabel).toBe('1 of 2 stories');
  });

  it('is done at the target', async () => {
    const s = await makeLauncher({ rows: [{ title: 'One' }, { title: 'Two' }] }).status({ userId: 'learner-c' });
    expect(s.doneToday).toBe(true);
    expect(s.progressLabel).toBe('2 of 2 stories');
  });

  it('stays done past the target — extra stories are never a penalty', async () => {
    const s = await makeLauncher({ rows: [{}, {}, {}] }).status({ userId: 'learner-c' });
    expect(s.doneToday).toBe(true);
    expect(s.progressLabel).toBe('3 of 2 stories');
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
});
