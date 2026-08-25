/**
 * rasterize.mjs — convert PDF bytes into a raster format an AirPrint-class
 * printer actually accepts, using ghostscript's `urf` / `pwgraster` output
 * devices. This is the piece the first incident (see LaserPrinterAdapter.mjs's
 * header comment) was missing entirely: a PDF payload has to become raster
 * bytes BEFORE it reaches a printer whose `document-format-supported` never
 * listed PDF in the first place. Ghostscript is added to the container image
 * specifically for this (see docker/Dockerfile).
 *
 * ── Incident #2 ──────────────────────────────────────────────────────────
 * Getting the CONTAINER right (`image/urf`/`image/pwg-raster` instead of a
 * raw PDF) was not enough: a real print silently vanished even though the
 * printer had advertised the container we sent. Left to its defaults,
 * ghostscript's `urf`/`pwgraster` devices emit 1-bit monochrome
 * (`BitsPerPixel: 1` — confirmed by querying `currentpagedevice` on the
 * unconfigured device) regardless of `-r<dpi>`/`-sPAPERSIZE`. This printer's
 * declared pixel format was `W8`/`sgray_8` — 8-bit grayscale — a different
 * bit depth than what we were silently producing. A printer that only ever
 * agreed to 8-bit grayscale has no obligation to accept a 1-bit stream, and
 * this one didn't: no error, no state change, just gone.
 *
 * `rasterizePdf` now takes explicit target pixel parameters (from
 * negotiate.mjs's `choosePwgRasterColor`/`chooseUrfColor` — never guessed
 * here) and drives them into ghostscript via `-dcupsColorSpace`/
 * `-dcupsBitsPerColor`. Both raster devices in this ghostscript build are
 * cups-raster-derived and accept these switches directly; empirically
 * (against ghostscript 10.02.1, the version available while building this
 * fix — see the fix report for the full transcript):
 *
 *   -dcupsColorSpace=18 -dcupsBitsPerColor=8   → 1 channel, 8 bits/pixel  (SW / "standard gray")
 *   -dcupsColorSpace=19 -dcupsBitsPerColor=8   → 3 channels, 24 bits/pixel (SRGB)
 *
 * 18 and 19 are not made up: they are CUPS `raster.h`'s `CUPS_CSPACE_SW`/
 * `CUPS_CSPACE_SRGB` enum values, and negotiate.mjs's `COLOR_FAMILY` table
 * documents the mapping it drives from.
 *
 * More importantly, "we told ghostscript what to produce" is still just an
 * intention until something checks what came OUT. `validateRasterOutput`
 * parses the raster header we just generated — bits-per-pixel, resolution,
 * and pixel width/height — and throws loudly on any mismatch against the
 * negotiated parameters, rather than letting a silent ghostscript
 * flag-typo or version-behavior-change ship unverified bytes a THIRD time.
 * The `image/pwg-raster` header offsets used here were not just derived from
 * reading a hex dump: they were independently cross-checked by round-
 * tripping a generated file through this host's own CUPS `pwgtopdf` filter
 * (`/usr/lib/cups/filter/pwgtopdf`) and poppler's `pdfimages -list`, which
 * reported back the exact width/height/resolution/colorspace expected —
 * agreement from two independent, spec-conformant readers is what makes that
 * header trustworthy enough to gate a print on. `image/urf`'s own per-pixel
 * "colorspace" byte has no equivalent independent decoder available in this
 * environment (Apple's URF format is not an open IANA/PWG registry the way
 * PWG raster is), so this validator deliberately does NOT assert a specific
 * value for it — only the fields that ARE independently, arithmetically
 * verifiable (bits-per-pixel, width, height, resolution) are checked for
 * URF. Bits-per-pixel already captures the failure class that mattered here:
 * a color/grayscale or bit-depth mismatch changes bits-per-pixel, so the
 * guard still catches it without leaning on an unverified byte.
 *
 * @module adapters/hardware/laser-printer/rasterize
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { accessSync, constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const execFileAsync = promisify(execFile);

/**
 * ghostscript output devices for each raster format, CANONICAL FIRST.
 *
 * WHY THIS IS A LIST AND NOT A NAME. Ghostscript's device set is a build-time
 * decision, not a stable API: 10.05 ships `urf` and `pwgraster`, while 10.07
 * (Homebrew's current bottle) ships neither — it has only the colour-specific
 * `urfgray`/`urfrgb`/`urfcmyk`. The old code hardcoded `urf`, so on any
 * ghostscript without it every print died at RASTERIZE_FAILED with nothing but
 * "Command failed: gs …" — the device name is not in that message, so the one
 * fact you need is the one fact you do not get. That is a live upgrade hazard,
 * not a hypothetical: a container rebuild that lands a newer ghostscript takes
 * printing down and says almost nothing about why.
 *
 * The canonical device stays first, so a ghostscript that HAS it produces
 * byte-identical output to before. The fallbacks are colour-specific variants
 * of the same format — verified to accept the same `-dcupsColorSpace`/
 * `-dcupsBitsPerColor` switches and to emit the same `UNIRAST\0` magic.
 *
 * `image/pwg-raster` has no variant to fall back to: a ghostscript without
 * `pwgraster` cannot produce it at all, and says so by name.
 */
const GS_DEVICE_CANDIDATES = {
  'image/urf': ({ channels }) => ['urf', channels >= 4 ? 'urfcmyk' : channels === 3 ? 'urfrgb' : 'urfgray'],
  'image/pwg-raster': () => ['pwgraster'],
};

/**
 * Every `gs` on PATH, in PATH order — because the FIRST one is not necessarily
 * the capable one. This machine carries 10.07.0 (no `urf`) ahead of 10.00.0
 * (has `urf`) on PATH, which is exactly how a working install still fails.
 * An explicit path in `gsBin` is taken as given and never searched around.
 */
function ghostscriptBinaries(gsBin) {
  if (gsBin.includes('/')) return [gsBin];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const seen = new Set();
  const found = [];
  for (const dir of dirs) {
    const candidate = path.join(dir, gsBin);
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try { accessSync(candidate, fsConstants.X_OK); found.push(candidate); } catch { /* not here */ }
  }
  return found.length ? found : [gsBin];
}

/** Device names one ghostscript build reports. Cached — `gs -h` is a process spawn. */
const deviceCache = new Map();
async function ghostscriptDevices(bin) {
  if (deviceCache.has(bin)) return deviceCache.get(bin);
  let text = '';
  try {
    const { stdout } = await execFileAsync(bin, ['-h'], { timeout: 10000 });
    text = stdout;
  } catch (err) {
    // `gs -h` exits non-zero on some builds but still prints the list.
    text = err?.stdout || '';
  }
  // Bounded at BOTH ends. Everything after the device list is `Search path:`
  // and a list of directories — unbounded, those paths get tokenized too, and
  // a directory merely CONTAINING the string `urf` would read as a device.
  const after = text.split('Available devices:')[1] || '';
  const section = after.split(/^\s*Search path:/m)[0];
  const devices = new Set(section.split(/\s+/).filter(Boolean));
  deviceCache.set(bin, devices);
  return devices;
}

/** Reset between tests that manipulate PATH. */
export function __resetGhostscriptDeviceCache() { deviceCache.clear(); }

/**
 * First (binary, device) pair that can actually produce `format`. Device is the
 * OUTER loop so the canonical device on a later binary beats a fallback device
 * on an earlier one — a test run and production then exercise the same device.
 */
async function resolveGhostscript({ format, colorParams, gsBin }) {
  const candidates = GS_DEVICE_CANDIDATES[format]?.(colorParams);
  if (!candidates) {
    throw new InfrastructureError(`no ghostscript device for raster format: ${format}`, {
      code: 'UNSUPPORTED_RASTER_FORMAT', format,
    });
  }
  const binaries = ghostscriptBinaries(gsBin);
  const seen = [];
  for (const device of candidates) {
    for (const bin of binaries) {
      // eslint-disable-next-line no-await-in-loop
      const devices = await ghostscriptDevices(bin);
      seen.push(`${bin}:${devices.size}`);
      if (devices.has(device)) return { bin, device };
    }
  }
  throw new InfrastructureError(
    `no ghostscript on PATH provides a device for ${format} — tried devices [${candidates.join(', ')}] `
    + `across [${binaries.join(', ')}]. Install a ghostscript built with one of those devices, `
    + 'or point `gsBin` at one that is.',
    { code: 'RASTERIZE_NO_DEVICE', format, candidates, binaries },
  );
}

/** Magic bytes each device's output starts with — a cheap sanity check that ghostscript did what we asked. */
const MAGIC_BY_FORMAT = {
  'image/urf': Buffer.from('UNIRAST\0', 'latin1'),
  'image/pwg-raster': Buffer.from('RaS2', 'latin1'),
};

/** IPP `media` keyword -> ghostscript `-sPAPERSIZE=` value, for the media this device actually offers. */
const PAPER_SIZE_BY_MEDIA = {
  'na_letter_8.5x11in': 'letter',
  'iso_a4_210x297mm': 'a4',
};

/**
 * IPP `media` keyword -> page size in PostScript points (1/72in), the same
 * units `-sPAPERSIZE` resolves to internally. Used to compute the exact
 * pixel width/height ghostscript SHOULD produce at a given DPI
 * (`round(dpi * points / 72)`), so `validateRasterOutput` has a real
 * expected value to check the raster header against instead of only
 * checking "some positive number came out". Cross-checked against real
 * output: 600dpi letter -> 5100x6600 px, 300dpi letter -> 2550x3300 px,
 * matching ghostscript's actual raster headers exactly (round-tripped
 * through the system's own `pwgtopdf` + `pdfimages`, see this module's
 * header comment).
 */
const PAPER_POINTS_BY_MEDIA = {
  'na_letter_8.5x11in': [612, 792],
  'iso_a4_210x297mm': [595, 842],
};

/**
 * Default pixel parameters when a caller doesn't pass `colorParams` — 8-bit
 * grayscale, single channel. Exists for backward-compatible direct calls
 * (and this module's own tests); LaserPrinterAdapter's real call path always
 * passes an explicit `colorParams` from negotiate.mjs's color choosers, never
 * relies on this default.
 */
const DEFAULT_COLOR_PARAMS = { channels: 1, bitsPerColor: 8, cupsColorSpace: 18 };

/**
 * Parse an `image/urf` (Apple raster) page header. Offsets confirmed
 * empirically: magic(8 bytes "UNIRAST\0") + a 4-byte reserved/always-zero
 * field, then a 32-byte page header — byte0=bits-per-pixel, byte1=colorspace
 * (not asserted here, see module header), byte2=duplex, byte3=quality,
 * followed by two reserved uint32s, then width(uint32), height(uint32),
 * resolution(uint32; URF carries one square-DPI value, not separate x/y —
 * confirmed by the trailing field always reading 0 across every DPI/media
 * combination tested).
 * @param {Buffer} buf
 * @returns {?{bitsPerPixel:number, width:number, height:number, resolution:number}}
 */
function parseUrfHeader(buf) {
  if (buf.length < 44) return null;
  return {
    bitsPerPixel: buf.readUInt8(12),
    width: buf.readUInt32BE(24),
    height: buf.readUInt32BE(28),
    resolution: buf.readUInt32BE(32),
  };
}

/**
 * Parse an `image/pwg-raster` page header (PWG5102.4 `cups_page_header2_t`
 * layout, fixed-size regardless of content). Offsets confirmed both by
 * scanning generated files for known values (width/height/resolution) AND
 * by an independent round-trip through this host's own CUPS `pwgtopdf`
 * filter + poppler's `pdfimages -list` (see module header) — this is the
 * higher-confidence of the two parsers in this file.
 * @param {Buffer} buf
 * @returns {?{hres:number, vres:number, width:number, height:number, bitsPerColor:number, bitsPerPixel:number, colorSpace:number}}
 */
function parsePwgRasterHeader(buf) {
  if (buf.length < 0x198) return null;
  return {
    hres: buf.readUInt32BE(0x118),
    vres: buf.readUInt32BE(0x11c),
    width: buf.readUInt32BE(0x178),
    height: buf.readUInt32BE(0x17c),
    bitsPerColor: buf.readUInt32BE(0x184),
    bitsPerPixel: buf.readUInt32BE(0x188),
    colorSpace: buf.readUInt32BE(0x194),
  };
}

/**
 * The pixel dimensions ghostscript SHOULD have produced for `media` at
 * `dpi`, computed the same way ghostscript itself does (points -> pixels at
 * 72 points/inch). Unknown media falls back to Letter's points rather than
 * throwing here — `rasterizePdf` already defaults an unknown media's
 * `-sPAPERSIZE` to `letter` (see `PAPER_SIZE_BY_MEDIA` usage below), so the
 * expectation this computes must track that same fallback or a legitimate
 * Letter-shaped raster would be flagged as a false-positive mismatch.
 */
function expectedPixelDims(media, dpi) {
  const [ptWidth, ptHeight] = PAPER_POINTS_BY_MEDIA[media] || PAPER_POINTS_BY_MEDIA['na_letter_8.5x11in'];
  return { width: Math.round((dpi * ptWidth) / 72), height: Math.round((dpi * ptHeight) / 72) };
}

/**
 * Parse the raster we just generated and assert it actually matches the
 * negotiated parameters — the guard incident #2 needed. Throws
 * RASTERIZE_PARAM_MISMATCH (never returns a warning, never sends anyway) the
 * instant anything disagrees, with every expected/actual pair in the error
 * so a future investigation doesn't have to re-derive them from a hex dump.
 *
 * @param {Object} params
 * @param {string} params.format
 * @param {Buffer} params.buf - the raster bytes rasterizePdf is about to return
 * @param {number} params.dpi
 * @param {string} params.media
 * @param {number} params.channels
 * @param {number} params.bitsPerColor
 */
function validateRasterOutput({
  format, buf, dpi, media, channels, bitsPerColor,
}) {
  const expectedBpp = channels * bitsPerColor;
  const { width: expectedWidth, height: expectedHeight } = expectedPixelDims(media, dpi);
  const problems = [];
  const check = (label, expected, actual) => {
    if (expected !== actual) problems.push(`${label}: expected ${expected}, got ${actual}`);
  };

  if (format === 'image/urf') {
    const h = parseUrfHeader(buf);
    if (!h) {
      problems.push('page header: truncated/unparseable (fewer than 44 bytes before pixel data)');
    } else {
      check('bitsPerPixel', expectedBpp, h.bitsPerPixel);
      check('width(px)', expectedWidth, h.width);
      check('height(px)', expectedHeight, h.height);
      check('resolution(dpi)', dpi, h.resolution);
    }
  } else if (format === 'image/pwg-raster') {
    const h = parsePwgRasterHeader(buf);
    if (!h) {
      problems.push('page header: truncated/unparseable (fewer than 0x198 bytes before pixel data)');
    } else {
      check('bitsPerPixel', expectedBpp, h.bitsPerPixel);
      check('bitsPerColor', bitsPerColor, h.bitsPerColor);
      check('width(px)', expectedWidth, h.width);
      check('height(px)', expectedHeight, h.height);
      check('hres(dpi)', dpi, h.hres);
      check('vres(dpi)', dpi, h.vres);
    }
  }

  if (problems.length) {
    throw new InfrastructureError(
      `rasterized output does not match negotiated print parameters — refusing to transmit (${problems.join('; ')})`,
      {
        code: 'RASTERIZE_PARAM_MISMATCH', format, dpi, media, channels, bitsPerColor, problems,
      },
    );
  }
}

/**
 * Rasterize a PDF into `format` at `dpi`, via a temp-file ghostscript
 * invocation. Cleans up its temp directory unconditionally.
 *
 * @param {Buffer} pdf - complete PDF bytes
 * @param {Object} opts
 * @param {string} opts.format - 'image/urf' | 'image/pwg-raster'
 * @param {number} [opts.dpi=300]
 * @param {string} [opts.media='na_letter_8.5x11in'] - IPP media keyword
 * @param {Object} [opts.colorParams] - from negotiate.mjs's chooseUrfColor/choosePwgRasterColor
 * @param {number} [opts.colorParams.channels=1]
 * @param {number} [opts.colorParams.bitsPerColor=8]
 * @param {number} [opts.colorParams.cupsColorSpace=18] - drives ghostscript's `-dcupsColorSpace` (18 = CUPS_CSPACE_SW / standard gray)
 * @param {string} [opts.gsBin='gs'] - ghostscript binary (override for tests)
 * @param {number} [opts.timeoutMs=30000]
 * @param {Object} [opts.logger=console]
 * @returns {Promise<Buffer>} raster bytes, already validated against `dpi`/`media`/`colorParams`
 * @throws {InfrastructureError} UNSUPPORTED_RASTER_FORMAT | RASTERIZE_FAILED | RASTERIZE_EMPTY_OUTPUT | RASTERIZE_BAD_OUTPUT | RASTERIZE_PARAM_MISMATCH
 */
export async function rasterizePdf(pdf, {
  format, dpi = 300, media = 'na_letter_8.5x11in', colorParams = DEFAULT_COLOR_PARAMS,
  gsBin = 'gs', timeoutMs = 30000, logger = console, maxPages = null, duplex = false,
} = {}) {
  const paperSize = PAPER_SIZE_BY_MEDIA[media] || 'letter';
  const { channels = 1, bitsPerColor = 8, cupsColorSpace = 18 } = colorParams || {};
  const { bin: gsPath, device } = await resolveGhostscript({
    format, colorParams: { channels, bitsPerColor, cupsColorSpace }, gsBin,
  });

  const dir = await mkdtemp(path.join(tmpdir(), 'laser-print-'));
  try {
    const inPath = path.join(dir, 'in.pdf');
    const outPath = path.join(dir, `out.${device}`);
    await writeFile(inPath, pdf);

    try {
      // A ceiling on PAGES RENDERED, distinct from `maxPagesPerJob`, which
      // REFUSES an oversized job outright. This one trims instead — which is
      // what a supervised hardware test needs: "prove one page comes out
      // right" must not be answerable only by "the job was refused". Null
      // means no ceiling, and that is the production default; a household
      // that sets this is deliberately truncating real worksheets.
      const pageRange = Number.isInteger(maxPages) && maxPages > 0
        ? ['-dFirstPage=1', `-dLastPage=${maxPages}`]
        : [];
      await execFileAsync(gsPath, [
        '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER',
        `-sDEVICE=${device}`,
        `-r${dpi}`,
        `-sPAPERSIZE=${paperSize}`,
        // The actual fix for incident #2: without these, ghostscript's raster
        // devices default to 1-bit monochrome (see module header) regardless
        // of everything else on this command line. cupsColorSpace/
        // cupsBitsPerColor are the switches that steer BOTH the `urf` and
        // `pwgraster` devices — confirmed empirically, see module header.
        `-dcupsColorSpace=${cupsColorSpace}`,
        `-dcupsBitsPerColor=${bitsPerColor}`,
        // DUPLEX LIVES IN THE RASTER, NOT IN THE IPP JOB. This printer rejects
        // the IPP `sides` attribute at every value, so the adapter stopped
        // sending it and fell back to the printer's own `sides-default`. That
        // still printed one-sided, and this is why: every URF page carries its
        // OWN duplex byte in its 32-byte header, and ghostscript writes 1
        // (simplex) unless told otherwise. An explicit per-page "single-sided"
        // instruction beats a printer default every time — the sheet was being
        // told to print simplex by the very bytes we sent it.
        //
        // Measured on this ghostscript (2026-08-23), page-header byte 2:
        //   -dDuplex=false               -> 1  (simplex)
        //   -dDuplex=true -dTumble=true  -> 2  (short-edge binding)
        //   -dDuplex=true                -> 3  (long-edge binding)
        // `Tumble=false` is stated rather than left to default so the binding
        // edge is a choice in the code, not an inherited one: long edge is the
        // "book" fold a stapled worksheet wants.
        `-dDuplex=${duplex === true}`,
        '-dTumble=false',
        ...pageRange,
        `-sOutputFile=${outPath}`,
        inPath,
      ], { timeout: timeoutMs });
    } catch (err) {
      throw new InfrastructureError(`ghostscript rasterize failed: ${err.message}`, {
        code: 'RASTERIZE_FAILED', format, device, dpi,
      });
    }

    const out = await readFile(outPath).catch(() => Buffer.alloc(0));
    if (out.length === 0) {
      throw new InfrastructureError('ghostscript produced empty output', {
        code: 'RASTERIZE_EMPTY_OUTPUT', format, device, dpi,
      });
    }
    const magic = MAGIC_BY_FORMAT[format];
    if (magic && !out.subarray(0, magic.length).equals(magic)) {
      throw new InfrastructureError(`ghostscript output does not match expected ${format} magic bytes`, {
        code: 'RASTERIZE_BAD_OUTPUT', format, device, dpi,
      });
    }

    // THE GUARD for incident #2: the container and magic bytes were right
    // last time too. Parse what we actually produced and refuse to hand it
    // back — let alone transmit it — if it doesn't match what we told
    // ghostscript (and what we're about to tell the printer via IPP job
    // attributes) to produce.
    validateRasterOutput({
      format, buf: out, dpi, media, channels, bitsPerColor,
    });

    logger.info?.('laser-printer.rasterized', {
      format, device, dpi, media, channels, bitsPerColor, cupsColorSpace, bytesIn: pdf.length, bytesOut: out.length,
    });
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export default rasterizePdf;
