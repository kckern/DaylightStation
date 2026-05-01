/**
 * PrivacyExclusions (F4-C)
 *
 * Single source of truth for the privacy-exclusion floor that disqualifies
 * paths from health-archive ingestion (write surface) and read-scope
 * (longitudinal-tool surface). Both surfaces previously kept their own
 * parallel copy of the regex set — the audit (F4-C) flagged the duplication.
 *
 * Floor vs. additions:
 *   - The floor (`FLOOR_EXCLUSIONS`) is the set of patterns that ALWAYS
 *     disqualify a path, regardless of playbook config. Users CANNOT remove
 *     entries — the audit Section 10 explicitly forbids it.
 *   - User playbooks can ADD entries via `archive.additional_privacy_exclusions`.
 *     Each addition is treated as a case-insensitive substring; regex
 *     metacharacters are escaped before compilation so users cannot smuggle
 *     wildcards or alternation into the matcher.
 *
 * Match semantics:
 *   - Floor patterns are RegExp objects with their own semantics — most are
 *     case-insensitive substring; a couple use word boundaries (`\bjournal\b`,
 *     `\bbanking\b`) to reduce over-rejection on common false-positives.
 *   - User additions are always case-insensitive substring (no word
 *     boundaries, no regex semantics — strings are escaped first).
 *
 * @module domains/health/policies/PrivacyExclusions
 */

/**
 * The set of substring patterns that ALWAYS disqualify a path. Frozen so
 * downstream code cannot mutate it. To change the floor you must edit this
 * file (and update the audit Section 10).
 */
export const FLOOR_EXCLUSIONS = Object.freeze([
  /email/i,
  /chat/i,
  /finance/i,
  /journal\b/i,
  /search-history/i,
  /calendar/i,
  /social/i,
  /\bbanking\b/i,
]);

/**
 * Regex metacharacters that must be escaped before splicing a user-supplied
 * string into a RegExp. Without this escape, a playbook author could pass
 * `'foo.*bar'` and turn it into a wildcard match.
 */
const REGEX_METACHARS = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(s) {
  return String(s).replace(REGEX_METACHARS, '\\$&');
}

/**
 * Compile a set of additional user-supplied exclusion strings into RegExp
 * objects. Each string is treated as a case-insensitive substring (no word
 * boundaries, no special regex semantics — strings are escaped before
 * compilation so user input cannot inject regex syntax).
 *
 * Skips:
 *   - non-string entries (numbers, objects, null, undefined)
 *   - empty strings
 *   - whitespace-only strings (trimmed before length check)
 *
 * @param {Iterable<string>} additions
 * @returns {RegExp[]}
 */
export function compileAdditions(additions = []) {
  if (!additions || typeof additions[Symbol.iterator] !== 'function') {
    return [];
  }
  const out = [];
  for (const raw of additions) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    out.push(new RegExp(escapeRegex(trimmed), 'i'));
  }
  return out;
}

/**
 * Check whether a path matches any exclusion (floor + additions).
 *
 * The floor is checked first — additions can ONLY add to the rejection set;
 * they cannot shadow or remove a floor entry. Returns `true` on the first
 * match (floor or addition) for short-circuit speed.
 *
 * @param {string} pathStr
 * @param {RegExp[]} [additions=[]] typically the result of `compileAdditions`
 * @returns {boolean}
 */
export function matchesExclusion(pathStr, additions = []) {
  if (typeof pathStr !== 'string') return false;
  if (FLOOR_EXCLUSIONS.some((p) => p.test(pathStr))) return true;
  if (Array.isArray(additions) && additions.some((p) => p.test(pathStr))) {
    return true;
  }
  return false;
}

export default {
  FLOOR_EXCLUSIONS,
  compileAdditions,
  matchesExclusion,
};
