import { describe, expect, it, vi } from 'vitest';
import { CardLadderTypedJudge } from './CardLadderTypedJudge.mjs';

function makeCache() {
  const map = new Map();
  return {
    get(pkg, wordId, normalized) { return map.get(`${pkg}|${wordId}|${normalized}`) ?? null; },
    set(pkg, wordId, normalized, verdict) { map.set(`${pkg}|${wordId}|${normalized}`, { ...verdict }); },
  };
}

const entry = (term, gloss = 'Hello', kind = 'phrase') => ({ id: 'w', term, gloss, kind });
const make = (reply) => {
  const aiGateway = { chatWithJson: vi.fn(reply) };
  return { aiGateway, judge: new CardLadderTypedJudge({ aiGateway, cache: makeCache(), model: 'small', logger: { info() {}, warn() {} } }) };
};

describe('CardLadderTypedJudge', () => {
  it('exact, no-Hangul and short words never call the model', async () => {
    const { aiGateway, judge } = make(async () => ({ score: 10 }));
    expect(await judge.judge({ pkg: 'p', entry: entry('가위'), typed: '가위', otherWords: [] })).toMatchObject({ judge: 'exact', pass: true });
    expect(await judge.judge({ pkg: 'p', entry: entry('가위'), typed: 'hi', otherWords: [] })).toMatchObject({ score: 1, pass: false });
    expect(await judge.judge({ pkg: 'p', entry: entry('가위'), typed: '가이', otherWords: [] })).toMatchObject({ judge: 'distance', score: 6, pass: true });
    expect(aiGateway.chatWithJson).not.toHaveBeenCalled();
  });
  it('model raises at most one band from an eligible floor, attempt passed as data', async () => {
    const { aiGateway, judge } = make(async () => ({ score: 9, reason: 'clearly the phrase' }));
    const r = await judge.judge({ pkg: 'p', entry: entry('안녕히계세요'), typed: '안녕히개새요', otherWords: [] });
    expect(r.judge).toBe('model');
    expect(r.score).toBeLessThanOrEqual(8);
    const [messages] = aiGateway.chatWithJson.mock.calls[0];
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
    expect(aiGateway.chatWithJson).toHaveBeenCalledTimes(2);
  });
  it('a malformed reply (out-of-range score) falls back and is not cached', async () => {
    const { aiGateway, judge } = make(async () => ({ score: 42 }));
    expect(await judge.judge({ pkg: 'p', entry: entry('안녕히계세요'), typed: '안녕히개새요', otherWords: [] })).toMatchObject({ judge: 'fallback' });
    await judge.judge({ pkg: 'p', entry: entry('안녕히계세요'), typed: '안녕히개새요', otherWords: [] });
    expect(aiGateway.chatWithJson).toHaveBeenCalledTimes(2);
  });
  it('caches by package, word and normalised answer', async () => {
    const { aiGateway, judge } = make(async () => ({ score: 8, reason: 'ok' }));
    await judge.judge({ pkg: 'p', entry: entry('안녕히계세요'), typed: '안녕히개새요', otherWords: [] });
    const again = await judge.judge({ pkg: 'p', entry: entry('안녕히계세요'), typed: '안녕히개새요 ', otherWords: [] });
    expect(again.judge).toBe('cache');
    expect(aiGateway.chatWithJson).toHaveBeenCalledTimes(1);
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
    expect(aiGateway.chatWithJson.mock.calls[0][0][0].content).toContain("typed English answer");
  });
  it('a Hangul target keeps the no-Hangul floor when targetScript says so', async () => {
    const { judge } = make(async () => ({ score: 10 }));
    expect(await judge.judge({ pkg: 'p', entry: entry('가위'), typed: 'gawi', otherWords: [], targetScript: 'hangul' }))
      .toMatchObject({ score: 1, judge: 'wrong-script', pass: false });
  });
});

