// backend/src/2_domains/school/wordLadder/engine.mjs
/**
 * The word ladder's day engine (spec §4). Pure reducer over { status, dayFile }:
 * `currentItem` derives what is on screen; `respond` applies one answer. All
 * sitting state lives in the day file, so reloads and idle-closed sittings
 * resume the same day. Plan 1 has no drill: tricky words are flagged only.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { hashString, seededShuffle } from './checkItem.mjs';
import { PILES, applyGraded, applySort, emptyWordV3, introduce, isDue } from './mastery.mjs';
import { channelFor, cueFor, pickMeaningChoices, pickTermChoices } from './choices.mjs';
import { newAllowance, planNextRound } from './rounds.mjs';
import { normalizeAnswer } from './jamo.mjs';

const IDLE_CAP_MS = 45000;
const NOT_YET_GAP = 2;
const FAMILIAR_GAP = 5;
const clone = (value) => structuredClone(value);
const wordOf = (status, id) => status.words[id] ?? emptyWordV3();
const gradedSettings = (settings) => ({ afterMisses: settings.drill.afterMisses, gapScale: settings.review.gapScale });

export function addActiveTime(dayFile, atMs) {
  const next = clone(dayFile);
  if (typeof next.lastInputAt === 'number') next.activeMs += Math.max(0, Math.min(atMs - next.lastInputAt, IDLE_CAP_MS));
  next.lastInputAt = atMs;
  return next;
}

export function openDay({ status, dayFile, day, deckId, pool, settings, learnerId }) {
  const nextStatus = clone(status);
  if (!nextStatus.decksSeen.includes(deckId)) nextStatus.decksSeen.push(deckId);
  const nextDay = clone(dayFile);
  if (!nextDay.atOpen) {
    const due = Object.entries(nextStatus.words).filter(([, word]) => isDue(word, day)).map(([id]) => id).sort();
    nextDay.atOpen = {
      dueRechecks: due,
      tricky: Object.entries(nextStatus.words).filter(([, word]) => word.tricky).map(([id]) => id).sort(),
      newAllowance: newAllowance({ words: nextStatus.words, day, settings }),
      settings: clone(settings),
    };
    nextDay.rechecks.order = seededShuffle(due, hashString(`${learnerId}|${day}|rechecks`));
  }
  // Rounds are planned eagerly so `currentItem` never has to create state. A
  // round nobody has touched yet is re-planned, so a re-open with a different
  // pool (the service opens once with an empty pool to record decksSeen, then
  // again with the real one) never leaves a stale plan behind.
  const last = nextDay.rounds.at(-1);
  if (last && last.phase !== 'done' && !roundTouched(nextDay, last)) nextDay.rounds.pop();
  const ctx = { status: nextStatus, dayFile: nextDay, day, pool, settings, learnerId };
  if (!nextDay.doneAt && !nextDay.rechecks.order.some((id) => !nextDay.rechecks.answered[id]) && !openRound(ctx)) {
    const upcoming = nextRound(ctx);
    if (upcoming) nextDay.rounds.push(upcoming);
  }
  return { status: nextStatus, dayFile: nextDay };
}

function roundTouched(dayFile, round) {
  const prefix = `${round.id}:`;
  return Object.keys(dayFile.items).some((id) => id.startsWith(prefix));
}

// Spec §2 Rechecks: below stage 2, 2.2 and 3.1 ALTERNATE (per word, starting
// side seeded by the word id) and every typedEvery-th recheck is 3.3.
function recheckTask(word, wordId, settings) {
  if ((word.stage ?? 0) >= 2) return '3.3';
  const n = (word.rechecks ?? 0) + 1;
  const every = settings.review.typedEvery;
  if (every > 0 && n % every === 0) return '3.3';
  const choiceIndex = n - (every > 0 ? Math.floor(n / every) : 0);
  return (choiceIndex + hashString(wordId)) % 2 === 0 ? '2.2' : '3.1';
}

function introducedSameKind(ctx, entry) {
  return Object.entries(ctx.status.words)
    .filter(([id, word]) => id !== entry.id && word.state !== 'new')
    .map(([id]) => ctx.lexicon.entries.get(id))
    .filter((other) => other && other.kind === entry.kind);
}

function gradedItem(ctx, id, wordId, task, source) {
  const entry = ctx.lexicon.entries.get(wordId);
  const media = ctx.media[wordId] ?? {};
  const seed = `${ctx.learnerId}|${ctx.day}|${id}`;
  if (task === '3.3') return { id, type: 'typed', task, source, wordId, cue: cueFor(entry, media, seed) };
  if (task === '3.1') {
    return { id, type: 'choice', task, source, wordId, cue: cueFor(entry, media, seed), choices: pickTermChoices(entry, introducedSameKind(ctx, entry), seed).choices };
  }
  return { id, type: 'choice', task: '2.2', source, wordId, channel: channelFor(media), choices: pickMeaningChoices(entry, seed).choices };
}

function answerFor(ctx, item) {
  const entry = ctx.lexicon.entries.get(item.wordId);
  if (item.task === '2.2') return pickMeaningChoices(entry, `${ctx.learnerId}|${ctx.day}|${item.id}`).answer;
  return entry.term;
}

function roundedToday(dayFile) {
  return new Set(dayFile.rounds.flatMap((round) => round.words));
}

function remainingMs(ctx) {
  return ctx.settings.session.capMinutes * 60000 - ctx.dayFile.activeMs;
}

function openRound(ctx) {
  const current = ctx.dayFile.rounds.at(-1);
  return current && current.phase !== 'done' ? current : null;
}

function nextRound(ctx) {
  if (remainingMs(ctx) <= 0) return null;
  const pool = ctx.pool.filter((id) => wordOf(ctx.status, id).state === 'new');
  const planned = planNextRound({
    words: ctx.status.words, pool, day: ctx.day, roundedToday: roundedToday(ctx.dayFile),
    settings: ctx.settings, remainingMs: remainingMs(ctx), roundNumber: ctx.dayFile.rounds.length + 1,
  });
  if (!planned) return null;
  return {
    ...planned,
    phase: planned.newWords.length ? 'intro' : 'stream',
    intro: { index: 0, step: 'flash' },
    stream: { queue: seededShuffle(planned.words, hashString(`${ctx.learnerId}|${ctx.day}|${planned.id}`)), latest: {}, views: 0, viewsPer: {}, undo: null },
    quiz: { queue: [], index: 0, failed: [], passed: [] },
  };
}

function itemForRound(ctx, round) {
  if (round.phase === 'intro') {
    const wordId = round.newWords[round.intro.index];
    return round.intro.step === 'flash'
      ? { id: `${round.id}:i:${wordId}:flash`, type: 'flashcard', mode: 'intro', wordId }
      : { id: `${round.id}:i:${wordId}:copy`, type: 'copy', wordId };
  }
  if (round.phase === 'stream') {
    return { id: `${round.id}:s:${round.stream.views}`, type: 'flashcard', mode: 'stream', wordId: round.stream.queue[0] };
  }
  const task = round.quiz.queue[round.quiz.index];
  return gradedItem(ctx, `${round.id}:q:${round.quiz.index}`, task.wordId, task.task, 'verify');
}

export function currentItem(ctx) {
  const pending = ctx.dayFile.rechecks.order.find((id) => !ctx.dayFile.rechecks.answered[id]);
  if (pending) return gradedItem(ctx, `rc:${pending}`, pending, recheckTask(wordOf(ctx.status, pending), pending, ctx.settings), 'recheck');
  const round = openRound(ctx);
  if (round) return itemForRound(ctx, round);
  return { id: 'summary', type: 'summary', quizzed: quizzedCount(ctx.dayFile), doneToday: true };
}

function quizzedCount(dayFile) {
  return dayFile.rounds.reduce((n, round) => n + round.quiz.passed.length + round.quiz.failed.length, 0);
}

// Spec §4 Done for today: goal met, or the day's cap reached with no round in
// progress. A pending recheck stays answerable (currentItem still offers it),
// but it no longer holds the day open once the cap has elapsed.
export function dayDone(ctx) {
  if (currentItem(ctx).type === 'summary') return true;
  return remainingMs(ctx) <= 0 && !openRound(ctx);
}

// `quizNow`: the child asked to be quizzed, so words not yet sorted this round
// are quizzed too. Words that failed verify today never are.
function startQuiz(ctx, round, { quizNow = false } = {}) {
  const eligible = round.words.filter((id) => {
    const word = wordOf(ctx.status, id);
    const pile = round.stream.latest[id];
    if (word.verifyFailedDay === ctx.day) return false;
    return pile === 'familiar' || pile === 'claimed' || word.notYetCarry === true || (quizNow && !pile);
  });
  round.quiz.queue = [...eligible.map((wordId) => ({ wordId, task: '3.3' })), ...eligible.map((wordId) => ({ wordId, task: '2.2' }))];
  round.phase = round.quiz.queue.length ? 'quiz' : 'done';
  if (round.phase === 'done') finishRound(ctx, round);
}

function finishRound(ctx, round) {
  round.phase = 'done';
  for (const id of round.words) {
    const quizzed = round.quiz.passed.includes(id) || round.quiz.failed.includes(id);
    if (!quizzed && round.stream.latest[id] === 'notYet') ctx.status.words[id] = { ...wordOf(ctx.status, id), notYetCarry: true };
  }
}

function endStreamIfDone(ctx, round) {
  const allSorted = round.words.every((id) => round.stream.latest[id]);
  const anyNotYet = round.words.some((id) => round.stream.latest[id] === 'notYet');
  if (round.stream.queue.length === 0 || (allSorted && !anyNotYet)) startQuiz(ctx, round);
}

function applyStreamSort(ctx, round, pile) {
  const wordId = round.stream.queue[0];
  round.stream.undo = { stream: clone({ ...round.stream, undo: null }), word: clone(wordOf(ctx.status, wordId)), wordId };
  ctx.status.words[wordId] = applySort(wordOf(ctx.status, wordId), pile, ctx.day);
  round.stream.latest[wordId] = pile;
  round.stream.views += 1;
  round.stream.viewsPer[wordId] = (round.stream.viewsPer[wordId] ?? 0) + 1;
  const queue = round.stream.queue.slice(1);
  const canReturn = round.stream.viewsPer[wordId] < ctx.settings.round.maxPasses;
  if (pile !== 'claimed' && canReturn) {
    const gap = pile === 'notYet' ? NOT_YET_GAP : FAMILIAR_GAP;
    queue.splice(Math.min(gap, queue.length), 0, wordId);
  }
  round.stream.queue = queue;
  endStreamIfDone(ctx, round);
}

function gradeQuizTask(ctx, round, task, correct) {
  const word = wordOf(ctx.status, task.wordId);
  const lastTaskOfWord = !round.quiz.queue.slice(round.quiz.index + 1).some((t) => t.wordId === task.wordId);
  if (!correct) {
    ctx.status.words[task.wordId] = applyGraded(word, { source: 'verify', correct: false, day: ctx.day, task: task.task, settings: gradedSettings(ctx.settings) });
    round.quiz.failed.push(task.wordId);
    round.quiz.queue = [...round.quiz.queue.slice(0, round.quiz.index + 1), ...round.quiz.queue.slice(round.quiz.index + 1).filter((t) => t.wordId !== task.wordId)];
  } else if (lastTaskOfWord) {
    ctx.status.words[task.wordId] = applyGraded(word, { source: 'verify', correct: true, day: ctx.day, task: task.task, settings: gradedSettings(ctx.settings) });
    round.quiz.passed.push(task.wordId);
  }
  round.quiz.index += 1;
  if (round.quiz.index >= round.quiz.queue.length) finishRound(ctx, round);
}

function gradedCorrect(ctx, item, response, verdict) {
  if (item.type === 'typed') {
    if (!verdict || typeof verdict.pass !== 'boolean') throw new ValidationError('typed answers need a judge verdict');
    return verdict.pass;
  }
  if (response.dontKnow === true) return false;
  if (!item.choices.includes(response.choice)) throw new ValidationError('choice is not one of the offered answers');
  return response.choice === answerFor(ctx, item);
}

const NOT_FIT = 'response does not fit this item';
const keysOf = (response) => Object.keys(response ?? {}).filter((key) => response[key] !== undefined);

function validateResponse(item, response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new ValidationError(NOT_FIT);
  const keys = keysOf(response);
  const isStream = item.type === 'flashcard' && item.mode === 'stream';
  if (!isStream && keys.includes('undo')) throw new ValidationError('nothing to undo');
  const only = (key) => keys.length === 1 && keys[0] === key;
  let fits = false;
  if (item.type === 'flashcard' && item.mode === 'intro') fits = only('seen') && response.seen === true;
  else if (isStream) {
    fits = (only('sort') && PILES.includes(response.sort)) || (only('undo') && response.undo === true)
      || (only('quizNow') && response.quizNow === true);
  } else if (item.type === 'choice') {
    fits = (only('choice') && typeof response.choice === 'string') || (only('dontKnow') && response.dontKnow === true);
  } else if (item.type === 'typed' || item.type === 'copy') fits = only('typed') && typeof response.typed === 'string';
  if (!fits) throw new ValidationError(NOT_FIT);
}

export function respond(inputCtx, itemId, response = {}, { at, verdict = null } = {}) {
  if (typeof at !== 'string' || at.length === 0) throw new ValidationError('at is required');
  if (inputCtx.dayFile.items[itemId]) return { status: inputCtx.status, dayFile: inputCtx.dayFile, result: inputCtx.dayFile.items[itemId].result };
  const ctx = { ...inputCtx, status: clone(inputCtx.status), dayFile: clone(inputCtx.dayFile) };
  const item = currentItem(ctx);
  if (item.id !== itemId) throw new ValidationError('stale item');
  validateResponse(item, response);
  let result = { ok: true };

  if (item.id.startsWith('rc:')) {
    const correct = gradedCorrect(ctx, item, response, verdict);
    ctx.status.words[item.wordId] = applyGraded(wordOf(ctx.status, item.wordId), { source: 'recheck', correct, day: ctx.day, task: item.task, settings: gradedSettings(ctx.settings) });
    ctx.dayFile.rechecks.answered[item.wordId] = { task: item.task, correct };
    result = { correct, answer: answerFor(ctx, item), ...(verdict ? { score: verdict.score, judge: verdict.judge } : {}) };
  } else {
    const round = openRound(ctx);
    if (!round) throw new ValidationError('stale item');
    if (item.type === 'flashcard' && item.mode === 'intro') {
      ctx.status.words[item.wordId] = introduce(wordOf(ctx.status, item.wordId), ctx.day);
      round.intro.step = 'copy';
    } else if (item.type === 'copy') {
      const correct = normalizeAnswer(response.typed) === normalizeAnswer(ctx.lexicon.entries.get(item.wordId).term);
      result = { correct, answer: ctx.lexicon.entries.get(item.wordId).term };
      if (!correct) return { status: ctx.status, dayFile: ctx.dayFile, result };
      round.intro = { index: round.intro.index + 1, step: 'flash' };
      if (round.intro.index >= round.newWords.length) round.phase = 'stream';
    } else if (item.type === 'flashcard') {
      if (response.undo === true) {
        if (!round.stream.undo) throw new ValidationError('nothing to undo');
        ctx.status.words[round.stream.undo.wordId] = round.stream.undo.word;
        round.stream = round.stream.undo.stream;
        // The restored card re-renders under the undone sort's item id; drop
        // that record so the child's next sort is applied, not replayed. The
        // undo itself is not stored (its id is no longer the current card).
        delete ctx.dayFile.items[`${round.id}:s:${round.stream.views}`];
        return { status: ctx.status, dayFile: ctx.dayFile, result: { undone: true } };
      }
      if (response.quizNow === true) startQuiz(ctx, round, { quizNow: true });
      else applyStreamSort(ctx, round, response.sort);
    } else {
      const correct = gradedCorrect(ctx, item, response, verdict);
      gradeQuizTask(ctx, round, round.quiz.queue[round.quiz.index], correct);
      result = { correct, answer: answerFor(ctx, item), ...(verdict ? { score: verdict.score, judge: verdict.judge } : {}) };
    }
  }
  ctx.dayFile.items[itemId] = { at, response, result };
  if (!openRound(ctx) && !ctx.dayFile.rechecks.order.some((id) => !ctx.dayFile.rechecks.answered[id])) {
    const upcoming = nextRound(ctx);
    if (upcoming) ctx.dayFile.rounds.push(upcoming);
    else ctx.dayFile.doneAt = ctx.dayFile.doneAt ?? at;
  }
  return { status: ctx.status, dayFile: ctx.dayFile, result };
}
