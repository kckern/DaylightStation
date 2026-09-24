import { describe, expect, it, vi } from 'vitest';
import { SubtitleCueReview, carryForwardDecisions } from './SubtitleCueReview.mjs';

const lines = [
  { start: 1, end: 2, text: 'the sermon is about' },
  { start: 3, end: 5, text: 'hell and how to avoid it' },
  { start: 6, end: 7, text: 'amen' },
];
const hit = (over = {}) => ({
  cueId: 'srt3000', lineIndex: 1, token: 'hell', leaf: 'hell', group: 'profanity',
  category: 'language/profanity/hell', severity: 'low', in: 3, out: 3.05, ...over,
});
const groups = ['profanity', 'blasphemy', 'racial'];
const answers = ({ choice = 'profanity', confidence = 0.9, score = 0, sevConfidence = 0.8 } = {}) => ({
  model: 'jev-test-1',
  answers: {
    use: { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } },
    severity: { type: 'score', score, confidence: sevConfidence, probabilities: [1, 0, 0] },
  },
  usage: { inputTokens: 10, outputTokens: null },
});
const quietLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
const gateway = (impl) => ({ isConfigured: () => true, evaluate: vi.fn(impl) });

describe('SubtitleCueReview', () => {
  it('asks one choice over the word-list groups + none and one severity score, about the line in context', async () => {
    const g = gateway(async () => answers());
    const review = new SubtitleCueReview({ decisionGateway: g, logger: quietLogger() });
    await review.review({ title: 'Sermon', lines, hits: [hit()], groups });
    const [state, questions, options] = g.evaluate.mock.calls[0];
    expect(state).toEqual({ title: 'Sermon', word: 'hell', line: 'hell and how to avoid it', before: 'the sermon is about', after: 'amen' });
    expect(questions.use.type).toBe('choice');
    expect(Object.keys(questions.use.options)).toEqual(['profanity', 'blasphemy', 'racial', 'none']);
    expect(questions.severity.type).toBe('score');
    expect(questions.severity.levels).toHaveLength(3);
    expect(options).toEqual({ timeout: 5000 });
  });

  it('agrees when Jev matches the word list, keeping the word-list cue unchanged', async () => {
    const review = new SubtitleCueReview({ decisionGateway: gateway(async () => answers()), logger: quietLogger() });
    const { items, summary, model } = await review.review({ lines, hits: [hit()], groups });
    expect(model).toBe('jev-test-1');
    expect(items[0]).toMatchObject({
      cueId: 'srt3000', at: 3, word: 'hell', category: 'language/profanity/hell', severity: 'low',
      status: 'agree', reasons: [], decision: null,
      jev: { category: 'profanity', categoryConfidence: 0.9, severity: 'low', severityScore: 0, severityConfidence: 0.8 },
    });
    expect(summary).toMatchObject({ cues: 1, agree: 1, review: 0 });
  });

  it('flags an innocent use for a grown-up and never drops the cue', async () => {
    const review = new SubtitleCueReview({ decisionGateway: gateway(async () => answers({ choice: 'none' })), logger: quietLogger() });
    const hits = [hit()];
    const before = structuredClone(hits);
    const { items, summary } = await review.review({ lines, hits, groups });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ category: 'language/profanity/hell', status: 'review', reasons: ['not-offensive'] });
    expect(summary.notOffensive).toBe(1);
    expect(hits).toEqual(before);
  });

  it('flags category, severity and confidence disagreements', async () => {
    const review = new SubtitleCueReview({
      decisionGateway: gateway(async () => answers({ choice: 'blasphemy', confidence: 0.5, score: 1.8 })),
      logger: quietLogger(),
    });
    const { items } = await review.review({ lines, hits: [hit()], groups });
    expect(items[0].jev.severity).toBe('high');
    expect(items[0].reasons).toEqual(['category-differs', 'severity-differs', 'low-confidence']);
  });

  it('honours minConfidence', async () => {
    const review = new SubtitleCueReview({ decisionGateway: gateway(async () => answers({ confidence: 0.6 })), minConfidence: 0.5, logger: quietLogger() });
    const { items } = await review.review({ lines, hits: [hit()], groups });
    expect(items[0].status).toBe('agree');
  });

  it('a failed evaluation marks that item and the rest still run', async () => {
    const logger = quietLogger();
    let n = 0;
    const g = gateway(async () => { n += 1; if (n === 1) throw new Error('timeout'); return answers(); });
    const review = new SubtitleCueReview({ decisionGateway: g, concurrency: 1, logger });
    const { items, summary } = await review.review({ lines, hits: [hit(), hit({ cueId: 'srt3330', in: 3.33 })], groups });
    expect(items.map((i) => i.reasons)).toEqual([['model-failed'], []]);
    expect(items[0].jev).toBeNull();
    expect(summary).toMatchObject({ failed: 1, agree: 1 });
    expect(logger.warn).toHaveBeenCalledWith('content-filter.cue-review.failed', expect.objectContaining({ cueId: 'srt3000', error: 'timeout' }));
  });

  it('with no configured gateway, lists every word-list cue for review without calling anything', async () => {
    for (const decisionGateway of [null, { isConfigured: () => false, evaluate: vi.fn() }]) {
      const review = new SubtitleCueReview({ decisionGateway, logger: quietLogger() });
      const { items, model } = await review.review({ lines, hits: [hit()], groups });
      expect(model).toBeNull();
      expect(items[0]).toMatchObject({ status: 'review', reasons: ['model-unavailable'], jev: null, category: 'language/profanity/hell' });
      if (decisionGateway) expect(decisionGateway.evaluate).not.toHaveBeenCalled();
    }
  });

  it('never runs more than `concurrency` evaluations at once and keeps hit order', async () => {
    let inFlight = 0; let peak = 0;
    const g = gateway(async () => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return answers();
    });
    const hits = Array.from({ length: 9 }, (_, i) => hit({ cueId: `srt${i}` }));
    const review = new SubtitleCueReview({ decisionGateway: g, concurrency: 3, logger: quietLogger() });
    const { items } = await review.review({ lines, hits, groups });
    expect(peak).toBe(3);
    expect(items.map((i) => i.cueId)).toEqual(hits.map((h) => h.cueId));
  });

  it('logs a summary event', async () => {
    const logger = quietLogger();
    const review = new SubtitleCueReview({ decisionGateway: gateway(async () => answers()), logger });
    await review.review({ contentId: 'plex:1', lines, hits: [hit()], groups });
    expect(logger.info).toHaveBeenCalledWith('content-filter.cue-review.summary',
      expect.objectContaining({ contentId: 'plex:1', model: 'jev-test-1', cues: 1, agree: 1 }));
  });
});

describe('carryForwardDecisions', () => {
  const item = (cueId, word, decision = null) => ({ cueId, word, decision, status: 'review', reasons: [] });

  it("keeps a grown-up's decision when the same cue names the same word", () => {
    const previous = [item('srt1_0', 'hell', 'disable'), item('srt2_0', 'god', 'keep')];
    const fresh = [item('srt1_0', 'hell'), item('srt2_0', 'god'), item('srt3_0', 'damn')];
    expect(carryForwardDecisions(fresh, previous).map((i) => i.decision)).toEqual(['disable', 'keep', null]);
  });
  it('drops a decision whose cue now names a different word, and ignores empty decisions', () => {
    const previous = [item('srt1_0', 'hell', 'disable'), item('srt2_0', 'god', null)];
    const fresh = [item('srt1_0', 'damn'), item('srt2_0', 'god')];
    expect(carryForwardDecisions(fresh, previous).map((i) => i.decision)).toEqual([null, null]);
  });
  it('tolerates a missing or malformed previous file', () => {
    const fresh = [item('srt1_0', 'hell')];
    expect(carryForwardDecisions(fresh, null)).toEqual(fresh);
    expect(carryForwardDecisions(fresh, 'junk')).toEqual(fresh);
  });
});
