import { describe, expect, it } from 'vitest';
import { projectFitnessActivity } from './fitnessActivity.mjs';

// A session summary as YamlSessionDatastore.findByDate builds one: `startTime`
// in unix ms and per-participant `rings` already computed at session close.
const at = (iso) => Date.parse(iso);
const session = (startedAt, participants) => ({ startTime: at(startedAt), participants });
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const project = (sessions, learnerId = 'user_4', studyDay = '2026-09-07') => (
  projectFitnessActivity(sessions, { learnerId, studyDay, dayOf })
);

describe('projectFitnessActivity', () => {
  it('credits a learner who earned rings in a session on the study day', () => {
    expect(project([session('2026-09-07T16:00:00Z', { user_4: { rings: 3 } })])).toEqual({
      studyDay: '2026-09-07', hasActivity: true, rings: 3, sessionCount: 1,
    });
  });

  it.each([
    ['a session they earned no rings in', 0],
    ['a session with no ring data recorded', null],
    ['a ring field that is not a number', 'lots'],
  ])('does not credit %s', (_label, rings) => {
    expect(project([session('2026-09-07T16:00:00Z', { user_4: { rings } })])).toEqual({
      studyDay: '2026-09-07', hasActivity: false, rings: 0, sessionCount: 0,
    });
  });

  it('does not credit a learner for somebody else s workout', () => {
    expect(project([session('2026-09-07T16:00:00Z', { user_2: { rings: 9 } })])).toEqual({
      studyDay: '2026-09-07', hasActivity: false, rings: 0, sessionCount: 0,
    });
  });

  it('sums every qualifying session of the day', () => {
    expect(project([
      session('2026-09-07T07:00:00Z', { user_4: { rings: 2 }, user_2: { rings: 5 } }),
      session('2026-09-07T18:00:00Z', { user_4: { rings: 4 } }),
    ])).toEqual({ studyDay: '2026-09-07', hasActivity: true, rings: 6, sessionCount: 2 });
  });

  // A session belongs to the study day its START falls in — the same rule
  // `fitnessRingsProvider` uses, so the disc and the weekly ring chip can never
  // disagree about which day a late workout landed on.
  it('dates a session by its start, not by the calendar day it ran into', () => {
    const lateNight = session('2026-09-07T23:30:00Z', { user_4: { rings: 3 } });
    expect(project([lateNight], 'user_4', '2026-09-07').hasActivity).toBe(true);
    expect(project([lateNight], 'user_4', '2026-09-08').hasActivity).toBe(false);
  });

  it('ignores a session with no start instant rather than guessing its day', () => {
    expect(project([{ participants: { user_4: { rings: 3 } } }])).toEqual({
      studyDay: '2026-09-07', hasActivity: false, rings: 0, sessionCount: 0,
    });
  });

  it.each([
    ['no sessions', []],
    ['a null list', null],
    ['a session with no participants', [session('2026-09-07T16:00:00Z', undefined)]],
  ])('reports a quiet day for %s', (_label, sessions) => {
    expect(project(sessions)).toEqual({
      studyDay: '2026-09-07', hasActivity: false, rings: 0, sessionCount: 0,
    });
  });

  it('requires a learner and a dayOf, rather than silently crediting nobody', () => {
    expect(() => projectFitnessActivity([], { studyDay: '2026-09-07', dayOf })).toThrow(/learnerId/);
    expect(() => projectFitnessActivity([], { studyDay: '2026-09-07', learnerId: 'user_4' })).toThrow(/dayOf/);
  });
});
