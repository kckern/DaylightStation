/**
 * The start card's "today" (card-ladder launch card): what a sitting opened
 * now would ask for, read from status + today's day file WITHOUT opening the
 * day. Pure — the caller passes the study day, the new-word pool and the
 * settings in force; nothing here reads a clock or writes a file.
 *
 * An estimate, not a promise: rounds are planned shrink-to-fit as the day
 * goes (`planNextRound`), so the counts say what the day is ABOUT, the way the
 * sentence ladder's "6 new · 2 to review" does. The minutes come from the same
 * `ESTIMATE_MS` the planner uses, clipped to the time left under the cap.
 */
import { isDue, isExcluded, readyForSignOff } from './mastery.mjs';
import { ESTIMATE_MS, carryCandidates, newAllowance } from './rounds.mjs';
import { ladderLevel } from './mastery.mjs';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// A recheck is typed only for a word ready for its sign-off (the engine's
// `recheckTask`); every other recheck is a recognition choice.
function recheckMs(word) {
  return readyForSignOff(word) ? ESTIMATE_MS.recheckTyped : ESTIMATE_MS.recheckChoice;
}

export function introPreview({ status, dayFile, day, pool = [], settings }) {
  const words = status?.words ?? {};
  const opened = Boolean(dayFile?.atOpen);
  const doneToday = Boolean(dayFile?.doneAt);
  const capMs = settings.session.capMinutes * 60000;
  const activeMs = opened ? (dayFile.activeMs ?? 0) : 0;
  const leftMs = Math.max(0, capMs - activeMs);
  if (doneToday) return { opened, doneToday, newCount: 0, reviewCount: 0, estimatedMinutes: 0, activeMs, capMs };

  const rechecks = opened
    ? dayFile.rechecks.order.filter((id) => !dayFile.rechecks.answered[id] && !isExcluded(words[id]))
    : Object.entries(words).filter(([, w]) => isDue(w, day)).map(([id]) => id);
  const rounds = dayFile?.rounds ?? [];
  const rounded = new Set(rounds.flatMap((round) => round.words));
  // A round already under way still has its words to finish: the ones met
  // today are the day's new words, the rest are review.
  const underway = rounds.filter((round) => round.phase !== 'done').flatMap((round) => round.words)
    .filter((id) => !isExcluded(words[id]));
  const underwayNew = underway.filter((id) => (words[id]?.introducedDay ?? day) === day).length;
  const carry = carryCandidates(words, day, rounded).length + (underway.length - underwayNew);
  const fresh = pool.filter((id) => !rounded.has(id) && (words[id]?.state ?? 'new') === 'new' && !isExcluded(words[id])).length;
  // `planNextRound` never makes a round of fewer than 2 new words, so a lone
  // leftover word is not promised (the trail's Learn step reads this too).
  const allowed = Math.min(newAllowance({ words, day, settings }), fresh);
  const newCount = underwayNew + (allowed >= 2 ? allowed : 0);
  const reviewCount = rechecks.length + carry;

  const workMs = newCount * ESTIMATE_MS.newWord + carry * ESTIMATE_MS.carryWord
    + rechecks.reduce((sum, id) => sum + recheckMs(words[id]), 0);
  const estimatedMinutes = workMs > 0 ? Math.max(1, Math.ceil(Math.min(workMs, leftMs) / 60000)) : 0;
  return { opened, doneToday, newCount, reviewCount, estimatedMinutes, activeMs, capMs };
}

/**
 * The day in one line. The agenda's lesson title is the bare form ("4 new
 * words · 3 to review"); the start card adds the time (`withTime`).
 */
export function introPlanLabel(plan, { withTime = false } = {}) {
  if (plan?.doneToday) return withTime ? 'Done for today — practice anytime' : 'Done for today';
  const parts = [];
  if (plan?.newCount) parts.push(plural(plan.newCount, 'new word', 'new words'));
  if (plan?.reviewCount) parts.push(`${plan.reviewCount} to review`);
  if (!parts.length) return 'Nothing new today';
  if (withTime && plan.estimatedMinutes) parts.push(`about ${plural(plan.estimatedMinutes, 'minute', 'minutes')}`);
  return parts.join(' · ');
}

/**
 * Words learned in THIS deck: mastered — a claim the quiz verified, or a
 * passed recheck. A grown-up's excluded word leaves both sides of the count.
 */
export function deckProgress({ status, deckWords = [] }) {
  const words = status?.words ?? {};
  const kept = deckWords.filter((id) => !isExcluded(words[id]));
  // "Learned" is the ladder's top rung — typed sign-off — not the internal
  // `mastered` state, which a word reaches on recognition alone.
  const level = (id) => ladderLevel(words[id]);
  return {
    learned: kept.filter((id) => level(id) === 'mastered').length,
    recognised: kept.filter((id) => level(id) === 'recognised').length,
    total: kept.length,
  };
}
