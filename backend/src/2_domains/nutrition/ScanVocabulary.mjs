/**
 * Scan grammar for fridge-sheet QR codes.
 *
 * Imported by BOTH the scan parser and the PDF sheet generator so the printed
 * page can never drift from the parser. This module is the single owner of the
 * grammar — neither consumer may build these strings itself.
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
 * @module nutrition/ScanVocabulary
 */

const DENSITY_PREFIX = 'dl';
const CONTAINER_PREFIX = 'ct';
// 'rs' rather than 'ctl'/'rst' so no prefix is a near-twin of another — a
// single misread character should not turn one kind of scan into another.
const RESET_PREFIX = 'rs';

/** The single code that clears any pending density/container selection. */
export const RESET_CODE = `${RESET_PREFIX}:clear`;

/**
 * @param {number} level Caloric-density level, 1-9.
 * @returns {string} Scan code to print on the sheet.
 */
export const encodeDensity = (level) => `${DENSITY_PREFIX}:${level}`;

/**
 * @param {string} id Container/tare id, e.g. 'dinner-bowl'.
 * @returns {string} Scan code to print on the sheet.
 */
export const encodeContainer = (id) => `${CONTAINER_PREFIX}:${id}`;

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
  if (!rest) return null;

  if (prefix === DENSITY_PREFIX) {
    if (!/^[1-9]$/.test(rest)) return null;
    return { kind: 'density', level: Number(rest) };
  }
  if (prefix === CONTAINER_PREFIX) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(rest)) return null;
    return { kind: 'container', id: rest };
  }
  if (prefix === RESET_PREFIX) {
    return rest === 'clear' ? { kind: 'reset' } : null;
  }
  return null;
}

export default { parseScan, encodeDensity, encodeContainer, RESET_CODE };
