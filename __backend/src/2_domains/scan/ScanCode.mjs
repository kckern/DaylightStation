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
 * 0. `url-rule` — an `http(s)://` URL. A scheme is never a tag, so a URL is
 *    decided here and never reaches steps 1-4: a household `url_rules` entry
 *    (barcode config, compiled by `compileUrlRules`) claims it for its
 *    namespace with the rule's `(?<id>…)` capture as `body`, and anything no
 *    rule matches is `unknown`. Before this step, `https` read as a tag and
 *    step 3 sent every printed web link in the house (a Beeloo worksheet QR,
 *    a product's marketing QR) to `content`, which then refused it as a typo.
 *    The rules come in as an argument because they live in config and this
 *    module imports nothing.
 * 1. `prefixed` — a registered tag above.
 * 2. `legacy-prefixed` — bare `dl:` `ct:` `rs:` → nutrition. The fridge sheet
 *    always self-identified, just without naming its owner.
 * 3. `legacy-positional` — anything else with a NON-EMPTY segment before its
 *    first colon → content.
 * 4. `shape` — ISBN-13 ONLY: 13 digits behind a Bookland prefix → book. Nothing
 *    prints a `book:` sticker — the publisher's barcode is already on the
 *    object — so shape is the only signal available, and 978/979 makes a book
 *    identifiable FROM THE CODE ITSELF. That is the whole test for what shape may
 *    claim, and it is why an ordinary UPC/EAN does NOT resolve here.
 * 6. `unknown` — an explicit outcome, never a fall-through. (Step 5, the
 *    reader's `route`, lives in the dispatcher: this module sees only a string
 *    and knows nothing about which reader sent it.)
 *
 * **A bare UPC/EAN is deliberately UNCLAIMED**, and falls to step 5. A product
 * barcode does not say what it is FOR: the same tin scanned at the fridge means
 * "log this food", and scanned at a content reader means nothing at all. So it
 * means whatever its reader is configured for, which is a step-5 question by
 * definition. Claiming it here as `product` would make it log food on a
 * CONTENT-routed reader, where today it reaches `BarcodePayload.parse`, fails to
 * parse, and does nothing — a real behaviour change, and the one Phase 1
 * explicitly forbids. `product` therefore exists only as a route-fallback
 * target, never as a shape outcome.
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
 * - Every non-URL string with a non-empty tag that steps 1 and 2 do not claim
 *   lands on content (a URL was already decided at step 0), so a mis-cased
 *   `SCH:a7f3k2` resolves to content rather than unknown — the tag stays in the
 *   body, unstripped. That is
 *   survivable because claim is not success: the content parser owns the grammar
 *   and refuses what it cannot read, exactly as it does today for a typo'd
 *   sticker.
 *
 * `unknown` therefore stays reachable five ways: an `http(s)://` URL that no
 * `url_rules` entry matches (step 0 decides every URL, so it never reaches the
 * catch-all); input with no colon that is not
 * an ISBN-13 (`gibberish`); a digit-only code that is not an ISBN-13
 * (`041260010682`), which is the DELIBERATE unclaimed case above and the one the
 * dispatcher's route fallback is there to catch; input whose FIRST colon is at
 * index 0 (`:4`, `:go:x`), which has an empty tag and so is excluded from steps
 * 1-3 by the same guard — and, not being an ISBN, from step 4 as well; and
 * non-string or blank input, which returns from the `!raw` guard before any step
 * runs.
 *
 * Note what that means for reading `form: 'unknown'`: it is NOT a synonym for
 * "malformed". It means "this module cannot say", which for a UPC is the correct
 * and expected answer, not a failure. Only the dispatcher, which knows the
 * reader, can finish the job.
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
 * Every namespace the SYSTEM can resolve to, which is deliberately wider than
 * what THIS module returns. Neither `book` nor `product` has a prefix tag, so
 * neither is derivable from the registry:
 *
 * - `book` is a shape outcome (step 4) and does come back from a parse.
 * - `product` NEVER comes back from a parse. It is reachable only through the
 *   dispatcher's step-5 route fallback, because a UPC means whatever its reader
 *   is configured for. It is listed here because this is the vocabulary's
 *   namespace list, not a list of parse results — a handler registry and a
 *   route-fallback config both validate against it.
 * - `worksheet` has no prefix tag either. It only comes back from a
 *   `url_rules` match (step 0): a printed third-party worksheet carries its
 *   publisher's URL, not a code the house printed.
 */
export const NAMESPACES = Object.freeze([
  ...new Set([...Object.values(PREFIX_REGISTRY), 'book', 'product', 'worksheet']),
]);

/** Every value `form` can take. See the resolution order in the module docstring. */
export const FORMS = Object.freeze([
  'url-rule', 'prefixed', 'legacy-prefixed', 'legacy-positional', 'shape', 'unknown',
]);

/**
 * Shape test only — a 978/979 code that fails its check digit still reads as a
 * book. Validation belongs to the book handler, on the same principle that
 * keeps this module from validating a prefixed body: shape names the owner and
 * stops there. Length is exact: a 12- or 14-digit code starting `978` is NOT a
 * book, and now falls through to `unknown` for the reader's route to claim
 * rather than being called a product here. A GTIN-14 wrapping a book's EAN
 * misses on the prefix as well as the length, since its leading indicator digit
 * pushes `978` off the front (`19780306406157` starts `197`).
 *
 * `startsWith`, never `includes`: an ordinary grocery EAN-13 that happens to
 * contain `978` mid-string (`1234978123456`) is not a book, and mis-claiming it
 * would send a tin of beans to the book log on every reader in the house — shape
 * outranks the route, so there is no per-reader escape from that mistake.
 */
function isIsbn13(digits) {
  return digits.length === 13 && ISBN13_PREFIXES.some((p) => digits.startsWith(p));
}

/**
 * Digit-only test. `[0-9]` rather than `\d` states the intent that only ASCII
 * digits count. A UPC/EAN symbology encodes ASCII digits, so Arabic-Indic or
 * fullwidth characters arriving here would mean something upstream re-encoded
 * the payload — better surfaced as `unknown` than claimed as a book. No
 * alternation or nesting, so there is nothing for a 10,000-digit input to
 * backtrack over. The match is on the STRING: a barcode is never coerced to a
 * number, which would drop the leading zeros that UPC-A codes carry.
 */
const DIGITS_ONLY = /^[0-9]+$/;

/** Step 0's test. Case-insensitive because schemes are, and scanners vary. */
const URL_SCHEME_RE = /^https?:\/\//i;

/**
 * Longest URL step 0 will run rules against. The rules are regexes from config
 * and the input is whatever got printed on a sticker, so a pathological pair
 * must not be able to stall the event loop. Real worksheet QRs are well under
 * 100 characters; anything longer than this is unknown without a match.
 */
const MAX_URL_RULE_INPUT = 2048;

/**
 * Is this scanned string a URL? The one test for it, exported so the
 * dispatcher's no-route-fallback rule cannot drift from step 0.
 */
export function isUrlCode(raw) {
  return typeof raw === 'string' && URL_SCHEME_RE.test(raw);
}

/**
 * Validate and compile household `url_rules` (barcode config). Pure: the caller
 * reads the YAML; this refuses anything that would make a scan ambiguous, so a
 * bad rule stops the boot instead of misrouting a sheet hours later.
 *
 * The `(?<id>…)` capture is required because it IS the body: a rule that
 * matched without naming the page would hand its handler nothing to look up.
 * It is checked on the COMPILED regex, not the source text, since `\(?<id>`
 * and `[(?<id>]` both spell it without capturing anything.
 *
 * Anchor every `match` with `^…$`. An unanchored `qr\.beeloo\.com/(?<id>\w+)`
 * would claim `https://evil.example/?u=qr.beeloo.com/abc`, so a missing `^` is
 * refused here (a missing `$` is the author's call, and the rules below are
 * theirs to read). Rules match CASE-SENSITIVELY as written; only the scheme
 * test that decides "is this a URL" ignores case.
 * A `worksheet` rule must name its `platform`.
 * The namespace is checked against the vocabulary only; whether a handler is
 * registered for it is the dispatcher composition's boot check, since this
 * module knows nothing about handlers.
 *
 * @param {unknown} raw  the `url_rules` list as read from config
 * @returns {ReadonlyArray<{id: string, re: RegExp, namespace: string, platform: string|null}>}
 */
export function compileUrlRules(raw) {
  if (raw === undefined || raw === null) return Object.freeze([]);
  if (!Array.isArray(raw)) throw new TypeError('url_rules must be a list');
  const seen = new Set();
  return Object.freeze(raw.map((rule, i) => compileUrlRule(rule, i, seen)));
}

/**
 * The boot's form of `compileUrlRules`: it never throws. Every valid rule is
 * compiled and every invalid one is reported, so one typo in household YAML
 * costs that one rule rather than the whole controller (HA, piano, fitness…
 * all boot in the same process). The CLI keeps the throwing form so a bad rule
 * fails loudly where an author is looking.
 *
 * A rule whose id repeats an earlier one is reported and the earlier one kept.
 * A non-list compiles to no rules and one error with a null index and id.
 *
 * @param {unknown} raw  the `url_rules` list as read from config
 * @returns {{rules: ReturnType<typeof compileUrlRules>,
 *   errors: Array<{index: number|null, id: string|null, message: string}>}}
 */
export function compileUrlRulesLenient(raw) {
  if (raw === undefined || raw === null) return { rules: Object.freeze([]), errors: [] };
  if (!Array.isArray(raw)) {
    return { rules: Object.freeze([]), errors: [{ index: null, id: null, message: 'url_rules must be a list' }] };
  }
  const seen = new Set();
  const rules = [];
  const errors = [];
  raw.forEach((rule, i) => {
    try {
      rules.push(compileUrlRule(rule, i, seen));
    } catch (err) {
      const id = typeof rule?.id === 'string' && rule.id ? rule.id : null;
      errors.push({ index: i, id, message: err.message });
    }
  });
  return { rules: Object.freeze(rules), errors };
}

/** One rule of `compileUrlRules`; throws on the first fault. Records its id in `seen` only when it compiles. */
function compileUrlRule(rule, i, seen) {
  const where = `url_rules[${i}]`;
  if (typeof rule?.id !== 'string' || !rule.id) throw new Error(`${where}: id is required`);
  if (seen.has(rule.id)) throw new Error(`${where}: duplicate rule id "${rule.id}"`);
  if (typeof rule.match !== 'string' || !rule.match)
    throw new Error(`${where}: match must be a regex string`);
  let re;
  try {
    re = new RegExp(rule.match);
  } catch (err) {
    throw new Error(`${where}: match is not a valid regex: ${err.message}`);
  }
  // The trailing empty alternative always matches '', so `groups` lists
  // every named group the pattern really has.
  const groups = new RegExp(`${rule.match}|`).exec('')?.groups;
  if (!groups || !Object.hasOwn(groups, 'id'))
    throw new Error(`${where}: match must have an (?<id>…) capture`);
  if (!rule.match.startsWith('^'))
    throw new Error(`${where}: match must be anchored with ^ (and usually $)`);
  if (!NAMESPACES.includes(rule.namespace))
    throw new Error(`${where}: unknown namespace "${rule.namespace}"`);
  const platform = rule.platform ?? null;
  if (platform !== null && (typeof platform !== 'string' || !platform))
    throw new Error(`${where}: platform must be a non-empty string when given`);
  // A worksheet scan is looked up on its platform; without one the rule would
  // compile and then answer `invalid` on every scan of the sheet.
  if (rule.namespace === 'worksheet' && platform === null)
    throw new Error(`${where}: a worksheet rule needs a platform`);
  // The `^` binds only to the first branch of a top-level alternation, so
  // `^https://a/…$|https://b/…` would leave the second branch free to match
  // mid-string. Wrapping the body puts every branch behind the anchor.
  re = new RegExp(`^(?:${rule.match.slice(1)})`);
  seen.add(rule.id);
  return Object.freeze({ id: rule.id, re, namespace: rule.namespace, platform });
}

/**
 * Resolve a scanned string to its owning domain.
 *
 * @param {unknown} code Raw scanned payload.
 * @param {object} [options]
 * @param {ReturnType<typeof compileUrlRules>} [options.urlRules]  compiled
 *   household URL rules for step 0. Absent means no URL is claimed.
 * @returns {{namespace: string|null, body: string, raw: string,
 *   form: 'url-rule'|'prefixed'|'legacy-prefixed'|'legacy-positional'|'shape'|'unknown',
 *   rule?: string, platform?: string|null}}
 *   `rule` and `platform` are present only on a `url-rule` result: the id of
 *   the rule that matched and the platform it names.
 *   `raw` is the TRIMMED input, not the verbatim argument — scanners append
 *   CR/LF, and every consumer wants the trimmed form (school looks its tokens up
 *   by that exact string). Non-string or blank input yields empty `body` and
 *   `raw`. `namespace` is null and `form` is 'unknown' when no step claims the
 *   code; `body` then holds the trimmed input untouched. That is the EXPECTED
 *   result for a bare UPC/EAN, not a failure — the caller is meant to finish the
 *   job with the reader's route. `namespace` never comes back as 'product' from
 *   here. See the module docstring for the resolution order and the `body`
 *   convention.
 */
export function parseScanCode(code, { urlRules = [] } = {}) {
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
    // step 0 — a URL. Never a tag: `https` is a scheme, and letting it fall to
    // step 3 sent every printed web link in the house to `content`.
    if (isUrlCode(raw)) {
      // First matching rule wins, in config order. See MAX_URL_RULE_INPUT.
      const rules = raw.length > MAX_URL_RULE_INPUT ? [] : urlRules;
      for (const rule of rules) {
        const m = rule.re.exec(raw);
        if (m?.groups?.id) {
          return {
            namespace: rule.namespace, body: m.groups.id, raw,
            form: 'url-rule', rule: rule.id, platform: rule.platform,
          };
        }
      }
      return { namespace: null, body: raw, raw, form: 'unknown' };
    }

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

  // step 4 — shape. ISBN-13 ONLY. Reached by input with no colon at all AND by
  // input whose first colon is at index 0 (an empty tag, excluded from steps 1-3
  // above); the latter can never be digits only, so shape still means what it
  // says.
  //
  // A bare UPC/EAN is deliberately NOT claimed here: it means whatever its
  // reader is configured for, so it falls to step 5 in the dispatcher. Claiming
  // it as `product` would make a grocery barcode log food on a CONTENT-routed
  // reader, where today it reaches `BarcodePayload.parse`, fails, and does
  // nothing. See the module docstring.
  if (DIGITS_ONLY.test(raw) && isIsbn13(raw))
    return { namespace: 'book', body: raw, raw, form: 'shape' };

  // step 6 — unknown. Explicit outcome, not a fall-through, and NOT a synonym
  // for malformed: it means "this module cannot say". `gibberish` and `:4` land
  // here because nothing can be made of them; `041260010682` lands here because
  // only the reader can say what it is for.
  return { namespace: null, body: raw, raw, form: 'unknown' };
}
