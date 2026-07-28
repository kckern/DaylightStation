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
 * segment string. This module does not know or care what those bodies mean, and
 * does not validate them — `go:` resolves with an empty body and leaves the
 * rejection to the content parser that owns that grammar.
 *
 * The registry is CLOSED and CASE-SENSITIVE. `NUT:dl:4` is not a nutrition
 * code — the encoders control every printed string, so nothing needs to be
 * lenient, and case folding would only widen the collision surface. Unknown
 * prefixes are not errors here; they come back as `form: 'unknown'` with the
 * body left intact, since the whole string may well be a raw product barcode.
 *
 * Registry invariant: every tag must be NON-EMPTY and must CONTAIN NO COLON.
 * That, and only that, is what the single-split parse depends on. `indexOf(':')`
 * finds the FIRST colon, so a tag like `go:room` would be permanently
 * unreachable — `go:room:x` splits at index 2 and resolves to `go` instead. An
 * empty tag is unreachable for the same reason: a leading colon is rejected
 * before lookup. Tags that share a leading substring are FINE, because lookup is
 * exact equality after the split — `go` and `gone` would both resolve
 * unambiguously, so there is no no-tag-prefixes-another rule to maintain.
 *
 * Note: school's handler needs the RAW code, not the body — its token registry
 * looks tokens up by the full `sch:<body>` string, so `raw` is always returned
 * alongside `body`.
 *
 * @module scan/ScanCode
 */

/**
 * Prefix tag -> owning namespace. Closed set, case-sensitive; see the registry
 * invariant above.
 *
 * Null-prototype deliberately. A scanned payload is arbitrary input — anyone can
 * print a QR code — and a plain object literal resolves inherited members, so
 * `constructor:foo` and `__proto__:foo` would come back `form: 'prefixed'` with
 * a non-string `namespace`. That breaks the declared return type and the
 * guarantee that anything unregistered falls through to the unknown path (which
 * is where product barcodes are detected downstream). Dropping the prototype
 * protects every future consumer that indexes this map, not just the lookup
 * below. `Object.values` and spread still work on a null-prototype object.
 */
export const PREFIX_REGISTRY = Object.freeze(Object.assign(Object.create(null), {
  'go':  'content',
  'cmd': 'command',
  'nut': 'nutrition',
  'sch': 'school',
}));

/** Every namespace a parse can resolve to, in registry order. */
export const NAMESPACES = Object.freeze([...new Set(Object.values(PREFIX_REGISTRY))]);

/**
 * Resolve a scanned string to its owning domain.
 *
 * @param {unknown} code Raw scanned payload.
 * @returns {{namespace: string|null, body: string, raw: string, form: 'prefixed'|'unknown'}}
 *   `raw` is the TRIMMED input, not the verbatim argument — scanners append
 *   CR/LF, and every consumer wants the trimmed form (school looks its tokens up
 *   by that exact string). Non-string or blank input yields empty `body` and
 *   `raw`. `namespace` is null and `form` is 'unknown' when no registered prefix
 *   claims the code; `body` then holds the trimmed input untouched.
 */
export function parseScanCode(code) {
  const raw = typeof code === 'string' ? code.trim() : '';
  if (!raw) return { namespace: null, body: '', raw: '', form: 'unknown' };

  // idx > 0 (not >= 0): a leading colon means an empty tag. `>= 0` would behave
  // identically today — the lookup would just miss — so this guard states the
  // intent rather than changing the result. The no-empty-tag invariant test is
  // what actually keeps the two equivalent; if that ever fails, so does this.
  const idx = raw.indexOf(':');
  if (idx > 0) {
    const tag = raw.slice(0, idx);
    const namespace = PREFIX_REGISTRY[tag];
    if (namespace) return { namespace, body: raw.slice(idx + 1), raw, form: 'prefixed' };
  }

  return { namespace: null, body: raw, raw, form: 'unknown' };
}
