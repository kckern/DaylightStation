/**
 * The sitting header's step trail: Review › Learn › Sort › Quiz › Match ›
 * Practice, with Drill slotted in while a tricky drill runs. Derived ONLY from the
 * server's progress payload (`WordLadderSittingService#progress`) plus the
 * current item's `type`/`source` for practice — never guessed from item types
 * alone. Pure; the header renders it.
 *
 * States: `done` (ticked), `current` (lit), `todo` (dim). A step the day does
 * not have is omitted: Review with no rechecks, Learn in a day whose round
 * work has no new words (a carry round — `learnToday`, which the server reads
 * from the day's plan before any round exists, so Review never hides Learn),
 * Match unless the round is in its guided match (`round.phase === 'match'`, or
 * a round-sourced match item) or says it has one ahead (`round.hasMatch`); with
 * no round running, rounds still to come show Match and a day past them shows
 * it only when one was held (`matchToday`). Practice unlocks only once today's
 * goal is met (`doneToday`) and is lit only while practising.
 */

export const STEP_LABELS = Object.freeze({
  review: 'Review', learn: 'Learn', sort: 'Sort', quiz: 'Quiz', match: 'Match', drill: 'Drill', practice: 'Practice',
});

/** Shown once per step per sitting, under the header. Kid-readable: no "verify", "recheck" or "claimed". */
export const STEP_HINTS = Object.freeze({
  review: 'Words from before — show what you remember.',
  learn: 'Meet each new word.',
  sort: 'Flip, then sort: Not yet, Familiar, or Got it.',
  quiz: 'Quick check on the words you sorted.',
  match: 'Match each word to its meaning.',
  drill: 'A short workout on a tricky word.',
  practice: 'Free practice — pick anything.',
});

const ROUND_STEPS = ['learn', 'sort', 'quiz', 'match'];
// The drill offer comes after the quiz and the Match: no round step is lit,
// and every one of them reads done (the trail never steps backwards).
const ROUND_PHASE_STEP = { intro: 'learn', stream: 'sort', quiz: 'quiz', match: 'match' };
const ROUND_PHASE_NAME = { intro: 'New words', stream: 'Sort', quiz: 'Quiz', offer: 'Tricky word', match: 'Match' };
const isRoundMatch = (item) => item?.type === 'match' && item.source !== 'practice';

function currentStep(progress, item) {
  if (item?.type === 'menu' || item?.source === 'practice' || progress?.phase === 'practice') return 'practice';
  if (progress?.phase === 'rechecks') return 'review';
  if (progress?.phase === 'drill') return 'drill';
  if (isRoundMatch(item)) return 'match';
  if (progress?.phase === 'round' && progress.round) return ROUND_PHASE_STEP[progress.round.phase] ?? null;
  return null;
}

function subLineOf(progress, current) {
  if (!progress) return '';
  if (progress.phase === 'rechecks') return `Checking ${progress.rechecksLeft} ${progress.rechecksLeft === 1 ? 'word' : 'words'}`;
  if (progress.phase === 'drill') return 'Practising a tricky word';
  if (progress.phase === 'practice') return progress.practice ? `Practice · ${progress.practice.at} of ${progress.practice.of}` : 'Practice';
  if (progress.phase === 'summary' || !progress.round) return 'Done for today';
  // No total: rounds are planned shrink-to-fit as the day goes, so "of M"
  // would be a guess that changes under the child.
  const phase = current === 'match' ? 'match' : progress.round.phase;
  return `Round ${progress.round.index} · ${ROUND_PHASE_NAME[phase] ?? 'Cards'}`;
}

export function stepTrail(progress, item = null) {
  if (!progress) return { steps: [], current: null, subLine: '' };
  const current = currentStep(progress, item);
  const steps = [];
  if ((progress.rechecksTotal ?? 0) > 0) {
    steps.push({ id: 'review', state: current === 'review' ? 'current' : (progress.rechecksLeft === 0 ? 'done' : 'todo') });
  }
  const inRound = progress.phase === 'round' && progress.round;
  const roundsDone = progress.roundsDone ?? 0;
  const hasRounds = inRound || roundsDone > 0 || !progress.doneToday;
  if (hasRounds) {
    const offer = inRound && progress.round.phase === 'offer';
    const at = !inRound ? -1 : offer ? ROUND_STEPS.length
      : ROUND_STEPS.indexOf(current === 'match' ? 'match' : ROUND_PHASE_STEP[progress.round.phase]);
    const afterRounds = !inRound && roundsDone > 0 && progress.phase !== 'rechecks';
    // Match: the round's own answer while one runs; with none running, a round
    // still to come plans one (so Review shows the same shape the round will),
    // and a day past its rounds shows it only if one was held (`matchToday`).
    let hasMatch = current === 'match';
    if (!hasMatch && inRound) hasMatch = progress.round.hasMatch === true;
    else if (!hasMatch) hasMatch = roundsDone > 0 || progress.doneToday ? progress.matchToday === true : true;
    for (const [i, id] of ROUND_STEPS.entries()) {
      if (id === 'learn' && progress.learnToday === false) continue;
      if (id === 'match' && !hasMatch) continue;
      let state = 'todo';
      if (inRound) state = i < at ? 'done' : (i === at ? 'current' : 'todo');
      else if (afterRounds) state = 'done';
      steps.push({ id, state });
    }
  }
  if (current === 'drill') steps.push({ id: 'drill', state: 'current' });
  const locked = !progress.doneToday && current !== 'practice';
  steps.push({ id: 'practice', state: current === 'practice' ? 'current' : 'todo', locked, note: locked ? 'after today\'s words' : null });
  return { steps: steps.map((s) => ({ ...s, label: STEP_LABELS[s.id] })), current, subLine: subLineOf(progress, current) };
}
