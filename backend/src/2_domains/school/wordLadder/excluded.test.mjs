// backend/src/2_domains/school/wordLadder/excluded.test.mjs
/**
 * A word a grown-up excluded (spec §6 Grown-up word controls) is gone from
 * everything the engine plans: the new-word pool and intros, carry rounds,
 * rechecks, tricky drills, drill offers, practice runs, match partners and the
 * printed quiz — and it never counts toward the working set.
 */
import { describe, expect, it } from 'vitest';
import { emptyWordV3, isDue, isUnsettled } from './mastery.mjs';
import { emptyDay, emptyStatusV3, migrateStatusV2 } from './statusV3.mjs';
import { newAllowance, planNextRound } from './rounds.mjs';
import { practiceWordIds, buildPractice } from './practice.mjs';
import { currentItem, excludeWordFromDay, openDay, respond } from './engine.mjs';
import { buildLearnerQuizSource } from './quizSource.mjs';

const D = '2026-09-22';
const SET = {
  round: { size: 5, maxPasses: 3 }, batch: { newPerDay: 4, workingSet: 7 },
  review: { gapScale: 1, typedEvery: 2 }, drill: { afterMisses: 2, perSitting: 1 }, session: { capMinutes: 15 }, typing: { passScore: 6 },
};
const E = (id, term, gloss) => [id, { id, term, gloss, kind: 'word', decoys: { term: ['x1', 'x2', 'x3'], gloss: ['g1', 'g2', 'g3'] } }];
const lexicon = {
  package: 'korean-vocab', program: { title: 'Korean words' }, language: { code: 'ko', name: 'Korean' },
  quiz: { topics: ['vocab'], instructions: 'Circle one.' },
  entries: new Map([E('gawi', '가위', 'Scissors'), E('pul', '풀', 'Glue'), E('chaek', '책', 'Book'), E('mul', '물', 'Water')]),
};
const media = Object.fromEntries([...lexicon.entries.keys()].map((id) => [id, { image: false, audio: true }]));
const off = (word) => ({ ...word, excluded: true });
const w = (state, extra = {}) => ({ ...emptyWordV3(), state, introducedDay: '2026-09-10', ...extra });
let clock = Date.parse(`${D}T16:00:00-07:00`);
const at = () => new Date((clock += 5000)).toISOString();
function start(status, pool = ['gawi', 'pul', 'chaek', 'mul']) {
  const opened = openDay({ status, dayFile: emptyDay(D), day: D, deckId: 'deck', pool, settings: SET, learnerId: 'test-learner', at: at(), media, lexicon });
  return { ...opened, day: D, lexicon, media, pool, settings: SET, learnerId: 'test-learner' };
}
function step(ctx, response, verdict = null) {
  const item = currentItem(ctx);
  const out = respond(ctx, item.id, response, { at: at(), verdict });
  return { ctx: { ...ctx, status: out.status, dayFile: out.dayFile }, item };
}

describe('excluded words', () => {
  it('a word record starts not excluded, and migration leaves it so', () => {
    expect(emptyWordV3().excluded).toBe(false);
    const migrated = migrateStatusV2({ schema: 'school.word-ladder-status/v1', words: { a: { state: 'known', step: 1 }, b: { state: 'learning' } } });
    expect(migrated.words.a.excluded).toBe(false);
    expect(migrated.words.b.excluded).toBe(false);
  });

  it('is never due and never unsettled', () => {
    expect(isDue(off(w('mastered', { stage: 1, dueDay: D })), D)).toBe(false);
    expect(isUnsettled(off(w('familiar')))).toBe(false);
    expect(isUnsettled(off(w('mastered', { stage: 0 })))).toBe(false);
  });

  it('does not count toward the working set', () => {
    const crowded = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`x${i}`, off(w('familiar'))]));
    expect(newAllowance({ words: crowded, day: D, settings: SET })).toBe(4);
  });

  it('is never carried and never drawn from the pool', () => {
    const words = { a: off(w('familiar')), b: off(w('notYet')), c: w('claimed'), n1: off(emptyWordV3()) };
    const plan = planNextRound({ words, pool: ['n1', 'n2', 'n3'], day: D, settings: SET, remainingMs: 15 * 60000, roundNumber: 1 });
    expect(plan.words).not.toContain('a');
    expect(plan.words).not.toContain('b');
    expect(plan.newWords).toEqual(['n2', 'n3']);
  });

  it('is never introduced, rechecked or drilled as tricky on open', () => {
    const status = emptyStatusV3();
    status.words.gawi = off(w('mastered', { stage: 1, dueDay: D }));
    status.words.pul = off(w('familiar', { tricky: true, trickySince: '2026-09-20', missStreak: 2 }));
    status.words.chaek = off(emptyWordV3());
    const ctx = start(status);
    expect(ctx.dayFile.atOpen.dueRechecks).toEqual([]);
    expect(ctx.dayFile.atOpen.tricky).toEqual([]);
    expect(ctx.dayFile.drills).toEqual([]);
    const round = ctx.dayFile.rounds.at(-1);
    expect(round?.words ?? []).not.toContain('chaek');
    expect(round?.words ?? []).not.toContain('pul');
  });

  it('is never offered a drill when excluded mid-round', () => {
    let ctx = start(emptyStatusV3(), ['gawi', 'pul', 'chaek']);
    let guard = 0;
    while (currentItem(ctx).type !== 'summary' && guard++ < 80) {
      const item = currentItem(ctx);
      expect(item.type === 'drill-offer' && item.wordId === 'pul').toBe(false);
      if (item.type === 'flashcard' && item.mode === 'intro') ({ ctx } = step(ctx, { seen: true }));
      else if (item.type === 'copy') ({ ctx } = step(ctx, { typed: lexicon.entries.get(item.wordId).term }));
      else if (item.type === 'say') ({ ctx } = step(ctx, { done: true }));
      else if (item.type === 'flashcard') {
        ({ ctx } = step(ctx, { sort: item.wordId === 'pul' ? 'notYet' : 'claimed' }));
        ctx.status.words.pul = off(ctx.status.words.pul);
      } else if (item.type === 'drill-offer') ({ ctx } = step(ctx, { drill: 'no' }));
      else if (item.type === 'typed') ({ ctx } = step(ctx, { typed: 'x' }, { score: 10, judge: 'exact', pass: true }));
      else ({ ctx } = step(ctx, { choice: lexicon.entries.get(item.wordId).gloss }));
    }
    expect(currentItem(ctx).type).toBe('summary');
  });

  it('never appears in a practice run or as a match partner', () => {
    const words = { gawi: w('familiar', { tricky: true }), pul: off(w('familiar', { tricky: true })), chaek: w('claimed'), mul: w('mastered', { stage: 2 }) };
    for (const filter of ['working', 'introduced', 'tricky']) expect(practiceWordIds({ filter, words })).not.toContain('pul');
    expect(practiceWordIds({ filter: 'chosen', words, chosen: ['pul', 'gawi'] })).toEqual(['gawi']);
    const match = buildPractice({ mode: 'match', words, entries: lexicon.entries, media, day: D, seed: 's' });
    expect(JSON.stringify(match.queue)).not.toContain('"pul"');
    const quiz = buildPractice({ mode: 'quiz', words, entries: lexicon.entries, media, day: D, seed: 's' });
    expect(quiz.queue.map((t) => t.wordId)).not.toContain('pul');
  });

  it('never pairs on a drill match board', () => {
    const status = emptyStatusV3();
    status.words.gawi = w('familiar', { tricky: true, trickySince: '2026-09-20', missStreak: 2 });
    status.words.pul = off(w('familiar'));
    const ctx = start(status, []);
    // Only the excluded word could partner gawi, so the drill has no match step.
    expect(ctx.dayFile.drills[0].wordId).toBe('gawi');
    expect(ctx.dayFile.drills[0].steps).not.toContain('match');
  });

  it('never prints on the learner quiz', () => {
    const status = emptyStatusV3();
    status.words.gawi = w('familiar', { introducedDay: '2026-09-21' });
    status.words.pul = off(w('familiar', { introducedDay: '2026-09-21' }));
    status.words.chaek = off(w('mastered', { stage: 2, dueDay: '2026-10-30' }));
    const src = buildLearnerQuizSource({
      status, lexicon, decks: [{ id: 'language/korean/week-01', words: ['gawi', 'pul', 'chaek'] }], learnerId: 'test-learner', day: D, seed: 1,
    });
    expect(src.blocks.map((b) => b.itemId)).toEqual(['gawi']);
  });

  it('excludeWordFromDay drops a pending recheck and an unfinished drill, keeping answered ones', () => {
    const dayFile = emptyDay(D);
    dayFile.rechecks = { order: ['gawi', 'pul'], answered: { gawi: { task: '2.2', correct: true } } };
    dayFile.drills = [{ id: 'd1', wordId: 'pul', steps: ['look'], index: 0, done: false }];
    const next = excludeWordFromDay(dayFile, 'pul');
    expect(next.rechecks.order).toEqual(['gawi']);
    expect(next.drills[0].done).toBe(true);
    expect(dayFile.rechecks.order).toEqual(['gawi', 'pul']); // pure
    const answered = excludeWordFromDay(dayFile, 'gawi');
    expect(answered.rechecks.order).toEqual(['gawi', 'pul']);
  });

  it('excluding the last pending thing re-settles the day: the next round is planned, not a false done', () => {
    const status = emptyStatusV3();
    status.words.gawi = w('mastered', { stage: 1, dueDay: D });
    const ctx = start(status, ['pul', 'chaek']);
    expect(currentItem(ctx).wordId).toBe('gawi'); // the due recheck
    expect(ctx.dayFile.rounds).toHaveLength(0);
    const nextStatus = { ...ctx.status, words: { ...ctx.status.words, gawi: off(ctx.status.words.gawi) } };
    const dayFile = excludeWordFromDay(ctx.dayFile, 'gawi', { ...ctx, status: nextStatus, at: at() });
    expect(dayFile.doneAt).toBeNull();
    expect(dayFile.rounds).toHaveLength(1);
    expect(dayFile.rounds[0].newWords).toEqual(['pul', 'chaek']);
    expect(currentItem({ ...ctx, status: nextStatus, dayFile }).type).not.toBe('summary');
  });

  it('excluding the last pending thing on a day with nothing else to do credits the day then', () => {
    const status = emptyStatusV3();
    status.words.gawi = w('mastered', { stage: 1, dueDay: D });
    const ctx = start(status, []);
    const nextStatus = { ...ctx.status, words: { ...ctx.status.words, gawi: off(ctx.status.words.gawi) } };
    const settledAt = at();
    const dayFile = excludeWordFromDay(ctx.dayFile, 'gawi', { ...ctx, status: nextStatus, at: settledAt });
    expect(dayFile.doneAt).toBe(settledAt);
  });

  it('a drill ended by an exclusion does not use up the day\'s tricky drill', () => {
    const status = emptyStatusV3();
    status.words.gawi = w('familiar', { tricky: true, trickySince: '2026-09-01' });
    status.words.pul = w('familiar', { tricky: true, trickySince: '2026-09-05' });
    const ctx = start(status, []);
    expect(ctx.dayFile.drills.map((d) => [d.wordId, d.done])).toEqual([['gawi', false]]);
    const nextStatus = { ...ctx.status, words: { ...ctx.status.words, gawi: off(ctx.status.words.gawi) } };
    const dayFile = excludeWordFromDay(ctx.dayFile, 'gawi', { ...ctx, status: nextStatus, at: at() });
    expect(dayFile.drills.map((d) => [d.wordId, d.done, d.excluded === true])).toEqual([['gawi', true, true], ['pul', false, false]]);
  });
});
