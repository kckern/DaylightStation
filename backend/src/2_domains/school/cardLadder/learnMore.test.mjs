// backend/src/2_domains/school/cardLadder/learnMore.test.mjs
/**
 * Learn more words (owner ruling 2026-09-23: "never block extra learning;
 * credit stays capped at the daily goal"). After — or during — the day's goal
 * a child can ask for one more guided round over the next new words. The
 * words climb the ladder for real; the day's credit never moves.
 */
import { describe, expect, it } from 'vitest';
import { emptyWordV3 } from './mastery.mjs';
import { emptyDay, emptyStatusV3 } from './statusV3.mjs';
import { currentItem, learnMore, openDay, respond } from './engine.mjs';
import { newAllowance } from './rounds.mjs';
import { dayStats } from './tuning.mjs';

const D = '2026-09-23';
const TOMORROW = '2026-09-24';
const SET = {
  round: { size: 5, maxPasses: 3 }, batch: { newPerDay: 4, workingSet: 7 },
  review: { gapScale: 1 }, drill: { afterMisses: 2, perSitting: 1 }, session: { capMinutes: 15 }, typing: { passScore: 6 },
};
const IDS = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10'];
const lexicon = {
  entries: new Map(IDS.map((id, i) => [id, { id, term: `t${i}`, gloss: `g${i}`, kind: 'word', decoys: { term: ['x1', 'x2', 'x3'], gloss: ['y1', 'y2', 'y3'] } }])),
};
const media = Object.fromEntries(IDS.map((id) => [id, { image: false, audio: false }]));
let clock = Date.parse(`${D}T16:00:00-07:00`);
const at = () => new Date((clock += 5000)).toISOString();
const CREDITED = `${D}T16:10:00-07:00`;

// The day's goal is met: w1..w4 met today in the guided day, credited, summary seen.
function doneCtx({ poolIds = IDS.slice(4), activeMs = 5 * 60000 } = {}) {
  const status = emptyStatusV3();
  for (const id of IDS.slice(0, 4)) status.words[id] = { ...emptyWordV3(), state: 'familiar', introducedDay: D };
  const dayFile = {
    ...emptyDay(D), atOpen: { dueRechecks: [], tricky: [], newAllowance: 4, settings: SET },
    rounds: [{ id: 'r1', kind: 'new', words: IDS.slice(0, 4), newWords: IDS.slice(0, 4), phase: 'done', quiz: { queue: [], index: 0, passed: [], failed: [] }, stream: { queue: [], latest: {}, views: 0, viewsPer: {} } }],
    doneAt: CREDITED, summarySeen: true, activeMs,
  };
  return { status, dayFile, day: D, lexicon, media, pool: poolIds, settings: SET, learnerId: 'kid' };
}

function step(ctx, response) {
  const item = currentItem(ctx);
  const out = respond(ctx, item.id, response, { at: at() });
  return { ...ctx, status: out.status, dayFile: out.dayFile };
}

// Walk the open round to its end: Learn › Sort › Quiz › Match.
function finishRound(ctx) {
  for (let i = 0; i < 80; i += 1) {
    const item = currentItem(ctx);
    if (item.type === 'menu' || item.type === 'summary') return ctx;
    const entry = item.wordId ? lexicon.entries.get(item.wordId) : null;
    let response = { done: true };
    if (item.type === 'flashcard' && item.mode === 'intro') response = { seen: true };
    else if (item.type === 'copy') response = { typed: entry.term };
    else if (item.type === 'flashcard') response = { sort: 'claimed' };
    else if (item.type === 'choice') response = { choice: item.task === '2.2' ? entry.gloss : entry.term };
    else if (item.type === 'drill-offer') response = { drill: 'no' };
    ctx = step(ctx, response);
  }
  throw new Error('round never ended');
}

describe('learn more words', () => {
  it('the menu offers Learn more while new words remain, and hides it when the pool is empty', () => {
    expect(currentItem(doneCtx())).toMatchObject({ type: 'menu', learnMore: 4 });
    expect(currentItem(doneCtx({ poolIds: [] }))).toMatchObject({ type: 'menu', learnMore: 0 });
    // A lone leftover word is still learnable on request.
    expect(currentItem(doneCtx({ poolIds: ['w5'] }))).toMatchObject({ type: 'menu', learnMore: 1 });
  });

  it('the Done summary offers it too', () => {
    const ctx = doneCtx();
    ctx.dayFile.summarySeen = false;
    expect(currentItem(ctx)).toMatchObject({ type: 'summary', learnMore: 4 });
  });

  it('introduces the next words in batch order, as one guided round of at most newPerDay', () => {
    const ctx = doneCtx();
    const out = learnMore(ctx, { at: at() });
    const round = out.dayFile.rounds.at(-1);
    expect(round).toMatchObject({ id: 'r2', kind: 'new', extra: true, phase: 'intro', newWords: ['w5', 'w6', 'w7', 'w8'] });
    expect(currentItem({ ...ctx, ...out })).toMatchObject({ type: 'flashcard', mode: 'intro', wordId: 'w5' });
    expect(out.dayFile.summarySeen).toBe(true);
  });

  it('refuses when the pool is empty or guided work is still open', () => {
    expect(() => learnMore(doneCtx({ poolIds: [] }), { at: at() })).toThrow(/no new words/);
    const ctx = doneCtx();
    const out = learnMore(ctx, { at: at() });
    expect(() => learnMore({ ...ctx, ...out }, { at: at() })).toThrow(/finish/);
  });

  it('the words climb for real; doneAt never moves and the day stays done', () => {
    let ctx = doneCtx();
    ctx = { ...ctx, ...learnMore(ctx, { at: at() }) };
    ctx = finishRound(ctx);
    expect(ctx.status.words.w5).toMatchObject({ state: 'mastered', introducedDay: D, introducedExtra: true, matched: true, recognizedCount: 1 });
    expect(ctx.dayFile.doneAt).toBe(CREDITED);
    expect(currentItem(ctx)).toMatchObject({ type: 'menu', learnMore: 2 });
    // And again, over what is left.
    ctx = { ...ctx, ...learnMore(ctx, { at: at() }) };
    expect(ctx.dayFile.rounds.at(-1).newWords).toEqual(['w9', 'w10']);
    ctx = finishRound(ctx);
    expect(ctx.dayFile.doneAt).toBe(CREDITED);
    expect(currentItem(ctx)).toMatchObject({ type: 'menu', learnMore: 0 });
  });

  it('past the session cap, Learn more is still offered and still runs', () => {
    let ctx = doneCtx({ activeMs: SET.session.capMinutes * 60000 + 60000 });
    expect(currentItem(ctx)).toMatchObject({ type: 'menu', learnMore: 4 });
    ctx = { ...ctx, ...learnMore(ctx, { at: at() }) };
    expect(currentItem(ctx)).toMatchObject({ type: 'flashcard', mode: 'intro', wordId: 'w5' });
    ctx = finishRound(ctx);
    expect(ctx.status.words.w8.state).toBe('mastered');
    expect(ctx.dayFile.doneAt).toBe(CREDITED);
  });

  it('extra words never consume tomorrow: its allowance is still newPerDay', () => {
    // The goal's words settled (mastered past stage 0): tomorrow is a full newPerDay.
    let ctx = doneCtx();
    for (const id of IDS.slice(0, 4)) ctx.status.words[id] = { ...ctx.status.words[id], state: 'mastered', stage: 1 };
    expect(newAllowance({ words: ctx.status.words, day: TOMORROW, settings: SET })).toBe(4);
    ctx = finishRound({ ...ctx, ...learnMore(ctx, { at: at() }) });
    // + 4 extra words, all unsettled: they must not fill the working set (7) and starve tomorrow.
    expect(newAllowance({ words: ctx.status.words, day: TOMORROW, settings: SET })).toBe(4);
    // Nor do they eat today's goal allowance (the goal counts only its own words).
    expect(newAllowance({ words: ctx.status.words, day: D, settings: SET })).toBe(0);
  });

  it('the day opens again next morning on a normal plan, extras carried as review', () => {
    let ctx = doneCtx();
    for (const id of IDS.slice(0, 4)) ctx.status.words[id] = { ...ctx.status.words[id], state: 'mastered', stage: 1, dueDay: '2026-10-30' };
    ctx = finishRound({ ...ctx, ...learnMore(ctx, { at: at() }) });
    const next = openDay({ status: ctx.status, dayFile: emptyDay(TOMORROW), day: TOMORROW, deckId: 'deck', pool: ['w9', 'w10'], settings: SET, learnerId: 'kid', at: at(), media });
    expect(next.dayFile.atOpen.newAllowance).toBe(4);
    expect(next.dayFile.doneAt).toBeNull();
  });

  it('extra learning before the goal leaves the goal intact', () => {
    // Mid-day, nothing open (a lone round finished, doneAt not yet set): the
    // goal's own allowance is unchanged by extra words.
    const ctx = doneCtx();
    ctx.dayFile.doneAt = null;
    ctx.dayFile.summarySeen = false;
    const out = learnMore(ctx, { at: at() });
    expect(out.dayFile.rounds.at(-1)).toMatchObject({ extra: true });
    expect(out.dayFile.doneAt).toBeNull();
  });

  it('the tuning digest counts extra words apart from the goal', () => {
    let ctx = doneCtx();
    ctx = finishRound({ ...ctx, ...learnMore(ctx, { at: at() }) });
    const stats = dayStats(ctx.dayFile, SET);
    expect(stats).toMatchObject({ newIntroduced: 0, extraIntroduced: 4, extraRounds: 1, credited: true });
    // The goal's quiz numbers leave the extra round out.
    expect(stats.quizzed).toBe(0);
  });
});

describe('learn more words — the cap in the digest', () => {
  it('time spent learning more after the credit never turns the goal into a cap hit', () => {
    const ctx = doneCtx({ activeMs: SET.session.capMinutes * 60000 + 120000 });
    ctx.dayFile.goalActiveMs = 5 * 60000;
    expect(dayStats(ctx.dayFile, SET)).toMatchObject({ capHit: false, reachedGoal: true });
  });
});
