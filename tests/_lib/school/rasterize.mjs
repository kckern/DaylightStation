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

/**
 * Rasterize a PDF buffer to one PNG buffer per page.
 *
 * @param {Buffer} pdf
 * @param {Object} options
 * @param {number} options.dpi
 * @param {string} [options.name='page'] - only used to name the scratch files
 * @returns {Buffer[]} page images in order
 */
export function rasterizePdfPages(pdf, { dpi, name = 'page' }) {
  if (!Number.isFinite(dpi) || dpi <= 0) throw new TypeError(`rasterizePdfPages needs a positive dpi, got ${dpi}`);
  requirePdftoppm();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `school-raster-${name}-`));
  try {
    const pdfPath = path.join(workDir, `${name}.pdf`);
    fs.writeFileSync(pdfPath, pdf);
    execFileSync('pdftoppm', ['-png', '-r', String(dpi), pdfPath, path.join(workDir, 'page')], { stdio: 'pipe' });
    return fs.readdirSync(workDir)
      .filter((file) => file.startsWith('page') && file.endsWith('.png'))
      .sort()
      .map((file) => fs.readFileSync(path.join(workDir, file)));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export default { requirePdftoppm, rasterizePdfPages };
