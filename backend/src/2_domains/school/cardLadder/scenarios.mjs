/** Test-mode seeds (spec §8 Test mode). Pure: they only reshape the shadow copy. */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { addDays } from '../termVerdict.mjs';
import { emptyWordV3 } from './mastery.mjs';
import { emptyDay, emptyStatusV3 } from './statusV3.mjs';

// Recognised twice (verify + the first recheck) and matched: the next recheck is typed.
const SIGN_OFF_READY = Object.freeze({ recognizedCount: 2, matched: true });

export const SCENARIOS = Object.freeze(['today', 'fresh', 'due', 'round-end', 'tricky', 'done', 'typos']);

export function seedScenario(name, snapshot, { deckWords, day }) {
  const each = (make) => Object.fromEntries(deckWords.map((id) => [id, make()]));
  switch (name ?? 'today') {
    case 'today': return snapshot;
    case 'fresh': return { status: emptyStatusV3(), dayFile: emptyDay(day) };
    // Every other word is ready for the typed sign-off (recognised twice, matched), so
    // the rechecks show both kinds: recognition (2.2 / 3.1) and typed (3.3 / 1.4).
    case 'due': return {
      status: {
        ...emptyStatusV3(),
        words: Object.fromEntries(deckWords.map((id, i) => [id, {
          ...emptyWordV3(), state: 'mastered', stage: 1, dueDay: day, introducedDay: addDays(day, -10),
          ...(i % 2 === 0 ? SIGN_OFF_READY : { recognizedCount: 2 }),
        }])),
      },
      dayFile: emptyDay(day),
    };
    case 'round-end': return { status: { ...emptyStatusV3(), words: each(() => ({ ...emptyWordV3(), state: 'familiar', introducedDay: addDays(day, -1) })) }, dayFile: emptyDay(day) };
    // Streak at the drill threshold: the day opens on the first word's tricky drill.
    case 'tricky': return {
      status: {
        ...emptyStatusV3(),
        words: Object.fromEntries(deckWords.map((id, i) => [id, {
          ...emptyWordV3(), state: 'familiar', introducedDay: addDays(day, -3),
          ...(i === 0 ? { tricky: true, trickySince: addDays(day, -1), missStreak: 2 } : {}),
        }])),
      },
      dayFile: emptyDay(day),
    };
    // Typed sign-off rechecks for every word (the round quiz is recognition only,
    // ruling 2026-09-23); the harness answers them with misspellings.
    case 'typos': return {
      status: { ...emptyStatusV3(), words: each(() => ({ ...emptyWordV3(), state: 'mastered', stage: 1, dueDay: day, introducedDay: addDays(day, -10), ...SIGN_OFF_READY })) },
      dayFile: emptyDay(day),
    };
    case 'done': return { status: snapshot.status, dayFile: { ...emptyDay(day), atOpen: { dueRechecks: [], tricky: [], newAllowance: 0, settings: null }, doneAt: day } };
    default: throw new ValidationError(`unknown test scenario '${name}'`);
  }
}
