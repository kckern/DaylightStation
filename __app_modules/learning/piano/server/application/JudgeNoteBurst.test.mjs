import { describe, it, expect, vi } from 'vitest';
import { JudgeNoteBurst, LEGIT_QUESTION, PRESCHOOL_LEGIT_QUESTION } from './JudgeNoteBurst.mjs';
import { InMemoryLegitJudgementCache } from '../adapters/InMemoryLegitJudgementCache.mjs';
import { NodeAsyncScheduler } from '#adapters/scheduling/NodeAsyncScheduler.mjs';

const burst = (n = 10, shift = 0) => ({
  notes: Array.from({ length: n }, (_, i) => ({ pitch: 60 + ((i + shift) % 5), onsetMs: i * 300, durMs: 200, velocity: 60 + i })),
  stats: { notes: n, distinctPitches: 5, pitchSpan: 4, medianIoiMs: 300, velocitySpread: n },
});
function gateway(p = 0.82, { hang = false } = {}) {
  const evaluate = vi.fn(async () => {
    if (hang) return new Promise(() => {});
    return { model: 'm', answers: { legit: { type: 'yesNo', probability: p } } };
  });
  return { evaluate };
}
const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
const make = (gw, opts = {}) => new JudgeNoteBurst({ decisionGateway: gw, cache: new InMemoryLegitJudgementCache(), enabled: () => true, timeoutMs: 50, scheduler: new NodeAsyncScheduler(), logger, ...opts });
const req = (over = {}) => ({ userId: 'u', sittingId: 's1', kind: 'check-in', index: 1, burst: burst(), ...over });

describe('JudgeNoteBurst', () => {
  it('p 0.82 → legit model; p 0.5 → not legit', async () => {
    expect(await make(gateway(0.82)).execute(req())).toMatchObject({ legit: true, probability: 0.82, source: 'model' });
    expect(await make(gateway(0.5)).execute(req())).toMatchObject({ legit: false, source: 'model' });
  });

  it('an identical burst is answered from cache with no call', async () => {
    const gw = gateway();
    const j = make(gw);
    await j.execute(req({ index: 1 }));
    expect(await j.execute(req({ index: 2 }))).toMatchObject({ source: 'cached', legit: true });
    expect(gw.evaluate).toHaveBeenCalledTimes(1);
  });

  it('the same check-in index again → rate-limited', async () => {
    const gw = gateway();
    const j = make(gw);
    await j.execute(req({ index: 3 }));
    expect(await j.execute(req({ index: 3, burst: burst(12, 2) }))).toMatchObject({ source: 'rate-limited' });
    expect(gw.evaluate).toHaveBeenCalledTimes(1);
  });

  it('a hanging gateway → fallback within the timeout', async () => {
    const t0 = Date.now();
    const r = await make(gateway(0.9, { hang: true })).execute(req());
    expect(r).toEqual({ legit: null, probability: null, source: 'fallback' });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('disabled → no call', async () => {
    const gw = gateway();
    expect(await make(gw, { enabled: () => false }).execute(req())).toMatchObject({ source: 'disabled', legit: null });
    expect(gw.evaluate).not.toHaveBeenCalled();
  });

  it('the state is exactly { notes, stats } and the question is the yesNo legitimacy question', async () => {
    const gw = gateway();
    await make(gw).execute(req());
    const [state, questions] = gw.evaluate.mock.calls[0];
    expect(Object.keys(state).sort()).toEqual(['notes', 'stats']);
    expect(JSON.stringify(state)).not.toMatch(/image|png|audio/i);
    expect(questions.legit).toEqual({ type: 'yesNo', instructions: LEGIT_QUESTION });
  });

  it('preschool bursts are asked the young-child question', async () => {
    const gw = gateway();
    await make(gw).execute(req({ preschool: true }));
    expect(gw.evaluate.mock.calls[0][1].legit.instructions).toBe(PRESCHOOL_LEGIT_QUESTION);
  });

  it('the end-of-lesson answer is stored for the progress store', async () => {
    const cache = new InMemoryLegitJudgementCache();
    const j = make(gateway(0.75), { cache });
    await j.execute(req({ kind: 'end-of-lesson', index: 0 }));
    expect(cache.get({ userId: 'u', sittingId: 's1', kind: 'end-of-lesson' })).toEqual({ probability: 0.75, source: 'model' });
  });

  it('is scoped to piano / lesson-legit-notes by its caller', async () => {
    const scoped = vi.fn(function scope() { return this; });
    const { scopedGateway } = await import('#apps/common/ports/IAIGateway.mjs');
    const gw = { ...gateway(), scoped };
    scopedGateway(gw, { app: 'piano', feature: 'lesson-legit-notes' });
    expect(scoped).toHaveBeenCalledWith({ app: 'piano', feature: 'lesson-legit-notes' });
  });
});
