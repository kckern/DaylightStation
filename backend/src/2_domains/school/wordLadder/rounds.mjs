/**
 * Which round comes next (spec §4 Rounds, Order, Time estimates). Shrink-to-fit:
 * a round starts only if its estimate fits the day's remaining active time, so
 * the quiz at its end is never what the cap cuts off.
 */
import { isUnsettled } from './mastery.mjs';

export const ESTIMATE_MS = Object.freeze({ recheckChoice: 15000, recheckTyped: 30000, newWord: 138000, carryWord: 61000 });
const CARRY_STATES = ['notYet', 'introduced', 'familiar', 'claimed'];
const CARRY_RANK = { notYet: 0, introduced: 1, familiar: 1, claimed: 2 };

export function newAllowance({ words, day, settings }) {
  const all = Object.values(words ?? {});
  const introducedToday = all.filter((word) => word.introducedDay === day).length;
  const unsettled = all.filter(isUnsettled).length;
  return Math.max(0, Math.min(settings.batch.newPerDay - introducedToday, settings.batch.workingSet - unsettled));
}

function carryCandidates(words, day, roundedToday) {
  return Object.entries(words ?? {})
    .filter(([id, word]) => CARRY_STATES.includes(word.state) && word.introducedDay && word.introducedDay < day
      && !roundedToday.has(id) && word.verifyFailedDay !== day)
    .sort(([a, x], [b, y]) => (CARRY_RANK[x.state] - CARRY_RANK[y.state]) || a.localeCompare(b))
    .map(([id]) => id);
}

export function planNextRound({ words, pool = [], day, roundedToday = new Set(), settings, remainingMs, roundNumber }) {
  const size = settings.round.size;
  const carry = carryCandidates(words, day, roundedToday);
  const allowance = newAllowance({ words, day, settings });
  const fresh = pool.filter((id) => !roundedToday.has(id)).slice(0, allowance);
  const id = `r${roundNumber}`;

  if (carry.length >= 2 || (carry.length >= 1 && fresh.length < 2)) {
    let n = Math.min(size, carry.length);
    while (n >= 1 && n * ESTIMATE_MS.carryWord > remainingMs) n -= 1;
    return n >= 1 ? { id, kind: 'carry', words: carry.slice(0, n), newWords: [] } : null;
  }
  const held = carry;
  let n = Math.min(fresh.length, size - held.length);
  while (n >= 2 && n * ESTIMATE_MS.newWord + held.length * ESTIMATE_MS.carryWord > remainingMs) n -= 1;
  if (n < 2) return null;
  const newWords = fresh.slice(0, n);
  return { id, kind: 'new', words: [...newWords, ...held], newWords };
}
