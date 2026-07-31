/**
 * Scan grammar for fridge-sheet QR codes.
 *
 * Imported by BOTH the scan parser and the PDF sheet generator so the printed
 * page can never drift from the parser. This module is the single owner of the
 * grammar — neither consumer may build these strings itself.
 *
 * The encoders validate against the SAME constants the parser uses and throw on
 * unencodable input. That is deliberate: an unvalidated encoder would render a
 * scannable QR that parses to null, and the defect would only surface after the
 * sheet was printed and laminated. Failing at PDF-generation time is cheap.
 *
 * The grammar is case-sensitive throughout. `DL:4` and `ct:Mug` both return
 * null; the encoders control the printed string, so nothing needs to be lenient,
 * and a mixed-case id would not match its `containers.items` key anyway.
 *
 * Namespace note: content barcodes use a colon grammar too — `<command>:<arg>`
 * and `<screen>:<command>` (see `2_domains/barcode/BarcodePayload.mjs` for the
 * segment parsing and `BarcodeCommandMap.mjs` for the command names). There is
 * no shared registry between the two grammars, so this module claims ONLY the
 * three prefixes below and returns null for everything else, letting content
 * dispatch proceed untouched. Real product barcodes (UPC/EAN) are digit-only
 * and therefore never match. The one theoretical collision is a screen named
 * `dl`, `ct`, or `rs`; keep screen names out of that set.
 *
 * @module nutrition/services/ScanVocabularyService
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

const DENSITY_PREFIX = 'dl';
const CONTAINER_PREFIX = 'ct';
// 'rs' rather than 'ctl'/'rst' so no prefix is a near-twin of another — a
// single misread character should not turn one kind of scan into another.
// Named CONTROL_ rather than RESET_ because the namespace now carries three
// verbs; the prefix string itself is frozen by every sheet already printed and
// by `LEGACY_NUTRITION_TAGS` in `2_domains/scan/ScanCode.mjs`, so it stays 'rs'.
const CONTROL_PREFIX = 'rs';

/**
 * Highest ORDINAL caloric-density level in the config table.
 *
 * This is the 1..9 rung number that `density_levels` rows are keyed by and that
 * `Composition` stores. It is NOT what gets printed — see `MAX_DENSITY_CODE`.
 */
export const MAX_DENSITY_LEVEL = 9;

/**
 * Upper bound on the PRINTED density payload, in kcal per 100 g.
 *
 * The two numbers are deliberately different things:
 *
 *   config row     level: 4, kcal_per_g: 1.4     <- ordinal, human-ordered
 *   printed code   dl:140                        <- physical, 1.4 kcal/g
 *
 * The printed code carries the QUANTITY so that reading it needs no table. Under
 * the old scheme the sheet printed the ordinal (`dl:4`), which meant a laminated
 * code was a pointer into a list: inserting a tenth density between two existing
 * rungs renumbered every card after it and silently re-pointed printed codes at
 * the wrong calories. A code that says 140 cannot be re-pointed by an edit to a
 * neighbouring row. The container grammar does the same with grams (`ct:160`).
 *
 * 2000 kcal/100 g = 20 kcal/g, comfortably past pure fat (~9). The ceiling bounds
 * the printed payload; it does not describe any real food.
 *
 * The table is still READ — `computeNutrition` needs the row's macro split, which
 * no single number can carry, and the ack needs its label. What the scan no
 * longer needs the table for is the calorie figure itself.
 */
export const MAX_DENSITY_CODE = 2000;

/** Canonical container id shape. Case-sensitive — must match `containers.items` keys. */
const CONTAINER_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Printed payload shape for both numeric grammars: digits, no leading zeros. */
const DENSITY_LEVEL_RE = /^[1-9][0-9]*$/;

/** Tare payload: grams, `0` allowed (a weightless liner is a legitimate tare). */
const CONTAINER_TARE_RE = /^(0|[1-9][0-9]*)$/;

/** Highest printable tare. 9999 g keeps the payload to four digits. */
const MAX_CONTAINER_TARE_G = 9999;

const isDensityCode = (v) => Number.isInteger(v) && v >= 1 && v <= MAX_DENSITY_CODE;
const isTareGrams = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_CONTAINER_TARE_G;

/**
 * Control verbs — the punctuation of the grammar.
 *
 * Density and container scans accumulate a composition; these three say what to
 * do with the sequence itself. The scale reports a weight, then the human scans
 * a container and a density as SEPARATE events over a time window, so there is
 * no payload boundary to signal intent — these codes are it.
 *
 * Frozen ARRAY rather than a Set, matching `LEGACY_NUTRITION_TAGS` in
 * `2_domains/scan/ScanCode.mjs`: `Object.freeze` does not stop `Set.prototype.add`,
 * so a frozen Set would advertise an immutability it does not have. Three
 * entries make `includes` free.
 */
export const CONTROL_VERBS = Object.freeze(['clear', 'undo', 'done']);

/**
 * Verb (what is printed) → parsed kind (what consumers switch on).
 *
 * ASYMMETRIC ON PURPOSE: the verb `clear` parses to kind `'reset'`, not
 * `'clear'`. `reset` predates the other two verbs and
 * `3_applications/nutribot/usecases/ApplyScanToComposition.mjs` switches on
 * `parsed.kind === 'reset'`. Aligning the kind to the verb would read tidier and
 * would silently disable the ONE control code that exists in the field — a
 * laminated sheet whose reset button stops working with no error anywhere.
 * The mapping is spelled out here so the asymmetry is a decision, not a leftover.
 */
const CONTROL_VERB_KINDS = Object.freeze(Object.assign(Object.create(null), {
  clear: 'reset',
  undo: 'undo',
  done: 'done',
}));

/**
 * The code that clears any pending density/container selection.
 *
 * Kept as a named export because docs, plans, and sheet configs reference it by
 * name; it is exactly `encodeControl('clear')`.
 */
export const RESET_CODE = `${CONTROL_PREFIX}:clear`;

/**
 * @param {number} kcalPer100g Caloric density in kcal per 100 g, 1..MAX_DENSITY_CODE.
 *   NOT the ordinal `level` — pass `Math.round(row.kcal_per_g * 100)`.
 * @returns {string} Scan code to print on the sheet.
 * @throws {ValidationError} If the value would print a code the parser rejects.
 */
export function encodeDensity(kcalPer100g) {
  if (!isDensityCode(kcalPer100g)) {
    throw new ValidationError(
      `Density code must be an integer 1-${MAX_DENSITY_CODE} (kcal per 100 g)`,
      { code: 'INVALID_DENSITY_LEVEL', field: 'kcalPer100g', value: kcalPer100g },
    );
  }
  return `${DENSITY_PREFIX}:${kcalPer100g}`;
}

/**
 * @param {number} grams Tare weight in grams, 0..MAX_CONTAINER_TARE_G. NOT the
 *   container id — the printed code carries the weight, not the name.
 * @returns {string} Scan code to print on the sheet.
 * @throws {ValidationError} If the value would print a code the parser rejects.
 */
export function encodeContainer(grams) {
  if (!isTareGrams(grams)) {
    throw new ValidationError(
      `Container tare must be an integer 0-${MAX_CONTAINER_TARE_G} grams`,
      { code: 'INVALID_CONTAINER_ID', field: 'grams', value: grams },
    );
  }
  return `${CONTAINER_PREFIX}:${grams}`;
}

/**
 * @param {string} verb One of CONTROL_VERBS: 'clear', 'undo', or 'done'.
 * @returns {string} Scan code to print on the sheet.
 * @throws {ValidationError} If the verb would print a code the parser rejects.
 */
export function encodeControl(verb) {
  if (typeof verb !== 'string' || !CONTROL_VERBS.includes(verb)) {
    throw new ValidationError(
      `Control verb must be one of: ${CONTROL_VERBS.join(', ')}`,
      { code: 'INVALID_CONTROL_VERB', field: 'verb', value: verb },
    );
  }
  return `${CONTROL_PREFIX}:${verb}`;
}

/**
 * Parse a scanned string into a fridge-sheet command.
 *
 * Both numeric grammars yield a PHYSICAL QUANTITY, not a config key. Resolving
 * that quantity back to a table row (for macros, label, emoji) is the caller's
 * job — see `densityForCode` / `containerForTare`.
 *
 * @param {unknown} code Raw scanned payload.
 * @returns {{kind: 'density', kcalPer100g: number}
 *          |{kind: 'container', grams: number}
 *          |{kind: 'reset'}
 *          |{kind: 'undo'}
 *          |{kind: 'done'}
 *          |null} Parsed command, or null if this grammar does not claim it.
 */
export function parseScan(code) {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim();
  const idx = trimmed.indexOf(':');
  if (idx <= 0) return null;

  const prefix = trimmed.slice(0, idx);
  const rest = trimmed.slice(idx + 1);

  if (prefix === DENSITY_PREFIX) {
    if (!DENSITY_LEVEL_RE.test(rest)) return null;
    const kcalPer100g = Number(rest);
    return isDensityCode(kcalPer100g) ? { kind: 'density', kcalPer100g } : null;
  }
  if (prefix === CONTAINER_PREFIX) {
    if (!CONTAINER_TARE_RE.test(rest)) return null;
    const grams = Number(rest);
    return isTareGrams(grams) ? { kind: 'container', grams } : null;
  }
  if (prefix === CONTROL_PREFIX) {
    // Null-prototype map, so `rs:constructor` and `rs:__proto__` cannot resolve
    // an inherited member and hand back a non-kind. Exact match on a bare verb:
    // `rs:clear:extra` and `rs:` are different strings and stay unclaimed.
    const kind = CONTROL_VERB_KINDS[rest];
    return kind ? { kind } : null;
  }
  return null;
}
