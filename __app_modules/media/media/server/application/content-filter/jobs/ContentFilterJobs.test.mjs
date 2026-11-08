import { describe, it, expect } from 'vitest';
import { ContentFilterJobs, JobConflict } from './ContentFilterJobs.mjs';

const memStore = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, load: async (rk) => (m.has(rk) ? structuredClone(m.get(rk)) : null), save: async (rk, r) => { m.set(rk, structuredClone({ ...r, ratingKey: rk })); }, list: async () => [...m.values()].map((r) => structuredClone(r)) };
};
const fakeCli = (fail = {}, gates = {}) => {
  const calls = [];
  return { calls, run: async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (gates[cmd]) await gates[cmd];
    if (fail[cmd]) return { code: 2, stdout: '', stderrTail: fail[cmd] };
    if (cmd === 'audit') return { code: 0, stdout: JSON.stringify({ ok: true, rows: [{ id: 'cue:a' }], certification: { level: 'machine' }, checks: {} }), stderrTail: '' };
    return { code: 0, stdout: '', stderrTail: '' };
  } };
};
const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };
const make = (o = {}) => new ContentFilterJobs({
  store: o.store || memStore(), cli: o.cli || fakeCli(), executor: 'inline', auditDebounceMs: 0, schedule: (fn, ms) => setTimeout(fn, ms),
  film: o.film || (async () => ({ hasEdl: true, hasScenes: false, exportArgs: ['slug'] })),
  digestOf: async () => 'd1', draftCards: 'draftCards' in o ? o.draftCards : (async () => ({ drafted: 2 })),
  clearNudges: o.clearNudges || (async () => {}), logPath: () => null, logger: { info() {}, warn() {}, debug() {} },
});

describe('ContentFilterJobs', () => {
  it('a make run walks the steps in order and skips export when the EDL exists', async () => {
    const cli = fakeCli(); const jobs = make({ cli });
    await jobs.enqueue({ ratingKey: '1', kind: 'make', by: 'owner' });
    await jobs.idle();
    expect(cli.calls.map((c) => c[0])).toEqual(['preflight', 'refine', 'scenes', 'audit']);
    const rec = await jobs.record('1');
    expect(rec.runs[0].status).toBe('done');
    expect(rec.runs[0].steps.map((s) => [s.name, s.status])).toEqual([
      ['preflight', 'done'], ['export', 'skipped'], ['refine', 'done'], ['scenes', 'done'], ['cards', 'done'], ['audit', 'done']]);
    expect(rec.audit).toMatchObject({ ok: true, digest: 'd1', level: 'machine', rows: [{ id: 'cue:a' }] });
  });
  it('skips scenes when the refined EDL has scenes, and cards when there is no card writer', async () => {
    const cli = fakeCli();
    const jobs = make({ cli, film: async () => ({ hasEdl: true, hasScenes: true }), draftCards: null });
    await jobs.enqueue({ ratingKey: '1', kind: 'make' }); await jobs.idle();
    const steps = (await jobs.record('1')).runs[0].steps;
    expect(steps.find((s) => s.name === 'scenes').status).toBe('skipped');
    expect(steps.find((s) => s.name === 'cards').status).toBe('skipped');
  });
  it('a failing step stops the run with its name and stderr tail', async () => {
    const jobs = make({ cli: fakeCli({ refine: 'x'.repeat(600) }) });
    await jobs.enqueue({ ratingKey: '1', kind: 'make' }); await jobs.idle();
    const run = (await jobs.record('1')).runs[0];
    expect(run).toMatchObject({ status: 'failed', step: 'refine' });
    expect(run.steps.find((s) => s.name === 'refine').error.length).toBeLessThanOrEqual(500);
    expect(run.steps.map((s) => s.name)).not.toContain('scenes');
  });
  it('preflight failure names the dependency and runs nothing else', async () => {
    const cli = fakeCli({ preflight: 'Refine cannot run here: faster-whisper is not installed' }); const jobs = make({ cli });
    await jobs.enqueue({ ratingKey: '1', kind: 'make' }); await jobs.idle();
    const run = (await jobs.record('1')).runs[0];
    expect(run.steps[0].error).toBe('Refine cannot run here: faster-whisper is not installed');
    expect(cli.calls).toHaveLength(1);
  });
  it('queues films FIFO with one running, and refuses a second run for the same film', async () => {
    const gate = deferred(); const cli = fakeCli({}, { refine: gate.p }); const jobs = make({ cli });
    await jobs.enqueue({ ratingKey: '1', kind: 'make' });
    await jobs.enqueue({ ratingKey: '2', kind: 'make' });
    await expect(jobs.enqueue({ ratingKey: '1', kind: 'make' })).rejects.toBeInstanceOf(JobConflict);
    await new Promise((r) => setTimeout(r, 10));
    const s = await jobs.state();
    expect(s.running).toEqual([{ ratingKey: '1', runId: expect.any(String), step: 'refine' }]);
    expect(s.queued.map((q) => q.ratingKey)).toEqual(['2']);
    expect(await jobs.busyWriting('1')).toBe(true);
    expect(await jobs.busyWriting('2')).toBe(false);
    gate.resolve(); await jobs.idle();
    expect(cli.calls.filter((c) => c[0] === 'refine').map((c) => c[1])).toEqual(['1', '2']);
  });
  it('recover() marks running and queued runs interrupted and starts nothing', async () => {
    const store = memStore({ 1: { ratingKey: '1', runs: [{ id: 'a', kind: 'make', status: 'running', step: 'refine', steps: [] }] },
      2: { ratingKey: '2', runs: [{ id: 'b', kind: 'make', status: 'queued', step: null, steps: [] }] } });
    const cli = fakeCli(); const jobs = make({ store, cli });
    await jobs.recover();
    expect((await jobs.record('1')).runs[0]).toMatchObject({ status: 'interrupted', step: 'refine' });
    expect((await jobs.record('2')).runs[0].status).toBe('interrupted');
    await jobs.idle();
    expect(cli.calls).toEqual([]);
  });
  it('send-back clears the cues\' nudges, refines only those cues, then audits', async () => {
    const cleared = []; const cli = fakeCli();
    const jobs = make({ cli, clearNudges: async (rk, ids) => { cleared.push([rk, ids]); } });
    await jobs.enqueue({ ratingKey: '1', kind: 'send-back', cues: ['va1', 'va2'] }); await jobs.idle();
    expect(cleared).toEqual([['1', ['va1', 'va2']]]);
    expect(cli.calls).toEqual([['preflight', '1'], ['refine', '1', '--cues', 'va1,va2', '--write'], ['audit', '1', '--json']]);
  });
  it('an audit requested during a long refine runs at once on the light lane', async () => {
    const gate = deferred(); const cli = fakeCli({}, { refine: gate.p }); const jobs = make({ cli });
    await jobs.enqueue({ ratingKey: '1', kind: 'make' });
    await new Promise((r) => setTimeout(r, 10));
    await jobs.audit('2');
    expect(cli.calls.map((c) => c.slice(0, 2))).toContainEqual(['audit', '2']);
    expect((await jobs.record('2')).audit.ok).toBe(true);
    gate.resolve(); await jobs.idle();
  });
  it('a stage run runs that one step, then audits; an unknown stage is refused', async () => {
    const cli = fakeCli(); const jobs = make({ cli });
    await jobs.enqueue({ ratingKey: '1', kind: 'stage', stage: 'scenes' }); await jobs.idle();
    expect(cli.calls).toEqual([['preflight', '1'], ['scenes', '1', '--write'], ['audit', '1', '--json']]);
    await expect(jobs.enqueue({ ratingKey: '1', kind: 'stage', stage: 'nope' })).rejects.toThrow('Unknown stage');
  });
  it('a send-back whose preflight fails keeps the hand fix', async () => {
    const cleared = [];
    const jobs = make({ cli: fakeCli({ preflight: 'Refine cannot run here: torch and torchaudio are not installed' }), clearNudges: async (rk, ids) => { cleared.push(ids); } });
    await jobs.enqueue({ ratingKey: '1', kind: 'send-back', cues: ['va1'] }); await jobs.idle();
    expect(cleared).toEqual([]);
    expect((await jobs.record('1')).runs[0]).toMatchObject({ status: 'failed', step: 'preflight' });
  });
});
