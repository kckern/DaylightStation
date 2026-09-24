// backend/src/3_applications/school/SentenceMeaningJudge.test.mjs
import { describe, expect, it, vi } from 'vitest';
import { SentenceMeaningJudge, MEANING_LEVELS } from './SentenceMeaningJudge.mjs';

const answerWith = (score, confidence = 0.8) => async () => ({
  model: 'jev-1.13.0',
  answers: { meaning: { type: 'score', score, confidence, probabilities: [] } },
  usage: { inputTokens: null, outputTokens: null },
});
// Stand-in for IApplicationScheduler.withDeadline (NodeApplicationScheduler in production).
const scheduler = {
  withDeadline(work, { milliseconds, errorFactory }) {
    let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(errorFactory()), milliseconds); });
    return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
  },
};
const make = (evaluate, opts = {}) => {
  const logger = { warn: vi.fn(), info: vi.fn() };
  const decisionGateway = { isConfigured: () => true, evaluate: vi.fn(evaluate) };
  return { logger, decisionGateway, judge: new SentenceMeaningJudge({ decisionGateway, logger, scheduler, ...opts }) };
};
const ARGS = { given: 'today the weather is nice', expected: "The weather's nice today.", language: 'EN', accuracy: 0.4 };

describe('SentenceMeaningJudge', () => {
  it('has five ordered levels, lowest first', () => {
    expect(MEANING_LEVELS).toHaveLength(5);
    expect(MEANING_LEVELS[0]).toMatch(/^Different meaning/);
    expect(MEANING_LEVELS[4]).toMatch(/same words/i);
  });

  it('asks one Score question with the answer as data, and normalises the level to 0..1', async () => {
    const { judge, decisionGateway } = make(answerWith(3.2, 0.81));
    const result = await judge.judge(ARGS);
    const [state, questions, options] = decisionGateway.evaluate.mock.calls[0];
    expect(state).toEqual({ reference: "The weather's nice today.", answer: 'today the weather is nice', language: 'EN' });
    expect(Object.keys(questions)).toEqual(['meaning']);
    expect(questions.meaning.type).toBe('score');
    expect(questions.meaning.levels).toEqual([...MEANING_LEVELS]);
    expect(questions.meaning.instructions).not.toContain('today the weather is nice');
    expect(options).toEqual({ timeout: 1500 });
    expect(result).toMatchObject({ score: 0.8, level: 3, confidence: 0.81, judge: 'model', model: 'jev-1.13.0' });
    expect(typeof result.ms).toBe('number');
  });

  it('clamps an out-of-range level into the rubric', async () => {
    const { judge } = make(answerWith(7));
    expect(await judge.judge(ARGS)).toMatchObject({ score: 1, level: 4 });
  });

  it('an exact copy is level 4 without a call', async () => {
    const { judge, decisionGateway } = make(answerWith(0));
    expect(await judge.judge({ ...ARGS, given: "the weather's nice today", accuracy: 1 }))
      .toEqual({ score: 1, level: 4, confidence: 1, judge: 'exact' });
    expect(decisionGateway.evaluate).not.toHaveBeenCalled();
  });

  it('an answer with no letters is level 0 without a call', async () => {
    const { judge, decisionGateway } = make(answerWith(4));
    for (const given of [',,,,,', '.', '🙃🙃🙃🙃🙃🙃']) {
      expect(await judge.judge({ ...ARGS, given, accuracy: 0 }))
        .toEqual({ score: 0, level: 0, confidence: 1, judge: 'no-words' });
    }
    expect(decisionGateway.evaluate).not.toHaveBeenCalled();
  });

  it('returns null, never throws, when the gateway fails or answers malformed', async () => {
    const failing = make(async () => { throw new Error('429'); });
    expect(await failing.judge.judge(ARGS)).toBeNull();
    expect(failing.logger.warn).toHaveBeenCalledWith('school.language.meaning-failed', expect.objectContaining({ error: '429' }));
    const malformed = make(async () => ({ model: 'm', answers: {} }));
    expect(await malformed.judge.judge(ARGS)).toBeNull();
  });

  it('names the attempt in the failure log, so a failure is attributable', async () => {
    const failing = make(async () => { throw new Error('429'); });
    await failing.judge.judge({ ...ARGS, attempt: { learnerId: 'learner', corpus: 'korean', seq: 7 } });
    expect(failing.logger.warn).toHaveBeenCalledWith('school.language.meaning-failed', {
      learnerId: 'learner', corpus: 'korean', seq: 7, error: '429', ms: expect.any(Number),
    });
  });

  it('gives up at the deadline', async () => {
    const { judge, logger } = make(() => new Promise(() => {}), { timeoutMs: 20 });
    expect(await judge.judge(ARGS)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('school.language.meaning-failed', expect.objectContaining({ error: 'timed out after 20ms' }));
  });

  it('is disabled without a configured gateway, even for the code rules', async () => {
    const none = new SentenceMeaningJudge({ decisionGateway: null, logger: { warn() {} } });
    const noop = new SentenceMeaningJudge({ decisionGateway: { isConfigured: () => false, evaluate: vi.fn() }, logger: { warn() {} } });
    expect(none.enabled).toBe(false);
    expect(noop.enabled).toBe(false);
    expect(await none.judge({ ...ARGS, accuracy: 1 })).toBeNull();
    expect(await noop.judge(ARGS)).toBeNull();
  });
});
