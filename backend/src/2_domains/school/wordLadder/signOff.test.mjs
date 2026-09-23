// backend/src/2_domains/school/wordLadder/signOff.test.mjs
/**
 * Ruling 2026-09-23 (owner): typing from memory is the final sign-off only —
 * recognition → claim → match → typed sign-off. Recording is practice only,
 * never a quiz or a prerequisite.
 */
import { describe, expect, it } from 'vitest';
import { applyGraded, emptyWordV3, ladderLevel, readyForSignOff } from './mastery.mjs';
import { emptyDay, emptyStatusV3, migrateStatusV2, normalizeStatusV3 } from './statusV3.mjs';
import { currentItem, openDay, respond, roundHasMatch, startPractice } from './engine.mjs';
import { buildPractice } from './practice.mjs';
import { introPreview } from './intro.mjs';
import { DRILL_STEPS, drillSteps } from './drill.mjs';

const D = '2026-09-23';
const SET = {
  round: { size: 5, maxPasses: 3 }, batch: { newPerDay: 4, workingSet: 7 },
  review: { gapScale: 1 }, drill: { afterMisses: 2, perSitting: 1 }, session: { capMinutes: 15 }, typing: { passScore: 6 },
};
const E = (id, term, gloss) => [id, { id, term, gloss, kind: 'word', decoys: { term: ['x1', 'x2', 'x3'], gloss: ['g1', 'g2', 'g3'] } }];
const lexicon = { entries: new Map([E('gawi', '가위', 'Scissors'), E('pul', '풀', 'Glue'), E('chaek', '책', 'Book'), E('mul', '물', 'Water'), E('bul', '불', 'Fire')]) };
const media = { gawi: { image: true, audio: true }, pul: { image: true, audio: true }, chaek: { image: false, audio: false }, mul: { audio: true }, bul: {} };
const pool = ['gawi', 'pul', 'chaek'];
const PASS = { score: 10, judge: 'exact', pass: true };
const FAIL = { score: 2, judge: 'distance', pass: false };
const GRADED_TASKS = new Set(['2.2', '3.1', '3.3', '1.4']);
const TYPED_TASKS = new Set(['3.3', '1.4']);
let clock = Date.parse(`${D}T16:00:00-07:00`);
const at = () => new Date((clock += 5000)).toISOString();

function start(status = emptyStatusV3(), { capabilities = null, day = D } = {}) {
  const opened = openDay({ status, dayFile: emptyDay(day), day, deckId: 'deck', pool, settings: SET, learnerId: 'test-learner', at: at(), media, capabilities });
  return { ...opened, day, lexicon, media, pool, settings: SET, learnerId: 'test-learner' };
}
function step(ctx, response, verdict = null) {
  const item = currentItem(ctx);
  const out = respond(ctx, item.id, response, { at: at(), verdict });
  return { ctx: { ...ctx, status: out.status, dayFile: out.dayFile }, item, result: out.result };
}
const rightChoice = (item) => (item.task === '2.2' ? lexicon.entries.get(item.wordId).gloss : lexicon.entries.get(item.wordId).term);
const due = (word) => ({ ...emptyWordV3(), state: 'mastered', dueDay: D, introducedDay: '2026-09-01', ...word });
const recheckFor = (word, id = 'gawi') => {
  const status = emptyStatusV3();
  status.words[id] = due(word);
  return currentItem(start(status));
};

/** Walks a whole fresh day, answering everything right; returns every item served. */
function walkDay({ capabilities = null, sort = 'claimed', quizNow = false } = {}) {
  let ctx = start(emptyStatusV3(), { capabilities });
  const served = [];
  let guard = 0;
  while (guard++ < 200) {
    const item = currentItem(ctx);
    served.push(item);
    if (item.type === 'summary' || item.type === 'menu') break;
    if (item.type === 'flashcard' && item.mode === 'intro') ({ ctx } = step(ctx, { seen: true }));
    else if (item.type === 'copy') ({ ctx } = step(ctx, { typed: lexicon.entries.get(item.wordId).term }));
    else if (item.type === 'say' || item.type === 'match') ({ ctx } = step(ctx, { done: true }));
    else if (item.type === 'flashcard') ({ ctx } = step(ctx, quizNow ? { quizNow: true } : { sort }));
    else if (item.type === 'choice') ({ ctx } = step(ctx, { choice: rightChoice(item) }));
    else if (item.type === 'typed') ({ ctx } = step(ctx, { typed: lexicon.entries.get(item.wordId).term }, PASS));
    else if (item.type === 'drill-offer') ({ ctx } = step(ctx, { drill: 'no' }));
    else throw new Error(`unexpected item ${item.type}`);
  }
  return { ctx, served };
}

describe('sign-off ladder — the round quiz is recognition only', () => {
  it('verify serves no typed item: 3.1 then 2.2 per word, 2.2 on the hear channel when term audio exists', () => {
    const { served } = walkDay();
    const verify = served.filter((item) => item.source === 'verify');
    expect(verify.length).toBe(pool.length * 2);
    expect(verify.every((item) => item.type === 'choice')).toBe(true);
    expect(new Set(verify.map((item) => item.task))).toEqual(new Set(['3.1', '2.2']));
    expect(verify.find((item) => item.task === '2.2' && item.wordId === 'gawi').channel).toBe('hear');
    expect(verify.find((item) => item.task === '2.2' && item.wordId === 'chaek').channel).toBe('read');
  });

  it('Quiz me from the sort stream serves no typed item', () => {
    const { served } = walkDay({ quizNow: true });
    const verify = served.filter((item) => item.source === 'verify');
    expect(verify.length).toBeGreaterThan(0);
    expect(verify.some((item) => item.type === 'typed')).toBe(false);
  });

  it('a verify pass counts one recognition and lands on mastered stage 0, not signed off', () => {
    const { ctx } = walkDay();
    for (const id of pool) {
      expect(ctx.status.words[id]).toMatchObject({ state: 'mastered', stage: 0, recognizedCount: 1, typedSignedOff: null });
      expect(ladderLevel(ctx.status.words[id])).toBe('recognised');
    }
  });

  it('a first miss still stops the word and no same-day re-verify', () => {
    let ctx = start();
    let guard = 0;
    while (currentItem(ctx).source !== 'verify' && guard++ < 60) {
      const item = currentItem(ctx);
      if (item.type === 'flashcard' && item.mode === 'intro') ({ ctx } = step(ctx, { seen: true }));
      else if (item.type === 'copy') ({ ctx } = step(ctx, { typed: lexicon.entries.get(item.wordId).term }));
      else ({ ctx } = step(ctx, { sort: 'claimed' }));
    }
    const failed = currentItem(ctx).wordId;
    ({ ctx } = step(ctx, { dontKnow: true }));
    const round = ctx.dayFile.rounds.at(-1);
    expect(round.quiz.queue.slice(round.quiz.index).some((t) => t.wordId === failed)).toBe(false);
    expect(ctx.status.words[failed]).toMatchObject({ state: 'familiar', verifyFailedDay: D, recognizedCount: 0 });
  });

  it('a practice Quiz me is recognition only too', () => {
    const base = start();
    const done = { ...base, dayFile: { ...base.dayFile, doneAt: 'x', rounds: [], rechecks: { order: [], answered: {} }, summarySeen: true } };
    done.status.words.pul = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-01' };
    let ctx = { ...done, ...startPractice(done, { mode: 'quiz' }) };
    const tasks = ctx.dayFile.practice.queue.map((t) => t.task);
    expect(tasks).toEqual(['3.1', '2.2']);
    ({ ctx } = step(ctx, { choice: '풀' }));
    ({ ctx } = step(ctx, { choice: 'Glue' }));
    expect(ctx.status.words.pul).toMatchObject({ state: 'mastered', stage: 0, recognizedCount: 1 });
  });
});

describe('sign-off ladder — guided Match after the quiz', () => {
  it('Learn › Sort › Quiz › Match: the match is served after verify and marks every word in it matched', () => {
    const { ctx, served } = walkDay();
    const kinds = served.map((item) => (item.source === 'verify' ? 'quiz' : item.type === 'flashcard' && item.mode === 'stream' ? 'sort' : item.type));
    const firstQuiz = kinds.indexOf('quiz');
    const match = kinds.indexOf('match');
    expect(kinds.lastIndexOf('sort')).toBeLessThan(firstQuiz);
    expect(match).toBeGreaterThan(kinds.lastIndexOf('quiz'));
    expect(served[match]).toMatchObject({ type: 'match', id: 'r1:m' });
    expect(served[match].board.pairs.map((pair) => pair.wordId).sort()).toEqual([...pool].sort());
    for (const id of pool) expect(ctx.status.words[id].matched).toBe(true);
    expect(served.at(-1)).toMatchObject({ type: 'summary' });
  });

  it('the round phase reads match while the match is on screen', () => {
    let ctx = start();
    let guard = 0;
    while (currentItem(ctx).type !== 'match' && guard++ < 100) {
      const item = currentItem(ctx);
      if (item.type === 'flashcard' && item.mode === 'intro') ({ ctx } = step(ctx, { seen: true }));
      else if (item.type === 'copy') ({ ctx } = step(ctx, { typed: lexicon.entries.get(item.wordId).term }));
      else if (item.type === 'flashcard') ({ ctx } = step(ctx, { sort: 'claimed' }));
      else ({ ctx } = step(ctx, { choice: rightChoice(item) }));
    }
    expect(ctx.dayFile.rounds.at(-1).phase).toBe('match');
    expect(() => step(ctx, { choice: 'x' })).toThrow(/does not fit/);
  });

  it('roundHasMatch: planned before the quiz ends, true during Match, false when nothing could pass or none was run', () => {
    const quiz = (over) => ({ queue: [{ wordId: 'a', task: '3.1' }], index: 0, passed: [], failed: [], ...over });
    expect(roundHasMatch(null)).toBe(false);
    expect(roundHasMatch({ phase: 'intro', quiz: quiz() })).toBe(true);
    expect(roundHasMatch({ phase: 'stream', quiz: quiz() })).toBe(true);
    expect(roundHasMatch({ phase: 'quiz', quiz: quiz() })).toBe(true);
    expect(roundHasMatch({ phase: 'quiz', quiz: quiz({ index: 1, failed: ['a'] }) })).toBe(false);
    expect(roundHasMatch({ phase: 'match', quiz: quiz({ index: 1, passed: ['a'] }), match: { wordIds: ['a'] } })).toBe(true);
    expect(roundHasMatch({ phase: 'offer', quiz: quiz({ index: 1, failed: ['a'] }) })).toBe(false);
    expect(roundHasMatch({ phase: 'done', quiz: quiz({ index: 1, passed: ['a'] }), match: { wordIds: ['a'] } })).toBe(true);
  });

  it('pads a board of fewer than 3 verified words with up to 2 already-known words', () => {
    const status = emptyStatusV3();
    status.words.mul = { ...emptyWordV3(), state: 'mastered', stage: 3, dueDay: '2026-12-01', introducedDay: '2026-09-01' };
    status.words.bul = { ...emptyWordV3(), state: 'mastered', stage: 3, dueDay: '2026-12-01', introducedDay: '2026-09-01' };
    status.words.chaek = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-20' };
    let ctx = start(status);
    ctx = { ...ctx, pool: [] };
    ({ status: ctx.status, dayFile: ctx.dayFile } = openDay({ ...ctx, dayFile: emptyDay(D), deckId: 'deck', at: at() }));
    let guard = 0;
    while (currentItem(ctx).type !== 'match' && guard++ < 40) {
      const item = currentItem(ctx);
      if (item.type === 'flashcard') ({ ctx } = step(ctx, { sort: 'claimed' }));
      else ({ ctx } = step(ctx, { choice: rightChoice(item) }));
    }
    const board = currentItem(ctx).board.pairs.map((pair) => pair.wordId).sort();
    expect(board).toEqual(['bul', 'chaek', 'mul']);
    ({ ctx } = step(ctx, { done: true }));
    expect(ctx.status.words.chaek.matched).toBe(true);
    expect(ctx.status.words.mul.matched).toBe(true);
  });

  it('skips Match when the round verified nothing', () => {
    let ctx = start();
    const served = [];
    let guard = 0;
    while (currentItem(ctx).type !== 'summary' && guard++ < 100) {
      const item = currentItem(ctx);
      served.push(item.type);
      if (item.type === 'flashcard' && item.mode === 'intro') ({ ctx } = step(ctx, { seen: true }));
      else if (item.type === 'copy') ({ ctx } = step(ctx, { typed: lexicon.entries.get(item.wordId).term }));
      else if (item.type === 'flashcard') ({ ctx } = step(ctx, { sort: 'claimed' }));
      else if (item.type === 'drill-offer') ({ ctx } = step(ctx, { drill: 'no' }));
      else ({ ctx } = step(ctx, { dontKnow: true }));
    }
    expect(served).not.toContain('match');
  });

  it('a practice match marks the words on its board matched', () => {
    const base = start();
    const done = { ...base, dayFile: { ...base.dayFile, doneAt: 'x', rounds: [], rechecks: { order: [], answered: {} }, summarySeen: true } };
    for (const id of ['gawi', 'pul', 'chaek', 'mul']) done.status.words[id] = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-01' };
    let ctx = { ...done, ...startPractice(done, { mode: 'match' }) };
    ({ ctx } = step(ctx, { done: true }));
    for (const id of ['gawi', 'pul', 'chaek', 'mul']) expect(ctx.status.words[id].matched).toBe(true);
  });
});

describe('sign-off ladder — rechecks', () => {
  const ready = { recognizedCount: 2, matched: true };

  it('a stage-0 recheck (the first) is recognition even with every other prerequisite met', () => {
    expect(['2.2', '3.1']).toContain(recheckFor({ stage: 0, ...ready }).task);
  });

  it('with prerequisites unmet a later recheck is recognition, at any stage', () => {
    for (const word of [
      { stage: 1, recognizedCount: 1, matched: true },
      { stage: 1, recognizedCount: 2, matched: false },
      { stage: 4, recognizedCount: 5, matched: false },
      { stage: 2 },
    ]) {
      const item = recheckFor(word);
      expect(item.type).toBe('choice');
      expect(['2.2', '3.1']).toContain(item.task);
    }
  });

  it('with prerequisites met at stage >= 1 the recheck is typed: 3.3, or dictation (1.4) when term audio exists, alternating', () => {
    const tasks = [0, 1, 2, 3].map((rechecks) => recheckFor({ stage: 1, rechecks, ...ready }).task);
    expect(tasks.every((task) => TYPED_TASKS.has(task))).toBe(true);
    expect(new Set(tasks)).toEqual(new Set(['3.3', '1.4']));
    expect(tasks[0]).not.toBe(tasks[1]);
    // No term audio: never dictation.
    expect([0, 1, 2, 3].map((rechecks) => recheckFor({ stage: 2, rechecks, ...ready }, 'chaek').task)).toEqual(['3.3', '3.3', '3.3', '3.3']);
  });

  it('a graded dictation item carries no term and no cue; it is judged like any typed answer', () => {
    let item;
    for (let rechecks = 0; rechecks < 4 && item?.task !== '1.4'; rechecks += 1) item = recheckFor({ stage: 1, rechecks, ...ready });
    expect(item).toMatchObject({ type: 'typed', task: '1.4', source: 'recheck', wordId: 'gawi' });
    expect(item.cue).toBeUndefined();
  });

  it('a typed pass signs the word off: Mastered', () => {
    const status = emptyStatusV3();
    status.words.chaek = due({ stage: 1, ...ready });
    let ctx = start(status);
    expect(currentItem(ctx)).toMatchObject({ type: 'typed', task: '3.3' });
    ({ ctx } = step(ctx, { typed: '책' }, PASS));
    expect(ctx.status.words.chaek).toMatchObject({ state: 'mastered', stage: 2, typedSignedOff: D });
    expect(ladderLevel(ctx.status.words.chaek)).toBe('mastered');
  });

  it('a typed miss drops the word back to recognition rechecks — not learning, no spiral', () => {
    const status = emptyStatusV3();
    status.words.chaek = due({ stage: 3, ...ready, typedSignedOff: '2026-09-10' });
    let ctx = start(status);
    ({ ctx } = step(ctx, { typed: '착' }, FAIL));
    const word = ctx.status.words.chaek;
    expect(word).toMatchObject({ state: 'mastered', stage: 1, dueDay: '2026-09-24', typedSignedOff: null, missStreak: 1 });
    expect(ladderLevel(word)).toBe('recognised');
    expect(readyForSignOff(word)).toBe(false);
    // The next recheck is recognition; passing it keeps the gap short and re-opens the typed sign-off.
    const next = start({ ...ctx.status, words: { chaek: { ...word, dueDay: '2026-09-24' } } }, { day: '2026-09-24' });
    const item = currentItem(next);
    expect(item.type).toBe('choice');
    const after = step(next, { choice: rightChoice(item) }).ctx.status.words.chaek;
    expect(after).toMatchObject({ state: 'mastered', stage: 1, dueDay: '2026-09-25', recognizedCount: 3 });
    expect(readyForSignOff(after)).toBe(true);
  });

  it('a recognition recheck pass counts a recognition', () => {
    const word = applyGraded(due({ stage: 0, recognizedCount: 1 }), { source: 'recheck', correct: true, day: D, task: '2.2', settings: { afterMisses: 2, gapScale: 1 } });
    expect(word).toMatchObject({ stage: 1, recognizedCount: 2 });
  });
});

describe('sign-off ladder — never a say item inside a quiz, never typing up front', () => {
  it('across whole-day walks (with a mic) no say item has a verify or recheck source, and nothing before the day ends types from memory', () => {
    for (const opts of [{ capabilities: { microphone: true } }, { capabilities: { microphone: true }, quizNow: true }, {}]) {
      const { served } = walkDay(opts);
      expect(served.some((item) => item.type === 'say' && ['verify', 'recheck'].includes(item.source))).toBe(false);
      expect(served.some((item) => item.type === 'typed')).toBe(false);
      expect(served.filter((item) => GRADED_TASKS.has(item.task)).every((item) => item.type === 'choice')).toBe(true);
    }
  });

  it('the say-after step still runs in Learn with a mic (practice for the child, never graded)', () => {
    const { served } = walkDay({ capabilities: { microphone: true } });
    expect(served.some((item) => item.type === 'say' && item.mode === 'say-after')).toBe(true);
  });

  it('a drill types from memory (dictation, type-from-cue) only for a word ready for sign-off; copy and tiles are the ceiling otherwise', () => {
    expect(DRILL_STEPS.slice(-3)).toEqual(['dictation', 'say-from-cue', 'type']);
    expect(drillSteps({ audio: true }, { microphone: false })).not.toContain('dictation');
    expect(drillSteps({ audio: true }, { microphone: false })).not.toContain('type');
    expect(drillSteps({ audio: true }, { microphone: false }, { ready: true })).toEqual(['look', 'copy', 'match', 'tiles', 'dictation', 'type']);
    const base = start();
    const done = { ...base, dayFile: { ...base.dayFile, doneAt: 'x', rounds: [], rechecks: { order: [], answered: {} }, summarySeen: true } };
    done.status.words.gawi = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-01' };
    done.status.words.pul = { ...due({ stage: 2, recognizedCount: 2, matched: true }), dueDay: '2026-10-30' };
    const run = startPractice(done, { mode: 'drill', filter: 'chosen', chosen: ['gawi', 'pul'] }).dayFile.practice;
    const stepsOf = (id) => run.queue.find((task) => task.wordId === id).drill.steps;
    expect(stepsOf('gawi')).not.toEqual(expect.arrayContaining(['dictation']));
    expect(stepsOf('gawi')).not.toContain('type');
    expect(stepsOf('gawi')).toEqual(expect.arrayContaining(['copy', 'tiles']));
    expect(stepsOf('pul')).toEqual(expect.arrayContaining(['dictation', 'type']));
    // A tricky drill on a word still learning never types from memory either.
    const status = emptyStatusV3();
    status.words.gawi = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-10', tricky: true, trickySince: '2026-09-20', missStreak: 2 };
    const tricky = start(status).dayFile.drills[0];
    expect(tricky.wordId).toBe('gawi');
    expect(tricky.steps).not.toContain('dictation');
    expect(tricky.steps).not.toContain('type');
  });
});

describe('sign-off ladder — levels and migration', () => {
  it('ladderLevel: new, introduced, learning, recognised, mastered', () => {
    expect(ladderLevel(emptyWordV3())).toBe('new');
    expect(ladderLevel({ ...emptyWordV3(), state: 'introduced' })).toBe('introduced');
    for (const state of ['notYet', 'familiar', 'claimed']) expect(ladderLevel({ ...emptyWordV3(), state })).toBe('learning');
    expect(ladderLevel({ ...emptyWordV3(), state: 'mastered', stage: 3 })).toBe('recognised');
    expect(ladderLevel({ ...emptyWordV3(), state: 'mastered', stage: 3, typedSignedOff: D })).toBe('mastered');
  });

  it('empty words carry the flags at their defaults', () => {
    expect(emptyWordV3()).toMatchObject({ recognizedCount: 0, matched: false, typedSignedOff: null });
    expect(emptyWordV3()).not.toHaveProperty('recorded');
  });

  it('a v3 status written before the flags loads with defaults; old mastered words are grandfathered', () => {
    const raw = {
      schema: 'school.word-ladder-status/v3', decksSeen: ['deck'],
      words: {
        a: { state: 'familiar', stage: null, missStreak: 1 },
        b: { state: 'mastered', stage: 2, dueDay: '2026-09-30', lastGraded: { day: '2026-09-20', task: '2.2', correct: true } },
        c: { state: 'mastered', stage: 3, dueDay: '2026-09-30', lastGraded: { day: '2026-09-21', task: '3.3', correct: true } },
      },
    };
    const status = normalizeStatusV3(raw);
    expect(status.words.a).toMatchObject({ state: 'familiar', recognizedCount: 0, matched: false, typedSignedOff: null, missStreak: 1 });
    expect(status.words.b).toMatchObject({ recognizedCount: 2, matched: true, typedSignedOff: null });
    expect(status.words.c).toMatchObject({ recognizedCount: 2, matched: true, typedSignedOff: '2026-09-21' });
    expect(status.words.b).not.toHaveProperty('recorded');
    // Already-flagged words are left alone.
    const again = normalizeStatusV3(status);
    expect(again).toEqual(status);
    expect(raw.words.b).not.toHaveProperty('recognizedCount'); // pure
  });

  it('a v1 status migrates with the flags; known words are grandfathered', () => {
    const v3 = migrateStatusV2({
      schema: 'school.word-ladder-status/v1',
      words: { k: { state: 'known', step: 1, nextCheckDay: '2026-09-30' }, l: { state: 'learning' } },
    });
    expect(v3.words.k).toMatchObject({ state: 'mastered', stage: 2, recognizedCount: 2, matched: true, typedSignedOff: null });
    expect(v3.words.l).toMatchObject({ state: 'familiar', recognizedCount: 0, matched: false, typedSignedOff: null });
  });
});

describe('Fable review — every verified word can be matched, and typed only when ready', () => {
  const doneDay = (words) => {
    const base = start();
    const ctx = { ...base, dayFile: { ...base.dayFile, doneAt: 'x', rounds: [], rechecks: { order: [], answered: {} }, summarySeen: true } };
    for (const [id, word] of Object.entries(words)) ctx.status.words[id] = word;
    return ctx;
  };

  it('a practice Quiz me that passes a word ends on a Match of it, padded from introduced words', () => {
    const done = doneDay({
      pul: { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-01', recognizedCount: 1 },
      gawi: { ...emptyWordV3(), state: 'notYet', introducedDay: '2026-09-01' },
    });
    let ctx = { ...done, ...startPractice(done, { mode: 'quiz' }) };
    ({ ctx } = step(ctx, { choice: '풀' }));
    ({ ctx } = step(ctx, { choice: 'Glue' }));
    const match = currentItem(ctx);
    expect(match).toMatchObject({ type: 'match', source: 'practice' });
    expect(match.board.pairs.map((pair) => pair.wordId).sort()).toEqual(['gawi', 'pul']);
    ({ ctx } = step(ctx, { done: true }));
    expect(ctx.status.words.pul.matched).toBe(true);
    expect(currentItem(ctx).type).toBe('menu');
  });

  it('a practice Quiz me that passes nothing serves no Match', () => {
    const done = doneDay({ pul: { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-01' }, gawi: { ...emptyWordV3(), state: 'notYet', introducedDay: '2026-09-01' } });
    let ctx = { ...done, ...startPractice(done, { mode: 'quiz' }) };
    ({ ctx } = step(ctx, { dontKnow: true }));
    expect(currentItem(ctx).type).toBe('menu');
  });

  it('a practice-verified word reaches the typed sign-off', () => {
    const done = doneDay({
      pul: { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-01', recognizedCount: 1 },
      gawi: { ...emptyWordV3(), state: 'notYet', introducedDay: '2026-09-01' },
    });
    let ctx = { ...done, ...startPractice(done, { mode: 'quiz' }) };
    ({ ctx } = step(ctx, { choice: '풀' }));
    ({ ctx } = step(ctx, { choice: 'Glue' }));
    ({ ctx } = step(ctx, { done: true }));
    let status = ctx.status;
    let signed = false;
    for (let n = 0; n < 6 && !signed; n += 1) {
      const day = status.words.pul.dueDay;
      const only = { ...status, words: { pul: status.words.pul } };
      let rc = start(only, { day });
      const item = currentItem(rc);
      expect(item).toMatchObject({ source: 'recheck', wordId: 'pul' });
      if (item.type === 'typed') { ({ ctx: rc } = step(rc, { typed: '풀' }, PASS)); signed = true; }
      else ({ ctx: rc } = step(rc, { choice: rightChoice(item) }));
      status = rc.status;
    }
    expect(signed).toBe(true);
    expect(ladderLevel(status.words.pul)).toBe('mastered');
  });

  it('guided Match pads a lone verified word from any introduced word, and prefers a recognised word still owed its match', () => {
    const status = emptyStatusV3();
    status.words.mul = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-01' };
    status.words.bul = { ...emptyWordV3(), state: 'mastered', stage: 2, dueDay: '2026-12-01', introducedDay: '2026-09-01', recognizedCount: 2, matched: false };
    status.words.chaek = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-20' };
    let ctx = { ...start(status), pool: [] };
    ({ status: ctx.status, dayFile: ctx.dayFile } = openDay({ ...ctx, dayFile: emptyDay(D), deckId: 'deck', at: at() }));
    let guard = 0;
    while (currentItem(ctx).type !== 'match' && currentItem(ctx).type !== 'summary' && guard++ < 40) {
      const item = currentItem(ctx);
      if (item.type === 'flashcard') ({ ctx } = step(ctx, { sort: item.wordId === 'chaek' ? 'claimed' : 'notYet' }));
      else if (item.type === 'drill-offer') ({ ctx } = step(ctx, { drill: 'no' }));
      else ({ ctx } = step(ctx, { choice: rightChoice(item) }));
    }
    const board = currentItem(ctx).board.pairs.map((pair) => pair.wordId);
    expect(board).toContain('chaek');
    expect(board).toContain('bul');
    expect(board.length).toBe(3);
  });

  it('guided Match is skipped when the board would still be a single pair', () => {
    const status = emptyStatusV3();
    status.words.chaek = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-20' };
    let ctx = { ...start(status), pool: [] };
    ({ status: ctx.status, dayFile: ctx.dayFile } = openDay({ ...ctx, dayFile: emptyDay(D), deckId: 'deck', at: at() }));
    const served = [];
    let guard = 0;
    while (currentItem(ctx).type !== 'summary' && guard++ < 40) {
      const item = currentItem(ctx);
      served.push(item.type);
      if (item.type === 'flashcard') ({ ctx } = step(ctx, { sort: 'claimed' }));
      else if (item.type === 'match') ({ ctx } = step(ctx, { done: true }));
      else ({ ctx } = step(ctx, { choice: rightChoice(item) }));
    }
    expect(ctx.status.words.chaek.state).toBe('mastered');
    expect(served).not.toContain('match');
    expect(ctx.dayFile.rounds.at(-1).match).toBeUndefined();
  });
});

describe('Fable review — Write without help types from memory only over ready words', () => {
  const words = {
    gawi: { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-01' },
    pul: { ...due({ stage: 2, recognizedCount: 2, matched: true }), dueDay: '2026-10-30' },
  };
  const build = (help, w = words) => buildPractice({ mode: 'write', help, words: w, entries: lexicon.entries, media, day: D, seed: 's' });

  it('With help copies every introduced word; Without help lists only words ready for sign-off', () => {
    expect(build(true).queue.map((t) => t.wordId).sort()).toEqual(['gawi', 'pul']);
    expect(build(false).queue).toEqual([{ kind: 'type-practice', wordId: 'pul' }]);
    expect(build(false, { gawi: words.gawi }).queue).toEqual([]);
  });

  it('the menu says which Write variants have a run', () => {
    const base = start();
    const done = { ...base, dayFile: { ...base.dayFile, doneAt: 'x', rounds: [], rechecks: { order: [], answered: {} }, summarySeen: true } };
    done.status.words.gawi = words.gawi;
    expect(currentItem(done)).toMatchObject({ type: 'menu', writeHelp: [true] });
    done.status.words.pul = words.pul;
    expect(currentItem(done)).toMatchObject({ type: 'menu', writeHelp: [true, false] });
    expect(() => startPractice({ ...done, status: { ...done.status, words: { gawi: words.gawi } } }, { mode: 'write', help: false })).toThrow(/nothing to practise/);
  });
});

describe('Fable review — the start-card estimate uses the sign-off gate, not the retired stage cadence', () => {
  it('a stage-2 word not ready for sign-off is estimated as a recognition recheck', () => {
    const settings = SET;
    const status = emptyStatusV3();
    const plan = (word) => introPreview({ status: { ...status, words: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`w${i}`, word])) }, dayFile: null, day: D, pool: [], settings });
    const notReady = plan(due({ stage: 2, recognizedCount: 1, matched: false }));
    const ready = plan(due({ stage: 2, recognizedCount: 2, matched: true }));
    expect(notReady.reviewCount).toBe(20);
    expect(ready.estimatedMinutes).toBeGreaterThan(notReady.estimatedMinutes);
    const stage0 = plan(due({ stage: 0, recognizedCount: 2, matched: true }));
    expect(stage0.estimatedMinutes).toBe(notReady.estimatedMinutes);
  });
});
