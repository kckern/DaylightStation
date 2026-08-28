/**
 * The one piece of plumbing both lesson surround modules need.
 *
 * `Surround/moduleKit.js` already answers this question for the concert-hall
 * modules — but it stamps `app: 'surround'`, and these two are SCHOOL modules
 * that happen to render inside the surround frame. A lesson's events belong
 * with the rest of the lesson (`app: 'school'`, the same tag
 * `useCheckpointGate` and `useMediaLessonSession` write under), because the
 * question an adult asks the log store is "what happened in this child's
 * lesson", never "what happened in the surround layer".
 *
 * Everything else is copied from `surroundLogger` deliberately, including the
 * two behaviours that matter to a caller:
 *   - a host-supplied logger is RE-CHILDED, so the module's events inherit the
 *     host's `sessionLog` routing and correlation fields;
 *   - a test double with no `.child` is used as it is — mocking a logger should
 *     not require mocking its lineage.
 */

import getLogger from '../../../../lib/logging/Logger.js';

/**
 * Lazily-built module loggers, one per component name. Lazy because
 * `getLogger()` reads a singleton that does not exist at import time in every
 * environment (CLAUDE.md, "Module-Level Loggers"); cached so a module rendered
 * a thousand times does not build a thousand children.
 */
const fallbacks = new Map();

/**
 * @param {object|null} logger the `logger` prop from the surround module contract.
 * @param {string} component this module's own name, e.g. `checkpoint-map`.
 * @returns {object} something with debug/info/warn/error.
 */
export function lessonSurroundLogger(logger, component) {
  if (logger) return logger.child?.({ app: 'school', component }) ?? logger;
  if (!fallbacks.has(component)) {
    fallbacks.set(component, getLogger().child({ app: 'school', component }));
  }
  return fallbacks.get(component);
}

/**
 * The lesson payload, from whichever shape the frame was handed.
 *
 * The definition these modules render under is INLINE — built by the lesson
 * widget from its session, not resolved from a content sidecar (see
 * `registerLessonSurround.js`) — so the nesting is a hand-written literal in
 * one file, and a hand-written literal is exactly the thing that ends up one
 * level off. `data.lesson` is the contract; a payload that IS the lesson is
 * accepted too, and neither shape can produce a wrong answer: the fields are
 * read by name, and a payload carrying none of them fails the same "unusable"
 * branch a missing one does.
 *
 * @param {object|null} data the module contract's `data` prop.
 * @returns {object|null}
 */
export function lessonOf(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const nested = data.lesson;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested;
  return data;
}

/** Tolerant of a Set, an array, or garbage — garbage means nothing is cleared. */
export function clearedSetOf(clearedIds) {
  if (clearedIds instanceof Set) return clearedIds;
  if (Array.isArray(clearedIds)) {
    return new Set(clearedIds.filter((v) => typeof v === 'string' && v.trim().length > 0));
  }
  return new Set();
}

/**
 * A checkpoint's id, spelled EXACTLY as `useCheckpointGate`'s `idOf` spells it:
 * what the payload carries, else `cp-<at>` derived from the authored position.
 *
 * A THIRD COPY OF A TWO-COPY RULE, and it is deliberate — the first two are the
 * backend's `mediaCheckpoints.mjs` and the frontend gate hook, which document
 * each other as twins. This one draws what those two decide, and a map that
 * derived ids differently would draw a ✓ on a checkpoint the gate is about to
 * stop on. `CheckpointMap.test.jsx` pins the agreement against
 * `deriveCheckpointGate` itself rather than against a literal, so a drift in
 * either spelling fails there rather than on a television.
 */
export function checkpointIdOf(cp, at) {
  const authored = cp?.id;
  return (typeof authored === 'string' && authored.trim().length > 0) ? authored : `cp-${at}`;
}

/** The authored second, or null when this entry cannot be positioned at all. */
export function checkpointAtOf(cp) {
  return (cp && typeof cp === 'object' && Number.isFinite(cp.at)) ? cp.at : null;
}
