// backend/src/2_domains/school/cardLadder/engine.test.mjs
import { describe, expect, it } from 'vitest';
import { emptyWordV3 } from './mastery.mjs';
import { emptyDay, emptyStatusV3 } from './statusV3.mjs';
import { addActiveTime, currentItem, openDay, respond, startPractice, wordTransitions } from './engine.mjs';

const D = '2026-09-22';
const SET = {
  round: { size: 5, maxPasses: 3 }, batch: { newPerDay: 4, workingSet: 7 },
  review: { gapScale: 1 }, drill: { afterMisses: 2, perSitting: 1 }, session: { capMinutes: 15 }, typing: { passScore: 6 },
};
const E = (id, term, gloss) => [id, { id, term, gloss, kind: 'word', decoys: { term: ['x1', 'x2', 'x3'], gloss: ['g1', 'g2', 'g3'] } }];
const lexicon = { entries: new Map([E('gawi', '가위', 'Scissors'), E('pul', '풀', 'Glue'), E('chaek', '책', 'Book'), E('mul', '물', 'Water')]) };
const media = { gawi: { image: true, audio: true, glossAudio: false }, pul: { image: true, audio: true }, chaek: { image: false, audio: false } };
const pool = ['gawi', 'pul', 'chaek'];
const PASS = { score: 10, judge: 'exact', pass: true };
let clock = Date.parse(`${D}T16:00:00-07:00`);
const at = () => new Date((clock += 5000)).toISOString();

function start(status = emptyStatusV3(), { capabilities = null, dayFile = emptyDay(D) } = {}) {
  const opened = openDay({ status, dayFile, day: D, deckId: 'deck', pool, settings: SET, learnerId: 'test-learner', at: at(), media, capabilities });
  return { ...opened, day: D, lexicon, media, pool, settings: SET, learnerId: 'test-learner' };
}
// The right answer to a recognition item: 2.2 picks the meaning, 3.1 the Korean.
const right = (item) => ({ choice: item.task === '2.2' ? lexicon.entries.get(item.wordId).gloss : lexicon.entries.get(item.wordId).term });
function step(ctx, response, verdict = null) {
  const item = currentItem(ctx);
  const out = respond(ctx, item.id, response, { at: at(), verdict });
  return { ctx: { ...ctx, status: out.status, dayFile: out.dayFile }, item, result: out.result };
}

describe('engine — a fresh day', () => {
  it('introduces, copies, streams, quizzes, then summarises', () => {
    let ctx = start();
    expect(currentItem(ctx)).toMatchObject({ type: 'flashcard', mode: 'intro', wordId: 'gawi' });
    for (const wordId of ['gawi', 'pul', 'chaek']) {
      ({ ctx } = step(ctx, { seen: true }));
      const copy = currentItem(ctx);
      expect(copy).toMatchObject({ type: 'copy', wordId });
      ({ ctx } = step(ctx, { typed: lexicon.entries.get(wordId).term }));
    }
    const sorts = { gawi: 'claimed', pul: 'familiar', chaek: 'notYet' };
    let guard = 0;
    while (currentItem(ctx).type === 'flashcard' && guard++ < 30) {
      const { wordId } = currentItem(ctx);
      ({ ctx } = step(ctx, { sort: wordId === 'chaek' && guard > 6 ? 'familiar' : sorts[wordId] }));
    }
    // Recognition only (ruling 2026-09-23): 3.1 for every word, then 2.2 — never typed.
    const first = currentItem(ctx);
    expect(first).toMatchObject({ type: 'choice', task: '3.1', source: 'verify' });
    while (currentItem(ctx).type === 'choice') ({ ctx } = step(ctx, right(currentItem(ctx))));
    expect(ctx.status.words.gawi).toMatchObject({ state: 'mastered', stage: 0, recognizedCount: 1, typedSignedOff: null });
    // Then the guided Match over the verified words.
    expect(currentItem(ctx)).toMatchObject({ type: 'match', id: 'r1:m' });
    ({ ctx } = step(ctx, { done: true }));
    expect(ctx.status.words.gawi.matched).toBe(true);
    expect(currentItem(ctx)).toMatchObject({ type: 'summary', doneToday: true });
    expect(ctx.dayFile.doneAt).toEqual(expect.any(String));
  });

  it('a copy mismatch keeps the copy item current', () => {
    let ctx = start();
    ({ ctx } = step(ctx, { seen: true }));
    const { ctx: after, result } = step(ctx, { typed: '가이' });
    expect(result).toMatchObject({ correct: false });
    expect(currentItem(after)).toMatchObject({ type: 'copy', wordId: 'gawi' });
  });

  it('repeating an answered item returns the stored result; a stale id throws', () => {
    let ctx = start();
    const item = currentItem(ctx);
    const out = respond(ctx, item.id, { seen: true }, { at: at() });
    ctx = { ...ctx, status: out.status, dayFile: out.dayFile };
    expect(respond(ctx, item.id, { seen: true }, { at: at() }).result).toEqual(out.result);
    expect(() => respond(ctx, 'r9:s:99', { sort: 'claimed' }, { at: at() })).toThrow(/stale/);
  });
});

describe('engine — rechecks and misses', () => {
  it('rechecks come first; a failed recheck demotes to familiar (re-quizzable in a later carry round)', () => {
    const status = emptyStatusV3();
    status.words.gawi = { ...emptyWordV3(), state: 'mastered', stage: 1, dueDay: D, introducedDay: '2026-09-10' };
    let ctx = start(status);
    const item = currentItem(ctx);
    expect(item).toMatchObject({ id: 'rc:gawi', source: 'recheck' });
    expect(item.type).toBe('choice'); // prerequisites unmet: a recognition recheck
    ({ ctx } = step(ctx, { dontKnow: true }));
    expect(ctx.status.words.gawi).toMatchObject({ state: 'familiar', lostMasteredDay: D });
  });

  it('first-miss stop: a failed 3.1 drops the word\'s 2.2', () => {
    let ctx = start();
    let guard = 0;
    while (currentItem(ctx).source !== 'verify' && guard++ < 60) {
      const item = currentItem(ctx);
      if (item.type === 'flashcard' && item.mode === 'intro') ({ ctx } = step(ctx, { seen: true }));
      else if (item.type === 'copy') ({ ctx } = step(ctx, { typed: lexicon.entries.get(item.wordId).term }));
      else ({ ctx } = step(ctx, { sort: 'claimed' }));
    }
    const failedWord = currentItem(ctx).wordId;
    expect(currentItem(ctx).task).toBe('3.1');
    ({ ctx } = step(ctx, { dontKnow: true }));
    const round = ctx.dayFile.rounds.at(-1);
    expect(round.quiz.queue.slice(round.quiz.index).some((t) => t.wordId === failedWord)).toBe(false);
    expect(ctx.status.words[failedWord]).toMatchObject({ state: 'familiar', verifyFailedDay: D });
  });

  it('Not yet at round end sets notYetCarry', () => {
    let ctx = start();
    let guard = 0;
    while (currentItem(ctx).type !== 'summary' && guard++ < 80) {
      const item = currentItem(ctx);
      if (item.type === 'flashcard' && item.mode === 'intro') ({ ctx } = step(ctx, { seen: true }));
      else if (item.type === 'copy') ({ ctx } = step(ctx, { typed: lexicon.entries.get(item.wordId).term }));
      else if (item.type === 'flashcard') ({ ctx } = step(ctx, { sort: 'notYet' }));
      else if (item.type === 'drill-offer') ({ ctx } = step(ctx, { drill: 'no' }));
      else ({ ctx } = step(ctx, { dontKnow: true }));
    }
    expect(Object.values(ctx.status.words).every((word) => word.notYetCarry === true)).toBe(true);
  });
});

describe('engine — cap and undo', () => {
  it('undo restores the previous sort', () => {
    let ctx = start();
    for (let i = 0; i < 3; i += 1) { ({ ctx } = step(ctx, { seen: true })); const c = currentItem(ctx); ({ ctx } = step(ctx, { typed: lexicon.entries.get(c.wordId).term })); }
    const before = currentItem(ctx);
    ({ ctx } = step(ctx, { sort: 'claimed' }));
    ({ ctx } = step(ctx, { undo: true }));
    expect(currentItem(ctx)).toMatchObject({ type: 'flashcard', wordId: before.wordId });
    expect(ctx.status.words[before.wordId].state).toBe('introduced');
  });
  it('addActiveTime caps idle gaps at 45 s', () => {
    const d = addActiveTime({ ...emptyDay(D), lastInputAt: 0 }, 10000);
    expect(addActiveTime(d, 10000 + 600000).activeMs).toBe(10000 + 45000);
  });
});

describe('engine — undo actually undoes', () => {
  it('sort → undo → sort the same card differently applies the new pile', () => {
    let ctx = start();
    for (let i = 0; i < 3; i += 1) { ({ ctx } = step(ctx, { seen: true })); const c = currentItem(ctx); ({ ctx } = step(ctx, { typed: lexicon.entries.get(c.wordId).term })); }
    const card = currentItem(ctx);
    ({ ctx } = step(ctx, { sort: 'claimed' }));
    const undoItem = currentItem(ctx);
    ({ ctx } = step(ctx, { undo: true }));
    expect(ctx.dayFile.items[card.id]).toBeUndefined();
    expect(ctx.dayFile.items[undoItem.id]).toBeUndefined();
    const again = currentItem(ctx);
    expect(again).toMatchObject({ id: card.id, wordId: card.wordId });
    const { ctx: after, result } = step(ctx, { sort: 'notYet' });
    expect(result).toEqual({ ok: true });
    expect(after.status.words[card.wordId].state).toBe('notYet');
    expect(after.dayFile.rounds.at(-1).stream.latest[card.wordId]).toBe('notYet');
    expect(after.dayFile.items[card.id].response).toEqual({ sort: 'notYet' });
  });

  it('undo with nothing to undo is rejected', () => {
    let ctx = start();
    for (let i = 0; i < 3; i += 1) { ({ ctx } = step(ctx, { seen: true })); const c = currentItem(ctx); ({ ctx } = step(ctx, { typed: lexicon.entries.get(c.wordId).term })); }
    expect(() => step(ctx, { undo: true })).toThrow(/nothing to undo/);
  });
});

describe('engine — recheck task choice (ruling 2026-09-23: typed is the sign-off)', () => {
  const taskFor = (word, id = 'gawi') => {
    const status = emptyStatusV3();
    status.words[id] = { ...emptyWordV3(), state: 'mastered', dueDay: D, introducedDay: '2026-09-01', ...word };
    return currentItem(start(status)).task;
  };
  const ready = { recognizedCount: 2, matched: true };
  it('recognition rechecks alternate 2.2 and 3.1 per word, at any stage, until the sign-off is due', () => {
    const tasks = [0, 1, 2, 3].map((rechecks) => taskFor({ stage: 3, rechecks }));
    expect(tasks.every((task) => ['2.2', '3.1'].includes(task))).toBe(true);
    expect(tasks[1]).not.toBe(tasks[0]);
    expect(tasks[2]).toBe(tasks[0]);
  });
  it('the first recheck (stage 0) is recognition even when every other prerequisite is met', () => {
    expect(['2.2', '3.1']).toContain(taskFor({ stage: 0, ...ready }));
  });
  it('recognised twice, matched, stage >= 1: typed — 3.3, alternating with 1.4 dictation only when term audio exists', () => {
    expect(new Set([0, 1, 2, 3].map((rechecks) => taskFor({ stage: 1, rechecks, ...ready })))).toEqual(new Set(['3.3', '1.4']));
    expect([0, 1, 2, 3].map((rechecks) => taskFor({ stage: 2, rechecks, ...ready }, 'chaek'))).toEqual(['3.3', '3.3', '3.3', '3.3']);
  });
});

describe('engine — openDay', () => {
  it('records atOpen once and seeds shuffled rechecks', () => {
    const status = emptyStatusV3();
    status.words.gawi = { ...emptyWordV3(), state: 'mastered', stage: 1, dueDay: D, introducedDay: '2026-09-10' };
    const ctx = start(status);
    expect(ctx.status.decksSeen).toEqual(['deck']);
    expect(ctx.dayFile.atOpen).toMatchObject({ dueRechecks: ['gawi'], tricky: [], newAllowance: 4 });
    expect(ctx.dayFile.rounds).toEqual([]);
    const again = openDay({ status: ctx.status, dayFile: ctx.dayFile, day: D, deckId: 'deck', pool, settings: SET, learnerId: 'test-learner', at: at() });
    expect(again.status.decksSeen).toEqual(['deck']);
    expect(again.dayFile.atOpen).toEqual(ctx.dayFile.atOpen);
  });

  it('an untouched first round is re-planned when the day is re-opened with the real pool', () => {
    const status = emptyStatusV3();
    status.words.chaek = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-20' };
    const first = openDay({ status, dayFile: emptyDay(D), day: D, deckId: 'deck', pool: [], settings: SET, learnerId: 'test-learner', at: at() });
    expect(first.dayFile.rounds).toHaveLength(1);
    expect(first.dayFile.rounds[0]).toMatchObject({ kind: 'carry', words: ['chaek'] });
    const second = openDay({ ...first, day: D, deckId: 'deck', pool: ['gawi', 'pul'], settings: SET, learnerId: 'test-learner', at: at() });
    expect(second.dayFile.rounds).toHaveLength(1);
    expect(second.dayFile.rounds[0]).toMatchObject({ id: 'r1', kind: 'new', newWords: ['gawi', 'pul'], words: ['gawi', 'pul', 'chaek'] });
  });

  it('a started round is never re-planned', () => {
    let ctx = start();
    ({ ctx } = step(ctx, { seen: true }));
    const reopened = openDay({ status: ctx.status, dayFile: ctx.dayFile, day: D, deckId: 'deck', pool: ['pul'], settings: SET, learnerId: 'test-learner', at: at() });
    expect(reopened.dayFile.rounds).toEqual(ctx.dayFile.rounds);
  });
});

function introAll(ctx) {
  for (let i = 0; i < 3; i += 1) {
    ({ ctx } = step(ctx, { seen: true }));
    const c = currentItem(ctx);
    ({ ctx } = step(ctx, { typed: lexicon.entries.get(c.wordId).term }));
  }
  return ctx;
}
function toFirstQuizItem(ctx) {
  ctx = introAll(ctx);
  ({ ctx } = step(ctx, { quizNow: true }));
  return ctx;
}

describe('engine — Quiz me before sorting', () => {
  it('quizNow straight after the introductions quizzes every round word', () => {
    const ctx = toFirstQuizItem(start());
    const round = ctx.dayFile.rounds.at(-1);
    expect(round.phase).toBe('quiz');
    expect(new Set(round.quiz.queue.map((t) => t.wordId))).toEqual(new Set(pool));
    expect(round.quiz.queue).toHaveLength(pool.length * 2);
  });

  it('quizNow still excludes a word that failed verify today', () => {
    let ctx = introAll(start());
    ctx = { ...ctx, status: { ...ctx.status, words: { ...ctx.status.words, pul: { ...ctx.status.words.pul, verifyFailedDay: D } } } };
    ({ ctx } = step(ctx, { quizNow: true }));
    const words = new Set(ctx.dayFile.rounds.at(-1).quiz.queue.map((t) => t.wordId));
    expect(words.has('pul')).toBe(false);
    expect(words.size).toBe(2);
  });
});

describe('engine — responses must fit the item', () => {
  const tryOn = (ctx, response, verdict = null) => () => respond(ctx, currentItem(ctx).id, response, { at: at(), verdict });

  it('intro flashcard requires seen:true', () => {
    const ctx = start();
    expect(tryOn(ctx, {})).toThrow('response does not fit this item');
    expect(tryOn(ctx, { seen: false })).toThrow('response does not fit this item');
    expect(tryOn(ctx, { sort: 'claimed' })).toThrow('response does not fit this item');
    expect(tryOn(ctx, { undo: true })).toThrow('nothing to undo');
  });

  it('copy requires a string typed', () => {
    let ctx = start();
    ({ ctx } = step(ctx, { seen: true }));
    expect(tryOn(ctx, { typed: 5 })).toThrow('response does not fit this item');
    expect(tryOn(ctx, { seen: true })).toThrow('response does not fit this item');
  });

  it('stream flashcard accepts only a valid sort, undo or quizNow', () => {
    const ctx = introAll(start());
    expect(tryOn(ctx, { sort: 'maybe' })).toThrow('response does not fit this item');
    expect(tryOn(ctx, { seen: true })).toThrow('response does not fit this item');
    expect(tryOn(ctx, { sort: 'claimed', quizNow: true })).toThrow('response does not fit this item');
    expect(tryOn(ctx, { choice: 'Glue' })).toThrow('response does not fit this item');
    expect(tryOn(ctx, { sort: 'familiar' })).not.toThrow();
  });

  it('typed accepts only a string typed; undo on a graded item is nothing to undo', () => {
    const status = emptyStatusV3();
    status.words.chaek = { ...emptyWordV3(), state: 'mastered', stage: 1, dueDay: D, introducedDay: '2026-09-01', recognizedCount: 2, matched: true };
    const ctx = start(status);
    expect(currentItem(ctx)).toMatchObject({ type: 'typed', source: 'recheck' });
    expect(tryOn(ctx, { choice: 'Glue' }, PASS)).toThrow('response does not fit this item');
    expect(tryOn(ctx, { dontKnow: true }, PASS)).toThrow('response does not fit this item');
    expect(tryOn(ctx, {}, PASS)).toThrow('response does not fit this item');
    expect(tryOn(ctx, { undo: true }, PASS)).toThrow('nothing to undo');
    expect(tryOn(ctx, { typed: 'x' }, PASS)).not.toThrow();
  });

  it('choice accepts only choice or dontKnow', () => {
    const ctx = toFirstQuizItem(start());
    expect(currentItem(ctx).type).toBe('choice');
    expect(tryOn(ctx, { typed: 'x' })).toThrow('response does not fit this item');
    expect(tryOn(ctx, { sort: 'claimed' })).toThrow('response does not fit this item');
    expect(tryOn(ctx, { undo: true })).toThrow('nothing to undo');
    expect(tryOn(ctx, { dontKnow: true })).not.toThrow();
  });

  it('respond requires at', () => {
    const ctx = start();
    const { id } = currentItem(ctx);
    expect(() => respond(ctx, id, { seen: true }, {})).toThrow('at is required');
    expect(() => respond(ctx, id, { seen: true }, { at: '' })).toThrow('at is required');
    expect(() => respond(ctx, id, { seen: true })).toThrow('at is required');
  });
});

describe('engine — cap-done', () => {
  const CAP = SET.session.capMinutes * 60000;
  const dueStatus = () => {
    const status = emptyStatusV3();
    status.words.gawi = { ...emptyWordV3(), state: 'mastered', stage: 1, dueDay: D, introducedDay: '2026-09-10' };
    return status;
  };
  it('the cap with no round in progress is done even with a recheck pending', () => {
    expect(start(dueStatus()).dayFile.doneAt).toBeNull();
    const openedAt = at();
    const capped = openDay({ status: dueStatus(), dayFile: { ...emptyDay(D), activeMs: CAP }, day: D, deckId: 'deck', pool, settings: SET, learnerId: 'test-learner', at: openedAt });
    expect(currentItem({ ...capped, day: D, lexicon, media, pool, settings: SET, learnerId: 'test-learner' })).toMatchObject({ id: 'rc:gawi', source: 'recheck' });
    expect(capped.dayFile.doneAt).toBe(openedAt);
  });
  it('the cap does not end a round in progress', () => {
    let ctx = start();
    ctx = { ...ctx, dayFile: { ...ctx.dayFile, activeMs: CAP } };
    ({ ctx } = step(ctx, { seen: true }));
    expect(ctx.dayFile.doneAt).toBeNull();
  });
});

describe('engine — a day with nothing to do', () => {
  it('is credited at open when every word is mastered and none is due', () => {
    const status = emptyStatusV3();
    for (const id of pool) status.words[id] = { ...emptyWordV3(), state: 'mastered', stage: 2, dueDay: '2026-10-01', introducedDay: '2026-09-01' };
    const openedAt = at();
    const opened = openDay({ status, dayFile: emptyDay(D), day: D, deckId: 'deck', pool, settings: SET, learnerId: 'test-learner', at: openedAt });
    expect(opened.dayFile.rounds).toEqual([]);
    expect(opened.dayFile.doneAt).toBe(openedAt);
    const again = openDay({ ...opened, day: D, deckId: 'deck', pool, settings: SET, learnerId: 'test-learner', at: at() });
    expect(again.dayFile.doneAt).toBe(openedAt);
  });
  it('requires at', () => {
    expect(() => openDay({ status: emptyStatusV3(), dayFile: emptyDay(D), day: D, deckId: 'deck', pool, settings: SET, learnerId: 'test-learner' })).toThrow('at is required');
  });
});

describe('engine — drill', () => {
  const trickyStatus = () => {
    const s = emptyStatusV3();
    s.words.gawi = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-10', tricky: true, trickySince: '2026-09-20', missStreak: 2 };
    return s;
  };
  // Dictation and type-from-cue are in a drill only for a word ready for its
  // typed sign-off (recognised twice, matched) — a tricky one here.
  const readyTrickyStatus = () => {
    const s = emptyStatusV3();
    s.words.gawi = { ...emptyWordV3(), state: 'mastered', stage: 2, dueDay: '2026-12-01', introducedDay: '2026-09-10', recognizedCount: 2, matched: true, tricky: true, trickySince: '2026-09-20' };
    return s;
  };
  const drillAnswer = (it) => (it.step === 'copy' || it.step === 'dictation' || it.step === 'type' ? { typed: lexicon.entries.get(it.wordId).term }
    : it.step === 'tiles' ? { tiles: [...lexicon.entries.get(it.wordId).term] } : { done: true });
  function finishDrills(c) {
    let guard = 0;
    while (currentItem(c).type === 'drill' && guard++ < 40) ({ ctx: c } = step(c, drillAnswer(currentItem(c))));
    return c;
  }

  it('a tricky word is drilled before rounds, skipping mic steps without a mic', () => {
    const ctx0 = start(trickyStatus());
    const item = currentItem(ctx0);
    expect(item).toMatchObject({ type: 'drill', step: 'look', wordId: 'gawi' });
    expect(ctx0.dayFile.drills[0].steps).not.toContain('say-after');
    expect(ctx0.dayFile.capabilities).toEqual({ microphone: false });
    expect(ctx0.dayFile.rounds).toEqual([]);
  });
  it('with a mic the drill keeps the speaking steps; the latest device wins', () => {
    const ctx = start(trickyStatus(), { capabilities: { microphone: true } });
    expect(ctx.dayFile.drills[0].steps).toContain('say-after');
    const again = openDay({ status: ctx.status, dayFile: ctx.dayFile, day: D, deckId: 'deck', pool, settings: SET, learnerId: 'test-learner', at: at(), media, capabilities: {} });
    expect(again.dayFile.capabilities).toEqual({ microphone: false });
  });
  it('drill never changes word state; copy must match to advance', () => {
    let ctx = start(trickyStatus());
    const before = structuredClone(ctx.status.words.gawi);
    ({ ctx } = step(ctx, { done: true }));
    const copyItem = currentItem(ctx);
    const { ctx: stay, result } = step(ctx, { typed: '가이' });
    expect(result.correct).toBe(false);
    expect(currentItem(stay)).toMatchObject({ step: 'copy' });
    expect(stay.dayFile.items[copyItem.id]).toBeUndefined();
    let c = stay;
    let guard = 0;
    while (currentItem(c).type === 'drill' && guard++ < 20) {
      const it = currentItem(c);
      const r = it.step === 'copy' || it.step === 'dictation' || it.step === 'type' ? { typed: '가위' }
        : it.step === 'tiles' ? { tiles: ['가', '위'] } : { done: true };
      ({ ctx: c } = step(c, r));
    }
    expect(c.status.words.gawi).toEqual(before);
    expect(c.dayFile.drills[0].done).toBe(true);
    expect(currentItem(c)).toMatchObject({ type: 'flashcard', mode: 'intro' });
  });
  it('a dictation miss never carries the answer (the term is what is being recalled); a copy miss may', () => {
    let ctx = start(readyTrickyStatus());
    let guard = 0;
    while (currentItem(ctx).step !== 'copy' && guard++ < 20) ({ ctx } = step(ctx, drillAnswer(currentItem(ctx))));
    let r;
    ({ ctx, result: r } = step(ctx, { typed: '가이' }));
    expect(r).toEqual({ correct: false, answer: '가위' });
    guard = 0;
    while (currentItem(ctx).step !== 'dictation' && guard++ < 20) ({ ctx } = step(ctx, drillAnswer(currentItem(ctx))));
    expect(currentItem(ctx).step).toBe('dictation');
    const dictationId = currentItem(ctx).id;
    ({ ctx, result: r } = step(ctx, { typed: '가이' }));
    expect(r).toEqual({ correct: false });
    expect(currentItem(ctx).id).toBe(dictationId);
    ({ ctx, result: r } = step(ctx, { typed: '가위' }));
    expect(r).toMatchObject({ correct: true });
  });
  it('dictation: miss 1 hides the answer, miss 2 reveals it, the 3rd try advances regardless (stored)', () => {
    let ctx = start(readyTrickyStatus());
    let guard = 0;
    while (currentItem(ctx).step !== 'dictation' && guard++ < 20) ({ ctx } = step(ctx, drillAnswer(currentItem(ctx))));
    const dictation = currentItem(ctx);
    let r;
    ({ ctx, result: r } = step(ctx, { typed: '가이' }));
    expect(r).toEqual({ correct: false });
    expect(currentItem(ctx).id).toBe(dictation.id);
    ({ ctx, result: r } = step(ctx, { typed: '가이' }));
    expect(r).toEqual({ correct: false, answer: '가위' });
    expect(currentItem(ctx).id).toBe(dictation.id);
    expect(ctx.dayFile.items[dictation.id]).toBeUndefined();
    ({ ctx, result: r } = step(ctx, { typed: '가이' }));
    expect(r).toEqual({ correct: false, answer: '가위' });
    expect(currentItem(ctx).id).not.toBe(dictation.id);
    expect(ctx.dayFile.items[dictation.id]).toBeDefined();
  });
  it('dictation: a correct answer after a miss advances, and the next step starts with fresh tries', () => {
    let ctx = start(readyTrickyStatus());
    let guard = 0;
    while (currentItem(ctx).step !== 'dictation' && guard++ < 20) ({ ctx } = step(ctx, drillAnswer(currentItem(ctx))));
    const dictation = currentItem(ctx);
    let r;
    ({ ctx } = step(ctx, { typed: '가이' }));
    ({ ctx, result: r } = step(ctx, { typed: '가위' }));
    expect(r).toEqual({ correct: true, answer: '가위' });
    expect(currentItem(ctx).id).not.toBe(dictation.id);
    expect(ctx.dayFile.drills[0].tries).toBe(0);
  });
  it('tiles: wrong stays, the answer is revealed after the 2nd miss, the 3rd try advances regardless', () => {
    let ctx = start(trickyStatus());
    let guard = 0;
    while (currentItem(ctx).step !== 'tiles' && guard++ < 20) ({ ctx } = step(ctx, drillAnswer(currentItem(ctx))));
    const tilesItem = currentItem(ctx);
    expect(tilesItem.tiles).toEqual(expect.arrayContaining(['가', '위']));
    let r;
    ({ ctx, result: r } = step(ctx, { tiles: ['위', '가'] }));
    expect(r).toMatchObject({ correct: false, answer: null });
    ({ ctx, result: r } = step(ctx, { tiles: ['위', '가'] }));
    expect(r).toMatchObject({ correct: false, answer: '가위' });
    expect(currentItem(ctx).id).toBe(tilesItem.id);
    ({ ctx, result: r } = step(ctx, { tiles: ['위'] }));
    expect(r.correct).toBe(false);
    expect(currentItem(ctx).id).not.toBe(tilesItem.id);
  });
  it('a match step carries a board with the drill word', () => {
    const s = trickyStatus();
    s.words.pul = { ...emptyWordV3(), state: 'mastered', stage: 2, dueDay: '2026-10-30', introducedDay: '2026-09-01' };
    let ctx = start(s);
    expect(ctx.dayFile.drills[0].steps).toContain('match');
    let guard = 0;
    while (currentItem(ctx).step !== 'match' && guard++ < 20) ({ ctx } = step(ctx, drillAnswer(currentItem(ctx))));
    expect(currentItem(ctx).board.pairs.map((p) => p.wordId)).toContain('gawi');
  });
  it('no match step when the board would have fewer than 2 pairs', () => {
    expect(start(trickyStatus()).dayFile.drills[0].steps).not.toContain('match');
  });
  it('a tricky word missing from the lexicon is never drilled', () => {
    const s = trickyStatus();
    s.words.ghost = { ...s.words.gawi, trickySince: '2026-09-01' };
    const ctx = start(s);
    expect(ctx.dayFile.drills.map((d) => d.wordId)).toEqual(['gawi']);
    const withLexicon = openDay({ status: s, dayFile: emptyDay(D), day: D, deckId: 'deck', pool, settings: SET, learnerId: 'test-learner', at: at(), media: {}, lexicon });
    expect(withLexicon.dayFile.drills.map((d) => d.wordId)).toEqual(['gawi']);
  });
  it('an open drill whose word has left the lexicon counts as done — no crash', () => {
    const ctx = start(trickyStatus());
    expect(currentItem(ctx)).toMatchObject({ type: 'drill', wordId: 'gawi' });
    const without = new Map(lexicon.entries); without.delete('gawi');
    const gone = { ...ctx, lexicon: { entries: without } };
    const item = currentItem(gone);
    expect(item.type).not.toBe('drill');
    expect(() => respond(gone, item.id, item.type === 'flashcard' ? { seen: true } : {}, { at: at() })).not.toThrow(TypeError);
  });
  it('the tricky drill is skipped when its estimate does not fit', () => {
    const tight = { ...emptyDay(D), activeMs: SET.session.capMinutes * 60000 - 200000 };
    const ctx = start(trickyStatus(), { dayFile: tight });
    expect(ctx.dayFile.drills).toEqual([]);
  });
  it('the goal waits for the tricky drill', () => {
    const s = trickyStatus();
    for (const id of ['pul', 'chaek']) s.words[id] = { ...emptyWordV3(), state: 'mastered', stage: 2, dueDay: '2026-10-30', introducedDay: '2026-09-01' };
    s.words.gawi.state = 'mastered';
    s.words.gawi.dueDay = '2026-10-30';
    let ctx = start(s);
    expect(ctx.dayFile.doneAt).toBeNull();
    ctx = finishDrills(ctx);
    expect(ctx.dayFile.doneAt).toEqual(expect.any(String));
    expect(currentItem(ctx).type).toBe('summary');
  });
  it('rejects responses that do not fit a drill step', () => {
    const ctx = start(trickyStatus());
    expect(() => step(ctx, { typed: '가위' })).toThrow('response does not fit this item');
    expect(() => step(ctx, { done: false })).toThrow('response does not fit this item');
  });

  function toOffer(ctx) {
    let guard = 0;
    while (currentItem(ctx).type !== 'drill-offer' && currentItem(ctx).type !== 'summary' && guard++ < 80) {
      const item = currentItem(ctx);
      if (item.type === 'flashcard' && item.mode === 'intro') ({ ctx } = step(ctx, { seen: true }));
      else if (item.type === 'copy') ({ ctx } = step(ctx, { typed: lexicon.entries.get(item.wordId).term }));
      else if (item.type === 'say') ({ ctx } = step(ctx, { done: true }));
      else if (item.type === 'flashcard') ({ ctx } = step(ctx, { sort: item.wordId === 'pul' ? 'notYet' : 'claimed' }));
      else if (item.type === 'match') ({ ctx } = step(ctx, { done: true }));
      else ({ ctx } = step(ctx, right(item)));
    }
    return ctx;
  }
  it('round end offers one drill for the chronic Not-yet word', () => {
    let ctx = toOffer(start());
    expect(currentItem(ctx)).toMatchObject({ type: 'drill-offer', wordId: 'pul' });
    expect(() => step(ctx, { drill: 'maybe' })).toThrow('response does not fit this item');
    ({ ctx } = step(ctx, { drill: 'no' }));
    expect(currentItem(ctx).type).not.toBe('drill-offer');
    expect(ctx.status.words.pul.notYetCarry).toBe(true);
  });
  it('yes runs the offered drill, then the day goes on', () => {
    let ctx = toOffer(start());
    ({ ctx } = step(ctx, { drill: 'yes' }));
    expect(ctx.dayFile.drills).toEqual([expect.objectContaining({ source: 'offer', wordId: 'pul' })]);
    expect(currentItem(ctx)).toMatchObject({ type: 'drill', wordId: 'pul', step: 'look' });
    expect(ctx.dayFile.doneAt).toBeNull();
    ctx = finishDrills(ctx);
    expect(currentItem(ctx).type).toBe('summary');
    expect(ctx.dayFile.doneAt).toEqual(expect.any(String));
  });
  it('no offer when less than the drill estimate remains', () => {
    let ctx = start();
    ctx = { ...ctx, dayFile: { ...ctx.dayFile, activeMs: SET.session.capMinutes * 60000 - 200000 } };
    ctx = toOffer(ctx);
    expect(currentItem(ctx).type).toBe('summary');
  });
  it('with a mic and audio the intro adds say-after after copy', () => {
    let ctx = start(emptyStatusV3(), { capabilities: { microphone: true } });
    ({ ctx } = step(ctx, { seen: true }));
    ({ ctx } = step(ctx, { typed: '가위' }));
    expect(currentItem(ctx)).toEqual({ id: 'r1:i:gawi:say', type: 'say', mode: 'say-after', wordId: 'gawi' });
    ({ ctx } = step(ctx, { done: true }));
    expect(currentItem(ctx)).toMatchObject({ type: 'flashcard', mode: 'intro', wordId: 'pul' });
  });
  it('no say-after for a word without audio', () => {
    let ctx = start(emptyStatusV3(), { capabilities: { microphone: true } });
    for (const id of ['gawi', 'pul']) {
      ({ ctx } = step(ctx, { seen: true }));
      ({ ctx } = step(ctx, { typed: lexicon.entries.get(id).term }));
      ({ ctx } = step(ctx, { done: true }));
    }
    ({ ctx } = step(ctx, { seen: true }));
    ({ ctx } = step(ctx, { typed: '책' }));
    expect(currentItem(ctx)).toMatchObject({ type: 'flashcard', mode: 'stream' });
  });
});

describe('engine — practice', () => {
  function doneCtx({ microphone = false } = {}) {
    const ctx = start();
    return { ...ctx, dayFile: { ...ctx.dayFile, doneAt: 'x', rounds: [], rechecks: { order: [], answered: {} }, summarySeen: true, capabilities: { microphone } } };
  }
  const withWords = (ctx, words) => ({ ...ctx, status: { ...ctx.status, words: { ...ctx.status.words, ...words } } });
  const familiar = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-01' };
  function practise(ctx, opts) {
    const out = startPractice(ctx, opts);
    return { ...ctx, status: out.status, dayFile: out.dayFile };
  }

  it('menu appears after the goal; practice before it is refused', () => {
    expect(() => startPractice(start(), { mode: 'match' })).toThrow(/after today/);
    expect(currentItem(doneCtx())).toMatchObject({ type: 'menu' });
  });
  it('the summary shows once, then the menu', () => {
    let ctx = { ...doneCtx(), dayFile: { ...doneCtx().dayFile, summarySeen: false } };
    expect(currentItem(ctx)).toMatchObject({ id: 'summary', type: 'summary' });
    ({ ctx } = step(ctx, { done: true }));
    expect(ctx.dayFile.summarySeen).toBe(true);
    expect(currentItem(ctx)).toMatchObject({ id: 'menu', type: 'menu' });
  });
  it('the menu offers only modes whose default run is not empty', () => {
    // Say is offered without term audio: say-from-cue (Without help) needs none.
    const noAudio = withWords(doneCtx({ microphone: true }), { chaek: familiar });
    expect(currentItem(noAudio).modes).toEqual(['flashcards', 'say', 'write', 'drill', 'quiz']);
    expect(currentItem(noAudio).sayHelp).toEqual([false]);
    const all = withWords(doneCtx({ microphone: true }), { gawi: familiar, pul: familiar, chaek: familiar, mul: familiar });
    expect(currentItem(all).modes).toEqual(['flashcards', 'match', 'say', 'write', 'listen', 'drill', 'quiz']);
    expect(currentItem(all).sayHelp).toEqual([true, false]);
    const noMic = withWords(doneCtx(), { gawi: familiar });
    expect(currentItem(noMic).modes).toEqual(['flashcards', 'write', 'listen', 'drill', 'quiz']);
    expect(currentItem(noMic).sayHelp).toEqual([]);
    const nothingToQuiz = withWords(doneCtx(), { gawi: { ...emptyWordV3(), state: 'mastered', stage: 1, introducedDay: '2026-09-01' } });
    expect(currentItem(nothingToQuiz).modes).not.toContain('quiz');
  });
  it('startPractice refuses an empty run, an unknown filter and an unknown front side', () => {
    const ctx = withWords(doneCtx(), { gawi: familiar });
    expect(() => startPractice(ctx, { mode: 'match' })).toThrow('nothing to practise');
    expect(() => startPractice(ctx, { mode: 'say' })).toThrow('nothing to practise');
    expect(() => startPractice(ctx, { mode: 'flashcards', filter: 'everything' })).toThrow(/unknown practice filter/);
    expect(() => startPractice(ctx, { mode: 'flashcards', frontSide: 'back' })).toThrow(/unknown flashcard front side/);
    expect(startPractice(ctx, { mode: 'flashcards', frontSide: 'gloss' }).dayFile.practice.queue[0].front).toBe('gloss');
  });
  it('an unknown practice task kind is an invariant failure', () => {
    const ctx = practise(withWords(doneCtx(), { gawi: familiar }), { mode: 'flashcards' });
    ctx.dayFile.practice.queue[0].kind = 'juggle';
    expect(() => currentItem(ctx)).toThrow(/unknown practice task kind/);
  });
  it('the menu takes no responses; practice starts via startPractice', () => {
    expect(() => step(doneCtx(), { done: true })).toThrow('response does not fit this item');
    expect(() => startPractice(doneCtx(), { mode: 'nap' })).toThrow(/unknown practice mode/);
  });
  it('practice flashcards can lower a mastered word but not raise past claimed', () => {
    let ctx = doneCtx();
    ctx.status.words.gawi = { ...emptyWordV3(), state: 'mastered', stage: 2, introducedDay: '2026-09-01' };
    ctx.status.words.pul = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-01' };
    ({ status: ctx.status, dayFile: ctx.dayFile } = startPractice(ctx, { mode: 'flashcards', filter: 'introduced' }));
    for (let i = 0; i < 2; i += 1) {
      const it = currentItem(ctx);
      expect(it).toMatchObject({ type: 'flashcard', mode: 'practice', source: 'practice', front: 'term' });
      ({ ctx } = step(ctx, { sort: it.wordId === 'gawi' ? 'familiar' : 'claimed' }));
    }
    expect(ctx.status.words.gawi.state).toBe('familiar');
    expect(ctx.status.words.pul.state).toBe('claimed');
    expect(currentItem(ctx).type).toBe('menu');
    expect(ctx.dayFile.rounds).toEqual([]);
  });
  it('a Got it sort leaves a mastered word mastered; next skips', () => {
    let ctx = withWords(doneCtx(), { gawi: { ...emptyWordV3(), state: 'mastered', stage: 2, introducedDay: '2026-09-01' }, pul: familiar });
    ctx = practise(ctx, { mode: 'flashcards' });
    for (let i = 0; i < 2; i += 1) {
      const it = currentItem(ctx);
      ({ ctx } = step(ctx, it.wordId === 'gawi' ? { sort: 'claimed' } : { next: true }));
    }
    expect(ctx.status.words.gawi).toMatchObject({ state: 'mastered', stage: 2 });
    expect(ctx.status.words.pul.state).toBe('familiar');
  });
  it('practice quiz grades like verify', () => {
    let ctx = doneCtx();
    ctx.status.words.pul = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-01' };
    ({ status: ctx.status, dayFile: ctx.dayFile } = startPractice(ctx, { mode: 'quiz', filter: 'introduced' }));
    expect(currentItem(ctx)).toMatchObject({ type: 'choice', task: '3.1', source: 'practice', graded: true });
    ({ ctx } = step(ctx, { choice: '풀' }));
    ({ ctx } = step(ctx, { choice: 'Glue' }));
    expect(ctx.status.words.pul).toMatchObject({ state: 'mastered', stage: 0 });
    expect(ctx.dayFile.practice).toMatchObject({ passed: ['pul'], failed: [] });
  });
  it('practice quiz stops a word at its first miss', () => {
    let ctx = practise(withWords(doneCtx(), { pul: familiar }), { mode: 'quiz' });
    ({ ctx } = step(ctx, { dontKnow: true }));
    expect(ctx.status.words.pul).toMatchObject({ state: 'familiar', verifyFailedDay: D });
    expect(currentItem(ctx).type).toBe('menu');
  });
  it('write without help: typed practice needs a verdict and never grades', () => {
    const ready = { ...familiar, state: 'mastered', stage: 1, dueDay: '2026-12-01', recognizedCount: 2, matched: true };
    let ctx = practise(withWords(doneCtx(), { pul: ready }), { mode: 'write', help: false });
    const before = structuredClone(ctx.status.words.pul);
    expect(currentItem(ctx)).toMatchObject({ id: 'p1:0', type: 'typed', task: '3.3', source: 'practice', graded: false, wordId: 'pul' });
    expect(() => step(ctx, { typed: '풀' })).toThrow(/judge verdict/);
    let result;
    ({ ctx, result } = step(ctx, { typed: 'zz' }, { score: 2, judge: 'distance', pass: false }));
    expect(result).toMatchObject({ correct: false, answer: '풀' });
    expect(ctx.status.words.pul).toEqual(before);
    expect(currentItem(ctx).type).toBe('menu');
  });
  it('write with help: copy must match to advance', () => {
    let ctx = practise(withWords(doneCtx(), { pul: familiar }), { mode: 'write' });
    expect(currentItem(ctx)).toMatchObject({ type: 'copy', source: 'practice', wordId: 'pul' });
    ({ ctx } = step(ctx, { typed: '불' }));
    expect(currentItem(ctx).type).toBe('copy');
    ({ ctx } = step(ctx, { typed: '풀' }));
    expect(currentItem(ctx).type).toBe('menu');
  });
  it('match, listen and say items take done', () => {
    let ctx = practise(withWords(doneCtx({ microphone: true }), { gawi: familiar, pul: familiar, chaek: familiar, mul: familiar }), { mode: 'match' });
    expect(currentItem(ctx)).toMatchObject({ type: 'match', source: 'practice' });
    expect(currentItem(ctx).board.pairs).toHaveLength(4);
    ({ ctx } = step(ctx, { done: true }));
    expect(currentItem(ctx).type).toBe('menu');
    ctx = practise(withWords(ctx, { chaek: emptyWordV3(), mul: emptyWordV3() }), { mode: 'listen' });
    expect(currentItem(ctx)).toMatchObject({ id: 'p2:0', type: 'listen' });
    expect([...currentItem(ctx).wordIds].sort()).toEqual(['gawi', 'pul']);
    ({ ctx } = step(ctx, { done: true }));
    ctx = practise(ctx, { mode: 'say', help: false });
    expect(currentItem(ctx)).toMatchObject({ type: 'say', mode: 'say-from-cue', cue: expect.any(Object) });
    ({ ctx } = step(ctx, { done: true }));
    ({ ctx } = step(ctx, { done: true }));
    expect(currentItem(ctx).type).toBe('menu');
  });
  it('a practice drill walks the steps with p<run>:<index>:<step> ids', () => {
    let ctx = practise(withWords(doneCtx(), { pul: familiar }), { mode: 'drill', filter: 'chosen', chosen: ['pul'] });
    expect(currentItem(ctx)).toMatchObject({ id: 'p1:0:0', type: 'drill', step: 'look', source: 'practice', wordId: 'pul' });
    let guard = 0;
    while (currentItem(ctx).type === 'drill' && guard++ < 20) {
      const it = currentItem(ctx);
      ({ ctx } = step(ctx, TYPING_OR_TILES(it)));
    }
    expect(currentItem(ctx).type).toBe('menu');
    expect(ctx.status.words.pul).toEqual(familiar);
  });
  it('menu:true on any practice item ends the run', () => {
    let ctx = practise(withWords(doneCtx(), { gawi: familiar, pul: familiar }), { mode: 'flashcards' });
    ({ ctx } = step(ctx, { menu: true }));
    expect(currentItem(ctx).type).toBe('menu');
    expect(ctx.dayFile.practiceRuns).toBe(1);
  });
});

function TYPING_OR_TILES(it) {
  const term = lexicon.entries.get(it.wordId).term;
  if (['copy', 'dictation', 'type'].includes(it.step)) return { typed: term };
  if (it.step === 'tiles') return { tiles: [...term] };
  return { done: true };
}

describe('engine — transitions and graded records (plan 4, spec §8 events)', () => {
  function stepOut(ctx, response, verdict = null) {
    const item = currentItem(ctx);
    const out = respond(ctx, item.id, response, { at: at(), verdict });
    return { ctx: { ...ctx, status: out.status, dayFile: out.dayFile }, item, out };
  }
  function toStream(ctx) {
    let guard = 0;
    while (guard++ < 40) {
      const item = currentItem(ctx);
      if (item.type === 'flashcard' && item.mode === 'intro') ({ ctx } = stepOut(ctx, { seen: true }));
      else if (item.type === 'copy') ({ ctx } = stepOut(ctx, { typed: lexicon.entries.get(item.wordId).term }));
      else break;
    }
    return ctx;
  }

  it('wordTransitions diffs state and stage only', () => {
    const before = { a: { ...emptyWordV3(), state: 'introduced' }, b: { ...emptyWordV3(), state: 'familiar', missStreak: 0 } };
    const after = { a: { ...emptyWordV3(), state: 'notYet' }, b: { ...emptyWordV3(), state: 'familiar', missStreak: 1 }, c: { ...emptyWordV3(), state: 'introduced' } };
    expect(wordTransitions(before, after, 'sort')).toEqual([
      { wordId: 'a', from: { state: 'introduced', stage: null }, to: { state: 'notYet', stage: null }, source: 'sort' },
      { wordId: 'c', from: { state: 'new', stage: null }, to: { state: 'introduced', stage: null }, source: 'sort' },
    ]);
  });

  it('an intro flashcard is new → introduced (source intro); a copy transitions nothing and grades nothing', () => {
    let ctx = start();
    const intro = stepOut(ctx, { seen: true });
    expect(intro.out.transitions).toEqual([{ wordId: 'gawi', from: { state: 'new', stage: null }, to: { state: 'introduced', stage: null }, source: 'intro' }]);
    expect(intro.out.graded).toBeNull();
    const copy = stepOut(intro.ctx, { typed: '가위' });
    expect(copy.out.transitions).toEqual([]);
    expect(copy.out.graded).toBeNull();
  });

  it('a sort yields introduced → notYet (source sort); an undo reverses it', () => {
    let ctx = toStream(start());
    const { wordId } = currentItem(ctx);
    const sorted = stepOut(ctx, { sort: 'notYet' });
    expect(sorted.out.transitions).toEqual([{ wordId, from: { state: 'introduced', stage: null }, to: { state: 'notYet', stage: null }, source: 'sort' }]);
    expect(sorted.out.graded).toBeNull();
    const undone = stepOut(sorted.ctx, { undo: true });
    expect(undone.out.transitions).toEqual([{ wordId, from: { state: 'notYet', stage: null }, to: { state: 'introduced', stage: null }, source: 'sort' }]);
  });

  it('a plain sort (wordId, no task) still keeps its wordId in the day file — the trace day-file fallback needs it to show words for flashcards', () => {
    let ctx = toStream(start());
    const item = currentItem(ctx);
    const sorted = stepOut(ctx, { sort: 'notYet' });
    expect(sorted.ctx.dayFile.items[item.id]).toMatchObject({ wordId: item.wordId });
    expect(sorted.ctx.dayFile.items[item.id].task).toBeUndefined();
  });

  it('a verify pass yields claimed → mastered and a graded record per task', () => {
    let ctx = toStream(start());
    let guard = 0;
    while (currentItem(ctx).type === 'flashcard' && guard++ < 30) ({ ctx } = stepOut(ctx, { sort: 'claimed' }));
    const pick = currentItem(ctx);
    expect(pick).toMatchObject({ type: 'choice', task: '3.1', source: 'verify' });
    const first = stepOut(ctx, right(pick));
    expect(first.out.graded).toEqual({ wordId: pick.wordId, task: '3.1', source: 'verify', correct: true });
    expect(first.out.transitions).toEqual([]); // the word passes on its last task
    ctx = first.ctx;
    while (currentItem(ctx).task === '3.1') ({ ctx } = stepOut(ctx, right(currentItem(ctx))));
    const choice = currentItem(ctx);
    expect(choice).toMatchObject({ type: 'choice', task: '2.2', wordId: pick.wordId });
    const last = stepOut(ctx, { choice: lexicon.entries.get(choice.wordId).gloss });
    expect(last.out.graded).toEqual({ wordId: choice.wordId, task: '2.2', source: 'verify', correct: true });
    expect(last.out.transitions).toEqual([{ wordId: choice.wordId, from: { state: 'claimed', stage: null }, to: { state: 'mastered', stage: 0 }, source: 'verify' }]);
  });

  it('a recheck miss is graded (source recheck) and transitions mastered → familiar', () => {
    const status = emptyStatusV3();
    status.words.gawi = { ...emptyWordV3(), state: 'mastered', stage: 1, dueDay: D, introducedDay: '2026-09-10' };
    const ctx = start(status);
    const item = currentItem(ctx);
    expect(item.type).toBe('choice');
    const { out } = stepOut(ctx, { dontKnow: true });
    expect(out.graded).toMatchObject({ wordId: 'gawi', task: item.task, source: 'recheck', correct: false });
    expect(out.transitions).toEqual([{ wordId: 'gawi', from: { state: 'mastered', stage: 1 }, to: { state: 'familiar', stage: null }, source: 'recheck' }]);
  });

  it('practice: a Quiz me answer is graded (source practice); a practice sort transitions but is not graded; a replay reports nothing', () => {
    const base = start();
    const done = { ...base, dayFile: { ...base.dayFile, doneAt: 'x', rounds: [], rechecks: { order: [], answered: {} }, summarySeen: true } };
    done.status.words.pul = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-01' };
    let ctx = { ...done, ...startPractice(done, { mode: 'quiz' }) };
    const q = stepOut(ctx, { choice: '풀' });
    expect(q.out.graded).toEqual({ wordId: 'pul', task: '3.1', source: 'practice', correct: true });
    const q2 = stepOut(q.ctx, { choice: 'Glue' });
    expect(q2.out.transitions).toEqual([{ wordId: 'pul', from: { state: 'familiar', stage: null }, to: { state: 'mastered', stage: 0 }, source: 'practice' }]);
    const replay = respond(q2.ctx, q2.item.id, { choice: 'Glue' }, { at: at() });
    expect(replay.transitions).toEqual([]);
    expect(replay.graded).toBeNull();

    ctx = { ...q2.ctx, ...startPractice(q2.ctx, { mode: 'flashcards' }) };
    const sorted = stepOut(ctx, { sort: 'notYet' });
    expect(sorted.out.graded).toBeNull();
    expect(sorted.out.transitions).toEqual([{ wordId: 'pul', from: { state: 'mastered', stage: 0 }, to: { state: 'notYet', stage: null }, source: 'practice' }]);
  });

  it('write without help (type-practice) is never a graded record', () => {
    const base = start();
    const done = { ...base, dayFile: { ...base.dayFile, doneAt: 'x', rounds: [], rechecks: { order: [], answered: {} }, summarySeen: true } };
    done.status.words.pul = { ...emptyWordV3(), state: 'mastered', stage: 1, dueDay: '2026-12-01', introducedDay: '2026-09-01', recognizedCount: 2, matched: true };
    const ctx = { ...done, ...startPractice(done, { mode: 'write', help: false }) };
    const { out } = stepOut(ctx, { typed: '풀' }, PASS);
    expect(out.graded).toBeNull();
    expect(out.transitions).toEqual([]);
  });
});

describe('engine — graded item records (plan 4, grown-up controls)', () => {
  it('a typed answer\'s record keeps its word, task, source and the judge reason', () => {
    const status = emptyStatusV3();
    status.words.chaek = { ...emptyWordV3(), state: 'mastered', stage: 2, dueDay: D, introducedDay: '2026-09-10', recognizedCount: 2, matched: true };
    const ctx = start(status);
    const item = currentItem(ctx);
    expect(item).toMatchObject({ type: 'typed', task: '3.3', wordId: 'chaek' });
    const out = respond(ctx, item.id, { typed: '착' }, { at: at(), verdict: { score: 5, judge: 'model', reason: 'close', pass: false } });
    expect(out.dayFile.items[item.id]).toMatchObject({
      response: { typed: '착' }, wordId: 'chaek', task: '3.3', source: 'recheck', reason: 'close', result: { correct: false, score: 5, judge: 'model' },
    });
  });
});

describe('engine — copy steps compare under the target script', () => {
  it('a Latin copy is case-insensitive ("cat" copies "Cat")', () => {
    const latin = { targetScript: 'latin', entries: new Map([E('cat', 'Cat', 'a small pet'), E('dog', 'Dog', 'a loyal pet'), E('owl', 'Owl', 'a night bird')]) };
    const opened = openDay({ status: emptyStatusV3(), dayFile: emptyDay(D), day: D, deckId: 'deck', pool: ['cat', 'dog', 'owl'], settings: SET, learnerId: 'test-learner', at: at(), media: {} });
    let ctx = { ...opened, day: D, lexicon: latin, media: {}, pool: ['cat', 'dog', 'owl'], settings: SET, learnerId: 'test-learner' };
    ({ ctx } = step(ctx, { seen: true }));
    expect(currentItem(ctx)).toMatchObject({ type: 'copy', wordId: 'cat' });
    const { result } = step(ctx, { typed: 'cat' });
    expect(result).toMatchObject({ correct: true });
  });
});
