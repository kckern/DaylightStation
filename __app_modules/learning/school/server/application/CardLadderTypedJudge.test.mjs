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
  it('an empty answer is an honest "don\'t know": a 0, never the wrong-script floor, never the model', async () => {
    const { aiGateway, judge } = make(async () => ({ score: 10 }));
    for (const typed of ['', '   ']) {
      expect(await judge.judge({ pkg: 'p', entry: entry('안녕히계세요'), typed, otherWords: [] })).toEqual({ score: 0, judge: 'dont-know', reason: null, pass: false });
    }
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
  describe('Jev grades correctness, not letters (owner, 2026-11-03)', () => {
    const LONG = entry('안녕히계세요', 'Goodbye');
    const TYPED = '안녕히개새요';
    const jevJudge = ({ llm = async () => ({ score: 9 }), jev, withLlm = true }) => {
      const logger = { info: vi.fn(), warn: vi.fn() };
      const aiGateway = { chatStructured: vi.fn(llm) };
      const decisionGateway = { isConfigured: () => true, evaluate: vi.fn(jev) };
      const cache = makeCache();
      return { logger, aiGateway, decisionGateway, cache,
        judge: new CardLadderTypedJudge({ aiGateway: withLlm ? aiGateway : null, decisionGateway, cache, model: withLlm ? 'small' : null, logger }) };
    };
    /** Jev's two answers: `correct` (level 0-4) and `match` (a MATCH_KINDS key). */
    const jevSays = (level, match, confidence = 0.8) => async () => ({ model: 'jev-1.14.0',
      answers: {
        correct: { type: 'score', score: level, confidence, probabilities: [] },
        match: { type: 'choice', choice: match, confidence: 0.7, probabilities: { [match]: 0.7 } },
      } });
    const ask = (judge, e, typed, otherWords = []) => judge.judge({ pkg: 'p', entry: e, typed, otherWords, targetScript: 'hangul', targetLanguage: 'Korean' });

    it('a synonym with no letter in common is fully right: a 10, a pass, and its match is kept', async () => {
      const { judge, decisionGateway, aiGateway, cache } = jevJudge({ jev: jevSays(4, 'synonym') });
      const verdict = await ask(judge, entry('도와주다', 'to help', 'word'), '돕다', [{ term: '가위', gloss: 'Scissors' }]);
      expect(verdict).toEqual({ score: 10, judge: 'model', reason: null, pass: true, match: 'synonym' });
      expect(aiGateway.chatStructured).not.toHaveBeenCalled();
      const [state, questions] = decisionGateway.evaluate.mock.calls[0];
      expect(state).toMatchObject({
        target: '도와주다', gloss: 'to help', attempt: '돕다', language: 'Korean', script: 'hangul',
        otherWords: [{ term: '가위', gloss: 'Scissors' }], targetJamo: 'ㄷㅗ ㅇㅗㅏ ㅈㅜ ㄷㅏ', attemptJamo: 'ㄷㅗㅂ ㄷㅏ',
      });
      expect(questions.correct).toMatchObject({ type: 'score' });
      expect(questions.correct.levels).toHaveLength(5);
      expect(questions.correct.levels.at(-1)).toMatch(/synonym/);
      expect(questions.match).toMatchObject({ type: 'choice' });
      expect(Object.keys(questions.match.options)).toEqual(expect.arrayContaining(['identical', 'synonym', 'reordered', 'variant', 'misspelled', 'different']));
      expect(cache.get('p', 'w', '돕다')).toMatchObject({ score: 10, judge: 'model', match: 'synonym', engine: 'jev', v: 2 });
    });

    it('a phrase reaches Jev as typed — spaces and word order intact — and a reordering is fully right', async () => {
      const { judge, decisionGateway } = jevJudge({ jev: jevSays(4, 'reordered') });
      expect(await ask(judge, entry('엄마가 깨워 줄 테니까'), '깨워 줄 테니까 엄마가')).toMatchObject({ score: 10, pass: true, match: 'reordered' });
      expect(decisionGateway.evaluate.mock.calls[0][0].attempt).toBe('깨워 줄 테니까 엄마가');
    });

    it('letters close but meaning wrong fails: Jev can score below the letter distance', async () => {
      const { judge, logger } = jevJudge({ jev: jevSays(0, 'different') });
      expect(await ask(judge, LONG, TYPED)).toMatchObject({ score: 2, pass: false, match: 'different' });
      const row = logger.info.mock.calls.find(([event]) => event === 'school.card-ladder.judge-model')[1];
      // The rules' letter score rides along for comparison; Jev's is the grade.
      expect(row).toMatchObject({ engine: 'jev', model: 'jev-1.14.0', rules: 6, rulesJudge: 'distance', jevScore: 2, jevMatch: 'different', jev: 'decided', score: 2, pass: false, level: 0 });
    });

    // The 2026-11-03 replay: Jev's wrong verdicts were its unsure ones.
    it('an unsure Jev (confidence under 0.4, or none) does not overrule the letter rules', async () => {
      for (const confidence of [0.05, 0.39, null]) {
        const { judge, logger, cache } = jevJudge({ jev: jevSays(3, 'misspelled', confidence) });
        // 한교 for 한국: Jev said "misspelled, passes" at 0.05; the rules' 4 (a fail) stands.
        expect(await ask(judge, entry('한국', 'Korea'), '한교')).toEqual({ score: 4, judge: 'distance', reason: null, pass: false });
        expect(logger.info.mock.calls.find(([event]) => event === 'school.card-ladder.judge-model')[1])
          .toMatchObject({ jev: 'unsure', unsure: 'low-confidence', jevScore: 8, rules: 4, score: 4, pass: false });
        expect(cache.get('p', 'w', '한교')).toMatchObject({ score: 4, judge: 'distance', match: null, unsure: 'low-confidence', v: 2 });
      }
    });

    it('a Jev that contradicts itself (a pass it calls "different", a fail it calls a synonym) leaves it to the rules', async () => {
      // 도와줄다 for 불우 이웃을 돕다: level "right idea" (a 6, a pass) with match "different".
      const passButDifferent = jevJudge({ jev: jevSays(2, 'different', 0.9) });
      expect(await ask(passButDifferent.judge, entry('불우 이웃을 돕다', 'help neighbors in need'), '도와줄다'))
        .toMatchObject({ judge: 'distance', score: 2, pass: false });
      expect(passButDifferent.logger.info.mock.calls[0][1]).toMatchObject({ jev: 'unsure', unsure: 'contradiction' });
      const failButSynonym = jevJudge({ jev: jevSays(1, 'synonym', 0.9) });
      expect(await ask(failButSynonym.judge, LONG, TYPED)).toMatchObject({ judge: 'distance', score: 6 });
    });

    it('a sure, agreeing Jev decides even against the letters (게워 줄 for 도와줄: close letters, another meaning)', async () => {
      const { judge } = jevJudge({ jev: jevSays(1, 'different', 0.47) });
      expect(await ask(judge, entry('아빠가 도와줄 테니까', 'Dad will help you, so…'), '아빠가 게워 줄 테니까'))
        .toMatchObject({ judge: 'model', score: 4, pass: false, match: 'different' });
    });

    it('a misspelling of the intended word passes at 8; the levels map 2 · 4 · 6 · 8 · 10', async () => {
      for (const [level, score] of [[0, 2], [1, 4], [2, 6], [3, 8], [4, 10], [3.4, 8], [9, 10], [-1, 2]]) {
        expect((await ask(jevJudge({ jev: jevSays(level, 'misspelled') }).judge, LONG, TYPED)).score).toBe(score);
      }
    });

    it('short words go to Jev too (no letter-distance verdict on a two-syllable word)', async () => {
      const { judge, decisionGateway } = jevJudge({ jev: jevSays(3, 'misspelled') });
      expect(await ask(judge, entry('학교', 'School'), '핚교')).toMatchObject({ judge: 'model', score: 8 });
      expect(decisionGateway.evaluate).toHaveBeenCalledTimes(1);
    });

    it('another deck word goes to Jev with its meaning, not to the letter guard', async () => {
      const { judge, decisionGateway } = jevJudge({ jev: jevSays(0, 'different') });
      expect(await ask(judge, entry('마을', 'Village'), '생활', [{ term: '생활', gloss: 'Life' }])).toMatchObject({ judge: 'model', score: 2 });
      expect(decisionGateway.evaluate.mock.calls[0][0].otherWords).toEqual([{ term: '생활', gloss: 'Life' }]);
    });

    it('only certain answers skip Jev: identical, empty, no target-script letters, a wrong number', async () => {
      const { judge, decisionGateway } = jevJudge({ jev: jevSays(4, 'identical') });
      expect(await ask(judge, LONG, '안녕히 계세요!')).toMatchObject({ judge: 'exact', score: 10 });
      expect(await ask(judge, LONG, '')).toMatchObject({ judge: 'dont-know', score: 0 });
      // Punctuation alone is junk typed to get past the card, not the Don't know button.
      expect(await ask(judge, LONG, '.')).toMatchObject({ judge: 'wrong-script', score: 1 });
      expect(await ask(judge, LONG, 'hi')).toMatchObject({ judge: 'wrong-script', score: 1 });
      expect(await ask(judge, entry('1776년'), '1777년')).toMatchObject({ judge: 'number', score: 2 });
      expect(decisionGateway.evaluate).not.toHaveBeenCalled();
    });

    it('a number written in words goes to Jev; a wrong number in digits is certain', async () => {
      const { judge, decisionGateway } = jevJudge({ jev: jevSays(4, 'variant') });
      expect(await ask(judge, entry('1776년'), '천칠백칠십육년')).toMatchObject({ judge: 'model', score: 10 });
      expect(decisionGateway.evaluate).toHaveBeenCalledTimes(1);
    });

    it('a 1.4 sign-off tells Jev the child heard the word; a 3.3 that it was asked for', async () => {
      const { judge, decisionGateway } = jevJudge({ jev: jevSays(4, 'identical') });
      await judge.judge({ pkg: 'p', entry: LONG, typed: TYPED, otherWords: [], targetScript: 'hangul', heard: true });
      await judge.judge({ pkg: 'p', entry: entry('가위', 'Scissors'), typed: '가이', otherWords: [], targetScript: 'hangul' });
      const [heardCall, askedCall] = decisionGateway.evaluate.mock.calls.map(([, questions]) => questions.correct.instructions);
      expect(heardCall).toMatch(/heard `target` read aloud/);
      expect(askedCall).toMatch(/was asked for `target`/);
    });

    it('a cached Jev verdict is reused; one cached before the correctness rubric (no v:2) is asked again', async () => {
      const { judge, decisionGateway, cache } = jevJudge({ jev: jevSays(4, 'synonym') });
      cache.set('p', 'w', TYPED, { score: 6, judge: 'model', reason: null, engine: 'jev', model: 'jev-1.14.0' });
      expect(await ask(judge, LONG, TYPED)).toMatchObject({ judge: 'model', score: 10 });
      expect(await ask(judge, LONG, TYPED)).toMatchObject({ judge: 'cache', score: 10, match: 'synonym' });
      expect(decisionGateway.evaluate).toHaveBeenCalledTimes(1);
    });

    it("a grown-up's re-grade still wins over Jev", async () => {
      const { judge, decisionGateway, cache } = jevJudge({ jev: jevSays(4, 'synonym') });
      cache.set('p', 'w', TYPED, { score: 1, judge: 'grown-up', reason: 'Re-graded by a grown-up' });
      expect(await ask(judge, LONG, TYPED)).toMatchObject({ judge: 'grown-up', score: 1, pass: false });
      expect(decisionGateway.evaluate).not.toHaveBeenCalled();
    });

    it('falls back to the letter score when Jev fails or answers malformed, without the chat model', async () => {
      const { judge, aiGateway, logger } = jevJudge({ jev: async () => { throw new Error('429'); } });
      expect(await ask(judge, LONG, TYPED)).toMatchObject({ judge: 'fallback', score: 6 });
      expect(aiGateway.chatStructured).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('school.card-ladder.judge-fallback', expect.objectContaining({ engine: 'jev', error: '429' }));
      const malformed = jevJudge({ jev: async () => ({ model: 'jev', answers: {} }) });
      expect(await ask(malformed.judge, LONG, TYPED)).toMatchObject({ judge: 'fallback' });
    });

    it('a match Jev did not offer is dropped, never stored', async () => {
      const { judge } = jevJudge({ jev: jevSays(4, 'made-up') });
      const verdict = await ask(judge, LONG, TYPED);
      expect(verdict.score).toBe(10);
      expect(verdict.match).toBeUndefined();
    });

    it('runs with no chat model configured at all', async () => {
      const { judge } = jevJudge({ jev: jevSays(4, 'synonym'), withLlm: false });
      expect(await ask(judge, LONG, TYPED)).toMatchObject({ judge: 'model' });
    });

    it('an unconfigured decision gateway leaves the chat model in charge (the old clamped path)', async () => {
      const aiGateway = { chatStructured: vi.fn(async () => ({ score: 9, reason: 'close' })) };
      const decisionGateway = { isConfigured: () => false, evaluate: vi.fn() };
      const judge = new CardLadderTypedJudge({ aiGateway, decisionGateway, cache: makeCache(), model: 'small', logger: { info() {}, warn() {} } });
      expect(await judge.judge({ pkg: 'p', entry: LONG, typed: TYPED, otherWords: [] })).toMatchObject({ judge: 'model', reason: 'close' });
      expect(decisionGateway.evaluate).not.toHaveBeenCalled();
    });
  });
});
