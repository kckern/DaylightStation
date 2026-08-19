// frontend/src/modules/Surround/typography.js
//
// THE FRAME SETS TYPE, SO IT SETS QUOTES.
//
// Every printed surface in this frame — the plate, the brass, the rail, the band
// — is Garamond on stock. A straight apostrophe is a typewriter mark: it exists
// because a 1960s keyboard had 44 keys, not because anyone ever cut one for a
// serif face. In Cormorant and EB Garamond the straight forms are not even
// designed; the engine substitutes a vertical tick that reads as a hyphen
// standing up. At ten feet, on parchment, it is the one thing in the frame that
// looks unset.
//
// The corpus is authored in YAML by hand, so it carries whatever the author
// typed: `Vivaldi marked the part 'the dog that barks'`, `dell'armonia`, `the
// violins' grief`, `Violin Concerto in E major, "Spring"`. Curling these at the
// SOURCE was rejected — the corpus is data, editable by a human who should not
// have to hunt for an option-key glyph, and a data migration would have to be
// re-run for every future edit. So the conversion happens at the RENDER SEAM:
// one function, called wherever the frame prints an authored string.
//
// WHAT IT DOES NOT DO
// -------------------
// No `--` -> em dash. The corpus was checked (every .yml under the classical
// library): it contains zero double-hyphens and 200+ real em dashes already
// typed as `—`. A transform with no input is a transform waiting to corrupt
// something — a CSS-ish or CLI-ish string that happens to reach a caption — so
// it is not here.
//
// No prime handling beyond LEAVING PRIMES ALONE. `5' 3"` is feet and inches and
// its marks are correct as typed; a digit before the mark, with no letter after
// it, is the signal, and those pass through untouched.
//
// IT IS IDEMPOTENT. Curly characters are not inputs to any rule — the state
// machine only ever counts STRAIGHT quotes — so running it twice, or over text
// an author already curled by hand, changes nothing.

/** A character that can carry an apostrophe on either side of it. */
const WORD = /[A-Za-z0-9À-ɏ]/;
/** A digit — the prime signal, and the year-elision signal (`'85`). */
const DIGIT = /[0-9]/;
/** A letter — what a leading elision or an opening quote is followed by. */
const LETTER = /[A-Za-zÀ-ɏ]/;

/**
 * The elisions that begin with an apostrophe rather than an opening quote.
 *
 * This is a CLOSED list on purpose. The ambiguity it resolves is genuine —
 * `'Tis` and `'Spring'` open identically — and the only honest tiebreaker is
 * knowing the words. Everything not on the list falls through to the
 * open-quote rule, which is the commoner case in a programme note.
 */
const ELISIONS = /^(tis|twas|twere|tween|til|em|n|bout|cause|round|gainst|neath|ere|er)\b/i;

/**
 * Curl one string's quotes and apostrophes.
 *
 * A single left-to-right pass with two bits of state (is a double quote open, is
 * a single quote open). Left to right is what lets `"He said 'the dog that
 * barks'."` nest correctly: each mark is decided by what it follows and what it
 * precedes, which is exactly how a compositor decides.
 *
 * @param {*} value anything; non-strings are returned unchanged so a call site
 *   can wrap a possibly-absent field without a guard of its own.
 * @returns {*} the same value, with `'` and `"` replaced by their typographic
 *   forms. Curly input, primes, and non-strings are returned untouched.
 */
export function smartQuotes(value) {
  if (typeof value !== 'string' || !value) return value;
  if (!value.includes("'") && !value.includes('"')) return value;

  const chars = Array.from(value);
  let out = '';
  let doubleOpen = false;
  let singleOpen = false;

  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i];
    const prev = i > 0 ? chars[i - 1] : '';
    const next = i + 1 < chars.length ? chars[i + 1] : '';

    if (c === '"') {
      // An inch mark: a digit before it and no letter after it. `12" of snow`.
      if (DIGIT.test(prev) && !LETTER.test(next)) { out += c; continue; }
      // Opening only if nothing is open AND we are at a place a quote can begin
      // — the start of the string, or after space/dash/bracket. Otherwise it
      // closes, which is also the right answer for a stray straight quote.
      const opening = !doubleOpen && (i === 0 || !WORD.test(prev));
      out += opening ? '“' : '”';
      doubleOpen = opening;
      continue;
    }

    if (c === "'") {
      // A foot mark, same signal as the inch mark above. `5' 3"`.
      if (DIGIT.test(prev) && !LETTER.test(next)) { out += c; continue; }

      // Between two word characters this is always an apostrophe — a
      // contraction (`don't`) or an elided vowel (`dell'armonia`). No quote
      // pairing can produce this shape.
      // `singleOpen` is deliberately NOT cleared here: an apostrophe inside a
      // quotation does not end it (`'the dog's bark'`).
      if (WORD.test(prev) && WORD.test(next)) { out += '’'; continue; }

      if (!WORD.test(prev)) {
        // Leading. Three possibilities, in the order a compositor resolves them.
        //   1. An elided year: `'85`.
        if (DIGIT.test(next)) { out += '’'; continue; }
        //   2. A known elision: `'Tis`, `rock 'n' roll`.
        if (ELISIONS.test(chars.slice(i + 1).join(''))) { out += '’'; continue; }
        //   3. An opening quote — but ONLY if something later could close it.
        //      `'Spring'` opens; a lone leading tick with no partner is far
        //      likelier to be an elision this list has not heard of than an
        //      unclosed quotation, so it curls closed rather than opening a
        //      quotation that never ends.
        if (!singleOpen && chars.indexOf("'", i + 1) !== -1) {
          out += '‘';
          singleOpen = true;
          continue;
        }
        out += '’';
        continue;
      }

      // After a word, not before one. Either a possessive plural (`the violins'
      // grief`) or the close of a quotation (`...that barks'.`). BOTH are the
      // right single quote, so the ambiguity has no consequence in the output —
      // only the open/close bookkeeping cares which it was.
      singleOpen = false;
      out += '’';
      continue;
    }

    out += c;
  }

  return out;
}

/**
 * Curl every string in a list, dropping nothing.
 *
 * Convenience for the pools the band and the rail rotate (facts, listening
 * notes) so a call site does not write `.map(smartQuotes)` five times and get it
 * subtly different once.
 */
export function smartQuotesAll(values) {
  return Array.isArray(values) ? values.map(smartQuotes) : values;
}

export default smartQuotes;
