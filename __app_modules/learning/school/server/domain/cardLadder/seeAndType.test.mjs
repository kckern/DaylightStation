// The see-and-type card variety: one card (see it, hear it, type it), no
// anchor side, no sort, match, choices or drill.
import { describe, expect, it } from 'vitest';
import { emptyWordV3 } from "./mastery.mjs";
import { emptyDay, emptyStatusV3 } from "./statusV3.mjs";
import { currentItem, learnMore, openDay, practiceMenu, respond, roundHasMatch, startPractice } from "./engine.mjs";
import { validateLexicon, expandLexiconDeck } from "./lexicon.mjs";
import { ladderLevel } from "./mastery.mjs";

const D = '2026-11-23';
const D2 = '2026-11-24';
const SET = {
  round: { size: 5, maxPasses: 3 }, batch: { newPerDay: 4, workingSet: 7 },
  review: { gapScale: 1 }, drill: { afterMisses: 2, perSitting: 1 }, session: { capMinutes: 15 }, typing: { passScore: 6 },
};
const E = (id, term) => [id, { id, term, gloss: '', kind: 'word', group: 'vowels', decoys: { term: [], gloss: [] } }];
const lexicon = {
  cards: 'see-and-type', targetScript: 'hangul',
  entries: new Map([E('a', 'ㅏ'), E('eo', 'ㅓ'), E('o', 'ㅗ'), E('g', 'ㄱ')]),
};
const media = { a: { audio: true }, eo: { audio: true }, o: { audio: true }, g: { audio: false } };
const pool = ['a', 'eo', 'o'];
let clock = Date.parse(`${D}T16:00:00-08:00`);
const at = () => new Date((clock += 5000)).toISOString();

function start(status = emptyStatusV3(), { day = D, dayFile = emptyDay(day), poolIds = pool } = {}) {
  const opened = openDay({ status, dayFile, day, deckId: 'deck', pool: poolIds, settings: SET, learnerId: 'kid', at: at(), media, lexicon });
  return { ...opened, day, lexicon, media, pool: poolIds, settings: SET, learnerId: 'kid' };
}
function step(ctx, response) {
  const item = currentItem(ctx);
  const out = respond(ctx, item.id, response, { at: at() });
  return { ctx: { ...ctx, status: out.status, dayFile: out.dayFile }, item, result: out.result };
}
const termOf = (item) => lexicon.entries.get(item.wordId).term;

describe('see-and-type — a fresh day', () => {
  it('Learn is the copy (no flash, no say), then a graded quiz of the same card; no sort, no match', () => {
    let ctx = start();
    const seen = [];
    for (let i = 0; i < 3; i += 1) {
      const item = currentItem(ctx);
      expect(item).toMatchObject({ type: 'copy' });
      expect(item.task).toBeUndefined();
      seen.push(item.wordId);
      ({ ctx } = step(ctx, { typed: termOf(item) }));
      expect(ctx.status.words[item.wordId].state).toBe('introduced');
    }
    expect(seen).toEqual(pool);
    const quiz = [];
    while (currentItem(ctx).type === 'copy') {
      const item = currentItem(ctx);
      expect(item).toMatchObject({ type: 'copy', task: 'K.1', source: 'verify', graded: true });
      quiz.push(item.wordId);
      ({ ctx } = step(ctx, { typed: termOf(item) }));
    }
    expect(quiz.sort()).toEqual([...pool].sort());
    expect(ctx.status.words.a).toMatchObject({ state: 'mastered', stage: 0, typedSignedOff: null });
    expect(ladderLevel(ctx.status.words.a)).toBe('recognised');
    expect(currentItem(ctx)).toMatchObject({ type: 'summary' });
    expect(roundHasMatch(ctx.dayFile.rounds[0])).toBe(false);
    expect(ctx.dayFile.doneAt).toEqual(expect.any(String));
  });

  it('a learn-copy mismatch is a retry; a quiz mismatch is a graded miss that advances', () => {
    let ctx = start();
    const first = currentItem(ctx);
    const { ctx: after, result } = step(ctx, { typed: 'ㅣ' });
    expect(result).toMatchObject({ correct: false });
    expect(currentItem(after).id).toBe(first.id);
    ctx = after;
    for (let i = 0; i < 3; i += 1) ({ ctx } = step(ctx, { typed: termOf(currentItem(ctx)) }));
    const q = currentItem(ctx);
    const out = step(ctx, { typed: 'ㅣ' });
    expect(out.result).toMatchObject({ correct: false, answer: termOf(q) });
    expect(currentItem(out.ctx).id).not.toBe(q.id);
    expect(out.ctx.status.words[q.wordId]).toMatchObject({ state: 'familiar', verifyFailedDay: D });
  });

  it("an empty quiz answer is a Don't know miss", () => {
    let ctx = start();
    for (let i = 0; i < 3; i += 1) ({ ctx } = step(ctx, { typed: termOf(currentItem(ctx)) }));
    const out = step(ctx, { typed: '' });
    expect(out.result).toMatchObject({ correct: false, dontKnow: true });
  });
});

describe('see-and-type — later days', () => {
  it('rechecks are K.1; the first recheck pass signs the card off', () => {
    const status = emptyStatusV3();
    status.words.a = { ...emptyWordV3(), state: 'mastered', stage: 0, dueDay: D2, introducedDay: D };
    let ctx = start(status, { day: D2, poolIds: [] });
    const item = currentItem(ctx);
    expect(item).toMatchObject({ id: 'rc:a', type: 'copy', task: 'K.1', source: 'recheck', graded: true });
    ({ ctx } = step(ctx, { typed: 'ㅏ' }));
    expect(ctx.status.words.a).toMatchObject({ state: 'mastered', stage: 1 });
    expect(ladderLevel(ctx.status.words.a)).toBe('mastered');
  });

  it('a carry round has nothing to learn: it opens straight on the graded quiz', () => {
    const status = emptyStatusV3();
    status.words.a = { ...emptyWordV3(), state: 'familiar', introducedDay: D, verifyFailedDay: D };
    status.words.eo = { ...emptyWordV3(), state: 'familiar', introducedDay: D, verifyFailedDay: D };
    const ctx = start(status, { day: D2, poolIds: [] });
    expect(currentItem(ctx)).toMatchObject({ type: 'copy', task: 'K.1', source: 'verify' });
  });

  it('never starts a tricky-word drill', () => {
    const status = emptyStatusV3();
    status.words.a = { ...emptyWordV3(), state: 'familiar', introducedDay: D, tricky: true, trickySince: D };
    const ctx = start(status, { day: D2, poolIds: [] });
    expect(ctx.dayFile.drills).toEqual([]);
    expect(currentItem(ctx).type).not.toBe('drill');
  });
});

describe('see-and-type — practice and Learn more', () => {
  function doneDay() {
    let ctx = start();
    while (currentItem(ctx).type === 'copy') ({ ctx } = step(ctx, { typed: termOf(currentItem(ctx)) }));
    ({ ctx } = step(ctx, { done: true }));
    return ctx;
  }
  it('offers only Write (with help) and Quiz me', () => {
    const ctx = doneDay();
    const menu = practiceMenu(ctx);
    expect(menu.modes.every((mode) => ['write', 'quiz'].includes(mode))).toBe(true);
    expect(menu.modes).toContain('write');
    expect(menu.writeHelp).toEqual([true]);
    expect(() => startPractice(ctx, { mode: 'match' })).toThrow(/unknown practice mode/);
  });

  it('a practice Quiz me is K.1 and ends without a match', () => {
    let ctx = doneDay();
    ctx.status.words.a = { ...ctx.status.words.a, state: 'familiar', verifyFailedDay: null };
    const started = startPractice(ctx, { mode: 'quiz' });
    ctx = { ...ctx, ...started };
    const item = currentItem(ctx);
    expect(item).toMatchObject({ type: 'copy', task: 'K.1', source: 'practice', graded: true });
    ({ ctx } = step(ctx, { typed: 'ㅏ' }));
    expect(ctx.dayFile.practice.queue.some((task) => task.kind === 'match')).toBe(false);
    expect(ctx.status.words.a.state).toBe('mastered');
  });

  it('Learn more introduces through the copy too', () => {
    let ctx = doneDay();
    // A word added to the deck after the day's goal: Learn more meets it by copy.
    ctx = { ...ctx, pool: [...pool, 'g'] };
    ctx = { ...ctx, ...learnMore(ctx, { at: at() }) };
    const item = currentItem(ctx);
    expect(item).toMatchObject({ type: 'copy', wordId: 'g' });
    expect(item.task).toBeUndefined();
    ({ ctx } = step(ctx, { typed: 'ㄱ' }));
    expect(ctx.status.words.g).toMatchObject({ state: 'introduced', introducedExtra: true });
    expect(currentItem(ctx)).toMatchObject({ type: 'copy', task: 'K.1', wordId: 'g' });
  });
});

describe('see-and-type — lexicon', () => {
  const raw = (over = {}) => ({
    schema: 'school.card-lexicon/v3', package: 'hangul-keys', cards: 'see-and-type',
    target: { code: 'ko', name: 'Korean' }, program: { title: '한글' },
    entries: [{ id: 'a', kind: 'word', group: 'vowels', term: 'ㅏ' }, { id: 'g', kind: 'word', group: 'consonants', term: 'ㄱ' }],
    ...over,
  });
  it('needs no gloss, no decoys and no anchor block', () => {
    const { errors, lexicon: parsed } = validateLexicon(raw());
    expect(errors).toEqual([]);
    expect(parsed.cards).toBe('see-and-type');
    expect(parsed.entries.get('a')).toMatchObject({ term: 'ㅏ', gloss: '' });
    expect(parsed.anchorLanguage).toMatchObject({ code: 'ko' });
  });
  it('a standard lexicon still requires gloss and decoys', () => {
    const { errors } = validateLexicon({ ...raw(), cards: undefined, anchor: { code: 'en', name: 'English' } });
    expect(errors.some((e) => /gloss: is required/.test(e))).toBe(true);
    expect(errors.some((e) => /decoys/.test(e))).toBe(true);
  });
  it('rejects an unknown card variety', () => {
    expect(validateLexicon(raw({ cards: 'speed-round' })).errors.some((e) => /cards:/.test(e))).toBe(true);
  });
  it('a deck expands with the target on both faces', () => {
    const { lexicon: parsed } = validateLexicon(raw());
    const { errors, deck } = expandLexiconDeck({ id: 'd', title: 'Vowels', lexicon: 'media:language/hangul-keys/lexicon.yml', words: ['a'] }, parsed);
    expect(errors).toEqual([]);
    expect(deck.cards[0].back.blocks[0]).toEqual({ type: 'text', text: 'ㅏ' });
  });
});

describe('see-and-type — printed quiz', () => {
  it('refuses to build a printed quiz (it would need meanings)', async () => {
    const { buildWordQuizSource } = await import('./quizSource.mjs');
    expect(() => buildWordQuizSource({ deck: { id: 'd', words: ['a'] }, lexicon, seed: 1 })).toThrow(/see-and-type/);
  });
});
