import { describe, it, expect } from 'vitest';
import { ContentFilterJobs } from './ContentFilterJobs.mjs';

const memStore = (init = {}) => {
  const m = new Map(Object.entries(init)); const claims = new Set();
  return { m, load: async (rk) => (m.has(rk) ? structuredClone(m.get(rk)) : null), save: async (rk, r) => { m.set(rk, structuredClone({ ...r, ratingKey: rk })); },
    list: async () => [...m.values()].map((r) => structuredClone(r)),
    claim: async (rk, runId) => { const k = `${rk}:${runId}`; if (claims.has(k)) return false; claims.add(k); return true; } };
};
const cli = () => { const calls = []; return { calls, run: async (cmd, args) => { calls.push([cmd, ...args]); return cmd === 'audit' ? { code: 0, stdout: '{"ok":true,"rows":[]}', stderrTail: '' } : { code: 0, stdout: '', stderrTail: '' }; } }; };
const make = (o) => new ContentFilterJobs({ store: o.store, cli: o.cli || cli(), executor: o.executor || 'worker', auditDebounceMs: 0,
  schedule: (fn, ms) => setTimeout(fn, ms), now: o.now || (() => new Date()), film: async () => ({ hasEdl: true, hasScenes: true }),
  digestOf: async () => 'd', draftCards: o.draftCards ?? null, logPath: () => null, logger: { info() {}, warn() {}, debug() {} } });

describe('ContentFilterJobs with a filter worker', () => {
  it('the app in worker mode queues but never runs the CLI', async () => {
    const c = cli(); const jobs = make({ store: memStore(), cli: c });
    await jobs.enqueue({ ratingKey: '1', kind: 'make' });
    await new Promise((r) => setTimeout(r, 20));
    expect(c.calls).toEqual([]);
    expect((await jobs.state()).queued.map((q) => q.ratingKey)).toEqual(['1']);
  });
  it('two workers never take the same run', async () => {
    const store = memStore();
    const app = make({ store }); await app.enqueue({ ratingKey: '1', kind: 'make' });
    const [a, b] = await Promise.all([make({ store, executor: 'inline' }).claimNext('w1'), make({ store, executor: 'inline' }).claimNext('w2')]);
    expect([a, b].filter(Boolean)).toEqual(['1']);
  });
  it('a worker run records its owner and heartbeat; a stale heartbeat becomes interrupted', async () => {
    const store = memStore({ 1: { ratingKey: '1', runs: [{ id: 'a', kind: 'make', status: 'running', step: 'refine', steps: [], worker: 'w1', heartbeatAt: '2026-11-08T00:00:00.000Z' }] } });
    const jobs = make({ store, executor: 'inline', now: () => new Date('2026-11-08T00:02:00Z') });
    expect(await jobs.reapStale({ maxAgeMs: 60000 })).toBe(1);
    expect((await jobs.record('1')).runs[0]).toMatchObject({ status: 'interrupted', step: 'refine' });
  });
  it('the app watcher fires onSettled for a run the worker finished, and drafts its cards', async () => {
    const store = memStore({ 1: { ratingKey: '1', runs: [{ id: 'a', kind: 'make', status: 'running', step: 'refine', steps: [] }] } });
    const drafted = []; const settled = [];
    const app = make({ store, draftCards: async (rk) => { drafted.push(rk); return { drafted: 1 }; } });
    app.onSettled((e) => settled.push(e));
    await app.watchOnce();
    store.m.get('1').runs[0] = { id: 'a', kind: 'make', status: 'done', step: 'audit', steps: [{ name: 'cards', status: 'skipped', note: 'worker' }] };
    await app.watchOnce();
    expect(settled).toEqual([{ ratingKey: '1', runId: 'a', status: 'done' }]);
    expect(drafted).toEqual(['1']);
  });
});
