import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { PROGRESS_MIN_MS, runWorker, stageRun } from './workerCommand.mjs';
import { refinedEdlName } from '../../server/domain/content-filter/refine/refinedEdl.mjs';

const edl = { title: 'Film', sourceRef: { workId: 5, tagSetId: 6 }, cues: [] };
const claimed = (kind = 'make', extra = {}) => ({
  ratingKey: '77', run: { id: 'r1', kind, cues: kind === 'send-back' ? ['va1'] : undefined }, steps: kind === 'send-back' ? ['preflight', 'refine'] : ['preflight', 'refine', 'scenes'],
  inputs: { edl, refined: { cues: [{ id: 'va1' }] }, override: { sync: { scale: 1 }, cueOverrides: { va1: { startMs: 1, endMs: 2, effect: 'mute' } } },
    profiles: { family: { categories: {} } }, refineReview: null, transcripts: { 9: { segments: [] } } }, ...extra,
});
const fakeApi = (queue) => {
  const calls = [];
  const api = { calls, claim: async () => { calls.push(['claim']); return queue.shift() ?? null; },
    progress: async (rk, id, body) => { calls.push(['progress', body.step?.name ?? null, body.step?.status ?? null]); },
    complete: async (rk, id, body) => { calls.push(['complete', body.status, body.step ?? null]); api.result = body; } };
  return api;
};

describe('stageRun', () => {
  it('lays out the inputs where the CLI looks, links auth from the real data dir, and collects results', () => {
    const real = mkdtempSync(path.join(os.tmpdir(), 'cf-real-'));
    mkdirSync(path.join(real, 'household', 'auth'), { recursive: true });
    writeFileSync(path.join(real, 'household', 'auth', 'plex.yml'), 'token: t');
    mkdirSync(path.join(real, 'users', 'kc'), { recursive: true });
    writeFileSync(path.join(real, 'users', 'kc', 'profile.yml'), 'name: kc');
    mkdirSync(path.join(real, 'household', 'content-filter', 'overrides'), { recursive: true });
    writeFileSync(path.join(real, 'household', 'content-filter', 'overrides', '77.yml'), 'live: true');
    const s = stageRun(claimed(), { root: mkdtempSync(path.join(os.tmpdir(), 'cf-stage-')), realDataDir: real });
    expect(readFileSync(path.join(s.dataDir, 'household', 'auth', 'plex.yml'), 'utf8')).toBe('token: t');
    expect(readFileSync(path.join(s.dataDir, 'users', 'kc', 'profile.yml'), 'utf8')).toBe('name: kc');
    // The live content-filter folder is never linked: the staged copy is what the run writes.
    expect(readFileSync(path.join(s.dataDir, 'household', 'content-filter', 'overrides', '77.yml'), 'utf8')).not.toContain('live');
    expect(existsSync(path.join(s.mediaDir, 'content-filter', 'edl', '77.edl.yml'))).toBe(true);
    expect(existsSync(path.join(s.mediaDir, 'content-filter', 'refined', refinedEdlName(edl)))).toBe(true);
    expect(existsSync(path.join(s.mediaDir, 'content-filter', 'refine', '77', 'words-9.json'))).toBe(true);
    writeFileSync(path.join(s.mediaDir, 'content-filter', 'refined', refinedEdlName(edl)), yaml.dump({ cues: [{ id: 'va1', precision: 'ms' }] }));
    const r = s.collect({ exported: false });
    expect(r.refined).toEqual({ cues: [{ id: 'va1', precision: 'ms' }] });
    expect(r.override.sync).toEqual({ scale: 1 });
    expect(r.transcripts).toEqual({ 9: { segments: [] } });
    expect(r.edl).toBeUndefined();
  });
});

describe('runWorker (remote)', () => {
  const opts = (api, runStep) => ({ api, owner: 'w1', ticks: 2, sleep: async () => {}, runStep, stageRoot: mkdtempSync(path.join(os.tmpdir(), 'cf-w-')), realDataDir: null });
  it('runs the claimed steps in order, reports each, and completes with the results', async () => {
    const api = fakeApi([claimed()]); const ran = [];
    await runWorker(opts(api, async (name) => { ran.push(name); return { code: 0, stderrTail: '' }; }));
    expect(ran).toEqual(['preflight', 'refine', 'scenes']);
    expect(api.calls.filter((c) => c[0] === 'progress' && c[2] === 'done').map((c) => c[1])).toEqual(['preflight', 'refine', 'scenes']);
    expect(api.calls.find((c) => c[0] === 'complete')).toEqual(['complete', 'done', null]);
    expect(api.result.results.refined).toEqual({ cues: [{ id: 'va1' }] });
  });
  it('a failing step completes the run as failed with that step and its error', async () => {
    const api = fakeApi([claimed()]);
    await runWorker(opts(api, async (name) => (name === 'preflight' ? { code: 1, stderrTail: 'Refine cannot run here: torch and torchaudio are not installed' } : { code: 0 })));
    expect(api.calls.find((c) => c[0] === 'complete')).toEqual(['complete', 'failed', 'preflight']);
    expect(api.result.error).toBe('Refine cannot run here: torch and torchaudio are not installed');
    expect(api.result.results).toBeUndefined();
  });
  it('send-back drops the cue\'s hand fix in its copy only after preflight passed', async () => {
    const api = fakeApi([claimed('send-back')]); let atRefine = null; let atPreflight = null;
    await runWorker({ ...opts(api, async (name, ctx) => {
      const ov = yaml.load(readFileSync(path.join(ctx.dataDir, 'household', 'content-filter', 'overrides', '77.yml'), 'utf8'));
      if (name === 'preflight') atPreflight = ov.cueOverrides.va1;
      if (name === 'refine') atRefine = ov.cueOverrides.va1;
      return { code: 0 };
    }) });
    expect(atPreflight).toMatchObject({ startMs: 1, endMs: 2 });
    expect(atRefine).toEqual({ effect: 'mute' });
    expect(api.result.results.override.cueOverrides.va1).toEqual({ effect: 'mute' });
  });
  it('sleeps when nothing is queued and keeps going after an error', async () => {
    const events = []; let n = 0;
    const api = { claim: async () => { n++; if (n === 1) throw new Error('ECONNREFUSED'); return null; } };
    await runWorker({ api, owner: 'w1', ticks: 2, sleep: async () => {}, runStep: async () => ({ code: 0 }), log: (e) => events.push(e), stageRoot: os.tmpdir() });
    expect(events).toContain('content-filter.worker.error');
  });

  it('reports refine\'s measured count as progress: first and last cue, and at most every PROGRESS_MIN_MS between', async () => {
    const api = fakeApi([claimed()]); const bodies = [];
    const progress = api.progress; api.progress = async (rk, id, body) => { if (body.step?.progress) bodies.push(body.step.progress); return progress(rk, id, body); };
    let t = 0;
    await runWorker({ ...opts(api, async (name, ctx) => {
      if (name !== 'refine') return { code: 0 };
      ctx.onLine('Sync: local = va x 1 + 0 s');
      for (let i = 1; i <= 5; i++) { t += 100; ctx.onLine(`  [${i}/5] va${i} visual unknown x`); }
      return { code: 0 };
    }), now: () => t });
    expect(bodies.map((b) => [b.phase, b.done])).toEqual([['sync', 0], ['measure', 1], ['measure', 5]]);
    expect(bodies.at(-1).recent[0].cue).toBe('va5');
    expect(PROGRESS_MIN_MS).toBe(2000);
  });

  it('a stopped run: the refused report aborts the step and nothing is completed', async () => {
    const api = fakeApi([claimed()]); let signal = null;
    // Stopped from Admin while refine runs: the next report (refine's progress) is refused.
    api.progress = async (rk, id, body) => { if (!body.step?.progress) return; throw new Error('This run is no longer yours.'); };
    await runWorker(opts(api, async (name, ctx) => {
      if (name !== 'refine') return { code: 0 };
      signal = ctx.signal;
      ctx.onLine('Sync: x');
      await new Promise((r) => setTimeout(r, 20));
      return { code: signal.aborted ? 1 : 0 };
    }));
    expect(signal.aborted).toBe(true);
    expect(api.calls.find((c) => c[0] === 'complete')).toBeUndefined();
  });

  it('a failed run keeps its transcript for the next run of the film (2026-11-12: a retry re-transcribed for an hour)', async () => {
    const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'cf-tx-'));
    const wordsOf = (ctx) => path.join(ctx.mediaDir, 'content-filter', 'refine', '77');
    let seen = null;
    const api1 = fakeApi([claimed()]);
    await runWorker({ ...opts(api1, async (name, ctx) => {
      if (name === 'refine') { mkdirSync(wordsOf(ctx), { recursive: true }); writeFileSync(path.join(wordsOf(ctx), 'words-9.json'), '{"words":[1]}'); }
      return name === 'scenes' ? { code: 1, stderrTail: 'boom' } : { code: 0 };
    }), transcriptCacheDir: cacheDir });
    expect(api1.result.status).toBe('failed');
    const second = claimed(); second.inputs = { ...second.inputs, transcripts: {} }; // the app has none: the failed run never reported one
    const api2 = fakeApi([second]);
    await runWorker({ ...opts(api2, async (name, ctx) => {
      if (name === 'refine') seen = existsSync(path.join(wordsOf(ctx), 'words-9.json')) ? readFileSync(path.join(wordsOf(ctx), 'words-9.json'), 'utf8') : null;
      return { code: 0 };
    }), transcriptCacheDir: cacheDir });
    expect(seen).toBe('{"words":[1]}');
  });
});

