import { describe, it, expect, vi } from 'vitest';
import { HeadlineStoryJudge, EVENT_KINDS, LEGACY_MATCH } from './HeadlineStoryJudge.mjs';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
const gateway = ({ same = 0.9, kind = 'live', confidence = 0.8, fail = false } = {}) => ({
  isConfigured: () => true,
  evaluate: vi.fn(async (state, questions) => {
    if (fail) throw new Error('jev down');
    if (questions.sameEvent) return { model: 'jev-test', answers: { sameEvent: { type: 'yesNo', probability: same } }, usage: {} };
    return { model: 'jev-test', answers: { kind: { type: 'choice', choice: kind, confidence, probabilities: { [kind]: confidence } } }, usage: {} };
  }),
});
const pair = (over = {}) => ({
  similarity: 0.67,
  normA: 'white house restores access cnn ms now politico',
  normB: 'cnn ms now politico reporters regain entry white house',
  a: { title: 'White House Restores Access for CNN, MS NOW and Politico', source: 'One', publishedAt: '2026-09-24T10:00:00Z' },
  b: { title: 'CNN, MS NOW and Politico reporters regain entry to White House', source: 'Two', publishedAt: '2026-09-24T11:00:00Z' },
  ...over,
});
const title = (over = {}) => ({ title: 'Gaza live: talks resume', source: 'One', legacyKind: 'update', ...over });
const trace = (over = {}) => ({ pageId: 'daily', pairs: [pair()], titles: [title()], ...over });
const SHADOW = HeadlineStoryJudge.settings({});
const PROMOTE = HeadlineStoryJudge.settings({ mode: 'promote' });

describe('HeadlineStoryJudge.settings', () => {
  it('defaults to shadow with a 0.5 band floor below the legacy match', () => {
    expect(SHADOW).toEqual({ mode: 'shadow', bandLow: 0.5, sameThreshold: 0.6, labelConfidence: 0.6 });
    expect(LEGACY_MATCH).toBe(0.72);
    expect(HeadlineStoryJudge.settings(undefined)).toEqual(SHADOW);
  });

  it('reads snake_case config and rejects out-of-range values', () => {
    expect(HeadlineStoryJudge.settings({ mode: 'promote', band_low: 0.55, same_threshold: 0.7, label_confidence: 0.5 }))
      .toEqual({ mode: 'promote', bandLow: 0.55, sameThreshold: 0.7, labelConfidence: 0.5 });
    expect(HeadlineStoryJudge.settings({ mode: 'bogus', band_low: 0.9, same_threshold: 2 })).toEqual(SHADOW);
  });
});

describe('HeadlineStoryJudge', () => {
  it('is inactive without a configured gateway or when off', async () => {
    expect(new HeadlineStoryJudge({}).active(SHADOW)).toBe(false);
    expect(new HeadlineStoryJudge({ decisionGateway: { isConfigured: () => false, evaluate: vi.fn() } }).active(SHADOW)).toBe(false);
    const g = gateway();
    const judge = new HeadlineStoryJudge({ decisionGateway: g, logger: logger() });
    const off = { ...SHADOW, mode: 'off' };
    expect(judge.active(off)).toBe(false);
    expect(await judge.review(trace(), off)).toMatchObject({ evaluated: 0 });
    expect(g.evaluate).not.toHaveBeenCalled();
  });

  it('asks one yesNo per band pair and one choice per title, with compact state', async () => {
    const g = gateway();
    const judge = new HeadlineStoryJudge({ decisionGateway: g, logger: logger() });
    const summary = await judge.review(trace(), SHADOW);
    expect(summary).toMatchObject({ page: 'daily', pairs: 1, titles: 1, evaluated: 2, cached: 0, failed: 0, skipped: 0 });
    const [pairState, pairQuestions, pairOptions] = g.evaluate.mock.calls[0];
    expect(pairState).toEqual({ a: pair().a, b: pair().b });
    expect(pairQuestions.sameEvent.type).toBe('yesNo');
    expect(pairOptions).toEqual({ timeout: 3000 });
    const [labelState, labelQuestions] = g.evaluate.mock.calls[1];
    expect(labelState).toEqual({ title: 'Gaza live: talks resume', source: 'One' });
    expect(labelQuestions.kind.type).toBe('choice');
    expect(Object.keys(labelQuestions.kind.options)).toEqual(EVENT_KINDS);
  });

  it('caches by title pair in either order and by title', async () => {
    const g = gateway();
    const judge = new HeadlineStoryJudge({ decisionGateway: g, logger: logger() });
    await judge.review(trace(), SHADOW);
    const swapped = pair({ normA: pair().normB, normB: pair().normA, a: pair().b, b: pair().a });
    expect(await judge.review(trace({ pairs: [swapped] }), SHADOW)).toMatchObject({ evaluated: 0, cached: 2 });
    expect(g.evaluate).toHaveBeenCalledTimes(2);
  });

  it('logs shadow agreement for pairs and labels', async () => {
    const log = logger();
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway({ same: 0.9, kind: 'live' }), logger: log });
    await judge.review(trace(), SHADOW);
    expect(log.info).toHaveBeenCalledWith('feed.headlines.jev-pair', expect.objectContaining({
      page: 'daily', similarity: 0.67, jevProbability: 0.9, jevSame: true, legacySame: false, agreed: false, model: 'jev-test',
    }));
    expect(log.info).toHaveBeenCalledWith('feed.headlines.jev-label', expect.objectContaining({
      page: 'daily', legacyKind: 'update', jevKind: 'live', jevConfidence: 0.8, agreed: true, model: 'jev-test',
    }));
  });

  it('stops asking at the per-review call budget', async () => {
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway(), logger: logger(), maxCallsPerReview: 1 });
    expect(await judge.review(trace(), SHADOW)).toMatchObject({ evaluated: 1, skipped: 1 });
  });

  it('never throws when the model fails, and caches nothing', async () => {
    const log = logger();
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway({ fail: true }), logger: log });
    expect(await judge.review(trace(), SHADOW)).toMatchObject({ evaluated: 0, failed: 2 });
    expect(log.warn).toHaveBeenCalledWith('feed.headlines.jev-pair-failed', expect.objectContaining({ error: 'jev down' }));
    expect(log.warn).toHaveBeenCalledWith('feed.headlines.jev-label-failed', expect.objectContaining({ error: 'jev down' }));
    expect(judge.cachedPair(pair().normA, pair().normB)).toBeNull();
    expect(judge.cachedLabel('Gaza live: talks resume')).toBeNull();
  });

  it('treats an answer outside the option set as a failure', async () => {
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway({ kind: 'rumour' }), logger: logger() });
    expect(await judge.review(trace({ pairs: [] }), SHADOW)).toMatchObject({ evaluated: 0, failed: 1 });
  });

  it('only answers sameEvent / eventKind in promote mode, above thresholds', async () => {
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway({ same: 0.9, kind: 'analysis', confidence: 0.7 }), logger: logger() });
    await judge.review(trace(), SHADOW);
    const { normA, normB } = pair();
    expect(judge.sameEvent(normA, normB, SHADOW)).toBe(false);
    expect(judge.sameEvent(normB, normA, PROMOTE)).toBe(true);
    expect(judge.sameEvent(normA, normB, { ...PROMOTE, sameThreshold: 0.95 })).toBe(false);
    expect(judge.sameEvent('never seen one', 'never seen two', PROMOTE)).toBe(false);
    expect(judge.eventKind('Gaza live: talks resume', SHADOW)).toBeNull();
    expect(judge.eventKind('  gaza LIVE:  talks resume ', PROMOTE)).toBe('analysis');
    expect(judge.eventKind('Gaza live: talks resume', { ...PROMOTE, labelConfidence: 0.9 })).toBeNull();
  });

  it('evicts the oldest verdict past the cache bound', async () => {
    const judge = new HeadlineStoryJudge({ decisionGateway: gateway(), logger: logger(), cacheMax: 1 });
    await judge.review(trace({ titles: [title({ title: 'First headline' }), title({ title: 'Second headline' })], pairs: [] }), SHADOW);
    expect(judge.cachedLabel('First headline')).toBeNull();
    expect(judge.cachedLabel('Second headline')).toMatchObject({ choice: 'live' });
  });

  it('shares one call budget across the reviews of a pass', async () => {
    const g = gateway();
    const judge = new HeadlineStoryJudge({ decisionGateway: g, logger: logger() });
    const pass = judge.beginPass(2);
    expect(await judge.review(trace({ titles: [] }), SHADOW, pass)).toMatchObject({ evaluated: 1, skipped: 0 });
    expect(await judge.review(trace({ pairs: [], titles: [title({ title: 'First headline' }), title({ title: 'Second headline' })] }), SHADOW, pass))
      .toMatchObject({ evaluated: 1, skipped: 1 });
    expect(g.evaluate).toHaveBeenCalledTimes(2);
  });

  it('opens the breaker after 3 consecutive failures and skips the rest of the pass', async () => {
    const log = logger();
    const g = gateway({ fail: true });
    const judge = new HeadlineStoryJudge({ decisionGateway: g, logger: log });
    const titles = ['One', 'Two', 'Three', 'Four', 'Five'].map(t => title({ title: `${t} headline` }));
    const pass = judge.beginPass();
    expect(await judge.review(trace({ pairs: [], titles }), SHADOW, pass)).toMatchObject({ evaluated: 0, failed: 3, skipped: 2 });
    expect(await judge.review(trace({ pairs: [], titles: [title({ title: 'Six headline' })] }), SHADOW, pass)).toMatchObject({ failed: 0, skipped: 1 });
    expect(g.evaluate).toHaveBeenCalledTimes(3);
    const breakerLogs = log.warn.mock.calls.filter(([event]) => event === 'feed.headlines.jev-breaker-open');
    expect(breakerLogs).toHaveLength(1);
  });

  it('a success resets the consecutive-failure count', async () => {
    let n = 0;
    const g = { isConfigured: () => true, evaluate: vi.fn(async () => {
      n++;
      if (n === 3) return { model: 'jev-test', answers: { kind: { type: 'choice', choice: 'report', confidence: 0.9 } } };
      throw new Error('jev down');
    }) };
    const judge = new HeadlineStoryJudge({ decisionGateway: g, logger: logger() });
    const titles = ['One', 'Two', 'Three', 'Four', 'Five'].map(t => title({ title: `${t} headline` }));
    expect(await judge.review(trace({ pairs: [], titles }), SHADOW)).toMatchObject({ evaluated: 1, failed: 4, skipped: 0 });
  });

  it('does not re-ask a pair that already failed in the same pass', async () => {
    const g = gateway({ fail: true });
    const judge = new HeadlineStoryJudge({ decisionGateway: g, logger: logger() });
    const pass = judge.beginPass();
    expect(await judge.review(trace({ titles: [] }), SHADOW, pass)).toMatchObject({ failed: 1 });
    expect(await judge.review(trace({ titles: [] }), SHADOW, pass)).toMatchObject({ evaluated: 0, failed: 0 });
    expect(g.evaluate).toHaveBeenCalledTimes(1);
  });
});
