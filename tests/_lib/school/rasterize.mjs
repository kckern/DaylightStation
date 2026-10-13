/**
 * Turn a School PDF into page images with poppler.
 *
 * Shared by the golden page suite (150dpi, "does this page still look right")
 * and the optical suite (300dpi, "is the ink where the record says it is"), so
 * both agree on how a PDF becomes pixels and neither can drift into its own
 * rasterizer.
 *
 * A missing `pdftoppm` THROWS. A pixel suite that skips itself reports green
 * while checking nothing, which is worse than having no suite at all.
 *
 * @module tests/_lib/school/rasterize
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

/** Verify poppler is on PATH, with an actionable message when it is not. */
export function requirePdftoppm() {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'pipe' });
  } catch (err) {
    throw new Error(
      'The School page suites need poppler\'s `pdftoppm` to rasterize PDFs, and it is not '
      + 'on PATH. Install it (macOS: `brew install poppler`; Debian/Ubuntu: `apt install '
      + 'poppler-utils`) and re-run. These suites deliberately fail instead of skipping: a '
      + `pixel test that quietly passes is checking nothing. (${err.message})`,
    );
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Encode an 8-bit greyscale PNG from a binary PGM (P5) buffer.
 *
 * `pdftoppm -png -gray` still writes RGB PNGs, so the grey path asks poppler for
 * PGM and encodes the PNG here (Sub-filtered, deflate 9) with no extra dependency.
 */
export function pgmToGreyPng(pgm) {
  let pos = 0;
  const token = () => {
    while (pos < pgm.length && /\s/.test(String.fromCharCode(pgm[pos]))) pos += 1;
    const start = pos;
    while (pos < pgm.length && !/\s/.test(String.fromCharCode(pgm[pos]))) pos += 1;
    return pgm.toString('latin1', start, pos);
  };
  if (token() !== 'P5') throw new Error('expected a binary PGM (P5) from pdftoppm -gray');
  const width = Number(token());
  const height = Number(token());
  if (Number(token()) !== 255) throw new Error('expected an 8-bit PGM from pdftoppm -gray');
  pos += 1; // the single whitespace byte before the raster
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = pos + y * width;
    const out = y * (width + 1);
    raw[out] = 1; // Sub filter
    for (let x = 0; x < width; x += 1) raw[out + 1 + x] = (pgm[row + x] - (x ? pgm[row + x - 1] : 0)) & 0xff;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Rasterize a PDF buffer to one PNG buffer per page.
 *
 * @param {Buffer} pdf
 * @param {Object} options
 * @param {number} options.dpi
 * @param {string} [options.name='page'] - only used to name the scratch files
 * @param {boolean} [options.gray=false] - emit 8-bit grey PNGs (poppler PGM, encoded to PNG here). Baselines
 *   committed to the repo use this: School print is black-and-white, so grey is lossless and
 *   about a third of the size of RGB.
 * @returns {Buffer[]} page images in order
 */
export function rasterizePdfPages(pdf, { dpi, name = 'page', gray = false }) {
  if (!Number.isFinite(dpi) || dpi <= 0) throw new TypeError(`rasterizePdfPages needs a positive dpi, got ${dpi}`);
  requirePdftoppm();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `school-raster-${name}-`));
  try {
    const pdfPath = path.join(workDir, `${name}.pdf`);
    fs.writeFileSync(pdfPath, pdf);
    execFileSync('pdftoppm', (gray ? ['-gray'] : ['-png']).concat(['-r', String(dpi), pdfPath, path.join(workDir, 'page')]), { stdio: 'pipe' });
    return fs.readdirSync(workDir)
      .filter((file) => file.startsWith('page') && file.endsWith(gray ? '.pgm' : '.png'))
      .sort()
      .map((file) => {
        const bytes = fs.readFileSync(path.join(workDir, file));
        return gray ? pgmToGreyPng(bytes) : bytes;
      });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export default { requirePdftoppm, rasterizePdfPages };
