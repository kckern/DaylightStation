// backend/src/2_domains/school/cardLadder/observe.test.mjs
/**
 * Sequencing observability (spec §8): every served item says WHY it was
 * chosen, and every change to the day's plan (a round planned, a phase moved,
 * a drill started, the goal met) comes out as data the service logs — so a
 * sitting can be evaluated from the logs alone.
 */
import { describe, expect, it } from 'vitest';
import { emptyWordV3 } from './mastery.mjs';
import { emptyDay, emptyStatusV3 } from './statusV3.mjs';
import { currentItem, openDay, respond, startPractice } from './engine.mjs';
import { dayChanges, prereqChanges, servedWhy, signOffGaps } from './observe.mjs';

const D = '2026-09-23';
const SET = {
  round: { size: 5, maxPasses: 3 }, batch: { newPerDay: 4, workingSet: 7 },
  review: { gapScale: 1 }, drill: { afterMisses: 2, perSitting: 1 }, session: { capMinutes: 15 }, typing: { passScore: 6 },
};
const E = (id, term, gloss) => [id, { id, term, gloss, kind: 'word', decoys: { term: ['x1', 'x2', 'x3'], gloss: ['g1', 'g2', 'g3'] } }];
const lexicon = { entries: new Map([E('gawi', '가위', 'Scissors'), E('pul', '풀', 'Glue'), E('chaek', '책', 'Book'), E('mul', '물', 'Water')]) };
const media = { gawi: { image: true, audio: true }, pul: { image: true, audio: true }, chaek: {}, mul: { audio: true } };
const pool = ['gawi', 'pul', 'chaek'];
const PASS = { score: 10, judge: 'exact', pass: true };
let clock = Date.parse(`${D}T16:00:00-07:00`);
const at = () => new Date((clock += 5000)).toISOString();

function start(status = emptyStatusV3(), { capabilities = null } = {}) {
  const opened = openDay({ status, dayFile: emptyDay(D), day: D, deckId: 'deck', pool, settings: SET, learnerId: 'test-learner', at: at(), media, capabilities, lexicon });
  return { ...opened, day: D, lexicon, media, pool, settings: SET, learnerId: 'test-learner' };
}
function step(ctx, response, verdict = null) {
  const item = currentItem(ctx);
  const out = respond(ctx, item.id, response, { at: at(), verdict });
  return { ctx: { ...ctx, status: out.status, dayFile: out.dayFile }, before: ctx, item };
}
const rightChoice = (item) => (item.task === '2.2' ? lexicon.entries.get(item.wordId).gloss : lexicon.entries.get(item.wordId).term);
function answerFor(item, { sort = 'claimed' } = {}) {
  if (item.type === 'flashcard' && item.mode === 'intro') return [{ seen: true }];
  if (item.type === 'copy') return [{ typed: lexicon.entries.get(item.wordId).term }];
  if (item.type === 'say' || item.type === 'match') return [{ done: true }];
  if (item.type === 'flashcard') return [{ sort }];
  if (item.type === 'choice') return [{ choice: rightChoice(item) }];
  if (item.type === 'typed') return [{ typed: lexicon.entries.get(item.wordId).term }, PASS];
  if (item.type === 'drill-offer') return [{ drill: 'no' }];
  throw new Error(`unexpected ${item.type}`);
}
/** Walks a fresh day; returns each served item with its reason, and every plan change. */
function walk(opts = {}) {
  let ctx = start(emptyStatusV3(), opts);
  const served = [];
  const changes = [];
  for (let guard = 0; guard < 200; guard += 1) {
    const item = currentItem(ctx);
    served.push({ id: item.id, type: item.type, ...servedWhy(ctx, item) });
    if (item.type === 'summary' || item.type === 'menu') break;
    const out = step(ctx, ...answerFor(item, opts));
    changes.push(...dayChanges(out.before.dayFile, out.ctx.dayFile).map((c) => ({ ...c, after: item.id })));
    ctx = out.ctx;
  }
  return { ctx, served, changes };
}

describe('servedWhy — why each item came up', () => {
  it('names the intro, stream, verify, match and summary reasons across a fresh day', () => {
    const { served } = walk();
    const reasonOf = (id) => served.find((s) => s.id === id)?.reason;
    expect(reasonOf('r1:i:gawi:flash')).toBe('intro');
    expect(served.find((s) => s.id === 'r1:i:gawi:flash').step).toBe('flash');
    expect(reasonOf('r1:i:gawi:copy')).toBe('intro');
    expect(reasonOf('r1:s:0')).toBe('stream');
    expect(served.filter((s) => s.type === 'choice').every((s) => s.reason === 'verify-recognition')).toBe(true);
    expect(reasonOf('r1:m')).toBe('match-after-verify');
    expect(reasonOf('summary')).toBe('summary');
  });

  it('a card coming back in the stream says which sort sent it back and which pass it is', () => {
    const { served } = walk({ sort: 'notYet' });
    const again = served.find((s) => s.reason === 'stream:again-after-notYet');
    expect(again).toBeTruthy();
    expect(again.pass).toBe(2);
  });

  it('a recheck says typed sign-off, or recognition with the unmet prerequisites', () => {
    const status = emptyStatusV3();
    status.words.gawi = { ...emptyWordV3(), state: 'mastered', stage: 0, dueDay: D, introducedDay: '2026-09-01', recognizedCount: 1 };
    const ctx = start(status);
    const item = currentItem(ctx);
    expect(item.id).toBe('rc:gawi');
    expect(servedWhy(ctx, item)).toMatchObject({ reason: 'recheck-recognition:recognized<2,unmatched,stage<1' });

    const ready = emptyStatusV3();
    ready.words.gawi = { ...emptyWordV3(), state: 'mastered', stage: 1, dueDay: D, introducedDay: '2026-09-01', recognizedCount: 2, matched: true };
    const ctx2 = start(ready);
    expect(servedWhy(ctx2, currentItem(ctx2)).reason).toBe('recheck-typed-signoff');
  });

  it('a carried word in the stream says carry', () => {
    const status = emptyStatusV3();
    status.words.gawi = { ...emptyWordV3(), state: 'notYet', introducedDay: '2026-09-20' };
    status.words.pul = { ...emptyWordV3(), state: 'familiar', introducedDay: '2026-09-20' };
    const ctx = start(status);
    const item = currentItem(ctx);
    expect(item.type).toBe('flashcard');
    expect(servedWhy(ctx, item).reason).toBe('carry');
  });

  it('a practice item names its mode; the menu says menu', () => {
    const { ctx } = walk();
    const summary = currentItem(ctx);
    const afterSummary = respond(ctx, summary.id, { done: true }, { at: at() });
    const menuCtx = { ...ctx, status: afterSummary.status, dayFile: afterSummary.dayFile };
    expect(servedWhy(menuCtx, currentItem(menuCtx)).reason).toBe('menu');
    const run = startPractice(menuCtx, { mode: 'flashcards' });
    const practiceCtx = { ...menuCtx, ...run };
    expect(servedWhy(practiceCtx, currentItem(practiceCtx)).reason).toBe('practice:flashcards');
  });
});

describe('signOffGaps — what stands between a word and its typed sign-off', () => {
  it('lists every unmet prerequisite, empty when ready', () => {
    expect(signOffGaps({ ...emptyWordV3(), state: 'claimed' })).toEqual(['not-mastered', 'recognized<2', 'unmatched', 'stage<1']);
    expect(signOffGaps({ ...emptyWordV3(), state: 'mastered', stage: 1, recognizedCount: 2, matched: true })).toEqual([]);
    expect(signOffGaps({
      ...emptyWordV3(), state: 'mastered', stage: 1, recognizedCount: 3, matched: true, lastGraded: { day: D, task: '3.3', correct: false },
    })).toEqual(['typed-lapse']);
  });
});

describe('dayChanges — plan changes as data', () => {
  it('logs the round plan at open, then quiz, match and done phases with their contents', () => {
    const opened = start();
    const planned = dayChanges(emptyDay(D), opened.dayFile);
    expect(planned.map((c) => c.event)).toEqual(['day.planned', 'round.planned']);
    expect(planned[1].data).toMatchObject({ round: 'r1', index: 1, kind: 'new', size: 3, newIds: pool, carryIds: [], hasMatch: true });

    const { changes } = walk();
    const phases = changes.filter((c) => c.event === 'round.phase').map((c) => `${c.data.from}>${c.data.to}`);
    expect(phases).toEqual(['intro>stream', 'stream>quiz', 'quiz>match', 'match>done']);
    const quiz = changes.find((c) => c.event === 'round.phase' && c.data.to === 'quiz');
    expect(quiz.data.queue).toContain('gawi:3.1');
    const match = changes.find((c) => c.event === 'round.phase' && c.data.to === 'match');
    expect(match.data.wordIds).toEqual(expect.arrayContaining(pool));
    const done = changes.find((c) => c.event === 'round.phase' && c.data.to === 'done');
    expect(done.data).toMatchObject({ passed: expect.arrayContaining(pool), failed: [] });
    expect(changes.some((c) => c.event === 'day.done')).toBe(true);
  });

  it('reports a started drill with its source and steps', () => {
    const before = emptyDay(D);
    const after = { ...emptyDay(D), drills: [{ id: 'd1', wordId: 'gawi', source: 'offer', steps: ['look', 'copy'], index: 0, done: false }] };
    expect(dayChanges(before, after)).toEqual([{ event: 'drill.started', data: { drillId: 'd1', wordId: 'gawi', source: 'offer', steps: ['look', 'copy'] } }]);
    const finished = { ...after, drills: [{ ...after.drills[0], index: 2, done: true }] };
    expect(dayChanges(after, finished)).toEqual([{ event: 'drill.finished', data: { drillId: 'd1', wordId: 'gawi', source: 'offer', excluded: false } }]);
  });
});

describe('prereqChanges — a word climbing the sign-off ladder', () => {
  it('reports recognizedCount / matched / typedSignedOff changes with the whole snapshot', () => {
    const before = { gawi: { ...emptyWordV3(), state: 'mastered', stage: 0, recognizedCount: 1 } };
    const after = { gawi: { ...before.gawi, matched: true } };
    expect(prereqChanges(before, after)).toEqual([{
      wordId: 'gawi', changed: ['matched'], recognizedCount: 1, matched: true, typedSignedOff: null, readyForSignOff: false, gaps: ['recognized<2', 'stage<1'],
    }]);
    expect(prereqChanges(after, after)).toEqual([]);
  });
});
