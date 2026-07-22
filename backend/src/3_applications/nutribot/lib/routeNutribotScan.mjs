/**
 * Decide where a barcode scanned on a nutribot-routed reader should go.
 *
 * PURE — no store, no I/O, no logging. The composition root (`app.mjs`) used to
 * hold this decision inline, which made it untestable and let a real defect hide
 * there: when `validateScanConfig` threw at boot, `applyScanToComposition` stayed
 * null, the `if (scaleId && applyScanToComposition)` branch took NEITHER arm, and
 * a `dl:4` fell straight through to `getLogFoodFromUPC()` — a fridge-sheet code
 * sent to a product database, which answers with a nonsense food or nothing.
 *
 * `parseScan` is the authority on whether a code belongs to the fridge sheet, and
 * consulting it (rather than the presence of a use case) is what makes the
 * disabled path correct: a code the grammar claims is SWALLOWED even when there
 * is nothing to apply it to. Nutriscan being broken must degrade to "the scan
 * does nothing", never to "the scan does something wrong".
 *
 * UPC/EAN are digit-only and can never take the `<prefix>:<rest>` shape, so
 * ordering the grammar ahead of the UPC lookup cannot shadow a product scan.
 *
 * @module nutribot/lib/routeNutribotScan
 */

import { parseScan } from '#domains/nutrition/index.mjs';

/**
 * @param {object} input
 * @param {string|null} input.scaleId   scale the reader is bound to, if any
 * @param {string} input.code           raw scanned code
 * @param {{execute: Function}|null} input.apply  ApplyScanToComposition, or null when disabled
 * @returns {{action: 'nutriscan', outcome: object}
 *          |{action: 'swallow', reason: 'nutriscan-disabled'|'no-scale-id'}
 *          |{action: 'upc'}}
 */
export function routeNutribotScan({ scaleId, code, apply }) {
  if (scaleId && apply) {
    const outcome = apply.execute({ scaleId, code });
    // `handled` — never `ok`. A REFUSAL is still a claim: `ct:teapot` is
    // unmistakably a fridge-sheet code, and looking it up as a product UPC
    // would answer a typo with a nonsense food.
    if (outcome?.handled) return { action: 'nutriscan', outcome };
    return { action: 'upc' };
  }

  // Nutriscan cannot run for this scan. Anything the grammar claims dead-ends
  // here; only genuine product barcodes carry on to the UPC lookup.
  if (parseScan(code)) {
    return { action: 'swallow', reason: apply ? 'no-scale-id' : 'nutriscan-disabled' };
  }
  return { action: 'upc' };
}

/**
 * One-line, user-facing reason a scan was refused, for the transient `⚠️` line
 * on the live scale prompt. A refused scan never reaches the buffer, so there is
 * nothing in the composition to render from — without this the user sees
 * NOTHING, which is the silent failure the ACK exists to prevent.
 *
 * @param {{kind?: string, error?: string, id?: string, level?: number}} outcome
 * @returns {string}
 */
export function nutriscanRefusalNotice(outcome = {}) {
  if (outcome.error === 'UNKNOWN_CONTAINER') return `unknown container "${outcome.id}" — not tared`;
  if (outcome.error === 'UNKNOWN_DENSITY_LEVEL') return `unknown density level ${outcome.level} — not set`;
  return `scan not applied (${outcome.error || 'refused'})`;
}

export default routeNutribotScan;
