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
 * lenient, and case folding would only widen the collision surface. An
 * unregistered prefix is not an error here: the code falls through to the later
 * steps below with its body left intact, since the whole string may well be a
 * legacy artifact or a raw product barcode.
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
 * ## Resolution order
 *
 * First match wins. Steps 2 and 3 are a DEPRECATION SHELF: printed artifacts
 * still in circulation carry those forms, and the whole shelf gets deleted once
 * they are reprinted. Nothing in steps 1, 4 or 6 depends on it.
 *
 * 1. `prefixed` — a registered tag above.
 * 2. `legacy-prefixed` — bare `dl:` `ct:` `rs:` → nutrition. The fridge sheet
 *    always self-identified, just without naming its owner.
 * 3. `legacy-positional` — anything else with a NON-EMPTY segment before its
 *    first colon → content.
 * 4. `shape` — digit-only: 13 digits behind a Bookland prefix → book, otherwise
 *    → product. Nothing prints a `book:` sticker: the publisher's barcode is
 *    already on the object, so shape is the only signal available.
 * 6. `unknown` — an explicit outcome, never a fall-through. (Step 5, the
 *    reader's `route`, lives in the dispatcher: this module sees only a string
 *    and knows nothing about which reader sent it.)
 *
 * **Body convention.** `body` is always the payload in the OWNING domain's
 * grammar, whichever form carried it. A prefixed code strips its tag; a legacy
 * code keeps the whole string, because there is no tag to strip — `nut:dl:4`
 * and bare `dl:4` both hand nutrition `dl:4`, and `go:living-room:plex:1` and
 * bare `living-room:plex:1` both hand content `living-room:plex:1`. A handler
 * reads `body` and never learns which form its code arrived in. For `shape`,
 * `body` is the whole barcode, which is likewise the entire payload.
 *
 * ONE EXCEPTION, and it is INTERIOR WHITESPACE. `trim()` cleans the outer edges
 * of the whole input, so a space that is LEADING in the bare form is INTERIOR in
 * the prefixed form and survives: `" living-room:plex:1"` yields body
 * `"living-room:plex:1"`, but `"go: living-room:plex:1"` yields
 * `" living-room:plex:1"`. The body is deliberately NOT trimmed — that would
 * change what `go:` means, and this module's refusal to touch bodies is what
 * lets each domain keep its own grammar. A handler that splits on `:` must
 * `.trim()` its own segments. This is a known hazard in this codebase, not a
 * hypothetical: see the CLAUDE.md note that YAML content IDs parse with a
 * leading space and that code parsing `source:localId` has to trim.
 *
 * **Step 3 is a CATCH-ALL, and deliberately so.** The design calls for parsing
 * against the known screen and command names, but those live in config and this
 * module imports nothing, by layer rule. Having a non-empty tag segment is
 * therefore the whole test, with two consequences worth stating out loud:
 *
 * - It resolves to `content`, never `command`, even for a legacy command like
 *   `office:volume:30`. The two legacy grammars share one parser
 *   (`BarcodePayload.parse`) and therefore one handler; the content/command
 *   split exists only for the new prefixed forms.
 * - Every string with a non-empty tag that steps 1 and 2 do not claim lands on
 *   content, so a mis-cased `SCH:a7f3k2` resolves to content rather than
 *   unknown — the tag stays in the body, unstripped. That is
 *   survivable because claim is not success: the content parser owns the grammar
 *   and refuses what it cannot read, exactly as it does today for a typo'd
 *   sticker.
 *
 * `unknown` therefore stays reachable three ways: input with no colon that is
 * not digits only (`gibberish`); input whose FIRST colon is at index 0
 * (`:4`, `:go:x`), which has an empty tag and so is excluded from steps 1-3 by
 * the same guard — and, being non-digit, from step 4 as well; and non-string or
 * blank input, which returns from the `!raw` guard before any step runs.
 *
 * Steps 3 and 4 are DISJOINT BY CONSTRUCTION — step 3 requires a colon, step 4
 * requires digits only — so their ordering is not a judgment call and cannot
 * become one.
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
 * guarantee that anything unregistered falls through to the LATER STEPS, which
 * is where legacy artifacts and product barcodes get claimed. Dropping the prototype
 * protects every future consumer that indexes this map, not just the lookup
 * below. `Object.values` and spread still work on a null-prototype object.
 */
export const PREFIX_REGISTRY = Object.freeze(Object.assign(Object.create(null), {
  'go':  'content',
  'cmd': 'command',
  'nut': 'nutrition',
  'sch': 'school',
}));

/**
 * The fridge-sheet tags (`ScanVocabularyService`), accepted bare as the legacy
 * form. DEPRECATION SHELF — delete with step 2.
 *
 * A frozen ARRAY, not a Set: `Object.freeze` does not stop `Set.prototype.add`
 * — the Set reports `isFrozen` while still accepting new members — so a frozen
 * Set would advertise an immutability it does not have. Three entries make
 * `includes` free. (Both are value-based lookups, so unlike the object-keyed
 * registry above, neither carries a prototype-chain hazard; that is not what
 * decides between them.) Exported so the registry-collision
 * invariant can be tested against this list rather than a copy of it: a tag
 * here that also appears in PREFIX_REGISTRY would be shadowed by step 1 and
 * would capture every fridge scan in the house.
 */
export const LEGACY_NUTRITION_TAGS = Object.freeze(['dl', 'ct', 'rs']);

/** Bookland prefixes: a 13-digit code behind one of these is an ISBN-13. */
const ISBN13_PREFIXES = Object.freeze(['978', '979']);

/**
 * Every namespace a parse can resolve to. `book` and `product` have no prefix
 * tag — they exist only as shape outcomes (step 4) — so they are listed
 * explicitly rather than derived from the registry.
 */
export const NAMESPACES = Object.freeze([
  ...new Set([...Object.values(PREFIX_REGISTRY), 'book', 'product']),
]);

/** Every value `form` can take. See the resolution order in the module docstring. */
export const FORMS = Object.freeze([
  'prefixed', 'legacy-prefixed', 'legacy-positional', 'shape', 'unknown',
]);

/**
 * Shape test only — a 978/979 code that fails its check digit still reads as a
 * book. Validation belongs to the book handler, on the same principle that
 * keeps this module from validating a prefixed body: shape names the owner and
 * stops there. Length is exact: a 12- or 14-digit code starting `978` reads as
 * a product. A GTIN-14 wrapping a book's EAN misses on the prefix as well as
 * the length, since its leading indicator digit pushes `978` off the front
 * (`19780306406157` starts `197`).
 */
function isIsbn13(digits) {
  return digits.length === 13 && ISBN13_PREFIXES.some((p) => digits.startsWith(p));
}

/**
 * Digit-only test. `[0-9]` rather than `\d` states the intent that only ASCII
 * digits count. A UPC/EAN symbology encodes ASCII digits, so Arabic-Indic or
 * fullwidth characters arriving here would mean something upstream re-encoded
 * the payload — better surfaced as `unknown` than claimed as a product. No
 * alternation or nesting, so there is nothing for a 10,000-digit input to
 * backtrack over. The match is on the STRING: a barcode is never coerced to a
 * number, which would drop the leading zeros that UPC-A codes carry.
 */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * Resolve a scanned string to its owning domain.
 *
 * @param {unknown} code Raw scanned payload.
 * @returns {{namespace: string|null, body: string, raw: string,
 *   form: 'prefixed'|'legacy-prefixed'|'legacy-positional'|'shape'|'unknown'}}
 *   `raw` is the TRIMMED input, not the verbatim argument — scanners append
 *   CR/LF, and every consumer wants the trimmed form (school looks its tokens up
 *   by that exact string). Non-string or blank input yields empty `body` and
 *   `raw`. `namespace` is null and `form` is 'unknown' only when no step claims
 *   the code; `body` then holds the trimmed input untouched. See the module
 *   docstring for the resolution order and the `body` convention.
 */
export function parseScanCode(code) {
  const raw = typeof code === 'string' ? code.trim() : '';
  if (!raw) return { namespace: null, body: '', raw: '', form: 'unknown' };

  // idx > 0 (not >= 0): a leading colon means an empty tag. This USED to be
  // cosmetic — with only step 1 below, `>= 0` behaved identically because the
  // registry lookup simply missed. Step 3 changed that: it claims any tag it
  // reaches, empty or not, so `>= 0` would resolve `:4` and `:go:x` to content
  // instead of unknown. The guard now decides the outcome, and the
  // leading-colon test is what holds it.
  const idx = raw.indexOf(':');
  if (idx > 0) {
    const tag = raw.slice(0, idx);

    // step 1 — registered prefix.
    const namespace = PREFIX_REGISTRY[tag];
    if (namespace) return { namespace, body: raw.slice(idx + 1), raw, form: 'prefixed' };

    // step 2 — legacy self-identifying nutrition. Deprecation shelf. Reached
    // only after step 1 misses, so a tag can never mean two things; the
    // disjointness invariant is tested, not assumed.
    //
    // The collision runs the OTHER WAY TOO, and that direction is not testable
    // here. ScanVocabularyService warns that "the one theoretical collision is
    // a screen named `dl`, `ct`, or `rs`; keep screen names out of that set" —
    // this is the line that makes it real. A legacy positional code for a
    // screen so named is captured here and handed to nutrition, never reaching
    // step 3. Screen names live in config, which this module cannot read (the
    // same reason step 3 is a catch-all), so the constraint can only be held by
    // whoever names screens. It expires with the shelf.
    //
    // Exact match, not a prefix test: `ctrl:` and `dlx:` are near-twins of `ct`
    // and `dl`, and must fall through to step 3.
    if (LEGACY_NUTRITION_TAGS.includes(tag))
      return { namespace: 'nutrition', body: raw, raw, form: 'legacy-prefixed' };

    // step 3 — legacy positional content/command. Deprecation shelf, catch-all.
    // The colon is what keeps it disjoint from digit-only shape detection
    // below — they can never both match, so ordering is not a judgment call.
    return { namespace: 'content', body: raw, raw, form: 'legacy-positional' };
  }

  // step 4 — shape. Reached by input with no colon at all AND by input whose
  // first colon is at index 0 (an empty tag, excluded from steps 1-3 above).
  // The latter can never be digits only, so shape still means what it says.
  if (DIGITS_ONLY.test(raw))
    return { namespace: isIsbn13(raw) ? 'book' : 'product', body: raw, raw, form: 'shape' };

  // step 6 — unknown. Explicit outcome, not a fall-through: input with no
  // non-empty tag and no digit-only shape. `gibberish` and `:4` both land here.
  return { namespace: null, body: raw, raw, form: 'unknown' };
}
