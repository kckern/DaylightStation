/**
 * The plumbing the reading surround module needs.
 *
 * Deliberately a twin of `School/lesson/surround/lessonSurroundKit.js` rather
 * than an import of it: the two School surfaces share a shape, not a lifetime,
 * and a shared helper between them would be a seam nobody owns the moment one
 * of them needs a field the other does not. `Surround/moduleKit.js` is the
 * wrong home for either — it stamps `app: 'surround'`, and these are SCHOOL
 * modules that happen to render inside the surround frame. The question an
 * adult asks the log store is "what happened in this child's reading", never
 * "what happened in the surround layer".
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
 * @param {string} component this module's own name, e.g. `reading-credit`.
 * @returns {object} something with debug/info/warn/error.
 */
export function readingSurroundLogger(logger, component) {
  // A host-supplied logger is RE-CHILDED so the module's events inherit the
  // host's `sessionLog` routing and correlation fields; a test double with no
  // `.child` is used as it is, because mocking a logger should not require
  // mocking its lineage.
  if (logger) return logger.child?.({ app: 'school', component }) ?? logger;
  if (!fallbacks.has(component)) {
    fallbacks.set(component, getLogger().child({ app: 'school', component }));
  }
  return fallbacks.get(component);
}

/**
 * The reading payload, from whichever shape the frame was handed.
 *
 * The definition this module renders under is INLINE — built by the reading
 * widget from its SESSION, not resolved from a content sidecar (see
 * `registerReadingSurround.js`) — so the nesting is a hand-written literal in
 * one file, and a hand-written literal is exactly the thing that ends up one
 * level off. `data.reading` is the contract; a payload that IS the reading is
 * accepted too, and neither shape can produce a wrong answer: the fields are
 * read by name, and a payload carrying none of them fails the same "no learner"
 * branch a missing one does.
 *
 * @param {object|null} data the module contract's `data` prop.
 * @returns {object|null}
 */
export function readingOf(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const nested = data.reading;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested;
  return data;
}
