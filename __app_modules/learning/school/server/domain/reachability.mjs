/**
 * Can a learner actually START the program they were assigned?
 *
 * THE GAP THIS CLOSES IS BETWEEN "ASSIGNED" AND "STARTABLE" (design:
 * 2026-08-26-story-time-reachability-design). On 2026-08-26 two preschoolers
 * held a daily reading obligation that nothing in the house was configured to
 * let them begin: the living-room trigger source declared no `learner_action`,
 * so a tapped card resolved to a null intent and fell into unknown-tag capture.
 * Every layer behaved exactly as written, the feature was fully built, and the
 * system had no opinion about the fact that the children could not reach it.
 *
 * Pure, and it takes the declared actions as an ARGUMENT rather than reading
 * configuration itself. That is the same discipline `RecordStoryRead` applies
 * to `studyDay`: a second, independently-resolved copy of the same fact is how
 * two halves of a system come to disagree without anything ever erroring.
 */

/**
 * A program with no `entryAction` is not started by a card tap at all — a
 * course opened from the Portal, a worksheet that arrives on paper — so
 * reachability is not a question that applies to it.
 */
const requiresEntryAction = (program) => typeof program?.entryAction === 'string'
  && program.entryAction.trim() !== '';

/**
 * Which of these programs has no configured way in.
 *
 * @param {object} args
 * @param {Array<{programId: string, entryAction?: string|null}>} [args.programs]
 * @param {Set<string>|string[]|null} [args.declaredActions]
 *   Every `learner_action` any trigger source declares. **`null` means the
 *   trigger configuration could not be read**, and every program that needs an
 *   entry action is then reported unreachable — "I could not tell whether a
 *   reader is configured" is not "a reader is configured", the same rule the
 *   deploy gate fails closed on. An EMPTY set is a different statement: the
 *   config was read and declares nothing.
 * @returns {Array<{programId: string, entryAction: string}>}
 */
export function unreachablePrograms({ programs = [], declaredActions = null } = {}) {
  const needing = (Array.isArray(programs) ? programs : []).filter(requiresEntryAction);
  if (declaredActions === null || declaredActions === undefined) {
    return needing.map((p) => ({ programId: p.programId, entryAction: p.entryAction }));
  }
  const declared = declaredActions instanceof Set ? declaredActions : new Set(declaredActions ?? []);
  return needing
    .filter((p) => !declared.has(p.entryAction))
    .map((p) => ({ programId: p.programId, entryAction: p.entryAction }));
}

/**
 * The one-program form, for a caller holding a single launcher.
 *
 * @param {object} args
 * @param {string|null|undefined} args.entryAction
 * @param {Set<string>|string[]|null} [args.declaredActions]
 * @returns {boolean}
 */
export function entryActionIsReachable({ entryAction, declaredActions = null } = {}) {
  return unreachablePrograms({
    programs: [{ programId: '_', entryAction }], declaredActions,
  }).length === 0;
}

/**
 * Every `learner_action` declared across parsed trigger sources.
 *
 * Takes the already-parsed NFC locations rather than raw YAML, so the domain
 * never learns the file's shape. Returns `null` when handed nothing readable —
 * propagating the "could not tell" state above rather than an empty set, which
 * would read as a confident "nothing is declared".
 *
 * @param {Record<string, {learner_action?: string|null}>|null|undefined} locations
 * @returns {Set<string>|null}
 */
export function declaredEntryActions(locations) {
  if (locations === null || locations === undefined) return null;
  if (typeof locations !== 'object') return null;
  const out = new Set();
  for (const config of Object.values(locations)) {
    const action = config?.learner_action;
    if (typeof action === 'string' && action.trim() !== '') out.add(action);
  }
  return out;
}

export default unreachablePrograms;
