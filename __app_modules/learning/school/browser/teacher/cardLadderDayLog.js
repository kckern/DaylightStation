/**
 * cardLadderDayLog — the words a grown-up reads for one card-ladder answer.
 *
 * The server sends each answer as the engine recorded it (`kind`, `step`,
 * `task`, the verbatim `response`, `correct`); this file turns that into
 * "what was asked", "what they did" and "how it went" without inventing a
 * verdict the engine did not give. Pure — no fetching, no React.
 */

/** Spec §3 task codes, by what the child actually did. */
export const TASK_LABEL = Object.freeze({
  '1.1': 'Copy-type', '1.2': 'Say after', '1.3': 'Read aloud', '1.4': 'Dictation',
  '2.2': 'Pick the meaning', '3.1': 'Pick the word', '3.3': 'Type from memory', '3.4': 'Say from the cue',
});

/** A drill or intro step, where the item carries a step and no task code. */
const STEP_LABEL = Object.freeze({
  flash: 'New card', copy: 'Copy-type', say: 'Say after', look: 'Look', 'say-after': 'Say after',
  match: 'Match', 'read-aloud': 'Read aloud', tiles: 'Syllable tiles', 'say-from-cue': 'Say from the cue',
  type: 'Type from memory', dictation: 'Dictation', choice: 'Multiple choice', sort: 'Sort the card',
});

/** Why the step was there, in the sitting's own vocabulary. */
const KIND_LABEL = Object.freeze({
  recheck: 'Recheck', intro: 'Intro', sort: 'Sort', quiz: 'Quiz', match: 'Match',
  offer: 'Drill offer', drill: 'Tricky-word drill', practice: 'Practice', other: 'Step',
});

/** The child's three piles, as the buttons on their screen say them. */
const SORT_LABEL = Object.freeze({ notYet: 'Not yet', familiar: 'Familiar', claimed: 'Got it' });

/** `{ section, activity }` — e.g. `{ section: 'Quiz', activity: 'Pick the word' }`. */
export function describeStep(row) {
  const section = KIND_LABEL[row?.kind] ?? 'Step';
  const activity = TASK_LABEL[row?.task] ?? STEP_LABEL[row?.step] ?? (row?.kind === 'sort' ? 'Sort the card' : null);
  return { section, activity };
}

/** What the learner did, as text. Never a raw field name. */
export function describeResponse(response) {
  if (!response || typeof response !== 'object') return '—';
  if (typeof response.typed === 'string') return response.typed === '' ? '(left blank)' : `“${response.typed}”`;
  if (response.dontKnow) return 'Didn’t know';
  if (response.choice != null) return String(response.choice);
  if (Array.isArray(response.tiles)) return response.tiles.join('');
  if (response.sort) return SORT_LABEL[response.sort] ?? String(response.sort);
  if (response.drill != null) return response.drill === 'yes' ? 'Took the drill' : 'Skipped the drill';
  if (response.seen) return 'Saw the card';
  if (response.done) return 'Done';
  return '—';
}

/** `'right' | 'wrong' | 'ungraded'` — ungraded when the engine gave no verdict. */
export function outcomeOf(row) {
  if (row?.correct === true) return 'right';
  if (row?.correct === false) return 'wrong';
  return 'ungraded';
}

/** "3 min 27 s" from milliseconds; null when unknown. */
export function minutesOf(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min${seconds % 60 ? ` ${seconds % 60} s` : ''}` : `${seconds} s`;
}

/** "4:47 pm" from an ISO stamp, in the viewer's clock; null when unparseable. */
export function clockOf(iso) {
  const at = Date.parse(iso ?? '');
  if (!Number.isFinite(at)) return null;
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
