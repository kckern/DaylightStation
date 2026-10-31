import { describe, expect, it, vi } from 'vitest';
import { CardLadderTypedJudge } from "./CardLadderTypedJudge.mjs";

function makeCache() {
  const map = new Map();
  return {
    get(pkg, wordId, normalized) { return map.get(`${pkg}|${wordId}|${normalized}`) ?? null; },
    set(pkg, wordId, normalized, verdict) { map.set(`${pkg}|${wordId}|${normalized}`, { ...verdict }); },
  };
}

const entry = (term, gloss = 'Hello', kind = 'phrase') => ({ id: 'w', term, gloss, kind });
const make = (reply) => {
  const aiGateway = { chatStructured: vi.fn(reply) };
  return { aiGateway, judge: new CardLadderTypedJudge({ aiGateway, cache: makeCache(), model: 'small', logger: { info() {}, warn() {} } }) };
};

describe('CardLadderTypedJudge', () => {
  it('exact, no-Hangul and short words never call the model', async () => {
    const { aiGateway, judge } = make(async () => ({ score: 10 }));
    expect(await judge.judge({ pkg: 'p', entry: entry('가위'), typed: '가위', otherWords: [] })).toMatchObject({ judge: 'exact', pass: true });
    expect(await judge.judge({ pkg: 'p', entry: entry('가위'), typed: 'hi', otherWords: [] })).toMatchObject({ score: 1, pass: false });
    expect(await judge.judge({ pkg: 'p', entry: entry('가위'), typed: '가이', otherWords: [] })).toMatchObject({ judge: 'distance', score: 6, pass: true });
    expect(aiGateway.chatStructured).not.toHaveBeenCalled();
  });
  it('model raises at most one band from an eligible floor, attempt passed as data', async () => {
    const { aiGateway, judge } = make(async () => ({ score: 9, reason: 'clearly the phrase' }));
    const r = await judge.judge({ pkg: 'p', entry: entry('안녕히계세요'), typed: '안녕히개새요', otherWords: [] });
    expect(r.judge).toBe('model');
    expect(r.score).toBeLessThanOrEqual(8);
    const [messages] = aiGateway.chatStructured.mock.calls[0];
    expect(messages[0].content).not.toContain('안녕히개새요');
    expect(JSON.parse(messages[1].content).attempt).toBe('안녕히개새요');
  });
  it('model failure falls back to the deterministic score', async () => {
    const { judge } = make(async () => { throw new Error('timeout'); });
    expect(await judge.judge({ pkg: 'p', entry: entry('안녕히계세요'), typed: '안녕히개새요', otherWords: [] })).toMatchObject({ judge: 'fallback' });
  });
  it('a malformed reply (missing score) falls back and is not cached', async () => {
    const { aiGateway, judge } = make(async () => ({}));
    expect(await judge.judge({ pkg: 'p', entry: entry('안녕히계세요'), typed: '안녕히개새요', otherWords: [] })).toMatchObject({ judge: 'fallback' });
    await judge.judge({ pkg: 'p', entry: entry('안녕히계세요'), typed: '안녕히개새요', otherWords: [] });
    expect(aiGateway.chatStructured).toHaveBeenCalledTimes(2);
  });
  it('a malformed reply (out-of-range score) falls back and is not cached', async () => {
    const { aiGateway, judge } = make(async () => ({ score: 42 }));
    expect(await judge.judge({ pkg: 'p', entry: entry('안녕히계세요'), typed: '안녕히개새요', otherWords: [] })).toMatchObject({ judge: 'fallback' });
    await judge.judge({ pkg: 'p', entry: entry('안녕히계세요'), typed: '안녕히개새요', otherWords: [] });
    expect(aiGateway.chatStructured).toHaveBeenCalledTimes(2);
  });
  it('caches by package, word and normalised answer', async () => {
    const { aiGateway, judge } = make(async () => ({ score: 8, reason: 'ok' }));
    await judge.judge({ pkg: 'p', entry: entry('안녕히계세요'), typed: '안녕히개새요', otherWords: [] });
    const again = await judge.judge({ pkg: 'p', entry: entry('안녕히계세요'), typed: '안녕히개새요 ', otherWords: [] });
    expect(again.judge).toBe('cache');
    expect(aiGateway.chatStructured).toHaveBeenCalledTimes(1);
  });
  it('a grown-up\'s re-grade in the cache wins over every band, even without a model', async () => {
    const cache = makeCache();
    const judge = new CardLadderTypedJudge({ cache, passScore: 6, logger: { info() {}, warn() {} } });
    cache.set('p', 'w', '가이', { score: 1, judge: 'grown-up', reason: 'Re-graded by a grown-up' });
    expect(await judge.judge({ pkg: 'p', entry: entry('가위'), typed: '가이', otherWords: [] }))
      .toEqual({ score: 1, judge: 'grown-up', reason: 'Re-graded by a grown-up', pass: false });
    cache.set('p', 'w', 'hi', { score: 6, judge: 'grown-up', reason: 'Re-graded by a grown-up' });
    expect(await judge.judge({ pkg: 'p', entry: entry('가위'), typed: 'hi', otherWords: [] })).toMatchObject({ judge: 'grown-up', pass: true });
  });
});

describe('CardLadderTypedJudge — the target script seam', () => {
  it('a generic target has no script floor, and the model is told the target language', async () => {
    const { aiGateway, judge } = make(async () => ({ score: 8, reason: 'same word' }));
    const generic = { pkg: 'p', entry: entry('photosynthesis', 'how plants make food', 'word'), otherWords: [], targetScript: 'generic', targetLanguage: 'English' };
    expect(await judge.judge({ ...generic, typed: 'photosynthesis' })).toMatchObject({ judge: 'exact', pass: true });
    const near = await judge.judge({ ...generic, typed: 'photosynthesys' });
    expect(near.judge).toBe('model');
    expect(aiGateway.chatStructured.mock.calls[0][0][0].content).toContain("typed English answer");
  });
  it('a Hangul target keeps the no-Hangul floor when targetScript says so', async () => {
    const { judge } = make(async () => ({ score: 10 }));
    expect(await judge.judge({ pkg: 'p', entry: entry('가위'), typed: 'gawi', otherWords: [], targetScript: 'hangul' }))
      .toMatchObject({ score: 1, judge: 'wrong-script', pass: false });
  });
});


describe('CardLadderTypedJudge — per-script grading', () => {
  const ephemeral = { pkg: 'defs', entry: { id: 'ephemeral', term: 'ephemeral', gloss: 'lasting a very short time', kind: 'word' }, targetScript: 'latin', targetLanguage: 'English' };
  it('an English definitions deck: case, a typo, a different real word, Hangul typed', async () => {
    const { aiGateway, judge } = make(async () => ({ score: 9, reason: 'clearly the word' }));
    expect(await judge.judge({ ...ephemeral, typed: 'Ephemeral', otherWords: [] })).toMatchObject({ score: 10, judge: 'exact', pass: true });
    expect(await judge.judge({ ...ephemeral, typed: 'eternal', otherWords: ['Eternal'] })).toMatchObject({ score: 2, judge: 'guard', pass: false });
    expect(await judge.judge({ ...ephemeral, typed: '에페메랄', otherWords: [] })).toMatchObject({ score: 1, judge: 'wrong-script', pass: false });
    const typo = await judge.judge({ ...ephemeral, typed: 'Ephemeril', otherWords: [] });
    expect(typo).toMatchObject({ pass: true });
    expect(typo.score).toBeGreaterThanOrEqual(8);
    const [messages] = aiGateway.chatStructured.mock.calls[0];
    expect(messages[0].content).not.toMatch(/Korean|Hangul|jamo/);
    expect(messages[0].content).toContain('English');
    expect(messages[0].content).toContain('latin');
    expect(JSON.parse(messages[1].content)).toMatchObject({ attempt: 'ephemeril', script: 'latin', language: 'English' });
  });
  it('a Spanish accent slip passes at 8 without the model; a wrong year never passes', async () => {
    const { aiGateway, judge } = make(async () => ({ score: 10 }));
    const cafe = { pkg: 'es', entry: { id: 'cafe', term: 'café', gloss: 'coffee', kind: 'word' }, targetScript: 'latin', targetLanguage: 'Spanish', otherWords: [] };
    expect(await judge.judge({ ...cafe, typed: 'cafe' })).toMatchObject({ score: 8, judge: 'accent', pass: true });
    const decl = { pkg: 'hist', entry: { id: 'decl', term: 'Declaration of Independence (1776)', gloss: 'a founding document', kind: 'phrase' }, targetScript: 'latin', targetLanguage: 'English', otherWords: [] };
    expect(await judge.judge({ ...decl, typed: 'Declaration of Independence (1767)' })).toMatchObject({ score: 2, judge: 'number', pass: false });
    expect(aiGateway.chatStructured).not.toHaveBeenCalled();
  });
});

describe('CardLadderTypedJudge — cache and re-grade keys use the script normalize', () => {
  it('a grown-up re-grade of "Ephmeral" also covers "ephmeral" and "EPHMERAL"', async () => {
    const { ruleFor } = await import("../domain/cardLadder/index.mjs");
    const cache = makeCache();
    const judge = new CardLadderTypedJudge({ cache, passScore: 6, logger: { info() {}, warn() {} } });
    cache.set('defs', 'ephemeral', ruleFor('latin').normalize('Ephmeral'), { score: 6, judge: 'grown-up', reason: 'Re-graded by a grown-up' });
    const ask = (typed) => judge.judge({ pkg: 'defs', entry: { id: 'ephemeral', term: 'ephemeral', gloss: 'lasting a very short time', kind: 'word' }, typed, otherWords: [], targetScript: 'latin', targetLanguage: 'English' });
    expect(await ask('ephmeral')).toMatchObject({ judge: 'grown-up', pass: true });
    expect(await ask('Ephmeral')).toMatchObject({ judge: 'grown-up', pass: true });
    expect(await ask('EPHMERAL')).toMatchObject({ judge: 'grown-up', pass: true });
  });
  it('the model cache is keyed case-insensitively for Latin', async () => {
    const { aiGateway, judge } = make(async () => ({ score: 8, reason: 'ok' }));
    const ask = (typed) => judge.judge({ pkg: 'p', entry: entry('photosynthesis', 'how plants make food', 'word'), typed, otherWords: [], targetScript: 'latin', targetLanguage: 'English' });
    await ask('Photosynthesys');
    expect(await ask('photosynthesys')).toMatchObject({ judge: 'cache' });
    expect(aiGateway.chatStructured).toHaveBeenCalledTimes(1);
  });
  describe('decision model (Jev) at the model step', () => {
    const LONG = entry('안녕히계세요');
    const TYPED = '안녕히개새요';
    const jevJudge = ({ llm = async () => ({ score: 9 }), jev, withLlm = true }) => {
      const logger = { info: vi.fn(), warn: vi.fn() };
      const aiGateway = { chatStructured: vi.fn(llm) };
      const decisionGateway = { isConfigured: () => true, evaluate: vi.fn(jev) };
      const cache = makeCache();
      return { logger, aiGateway, decisionGateway, cache,
        judge: new CardLadderTypedJudge({ aiGateway: withLlm ? aiGateway : null, decisionGateway, cache, model: withLlm ? 'small' : null, logger }) };
    };
    const jevScore = (score, confidence = 0.8) => async () => ({ model: 'jev-1.14.0',
      answers: { match: { type: 'score', score, confidence, probabilities: [] } } });
    const floorOf = async () => (await new CardLadderTypedJudge({ cache: makeCache(), logger: { info() {}, warn() {} } })
      .judge({ pkg: 'p', entry: LONG, typed: TYPED, otherWords: [] })).score;

    it('is preferred over the chat model when both are configured, and caches its verdict', async () => {
      const { judge, aiGateway, decisionGateway, cache, logger } = jevJudge({ jev: jevScore(4) });
      const verdict = await judge.judge({ pkg: 'p', entry: LONG, typed: TYPED, otherWords: [] });
      expect(verdict.judge).toBe('model');
      expect(aiGateway.chatStructured).not.toHaveBeenCalled();
      const [state, questions] = decisionGateway.evaluate.mock.calls[0];
      expect(state).toMatchObject({ target: '안녕히계세요', attempt: TYPED });
      expect(questions.match.type).toBe('score');
      expect(questions.match.levels).toHaveLength(5);
      expect(cache.get('p', 'w', TYPED)).toMatchObject({ judge: 'model', engine: 'jev', model: 'jev-1.14.0', reason: null });
      const row = logger.info.mock.calls.find(([event]) => event === 'school.card-ladder.judge-model')[1];
      expect(row).toMatchObject({ engine: 'jev', model: 'jev-1.14.0', raw: 10, level: 4, confidence: 0.8, score: verdict.score });
    });

    it('clamps like the chat model: at most one band up, never below the floor', async () => {
      const floor = await floorOf();
      const high = await jevJudge({ jev: jevScore(4) }).judge.judge({ pkg: 'p', entry: LONG, typed: TYPED, otherWords: [] });
      expect(high.score).toBe(Math.min(10, floor + 2));
      const low = jevJudge({ jev: jevScore(0.2) });
      expect(await low.judge.judge({ pkg: 'p', entry: LONG, typed: TYPED, otherWords: [] })).toMatchObject({ judge: 'model', score: floor });
      expect(low.logger.info.mock.calls.find(([event]) => event === 'school.card-ladder.judge-model')[1]).toMatchObject({ raw: 2, floor });
    });

    it('falls back to the floor when the decision model fails, without trying the chat model', async () => {
      const { judge, aiGateway, logger } = jevJudge({ jev: async () => { throw new Error('429'); } });
      expect(await judge.judge({ pkg: 'p', entry: LONG, typed: TYPED, otherWords: [] })).toMatchObject({ judge: 'fallback', score: await floorOf() });
      expect(aiGateway.chatStructured).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('school.card-ladder.judge-fallback', expect.objectContaining({ engine: 'jev', error: '429' }));
      const malformed = jevJudge({ jev: async () => ({ model: 'jev', answers: {} }) });
      expect(await malformed.judge.judge({ pkg: 'p', entry: LONG, typed: TYPED, otherWords: [] })).toMatchObject({ judge: 'fallback' });
    });

    it('runs with no chat model configured at all', async () => {
      const { judge } = jevJudge({ jev: jevScore(4), withLlm: false });
      expect(await judge.judge({ pkg: 'p', entry: LONG, typed: TYPED, otherWords: [] })).toMatchObject({ judge: 'model' });
    });

    it('an unconfigured decision gateway leaves the chat model in charge', async () => {
      const aiGateway = { chatStructured: vi.fn(async () => ({ score: 9, reason: 'close' })) };
      const decisionGateway = { isConfigured: () => false, evaluate: vi.fn() };
      const judge = new CardLadderTypedJudge({ aiGateway, decisionGateway, cache: makeCache(), model: 'small', logger: { info() {}, warn() {} } });
      expect(await judge.judge({ pkg: 'p', entry: LONG, typed: TYPED, otherWords: [] })).toMatchObject({ judge: 'model', reason: 'close' });
      expect(decisionGateway.evaluate).not.toHaveBeenCalled();
    });

    it('is never asked about short, exact or cached answers', async () => {
      const { judge, decisionGateway } = jevJudge({ jev: jevScore(4) });
      await judge.judge({ pkg: 'p', entry: entry('가위'), typed: '가이', otherWords: [] });
      await judge.judge({ pkg: 'p', entry: LONG, typed: '안녕히계세요', otherWords: [] });
      expect(decisionGateway.evaluate).not.toHaveBeenCalled();
      await judge.judge({ pkg: 'p', entry: LONG, typed: TYPED, otherWords: [] });
      expect(await judge.judge({ pkg: 'p', entry: LONG, typed: TYPED, otherWords: [] })).toMatchObject({ judge: 'cache' });
      expect(decisionGateway.evaluate).toHaveBeenCalledTimes(1);
    });
  });
});
