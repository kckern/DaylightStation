// backend/src/2_domains/school/wordLadder/engine.mjs
/**
 * The word ladder's day engine (spec §4). Pure reducer over { status, dayFile }:
 * `currentItem` derives what is on screen; `respond` applies one answer. All
 * sitting state lives in the day file, so reloads and idle-closed sittings
 * resume the same day. Drills (spec §3 drill path) walk one word from full
 * support to none and never change word state. Once the day is done, the
 * summary shows once and then the practice menu (spec §6); only a practice
 * Quiz me grades, exactly like a round's verify.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { hashString, seededShuffle } from './checkItem.mjs';
import { PILES, applyGraded, applySort, emptyWordV3, introduce, isDue } from './mastery.mjs';
import { channelFor, cueFor, pickMeaningChoices, pickTermChoices } from './choices.mjs';
import { newAllowance, planNextRound } from './rounds.mjs';
import { normalizeAnswer } from './jamo.mjs';
import { drillSteps, matchBoard, tilesFor } from './drill.mjs';
import { PRACTICE_MODES, buildPractice } from './practice.mjs';

const IDLE_CAP_MS = 45000;
const NOT_YET_GAP = 2;
const FAMILIAR_GAP = 5;
const DRILL_MS = 240000;
const TYPED_DRILL_STEPS = new Set(['copy', 'dictation']);
const TYPING_STEPS = new Set(['copy', 'dictation', 'type']);
const clone = (value) => structuredClone(value);
const wordOf = (status, id) => status.words[id] ?? emptyWordV3();
const gradedSettings = (settings) => ({ afterMisses: settings.drill.afterMisses, gapScale: settings.review.gapScale });

export function addActiveTime(dayFile, atMs) {
  const next = clone(dayFile);
  if (typeof next.lastInputAt === 'number') next.activeMs += Math.max(0, Math.min(atMs - next.lastInputAt, IDLE_CAP_MS));
  next.lastInputAt = atMs;
  return next;
}

export function openDay({ status, dayFile, day, deckId, pool, settings, learnerId, at, media = {}, capabilities = null }) {
  if (typeof at !== 'string' || at.length === 0) throw new ValidationError('at is required');
  const nextStatus = clone(status);
  if (!nextStatus.decksSeen.includes(deckId)) nextStatus.decksSeen.push(deckId);
  const nextDay = clone(dayFile);
  // Day files written before drills existed lack these; the latest device wins.
  nextDay.drills ??= [];
  nextDay.practice ??= null;
  nextDay.practiceRuns ??= 0;
  nextDay.summarySeen ??= false;
  nextDay.capabilities = { microphone: capabilities?.microphone === true };
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
  // pool (a deck assigned or edited since the last sitting) never leaves a
  // stale plan behind.
  const last = nextDay.rounds.at(-1);
  if (last && last.phase !== 'done' && !roundTouched(nextDay, last)) nextDay.rounds.pop();
  const ctx = { status: nextStatus, dayFile: nextDay, day, pool, settings, learnerId, media };
  // A day with nothing to do (everything mastered and not due, or the cap
  // already spent) is credited here — `respond` would never run to do it.
  if (!nextDay.doneAt) settleDay(ctx, at);
  return { status: nextStatus, dayFile: nextDay };
}

function hasPendingRecheck(dayFile) {
  return dayFile.rechecks.order.some((id) => !dayFile.rechecks.answered[id]);
}

// Spec §4 Done for today: goal met, or the day's cap reached with no round in
// progress. With no round or drill open and no recheck pending, the tricky
// drill starts if it fits, else the next round is planned; if neither can be,
// the goal is met. A pending recheck stays answerable (currentItem still
// offers it) but no longer holds the day open once the cap has elapsed. A done
// day plans nothing more (practice cannot reopen it). Mutates ctx.dayFile.
function settleDay(ctx, at) {
  if (ctx.dayFile.doneAt) return;
  if (openRound(ctx) || openDrill(ctx)) return;
  if (!hasPendingRecheck(ctx.dayFile)) {
    if (maybeStartTrickyDrill(ctx)) return;
    const upcoming = nextRound(ctx);
    if (upcoming) { ctx.dayFile.rounds.push(upcoming); return; }
  } else if (remainingMs(ctx) > 0) return;
  ctx.dayFile.doneAt = ctx.dayFile.doneAt ?? at;
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

function openDrill(ctx) {
  return (ctx.dayFile.drills ?? []).find((drill) => !drill.done) ?? null;
}

function newDrill(ctx, wordId, source) {
  const drills = ctx.dayFile.drills ?? (ctx.dayFile.drills = []);
  return {
    id: `d${drills.length + 1}`, source, wordId,
    steps: drillSteps(ctx.media?.[wordId] ?? {}, ctx.dayFile.capabilities ?? {}), index: 0, tries: 0, done: false,
  };
}

// Spec §4 Order 2: up to drill.perSitting tricky words per study day, oldest
// tricky first, from the at-open snapshot, only while the drill estimate fits.
function maybeStartTrickyDrill(ctx) {
  const drills = ctx.dayFile.drills ?? (ctx.dayFile.drills = []);
  const perDay = ctx.settings.drill?.perSitting ?? 1;
  if (drills.filter((drill) => drill.source === 'tricky').length >= perDay) return false;
  if (remainingMs(ctx) < DRILL_MS) return false;
  const since = (id) => String(wordOf(ctx.status, id).trickySince ?? '');
  const candidates = (ctx.dayFile.atOpen?.tricky ?? [])
    .filter((id) => wordOf(ctx.status, id).tricky && !drills.some((drill) => drill.wordId === id))
    .sort((a, b) => since(a).localeCompare(since(b)) || a.localeCompare(b));
  if (!candidates.length) return false;
  drills.push(newDrill(ctx, candidates[0], 'tricky'));
  return true;
}

function drillItem(ctx, drill, extra = {}) {
  const stepName = drill.steps[drill.index];
  const entry = ctx.lexicon.entries.get(drill.wordId);
  const seed = `${ctx.learnerId}|${ctx.day}|${drill.id}|${drill.index}`;
  const base = { id: `${drill.id}:${drill.index}`, type: 'drill', step: stepName, wordId: drill.wordId, of: drill.steps.length, at: drill.index + 1, ...extra };
  if (stepName === 'tiles') {
    const deckTerms = [...ctx.lexicon.entries.values()].filter((other) => other.id !== drill.wordId).map((other) => other.term);
    return { ...base, tiles: tilesFor(entry, deckTerms, seed) };
  }
  if (stepName === 'match') {
    const others = Object.entries(ctx.status.words)
      .filter(([id, word]) => id !== drill.wordId && word.state !== 'new')
      .map(([id]) => ctx.lexicon.entries.get(id)).filter(Boolean);
    const board = [entry, ...seededShuffle(others, hashString(`${seed}|others`)).slice(0, 3)];
    return { ...base, board: matchBoard(board, ctx.media ?? {}, seed) };
  }
  if (stepName === 'say-from-cue' || stepName === 'type') return { ...base, cue: cueFor(entry, ctx.media?.[drill.wordId] ?? {}, seed) };
  return base;
}

// Nothing here grades. copy / dictation advance only on an exact (normalized)
// match; tiles advance on a match or after the third try, revealing the answer
// after the second miss. Mutates `drill`.
function respondDrill(ctx, drill, response) {
  const stepName = drill.steps[drill.index];
  const term = ctx.lexicon.entries.get(drill.wordId).term;
  let result = { ok: true };
  if (TYPED_DRILL_STEPS.has(stepName)) {
    const correct = normalizeAnswer(response.typed) === normalizeAnswer(term);
    result = { correct, answer: term };
    if (!correct) return { result, advance: false };
  } else if (stepName === 'tiles') {
    const correct = normalizeAnswer(response.tiles.join('')) === normalizeAnswer(term);
    drill.tries = (drill.tries ?? 0) + 1;
    result = { correct, answer: correct || drill.tries >= 2 ? term : null };
    if (!correct && drill.tries < 3) return { result, advance: false };
  } else if (stepName === 'type') {
    result = { correct: normalizeAnswer(response.typed) === normalizeAnswer(term), answer: term };
  }
  drill.index += 1;
  drill.tries = 0;
  if (drill.index >= drill.steps.length) drill.done = true;
  return { result, advance: true };
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
    if (round.intro.step === 'flash') return { id: `${round.id}:i:${wordId}:flash`, type: 'flashcard', mode: 'intro', wordId };
    if (round.intro.step === 'say') return { id: `${round.id}:i:${wordId}:say`, type: 'say', mode: 'say-after', wordId };
    return { id: `${round.id}:i:${wordId}:copy`, type: 'copy', wordId };
  }
  if (round.phase === 'offer') return { id: `${round.id}:offer`, type: 'drill-offer', wordId: round.offer.wordId };
  if (round.phase === 'stream') {
    return { id: `${round.id}:s:${round.stream.views}`, type: 'flashcard', mode: 'stream', wordId: round.stream.queue[0] };
  }
  const task = round.quiz.queue[round.quiz.index];
  return gradedItem(ctx, `${round.id}:q:${round.quiz.index}`, task.wordId, task.task, 'verify');
}

export function currentItem(ctx) {
  const pending = ctx.dayFile.rechecks.order.find((id) => !ctx.dayFile.rechecks.answered[id]);
  if (pending) return gradedItem(ctx, `rc:${pending}`, pending, recheckTask(wordOf(ctx.status, pending), pending, ctx.settings), 'recheck');
  const drill = openDrill(ctx);
  if (drill) return drillItem(ctx, drill);
  const round = openRound(ctx);
  if (round) return itemForRound(ctx, round);
  if (!ctx.dayFile.doneAt || !ctx.dayFile.summarySeen) return { id: 'summary', type: 'summary', quizzed: quizzedCount(ctx.dayFile), doneToday: true };
  const run = openPractice(ctx);
  if (run) return practiceItem(ctx, run);
  return menuItem(ctx);
}

function openPractice(ctx) {
  const run = ctx.dayFile.practice;
  return run && run.index < run.queue.length ? run : null;
}

function menuItem(ctx) {
  const mic = ctx.dayFile.capabilities?.microphone === true;
  const heard = Object.entries(ctx.status.words).some(([id, word]) => word.state !== 'new' && ctx.media?.[id]?.audio === true);
  const modes = PRACTICE_MODES.filter((mode) => (mode !== 'say' || mic) && (mode !== 'listen' || heard));
  return { id: 'menu', type: 'menu', modes, quizzed: quizzedCount(ctx.dayFile) };
}

// Practice item ids are p<run>:<index>, and p<run>:<index>:<step> inside a drill.
function practiceItem(ctx, run) {
  const task = run.queue[run.index];
  const id = `${run.id}:${run.index}`;
  const source = 'practice';
  const cue = () => cueFor(ctx.lexicon.entries.get(task.wordId), ctx.media?.[task.wordId] ?? {}, `${ctx.learnerId}|${ctx.day}|${id}`);
  switch (task.kind) {
    case 'flashcard': return { id, type: 'flashcard', mode: 'practice', source, wordId: task.wordId, front: task.front };
    case 'match': return { id, type: 'match', source, board: task.board };
    case 'say-after': return { id, type: 'say', mode: 'say-after', source, wordId: task.wordId };
    case 'say-from-cue': return { id, type: 'say', mode: 'say-from-cue', source, wordId: task.wordId, cue: cue() };
    case 'copy': return { id, type: 'copy', source, wordId: task.wordId };
    case 'type-practice': return { id, type: 'typed', task: '3.3', source, graded: false, wordId: task.wordId, cue: cue() };
    case 'listen': return { id, type: 'listen', source, wordIds: task.wordIds };
    case 'drill': return drillItem(ctx, task.drill, { source });
    default: return { ...gradedItem(ctx, id, task.wordId, task.task, source), graded: true };
  }
}

/**
 * Opens a practice run (spec §6 practice menu) once the day is done. Replaces
 * any earlier run; starting one also passes the summary.
 */
export function startPractice(ctx, { mode, help = true, filter = 'introduced', chosen = [], frontSide = 'term' } = {}) {
  if (!ctx.dayFile.doneAt) throw new ValidationError("practice opens after today's goal");
  if (!PRACTICE_MODES.includes(mode)) throw new ValidationError(`unknown practice mode '${mode}'`);
  const dayFile = clone(ctx.dayFile);
  const runNumber = (dayFile.practiceRuns ?? 0) + 1;
  const id = `p${runNumber}`;
  const run = buildPractice({
    mode, help: help !== false, filter, chosen: Array.isArray(chosen) ? chosen : [], frontSide,
    words: ctx.status.words, entries: ctx.lexicon.entries, media: ctx.media ?? {}, day: ctx.day,
    seed: `${ctx.learnerId}|${ctx.day}|${id}`, capabilities: dayFile.capabilities ?? {},
  });
  run.queue = run.queue.map((task, index) => (task.kind === 'drill'
    ? { ...task, drill: { id: `${id}:${index}`, wordId: task.wordId, steps: task.steps, index: 0, tries: 0, done: false } }
    : task));
  dayFile.practice = { ...run, id };
  dayFile.practiceRuns = runNumber;
  dayFile.summarySeen = true;
  return { status: clone(ctx.status), dayFile };
}

function quizzedCount(dayFile) {
  return dayFile.rounds.reduce((n, round) => n + round.quiz.passed.length + round.quiz.failed.length, 0);
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
  if (round.phase === 'done') endRound(ctx, round);
}

// Spec §4 Drill offer: at most one per round, for the round's word whose latest
// sort is Not yet with the most Not-yet sorts, and only while the drill
// estimate still fits the day.
function offerFor(ctx, round) {
  if (round.offerSettled || remainingMs(ctx) < DRILL_MS) return null;
  const ranked = round.words
    .filter((id) => round.stream.latest[id] === 'notYet' && !round.quiz.passed.includes(id))
    .map((id) => [id, round.stream.notYetCount?.[id] ?? 1])
    .sort(([a, x], [b, y]) => (y - x) || a.localeCompare(b));
  return ranked[0]?.[0] ?? null;
}

function endRound(ctx, round) {
  const wordId = offerFor(ctx, round);
  if (!wordId) { finishRound(ctx, round); return; }
  round.phase = 'offer';
  round.offer = { wordId };
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
  if (pile === 'notYet') round.stream.notYetCount = { ...round.stream.notYetCount, [wordId]: (round.stream.notYetCount?.[wordId] ?? 0) + 1 };
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

// One verify task graded over a holder { queue, index, passed, failed } — a
// round's quiz or a practice Quiz me run. First-miss stop drops the word's
// remaining tasks; a word passes on its last task. Returns true when the
// holder's queue is exhausted.
function gradeVerifyTask(ctx, holder, task, correct) {
  const word = wordOf(ctx.status, task.wordId);
  const lastTaskOfWord = !holder.queue.slice(holder.index + 1).some((t) => t.wordId === task.wordId);
  if (!correct) {
    ctx.status.words[task.wordId] = applyGraded(word, { source: 'verify', correct: false, day: ctx.day, task: task.task, settings: gradedSettings(ctx.settings) });
    holder.failed.push(task.wordId);
    holder.queue = [...holder.queue.slice(0, holder.index + 1), ...holder.queue.slice(holder.index + 1).filter((t) => t.wordId !== task.wordId)];
  } else if (lastTaskOfWord) {
    ctx.status.words[task.wordId] = applyGraded(word, { source: 'verify', correct: true, day: ctx.day, task: task.task, settings: gradedSettings(ctx.settings) });
    holder.passed.push(task.wordId);
  }
  holder.index += 1;
  return holder.index >= holder.queue.length;
}

function gradeQuizTask(ctx, round, task, correct) {
  if (gradeVerifyTask(ctx, round.quiz, task, correct)) endRound(ctx, round);
}

function gradedResult(ctx, item, correct, verdict) {
  return { correct, answer: answerFor(ctx, item), ...(verdict ? { score: verdict.score, judge: verdict.judge } : {}) };
}

// Practice never grades except a Quiz me task (rule 1). Sorts obey rule 2 via
// applySort, so they never lift a word past claimed. Mutates ctx.
function respondPractice(ctx, item, response, verdict) {
  const run = ctx.dayFile.practice;
  if (response.menu === true) {
    run.index = run.queue.length;
    run.ended = 'menu';
    return { result: { ok: true, ended: true }, advance: true };
  }
  const task = run.queue[run.index];
  if (task.kind === 'graded') {
    const correct = gradedCorrect(ctx, item, response, verdict);
    gradeVerifyTask(ctx, run, task, correct);
    return { result: gradedResult(ctx, item, correct, verdict), advance: true };
  }
  if (task.kind === 'drill') {
    const out = respondDrill(ctx, task.drill, response);
    if (task.drill.done) run.index += 1;
    return out;
  }
  let result = { ok: true };
  if (task.kind === 'flashcard' && response.sort) {
    ctx.status.words[task.wordId] = applySort(wordOf(ctx.status, task.wordId), response.sort, ctx.day);
  } else if (task.kind === 'copy') {
    const term = ctx.lexicon.entries.get(task.wordId).term;
    result = { correct: normalizeAnswer(response.typed) === normalizeAnswer(term), answer: term };
    if (!result.correct) return { result, advance: false };
  } else if (task.kind === 'type-practice') {
    result = gradedResult(ctx, item, gradedCorrect(ctx, item, response, verdict), verdict);
  }
  run.index += 1;
  return { result, advance: true };
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

function nextIntro(round) {
  round.intro = { index: round.intro.index + 1, step: 'flash' };
  if (round.intro.index >= round.newWords.length) round.phase = 'stream';
}

const NOT_FIT = 'response does not fit this item';
const keysOf = (response) => Object.keys(response ?? {}).filter((key) => response[key] !== undefined);

function validateResponse(item, response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new ValidationError(NOT_FIT);
  const keys = keysOf(response);
  const isStream = item.type === 'flashcard' && item.mode === 'stream';
  if (!isStream && keys.includes('undo')) throw new ValidationError('nothing to undo');
  const only = (key) => keys.length === 1 && keys[0] === key;
  if (item.source === 'practice' && only('menu') && response.menu === true) return;
  let fits = false;
  if (item.type === 'flashcard' && item.mode === 'intro') fits = only('seen') && response.seen === true;
  else if (item.type === 'flashcard' && item.mode === 'practice') {
    fits = (only('sort') && PILES.includes(response.sort)) || (only('next') && response.next === true);
  }
  else if (isStream) {
    fits = (only('sort') && PILES.includes(response.sort)) || (only('undo') && response.undo === true)
      || (only('quizNow') && response.quizNow === true);
  } else if (item.type === 'choice') {
    fits = (only('choice') && typeof response.choice === 'string') || (only('dontKnow') && response.dontKnow === true);
  } else if (item.type === 'typed' || item.type === 'copy') fits = only('typed') && typeof response.typed === 'string';
  else if (item.type === 'drill') {
    if (TYPING_STEPS.has(item.step)) fits = only('typed') && typeof response.typed === 'string';
    else if (item.step === 'tiles') fits = only('tiles') && Array.isArray(response.tiles) && response.tiles.every((tile) => typeof tile === 'string');
    else fits = only('done') && response.done === true;
  } else if (['say', 'match', 'listen', 'summary'].includes(item.type)) fits = only('done') && response.done === true;
  else if (item.type === 'drill-offer') fits = only('drill') && (response.drill === 'yes' || response.drill === 'no');
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

  if (item.source === 'practice' || item.type === 'drill') {
    const { result: stepResult, advance } = item.source === 'practice'
      ? respondPractice(ctx, item, response, verdict)
      : respondDrill(ctx, openDrill(ctx), response);
    // A retry is not stored: the same item id must accept the next attempt.
    if (!advance) return { status: ctx.status, dayFile: ctx.dayFile, result: stepResult };
    result = stepResult;
  } else if (item.type === 'summary') {
    ctx.dayFile.summarySeen = true;
  } else if (item.id.startsWith('rc:')) {
    const correct = gradedCorrect(ctx, item, response, verdict);
    ctx.status.words[item.wordId] = applyGraded(wordOf(ctx.status, item.wordId), { source: 'recheck', correct, day: ctx.day, task: item.task, settings: gradedSettings(ctx.settings) });
    ctx.dayFile.rechecks.answered[item.wordId] = { task: item.task, correct };
    result = gradedResult(ctx, item, correct, verdict);
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
      if (ctx.dayFile.capabilities?.microphone === true && ctx.media?.[item.wordId]?.audio === true) round.intro.step = 'say';
      else nextIntro(round);
    } else if (item.type === 'say') {
      nextIntro(round);
    } else if (item.type === 'drill-offer') {
      round.offerSettled = true;
      if (response.drill === 'yes') (ctx.dayFile.drills ??= []).push(newDrill(ctx, round.offer.wordId, 'offer'));
      finishRound(ctx, round);
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
      result = gradedResult(ctx, item, correct, verdict);
    }
  }
  ctx.dayFile.items[itemId] = { at, response, result };
  settleDay(ctx, at);
  return { status: ctx.status, dayFile: ctx.dayFile, result };
}
