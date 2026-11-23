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
  digestOf: async () => 'd', draftCards: o.draftCards ?? null, logPath: () => null, logger: o.logger || { info() {}, warn() {}, debug() {} } });

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
    let t = new Date('2026-11-08T00:00:30Z'); // the app started 30 s after the last beat
    const jobs = make({ store, executor: 'inline', now: () => t });
    expect(await jobs.reapStale({ maxAgeMs: 60000 })).toBe(0);
    t = new Date('2026-11-08T00:02:00Z'); // and has heard nothing for 90 s since
    expect(await jobs.reapStale({ maxAgeMs: 60000 })).toBe(1);
    expect((await jobs.record('1')).runs[0]).toMatchObject({ status: 'interrupted', step: 'refine' });
  });
  it('logs transcribe progress, the worker build on claim, and build + heartbeat age on interrupt', async () => {
    const store = memStore();
    const logs = [];
    let t = new Date('2026-11-08T00:00:00Z');
    const jobs = make({ store, now: () => t, logger: { info: (e, d) => logs.push([e, d]), warn: (e, d) => logs.push([e, d]), debug() {} } });
    await jobs.enqueue({ ratingKey: '1', kind: 'make' });
    const { run } = await jobs.claimRemote({ owner: 'w1', build: 'abc1234' });
    expect(logs.find(([e]) => e === 'content-filter.job.claimed')[1]).toMatchObject({ worker: 'w1', build: 'abc1234' });
    expect((await jobs.record('1')).runs[0].build).toBe('abc1234');
    await jobs.progress({ ratingKey: '1', runId: run.id, owner: 'w1', step: { name: 'refine', status: 'running', progress: { phase: 'transcribe', done: 60, total: 5945 } } });
    expect(logs.find(([e]) => e === 'content-filter.job.step')[1]).toMatchObject({ phase: 'transcribe', done: 60, total: 5945 });
    expect((await jobs.record('1')).runs[0].steps.find((x) => x.name === 'refine').progress).toMatchObject({ phase: 'transcribe', done: 60, total: 5945 });
    t = new Date('2026-11-08T00:05:00Z');
    await jobs.reapStale({ maxAgeMs: 60000 });
    expect(logs.find(([e]) => e === 'content-filter.job.interrupted')[1]).toMatchObject({ build: 'abc1234', heartbeatAgeMs: 300000 });
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
  it('a finished worker run whose cards were never drafted is drafted on the first tick (app restarted), once', async () => {
    const store = memStore({ 1: { ratingKey: '1', runs: [{ id: 'a', kind: 'make', status: 'done', step: 'audit', steps: [{ name: 'cards', status: 'skipped', note: 'worker' }] }] } });
    const drafted = [];
    const app = make({ store, draftCards: async (rk) => { drafted.push(rk); return { drafted: 1 }; } });
    await app.watchOnce(); await app.watchOnce();
    expect(drafted).toEqual(['1']);
    expect((await app.record('1')).runs[0].cardsDrafted).toBe(true);
  });
  it('the app watcher also reaps a dead worker\'s run, so a stopped worker cannot pin the gate', async () => {
    const store = memStore({ 1: { ratingKey: '1', runs: [{ id: 'a', kind: 'make', status: 'running', step: 'refine', steps: [], worker: 'w1', heartbeatAt: '2026-11-08T00:00:00.000Z' }] } });
    let t = new Date('2026-11-08T00:05:00Z');
    const app = make({ store, now: () => t });
    await app.watchOnce();
    expect((await app.record('1')).runs[0].status).toBe('running'); // just booted: the worker gets a minute
    t = new Date('2026-11-08T00:06:30Z');
    await app.watchOnce();
    expect((await app.record('1')).runs[0].status).toBe('interrupted');
  });
  it('a deploy does not reap a live worker run: its first tick after boot leaves it, a beat keeps it (2026-11-21)', async () => {
    const store = memStore({ 1: { ratingKey: '1', runs: [{ id: 'a', kind: 'make', status: 'running', step: 'refine', steps: [], worker: 'w1', heartbeatAt: '2026-11-21T04:53:51.000Z' }] } });
    let t = new Date('2026-11-21T04:55:05Z'); // container back 74 s after the last beat
    const app = make({ store, now: () => t });
    await app.watchOnce();
    expect((await app.record('1')).runs[0].status).toBe('running');
    store.m.get('1').runs[0].heartbeatAt = '2026-11-21T04:55:20.000Z'; // the worker reports again
    t = new Date('2026-11-21T04:56:10Z');
    await app.watchOnce();
    expect((await app.record('1')).runs[0].status).toBe('running');
  });
  it('audit and card-draft stages run in the app at once, even in worker mode', async () => {
    const c = cli(); const store = memStore();
    const app = make({ store, cli: c, draftCards: async () => ({ drafted: 2 }) });
    await app.enqueue({ ratingKey: '1', kind: 'stage', stage: 'audit' });
    await new Promise((r) => setTimeout(r, 30));
    expect(c.calls).toEqual([['audit', '1', '--json']]);
    expect((await app.record('1')).runs[0].status).toBe('done');
    await app.enqueue({ ratingKey: '1', kind: 'stage', stage: 'cards' });
    await new Promise((r) => setTimeout(r, 30));
    expect((await app.record('1')).runs[1]).toMatchObject({ status: 'done', steps: [{ name: 'cards', status: 'done', note: '2 drafted' }, { name: 'audit', status: 'done' }] });
  });
});
