/**
 * The study day's plan (design "Daily session") and how far through it the
 * learner is. Pure. The application freezes the FIRST plan of a study day in
 * the status store (a rebuild from the mutated store would drop the checks
 * just passed and then offer a review quiz); progress and credit are read
 * from that frozen plan plus the day's own history.
 */
import { isScheduledCheck } from './wordLadder.mjs';
import { hashString, resolveDirection, seededShuffle } from './checkItem.mjs';

const STUDY_STATES = new Set(['new', 'learning']);
const MARK_EVENTS = new Set(['claim', 'still-learning']);
const CHECK_EVENTS = new Set(['check-pass', 'check-pass-early', 'check-miss']);

export function planDay({ status, deckId = null, deckWordIds = [], lexiconIds = [], today, media = {} }) {
  const inLexicon = new Set(lexiconIds);
  const deck = deckWordIds.filter((id) => inLexicon.has(id));
  const deckSet = new Set(deck);
  const words = status?.words ?? {};
  const stateOf = (id) => words[id]?.state ?? 'new';
  const order = (ids, salt) => seededShuffle(ids, hashString(`${today}|${salt}`));

  const checkIds = order(
    Object.keys(words).filter((id) => inLexicon.has(id) && isScheduledCheck(words[id], today)).sort(),
    'checks',
  );
  const carried = Object.keys(words)
    .filter((id) => inLexicon.has(id) && !deckSet.has(id) && stateOf(id) === 'learning').sort();
  const studyIds = order([...deck.filter((id) => STUDY_STATES.has(stateOf(id))), ...carried], 'study');
  const busy = new Set([...checkIds, ...studyIds]);
  const reviewIds = deck.some((id) => busy.has(id)) ? [] : order(deck, 'review');
  const withDirection = (wordId) => ({ wordId, direction: resolveDirection(wordId, today, media[wordId]) });
  return {
    deckId, checks: checkIds.map(withDirection), study: studyIds, reviewQuiz: reviewIds.map(withDirection),
  };
}

export function dayProgress({ dayPlan, words = {}, day }) {
  const eventsOn = (id) => (words[id]?.history ?? []).filter((event) => event.day === day);
  const checkState = (item, phase) => {
    const hit = eventsOn(item.wordId).find((event) => event.phase === phase && CHECK_EVENTS.has(event.event));
    return { ...item, phase, done: Boolean(hit), correct: hit ? hit.event !== 'check-miss' : null };
  };
  const checks = (dayPlan?.checks ?? []).map((item) => checkState(item, 'check'));
  const review = (dayPlan?.reviewQuiz ?? []).map((item) => checkState(item, 'review'));
  const studyIds = [...(dayPlan?.study ?? [])];
  for (const item of [...checks, ...review]) {
    if (item.done && item.correct === false && !studyIds.includes(item.wordId)) studyIds.push(item.wordId);
  }
  const study = studyIds.map((wordId) => {
    const events = eventsOn(wordId);
    const misses = events.filter((event) => event.event === 'check-miss').map((event) => Date.parse(event.at));
    const since = misses.length ? Math.max(...misses) : -Infinity;
    const after = events.filter((event) => Date.parse(event.at) >= since);
    const studied = after.filter((event) => event.event === 'study').at(-1) ?? null;
    const mark = after.filter((event) => MARK_EVENTS.has(event.event)).at(-1) ?? null;
    return {
      wordId,
      studied: Boolean(studied),
      recording: studied?.recording ?? null,
      marked: mark ? (mark.event === 'claim' ? 'know' : 'learning') : null,
      done: Boolean(studied && mark),
    };
  });
  const remaining = {
    checks: checks.filter((item) => !item.done).length,
    study: study.filter((item) => !item.done).length,
    review: review.filter((item) => !item.done).length,
  };
  return {
    checks, study, review, remaining,
    complete: Boolean(dayPlan) && remaining.checks + remaining.study + remaining.review === 0,
  };
}

export function progressLabel(progress) {
  if (progress.complete) return 'Done for today';
  const checks = progress.remaining.checks + progress.remaining.review;
  return `${checks} ${checks === 1 ? 'check' : 'checks'} · ${progress.remaining.study} to study`;
}
