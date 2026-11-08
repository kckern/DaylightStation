import { describe, it, expect } from 'vitest';
import { runWorker } from './workerCommand.mjs';

describe('runWorker', () => {
  it('reaps stale runs, claims and runs the next film, and sleeps when idle', async () => {
    const calls = []; const queue = ['77'];
    const jobs = { reapStale: async () => { calls.push('reap'); return 0; }, claimNext: async (o) => { calls.push(`claim:${o}`); return queue.shift() ?? null; },
      runNext: async (rk, { owner }) => { calls.push(`run:${rk}:${owner}`); } };
    const slept = [];
    await runWorker({ jobs, owner: 'w1', ticks: 2, sleep: async (ms) => { slept.push(ms); } });
    expect(calls).toEqual(['reap', 'claim:w1', 'run:77:w1', 'reap', 'claim:w1']);
    expect(slept).toEqual([5000]);
  });
  it('keeps going after an error', async () => {
    const events = [];
    await runWorker({ jobs: { reapStale: async () => { throw new Error('disk'); } }, owner: 'w1', ticks: 1, sleep: async () => {}, log: (e, d) => events.push([e, d.error]) });
    expect(events).toContainEqual(['content-filter.worker.error', 'disk']);
  });
});
