import { describe, it, expect } from 'vitest';
import { ContentFilterJobs, JobConflict } from './ContentFilterJobs.mjs';

const memStore = () => {
  const m = new Map(); const claims = new Set();
  return { m, load: async (rk) => (m.has(rk) ? structuredClone(m.get(rk)) : null), save: async (rk, r) => { m.set(rk, structuredClone({ ...r, ratingKey: rk })); },
    list: async () => [...m.values()].map((r) => structuredClone(r)),
    claim: async (rk, id) => { if (claims.has(`${rk}:${id}`)) return false; claims.add(`${rk}:${id}`); return true; } };
};
const cli = () => { const calls = []; return { calls, run: async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: '{"ok":true,"rows":[{"id":"cue:a"}]}', stderrTail: '' }; } }; };
const make = (o = {}) => new ContentFilterJobs({
  store: o.store || memStore(), cli: o.cli || cli(), executor: 'worker', auditDebounceMs: 0, schedule: (fn, ms) => setTimeout(fn, ms),
  film: async () => ({ hasEdl: true, hasScenes: false }), digestOf: async () => 'd',
  draftCards: o.draftCards ?? (async () => ({ drafted: 1 })),
  inputsOf: async (rk) => ({ ratingKey: rk, override: { sync: {} } }),
  applyResults: o.applyResults || (async () => {}),
  logPath: () => null, logger: { info() {}, warn() {}, debug() {} },
});

describe('remote filter worker API', () => {
  it('claim: nothing queued → null; else the oldest run, running for that worker, with its worker steps and inputs', async () => {
    const jobs = make();
    expect(await jobs.claimRemote({ owner: 'w1' })).toBeNull();
    await jobs.enqueue({ ratingKey: '1', kind: 'make' });
    const c = await jobs.claimRemote({ owner: 'w1' });
    expect(c).toMatchObject({ ratingKey: '1', steps: ['preflight', 'refine', 'scenes'], inputs: { ratingKey: '1' } });
    const run = (await jobs.record('1')).runs[0];
    expect(run).toMatchObject({ status: 'running', worker: 'w1', step: 'claimed' });
    expect(run.steps).toContainEqual(expect.objectContaining({ name: 'export', status: 'skipped' }));
    expect(await jobs.busyWriting('1')).toBe(true);
    expect(await jobs.claimRemote({ owner: 'w2' })).toBeNull();
  });
  it('progress records the step and heartbeat; another worker is refused', async () => {
    const jobs = make(); await jobs.enqueue({ ratingKey: '1', kind: 'make' });
    const { run } = await jobs.claimRemote({ owner: 'w1' });
    await jobs.progress({ ratingKey: '1', runId: run.id, owner: 'w1', step: { name: 'refine', status: 'running' } });
    expect((await jobs.record('1')).runs[0].step).toBe('refine');
    await expect(jobs.progress({ ratingKey: '1', runId: run.id, owner: 'w2' })).rejects.toBeInstanceOf(JobConflict);
  });
  it('complete done: results applied, then cards and audit in the app, then done', async () => {
    const applied = [];
    const jobs = make({ applyResults: async (rk, r) => { applied.push([rk, r]); } });
    await jobs.enqueue({ ratingKey: '1', kind: 'make' });
    const { run } = await jobs.claimRemote({ owner: 'w1' });
    await jobs.complete({ ratingKey: '1', runId: run.id, owner: 'w1', status: 'done', results: { refined: { cues: [] } } });
    expect(applied).toEqual([['1', { refined: { cues: [] } }]]);
    const rec = await jobs.record('1');
    expect(rec.runs[0].status).toBe('done');
    expect(rec.runs[0].steps.map((s) => [s.name, s.status])).toEqual(expect.arrayContaining([['cards', 'done'], ['audit', 'done']]));
    expect(rec.audit.rows).toEqual([{ id: 'cue:a' }]);
  });
  it('complete failed: no results applied; the run fails at the worker\'s step', async () => {
    const applied = [];
    const jobs = make({ applyResults: async () => { applied.push(1); } });
    await jobs.enqueue({ ratingKey: '1', kind: 'make' });
    const { run } = await jobs.claimRemote({ owner: 'w1' });
    await jobs.complete({ ratingKey: '1', runId: run.id, owner: 'w1', status: 'failed', step: 'preflight', error: 'Refine cannot run here: torch and torchaudio are not installed' });
    expect(applied).toEqual([]);
    expect((await jobs.record('1')).runs[0]).toMatchObject({ status: 'failed', step: 'preflight' });
  });
  it('a reaped run cannot be completed', async () => {
    const jobs = make(); await jobs.enqueue({ ratingKey: '1', kind: 'make' });
    const { run } = await jobs.claimRemote({ owner: 'w1' });
    const store = jobs; void store;
    await jobs.reapStale({ maxAgeMs: -1 });
    await expect(jobs.complete({ ratingKey: '1', runId: run.id, owner: 'w1', status: 'done', results: {} })).rejects.toBeInstanceOf(JobConflict);
  });
});

describe('worker presence', () => {
  it('a worker that asked for work in the last 30 s is alive; none seen is not', async () => {
    let t = Date.parse('2026-11-08T00:00:00Z');
    const jobs = new ContentFilterJobs({ store: memStore(), cli: cli(), executor: 'worker', schedule: (fn, ms) => setTimeout(fn, ms),
      film: async () => ({}), digestOf: async () => 'd', now: () => new Date(t), logger: { info() {} } });
    expect(jobs.workerStatus()).toEqual({ alive: false, owner: null, seenAt: null });
    await jobs.claimRemote({ owner: 'w1' });
    expect(jobs.workerStatus()).toMatchObject({ alive: true, owner: 'w1' });
    t += 31000;
    expect(jobs.workerStatus().alive).toBe(false);
  });

  it('progress keeps refine\'s measured count (cleaned, 8 latest), its start time, and survives a bare heartbeat', async () => {
    let t = Date.parse('2026-11-12T10:00:00Z');
    const jobs = new ContentFilterJobs({ ...{}, store: memStore(), cli: cli(), executor: 'worker', auditDebounceMs: 0, schedule: (fn, ms) => setTimeout(fn, ms),
      film: async () => ({ hasEdl: true }), digestOf: async () => 'd', inputsOf: async () => ({}), logPath: () => null,
      logger: { info() {}, warn() {}, debug() {} }, now: () => new Date(t) });
    await jobs.enqueue({ ratingKey: '1', kind: 'make' });
    const { run } = await jobs.claimRemote({ owner: 'w1' });
    await jobs.progress({ ratingKey: '1', runId: run.id, owner: 'w1', step: { name: 'refine', status: 'running' } });
    t += 60e3;
    const recent = Array.from({ length: 20 }, (_, i) => ({ cue: `va${i}`, kind: 'visual', status: 'unknown', detail: 'x'.repeat(200) }));
    await jobs.progress({ ratingKey: '1', runId: run.id, owner: 'w1', step: { name: 'refine', status: 'running', progress: { phase: 'measure', done: 3.7, total: 220, firstAt: 'f', at: 'a', recent, junk: 1 } } });
    await jobs.progress({ ratingKey: '1', runId: run.id, owner: 'w1' });
    const step = (await jobs.record('1')).runs[0].steps.find((x) => x.name === 'refine');
    expect(step.startedAt).toBe('2026-11-12T10:00:00.000Z');
    expect(step.progress).toMatchObject({ phase: 'measure', done: 3, total: 220, firstAt: 'f' });
    expect(step.progress.junk).toBeUndefined();
    expect(step.progress.recent).toHaveLength(8);
    expect(step.progress.recent[0].detail).toHaveLength(80);
  });

  it('stop: a queued run is cancelled at once and leaves the queue', async () => {
    const jobs = make(); const run = await jobs.enqueue({ ratingKey: '1', kind: 'make' });
    const out = await jobs.cancel({ ratingKey: '1', runId: run.id, by: 'admin' });
    expect(out).toMatchObject({ status: 'cancelled', cancelledBy: 'admin' });
    expect((await jobs.state()).queued).toEqual([]);
    expect(await jobs.claimRemote({ owner: 'w1' })).toBeNull();
  });
  it('stop: a running run is cancelled; the worker\'s next report is refused; a second stop is 409', async () => {
    const jobs = make(); await jobs.enqueue({ ratingKey: '1', kind: 'make' });
    const { run } = await jobs.claimRemote({ owner: 'w1' });
    await jobs.cancel({ ratingKey: '1', runId: run.id, by: 'admin' });
    expect((await jobs.state()).running).toEqual([]);
    expect(await jobs.busyWriting('1')).toBe(false);
    await expect(jobs.progress({ ratingKey: '1', runId: run.id, owner: 'w1' })).rejects.toBeInstanceOf(JobConflict);
    await expect(jobs.cancel({ ratingKey: '1', runId: run.id })).rejects.toMatchObject({ status: 409 });
    await expect(jobs.cancel({ ratingKey: '1', runId: 'nope' })).rejects.toMatchObject({ status: 404 });
  });
});
