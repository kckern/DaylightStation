// frontend/src/modules/Surround/moduleKit.js
//
// THE TWO PIECES OF PLUMBING EVERY SURROUND MODULE NEEDS, written once.
//
// A tagged logger, and a URL for an authored asset. Neither is a design
// decision; both were copy-pasted into every module as it was written — the
// logger into seven files, the asset path into two — which is how a wave-by-wave
// authoring process quietly accumulates seven chances to spell `app: 'surround'`
// differently. They are here so there is one of each.

import getLogger from '../../lib/logging/Logger.js';
import { DaylightMediaPath } from '../../lib/api.mjs';

/**
 * Lazily-built module loggers, one per component name.
 *
 * LAZY because `getLogger()` reads a configured singleton that does not exist at
 * import time in every environment; a module-level call would bind whatever was
 * there when the bundle loaded. Cached per component so a module rendered a
 * thousand times does not build a thousand children.
 */
const fallbacks = new Map();

/**
 * The logger a surround module should use.
 *
 * A host-supplied logger is re-childed so the event carries THIS component while
 * inheriting the host's `sessionLog` (durability) and correlation fields. A test
 * double with no `.child` is used as it is — mocking a logger should not require
 * mocking its whole lineage. With no logger at all, the module falls back to its
 * own durable child.
 *
 * @param {object|null} logger the `logger` prop from the module contract.
 * @param {string} component the module's own name, e.g. `cue-ticker`.
 * @returns {object} something with debug/info/warn/error.
 */
export function surroundLogger(logger, component) {
  if (logger) return logger.child?.({ app: 'surround', component }) ?? logger;
  if (!fallbacks.has(component)) {
    fallbacks.set(component, getLogger().child({ app: 'surround', component }));
  }
  return fallbacks.get(component);
}

/**
 * An authored asset's URL: `beethoven/portrait.jpg` + `library/classical`
 * -> the app's static media path.
 *
 * Both ends are trimmed of stray slashes because both are authored by hand in
 * YAML, where a leading `/` is the easiest thing in the world to type.
 *
 * @param {string|null} assetBase the payload's `assetBase`.
 * @param {string|null} ref the corpus-relative path.
 * @returns {string|null} null when either end is missing — the modules render no
 *   element at all rather than a broken image.
 */
export function assetUrl(assetBase, ref) {
  if (!assetBase || !ref) return null;
  const base = String(assetBase).replace(/^\/|\/$/g, '');
  const path = String(ref).replace(/^\//, '');
  return DaylightMediaPath(`media/img/${base}/${path}`);
}
