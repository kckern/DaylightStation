import { describe, it, expect, vi } from 'vitest';
import { JudgeLessonSitting } from './JudgeLessonSitting.mjs';
import { NodeAsyncScheduler } from '#adapters/scheduling/NodeAsyncScheduler.mjs';
import { sittingGoodFaithState } from '../../portable/practice/sittingGoodFaith.mjs';

const STATE = sittingGoodFaithState({
  events: Array.from({ length: 20 }, (_, i) => ({ t: i * 500, note: 60 + (i % 5), velocity: 70, durMs: 300 })),
  startMs: 0, lessonSec: 600, watchedSec: 590, checkIns: [{ atMs: 120000, answered: true }],
});
const answer = (level) => ({ model: 'jev-x', usage: { inputTokens: 900 }, answers: { goodFaith: { type: 'score', score: level, probabilities: [0, 1, 2, 3, 4, 5].map((k) => (k === level ? 1 : 0)) } } });
function gateway(level = 4, { hang = false, fail = false } = {}) {
  return {
    evaluate: vi.fn(async () => {
      if (hang) return new Promise(() => {});
      if (fail) throw new Error('boom');
      return answer(level);
    }),
  };
}
const logger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
const make = (gw, opts = {}) => new JudgeLessonSitting({
  decisionGateway: gw, enabled: () => true, timeoutMs: 50, scheduler: new NodeAsyncScheduler(), logger: logger(), ...opts,
});
const req = (over = {}) => ({ userId: 'u', sittingId: 's1', state: STATE, preschool: false, ...over });

describe('JudgeLessonSitting', () => {
  it('asks one score question on the minimal MIDI log and maps the answer to 0–10', async () => {
    const gw = gateway(4);
    const j = make(gw);
    expect(await j.judge(req())).toMatchObject({ score: 9, source: 'model', model: 'jev-x' });
    const [state, questions, opts] = gw.evaluate.mock.calls[0];
    expect(Object.keys(state).sort()).toEqual(['lesson', 'notes', 'perMinute', 'presence']);
    expect(questions.goodFaith.type).toBe('score');
    expect(questions.goodFaith.levels).toHaveLength(6);
    expect(opts).toEqual({ timeout: 50 });
    expect(j.peek({ userId: 'u', sittingId: 's1' })).toMatchObject({ score: 9, source: 'model' });
  });

  it('one call per sitting: a second ask (concurrent or later) joins the first', async () => {
    const gw = gateway(3);
    const j = make(gw);
    const [a, b] = await Promise.all([j.judge(req()), j.judge(req())]);
    await j.judge(req());
    expect(a).toEqual(b);
    expect(gw.evaluate).toHaveBeenCalledTimes(1);
    await j.judge(req({ sittingId: 's2' }));
    expect(gw.evaluate).toHaveBeenCalledTimes(2);
  });

  it('the server\'s preschool flag picks the young-child wording and rides on the state', async () => {
    const gw = gateway(2);
    await make(gw).judge(req({ preschool: true }));
    const [state, questions] = gw.evaluate.mock.calls[0];
    expect(questions.goodFaith.instructions).toMatch(/small child/);
    expect(state.lesson.preschool).toBe(true);
  });

  it('a timeout or error is a final fallback: no score, and no retry for that sitting', async () => {
    const hang = gateway(4, { hang: true });
    const j = make(hang);
    expect(await j.judge(req())).toMatchObject({ score: null, source: 'fallback', reason: 'timeout' });
    expect(j.peek({ userId: 'u', sittingId: 's1' })).toMatchObject({ score: null, source: 'fallback' });
    await j.judge(req());
    expect(hang.evaluate).toHaveBeenCalledTimes(1);
    expect(await make(gateway(4, { fail: true })).judge(req())).toMatchObject({ score: null, source: 'fallback', reason: 'error' });
    expect(await make(null).judge(req())).toMatchObject({ score: null, source: 'fallback', reason: 'no-gateway' });
  });

  it('switched off: no call, nothing cached', async () => {
    const gw = gateway(4);
    const j = make(gw, { enabled: () => false });
    expect(await j.judge(req())).toMatchObject({ score: null, source: 'disabled' });
    expect(j.peek({ userId: 'u', sittingId: 's1' })).toBeNull();
    expect(gw.evaluate).not.toHaveBeenCalled();
  });

  it('anything that is not a good-faith state is refused without a call', async () => {
    const gw = gateway(4);
    const j = make(gw);
    expect(await j.judge(req({ state: { image: 'x' } }))).toMatchObject({ score: null, source: 'invalid' });
    expect(gw.evaluate).not.toHaveBeenCalled();
  });

  it('logs the judgement with its score and timing', async () => {
    const log = logger();
    await make(gateway(5), { logger: log }).judge(req());
    expect(log.info).toHaveBeenCalledWith('piano.lesson-good-faith.judged', expect.objectContaining({ userId: 'u', score: 10, source: 'model', notes: 20, preschool: false }));
  });
});
