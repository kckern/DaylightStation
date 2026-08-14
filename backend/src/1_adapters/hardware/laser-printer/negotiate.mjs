/**
 * negotiate.mjs — pick a document format (and resolution) a printer will
 * ACTUALLY accept, from its own advertised IPP capabilities. Pure functions,
 * no I/O: LaserPrinterAdapter fetches the capabilities over IPP and hands
 * them here.
 *
 * This module exists because of a production incident: the adapter used to
 * assume `application/octet-stream` meant "the printer will figure it out"
 * and shipped a raw PDF to a Brother HL-L2460DW over JetDirect on that
 * premise. The printer has no PDF interpreter — its auto-detect fell back to
 * plain text and printed the PDF's own source until the paper tray emptied.
 * `application/octet-stream` being present in `document-format-supported`
 * must NEVER be treated as "anything goes"; `chooseDocumentFormat` only ever
 * returns a format the printer named explicitly (or, for a PDF payload, a
 * raster format we can rasterize the PDF into that the printer named
 * explicitly). If neither is possible, it returns null and the caller must
 * refuse to transmit.
 *
 * @module adapters/hardware/laser-printer/negotiate
 */

/** Raster formats this adapter knows how to produce from a PDF (via ghostscript), in preference order. */
export const RASTER_FORMATS = ['image/urf', 'image/pwg-raster'];

/** The DPI this adapter reaches for when the printer supports it — plenty for text/line-art worksheets. */
export const PREFERRED_DPI = 300;

/** Fallback DPI when the printer's capabilities don't yield anything usable. */
export const FALLBACK_DPI = 300;

/** This device's default media; used when the printer doesn't advertise a `media-default`. */
export const DEFAULT_MEDIA = 'na_letter_8.5x11in';

/**
 * @param {Object} params
 * @param {string} params.payloadFormat - the format of the bytes we currently have, e.g. 'application/pdf'
 * @param {string[]} [params.supported] - printer's `document-format-supported`
 * @param {?string} [params.preferred] - printer's `document-format-preferred`
 * @returns {?{format: string, needsRasterize: boolean}} null when nothing safe is possible — caller MUST refuse to send
 */
export function chooseDocumentFormat({ payloadFormat, supported = [], preferred = null }) {
  const supportedSet = new Set(supported);

  // 1. The printer explicitly lists the format we already have — send as-is.
  //    `application/octet-stream` never satisfies this branch even when the
  //    payload nominally "is" octet-stream-shaped bytes: it's a catch-all
  //    declaration, not a confirmation the printer understood anything, and
  //    trusting it is the mistake that caused the incident this module
  //    exists to prevent.
  if (payloadFormat !== 'application/octet-stream' && supportedSet.has(payloadFormat)) {
    return { format: payloadFormat, needsRasterize: false };
  }

  // 2. Payload is a PDF and the printer doesn't take PDF directly — see if it
  //    lists a raster format we can produce with ghostscript. Prefer the
  //    printer's own `document-format-preferred` when it's one we can make
  //    and the printer actually supports it; otherwise take whichever raster
  //    format appears first in our preference order.
  if (payloadFormat === 'application/pdf') {
    if (preferred && RASTER_FORMATS.includes(preferred) && supportedSet.has(preferred)) {
      return { format: preferred, needsRasterize: true };
    }
    const fallback = RASTER_FORMATS.find((f) => supportedSet.has(f));
    if (fallback) return { format: fallback, needsRasterize: true };
  }

  // 3. Nothing safe: no direct match, and no raster path this adapter can
  //    produce. Caller refuses to transmit rather than guess.
  return null;
}

/**
 * Pick a DPI the printer has actually advertised, preferring 300 (plenty for
 * text/line-art worksheets, universally supported) when it's on offer, and
 * otherwise the lowest resolution the printer lists — never a number we made
 * up. Falls back to FALLBACK_DPI only when the printer's capabilities gave
 * us nothing parseable.
 *
 * @param {Object} params
 * @param {Array<{xres:number, yres:number, units:number}>} [params.printerResolutionSupported] - decoded `printer-resolution-supported`
 * @param {string[]} [params.urfSupported] - decoded `urf-supported` keyword tokens
 * @returns {number} DPI
 */
export function chooseResolution({ printerResolutionSupported = [], urfSupported = [] } = {}) {
  // Prefer the structured RFC 8011 attribute: exact {xres, yres, units}
  // entries the printer will actually render. units === 3 is dots/inch
  // (units === 4 is dots/cm, which we don't bother converting — DPI-shaped
  // entries are what every printer we support actually sends).
  const dpiCandidates = printerResolutionSupported
    .filter((r) => r && r.units === 3)
    .map((r) => r.xres)
    .filter((n) => Number.isFinite(n) && n > 0);

  if (dpiCandidates.length) {
    return dpiCandidates.includes(PREFERRED_DPI) ? PREFERRED_DPI : Math.min(...dpiCandidates);
  }

  // Fall back to the PWG `urf-supported` keyword set (PWG 5100.13), which
  // encodes supported resolutions as a token like "RS300" or "RS300-600".
  for (const token of urfSupported) {
    const m = /^RS([\d-]+)$/.exec(token);
    if (!m) continue;
    const values = m[1].split('-').map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (values.length) return values.includes(PREFERRED_DPI) ? PREFERRED_DPI : Math.min(...values);
  }

  return FALLBACK_DPI;
}
