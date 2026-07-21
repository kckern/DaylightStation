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
const RESET_PREFIX = 'rs';

/**
 * Highest caloric-density level in the grammar.
 *
 * Must stay in lockstep with the `density_levels` table in
 * `_extensions/food-scale-relay/config.example.yml` (currently levels 1-9). The
 * config validator asserts that table against this constant, so a tenth level
 * cannot reach the printed sheet without the parser learning to accept `dl:10`.
 */
export const MAX_DENSITY_LEVEL = 9;

/** Canonical container id shape. Case-sensitive — must match `containers.items` keys. */
const CONTAINER_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Density payload shape: digits, no leading zeros. Range checked separately. */
const DENSITY_LEVEL_RE = /^[1-9][0-9]*$/;

const isDensityLevel = (level) =>
  Number.isInteger(level) && level >= 1 && level <= MAX_DENSITY_LEVEL;

/** The single code that clears any pending density/container selection. */
export const RESET_CODE = `${RESET_PREFIX}:clear`;

/**
 * @param {number} level Caloric-density level, 1..MAX_DENSITY_LEVEL.
 * @returns {string} Scan code to print on the sheet.
 * @throws {ValidationError} If the level would print a code the parser rejects.
 */
export function encodeDensity(level) {
  if (!isDensityLevel(level)) {
    throw new ValidationError(
      `Density level must be an integer 1-${MAX_DENSITY_LEVEL}`,
      { code: 'INVALID_DENSITY_LEVEL', field: 'level', value: level },
    );
  }
  return `${DENSITY_PREFIX}:${level}`;
}

/**
 * @param {string} id Container/tare id, e.g. 'dinner-bowl'.
 * @returns {string} Scan code to print on the sheet.
 * @throws {ValidationError} If the id would print a code the parser rejects.
 */
export function encodeContainer(id) {
  if (typeof id !== 'string' || !CONTAINER_ID_RE.test(id)) {
    throw new ValidationError(
      'Container id must be lowercase alphanumeric with hyphens (e.g. "dinner-bowl")',
      { code: 'INVALID_CONTAINER_ID', field: 'id', value: id },
    );
  }
  return `${CONTAINER_PREFIX}:${id}`;
}

/**
 * Parse a scanned string into a fridge-sheet command.
 *
 * @param {unknown} code Raw scanned payload.
 * @returns {{kind: 'density', level: number}
 *          |{kind: 'container', id: string}
 *          |{kind: 'reset'}
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
    const level = Number(rest);
    return isDensityLevel(level) ? { kind: 'density', level } : null;
  }
  if (prefix === CONTAINER_PREFIX) {
    return CONTAINER_ID_RE.test(rest) ? { kind: 'container', id: rest } : null;
  }
  if (prefix === RESET_PREFIX) {
    return rest === 'clear' ? { kind: 'reset' } : null;
  }
  return null;
}
