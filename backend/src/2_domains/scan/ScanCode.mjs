/**
 * Domain-prefix registry for every scannable code in the house.
 *
 * Four grammars (content routing, playback commands, nutrition fridge sheets,
 * school tokens) share one physical namespace: any reader can be handed any
 * sticker. Historically only school and nutrition declared themselves, so
 * content and commands had to be recognised POSITIONALLY — by matching a
 * segment against the list of known screen names — which meant a reader had to
 * be told in advance which route it was on.
 *
 * The prefix names the OWNER, nothing more. It answers "who handles this?" and
 * then gets out of the way: each domain keeps its existing grammar unchanged in
 * the body. `nut:dl:4` still carries `dl:4` for the nutrition vocabulary to
 * parse; `go:living-room:plex:594036+shuffle` still carries the full content
 * segment string. This module does not know or care what those bodies mean.
 *
 * The registry is CLOSED and CASE-SENSITIVE. `NUT:dl:4` is not a nutrition
 * code — the encoders control every printed string, so nothing needs to be
 * lenient, and case folding would only widen the collision surface. Unknown
 * prefixes are not errors here; they come back as `form: 'unknown'` with the
 * body left intact, since the whole string may well be a raw product barcode.
 *
 * No registered prefix may be a prefix of another. That invariant is what lets
 * parsing be a single split on the first colon with no backtracking or
 * longest-match search. Keep it true when adding a namespace.
 *
 * Note: school's handler needs the RAW code, not the body — its token registry
 * looks tokens up by the full `sch:<body>` string, so `raw` is always returned
 * alongside `body`.
 *
 * @module scan/ScanCode
 */

/** Prefix tag -> owning namespace. Closed set; case-sensitive; no tag prefixes another. */
export const PREFIX_REGISTRY = Object.freeze({
  'go':  'content',
  'cmd': 'command',
  'nut': 'nutrition',
  'sch': 'school',
});

/** Every namespace a parse can resolve to, in registry order. */
export const NAMESPACES = Object.freeze([...new Set(Object.values(PREFIX_REGISTRY))]);

/**
 * Resolve a scanned string to its owning domain.
 *
 * @param {unknown} code Raw scanned payload.
 * @returns {{namespace: string|null, body: string, raw: string, form: 'prefixed'|'unknown'}}
 *   `namespace` is null and `form` is 'unknown' when no registered prefix claims
 *   the code; `body` then holds the trimmed input untouched.
 */
export function parseScanCode(code) {
  const raw = typeof code === 'string' ? code.trim() : '';
  if (!raw) return { namespace: null, body: '', raw: '', form: 'unknown' };

  // idx > 0 (not >= 0): a leading colon means an empty tag, which can never match.
  const idx = raw.indexOf(':');
  if (idx > 0) {
    const tag = raw.slice(0, idx);
    const namespace = PREFIX_REGISTRY[tag];
    if (namespace) return { namespace, body: raw.slice(idx + 1), raw, form: 'prefixed' };
  }

  return { namespace: null, body: raw, raw, form: 'unknown' };
}

export default parseScanCode;
