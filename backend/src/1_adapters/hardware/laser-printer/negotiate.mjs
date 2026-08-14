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
 * ── Incident #2, 2026-08 ─────────────────────────────────────────────────
 * Fixing the container format was not enough. A real worksheet scan went
 * through the (correct!) `image/urf` container, over IPP, to a printer that
 * had genuinely advertised `image/urf` — and the printer silently ate it.
 * Reason: `document-format-supported` says which ENVELOPE the printer will
 * open, not what has to be INSIDE it. This Brother (like every AirPrint-class
 * raster printer) separately declares, per envelope, the exact pixel format
 * it will decode:
 *
 *   urf-supported                            = ["W8", ..., "RS300-600-1200", ...]
 *   pwg-raster-document-type-supported       = ["sgray_8"]
 *   pwg-raster-document-resolution-supported = [{600,600}]
 *
 * `W8` means 8-bit grayscale; `sgray_8` means the same thing in PWG raster's
 * own vocabulary. Ghostscript's raster devices do NOT default to that — left
 * alone they emit 1-bit monochrome (`BitsPerPixel: 1` is the device's own
 * built-in default, confirmed by querying `currentpagedevice`), which is a
 * DIFFERENT bit depth than what either capability list names. A printer that
 * only ever agreed to `W8`/`sgray_8` has no obligation to accept 1-bit input,
 * and this one didn't: it took the bytes and produced nothing.
 *
 * The lesson generalizes past bit depth: resolution has the identical trap.
 * `urf-supported`'s `RS300-600-1200` token permits 300/600/1200 DPI for the
 * URF envelope specifically; `pwg-raster-document-resolution-supported`
 * permits ONLY 600 DPI for the PWG-raster envelope. These are readings of
 * TWO DIFFERENT ATTRIBUTES, scoped to two different envelopes — reusing one
 * envelope's resolution list for the other's raster is exactly the kind of
 * assumption this whole module exists to refuse. `chooseResolution` below
 * takes the target format as an explicit parameter for this reason: there is
 * no "the" resolution a printer supports, only the resolution it supports
 * FOR THE ENVELOPE ABOUT TO BE FILLED.
 *
 * `chooseUrfColor`/`choosePwgRasterColor` parse those capability lists into
 * concrete pixel parameters (channel count, bits per channel, and — for PWG
 * raster — the standard `cupsColorSpace` numeric token that drives
 * ghostscript's `-dcupsColorSpace` device switch) instead of hard-coding
 * "this Brother wants grayscale": a different printer's advertised token set
 * drives a different answer, the same way `chooseDocumentFormat` never
 * assumed which envelope a printer would open.
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

/** Bits-per-color this adapter reaches for when a printer's advertised token offers it — 8-bit is what every raster worksheet/quiz page in this app is rendered at. */
export const PREFERRED_BITS_PER_COLOR = 8;

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
 * Pick a DPI the printer has actually advertised FOR THE GIVEN CONTAINER
 * FORMAT, preferring PREFERRED_DPI when it's on offer, and otherwise the
 * lowest resolution the printer lists for that format — never a number we
 * made up, and never a number borrowed from a different format's capability
 * list (see this module's header comment — `RS300-600-1200` on `urf-supported`
 * does not mean PWG raster gets 300 DPI too).
 *
 * @param {Object} params
 * @param {string} params.format - 'image/urf' | 'image/pwg-raster' — which envelope's resolution list to read
 * @param {string[]} [params.urfSupported] - decoded `urf-supported` keyword tokens (read for format === 'image/urf')
 * @param {Array<{xres:number, yres:number, units:number}>} [params.pwgRasterResolutionSupported] - decoded `pwg-raster-document-resolution-supported` (read for format === 'image/pwg-raster')
 * @param {Array<{xres:number, yres:number, units:number}>} [params.printerResolutionSupported] - decoded `printer-resolution-supported` — a format-agnostic LAST RESORT, only consulted when the format-specific list above gave nothing parseable
 * @returns {number} DPI
 */
export function chooseResolution({
  format, urfSupported = [], pwgRasterResolutionSupported = [], printerResolutionSupported = [],
} = {}) {
  const fromDpiList = (candidates) => {
    if (!candidates.length) return null;
    return candidates.includes(PREFERRED_DPI) ? PREFERRED_DPI : Math.min(...candidates);
  };

  if (format === 'image/pwg-raster') {
    const dpis = pwgRasterResolutionSupported
      .filter((r) => r && (r.units === undefined || r.units === 3))
      .map((r) => r.xres)
      .filter((n) => Number.isFinite(n) && n > 0);
    const chosen = fromDpiList(dpis);
    if (chosen) return chosen;
  } else if (format === 'image/urf') {
    // URF's own resolution declaration is the `RS` token inside
    // `urf-supported` (PWG 5100.13), e.g. "RS300-600-1200" — NOT the
    // structured `printer-resolution-supported` attribute, which describes
    // the printer's engine in general and may include resolutions this
    // specific envelope never agreed to.
    for (const token of urfSupported) {
      const m = /^RS([\d-]+)$/.exec(token);
      if (!m) continue;
      const values = m[1].split('-').map(Number).filter((n) => Number.isFinite(n) && n > 0);
      const chosen = fromDpiList(values);
      if (chosen) return chosen;
    }
  }

  // Last resort: the generic, format-agnostic attribute. Only reached when
  // the format-specific list above was empty/unparseable — a printer that DID
  // publish a format-specific list already got the answer above and never
  // falls through to here.
  const generic = printerResolutionSupported
    .filter((r) => r && r.units === 3)
    .map((r) => r.xres)
    .filter((n) => Number.isFinite(n) && n > 0);
  const chosen = fromDpiList(generic);
  if (chosen) return chosen;

  return FALLBACK_DPI;
}

/**
 * Canonical pixel-format families this adapter can drive ghostscript to
 * produce, keyed by a name independent of either format's own token
 * spelling. `cupsColorSpace` is the numeric value ghostscript's `urf` and
 * `pwgraster` devices both accept via `-dcupsColorSpace` (confirmed
 * empirically against this deployment's ghostscript: 18 → 1 channel/8bpp
 * grayscale output, 19 → 3 channel/24bpp sRGB, matching the CUPS `raster.h`
 * enum `CUPS_CSPACE_SW`/`CUPS_CSPACE_SRGB` — see rasterize.mjs for how this
 * was cross-checked against an independent decoder).
 */
const COLOR_FAMILY = {
  gray: { channels: 1, cupsColorSpace: 18, printColorMode: 'monochrome' },
  rgb: { channels: 3, cupsColorSpace: 19, printColorMode: 'color' },
  adobergb: { channels: 3, cupsColorSpace: 20, printColorMode: 'color' },
  cmyk: { channels: 4, cupsColorSpace: 6, printColorMode: 'color' },
};

/** `pwg-raster-document-type-supported` token prefix (before the `_<bits>` suffix) -> color family. */
const PWG_TOKEN_FAMILY = {
  sgray: 'gray', black: 'gray', white: 'gray',
  srgb: 'rgb', rgb: 'rgb',
  adobergb: 'adobergb',
  cmyk: 'cmyk',
};

/** `urf-supported` CS token prefix (before the bpp suffix, e.g. "W" in "W8") -> color family. */
const URF_TOKEN_FAMILY = {
  W: 'gray', DEVW: 'gray',
  SRGB: 'rgb', RGB: 'rgb', DEVRGB: 'rgb',
  ADOBERGB: 'adobergb',
  CMYK: 'cmyk', DEVCMYK: 'cmyk',
};

/**
 * Parse `pwg-raster-document-type-supported` (tokens like "sgray_8",
 * "black_1", "srgb_8") into a concrete pixel-format plan. Prefers an 8-bit
 * grayscale token (what this adapter's worksheets/quizzes need); falls back
 * to any grayscale token, then to the first parseable token at all, so a
 * color-only printer still gets a usable answer rather than null.
 *
 * @param {string[]} [pwgRasterDocumentTypeSupported]
 * @returns {?{token:string, family:string, channels:number, bitsPerColor:number, bitsPerPixel:number, cupsColorSpace:number, printColorMode:string}}
 */
export function choosePwgRasterColor(pwgRasterDocumentTypeSupported = []) {
  const parsed = pwgRasterDocumentTypeSupported
    .map((token) => {
      const m = /^([a-z]+)_(\d+)$/.exec(token);
      if (!m) return null;
      const family = PWG_TOKEN_FAMILY[m[1]];
      if (!family) return null;
      const bitsPerColor = Number(m[2]);
      const { channels, cupsColorSpace, printColorMode } = COLOR_FAMILY[family];
      return { token, family, channels, bitsPerColor, bitsPerPixel: channels * bitsPerColor, cupsColorSpace, printColorMode };
    })
    .filter(Boolean);

  return (
    parsed.find((p) => p.family === 'gray' && p.bitsPerColor === PREFERRED_BITS_PER_COLOR)
    || parsed.find((p) => p.family === 'gray')
    || parsed[0]
    || null
  );
}

/**
 * Parse `urf-supported` CS tokens (e.g. "W8", "SRGB24", "ADOBERGB24",
 * "DEVW8", "DEVRGB24", "CMYK32") into a concrete pixel-format plan. Same
 * preference order as `choosePwgRasterColor`: 8-bit grayscale, then any
 * grayscale, then whatever parsed first.
 *
 * @param {string[]} [urfSupported]
 * @returns {?{token:string, family:string, channels:number, bitsPerColor:number, bitsPerPixel:number, cupsColorSpace:number, printColorMode:string}}
 */
export function chooseUrfColor(urfSupported = []) {
  const parsed = urfSupported
    .map((token) => {
      const m = /^([A-Z]+)(\d+)$/.exec(token);
      if (!m) return null;
      const family = URF_TOKEN_FAMILY[m[1]];
      if (!family) return null;
      const bitsPerPixel = Number(m[2]);
      const { channels, cupsColorSpace, printColorMode } = COLOR_FAMILY[family];
      if (bitsPerPixel % channels !== 0) return null; // malformed token for this family — refuse rather than guess
      const bitsPerColor = bitsPerPixel / channels;
      return { token, family, channels, bitsPerColor, bitsPerPixel, cupsColorSpace, printColorMode };
    })
    .filter(Boolean);

  return (
    parsed.find((p) => p.family === 'gray' && p.bitsPerColor === PREFERRED_BITS_PER_COLOR)
    || parsed.find((p) => p.family === 'gray')
    || parsed[0]
    || null
  );
}

/**
 * Top-level orchestrator: decide the WHOLE print plan — container format,
 * and (when rasterizing) the exact pixel parameters — from a printer's raw
 * decoded capabilities. This is where "pick the format that can actually be
 * satisfied" (point 2 of the fix) lives: `chooseDocumentFormat` picks a
 * preferred container, but if THAT container's own raster capability list
 * turns out to have nothing this adapter can parse/produce, this function
 * tries the other raster format before giving up — never sends a container
 * whose pixel format we had to guess.
 *
 * @param {Object} params
 * @param {string} params.payloadFormat - e.g. 'application/pdf'
 * @param {string[]} params.documentFormatSupported
 * @param {?string} params.documentFormatPreferred
 * @param {string[]} [params.urfSupported]
 * @param {string[]} [params.pwgRasterDocumentTypeSupported]
 * @param {Array} [params.pwgRasterResolutionSupported]
 * @param {Array} [params.printerResolutionSupported]
 * @param {string} [params.media]
 * @returns {?{format:string, needsRasterize:boolean, raster?:Object}} null when no format's constraints are satisfiable
 */
export function negotiatePrintPlan({
  payloadFormat, documentFormatSupported, documentFormatPreferred,
  urfSupported = [], pwgRasterDocumentTypeSupported = [], pwgRasterResolutionSupported = [],
  printerResolutionSupported = [], media = DEFAULT_MEDIA,
}) {
  const chosen = chooseDocumentFormat({
    payloadFormat, supported: documentFormatSupported, preferred: documentFormatPreferred,
  });
  if (!chosen) return null;
  if (!chosen.needsRasterize) return { format: chosen.format, needsRasterize: false };

  const supportedSet = new Set(documentFormatSupported);
  const candidates = [chosen.format, ...RASTER_FORMATS.filter((f) => f !== chosen.format)]
    .filter((f) => supportedSet.has(f));

  for (const format of candidates) {
    const color = format === 'image/pwg-raster'
      ? choosePwgRasterColor(pwgRasterDocumentTypeSupported)
      : chooseUrfColor(urfSupported);
    if (!color) continue; // this envelope's own capability list gave us nothing parseable/producible — try the other one

    const dpi = chooseResolution({
      format, urfSupported, pwgRasterResolutionSupported, printerResolutionSupported,
    });

    return {
      format,
      needsRasterize: true,
      raster: { dpi, media, ...color },
    };
  }

  return null; // no raster format's internal constraints were satisfiable — refuse
}

/**
 * Filter our own desired job attributes down to the ones the printer's
 * `job-creation-attributes-supported` actually names. An attribute a printer
 * never declared it accepts is exactly the class of assumption that caused
 * the incidents this module exists to prevent — so this never sends one on
 * spec/hope, only on confirmed capability.
 *
 * @param {Object} params
 * @param {string[]} [params.jobCreationAttributesSupported]
 * @param {?number} [params.dpi] - only sent when rasterizing produced a concrete DPI
 * @param {?string} [params.printColorMode] - only sent when rasterizing produced a concrete color mode
 * @param {?string} [params.media]
 * @returns {{printerResolution?:{xres:number,yres:number,units:number}, printColorMode?:string, sides?:string, media?:string}}
 */
export function chooseJobAttributes({
  jobCreationAttributesSupported = [], dpi = null, printColorMode = null, media = null,
} = {}) {
  const supported = new Set(jobCreationAttributesSupported);
  const attrs = {};
  if (supported.has('printer-resolution') && Number.isFinite(dpi) && dpi > 0) {
    attrs.printerResolution = { xres: dpi, yres: dpi, units: 3 };
  }
  if (supported.has('print-color-mode') && printColorMode) {
    attrs.printColorMode = printColorMode;
  }
  if (supported.has('sides')) {
    // This adapter only ever renders independent single pages today (see
    // rasterize.mjs's maxPages/renderPageLimit) — there is no duplex
    // pairing logic, so the only truthful value to assert is one-sided.
    attrs.sides = 'one-sided';
  }
  if (supported.has('media') && media) {
    attrs.media = media;
  }
  return attrs;
}
