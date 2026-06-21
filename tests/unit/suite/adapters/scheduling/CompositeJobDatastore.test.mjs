import { describe, it, expect } from '@jest/globals';
import { CompositeJobDatastore } from '#adapters/scheduling/CompositeJobDatastore.mjs';

const captureLogger = () => {
  const events = [];
  return {
    events,
    info: () => {},
    debug: () => {},
    warn: (e, d) => events.push({ e, d }),
    error: () => {},
  };
};

/** Fake IJobDatastore-shaped store. */
const fakeStore = (jobs, extra = {}) => ({
  loadJobs: async () => jobs,
  ...extra,
});

describe('CompositeJobDatastore', () => {
  it('concatenates jobs from all stores', async () => {
    const store = new CompositeJobDatastore({
      stores: [
        fakeStore([{ id: 'a' }, { id: 'b' }]),
        fakeStore([{ id: 'c' }]),
      ],
      logger: captureLogger(),
    });
    const jobs = await store.loadJobs();
    expect(jobs.map((j) => j.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps the earlier store on id collision and logs', async () => {
    const logger = captureLogger();
    const store = new CompositeJobDatastore({
      stores: [
        fakeStore([{ id: 'dup', src: 'first' }]),
        fakeStore([{ id: 'dup', src: 'second' }, { id: 'other' }]),
      ],
      logger,
    });
    const jobs = await store.loadJobs();
    const dup = jobs.find((j) => j.id === 'dup');
    expect(dup.src).toBe('first');
    expect(jobs.map((j) => j.id).sort()).toEqual(['dup', 'other']);
    const collision = logger.events.find((ev) => ev.e === 'scheduler.jobStore.id_collision');
    expect(collision).toBeTruthy();
    expect(collision.d).toMatchObject({ id: 'dup' });
  });

  it('delegates getJob to the first store that implements it', async () => {
    const store = new CompositeJobDatastore({
      stores: [
        fakeStore([{ id: 'a' }], { getJob: async (id) => ({ id, from: 'first' }) }),
        fakeStore([{ id: 'b' }], { getJob: async (id) => ({ id, from: 'second' }) }),
      ],
      logger: captureLogger(),
    });
    expect(await store.getJob('x')).toMatchObject({ from: 'first' });
  });

  it('getJob falls back to scanning merged jobs when no store implements it', async () => {
    const store = new CompositeJobDatastore({
      stores: [fakeStore([{ id: 'a' }]), fakeStore([{ id: 'b' }])],
      logger: captureLogger(),
    });
    expect((await store.getJob('b')).id).toBe('b');
    expect(await store.getJob('missing')).toBeNull();
  });
});
