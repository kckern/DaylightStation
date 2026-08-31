import { describe, expect, it, vi } from 'vitest';
import { WeeklyMeasuresStateGatesProducer } from '#apps/measures/WeeklyMeasuresStateGatesProducer.mjs';

const scheduler = { schedule: () => () => {} };

describe('WeeklyMeasuresStateGatesProducer', () => {
  it('publishes every roster member, including a real zero, in the 4am weekly interval', async () => {
    const assertions = [];
    const weeklyMeasures = { execute: vi.fn(async () => ({
      window: { from: '2026-08-30', to: '2026-09-05' },
      learners: [
        { learnerId: 'kid-one', measures: [{ id: 'fitness.rings', value: 42 }] },
        { learnerId: 'kid-two', measures: [{ id: 'fitness.rings', value: 0 }] },
      ],
    })) };
    const producer = new WeeklyMeasuresStateGatesProducer({
      weeklyMeasures,
      publishAssertion: async assertion => assertions.push(assertion),
      timezone: 'America/Los_Angeles',
      clock: () => new Date('2026-08-30T19:00:00.000Z'),
      scheduler,
    });

    await producer.start();
    expect(assertions).toHaveLength(2);
    expect(assertions.map(value => value.value)).toEqual([42, 0]);
    expect(assertions[0]).toMatchObject({
      assertionId: 'fitness:weekly-rings:kid-one:2026-08-30:2026-09-05',
      claimTypeId: 'fitness.weekly.rings',
      period: {
        kind: 'interval', id: 'fitness-week:2026-08-30:2026-09-05',
        startsAt: Date.parse('2026-08-30T04:00:00-07:00'),
        endsAt: Date.parse('2026-09-06T04:00:00-07:00'),
      },
    });
    producer.stop();
  });

  it('deduplicates unchanged totals and corrects changed totals with a higher source revision', async () => {
    let rings = 3;
    const assertions = [];
    const producer = new WeeklyMeasuresStateGatesProducer({
      weeklyMeasures: { execute: async () => ({
        window: { from: '2026-08-30', to: '2026-09-05' },
        learners: [{ learnerId: 'kid', measures: [{ id: 'fitness.rings', value: rings }] }],
      }) },
      publishAssertion: async assertion => assertions.push(assertion),
      timezone: 'UTC', clock: () => new Date('2026-08-30T12:00:00Z'), scheduler,
    });
    await producer.start();
    await producer.reconcile();
    expect(assertions).toHaveLength(1);
    rings = 4;
    await producer.reconcile();
    expect(assertions).toHaveLength(2);
    expect(assertions[1].sourceRevision).toBeGreaterThan(assertions[0].sourceRevision);
    producer.stop();
  });

  it('periodically reconciles totals as a missed-notification backstop', async () => {
    let rings = 3;
    const scheduled = [];
    const assertions = [];
    const producer = new WeeklyMeasuresStateGatesProducer({
      weeklyMeasures: { execute: async () => ({
        window: { from: '2026-08-30', to: '2026-09-05' },
        learners: [{ learnerId: 'kid', measures: [{ id: 'fitness.rings', value: rings }] }],
      }) },
      publishAssertion: async assertion => assertions.push(assertion),
      timezone: 'UTC', clock: () => new Date('2026-08-30T12:00:00Z'),
      scheduler: { schedule: (_delay, task) => { scheduled.push(task); return () => {}; } },
    });
    await producer.start();
    expect(assertions.map(value => value.value)).toEqual([3]);
    rings = 5;
    await scheduled[0]();
    expect(assertions.map(value => value.value)).toEqual([3, 5]);
    producer.stop();
  });
});
