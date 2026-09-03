import { describe, expect, it, vi } from 'vitest';
import { WeeklyMeasuresStateGatesProducer } from '#apps/measures/WeeklyMeasuresStateGatesProducer.mjs';

const scheduler = { schedule: () => () => {} };

/** A scheduler that records every armed timer and refuses to run a cancelled one. */
function recordingScheduler() {
  const calls = [];
  return {
    calls,
    schedule: (delayMs, fn) => {
      const entry = { delayMs, cancelled: false, fn: async () => {
        if (entry.cancelled) throw new Error('ran a cancelled timer');
        return fn();
      } };
      calls.push(entry);
      return () => { entry.cancelled = true; };
    },
  };
}

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

  it('publishes learners one at a time so they never race the household revision', async () => {
    let inFlight = 0; let maxInFlight = 0; const published = [];
    const producer = new WeeklyMeasuresStateGatesProducer({
      weeklyMeasures: { execute: async () => ({
        window: { from: '2026-08-30', to: '2026-09-05' },
        learners: ['a', 'b', 'c', 'd'].map((id) => ({ learnerId: id, measures: [{ id: 'fitness.rings', value: 1 }] })),
      }) },
      publishAssertion: async (assertion) => {
        inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        published.push(assertion.subject.id);
        inFlight -= 1;
      },
      timezone: 'UTC', clock: () => new Date('2026-08-30T12:00:00Z'), scheduler,
    });
    await producer.reconcile();
    expect(maxInFlight).toBe(1);
    expect(published).toEqual(['a', 'b', 'c', 'd']);
    producer.stop();
  });

  it('a failing learner does not stop the learners after it', async () => {
    const published = [];
    const producer = new WeeklyMeasuresStateGatesProducer({
      weeklyMeasures: { execute: async () => ({
        window: { from: '2026-08-30', to: '2026-09-05' },
        learners: ['a', 'b', 'c'].map((id) => ({ learnerId: id, measures: [{ id: 'fitness.rings', value: 1 }] })),
      }) },
      publishAssertion: async (assertion) => {
        if (assertion.subject.id === 'b') throw new Error('boom');
        published.push(assertion.subject.id);
      },
      timezone: 'UTC', clock: () => new Date('2026-08-30T12:00:00Z'), scheduler,
      logger: { warn: () => {} },
    });
    await producer.reconcile();
    expect(published).toEqual(['a', 'c']);
    producer.stop();
  });
});

describe('WeeklyMeasuresStateGatesProducer — reconcile coalescing by change kind', () => {
  const build = (sched) => new WeeklyMeasuresStateGatesProducer({
    weeklyMeasures: { execute: async () => ({ window: { from: '2026-08-30', to: '2026-09-05' }, learners: [] }) },
    publishAssertion: async () => {},
    timezone: 'UTC', clock: () => new Date('2026-08-30T12:00:00Z'),
    scheduler: sched, debounceMs: 500, savedDebounceMs: 60_000,
  });

  it('schedules a plain session save on the slow debounce, not the prompt one', () => {
    const sched = recordingScheduler();
    build(sched).requestReconcile({ operation: 'saved' });
    expect(sched.calls.map((c) => c.delayMs)).toEqual([60_000]);
  });

  it('a session end arriving behind a pending save upgrades it to the prompt debounce', () => {
    const sched = recordingScheduler();
    const producer = build(sched);
    producer.requestReconcile({ operation: 'saved' });
    producer.requestReconcile({ operation: 'ended' });
    expect(sched.calls[0].cancelled).toBe(true);
    expect(sched.calls.map((c) => c.delayMs)).toEqual([60_000, 500]);
  });

  it('a save arriving behind a pending prompt reconcile is absorbed, not rescheduled', () => {
    const sched = recordingScheduler();
    const producer = build(sched);
    producer.requestReconcile({ operation: 'ended' });
    producer.requestReconcile({ operation: 'saved' });
    expect(sched.calls.map((c) => c.delayMs)).toEqual([500]);
  });

  it('a request with no change object still reconciles promptly (backstop callers)', () => {
    const sched = recordingScheduler();
    build(sched).requestReconcile();
    expect(sched.calls.map((c) => c.delayMs)).toEqual([500]);
  });

  it('repeated saves during a live session ride one window, not a receding one', () => {
    const sched = recordingScheduler();
    const producer = build(sched);
    producer.requestReconcile({ operation: 'saved' });
    producer.requestReconcile({ operation: 'saved' });
    producer.requestReconcile({ operation: 'saved' });
    expect(sched.calls.map((c) => c.delayMs)).toEqual([60_000]);
    expect(sched.calls[0].cancelled).toBe(false);
    producer.stop();
  });

  it('clears its pending state once the refresh fires, so the next save re-arms', async () => {
    const sched = recordingScheduler();
    const producer = build(sched);
    producer.requestReconcile({ operation: 'saved' });
    await sched.calls[0].fn();
    producer.requestReconcile({ operation: 'saved' });
    expect(sched.calls.map((c) => c.delayMs)).toEqual([60_000, 60_000]);
    producer.stop();
  });

  it('stop() cancels a pending refresh and later requests schedule nothing', () => {
    const sched = recordingScheduler();
    const producer = build(sched);
    producer.requestReconcile({ operation: 'saved' });
    producer.stop();
    expect(sched.calls[0].cancelled).toBe(true);
    producer.requestReconcile({ operation: 'ended' });
    expect(sched.calls).toHaveLength(1);
  });

  it('a throwing scheduler does not wedge later requests', () => {
    let boom = true;
    const armed = [];
    const sched = { schedule: (d) => { if (boom) throw new Error('x'); armed.push(d); return () => {}; } };
    const producer = build(sched);
    producer.requestReconcile({ operation: 'ended' });   // must not throw out
    boom = false;
    producer.requestReconcile({ operation: 'ended' });
    expect(armed).toEqual([500]);
    producer.stop();
  });

  it('survives a scheduler that returns a non-function cancel', () => {
    const producer = build({ schedule: () => undefined });
    producer.requestReconcile({ operation: 'ended' });
    expect(() => producer.stop()).not.toThrow();
  });

  it('re-runs once when a request lands mid-flight, so an end-of-session value is not lost', async () => {
    let rings = 3;
    const reads = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const producer = new WeeklyMeasuresStateGatesProducer({
      weeklyMeasures: { execute: async () => {
        reads.push(rings);
        if (reads.length === 1) await gate;
        return { window: { from: '2026-08-30', to: '2026-09-05' },
                 learners: [{ learnerId: 'kid', measures: [{ id: 'fitness.rings', value: rings }] }] };
      } },
      publishAssertion: async () => {},
      timezone: 'UTC', clock: () => new Date('2026-08-30T12:00:00Z'), scheduler,
    });
    const first = producer.reconcile();
    rings = 9;                       // session ends, rings finalise
    const second = producer.reconcile();  // dropped before the trailing re-run
    release();
    await first; await second;
    await vi.waitFor(() => expect(reads).toEqual([3, 9])); // the second value WAS read
    producer.stop();
  });
});
