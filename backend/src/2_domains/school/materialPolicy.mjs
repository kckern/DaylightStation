/**
 * Pure lock/completion policy over a material's units (spec §3–§5). No I/O,
 * no Date, no imports outside this domain — every input (percent, gate
 * state, attempts) is supplied by the caller.
 */

/**
 * Sorted copy of `units` by `index`. Does not mutate the input.
 *
 * @param {Array<{index:number}>} units
 * @returns {Array}
 */
export function orderUnits(units) {
  return [...units].sort((a, b) => a.index - b.index);
}

/**
 * Whether a single unit counts as complete, per its category's `completion`
 * list (spec §3). `completion: []` (reference) never completes — there is
 * nothing to fold, so the result is unconditionally false. Every listed
 * condition must hold (AND, not OR): `['played','gate']` needs both.
 *
 * @param {{percent:number, gateSatisfied:boolean}} progress
 * @param {object} categoryDef - a CATEGORIES entry
 * @param {{completionThresholdPercent:number}} opts
 * @returns {boolean}
 */
export function unitCompleted({ percent, gateSatisfied }, categoryDef, { completionThresholdPercent }) {
  const conditions = categoryDef.completion;
  if (!conditions || conditions.length === 0) return false;
  return conditions.every((condition) => {
    if (condition === 'played') return percent >= completionThresholdPercent;
    if (condition === 'gate') return gateSatisfied === true;
    throw new Error(`unitCompleted: unrecognised completion condition "${condition}"`);
  });
}

/**
 * Lock/current annotation, parallel to `orderedUnits` (spec §3–§5).
 *
 * Non-sequential categories never lock anything. Sequential categories lock
 * forward from the first incomplete unit: everything before it is unlocked
 * (already done), it is `current`, and everything after it is `locked`, with
 * a reason naming it — the quiz if its gate is the blocker, otherwise just
 * "finish it". A single-unit material has nothing after its (only) unit, so
 * nothing ever locks (spec §4 arity). All units complete -> nothing locked,
 * nothing current.
 *
 * @param {Array<{title:string}>} orderedUnits - output of orderUnits
 * @param {boolean[]} completedFlags - parallel to orderedUnits
 * @param {object} categoryDef - a CATEGORIES entry
 * @param {Array<{hasQuiz:boolean, gateSatisfied:boolean}>} gateInfo - parallel to orderedUnits
 * @returns {Array<{locked:boolean, current:boolean, lockReason:?string}>}
 */
export function annotateLocks(orderedUnits, completedFlags, categoryDef, gateInfo = []) {
  const unlocked = () => orderedUnits.map(() => ({ locked: false, current: false, lockReason: null }));

  if (!categoryDef.sequential) return unlocked();

  const firstIncompleteIndex = completedFlags.findIndex((completed) => !completed);
  if (firstIncompleteIndex === -1) return unlocked(); // all complete

  const currentUnit = orderedUnits[firstIncompleteIndex];
  const currentGate = gateInfo[firstIncompleteIndex] || { hasQuiz: false, gateSatisfied: true };
  const lockReason = currentGate.hasQuiz && !currentGate.gateSatisfied
    ? `Pass the quiz for “${currentUnit.title}” first`
    : `Finish “${currentUnit.title}” first`;

  return orderedUnits.map((unit, i) => {
    if (i < firstIncompleteIndex) return { locked: false, current: false, lockReason: null };
    if (i === firstIncompleteIndex) return { locked: false, current: true, lockReason: null };
    return { locked: true, current: false, lockReason };
  });
}

/**
 * Whether any quiz session against `bankId` cleared `passPercent` (spec §5).
 * A session's score is its count of *distinct* correctly-answered `itemId`s
 * divided by `itemCount` — repeating one correct item does not inflate the
 * score, since credit is per-item, not per-attempt. Non-quiz attempts
 * (`mode !== 'quiz'`) and attempts for other banks are ignored. An empty
 * attempt list or a non-positive `itemCount` (nothing to divide by) is false.
 *
 * @param {Array<{mode:string, bankId:string, sessionId:string, itemId:string, correct:boolean}>} attempts
 * @param {{bankId:string, itemCount:number, passPercent:number}} opts
 * @returns {boolean}
 */
export function quizSessionPassed(attempts, { bankId, itemCount, passPercent }) {
  if (!itemCount || itemCount <= 0) return false;

  const relevant = (attempts || []).filter((a) => a.mode === 'quiz' && a.bankId === bankId);
  if (relevant.length === 0) return false;

  const correctItemsBySession = new Map();
  for (const attempt of relevant) {
    if (!attempt.correct) continue;
    if (!correctItemsBySession.has(attempt.sessionId)) correctItemsBySession.set(attempt.sessionId, new Set());
    correctItemsBySession.get(attempt.sessionId).add(attempt.itemId);
  }

  for (const correctItems of correctItemsBySession.values()) {
    const score = (correctItems.size / itemCount) * 100;
    if (score >= passPercent) return true;
  }
  return false;
}
