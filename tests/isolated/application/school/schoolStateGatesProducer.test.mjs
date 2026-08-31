import { describe, expect, it, vi } from 'vitest';
import { SchoolStateGatesProducer } from '#apps/school/SchoolStateGatesProducer.mjs';

const scheduler = { schedule: () => () => {} };

describe('SchoolStateGatesProducer', () => {
  it('publishes startup truth and corrects the same learner-day assertion on completion', async () => {
    let observed;
    const realtime = {
      onCompletionStateObserved(handler) { observed = handler; return vi.fn(); },
    };
    const assertions = [];
    const producer = new SchoolStateGatesProducer({
      realtime,
      getLearnerDayCompletion: {
        execute: async ({ learnerId }) => ({ learnerId, studyDate: '2026-08-30', state: 'incomplete' }),
      },
      learners: async () => [{ id: 'kid-one' }],
      publishAssertion: async assertion => assertions.push(assertion),
      retractAssertion: async () => {},
      timezone: 'America/Los_Angeles',
      clock: () => new Date('2026-08-30T19:00:00.000Z'),
      scheduler,
    });

    await producer.start();
    expect(assertions).toHaveLength(1);
    expect(assertions[0]).toMatchObject({
      assertionId: 'school:day-complete:kid-one:2026-08-30',
      claimTypeId: 'school.day.complete',
      subject: { kind: 'learner', id: 'kid-one' },
      period: {
        kind: 'interval', id: 'school-day:2026-08-30',
        startsAt: Date.parse('2026-08-30T04:00:00-07:00'),
        endsAt: Date.parse('2026-08-31T04:00:00-07:00'),
      },
      value: false,
    });

    await observed({ learnerId: 'kid-one', studyDate: '2026-08-30', state: 'complete' });
    expect(assertions).toHaveLength(2);
    expect(assertions[1]).toMatchObject({
      assertionId: assertions[0].assertionId,
      value: true,
    });
    expect(assertions[1].sourceRevision).toBeGreaterThan(assertions[0].sourceRevision);
    producer.stop();
  });

  it.each(['complete', 'no_work_today'])('treats %s as positive completion evidence', async state => {
    const assertions = [];
    const producer = new SchoolStateGatesProducer({
      realtime: { onCompletionStateObserved: () => () => {} },
      getLearnerDayCompletion: { execute: async () => ({ studyDate: '2026-08-30', state }) },
      learners: async () => [{ id: 'kid' }],
      publishAssertion: async assertion => assertions.push(assertion),
      retractAssertion: async () => {},
      timezone: 'UTC', clock: () => new Date('2026-08-30T12:00:00Z'), scheduler,
    });
    await producer.start();
    expect(assertions[0].value).toBe(true);
    producer.stop();
  });

  it('retracts prior evidence when School can no longer determine the day', async () => {
    let observed;
    const retractions = [];
    const producer = new SchoolStateGatesProducer({
      realtime: { onCompletionStateObserved: (handler) => { observed = handler; return () => {}; } },
      getLearnerDayCompletion: { execute: async () => ({ studyDate: '2026-08-30', state: 'complete' }) },
      learners: async () => [{ id: 'kid' }],
      publishAssertion: async () => {},
      retractAssertion: async command => retractions.push(command),
      timezone: 'UTC', clock: () => new Date('2026-08-30T12:00:00Z'), scheduler,
    });
    await producer.start();
    await observed({ learnerId: 'kid', studyDate: '2026-08-30', state: 'indeterminate' });
    expect(retractions).toEqual([expect.objectContaining({
      assertionId: 'school:day-complete:kid:2026-08-30',
      evidenceRef: 'school-completion:indeterminate',
    })]);
    producer.stop();
  });

  it('reconciles authoritative completion periodically when no semantic event arrives', async () => {
    let state = 'incomplete';
    const scheduled = [];
    const assertions = [];
    const producer = new SchoolStateGatesProducer({
      realtime: { onCompletionStateObserved: () => () => {} },
      getLearnerDayCompletion: { execute: async () => ({ studyDate: '2026-08-30', state }) },
      learners: async () => [{ id: 'kid' }],
      publishAssertion: async assertion => assertions.push(assertion),
      retractAssertion: async () => {},
      timezone: 'UTC', clock: () => new Date('2026-08-30T12:00:00Z'),
      scheduler: { schedule: (_delay, task) => { scheduled.push(task); return () => {}; } },
    });
    await producer.start();
    expect(assertions.map(value => value.value)).toEqual([false]);
    state = 'complete';
    await scheduled[0]();
    expect(assertions.map(value => value.value)).toEqual([false, true]);
    producer.stop();
  });
});
