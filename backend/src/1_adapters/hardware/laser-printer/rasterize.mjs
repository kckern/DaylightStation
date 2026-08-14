/**
 * rasterize.mjs — convert PDF bytes into a raster format an AirPrint-class
 * printer actually accepts, using ghostscript's `urf` / `pwgraster` output
 * devices. This is the piece the incident (see LaserPrinterAdapter.mjs's
 * header comment) was missing entirely: a PDF payload has to become raster
 * bytes BEFORE it reaches a printer whose `document-format-supported` never
 * listed PDF in the first place. Ghostscript is added to the container image
 * specifically for this (see docker/Dockerfile).
 *
 * @module adapters/hardware/laser-printer/rasterize
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const execFileAsync = promisify(execFile);

/** ghostscript output device for each raster format we're willing to produce. */
const GS_DEVICE_BY_FORMAT = {
  'image/urf': 'urf',
  'image/pwg-raster': 'pwgraster',
};

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
 * Rasterize a PDF into `format` at `dpi`, via a temp-file ghostscript
 * invocation. Cleans up its temp directory unconditionally.
 *
 * @param {Buffer} pdf - complete PDF bytes
 * @param {Object} opts
 * @param {string} opts.format - 'image/urf' | 'image/pwg-raster'
 * @param {number} [opts.dpi=300]
 * @param {string} [opts.media='na_letter_8.5x11in'] - IPP media keyword
 * @param {string} [opts.gsBin='gs'] - ghostscript binary (override for tests)
 * @param {number} [opts.timeoutMs=30000]
 * @param {Object} [opts.logger=console]
 * @returns {Promise<Buffer>} raster bytes
 * @throws {InfrastructureError} UNSUPPORTED_RASTER_FORMAT | RASTERIZE_FAILED | RASTERIZE_EMPTY_OUTPUT | RASTERIZE_BAD_OUTPUT
 */
export async function rasterizePdf(pdf, {
  format, dpi = 300, media = 'na_letter_8.5x11in', gsBin = 'gs', timeoutMs = 30000, logger = console,
  maxPages = null,
} = {}) {
  const device = GS_DEVICE_BY_FORMAT[format];
  if (!device) {
    throw new InfrastructureError(`no ghostscript device for raster format: ${format}`, {
      code: 'UNSUPPORTED_RASTER_FORMAT', format,
    });
  }
  const paperSize = PAPER_SIZE_BY_MEDIA[media] || 'letter';

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
      await execFileAsync(gsBin, [
        '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER',
        `-sDEVICE=${device}`,
        `-r${dpi}`,
        `-sPAPERSIZE=${paperSize}`,
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

    logger.info?.('laser-printer.rasterized', {
      format, device, dpi, media, bytesIn: pdf.length, bytesOut: out.length,
    });
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export default rasterizePdf;
