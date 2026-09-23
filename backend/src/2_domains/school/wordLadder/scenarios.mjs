/** Test-mode seeds (spec §8 Test mode). Pure: they only reshape the shadow copy. */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { addDays } from '../termVerdict.mjs';
import { emptyWordV3 } from './mastery.mjs';
import { emptyDay, emptyStatusV3 } from './statusV3.mjs';

export const SCENARIOS = Object.freeze(['today', 'fresh', 'due', 'round-end', 'done']);

export function seedScenario(name, snapshot, { deckWords, day }) {
  const each = (make) => Object.fromEntries(deckWords.map((id) => [id, make()]));
  switch (name ?? 'today') {
    case 'today': return snapshot;
    case 'fresh': return { status: emptyStatusV3(), dayFile: emptyDay(day) };
    case 'due': return { status: { ...emptyStatusV3(), words: each(() => ({ ...emptyWordV3(), state: 'mastered', stage: 1, dueDay: day, introducedDay: addDays(day, -10) })) }, dayFile: emptyDay(day) };
    case 'round-end': return { status: { ...emptyStatusV3(), words: each(() => ({ ...emptyWordV3(), state: 'familiar', introducedDay: addDays(day, -1) })) }, dayFile: emptyDay(day) };
    case 'done': return { status: snapshot.status, dayFile: { ...emptyDay(day), atOpen: { dueRechecks: [], tricky: [], newAllowance: 0, settings: null }, doneAt: day } };
    default: throw new ValidationError(`unknown test scenario '${name}'`);
  }
}
